/**
 * Maps IPA phoneme strings to the integer token sequences expected by the
 * KittenTTS ONNX model.
 *
 * The symbol table is identical to the Python `TextCleaner` in
 * `kittentts/onnx_model.py`. Unknown Unicode code points are silently skipped.
 */

const PAD = '$';
const PUNCTUATION = ';:,.!?\u00A1\u00BF\u2014\u2026"\u00AB\u00BB\u201C\u201D ';
const LETTERS_UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LETTERS_LOWER = 'abcdefghijklmnopqrstuvwxyz';
const IPA_SYMBOLS =
  '\u0251\u0250\u0252\u00E6\u0253\u0299\u03B2\u0254\u0255\u00E7' +
  '\u0257\u0256\u00F0\u02A4\u0259\u0258\u025A\u025B\u025C\u025D' +
  '\u025E\u025F\u0284\u0261\u0260\u0262\u029B\u0266\u0267\u0127' +
  '\u0265\u029C\u0268\u026A\u029D\u026D\u026C\u026B\u026E\u029F' +
  '\u0271\u026F\u0270\u014B\u0273\u0272\u0274\u00F8\u0275\u0278' +
  '\u03B8\u0153\u0276\u0298\u0279\u027A\u027E\u027B\u0280\u0281' +
  '\u027D\u0282\u0283\u0288\u02A7\u0289\u028A\u028B\u2C71\u028C' +
  '\u0263\u0264\u028D\u03C7\u028E\u028F\u0291\u0290\u0292\u0294' +
  '\u02A1\u0295\u02A2\u01C0\u01C1\u01C2\u01C3\u02C8\u02CC\u02D0' +
  '\u02D1\u02BC\u02B4\u02B0\u02B1\u02B2\u02B7\u02E0\u02E4\u02DE' +
  '\u2193\u2191\u2192\u2197\u2198\u2019\u0329\u2018\u1D7B';

const ALL_SYMBOLS = PAD + PUNCTUATION + LETTERS_UPPER + LETTERS_LOWER + IPA_SYMBOLS;

/** Symbol -> index lookup table. */
const SYMBOL_INDEX: Map<number, number> = new Map();
let idx = 0;
for (const codePoint of ALL_SYMBOLS) {
  SYMBOL_INDEX.set(codePoint.codePointAt(0)!, idx);
  idx++;
}

/** Token ID for start-of-sequence (also the pad token). */
export const START_TOKEN_ID = 0;

/** Token ID for end-of-sequence (index 10 = ellipsis in the symbol table). */
export const END_TOKEN_ID = 10;

/** Token ID for padding. */
export const PAD_TOKEN_ID = 0;

/**
 * Encode an IPA phoneme string into a token ID array for the ONNX model.
 *
 * The returned array has the format: `[start, ...tokens, end, pad]`.
 *
 * @param phonemes - IPA string produced by the phonemizer.
 * @returns Array of integer token IDs.
 */
export function encode(phonemes: string): number[] {
  const tokens: number[] = [START_TOKEN_ID];
  for (const char of phonemes) {
    const cp = char.codePointAt(0)!;
    const id = SYMBOL_INDEX.get(cp);
    if (id !== undefined) {
      tokens.push(id);
    }
  }
  tokens.push(END_TOKEN_ID);
  tokens.push(PAD_TOKEN_ID);
  return tokens;
}
