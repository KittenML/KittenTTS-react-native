import {
  KittenTTSConfig,
  OUTPUT_SAMPLE_RATE,
  type ResolvedKittenTTSConfig,
  resolveConfig,
} from './KittenTTSConfig';
import {
  KittenTTSError,
  KittenTTSErrorCode,
  isKittenTTSError,
} from './KittenTTSError';
import { KittenTTSResult } from './KittenTTSResult';
import { KittenModel, speedPrior } from './KittenModel';
import { KittenVoice } from './KittenVoice';
import type { KittenWordTiming } from './KittenWordTiming';
import { TTSEngine } from './engine/TTSEngine';
import { splitSentences } from './engine/SentenceSplitter';
import { joinTimestamps } from './engine/TimestampJoiner';
import { loadNPZ, loadNPZData } from './loader/NPZLoader';
import {
  clearModelCache as deleteCachedModel,
  getModelCacheInfo,
  getProvidedModelCacheInfo,
  isModelCached as checkModelCached,
  type ModelCacheInfo,
  type ModelPaths,
  type ProgressHandler,
  resolveModelPaths,
} from './loader/ModelDownloader';
import {
  AudioOutput,
  type AudioPlayer,
  type AudioPlayOptions,
} from './audio/AudioOutput';
import {
  KittenTTSAnalyticsClient,
  configureGlobalAnalytics,
  type KittenTTSAnalyticsAssetSource,
  type KittenTTSAnalyticsConfig,
  type KittenTTSAnalyticsPlaybackHelper,
} from './analytics/Analytics';

/** Options for {@link KittenTTS.create}. */
export interface KittenTTSCreateOptions extends KittenTTSConfig {
  /**
   * Delete cached model files and download fresh copies before initialising.
   * Useful after a failed/interrupted first-run setup.
   */
  forceRedownload?: boolean;

  /**
   * Audio player for the `speak()` and `play()` methods.
   *
   * Use {@link createRNSoundPlayer} or {@link createExpoAudioPlayer} to create one,
   * or provide your own implementation.
   *
   * @example
   * ```typescript
   * import Sound from 'react-native-sound';
   * import { KittenTTS, createRNSoundPlayer } from '@kittentts/react-native';
   *
   * const tts = await KittenTTS.create({
   *   player: createRNSoundPlayer(Sound),
   * });
   * await tts.speak('Hello!');
   * ```
   */
  player?: AudioPlayer;
}

/**
 * The KittenTTS speech-synthesis engine for React Native.
 *
 * Downloads the model on first use, initialises ONNX Runtime inference,
 * and exposes an async API for generating and playing speech.
 *
 * @example
 * ```typescript
 * import Sound from 'react-native-sound';
 * import { KittenTTS, createRNSoundPlayer } from '@kittentts/react-native';
 *
 * const tts = await KittenTTS.create({
 *   player: createRNSoundPlayer(Sound),
 * });
 *
 * // Generate audio
 * const result = await tts.generate('Hello from KittenTTS!');
 *
 * // Play through speakers
 * await tts.speak('Good morning!');
 * ```
 */
export class KittenTTS {
  /** The configuration this instance was created with. */
  readonly config: ResolvedKittenTTSConfig;

  private engine: TTSEngine;
  private audioOutput: AudioOutput;
  private analytics: KittenTTSAnalyticsClient;
  private disposed = false;
  private disposePromise: Promise<void> | null = null;

  private constructor(
    engine: TTSEngine,
    config: ResolvedKittenTTSConfig,
    analytics: KittenTTSAnalyticsClient,
    player?: AudioPlayer,
  ) {
    this.engine = engine;
    this.config = config;
    this.analytics = analytics;
    this.audioOutput = new AudioOutput(player);
  }

  /** Configure SDK analytics globally for future `KittenTTS.create()` calls. */
  static configureAnalytics(options: KittenTTSAnalyticsConfig): void {
    configureGlobalAnalytics(options);
  }

