import { KittenTTSResult } from '../KittenTTSResult';
import { KittenAPIError, KittenTTSError, KittenTTSErrorCode } from '../KittenTTSError';
import {
  type AbortSignalLike,
  KittenAPI,
  type KittenAPIOptions,
  type OpenResponse,
  type UploadFile,
  blobBytes,
} from './KittenAPI';
import { PCM16Decoder, QuietSplitter, decodePCM16 } from './pcm';

/** Kitten TTS 2 audio is 24 kHz mono. */
const SAMPLE_RATE = 24_000;
// The API's ID for the newest Kitten TTS 2; 'kitten-tts-2' is this SDK's name for it.
const LATEST_MODEL = 'kitten-tts-2-latest';
// Saved voices travel as {"id": ...}; the API refuses a bare saved-voice ID.
const SAVED_VOICE_PREFIX = 'voice_';

/**
 * `'kitten-tts-2'` for the newest Kitten TTS 2, or a Kitten TTS 2 model ID the
 * API lists, such as `'kitten-tts-2-latest'`.
 */
export type KittenTTS2Model = `kitten-tts-2${string}`;

/** Options shared by every platform's `KittenTTS2.create()`. */
export interface KittenTTS2Options extends KittenAPIOptions {
  model: KittenTTS2Model;
  /** Voice used when a call names none. Defaults to the API's own default voice. */
  defaultVoice?: string;
  /** Speed used when a call names none, from 0.25 to 4.0. Defaults to 1.0. */
  speed?: number;
}

/** Decoding presets: `stable` for steadier delivery, `expressive` for more variation. */
export type KittenTTS2Preset = 'stable' | 'expressive';

/**
 * A recording to clone a voice from, 5 to 30 seconds of one speaker: a file
 * path or URI (`file://`, `content://`, or in a browser `blob:` or https), a
 * `{ uri, name?, type? }` object, a Blob or File, or the bytes themselves.
 */
export type KittenReferenceAudio =
  | string
  | { uri: string; name?: string; type?: string }
  | Uint8Array
  | ArrayBuffer
  | { arrayBuffer(): Promise<ArrayBuffer>; name?: string; type?: string }
  | { size: number; type?: string };

/** Per-call options for `generate()`, `generateStreaming()` and `speak()`. */
export interface KittenTTS2GenerateOptions {
  /**
   * A voice ID from `availableVoices`, such as `'bella_en'`, or a saved
   * voice's `'voice_...'` ID. Give either this or `reference`.
   */
  voice?: string;
  /** A recording to clone the voice from, for this call only. */
  reference?: KittenReferenceAudio;
  /** What the reference recording says. Transcribed by the API when omitted. */
  referenceText?: string;
  /** Decoding preset. Defaults to the API's default, `expressive`. */
  preset?: KittenTTS2Preset | (string & {});
  /** Speed from 0.25 to 4.0. */
  speed?: number;
  /**
   * Read numbers, dates and currencies as words: `true` or `'basic'` (the
   * default), `'smart'` for context-aware readings, `false` or `'no'` to turn it off.
   */
  normalize?: boolean | 'basic' | 'smart' | 'no';
  /** Override the preset's sampling temperature, 0.3 to 2.0. */
  temperature?: number;
  /** Override the preset's top-k, 0 to 200 (0 turns it off). */
  topK?: number;
  /** Override the preset's top-p, 0.5 to 1.0. */
  topP?: number;
  /** Override the preset's min-p, 0 to 0.5. */
  minP?: number;
  /** Upper limit on audio tokens per text segment, 500 to 12000; 25 tokens is about a second. */
  maxNewTokens?: number;
  /** Cancels the request. */
  signal?: AbortSignalLike;
}

/** A voice the Kitten API offers to this account. */
export interface KittenTTS2Voice {
  /** Pass this as `voice`. */
  id: string;
  /** Display name, such as `'Frank — Reserved Announcer'`. */
  name: string;
  /** ISO 639-1 code of the language it speaks, such as `'en'`. */
  language: string;
  /** `'public'` for a built-in voice, `'custom'` for one your organization saved. */
  type: string;
  experimental: boolean;
}

