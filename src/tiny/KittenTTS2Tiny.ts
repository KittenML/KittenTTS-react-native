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
import type { AssetRequest, TinyAssetStore } from './assets';
import { routedStore } from './assets';
import { TinyFrontend } from './frontend/Frontend';
import { ENGLISH_G2P_FILES, ENGLISH_TEXT_FILES, loadEnglishG2P } from './frontend/english/load';
import { pyLower } from './frontend/english/pystr';
import type { EspeakG2P } from './frontend/espeak/EspeakG2P';
import type { JapaneseG2P } from './frontend/japanese/JapaneseG2P';
import type { OrtLike } from './ort';
import { createSession } from './ort';
import type { KittenTinyModel, KittenTinyWeights, TinyRepoConfig, TinyVoice } from './TinyRepo';
import { huggingFaceResolveURL, modelFiles, onnxWeights, tinyRepoId } from './TinyRepo';
import { GAP_SECONDS, TinySynth } from './TinySynth';
import type { PhonemeWordTime } from './WordTimings';
import { phonemeWordTimes, wordTimings } from './WordTimings';

/**
 * Where the text front end's data lives: misaki's lexicons, spaCy's tokenizer and tagger
 * (en/...), espeak-ng's data (espeak-ng-data/...) and a manifest, as written by
 * tools/kitten-tts-2-tiny/build_text_pack.py.
 */
export const DEFAULT_TEXT_DATA_URL = 'https://huggingface.co/dewan-sl/kitten-tts-2-text/resolve/main';
/** Cache folder of the text data; bump when its format changes. */
const TEXT_DIR = 'kitten-tts-2-text-v2';

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
  platform?: { ort: OrtLike; store: TinyAssetStore };
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