  /**
   * Create and initialise a KittenTTS instance.
   *
   * Downloads all required files if not cached, loads the ONNX model, and
   * prepares the engine for inference.
   *
   * @param options - Configuration and player for this session.
   * @param onProgress - Optional callback for download progress [0, 1].
   * @returns A ready-to-use KittenTTS instance.
   */
  static async create(
    options?: KittenTTSCreateOptions,
    onProgress?: ProgressHandler,
  ): Promise<KittenTTS> {
    const resolved = resolveConfig(options);
    const assetSource: KittenTTSAnalyticsAssetSource = resolved.modelFiles
      ? 'bundled'
      : 'runtime-download';
    const playbackHelper = resolvePlaybackHelper(options?.player);
    const analytics = new KittenTTSAnalyticsClient({
      analytics: resolved.analytics,
      storageDirectory: resolved.storageDirectory,
      model: resolved.model,
      defaultVoice: resolved.defaultVoice,
      playbackHelper,
      assetSource,
    });
    const hasPhonemizerDownload =
      typeof resolved.phonemizer.downloadIfNeeded === 'function';
    const setupProgress = createAggregateProgress(onProgress);
    const modelCacheHit = resolved.modelFiles || options?.forceRedownload
      ? false
      : await checkModelCached(resolved.model, resolved.storageDirectory);

    const phonemizerDownload = hasPhonemizerDownload
      ? resolved.phonemizer.downloadIfNeeded?.(
        resolved.storageDirectory,
        setupProgress,
      )
      : Promise.resolve();

    const modelDownload = resolveModelPaths(
      resolved.model,
      resolved.storageDirectory,
      setupProgress,
      {
        modelFiles: resolved.modelFiles,
        force: options?.forceRedownload ?? false,
        retries: resolved.downloadRetries,
        baseURL: resolved.modelBaseURL || undefined,
      },
    )
      .then((paths) => {
        analytics.track('model_download_succeeded', {
          assetSource: modelCacheHit ? 'cache' : assetSource,
          cacheHit: modelCacheHit,
        });
        return paths;
      })
      .catch((error) => {
        analytics.track('model_download_failed', {
          assetSource,
          errorCode: analyticsErrorCode(error),
        });
        throw error;
      });

    const [, downloadedPaths] = await Promise.all([
      phonemizerDownload,
      modelDownload,
    ]);
    setupProgress(1, { stage: 'complete' });

    let paths = downloadedPaths;
    const repairCache = async (): Promise<ModelPaths> => {
      await deleteCachedModel(resolved.model, resolved.storageDirectory);
      return resolveModelPaths(
        resolved.model,
        resolved.storageDirectory,
        setupProgress,
        {
          force: true,
          retries: resolved.downloadRetries,
          baseURL: resolved.modelBaseURL || undefined,
        },
      );
    };

    let voices = resolved.modelFiles
      ? await loadVoicesFromModelPaths(paths)
      : await loadVoicesWithCacheRepair(requireVoicesPath(paths), repairCache);
    let engine: TTSEngine;
    try {
      engine = await TTSEngine.create(resolveOnnxModelSource(paths), voices, resolved);
    } catch (error) {
      if (resolved.modelFiles || !isRepairableModelCacheError(error)) throw error;
      paths = await repairCache();
      voices = await loadNPZ(requireVoicesPath(paths));
      engine = await TTSEngine.create(resolveOnnxModelSource(paths), voices, resolved);
    }

    analytics.track('sdk_initialized', {
      assetSource: modelCacheHit ? 'cache' : assetSource,
      cacheHit: modelCacheHit,
    });

    return new KittenTTS(engine, resolved, analytics, options?.player);
  }

  /**
   * Synthesise speech for the given text.
   *
   * @param text - The English text to synthesise. Must not be empty.
   * @param voice - The voice to use. Defaults to the config's `defaultVoice`.
   * @param speed - Speed multiplier (0.5--2.0). Defaults to the config's `speed`.
   * @returns A {@link KittenTTSResult} containing PCM samples and metadata.
   */
  async generate(
    text: string,
    voice?: KittenVoice,
    speed?: number,
  ): Promise<KittenTTSResult> {
    if (this.disposed) throw KittenTTSError.engineNotReady();

    const trimmed = text.trim();
    if (!trimmed) throw KittenTTSError.emptyInput();

    const selectedVoice = voice ?? this.config.defaultVoice;
    const selectedSpeed = Math.min(Math.max(speed ?? this.config.speed, 0.5), 2.0);

    let output: Awaited<ReturnType<TTSEngine['generate']>>;
    try {
      output = await this.engine.generate(
        trimmed,
        selectedVoice,
        selectedSpeed,
      );
    } catch (error) {
      this.analytics.track('inference_failed', {
        voice: selectedVoice,
        errorCode: analyticsErrorCode(error),
      });
      throw error;
    }
    const effectiveSpeed = selectedSpeed * speedPrior(this.config.model, selectedVoice);
    const wordTimings = normalizeWordTimingsToDuration(
      joinTimestamps(trimmed, output.phonemes, output.durations),
      output.samples.length / OUTPUT_SAMPLE_RATE,
    );

    const result = new KittenTTSResult(
      output.samples,
      OUTPUT_SAMPLE_RATE,
      selectedVoice,
      effectiveSpeed,
      trimmed,
      wordTimings,
    );
    this.analytics.track('inference_succeeded', { voice: selectedVoice });
    return result;
  }

