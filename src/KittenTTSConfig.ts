import * as RNFS from 'react-native-fs';
import { KittenModel } from './KittenModel';
import { KittenVoice } from './KittenVoice';
import { CEPhonemizer } from './phonemizer/CEPhonemizer';
import type { KittenPhonemizerProtocol } from './phonemizer/types';

/**
 * Configuration for a {@link KittenTTS} session.
 *
 * @example
 * ```typescript
 * const config: KittenTTSConfig = {
 *   model: KittenModel.Nano,
 *   defaultVoice: KittenVoice.Luna,
 *   speed: 1.1,
 * };
 * const tts = await KittenTTS.create(config);
 * ```
 */
export interface KittenTTSConfig {
  /** The model variant to use. Defaults to {@link KittenModel.Nano}. */
  model?: KittenModel;

  /** Default voice when `voice` is omitted from generate/speak calls. Defaults to {@link KittenVoice.Bella}. */
  defaultVoice?: KittenVoice;

  /** Default speed multiplier (0.5--2.0). Defaults to 1.0 (natural speed). */
  speed?: number;

  /**
   * Root directory where downloaded SDK assets are cached.
   * Model files live under `<storageDirectory>/<model>/`.
   */
  storageDirectory?: string;

  /**
   * Override the model file host. The URL must point at a directory containing
   * the ONNX file and voices.npz for the selected model.
   */
  modelBaseURL?: string;

  /** Total download attempts per model file before failing. Defaults to 4. */
  downloadRetries?: number;

  /** Number of ONNX Runtime intra-op threads. Defaults to 4. */
  ortNumThreads?: number;

  /** Maximum tokens per inference chunk. Long texts are split to prevent OOM. Defaults to 400. */
  maxTokensPerChunk?: number;

  /** Trim trailing near-silence from generated chunks. Defaults to true. */
  trimTrailingSilence?: boolean;

  /** Amplitude threshold used for trailing silence trimming. Defaults to 0.005. */
  silenceThreshold?: number;

  /** Maximum trailing silence to trim from each chunk, in milliseconds. Defaults to 250. */
  maxSilenceTrimMs?: number;

  /** Text-to-IPA phonemizer. Defaults to the JS-compiled CEPhonemizer. */
  phonemizer?: KittenPhonemizerProtocol;
}

/** The fixed output sample rate for all KittenTTS audio (24 kHz). */
export const OUTPUT_SAMPLE_RATE = 24_000;

function defaultPhonemizer(): KittenPhonemizerProtocol {
  return new CEPhonemizer();
}

/** Resolve config with defaults applied. */
export function resolveConfig(config?: KittenTTSConfig): Required<KittenTTSConfig> {
  return {
    model: config?.model ?? KittenModel.Nano,
    defaultVoice: config?.defaultVoice ?? KittenVoice.Bella,
    speed: Math.min(Math.max(config?.speed ?? 1.0, 0.5), 2.0),
    storageDirectory: config?.storageDirectory ?? `${RNFS.DocumentDirectoryPath}/KittenTTS`,
    modelBaseURL: config?.modelBaseURL ?? '',
    downloadRetries: Math.max(1, Math.floor(config?.downloadRetries ?? 4)),
    ortNumThreads: Math.max(1, config?.ortNumThreads ?? 4),
    maxTokensPerChunk: Math.max(50, config?.maxTokensPerChunk ?? 400),
    trimTrailingSilence: config?.trimTrailingSilence ?? true,
    silenceThreshold: Math.max(0, config?.silenceThreshold ?? 0.005),
    maxSilenceTrimMs: Math.max(0, config?.maxSilenceTrimMs ?? 250),
    phonemizer: config?.phonemizer ?? defaultPhonemizer(),
  };
}
