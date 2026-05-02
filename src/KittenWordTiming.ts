/**
 * Timing information for a single word in generated audio.
 *
 * Timestamps are derived from the model's predicted phoneme durations and are
 * empty when the model does not provide duration output or the text is split
 * across multiple inference chunks.
 */
export interface KittenWordTiming {
  /** Zero-based index of this word in the whitespace-split input text. */
  wordIndex: number;

  /** The original word text from the input. */
  word: string;

  /** Start time in seconds within the generated audio. */
  startTime: number;

  /** End time in seconds within the generated audio. */
  endTime: number;
}