  /**
   * Synthesise speech sentence by sentence.
   *
   * This is the streaming counterpart to {@link generate}. It yields each
   * {@link KittenTTSResult} as soon as that sentence is ready, which lets apps
   * start playback before a long text has fully generated.
   */
  async *generateStreaming(
    text: string,
    voice?: KittenVoice,
    speed?: number,
  ): AsyncGenerator<KittenTTSResult, void, void> {
    if (this.disposed) throw KittenTTSError.engineNotReady();

    const trimmed = text.trim();
    if (!trimmed) throw KittenTTSError.emptyInput();

    const selectedVoice = voice ?? this.config.defaultVoice;
    const selectedSpeed = Math.min(Math.max(speed ?? this.config.speed, 0.5), 2.0);
    for (const sentence of splitSentences(trimmed)) {
      yield await this.generate(sentence, selectedVoice, selectedSpeed);
    }
  }

  /**
   * Synthesise and play speech through the device speakers.
   *
   * Requires an {@link AudioPlayer} to be passed via `KittenTTS.create({ player })`.
   *
   * @param text - The English text to synthesise.
   * @param voice - The voice to use.
   * @param speed - Speed multiplier (0.5--2.0).
   * @returns The generated {@link KittenTTSResult}.
   */
  async speak(
    text: string,
    voice?: KittenVoice,
    speed?: number,
  ): Promise<KittenTTSResult> {
    const result = await this.generate(text, voice, speed);
    await this.play(result);
    return result;
  }

  /**
   * Play a previously generated result.
   *
   * Use this when an app needs to inspect metadata such as `wordTimings` before
   * playback starts.
   */
  async play(
    result: KittenTTSResult,
    options: AudioPlayOptions = {},
  ): Promise<void> {
    if (this.disposed) throw KittenTTSError.engineNotReady();
    try {
      await this.audioOutput.play(result.samples, result.sampleRate, options);
    } catch (error) {
      this.analytics.track('playback_failed', {
        voice: result.voice,
        playbackHelper: this.audioOutput.getPlaybackHelper(),
        errorCode: analyticsErrorCode(error),
      });
      throw error;
    }
    this.analytics.track('voice_played', {
      voice: result.voice,
      playbackHelper: this.audioOutput.getPlaybackHelper(),
    });
  }

  /** Stop any currently active audio playback. */
  async stopSpeaking(): Promise<void> {
    await this.audioOutput.stop();
  }

  /** Check if the model files are already cached on disk. */
  static async isModelCached(config?: KittenTTSConfig): Promise<boolean> {
    const resolved = resolveConfig(config);
    if (resolved.modelFiles) {
      return (await getProvidedModelCacheInfo(
        resolved.model,
        resolved.modelFiles,
      )).isCached;
    }
    return checkModelCached(resolved.model, resolved.storageDirectory);
  }

  /** Detailed cache state for first-run UI. */
  static async getModelCacheInfo(
    config?: KittenTTSConfig,
  ): Promise<ModelCacheInfo> {
    const resolved = resolveConfig(config);
    if (resolved.modelFiles) {
      return getProvidedModelCacheInfo(resolved.model, resolved.modelFiles);
    }
    return getModelCacheInfo(resolved.model, resolved.storageDirectory);
  }

  /** Alias for `isModelCached()` with clearer app-facing wording. */
  static async isModelDownloaded(config?: KittenTTSConfig): Promise<boolean> {
    return KittenTTS.isModelCached(config);
  }

