import { KittenVoice } from './KittenVoice';
import { uint8ArrayToBase64 } from './audio/Base64';
import { WAVEncoder } from './audio/WAVEncoder';
import type { KittenWordTiming } from './KittenWordTiming';

/**
 * The result of a KittenTTS speech-synthesis call.
 *
 * Contains raw PCM audio samples and metadata. Use {@link wavData} to encode
 * as a standard WAV file, or access {@link samples} for raw Float32 PCM.
 */
export class KittenTTSResult {
  /** Raw Float32 PCM samples at {@link sampleRate} Hz, mono channel. */
  readonly samples: Float32Array;

  /** Sample rate of the audio. Always 24,000 Hz. */
  readonly sampleRate: number;

  /** The voice used to generate this audio. */
  readonly voice: KittenVoice;

  /** The effective speed multiplier that was applied. */
  readonly effectiveSpeed: number;

  /** The original input text that was synthesised. */
  readonly inputText: string;

  /** Word-level timestamps in seconds. Empty when unavailable. */
  readonly wordTimings: KittenWordTiming[];

  constructor(
    samples: Float32Array,
    sampleRate: number,
    voice: KittenVoice,
    effectiveSpeed: number,
    inputText: string,
    wordTimings: KittenWordTiming[] = [],
  ) {
    this.samples = samples;
    this.sampleRate = sampleRate;
    this.voice = voice;
    this.effectiveSpeed = effectiveSpeed;
    this.inputText = inputText;
    this.wordTimings = wordTimings;
  }

  /** Duration of the audio in seconds. */
  get duration(): number {
    return this.samples.length / this.sampleRate;
  }

  /**
   * Encode the audio as a standard 16-bit PCM RIFF WAV file.
   * @returns A Uint8Array containing the complete WAV file.
   */
  wavData(): Uint8Array {
    return WAVEncoder.encode(this.samples, this.sampleRate);
  }

  /**
   * Get the WAV data as a base64-encoded string.
   * Useful for writing to disk via react-native-fs or a custom audio player.
   */
  wavBase64(): string {
    return uint8ArrayToBase64(this.wavData());
  }
}