/** What differs between React Native and the browser. */
export interface KittenTTS2Platform {
  audioOutput: {
    play(samples: Float32Array, sampleRate: number, options?: { onPlaybackStart?: () => void }): Promise<void>;
    stop(): Promise<void>;
  };
  readFile(uri: string): Promise<Uint8Array>;
}

/** Everything `create()` prepares before the instance exists. */
export interface KittenTTS2State {
  api: KittenAPI;
  model: string;
  voices: KittenTTS2Voice[];
  defaults: { voice?: string; speed?: number };
  platform: KittenTTS2Platform;
}

interface Call {
  text: string;
  voice: string;
  speed?: number;
  fields: Record<string, unknown>;
  reference?: KittenReferenceAudio;
  referenceText?: string;
  signal?: AbortSignalLike;
}

/**
 * Kitten TTS 2 through the Kitten API. The same calls as an on-device
 * `KittenTTS`, plus voice cloning, presets and the decoding controls.
 * Created with `KittenTTS.create({ model: 'kitten-tts-2', apiKey })`.
 */
export class KittenTTS2Base {
  /** The model ID requests are sent with, such as `'kitten-tts-2-latest'`. */
  readonly model: string;
  /** Sample rate of every result: 24,000 Hz. */
  readonly sampleRate = SAMPLE_RATE;
  /**
   * The voices this account can use: every built-in voice and the newest 100
   * saved ones. Older saved voices still work when passed by ID.
   */
  readonly voices: readonly KittenTTS2Voice[];

  private readonly api: KittenAPI;
  private readonly defaults: { voice?: string; speed?: number };
  private readonly platform: KittenTTS2Platform;
  private disposed = false;

  protected constructor(state: KittenTTS2State) {
    this.api = state.api;
    this.model = state.model;
    this.voices = Object.freeze(state.voices.map(voice => Object.freeze({ ...voice })));
    this.defaults = state.defaults;
    this.platform = state.platform;
  }

  /** IDs accepted by `voice`, as listed by the API when this instance was created. */
  get availableVoices(): string[] {
    return this.voices.map(voice => voice.id);
  }

  /** Connect to the API and list the voices. Shared by each platform's `create()`. */
  protected static async connect(
    options: KittenTTS2Options,
    platform: KittenTTS2Platform,
  ): Promise<KittenTTS2State> {
    if (!isKittenTTS2Model(options?.model)) {
      throw KittenTTSError.invalidArgument("model must be 'kitten-tts-2' or another Kitten TTS 2 model ID.");
    }
    if (options.defaultVoice !== undefined) checkVoice(options.defaultVoice, 'defaultVoice');
    const api = new KittenAPI(options);
    const model = options.model === 'kitten-tts-2' ? LATEST_MODEL : options.model;
    return {
      api,
      model,
      voices: await listVoices(api, model),
      defaults: { voice: options.defaultVoice?.trim(), speed: options.speed },
      platform,
    };
  }

  /**
   * Synthesise speech and return it once complete, at the API's best quality.
   *
   * @example
   * ```typescript
   * await tts.generate('Hello.', 'bella_en');
   * await tts.generate('Hello.', { voice: 'bella_en', preset: 'stable' });
   * await tts.generate('Hello.', { reference: recordingUri });
   * ```
   */
  generate(text: string, voice?: string, speed?: number): Promise<KittenTTSResult<string>>;
  generate(text: string, options?: KittenTTS2GenerateOptions): Promise<KittenTTSResult<string>>;
  async generate(
    text: string,
    voiceOrOptions?: string | KittenTTS2GenerateOptions,
    speed?: number,
  ): Promise<KittenTTSResult<string>> {
    return this.complete(this.prepare(text, voiceOrOptions, speed));
  }