  /** Delete cached files for the selected model. */
  static async clearModelCache(config?: KittenTTSConfig): Promise<void> {
    const resolved = resolveConfig(config);
    if (resolved.modelFiles) return;
    await deleteCachedModel(resolved.model, resolved.storageDirectory);
  }

  /** Delete and download the selected model again. */
  static async redownloadModel(
    config?: KittenTTSConfig,
    onProgress?: ProgressHandler,
  ): Promise<void> {
    const resolved = resolveConfig(config);
    const analytics = createAnalyticsClientForConfig(resolved, {
      assetSource: resolved.modelFiles ? 'bundled' : 'runtime-download',
      playbackHelper: 'none',
    });
    if (resolved.modelFiles) {
      try {
        await resolveModelPaths(
          resolved.model,
          resolved.storageDirectory,
          onProgress,
          { modelFiles: resolved.modelFiles },
        );
        analytics.track('model_download_succeeded', {
          assetSource: 'bundled',
          cacheHit: false,
        });
      } catch (error) {
        analytics.track('model_download_failed', {
          assetSource: 'bundled',
          errorCode: analyticsErrorCode(error),
        });
        throw error;
      }
      return;
    }
    await deleteCachedModel(resolved.model, resolved.storageDirectory);
    try {
      await resolveModelPaths(
        resolved.model,
        resolved.storageDirectory,
        onProgress,
        {
          force: true,
          retries: resolved.downloadRetries,
          baseURL: resolved.modelBaseURL || undefined,
        },
      );
      analytics.track('model_download_succeeded', {
        assetSource: 'runtime-download',
        cacheHit: false,
      });
    } catch (error) {
      analytics.track('model_download_failed', {
        assetSource: 'runtime-download',
        errorCode: analyticsErrorCode(error),
      });
      throw error;
    }
  }

  /** Download model and phonemizer assets without creating a long-lived engine. */
  static async predownload(
    config?: KittenTTSConfig,
    onProgress?: ProgressHandler,
  ): Promise<void> {
    const resolved = resolveConfig(config);
    const assetSource: KittenTTSAnalyticsAssetSource = resolved.modelFiles
      ? 'bundled'
      : 'runtime-download';
    const analytics = createAnalyticsClientForConfig(resolved, {
      assetSource,
      playbackHelper: 'none',
    });
    const hasPhonemizerDownload =
      typeof resolved.phonemizer.downloadIfNeeded === 'function';
    const setupProgress = createAggregateProgress(onProgress);
    const modelCacheHit = resolved.modelFiles
      ? false
      : await checkModelCached(resolved.model, resolved.storageDirectory);

    const phonemizerDownload = hasPhonemizerDownload
      ? resolved.phonemizer.downloadIfNeeded?.(
        resolved.storageDirectory,
        setupProgress,
      )
      : Promise.resolve();

    const modelDownload = resolveModelPaths(
      resolved.model,
      resolved.storageDirectory,
      setupProgress,
      {
        modelFiles: resolved.modelFiles,
        retries: resolved.downloadRetries,
        baseURL: resolved.modelBaseURL || undefined,
      },
    )
      .then(() => {
        analytics.track('model_download_succeeded', {
          assetSource: modelCacheHit ? 'cache' : assetSource,
          cacheHit: modelCacheHit,
        });
      })
      .catch((error) => {
        analytics.track('model_download_failed', {
          assetSource,
          errorCode: analyticsErrorCode(error),
        });
        throw error;
      });

    await Promise.all([phonemizerDownload, modelDownload]);
    setupProgress(1, { stage: 'complete' });
  }

  /** @deprecated Use `predownload()`. This method does not keep an engine warm. */
  static async prewarm(
    config?: KittenTTSConfig,
    onProgress?: ProgressHandler,
  ): Promise<void> {
    await KittenTTS.predownload(config, onProgress);
  }

  /** Release the ONNX session and free resources. */
  async dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise;
    this.disposed = true;
    this.disposePromise = (async () => {
      await this.audioOutput.stop().catch(() => {});
      await this.engine.dispose();
      this.config.phonemizer.dispose?.();
    })();
    return this.disposePromise;
  }
}

