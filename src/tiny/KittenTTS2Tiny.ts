// Kitten TTS 2 nano / pico / mini on device: small multilingual models run with ONNX
// Runtime, the React Native counterpart of the Python package's KittenTTS2Tiny
// (kittenml/kittentts2_tiny/model.py). Same voices, same text front end (phonemes
// identical to Python's), same synthesis recipe.

import { KittenTTSError, KittenTTSErrorCode, errorMessage, isKittenTTSError } from '../KittenTTSError';
import { KittenTTSResult } from '../KittenTTSResult';
import type { AudioPlayer, AudioPlayOptions, AudioOutput } from '../audio/AudioOutput';
import type { ProgressHandler } from '../loader/ModelDownloader';
import { loadNPZData } from '../loader/NPZParser';
import type { VoiceEmbeddings } from '../loader/NPZParser';
import { WAVEncoder } from '../audio/WAVEncoder';
import type { AssetRequest, TinyFileSource, TinyPlatform } from './assets';
import { memo, routedStore } from './assets';
import { TinyFrontend } from './frontend/Frontend';
import { pyLower } from './frontend/pystr';
import type { EspeakG2P } from './frontend/espeak/EspeakG2P';
import { createSession } from './ort';
import type { KittenTinyModel, KittenTinyWeights, TinyRepoConfig, TinyVoice } from './TinyRepo';
import { huggingFaceResolveURL, modelFiles, onnxWeights, tinyRepoId } from './TinyRepo';
import type { PhonemeWordTime } from './TinySynth';
import { GAP_SECONDS, TinySynth } from './TinySynth';

// The English front end (and WordTimings, which uses its normaliser) is imported when first
// used, like espeak-ng and Japanese: it builds Unicode regular expressions that older Hermes
// cannot, and importing the SDK must work there for the other models.

/**
 * Where the text front end's data lives: misaki's lexicons, spaCy's tokenizer and tagger
 * (en/...), espeak-ng's data (espeak-ng-data/...) and a manifest, as written by
 * tools/kitten-tts-2-tiny/build_text_pack.py.
 */
export const DEFAULT_TEXT_DATA_URL = 'https://huggingface.co/dewan-sl/kitten-tts-2-text/resolve/main';
/** Cache folder of the text data; bump when its format changes. */
const TEXT_DIR = 'kitten-tts-2-text-v2';
const MANIFEST = 'manifest.json';

interface TextManifest {
  version: number;
  /** Logical file -> its size, and the gzipped copy that is hosted instead when present. */
  files: Record<string, { size: number; sha256: string; gzip?: { size: number; sha256: string } }>;
}

/**
 * The text front end needs Unicode property escapes and \u{...} in regular expressions it
 * builds at run time, and BigInt: Hermes has them from React Native 0.75.
 */
function checkRuntime(): void {
  try {
    new RegExp('\\p{L}\\u{1F600}', 'u');
    BigInt(1);
  } catch (error) {
    throw new KittenTTSError(
      KittenTTSErrorCode.UnsupportedRuntime,
      'Kitten TTS 2 Nano, Pico and Mini need a JavaScript engine with Unicode regular expressions '
        + 'and BigInt (Hermes from React Native 0.75 on).',
      error,
    );
  }
}

export interface KittenTTS2TinyOptions {
  /** `'kitten-tts-2-nano'`, `'kitten-tts-2-pico'` or `'kitten-tts-2-mini'` (or the `KittenML/...` repository). */
  model: KittenTinyModel;
  /** ONNX weights: `'int8'` (default) or `'int4'` (about half the size). */
  weights?: KittenTinyWeights;
  /** Languages to download and load in `create()`. Others are fetched on first use. Default: the model's default language. */
  languages?: string[];
  /** Cache folder. Default: `<DocumentDirectory>/KittenTTS` on device. */
  storageDirectory?: string;
  /** Host of the model files instead of Hugging Face (a folder laid out like the repository). */
  modelBaseURL?: string;
  /**
   * A local folder laid out like the repository (config.json, vocab.json, the graphs,
   * voices_<lang>.npz, g2p/), used instead of downloading: Python's KittenTTS("path/to/dir").
   */
  modelDirectory?: string;
  /** Host of the text front end's data. Default: {@link DEFAULT_TEXT_DATA_URL}. */
  textDataURL?: string;
  /** A local copy of the text data folder (files plain or gzipped), used instead of downloading. */
  textDataDirectory?: string;
  /** A Hugging Face token, sent with Hugging Face downloads (private or gated repositories). */
  hfToken?: string;
  /** Attempts per file. Default 4. */
  downloadRetries?: number;
  /** ONNX Runtime intra-op threads for the speech model. */
  ortNumThreads?: number;
  /** Player for `speak()` and `play()`. */
  player?: AudioPlayer;
  /** For tests and custom hosts: ONNX Runtime and a file store to use instead of the platform's. */
  platform?: TinyPlatform;
  /** With an API key or a base URL the model runs through the Kitten API instead ({@link KittenTTS2}). */
  apiKey?: never;
  baseUrl?: never;
}

