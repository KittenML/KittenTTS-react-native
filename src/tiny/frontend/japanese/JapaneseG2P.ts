/**
 * Japanese text -> phonemes for the Kitten TTS 2 mini (phonemizer v2), matching the Python
 * kittenml package exactly:
 *
 *   phonemize_v2.phonemize_lang(get_g2p('ja'), text, 'ja')
 *     -> misaki ja.JAG2P() (version 'cutlet'): Cutlet()(text)[0]       (cutlet.ts)
 *          -> fugashi 1.5.2 Tagger: MeCab 0.996 + unidic-lite 1.0.8      (mecab.ts)
 *     -> phonemize(): strip, then phonemize_v2.FOLD
 *     -> phonemize_lang(): the CJK strip (ASCII digits, capitals and "-")
 *
 * The vocab filter (LangG2P in kittenml/kittentts2_tiny/frontend/__init__.py) is the caller's.
 * Where Python raises (KeyError from num2kana or cutlet's kana table, AssertionError for a
 * digit-only word, UnicodeEncodeError for a lone surrogate), phonemize() throws.
 *
 * Plain TypeScript, no WebAssembly, TextDecoder, Node or React Native APIs: the caller hands
 * in the data files (tools/kitten-tts-2-tiny/japanese_data.py) as bytes. The byte arrays are
 * used in place (typed-array views, no copy), and the dictionary files are decoded in place the
 * first time (a flag in each header records that, so the same bytes can be loaded again).
 * Hold on to them only through this object.
 *
 * UniDic (unidic-lite) is BSD-3-Clause / LGPL-2.1 / GPL-2.0; misaki, cutlet, jaconv and
 * mojimoji are MIT / Apache-2.0.
 */
import { Container } from './container';
import { Cutlet } from './cutlet';
import { Mecab } from './mecab';
import { FOLD_V2, applyFold } from '../phonemize';
import { pyStripSpace } from '../pystr';
import { PyUnicode } from './unicode';

/** The data files, as keys of the record create() takes (paths relative to the text data folder). */
export const JAPANESE_DATA_FILES: string[] = ['ja/unidic-lex.bin', 'ja/unidic-matrix.bin', 'ja/cutlet.bin'];

/** phonemize_v1.ZH_STRIP (= phonemize_v2.CJK_STRIP) */
function isCjkStrip(c: number): boolean {
  return c === 0x2d || (c >= 0x30 && c <= 0x39) || (c >= 0x41 && c <= 0x5a);
}

export class JapaneseG2P {
  private cutlet: Cutlet | null;

  private constructor(cutlet: Cutlet) {
    this.cutlet = cutlet;
  }

  /** files: the bytes of every JAPANESE_DATA_FILES entry, under those keys. */
  static async create(files: Record<string, Uint8Array>): Promise<JapaneseG2P> {
    const get = (key: string): Container => {
      const b = files[key];
      if (!b) throw new Error(`JapaneseG2P: missing ${key}`);
      return new Container(b, key);
    };
    const lex = get('ja/unidic-lex.bin');
    const matrix = get('ja/unidic-matrix.bin');
    const data = get('ja/cutlet.bin');
    const uni = new PyUnicode(data);
    return new JapaneseG2P(new Cutlet(new Mecab(lex, matrix), uni, data));
  }

  /** Exactly phonemize_v2.phonemize_lang(get_g2p('ja'), text, 'ja'), before vocab filtering. */
  phonemize(text: string): string {
    if (!this.cutlet) throw new Error('JapaneseG2P: disposed');
    // phonemize(): out = g2p(text); ps = (out[0] or "").strip(); FOLD
    const ps = applyFold(pyStripSpace(this.cutlet.phonemize(text)), FOLD_V2);
    // phonemize_lang(): "".join(c for c in ps if c not in CJK_STRIP)
    let out = '';
    for (let i = 0; i < ps.length; i++) if (!isCjkStrip(ps.charCodeAt(i))) out += ps[i];
    return out;
  }

  /** Drop the dictionary (the caller's byte arrays can then be freed). */
  dispose(): void {
    this.cutlet = null;
  }
}
