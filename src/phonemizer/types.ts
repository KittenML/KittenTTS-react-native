import type { ProgressHandler } from '../loader/ModelDownloader';

/**
 * A type that converts normalised English text into an IPA phoneme string
 * compatible with the KittenTTS symbol table.
 *
 * Implement this interface to plug in any G2P engine -- a rule-based system,
 * a neural network, or a server-side API.
 *
 * The input `text` has already been processed by TextPreprocessor (numbers
 * expanded, currencies spelled out, etc.). The returned string must use only
 * Unicode code points present in the KittenTTS symbol table; unknown code
 * points are silently dropped by TextCleaner.
 */
export interface KittenPhonemizerProtocol {
  /** Convert preprocessed English text to an IPA phoneme string. */
  phonemize(text: string): string | Promise<string>;

  /** Download or prepare any data files required by the phonemizer. */
  downloadIfNeeded?(
    storageDirectory: string,
    progressHandler?: ProgressHandler,
  ): Promise<void>;

  /** Release any native/module resources held by the phonemizer. */
  dispose?(): void;
}