  /**
   * Synthesise speech and yield it while it is still being generated, cut at
   * pauses so each chunk can be played on its own.
   *
   * @example
   * ```typescript
   * for await (const chunk of tts.generateStreaming(longText, 'bella_en')) {
   *   await tts.play(chunk);
   * }
   * ```
   */
  generateStreaming(
    text: string,
    voice?: string,
    speed?: number,
  ): AsyncGenerator<KittenTTSResult<string>, void, void>;
  generateStreaming(
    text: string,
    options?: KittenTTS2GenerateOptions,
  ): AsyncGenerator<KittenTTSResult<string>, void, void>;
  async *generateStreaming(
    text: string,
    voiceOrOptions?: string | KittenTTS2GenerateOptions,
    speed?: number,
  ): AsyncGenerator<KittenTTSResult<string>, void, void> {
    const call = this.prepare(text, voiceOrOptions, speed);
    const open = await this.send(call, true);
    // A stream may run for as long as the audio does; only the wait for its start is timed.
    open.clearTimeout();
    const decoder = new PCM16Decoder();
    const splitter = new QuietSplitter(SAMPLE_RATE);
    let yielded = false;
    try {
      checkIsAudio(open);
      for await (const bytes of this.api.readChunks(open.response)) {
        for (const samples of splitter.push(decoder.push(bytes))) {
          yielded = true;
          yield this.result(samples, call);
        }
      }
      const rest = splitter.flush();
      if (rest) {
        yielded = true;
        yield this.result(rest, call);
      }
      if (!yielded) throw KittenTTSError.emptyOutput();
    } catch (error) {
      throw open.failure(error);
    } finally {
      open.release();
    }
  }

  /** Synthesise speech and play it through the configured player. */
  speak(text: string, voice?: string, speed?: number): Promise<KittenTTSResult<string>>;
  speak(text: string, options?: KittenTTS2GenerateOptions): Promise<KittenTTSResult<string>>;
  async speak(
    text: string,
    voiceOrOptions?: string | KittenTTS2GenerateOptions,
    speed?: number,
  ): Promise<KittenTTSResult<string>> {
    const result = await this.complete(this.prepare(text, voiceOrOptions, speed));
    await this.play(result);
    return result;
  }

  /** Play a previously generated result. */
  async play(
    result: KittenTTSResult<string>,
    options: { onPlaybackStart?: () => void } = {},
  ): Promise<void> {
    if (this.disposed) throw KittenTTSError.engineNotReady();
    await this.platform.audioOutput.play(result.samples, result.sampleRate, options);
  }

  /** Stop any currently active audio playback. */
  async stopSpeaking(): Promise<void> {
    await this.platform.audioOutput.stop();
  }

  /** Cancel requests in flight and stop playback. The instance cannot be used afterwards. */
  async dispose(): Promise<void> {
    this.disposed = true;
    this.api.close();
    await this.platform.audioOutput.stop().catch(() => {});
  }

  private prepare(
    text: string,
    voiceOrOptions: string | KittenTTS2GenerateOptions | undefined,
    speed: number | undefined,
  ): Call {
    if (this.disposed) throw KittenTTSError.engineNotReady();
    if (typeof text !== 'string') throw KittenTTSError.invalidArgument('text must be a string.');
    const trimmed = text.trim();
    if (!trimmed) throw KittenTTSError.emptyInput();

    const options: KittenTTS2GenerateOptions =
      typeof voiceOrOptions === 'string' || voiceOrOptions === undefined
        ? { voice: voiceOrOptions, speed }
        : voiceOrOptions;
    if (options.voice !== undefined) checkVoice(options.voice, 'voice');
    if (options.voice !== undefined && options.reference !== undefined) {
      throw KittenTTSError.invalidArgument('Pass either voice or reference, not both.');
    }
    if (options.referenceText !== undefined && options.reference === undefined) {
      throw KittenTTSError.invalidArgument('referenceText only applies together with reference.');
    }

    const voice = options.reference === undefined ? options.voice?.trim() ?? this.defaults.voice : undefined;
    const selectedSpeed = options.speed ?? this.defaults.speed;
    const fields: Record<string, unknown> = { model: this.model, input: trimmed, response_format: 'pcm' };
    if (voice !== undefined) fields.voice = voice.startsWith(SAVED_VOICE_PREFIX) ? { id: voice } : voice;
    if (selectedSpeed !== undefined) fields.speed = selectedSpeed;
    if (options.normalize !== undefined) {
      fields.normalize = typeof options.normalize === 'boolean'
        ? (options.normalize ? 'basic' : 'no')
        : options.normalize;
    }
    if (options.preset !== undefined) fields.mode = options.preset;
    if (options.temperature !== undefined) fields.temperature = options.temperature;
    if (options.topK !== undefined) fields.top_k = options.topK;
    if (options.topP !== undefined) fields.top_p = options.topP;
    if (options.minP !== undefined) fields.min_p = options.minP;
    if (options.maxNewTokens !== undefined) fields.max_new_tokens = options.maxNewTokens;

    return {
      text: trimmed,
      voice: voice ?? '',
      speed: selectedSpeed,
      fields,
      reference: options.reference,
      referenceText: options.referenceText,
      signal: options.signal,
    };
  }

