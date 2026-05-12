import type * as Ort from 'onnxruntime-web';
import {
  KittenTTSError,
  errorMessage,
  isKittenTTSError,
} from '../KittenTTSError';
import { KittenVoice } from '../KittenVoice';
import { speedPrior } from '../KittenModel';
import { OUTPUT_SAMPLE_RATE, type ResolvedKittenTTSConfig } from '../KittenTTSConfig.web';
import { preprocess } from './TextPreprocessor';
import * as TextCleaner from './TextCleaner';
import type { VoiceEmbeddings } from '../loader/NPZLoader.web';

export interface TTSEngineOutput {
  /** Raw Float32 PCM samples at 24 kHz. */
  samples: Float32Array;

  /** Predicted frame count per input token, including wrapper tokens. */
  durations: number[];

  /** IPA phoneme string returned by the phonemizer. */
  phonemes: string;
}

type OrtRuntime = typeof Ort;

type BrowserDocument = {
  createElement(tagName: 'script'): {
    async: boolean;
    src: string;
    onload: (() => void) | null;
    onerror: (() => void) | null;
  };
  head: {
    appendChild(element: unknown): void;
  };
};

const DEFAULT_ORT_WEB_VERSION = '1.26.0';

let browserOrtPromise: Promise<OrtRuntime> | undefined;

/**
 * Internal ONNX inference engine.
 *
 * Orchestrates: text -> TextPreprocessor -> Phonemizer -> TextCleaner -> ONNX -> Float32 PCM
 */
export class TTSEngine {
  private ort: OrtRuntime;
  private session: Ort.InferenceSession;
  private voices: VoiceEmbeddings;
  private config: ResolvedKittenTTSConfig;
  private waveformOutputName: string | undefined;
  private durationOutputName: string | undefined;
  private disposed = false;

  private constructor(
    ortRuntime: OrtRuntime,
    session: Ort.InferenceSession,
    voices: VoiceEmbeddings,
    config: ResolvedKittenTTSConfig,
    waveformOutputName: string | undefined,
    durationOutputName: string | undefined,
  ) {
    this.ort = ortRuntime;
    this.session = session;
    this.voices = voices;
    this.config = config;
    this.waveformOutputName = waveformOutputName;
    this.durationOutputName = durationOutputName;
  }

  /**
   * Create a new TTSEngine by loading the ONNX model and voice embeddings.
   */
  static async create(
    model: string | Uint8Array,
    voices: VoiceEmbeddings,
    config: ResolvedKittenTTSConfig,
  ): Promise<TTSEngine> {
    try {
      const ort = await loadOnnxRuntime(config);
      await configureOnnxRuntime(ort, config);
      const sessionOptions = {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
        intraOpNumThreads: config.ortNumThreads,
      } as const;
      const session = await ort.InferenceSession.create(
        model as Uint8Array,
        sessionOptions,
      );
      const outputNames = session.outputNames ?? [];
      const waveformOutputName = outputNames.includes('waveform')
        ? 'waveform'
        : outputNames[0];
      const durationOutputName = outputNames.includes('duration')
        ? 'duration'
        : undefined;
      return new TTSEngine(
        ort,
        session,
        voices,
        config,
        waveformOutputName,
        durationOutputName,
      );
    } catch (error) {
      throw KittenTTSError.inferenceFailed(
        `Could not initialise ONNX Runtime: ${errorMessage(error)}`,
        error,
      );
    }
  }

  /**
   * Synthesise speech and return PCM samples plus optional timing metadata.
   */
  async generate(
    text: string,
    voice: KittenVoice,
    speed: number,
  ): Promise<TTSEngineOutput> {
    if (this.disposed) throw KittenTTSError.engineNotReady();

    const embedding = this.voices[voice];
    if (!embedding) {
      throw KittenTTSError.noVoiceEmbedding(voice);
    }

    const normalised = preprocess(text);
    if (!normalised) throw KittenTTSError.emptyInput();

    let phonemes: string;
    try {
      phonemes = await this.config.phonemizer.phonemize(normalised);
    } catch (error) {
      if (isKittenTTSError(error)) throw error;
      throw KittenTTSError.phonemizerFailed(errorMessage(error), error);
    }

    try {
      const tokens = TextCleaner.encode(phonemes);
      const chunks = this.splitIntoChunks(tokens);
      const effectiveSpeed = speed * speedPrior(this.config.model, voice);
      const singleChunk = chunks.length === 1;

      const allChunks: Float32Array[] = [];
      let durations: number[] = [];
      for (const chunk of chunks) {
        const chunkTextLength = Math.max(0, chunk.length - 3);
        const output = await this.runChunk(
          chunk,
          embedding,
          chunkTextLength,
          effectiveSpeed,
        );
        allChunks.push(output.samples);
        if (singleChunk) {
          durations = output.durations;
        }
      }

      // Concatenate all chunks
      const totalLength = allChunks.reduce((sum, c) => sum + c.length, 0);
      if (totalLength === 0) throw KittenTTSError.emptyOutput();

      const result = new Float32Array(totalLength);
      let offset = 0;
      for (const chunk of allChunks) {
        result.set(chunk, offset);
        offset += chunk.length;
      }
      return { samples: result, durations, phonemes };
    } catch (error) {
      if (isKittenTTSError(error)) throw error;
      throw KittenTTSError.inferenceFailed(errorMessage(error), error);
    }
  }