function resolvePlaybackHelper(
  player?: AudioPlayer,
): KittenTTSAnalyticsPlaybackHelper {
  if (!player) return 'none';
  return player.kittenTTSPlaybackHelper ?? 'custom';
}

function createAnalyticsClientForConfig(
  config: ResolvedKittenTTSConfig,
  options: {
    playbackHelper: KittenTTSAnalyticsPlaybackHelper;
    assetSource: KittenTTSAnalyticsAssetSource;
  },
): KittenTTSAnalyticsClient {
  return new KittenTTSAnalyticsClient({
    analytics: config.analytics,
    storageDirectory: config.storageDirectory,
    model: config.model,
    defaultVoice: config.defaultVoice,
    playbackHelper: options.playbackHelper,
    assetSource: options.assetSource,
  });
}

function analyticsErrorCode(error: unknown): string {
  if (isKittenTTSError(error)) return error.code;
  return 'UNKNOWN';
}

function normalizeWordTimingsToDuration(
  wordTimings: readonly KittenWordTiming[],
  audioDuration: number,
): KittenWordTiming[] {
  if (wordTimings.length === 0 || audioDuration <= 0) return [...wordTimings];

  const lastEndTime = wordTimings[wordTimings.length - 1].endTime;
  if (lastEndTime <= 0) return [...wordTimings];

  const scale = audioDuration / lastEndTime;
  return wordTimings.map(timing => ({
    ...timing,
    startTime: clampTime(timing.startTime * scale, audioDuration),
    endTime: clampTime(timing.endTime * scale, audioDuration),
  }));
}

function clampTime(value: number, audioDuration: number): number {
  return Math.max(0, Math.min(audioDuration, value));
}

function resolveOnnxModelSource(paths: ModelPaths): string | Uint8Array {
  if (paths.onnxData) return paths.onnxData;
  if (paths.onnxPath) return paths.onnxPath;
  throw KittenTTSError.modelFileNotFound('<missing model path>');
}

function requireVoicesPath(paths: ModelPaths): string {
  if (paths.voicesPath) return paths.voicesPath;
  throw KittenTTSError.voicesFileNotFound('<missing voices path>');
}

async function loadVoicesFromModelPaths(
  paths: ModelPaths,
): Promise<Awaited<ReturnType<typeof loadNPZ>>> {
  if (paths.voicesData) return loadNPZData(paths.voicesData);
  if (paths.voicesPath) return loadNPZ(paths.voicesPath);
  throw KittenTTSError.voicesFileNotFound('<missing voices path>');
}

async function loadVoicesWithCacheRepair(
  voicesPath: string,
  repairCache: () => Promise<ModelPaths>,
): Promise<Awaited<ReturnType<typeof loadNPZ>>> {
  try {
    return await loadNPZ(voicesPath);
  } catch (error) {
    if (!isRepairableModelCacheError(error)) throw error;
    const repairedPaths = await repairCache();
    return loadNPZ(requireVoicesPath(repairedPaths));
  }
}

function isRepairableModelCacheError(error: unknown): boolean {
  return (
    isKittenTTSError(error) &&
    (error.code === KittenTTSErrorCode.InvalidModelData ||
      error.code === KittenTTSErrorCode.VoicesFileNotFound ||
      error.code === KittenTTSErrorCode.ModelFileNotFound ||
      error.code === KittenTTSErrorCode.InferenceFailed)
  );
}

function createAggregateProgress(
  progressHandler?: ProgressHandler,
): ProgressHandler {
  const files = new Map<string, { bytesWritten: number; contentLength: number }>();

  return (progress, info) => {
    if (info?.asset && info.contentLength && info.contentLength > 0) {
      files.set(info.asset, {
        bytesWritten: Math.max(0, Math.min(info.bytesWritten ?? 0, info.contentLength)),
        contentLength: info.contentLength,
      });
    }

    const totalBytes = Array.from(files.values()).reduce(
      (sum, file) => sum + file.contentLength,
      0,
    );
    const writtenBytes = Array.from(files.values()).reduce(
      (sum, file) => sum + file.bytesWritten,
      0,
    );

    if (totalBytes > 0) {
      progressHandler?.(
        Math.max(0, Math.min(1, writtenBytes / totalBytes)),
        info,
      );
      return;
    }

    progressHandler?.(progress, info);
  };
}