export interface KittenTTS2TinyGenerateOptions {
  /** A voice name from `availableVoices` in any case, or its description. Default: the language's first voice. */
  voice?: string;
  /** A code from `languages`. Default: the voice's language, else the model's default language. */
  language?: string;
  /** Larger is faster. Default 1. */
  speed?: number;
}

export interface KittenTTS2TinyFileOptions extends KittenTTS2TinyGenerateOptions {
  /** Sample rate written in the WAV header (Python's sample_rate; the audio is not resampled). */
  sampleRate?: number;
}

export interface KittenTTS2TinyVoice {
  key: string;
  name: string;
  description: string;
  language: string;
  [field: string]: unknown;
}

type Options = KittenTTS2TinyOptions & { weights: KittenTinyWeights };

export class KittenTTS2Tiny {
  /** The repository, e.g. `KittenML/kitten-tts-2-nano`. */
  readonly repoId: string;
  readonly weights: KittenTinyWeights;
  readonly sampleRate: number;
  /** Language codes the model speaks. */
  readonly languages: string[];
  readonly defaultLanguage: string;

  private readonly frontend: TinyFrontend;
  private readonly synth: TinySynth;
  private readonly packs = new Map<string, Promise<VoiceEmbeddings>>();
  private readonly prepared = new Map<string, Promise<void>>();
  private readonly manifests = new Map<'cached' | 'refreshed', Promise<TextManifest>>();
  /** One espeak-ng for every language that uses it. */
  private espeak: Promise<EspeakG2P> | null = null;
  private audio: Promise<AudioOutput> | null = null;
  private disposed = false;

  private constructor(
    private readonly platform: TinyPlatform,
    private readonly config: TinyRepoConfig,
    vocab: Record<string, number>,
    private readonly options: Options,
    repoId: string,
  ) {
    this.repoId = repoId;
    this.weights = options.weights;
    this.sampleRate = config.sample_rate ?? 24000;
    this.languages = Object.keys(config.languages);
    this.defaultLanguage = config.default_language ?? this.languages[0];
    this.frontend = new TinyFrontend(config.phonemizer ?? 'v1', vocab, {
      english: v1 => this.loadEnglish(v1),
      espeak: lang => this.loadEspeak(lang),
      japanese: () => this.loadJapanese(),
    });
    this.synth = new TinySynth(platform.ort, vocab, this.sampleRate, async file => {
      const key = this.modelKey(file);
      const model = (await platform.store.filePath(key)) ?? (await platform.store.bytes(key));
      return createSession(platform.ort, model, options.ortNumThreads);
    });
  }

  /**
   * Download what the model needs (config, the first languages' graphs, voices and text
   * data) and load it.
   */
  static async create(options: KittenTTS2TinyOptions, onProgress?: ProgressHandler): Promise<KittenTTS2Tiny> {
    const tts = await KittenTTS2Tiny.open(options);
    try {
      const langs = await tts.download(options.languages, onProgress);
      await Promise.all(langs.map(l => tts.prepare(l)));
    } catch (error) {
      await tts.dispose();
      throw error;
    }
    return tts;
  }

  /** Download a model's files (for `options.languages`) without loading it. */
  static async predownload(options: KittenTTS2TinyOptions, onProgress?: ProgressHandler): Promise<void> {
    const tts = await KittenTTS2Tiny.open(options);
    try {
      await tts.download(options.languages, onProgress);
    } finally {
      await tts.dispose();
    }
  }