  private async runChunk(
    tokens: number[],
    embedding: { rows: number; cols: number; data: Float32Array },
    phonemeLength: number,
    speed: number,
  ): Promise<{ samples: Float32Array; durations: number[] }> {
    // Get style vector for this text length
    const rowIdx = Math.min(phonemeLength, embedding.rows - 1);
    const styleVec = embedding.data.slice(
      rowIdx * embedding.cols,
      (rowIdx + 1) * embedding.cols,
    );

    // Create tensors
    const inputIds = new this.ort.Tensor(
      'int64',
      BigInt64Array.from(tokens.map(t => BigInt(t))),
      [1, tokens.length],
    );
    const styleTensor = new this.ort.Tensor('float32', styleVec, [1, styleVec.length]);
    const speedTensor = new this.ort.Tensor('float32', Float32Array.of(speed), [1]);

    const feeds = {
      input_ids: inputIds,
      style: styleTensor,
      speed: speedTensor,
    };
    const fetches = this.createOutputFetches();
    const results = fetches
      ? await this.session.run(feeds, fetches)
      : await this.session.run(feeds);

    const outputKey = this.resolveWaveformOutputKey(results);
    if (!outputKey) throw KittenTTSError.emptyOutput();

    const outputTensor = results[outputKey];
    const samples = outputTensor.data as Float32Array;
    if (samples.length === 0) throw KittenTTSError.emptyOutput();

    return {
      samples: this.trimTrailingSilence(samples),
      durations: this.readDurations(results, outputKey),
    };
  }

  private createOutputFetches(): Record<string, null> | undefined {
    const outputNames = [
      this.waveformOutputName,
      this.durationOutputName,
    ].filter((name): name is string => Boolean(name));

    if (outputNames.length === 0) return undefined;
    return Object.fromEntries(outputNames.map(name => [name, null]));
  }

  private resolveWaveformOutputKey(
    results: Awaited<ReturnType<Ort.InferenceSession['run']>>,
  ): string | undefined {
    if (this.waveformOutputName && results[this.waveformOutputName]) {
      return this.waveformOutputName;
    }

    const keys = Object.keys(results);
    return (
      keys.find(key => results[key].data instanceof Float32Array) ??
      keys.find(key => key !== this.durationOutputName) ??
      keys[0]
    );
  }

  private readDurations(
    results: Awaited<ReturnType<Ort.InferenceSession['run']>>,
    waveformOutputKey: string,
  ): number[] {
    const durationKey =
      this.durationOutputName && results[this.durationOutputName]
        ? this.durationOutputName
        : Object.keys(results).find(key => {
          if (key === waveformOutputKey) return false;
          const data = results[key].data;
          return (
            data instanceof BigInt64Array ||
            data instanceof BigUint64Array ||
            data instanceof Int32Array ||
            data instanceof Uint32Array
          );
        });

    if (!durationKey) return [];

    const durationTensor = results[durationKey];
    if (!durationTensor) return [];

    return Array.from(durationTensor.data as ArrayLike<number | bigint>, value =>
      typeof value === 'bigint' ? Number(value) : value,
    );
  }

  private trimTrailingSilence(samples: Float32Array): Float32Array {
    if (!this.config.trimTrailingSilence || samples.length === 0) {
      return samples;
    }

    const maxTrimSamples = Math.min(
      samples.length,
      Math.round((this.config.maxSilenceTrimMs / 1000) * OUTPUT_SAMPLE_RATE),
    );
    const threshold = this.config.silenceThreshold;
    let trimCount = 0;

    while (
      trimCount < maxTrimSamples &&
      Math.abs(samples[samples.length - 1 - trimCount]) <= threshold
    ) {
      trimCount += 1;
    }

    if (trimCount === 0 || trimCount >= samples.length) {
      return samples;
    }
    return samples.slice(0, samples.length - trimCount);
  }

