import { KittenVoice, voiceDisplayName } from './KittenVoice';

/** Error codes thrown by the KittenTTS SDK. */
export enum KittenTTSErrorCode {
  EmptyInput = 'EMPTY_INPUT',
  EngineNotReady = 'ENGINE_NOT_READY',
  ModelFileNotFound = 'MODEL_FILE_NOT_FOUND',
  VoicesFileNotFound = 'VOICES_FILE_NOT_FOUND',
  NoVoiceEmbedding = 'NO_VOICE_EMBEDDING',
  InferenceFailed = 'INFERENCE_FAILED',
  EmptyOutput = 'EMPTY_OUTPUT',
  DownloadFailed = 'DOWNLOAD_FAILED',
  InvalidModelData = 'INVALID_MODEL_DATA',
  PhonemizerFailed = 'PHONEMIZER_FAILED',
  PlaybackFailed = 'PLAYBACK_FAILED',
}

/** Errors thrown by the KittenTTS SDK. */
export class KittenTTSError extends Error {
  readonly code: KittenTTSErrorCode;
  readonly cause?: unknown;

  constructor(code: KittenTTSErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'KittenTTSError';
    this.code = code;
    this.cause = cause;
  }

  static emptyInput(): KittenTTSError {
    return new KittenTTSError(
      KittenTTSErrorCode.EmptyInput,
      'Input text must not be empty.',
    );
  }

  static engineNotReady(): KittenTTSError {
    return new KittenTTSError(
      KittenTTSErrorCode.EngineNotReady,
      'KittenTTS engine is not initialised. Call KittenTTS.create() first.',
    );
  }

  static modelFileNotFound(path: string): KittenTTSError {
    return new KittenTTSError(
      KittenTTSErrorCode.ModelFileNotFound,
      `Model file not found: ${path}`,
    );
  }

  static voicesFileNotFound(path: string): KittenTTSError {
    return new KittenTTSError(
      KittenTTSErrorCode.VoicesFileNotFound,
      `Voice embeddings file not found: ${path}`,
    );
  }

  static noVoiceEmbedding(voice: KittenVoice): KittenTTSError {
    return new KittenTTSError(
      KittenTTSErrorCode.NoVoiceEmbedding,
      `No embedding found for voice '${voiceDisplayName(voice)}' (id: ${voice}).`,
    );
  }

  static inferenceFailed(detail: string, cause?: unknown): KittenTTSError {
    return new KittenTTSError(
      KittenTTSErrorCode.InferenceFailed,
      `ONNX inference failed: ${detail}`,
      cause,
    );
  }

  static emptyOutput(): KittenTTSError {
    return new KittenTTSError(
      KittenTTSErrorCode.EmptyOutput,
      'The model produced no audio samples.',
    );
  }

  static downloadFailed(detail: string, cause?: unknown): KittenTTSError {
    return new KittenTTSError(
      KittenTTSErrorCode.DownloadFailed,
      `Model download failed: ${detail}`,
      cause,
    );
  }

  static invalidModelData(detail: string, cause?: unknown): KittenTTSError {
    return new KittenTTSError(
      KittenTTSErrorCode.InvalidModelData,
      `Invalid model data: ${detail}`,
      cause,
    );
  }

  static phonemizerFailed(detail: string, cause?: unknown): KittenTTSError {
    return new KittenTTSError(
      KittenTTSErrorCode.PhonemizerFailed,
      `Phonemizer failed: ${detail}`,
      cause,
    );
  }

  static playbackFailed(detail: string, cause?: unknown): KittenTTSError {
    return new KittenTTSError(
      KittenTTSErrorCode.PlaybackFailed,
      `Playback failed: ${detail}`,
      cause,
    );
  }
}

export function isKittenTTSError(error: unknown): error is KittenTTSError {
  return error instanceof KittenTTSError;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