  /** Read the model's config and vocab (downloading them if needed); nothing else is loaded. */
  private static async open(options: KittenTTS2TinyOptions): Promise<KittenTTS2Tiny> {
    checkRuntime();
    const repoId = tinyRepoId(options.model);
    if (!repoId) throw KittenTTSError.invalidArgument(`Unknown model ${String(options.model)}`);
    const base = options.platform ?? (await (await import('./platform')).defaultTinyPlatform(options));
    const routes: Record<string, TinyFileSource> = {};
    if (options.modelDirectory) routes[modelFolder(repoId)] = base.store.local(options.modelDirectory);
    if (options.textDataDirectory) routes[TEXT_DIR] = base.store.local(options.textDataDirectory);
    const platform: TinyPlatform = Object.keys(routes).length
      ? { ort: base.ort, store: routedStore(base.store, routes) }
      : base;
    const store = platform.store;
    const request = (file: string) => modelRequest(repoId, options, file);
    let config: TinyRepoConfig;
    let vocab: Record<string, number>;
    await store.ensure([request('config.json')]);
    try {
      config = JSON.parse(await store.text(request('config.json').key));
      const vocabFile = request(config.vocab ?? 'vocab.json');
      await store.ensure([vocabFile]);
      vocab = JSON.parse(await store.text(vocabFile.key));
    } catch (error) {
      if (isKittenTTSError(error)) throw error;
      // A broken download: forget it so the next create() fetches it again.
      await store.clear(request('config.json').key);
      await store.clear(request('vocab.json').key);
      throw KittenTTSError.invalidModelData(`Could not read ${repoId}'s config: ${errorMessage(error)}`, error);
    }
    if (config.type !== 'KITTEN2_TINY') {
      throw KittenTTSError.invalidModelData(`${repoId} is not a Kitten TTS 2 nano / pico / mini repository`);
    }
    const weights = options.weights ?? config.default_weights ?? 'int8';
    if (!onnxWeights(config).includes(weights)) {
      throw KittenTTSError.invalidArgument(
        `${config.name ?? repoId} has no ${weights} ONNX weights; expected one of ${onnxWeights(config).join(', ')}`,
      );
    }
    return new KittenTTS2Tiny(platform, config, vocab, { ...options, weights }, repoId);
  }

  /** The ONNX weight formats this model has, e.g. `['int8', 'int4']`. */
  get onnxWeights(): KittenTinyWeights[] {
    return onnxWeights(this.config);
  }

  // ---- voices -----------------------------------------------------------------------------

  /** Voice names per language: `{ en: ['Eleanor', ...], de: ['Anna', ...] }`. */
  get availableVoices(): Record<string, string[]> {
    const out: Record<string, string[]> = {};
    for (const [lang, vs] of Object.entries(this.config.voices)) out[lang] = vs.map(v => v.name);
    return out;
  }

  /** The voices of one language (default: all), with key, name, description and language. */
  voices(language?: string): KittenTTS2TinyVoice[] {
    const langs = language ? [this.resolveLanguage(language)] : this.languages;
    // Every field the repository's config has for the voice, plus its language, as in Python.
    return langs.flatMap(lang => (this.config.voices[lang] ?? []).map(v => ({
      ...v,
      description: v.description ?? '',
      language: lang,
    })));
  }

  /**
   * `[language, voice key]` for a voice name in any case, a description, or nothing (the
   * language's first voice). Without a language, a name only one language has decides
   * it; a name several share means the default language's voice.
   */
  resolveVoice(voice?: string, language?: string): [string, string] {
    if (voice == null) {
      const lang = this.resolveLanguage(language);
      return [lang, this.config.voices[lang][0].key];
    }
    const langs = language ? [this.resolveLanguage(language)] : this.languages;
    const want = pyLower(String(voice));
    const hits: Array<[string, string]> = [];
    for (const lang of langs) {
      for (const v of this.config.voices[lang] ?? []) {
        const names = (['key', 'name', 'description', 'id'] as const)
          .filter(f => f in v)
          .map(f => pyLower(String((v as TinyVoice)[f] ?? '')));
        if (names.includes(want)) hits.push([lang, v.key]);
      }
    }
    if (hits.length === 0) {
      throw KittenTTSError.invalidArgument(`No voice ${JSON.stringify(voice)}${language ? ` for ${language}` : ''}`);
    }
    if (hits.length > 1) {
      if (!language) {
        const d = hits.find(h => h[0] === this.defaultLanguage);
        if (d) return d;
      }
      throw KittenTTSError.invalidArgument(
        `Voice ${JSON.stringify(voice)} exists in ${hits.map(h => h[0]).join(', ')}: pass language`,
      );
    }
    return hits[0];
  }