  private splitIntoChunks(tokens: number[]): number[][] {
    // Strip the start/end/pad wrapper tokens to get the body
    const body = tokens.slice(1, tokens.length - 2);
    const maxBody = this.config.maxTokensPerChunk - 3;

    if (body.length <= maxBody) return [tokens];

    const chunks: number[][] = [];
    for (let i = 0; i < body.length; i += maxBody) {
      const slice = body.slice(i, Math.min(i + maxBody, body.length));
      chunks.push([
        TextCleaner.START_TOKEN_ID,
        ...slice,
        TextCleaner.END_TOKEN_ID,
        TextCleaner.PAD_TOKEN_ID,
      ]);
    }
    return chunks;
  }

  /** Release the ONNX session. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    await this.session.release().catch(() => {});
  }
}

async function loadOnnxRuntime(config: ResolvedKittenTTSConfig): Promise<OrtRuntime> {
  if (!isBrowserRuntime()) {
    const importModule = new Function(
      'specifier',
      'return import(specifier)',
    ) as (specifier: string) => Promise<OrtRuntime>;
    return importModule('onnxruntime-web/wasm');
  }

  const scope = globalThis as {
    document?: BrowserDocument;
    ort?: OrtRuntime;
  };

  if (scope.ort?.InferenceSession) return scope.ort;
  if (!scope.document) {
    throw new Error('Browser ONNX Runtime requires a document to load its script.');
  }

  if (!browserOrtPromise) {
    browserOrtPromise = new Promise<OrtRuntime>((resolve, reject) => {
      const script = scope.document!.createElement('script');
      script.async = true;
      script.src = defaultOrtScriptURL(config);
      script.onload = () => {
        if (scope.ort?.InferenceSession) {
          resolve(scope.ort);
        } else {
          reject(new Error('ONNX Runtime script loaded without exposing globalThis.ort.'));
        }
      };
      script.onerror = () => {
        reject(new Error(`Failed to load ONNX Runtime script: ${script.src}`));
      };
      scope.document!.head.appendChild(script);
    });
  }

  return browserOrtPromise;
}

async function configureOnnxRuntime(
  ort: OrtRuntime,
  config: ResolvedKittenTTSConfig,
): Promise<void> {
  if (config.ortWasmPath === false) return;
  if (ort.env.wasm.wasmBinary || ort.env.wasm.wasmPaths) return;

  if (typeof config.ortWasmPath === 'string') {
    ort.env.wasm.wasmPaths = normalizeWasmDirectory(config.ortWasmPath);
    return;
  }

  if (config.ortWasmPath) {
    ort.env.wasm.wasmPaths = config.ortWasmPath;
    return;
  }

  if (!isBrowserRuntime()) {
    await configureNodeOnnxRuntime(ort);
    return;
  }

  ort.env.wasm.wasmPaths = {
    wasm: `${defaultOrtWasmBaseURL()}ort-wasm-simd-threaded.wasm`,
  };
}

async function configureNodeOnnxRuntime(ort: OrtRuntime): Promise<void> {
  const [{ readFile }, { createRequire }] = await Promise.all([
    import('node:fs/promises'),
    import('node:module'),
  ]);
  const require = createRequire(__filename);
  const wasmPath = require.resolve('onnxruntime-web/ort-wasm-simd-threaded.wasm');
  ort.env.wasm.wasmBinary = await readFile(wasmPath);
  ort.env.wasm.numThreads = 1;
}

function defaultOrtWasmBaseURL(): string {
  return `https://cdn.jsdelivr.net/npm/onnxruntime-web@${DEFAULT_ORT_WEB_VERSION}/dist/`;
}

function defaultOrtScriptURL(config: ResolvedKittenTTSConfig): string {
  if (typeof config.ortWasmPath === 'string') {
    return `${normalizeWasmDirectory(config.ortWasmPath)}ort.wasm.min.js`;
  }
  return `${defaultOrtWasmBaseURL()}ort.wasm.min.js`;
}

function normalizeWasmDirectory(path: string): string {
  return path.endsWith('/') ? path : `${path}/`;
}

function isBrowserRuntime(): boolean {
  const scope = globalThis as {
    window?: unknown;
    self?: unknown;
    process?: { versions?: { node?: string } };
  };
  return (
    typeof scope.window !== 'undefined' ||
    (typeof scope.self !== 'undefined' && typeof scope.process?.versions?.node === 'undefined')
  );
}