interface Platform {
  ort: OrtLike;
  store: TinyAssetStore;
}

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
  private espeak: Promise<EspeakG2P> | null = null;
  private audio: Promise<AudioOutput> | null = null;
  private disposed = false;

  private constructor(
    private readonly platform: Platform,
    private readonly config: TinyRepoConfig,
    private readonly vocab: Record<string, number>,
    private readonly options: KittenTTS2TinyOptions & { weights: KittenTinyWeights },
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
    this.synth = new TinySynth(platform.ort, vocab, async file => {
      const key = this.modelKey(file);
      const model = (await platform.store.filePath?.(key)) ?? (await platform.store.bytes(key));
      return createSession(platform.ort, model, { intraOpNumThreads: options.ortNumThreads });
    });
  }

  /**
   * Download what the model needs (config, the first languages' graphs, voices and text
   * data) and load it.
   */
  static async create(options: KittenTTS2TinyOptions, onProgress?: ProgressHandler): Promise<KittenTTS2Tiny> {
    checkRuntime();
    const repoId = tinyRepoId(options.model);
    if (!repoId) throw KittenTTSError.invalidArgument(`Unknown model ${String(options.model)}`);
    const base = options.platform ?? (await (await import('./platform')).defaultTinyPlatform(options));
    const dir = repoId.split('/')[1];
    const routes: Record<string, TinyAssetStore> = {};
    if (options.modelDirectory) routes[dir] = base.store.local(options.modelDirectory);
    if (options.textDataDirectory) routes[TEXT_DIR] = base.store.local(options.textDataDirectory);
    const platform: Platform = Object.keys(routes).length
      ? { ort: base.ort, store: routedStore(base.store, routes) }
      : base;
    const url = options.modelBaseURL ?? huggingFaceResolveURL(repoId);
    await platform.store.ensure(
      ['config.json', 'vocab.json'].map(f => withToken({ key: `${dir}/${f}`, url: `${url}/${f}` }, options.hfToken)),
    );
    let config: TinyRepoConfig;
    let vocab: Record<string, number>;
    try {
      config = JSON.parse(await platform.store.text(`${dir}/config.json`));
      vocab = JSON.parse(await platform.store.text(`${dir}/${config.vocab ?? 'vocab.json'}`));
    } catch (error) {
      await platform.store.clear(dir);
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
    const tts = new KittenTTS2Tiny(platform, config, vocab, { ...options, weights }, repoId);
    const langs = options.languages ?? [tts.defaultLanguage];
    for (const lang of langs) tts.language(lang);
    const files = await Promise.all(langs.map(l => tts.filesFor(l)));
    await platform.store.ensure(files.flat(), onProgress);
    await Promise.all(langs.map(l => tts.prepare(l)));
    return tts;
  }

  /** Download a model's files without keeping it loaded. */
  static async predownload(options: KittenTTS2TinyOptions, onProgress?: ProgressHandler): Promise<void> {
    const tts = await KittenTTS2Tiny.create(options, onProgress);
    await tts.dispose();
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
    const langs = language ? [this.language(language)] : this.languages;
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
      const lang = this.language(language);
      return [lang, this.config.voices[lang][0].key];
    }
    const langs = language ? [this.language(language)] : this.languages;
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
    const lang = this.language(language);
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
    const groups: PhonemeWordTime[] = [];
    let offset = 0;
    let lang = '';
    let name = '';
    for await (const c of this.chunks(text, opts)) {
      if (parts.length) offset += gap;
      const at = offset / this.sampleRate;
      for (const g of c.groups) groups.push({ phonemes: g.phonemes, start: g.start + at, end: g.end + at });
      parts.push(c.samples);
      offset += c.samples.length;
      lang = c.lang;
      name = c.voice;
    }
    const samples = new Float32Array(offset);
    let pos = 0;
    parts.forEach((p, i) => {
      samples.set(p, pos);
      pos += p.length + (i < parts.length - 1 ? gap : 0);
    });
    if (!name) name = this.voiceName(...this.resolveVoice(opts.voice, opts.language));
    return new KittenTTSResult(samples, this.sampleRate, name, opts.speed ?? 1, text, wordTimings(text, lang, groups));
  }

  /** Synthesize chunk by chunk, yielding each as soon as it is ready. */
  async *generateStreaming(text: string, voiceOrOptions?: string | KittenTTS2TinyGenerateOptions, speed?: number): AsyncGenerator<KittenTTSResult<string>, void, void> {
    const opts = normalizeOptions(voiceOrOptions, speed);
    for await (const c of this.chunks(text, opts)) {
      yield new KittenTTSResult(c.samples, this.sampleRate, c.voice, opts.speed ?? 1, text);
    }
  }

  private async *chunks(text: string, opts: KittenTTS2TinyGenerateOptions):
    AsyncGenerator<{ samples: Float32Array; groups: PhonemeWordTime[]; lang: string; voice: string }, void, void> {
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
    const entry = this.config.languages[lang];
    const file = modelFiles(entry)[this.weights] as string;
    const pack = (await this.pack(lang))[key];
    if (!pack) throw KittenTTSError.invalidModelData(`voices for ${lang} have no ${key}`);
    const voice = this.voiceName(lang, key);
    for (let i = 0; i < chunks.length; i++) {
      this.ensureOpen();
      let out: { samples: Float32Array; durations: number[]; lead: number; spf: number };
      try {
        out = await this.synth.chunkDetailed(file, pack, chunks[i], s, i === 0);
      } catch (error) {
        throw KittenTTSError.inferenceFailed(errorMessage(error), error);
      }
      const groups = phonemeWordTimes(chunks[i], this.vocab, out.durations, out.spf, out.lead, this.sampleRate, out.samples.length);
      yield { samples: out.samples, groups, lang, voice };
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
    if (this.espeak) (await this.espeak.catch(() => null))?.dispose();
    if (this.japanese) (await this.japanese.catch(() => null))?.dispose();
  }

  // ---- files ------------------------------------------------------------------------------

  private language(language?: string): string {
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

  private modelKey(file: string): string {
    return `${this.repoId.split('/')[1]}/${file}`;
  }

  private modelRequest(file: string): AssetRequest {
    const base = this.options.modelBaseURL ?? huggingFaceResolveURL(this.repoId);
    return withToken({ key: this.modelKey(file), url: `${base}/${file}` }, this.options.hfToken);
  }

  private textURL(file: string): string {
    return `${this.options.textDataURL ?? DEFAULT_TEXT_DATA_URL}/${file}`;
  }

  private textManifest: Promise<TextManifest> | null = null;
  private manifestRefresh: Promise<TextManifest> | null = null;

  /** The text data's manifest: which files exist, their sizes and which are hosted gzipped. */
  private manifest(): Promise<TextManifest> {
    this.textManifest ??= (async () => {
      const key = `${TEXT_DIR}/manifest.json`;
      await this.platform.store.ensure([withToken({ key, url: this.textURL('manifest.json') }, this.options.hfToken)]);
      return JSON.parse(await this.platform.store.text(key)) as TextManifest;
    })();
    this.textManifest.catch(() => { this.textManifest = null; });
    return this.textManifest;
  }

  private async textRequest(file: string): Promise<AssetRequest> {
    let entry = (await this.manifest()).files[file];
    if (!entry) {
      // A manifest cached before the hosted data gained this file: fetch it again, once
      // (shared by the requests that miss together).
      this.manifestRefresh ??= (async () => {
        await this.platform.store.clear(`${TEXT_DIR}/manifest.json`);
        this.textManifest = null;
        return this.manifest();
      })();
      entry = (await this.manifestRefresh).files[file];
    }
    if (!entry) throw KittenTTSError.invalidModelData(`The text data has no ${file}`);
    return withToken({
      key: `${TEXT_DIR}/${file}`,
      url: this.textURL(entry.gzip ? `${file}.gz` : file),
      gzip: Boolean(entry.gzip),
      size: entry.size,
    }, this.options.hfToken);
  }

  /** Every file one language needs: graph, voices and front-end data. */
  private async filesFor(lang: string): Promise<AssetRequest[]> {
    const entry = this.config.languages[lang];
    const model = [modelFiles(entry)[this.weights] as string, entry.voices].map(f => this.modelRequest(f));
    const g2pDir = this.config.g2p_dir ?? 'g2p';
    let textFiles: string[];
    if (lang === 'en') {
      textFiles = [...ENGLISH_TEXT_FILES];
      model.push(...ENGLISH_G2P_FILES.map(f => this.modelRequest(f.replace(/^g2p\//, `${g2pDir}/`))));
    } else if (lang === 'ja') {
      // UniDic for MeCab, rebuilt compact (65 MB unpacked); only Mini speaks Japanese.
      const { JAPANESE_DATA_FILES } = await import('./frontend/japanese/JapaneseG2P');
      textFiles = [...JAPANESE_DATA_FILES];
    } else {
      // Loaded lazily so apps that only speak English never load espeak-ng.
      const { espeakDataFilesFor } = await import('./frontend/espeak/EspeakG2P');
      textFiles = espeakDataFilesFor(lang).map(f => `espeak-ng-data/${f}`);
    }
    return [...model, ...(await Promise.all(textFiles.map(f => this.textRequest(f))))];
  }

  /** Download (if needed) and load one language. */
  private prepare(lang: string): Promise<void> {
    let p = this.prepared.get(lang);
    if (!p) {
      p = (async () => {
        await this.platform.store.ensure(await this.filesFor(lang));
        const entry = this.config.languages[lang];
        await Promise.all([
          this.synth.prepare(modelFiles(entry)[this.weights] as string),
          this.pack(lang),
          // English's lexicons and tagger take a few seconds to load on a phone:
          // better in create() than in the first generate().
          this.frontend.ready(lang),
        ]);
      })();
      p.catch(() => this.prepared.delete(lang));
      this.prepared.set(lang, p);
    }
    return p;
  }

  private pack(lang: string): Promise<VoiceEmbeddings> {
    const file = this.config.languages[lang].voices;
    let p = this.packs.get(file);
    if (!p) {
      p = this.platform.store.bytes(this.modelKey(file)).then(b => loadNPZData(b, file));
      p.catch(() => this.packs.delete(file));
      this.packs.set(file, p);
    }
    return p;
  }

  private loadEnglish(vocabV1: ReadonlySet<string>) {
    const store = this.platform.store;
    const g2pDir = this.config.g2p_dir ?? 'g2p';
    const key = (name: string) => (name.startsWith('g2p/')
      ? this.modelKey(name.replace(/^g2p\//, `${g2pDir}/`))
      : `${TEXT_DIR}/${name}`);
    return loadEnglishG2P(
      {
        text: name => store.text(key(name)),
        bytes: name => store.bytes(key(name)),
        filePath: store.filePath ? name => store.filePath?.(key(name)) ?? Promise.resolve(undefined) : undefined,
      },
      this.platform.ort,
      vocabV1,
    );
  }

  private japanese: Promise<JapaneseG2P> | null = null;

  private loadJapanese(): Promise<JapaneseG2P> {
    this.japanese ??= (async () => {
      const { JapaneseG2P, JAPANESE_DATA_FILES } = await import('./frontend/japanese/JapaneseG2P');
      const files: Record<string, Uint8Array> = {};
      // JapaneseG2P keeps views on these arrays (no copies): they belong to it from here.
      for (const f of JAPANESE_DATA_FILES) files[f] = await this.platform.store.bytes(`${TEXT_DIR}/${f}`);
      return JapaneseG2P.create(files);
    })();
    this.japanese.catch(() => { this.japanese = null; });
    return this.japanese;
  }

  private loadEspeak(lang: string): Promise<EspeakG2P> {
    const files = async (l: string) => {
      const { espeakDataFilesFor } = await import('./frontend/espeak/EspeakG2P');
      const out: Record<string, Uint8Array> = {};
      for (const f of espeakDataFilesFor(l)) out[f] = await this.platform.store.bytes(`${TEXT_DIR}/espeak-ng-data/${f}`);
      return out;
    };
    const prev = this.espeak;
    const next = (async () => {
      const { EspeakG2P } = await import('./frontend/espeak/EspeakG2P');
      const existing = prev ? await prev.catch(() => null) : null;
      if (existing) {
        if (!existing.hasLanguage(lang)) existing.addFiles(await files(lang));
        return existing;
      }
      return EspeakG2P.create(await files(lang));
    })();
    this.espeak = next;
    return next;
  }

  private audioOutput(): Promise<AudioOutput> {
    this.audio ??= import('../audio/AudioOutput').then(m => new m.AudioOutput(this.options.player));
    return this.audio;
  }

  private ensureOpen(): void {
    if (this.disposed) throw KittenTTSError.engineNotReady();
  }
}

function withToken(request: AssetRequest, token?: string): AssetRequest {
  if (!token || !/^https:\/\/huggingface\.co\//.test(request.url)) return request;
  return { ...request, headers: { Authorization: `Bearer ${token}` } };
}

function normalizeOptions(v?: string | KittenTTS2TinyGenerateOptions, speed?: number): KittenTTS2TinyGenerateOptions {
  if (typeof v === 'string') return { voice: v, speed };
  return { ...(v ?? {}), ...(speed !== undefined ? { speed } : {}) };
}