  // ---- synthesis --------------------------------------------------------------------------

  /** text -> the phoneme chunks the model will speak. */
  async phonemize(text: string, language?: string): Promise<string[]> {
    this.ensureOpen();
    const lang = this.resolveLanguage(language);
    await this.prepare(lang);
    return this.frontend.phonemize(text, lang);
  }

  /**
   * Synthesize `text`: 24 kHz float32 audio. Long text is cut at sentence ends and joined
   * with 0.15 s of silence. `wordTimings` gives each input word's time range.
   */
  async generate(text: string, voiceOrOptions?: string | KittenTTS2TinyGenerateOptions, speed?: number): Promise<KittenTTSResult<string>> {
    const opts = normalizeOptions(voiceOrOptions, speed);
    const gap = Math.floor(GAP_SECONDS * this.sampleRate);
    const parts: Float32Array[] = [];
    const words: PhonemeWordTime[] = [];
    let length = 0;
    let lang = '';
    let name = '';
    for await (const c of this.chunks(text, opts)) {
      if (parts.length) length += gap;
      const at = length / this.sampleRate;
      for (const w of c.words) words.push({ phonemes: w.phonemes, start: w.start + at, end: w.end + at });
      parts.push(c.samples);
      length += c.samples.length;
      lang = c.lang;
      name = c.voice;
    }
    const samples = new Float32Array(length);
    let pos = 0;
    for (const p of parts) {
      samples.set(p, pos);
      pos += p.length + gap;
    }
    if (!name) name = this.voiceName(...this.resolveVoice(opts.voice, opts.language));   // text with no phonemes
    const { wordTimings } = await import('./WordTimings');
    return new KittenTTSResult(samples, this.sampleRate, name, opts.speed ?? 1, text, wordTimings(text, lang, words));
  }

  /** Synthesize chunk by chunk, yielding each as soon as it is ready. */
  async *generateStreaming(text: string, voiceOrOptions?: string | KittenTTS2TinyGenerateOptions, speed?: number): AsyncGenerator<KittenTTSResult<string>, void, void> {
    const opts = normalizeOptions(voiceOrOptions, speed);
    for await (const c of this.chunks(text, opts)) {
      yield new KittenTTSResult(c.samples, this.sampleRate, c.voice, opts.speed ?? 1, text);
    }
  }

  private async *chunks(text: string, opts: KittenTTS2TinyGenerateOptions):
    AsyncGenerator<{ samples: Float32Array; words: PhonemeWordTime[]; lang: string; voice: string }, void, void> {
    this.ensureOpen();
    const s = opts.speed ?? 1;
    if (!Number.isFinite(s) || s <= 0) throw KittenTTSError.invalidArgument(`speed must be a positive number, got ${s}`);
    if (!text || !text.trim()) throw KittenTTSError.emptyInput();
    const [lang, key] = this.resolveVoice(opts.voice, opts.language);
    await this.prepare(lang);
    let chunks: string[];
    try {
      chunks = await this.frontend.phonemize(text, lang);
    } catch (error) {
      if (isKittenTTSError(error)) throw error;
      throw KittenTTSError.phonemizerFailed(errorMessage(error), error);
    }
    const pack = (await this.pack(lang))[key];
    if (!pack) throw KittenTTSError.invalidModelData(`voices for ${lang} have no ${key}`);
    const voice = this.voiceName(lang, key);
    for (let i = 0; i < chunks.length; i++) {
      this.ensureOpen();
      try {
        yield { ...(await this.synth.chunk(this.graphFile(lang), pack, chunks[i], s, i === 0)), lang, voice };
      } catch (error) {
        throw KittenTTSError.inferenceFailed(errorMessage(error), error);
      }
    }
  }

  /** Generate and write a 16-bit WAV file (Python's generate_to_file). Returns the path. */
  async generateToFile(text: string, path: string, options: KittenTTS2TinyFileOptions = {}): Promise<string> {
    const result = await this.generate(text, options);
    await this.platform.store.writeFile(path, WAVEncoder.encode(result.samples, options.sampleRate ?? this.sampleRate));
    return path;
  }

  /** Generate and play through the configured player. */
  async speak(text: string, voiceOrOptions?: string | KittenTTS2TinyGenerateOptions, speed?: number): Promise<KittenTTSResult<string>> {
    const result = await this.generate(text, voiceOrOptions, speed);
    await this.play(result);
    return result;
  }

