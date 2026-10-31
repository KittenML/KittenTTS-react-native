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
  /** An argument or option was invalid, e.g. both `voice` and `reference`. */
  InvalidArgument = 'INVALID_ARGUMENT',
  /** The Kitten API answered with an error. See {@link KittenAPIError}. */
  ApiError = 'API_ERROR',
  /** The Kitten API could not be reached, or the request timed out. */
  NetworkError = 'NETWORK_ERROR',
  /** The request was cancelled through its `signal` or by `dispose()`. */
  Cancelled = 'CANCELLED',
  /** The JavaScript engine can't run this model (Kitten TTS 2 Nano, Pico and Mini need Hermes from React Native 0.75). */
  UnsupportedRuntime = 'UNSUPPORTED_RUNTIME',
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

  static invalidArgument(detail: string): KittenTTSError {
    return new KittenTTSError(KittenTTSErrorCode.InvalidArgument, detail);
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

/** Details the Kitten API sent with an error. */
export interface KittenAPIErrorDetails {
  status?: number;
  apiCode?: string;
  type?: string;
  param?: string;
  requestId?: string;
  retryAfter?: number;
  cause?: unknown;
}

/**
 * A failed Kitten API request. `code` is `API_ERROR`, `NETWORK_ERROR` or
 * `CANCELLED`; the API's own details are kept alongside.
 */
export class KittenAPIError extends KittenTTSError {
  /** HTTP status. Absent when no response arrived. */
  readonly status?: number;
  /**
   * The API's `error.code`, such as `invalid_voice` or `insufficient_credit`.
   * A string, because the API adds codes over time.
   */
  readonly apiCode?: string;
  /** The API's `error.type`, such as `invalid_request_error`. */
  readonly type?: string;
  /** The request field the error is about, such as `voice`. */
  readonly param?: string;
  /** Quote this when asking KittenML support about a request. */
  readonly requestId?: string;
  /** Seconds the API asked the client to wait before retrying. */
  readonly retryAfter?: number;

  constructor(code: KittenTTSErrorCode, message: string, details: KittenAPIErrorDetails = {}) {
    super(code, message, details.cause);
    this.name = 'KittenAPIError';
    this.status = details.status;
    this.apiCode = details.apiCode;
    this.type = details.type;
    this.param = details.param;
    this.requestId = details.requestId;
    this.retryAfter = details.retryAfter;
  }
}

export function isKittenAPIError(error: unknown): error is KittenAPIError {
  return error instanceof KittenAPIError;
}

export function isKittenTTSError(error: unknown): error is KittenTTSError {
  return error instanceof KittenTTSError;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