  private async complete(call: Call): Promise<KittenTTSResult<string>> {
    const open = await this.send(call, false);
    try {
      checkIsAudio(open);
      // Complete audio stops at 30 minutes; the API then sends what fits and says so.
      if (open.response.headers.get('x-kittenml-audio-limit-reached') === '1') {
        throw new KittenAPIError(
          KittenTTSErrorCode.ApiError,
          'The text runs past the 30 minutes of audio generate() can return. ' +
          'Use generateStreaming(), or split the text.',
          { status: open.response.status, apiCode: 'audio_limit_reached', requestId: open.requestId },
        );
      }
      const samples = decodePCM16(await this.api.readBytes(open.response));
      if (samples.length === 0) throw KittenTTSError.emptyOutput();
      return this.result(samples, call);
    } catch (error) {
      throw open.failure(error);
    } finally {
      open.release();
    }
  }

  private async send(call: Call, stream: boolean): Promise<OpenResponse> {
    // Complete audio comes from the API's higher-quality path, which waits for
    // the whole text: there is nothing to gain from streaming what is buffered anyway.
    const fields = stream ? call.fields : { ...call.fields, stream: false };
    if (call.reference === undefined) {
      return this.api.open('/audio/speech', { method: 'POST', json: fields }, call.signal);
    }

    const form: Record<string, string> = {};
    for (const [name, value] of Object.entries(fields)) form[name] = String(value);
    if (call.referenceText !== undefined) form.reference_transcript = call.referenceText;
    const file = await this.readReference(call.reference);
    return this.api.open(
      '/audio/speech',
      { method: 'POST', form: { fields: form, fileField: 'reference_audio', file } },
      call.signal,
    );
  }

  private result(samples: Float32Array, call: Call): KittenTTSResult<string> {
    return new KittenTTSResult<string>(samples, SAMPLE_RATE, call.voice, call.speed ?? 1, call.text, []);
  }