  async play(result: KittenTTSResult<string>, options: AudioPlayOptions = {}): Promise<void> {
    this.ensureOpen();
    await (await this.audioOutput()).play(result.samples, result.sampleRate, options);
  }

  async stopSpeaking(): Promise<void> {
    if (this.audio) await (await this.audio).stop();
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.stopSpeaking().catch(() => {});
    await this.synth.dispose();
    await this.frontend.dispose();
  }

  // ---- files ------------------------------------------------------------------------------

  /** A language code the model speaks (default: the model's default language). */
  private resolveLanguage(language?: string): string {
    if (language == null) return this.defaultLanguage;
    if (!this.config.languages[language]) {
      throw KittenTTSError.invalidArgument(
        `${this.config.name ?? this.repoId} does not speak ${JSON.stringify(language)}; languages: ${this.languages.join(', ')}`,
      );
    }
    return language;
  }

  private voiceName(lang: string, key: string): string {
    return this.config.voices[lang]?.find(v => v.key === key)?.name ?? key;
  }

  /** Download every file these languages need (default: the model's default language). */
  private async download(languages: string[] | undefined, onProgress?: ProgressHandler): Promise<string[]> {
    const langs = (languages ?? [this.defaultLanguage]).map(l => this.resolveLanguage(l));
    const files = await Promise.all(langs.map(l => this.filesFor(l)));
    await this.platform.store.ensure(files.flat(), onProgress);
    return langs;
  }

  /** The language's ONNX graph in the chosen weights. */
  private graphFile(lang: string): string {
    return modelFiles(this.config.languages[lang])[this.weights] as string;
  }

  /** A file of the small English G2P model, in the repository's g2p folder. */
  private g2pFile(name: string): string {
    return name.replace(/^g2p\//, `${this.config.g2p_dir ?? 'g2p'}/`);
  }

  private modelKey(file: string): string {
    return modelRequest(this.repoId, this.options, file).key;
  }

  private textRequest(file: string, entry?: TextManifest['files'][string]): AssetRequest {
    const url = `${this.options.textDataURL ?? DEFAULT_TEXT_DATA_URL}/${file}${entry?.gzip ? '.gz' : ''}`;
    return withToken({ key: `${TEXT_DIR}/${file}`, url, gzip: Boolean(entry?.gzip), size: entry?.size }, this.options.hfToken);
  }

  /** The text data's manifest: which files exist, their sizes and which are hosted gzipped. */
  private async readManifest(): Promise<TextManifest> {
    const request = this.textRequest(MANIFEST);
    await this.platform.store.ensure([request]);
    return JSON.parse(await this.platform.store.text(request.key)) as TextManifest;
  }

  /** The request for one text data file, as the manifest describes it. */
  private async textFile(file: string): Promise<AssetRequest> {
    let entry = (await memo(this.manifests, 'cached', () => this.readManifest())).files[file];
    if (!entry) {
      // A manifest cached before the hosted data gained this file: fetch it again, once
      // (shared by the requests that miss together).
      const fresh = await memo(this.manifests, 'refreshed', async () => {
        await this.platform.store.clear(this.textRequest(MANIFEST).key);
        const manifest = await this.readManifest();
        this.manifests.set('cached', Promise.resolve(manifest));
        return manifest;
      });
      entry = fresh.files[file];
    }
    if (!entry) throw KittenTTSError.invalidModelData(`The text data has no ${file}`);
    return this.textRequest(file, entry);
  }

  /** Every file one language needs: graph, voices and front-end data. */
  private async filesFor(lang: string): Promise<AssetRequest[]> {
    const model = [this.graphFile(lang), this.config.languages[lang].voices];
    let textFiles: readonly string[];
    if (lang === 'en') {
      const { ENGLISH_G2P_FILES, ENGLISH_TEXT_FILES } = await import('./frontend/english/load');
      model.push(...ENGLISH_G2P_FILES.map(f => this.g2pFile(f)));
      textFiles = ENGLISH_TEXT_FILES;
    } else if (lang === 'ja') {
      // UniDic for MeCab, rebuilt compact (65 MB unpacked); only Mini speaks Japanese.
      const { JAPANESE_DATA_FILES } = await import('./frontend/japanese/JapaneseG2P');
      textFiles = JAPANESE_DATA_FILES;
    } else {
      // Imported here so apps that only speak English never load espeak-ng.
      // The file list only: the espeak-ng runtime loads with the language.
      const { espeakDataFilesFor } = await import('./frontend/espeak/files');
      textFiles = espeakDataFilesFor(lang).map(f => `espeak-ng-data/${f}`);
    }
    return [
      ...model.map(f => modelRequest(this.repoId, this.options, f)),
      ...(await Promise.all(textFiles.map(f => this.textFile(f)))),
    ];
  }

  /** Download (if needed) and load one language. */
  private prepare(lang: string): Promise<void> {
    return memo(this.prepared, lang, async () => {
      this.ensureOpen();
      await this.platform.store.ensure(await this.filesFor(lang));
      await Promise.all([
        this.synth.prepare(this.graphFile(lang)),
        this.pack(lang),
        // English's lexicons and tagger take a few seconds to load on a phone:
        // better in create() than in the first generate().
        this.frontend.ready(lang),
      ]);
    });
  }

  private pack(lang: string): Promise<VoiceEmbeddings> {
    const file = this.config.languages[lang].voices;
    return memo(this.packs, file, async () => loadNPZData(await this.platform.store.bytes(this.modelKey(file)), file));
  }

  private async loadEnglish(vocabV1: ReadonlySet<string>) {
    const { loadEnglishG2P } = await import('./frontend/english/load');
    const store = this.platform.store;
    const key = (name: string) => (name.startsWith('g2p/') ? this.modelKey(this.g2pFile(name)) : `${TEXT_DIR}/${name}`);
    return loadEnglishG2P(
      { text: name => store.text(key(name)), bytes: name => store.bytes(key(name)), filePath: name => store.filePath(key(name)) },
      this.platform.ort,
      vocabV1,
    );
  }

  private async loadJapanese() {
    const { JapaneseG2P, JAPANESE_DATA_FILES } = await import('./frontend/japanese/JapaneseG2P');
    const files: Record<string, Uint8Array> = {};
    // JapaneseG2P keeps views on these arrays (no copies): they belong to it from here.
    for (const f of JAPANESE_DATA_FILES) files[f] = await this.platform.store.bytes(`${TEXT_DIR}/${f}`);
    return JapaneseG2P.create(files);
  }

  /** The shared espeak-ng, created with the first language's files and given each new language's. */
  private async loadEspeak(lang: string): Promise<EspeakG2P> {
    const { EspeakG2P, espeakDataFilesFor } = await import('./frontend/espeak/EspeakG2P');
    const read = async (files: string[]) => {
      const out: Record<string, Uint8Array> = {};
      for (const f of files) out[f] = await this.platform.store.bytes(`${TEXT_DIR}/espeak-ng-data/${f}`);
      return out;
    };
    if (!this.espeak) {
      const created = read(espeakDataFilesFor(lang)).then(files => EspeakG2P.create(files));
      this.espeak = created;
      created.catch(() => { if (this.espeak === created) this.espeak = null; });
    }
    const espeak = await this.espeak;
    const missing = espeak.missingFiles(lang);
    if (missing.length) espeak.addFiles(await read(missing));
    return espeak;
  }

  private audioOutput(): Promise<AudioOutput> {
    this.audio ??= import('../audio/AudioOutput').then(m => new m.AudioOutput(this.options.player));
    return this.audio;
  }

  private ensureOpen(): void {
    if (this.disposed) throw KittenTTSError.engineNotReady();
  }
}

/** The repository's cache folder: "kitten-tts-2-nano". */
function modelFolder(repoId: string): string {
  return repoId.split('/')[1];
}

function modelRequest(repoId: string, options: KittenTTS2TinyOptions, file: string): AssetRequest {
  const base = options.modelBaseURL ?? huggingFaceResolveURL(repoId);
  return withToken({ key: `${modelFolder(repoId)}/${file}`, url: `${base}/${file}` }, options.hfToken);
}

function withToken(request: AssetRequest, token?: string): AssetRequest {
  if (!token || !/^https:\/\/huggingface\.co\//.test(request.url)) return request;
  return { ...request, headers: { Authorization: `Bearer ${token}` } };
}

function normalizeOptions(v?: string | KittenTTS2TinyGenerateOptions, speed?: number): KittenTTS2TinyGenerateOptions {
  if (typeof v === 'string') return { voice: v, speed };
  return { ...(v ?? {}), ...(speed !== undefined ? { speed } : {}) };
}