  private async readReference(reference: KittenReferenceAudio): Promise<UploadFile> {
    let bytes: Uint8Array;
    let name: string | undefined;
    let type: string | undefined;

    const read = async (uri: string) => {
      try {
        return await this.platform.readFile(uri);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new KittenTTSError(
          KittenTTSErrorCode.InvalidArgument,
          `Could not read the reference audio at ${uri}: ${reason}`,
          error,
        );
      }
    };

    if (typeof reference === 'string') {
      bytes = await read(reference);
      name = fileNameFromUri(reference);
    } else if (reference instanceof Uint8Array) {
      bytes = reference;
    } else if (reference instanceof ArrayBuffer) {
      bytes = new Uint8Array(reference);
    } else if (typeof reference === 'object' && reference !== null) {
      const source = reference as { uri?: unknown; arrayBuffer?: unknown; size?: unknown; name?: unknown; type?: unknown };
      if (typeof source.uri === 'string') {
        bytes = await read(source.uri);
        name = fileNameFromUri(source.uri);
      } else if (typeof source.arrayBuffer === 'function') {
        bytes = new Uint8Array(await (source as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer());
      } else if (typeof source.size === 'number') {
        bytes = await blobBytes(reference); // React Native's Blob has no arrayBuffer().
      } else {
        throw unsupportedReference();
      }
      if (typeof source.name === 'string' && source.name) name = source.name;
      if (typeof source.type === 'string' && source.type) type = source.type;
    } else {
      throw unsupportedReference();
    }

    if (bytes.byteLength === 0) throw KittenTTSError.invalidArgument('The reference audio is empty.');
    name = name ?? `reference.${sniffExtension(bytes)}`;
    type = type ?? UPLOAD_TYPES[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
    return { bytes, name, type };
  }
}

/** Whether `KittenTTS.create()` options select Kitten TTS 2 through the API. */
export function isKittenTTS2Model(model: unknown): model is KittenTTS2Model {
  return typeof model === 'string' && /^kitten-tts-2(?:$|-)/.test(model);
}

function checkVoice(voice: unknown, name: string): void {
  if (typeof voice !== 'string' || !voice.trim()) {
    throw KittenTTSError.invalidArgument(
      `${name} must be a voice ID such as 'bella_en', or a saved voice ID such as 'voice_...'.`,
    );
  }
}

/** A 200 that is not audio, from a proxy's error page say, must not be played as noise. */
function checkIsAudio(open: OpenResponse): void {
  const type = open.response.headers.get('content-type') ?? '';
  if (/json|html|text\//i.test(type)) {
    throw new KittenAPIError(
      KittenTTSErrorCode.ApiError,
      `The Kitten API returned ${type.split(';')[0]} instead of audio.`,
      { status: open.response.status, requestId: open.requestId },
    );
  }
}

/**
 * One page: the newest 100 saved voices, then every built-in voice. Each page
 * takes seconds to list, so older saved voices are left to be passed by ID.
 */
async function listVoices(api: KittenAPI, model: string): Promise<KittenTTS2Voice[]> {
  const payload = await api.getJson(`/voices?model=${encodeURIComponent(model)}&limit=100`);
  const voices = new Map<string, KittenTTS2Voice>();
  for (const item of Array.isArray(payload.data) ? payload.data : []) {
    const voice = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    if (typeof voice.id !== 'string' || !voice.id || voices.has(voice.id)) continue;
    voices.set(voice.id, {
      id: voice.id,
      name: typeof voice.name === 'string' ? voice.name : voice.id,
      language: typeof voice.language === 'string' ? voice.language : '',
      type: typeof voice.type === 'string' ? voice.type : '',
      experimental: voice.experimental === true,
    });
  }
  return [...voices.values()];
}

const UPLOAD_TYPES: Record<string, string> = {
  aac: 'audio/aac',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  mp4: 'audio/mp4',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  webm: 'audio/webm',
};

function unsupportedReference(): KittenTTSError {
  return KittenTTSError.invalidArgument(
    'reference must be a file path or URI, { uri }, a Blob or File, a Uint8Array or an ArrayBuffer.',
  );
}

function fileNameFromUri(uri: string): string | undefined {
  const segment = uri.split(/[\\/]/).pop()?.split(/[?#]/)[0];
  if (!segment || !/\.[a-z0-9]{2,4}$/i.test(segment)) return undefined;
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment; // A literal "%" that is not an escape.
  }
}

/** The API's decoder leans on the extension, so unnamed bytes are named after their container. */
function sniffExtension(bytes: Uint8Array): string {
  const starts = (...codes: number[]) => codes.every((code, index) => bytes[index] === code);
  if (starts(0x52, 0x49, 0x46, 0x46)) return 'wav';
  if (starts(0x49, 0x44, 0x33) || bytes[0] === 0xff) return 'mp3';
  if (starts(0x66, 0x4c, 0x61, 0x43)) return 'flac';
  if (starts(0x4f, 0x67, 0x67, 0x53)) return 'ogg';
  if (starts(0x1a, 0x45, 0xdf, 0xa3)) return 'webm';
  if (bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) return 'm4a';
  return 'wav';
}
