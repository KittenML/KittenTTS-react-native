// misaki/cutlet.py (misaki 0.9.4, adapted from polm/cutlet, MIT): Japanese text -> IPA, the
// JAG2P() default (version='cutlet'). Every step of Cutlet.__call__ is ported in order:
//
//   _normalize_text   〜/～ before a digit -> から, Katakana Phonetic Extensions, NFKC,
//                     mojimoji.zen_to_han(kana=False), mojimoji.han_to_zen(digit=False,
//                     ascii=False), digit runs -> " " + num2kana
//   tagger            MeCab + unidic-lite (mecab.ts); Word(surface, kata2hira(pron or kana or
//                     surface), 6 if char_type == 7 or not is_unk else char_type)
//   _romaji_tokens    merge runs found in ja_words.txt, kana -> IPA, spacing around punctuation
//   join              strip, \s+ -> " ", ( ) -> « », spaces around ʔ removed
//
// Python semantics kept: `x in 'abc'` on strings is a substring test (so "" is in every string),
// strings are indexed by code point, dict lookups that Python would fail raise here too.

import type { Container } from './container';
import type { Mecab } from './mecab';
import { convertNumber } from './num2kana';
import { pyStripSpace, replaceAll } from '../pystr';
import { codePoints, collapseSpaces, PyUnicode } from './unicode';

// cutlet.HEPBURN after all its updates (hiragana, ヷ-ヺ, digraphs, symbols).
const HEPBURN_ENTRIES: Array<[string, string]> = [
  ['ぁ', 'a'], ['あ', 'a'], ['ぃ', 'i'], ['い', 'i'], ['ぅ', 'ɯ'], ['う', 'ɯ'],
  ['ぇ', 'e'], ['え', 'e'], ['ぉ', 'o'], ['お', 'o'], ['か', 'ka'], ['が', 'ɡa'],
  ['き', 'kʲi'], ['ぎ', 'ɡʲi'], ['く', 'kɯ'], ['ぐ', 'ɡɯ'], ['け', 'ke'],
  ['げ', 'ɡe'], ['こ', 'ko'], ['ご', 'ɡo'], ['さ', 'sa'], ['ざ', 'ʣa'],
  ['し', 'ɕi'], ['じ', 'ʥi'], ['す', 'sɨ'], ['ず', 'zɨ'], ['せ', 'se'],
  ['ぜ', 'ʣe'], ['そ', 'so'], ['ぞ', 'ʣo'], ['た', 'ta'], ['だ', 'da'],
  ['ち', 'ʨi'], ['ぢ', 'ʥi'], ['つ', 'ʦɨ'], ['づ', 'zɨ'], ['て', 'te'],
  ['で', 'de'], ['と', 'to'], ['ど', 'do'], ['な', 'na'], ['に', 'ɲi'], ['ぬ', 'nɯ'],
  ['ね', 'ne'], ['の', 'no'], ['は', 'ha'], ['ば', 'ba'], ['ぱ', 'pa'], ['ひ', 'çi'],
  ['び', 'bʲi'], ['ぴ', 'pʲi'], ['ふ', 'ɸɯ'], ['ぶ', 'bɯ'], ['ぷ', 'pɯ'],
  ['へ', 'he'], ['べ', 'be'], ['ぺ', 'pe'], ['ほ', 'ho'], ['ぼ', 'bo'], ['ぽ', 'po'],
  ['ま', 'ma'], ['み', 'mʲi'], ['む', 'mɯ'], ['め', 'me'], ['も', 'mo'], ['ゃ', 'ja'],
  ['や', 'ja'], ['ゅ', 'jɯ'], ['ゆ', 'jɯ'], ['ょ', 'jo'], ['よ', 'jo'], ['ら', 'ɾa'],
  ['り', 'ɾʲi'], ['る', 'ɾɯ'], ['れ', 'ɾe'], ['ろ', 'ɾo'],
  ['ゎ', 'βa'], ['わ', 'βa'], ['ゐ', 'i'], ['ゑ', 'e'], ['を', 'o'], ['ゔ', 'vɯ'],
  ['ゕ', 'ka'], ['ゖ', 'ke'],
  ['ヷ', 'va'], ['ヸ', 'vʲi'], ['ヹ', 've'], ['ヺ', 'vo'],
  ['いぇ', 'je'], ['うぃ', 'βi'], ['うぇ', 'βe'], ['うぉ', 'βo'],
  ['きぇ', 'kʲe'], ['きゃ', 'kʲa'], ['きゅ', 'kʲɨ'], ['きょ', 'kʲo'],
  ['ぎゃ', 'ɡʲa'], ['ぎゅ', 'ɡʲɨ'], ['ぎょ', 'ɡʲo'],
  ['くぁ', 'kᵝa'], ['くぃ', 'kᵝi'], ['くぇ', 'kᵝe'], ['くぉ', 'kᵝo'],
  ['ぐぁ', 'ɡᵝa'], ['ぐぃ', 'ɡᵝi'], ['ぐぇ', 'ɡᵝe'],
  ['ぐぉ', 'ɡᵝo'], ['しぇ', 'ɕe'], ['しゃ', 'ɕa'], ['しゅ', 'ɕɨ'],
  ['しょ', 'ɕo'], ['じぇ', 'ʥe'], ['じゃ', 'ʥa'], ['じゅ', 'ʥɨ'],
  ['じょ', 'ʥo'], ['ちぇ', 'ʨe'], ['ちゃ', 'ʨa'], ['ちゅ', 'ʨɨ'],
  ['ちょ', 'ʨo'], ['ぢゃ', 'ʥa'], ['ぢゅ', 'ʥɨ'], ['ぢょ', 'ʥo'],
  ['つぁ', 'ʦa'], ['つぃ', 'ʦʲi'], ['つぇ', 'ʦe'], ['つぉ', 'ʦo'],
  ['てぃ', 'tʲi'], ['てゅ', 'tʲɨ'], ['でぃ', 'dʲi'], ['でゅ', 'dʲɨ'],
  ['とぅ', 'tɯ'], ['どぅ', 'dɯ'], ['にぇ', 'ɲe'], ['にゃ', 'ɲa'],
  ['にゅ', 'ɲɨ'], ['にょ', 'ɲo'], ['ひぇ', 'çe'], ['ひゃ', 'ça'],
  ['ひゅ', 'çɨ'], ['ひょ', 'ço'], ['びゃ', 'bʲa'], ['びゅ', 'bʲɨ'],
  ['びょ', 'bʲo'], ['ぴゃ', 'pʲa'], ['ぴゅ', 'pʲɨ'], ['ぴょ', 'pʲo'],
  ['ふぁ', 'ɸa'], ['ふぃ', 'ɸʲi'], ['ふぇ', 'ɸe'], ['ふぉ', 'ɸo'],
  ['ふゅ', 'ɸʲɨ'], ['ふょ', 'ɸʲo'], ['みゃ', 'mʲa'],
  ['みゅ', 'mʲɨ'], ['みょ', 'mʲo'], ['りゃ', 'ɾʲa'],
  ['りゅ', 'ɾʲɨ'], ['りょ', 'ɾʲo'], ['ゔぁ', 'va'], ['ゔぃ', 'vʲi'],
  ['ゔぇ', 've'], ['ゔぉ', 'vo'], ['ゔゅ', 'bʲɨ'], ['ゔょ', 'bʲo'],
  ['。', '.'], ['、', ','], ['？', '?'], ['！', '!'], ['「', '“'], ['」', '”'],
  ['『', '“'], ['』', '”'], ['：', ':'], ['；', ';'], ['（', '('], ['）', ')'],
  ['《', '('], ['》', ')'], ['【', '['], ['】', ']'], ['・', ' '], ['，', ','],
  ['～', '—'], ['〜', '—'], ['—', '—'], ['«', '“'], ['»', '”'],
  ['\u309a', ''], ['\u3099', ''],
];
const HEPBURN = new Map<string, string>(HEPBURN_ENTRIES);

const KATAKANA_PHONETIC_EXTENSIONS: Array<[string, string]> = [
  ['ㇰ', 'ク'], ['ㇱ', 'シ'], ['ㇲ', 'ス'], ['ㇳ', 'ト'], ['ㇴ', 'ヌ'],
  ['ㇵ', 'ハ'], ['ㇶ', 'ヒ'], ['ㇷ', 'フ'], ['ㇸ', 'ヘ'], ['ㇹ', 'ホ'],
  ['ㇺ', 'ム'], ['ㇻ', 'ラ'], ['ㇼ', 'リ'], ['ㇽ', 'ル'], ['ㇾ', 'レ'],
  ['ㇿ', 'ロ'],
];

const SUTEGANA = new Set(Array.from('ゃゅょぁぃぅぇぉ'));
const ODORI = new Set(Array.from('〃々ゝゞヽ'));
const DAKUTEN_FROM = 'かきくけこさしすせそたちつてとはひふへほ';
const DAKUTEN_TO = 'がぎぐげござじずぜぞだぢづでどばびぶべぼ';

// mojimoji.zen_to_han(text, kana=False) after NFKC: NFKC has already turned the full-width
// ASCII forms, U+3000 and U+FFE5 into their plain forms, so only these three can still change.
const ZEN_TO_HAN = new Map<number, string>([[0x2018, '`'], [0x2019, "'"], [0x201d, '"']]);

// MeCab character categories (unidic-lite char.def) that cutlet looks at.
const SYMBOL = 3;
const HIRAGANA = 6;
const KATAKANA = 7;

/** jaconv.kata2hira: ァ-ヶ and ヽヾ to hiragana; everything else unchanged. */
export function kata2hira(s: string): string {
  let out = '';
  let changed = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if ((c >= 0x30a1 && c <= 0x30f6) || c === 0x30fd || c === 0x30fe) {
      out += String.fromCharCode(c - 0x60);
      changed = true;
    } else {
      out += s[i];
    }
  }
  return changed ? out : s;
}

interface Word {
  surface: string;
  hira: string;
  charType: number;
}

interface Token {
  surface: string;
  space: boolean;
}

function pyIsAscii(s: string): boolean {
  for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) >= 0x80) return false;
  return true;
}

/** Sorted UTF-16 word list (misaki's ja_words.txt) with binary search, no JS strings per word. */
class WordSet {
  private readonly off: Uint32Array;
  private readonly units: Uint16Array;
  readonly maxUnits: number;

  constructor(c: Container) {
    this.off = c.u32('wordOff');
    this.units = c.u16('wordChars');
    let max = 0;
    for (let i = 0; i + 1 < this.off.length; i++) max = Math.max(max, this.off[i + 1] - this.off[i]);
    this.maxUnits = max;
  }

  private cmp(i: number, s: string): number {
    const a = this.off[i];
    const n = this.off[i + 1] - a;
    const m = Math.min(n, s.length);
    for (let k = 0; k < m; k++) {
      const d = this.units[a + k] - s.charCodeAt(k);
      if (d) return d;
    }
    return n - s.length;
  }

  has(s: string): boolean {
    if (s.length > this.maxUnits) return false;
    let lo = 0;
    let hi = this.off.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >>> 1;
      if (this.cmp(m, s) < 0) lo = m + 1;
      else hi = m;
    }
    return lo < this.off.length - 1 && this.cmp(lo, s) === 0;
  }
}

export class Cutlet {
  private readonly words: WordSet;

  constructor(
    private readonly mecab: Mecab,
    private readonly uni: PyUnicode,
    data: Container,
  ) {
    this.words = new WordSet(data);
  }

  /** Cutlet.__call__(text)[0] */
  phonemize(text: string): string {
    if (!text) return '';
    text = this.normalizeText(text);
    const words: Word[] = this.mecab.parse(text).map(w => ({
      surface: w.surface,
      hira: kata2hira(w.reading || w.surface),
      charType: w.charType === KATAKANA || !w.isUnk ? HIRAGANA : w.charType,
    }));
    const tokens = this.romajiTokens(words);
    let out = '';
    for (const t of tokens) out += t.surface + (t.space ? ' ' : '');
    let ps = collapseSpaces(pyStripSpace(out));
    ps = replaceAll(replaceAll(ps, '(', '«'), ')', '»');
    return dropSpacesAroundGlottalStop(ps);
  }

  /** Cutlet._normalize_text */
  normalizeText(text: string): string {
    const uni = this.uni;
    // re.sub(r'[〜～](?=\d)', 'から', text)
    let cps = codePoints(text);
    let t = '';
    for (let i = 0; i < cps.length; i++) {
      const c = cps[i];
      if ((c === 0x301c || c === 0xff5e) && i + 1 < cps.length && uni.isNd(cps[i + 1])) t += 'から';
      else t += String.fromCodePoint(c);
    }
    for (const [k, v] of KATAKANA_PHONETIC_EXTENSIONS) t = replaceAll(t, k, v);
    t = uni.nfkc(t);
    t = zenToHan(t);
    // mojimoji.han_to_zen (half-width katakana to full width) would follow; after NFKC it never
    // changes anything.
    // ''.join([(' '+Convert(t)) if t.isdigit() else t for t in re.findall(r'\d+|\D+', text)])
    cps = codePoints(t);
    let out = '';
    let i = 0;
    while (i < cps.length) {
      const digit = uni.isNd(cps[i]);
      let j = i + 1;
      while (j < cps.length && uni.isNd(cps[j]) === digit) j++;
      let run = '';
      for (let k = i; k < j; k++) run += String.fromCodePoint(cps[k]);
      out += uni.isDigit(run) ? ' ' + convertNumber(run) : run;
      i = j;
    }
    return out;
  }

  /** Cutlet._romaji_tokens */
  private romajiTokens(words: Word[]): Token[] {
    const groups: Word[][] = [];
    let i = 0;
    while (i < words.length) {
      let z = i + 1;
      while (z < words.length && words[z].charType === words[i].charType) z++;
      // the longest run words[i:j], j <= z, whose joined surface is in ja_words.txt
      let total = 0;
      let jMax = i;
      while (jMax < z && total + words[jMax].surface.length <= this.words.maxUnits) {
        total += words[jMax].surface.length;
        jMax++;
      }
      let found = -1;
      for (let j = jMax; j > i; j--) {
        let s = '';
        for (let k = i; k < j; k++) s += words[k].surface;
        if (this.words.has(s)) {
          found = j;
          break;
        }
      }
      if (found < 0) {
        groups.push([words[i]]);
        i += 1;
      } else {
        groups.push(words.slice(i, found));
        i = found;
      }
    }
    const merged: Word[] = groups.map(g => ({
      surface: g.map(w => w.surface).join(''),
      hira: g.map(w => w.hira).join(''),
      charType: g[0].charType,
    }));
    const out: Token[] = [];
    for (const word of merged) {
      const po = out.length ? out[out.length - 1] : null;
      const roma = this.romajiWord(word);
      const tok: Token = { surface: roma, space: false };
      const surface = word.surface;
      if ('「『«'.includes(surface) || '(['.includes(roma)) {
        if (po) po.space = true;
      } else if ('」』»'.includes(surface) || ']).,?!:'.includes(roma)) {
        if (po) po.space = false;
        tok.space = true;
      } else if (roma === ' ') {
        tok.space = false;
      } else {
        tok.space = true;
      }
      out.push(tok);
    }
    for (const tok of out) tok.surface = replaceAll(tok.surface, 'っ', '');   // leftover sokuon
    return out;
  }

  /** Cutlet._romaji_word */
  private romajiWord(word: Word): string {
    const surface = word.surface;
    if (this.uni.isDigit(surface)) throw new Error(`AssertionError: ${surface}`);
    if (pyIsAscii(surface)) return surface;
    if (word.charType === SYMBOL) {
      let s = '';
      for (const c of Array.from(surface)) s += HEPBURN.has(c) ? (HEPBURN.get(c) as string) : c;
      return s;
    } else if (word.charType !== HIRAGANA) {
      return '';
    }
    const hira = Array.from(word.hira);
    let out = '';
    for (let ki = 0; ki < hira.length; ki++) {
      const nk = ki < hira.length - 1 ? hira[ki + 1] : null;
      const pk = ki > 0 ? hira[ki - 1] : null;
      out += getSingleMapping(pk, hira[ki], nk);
    }
    return out;
  }
}

function table(k: string): string {
  const v = HEPBURN.get(k);
  if (v === undefined) throw new Error(`KeyError: '${k}'`);
  return v;
}

function addDakuten(kk: string): string | null {
  const i = DAKUTEN_FROM.indexOf(kk);
  return i < 0 ? null : DAKUTEN_TO[i];
}

/** Cutlet._get_single_mapping */
function getSingleMapping(pk: string | null, kk: string, nk: string | null): string {
  if (ODORI.has(kk)) {
    if ('ゝヽ'.includes(kk)) return pk ? pk : '';
    if ('ゞヾ'.includes(kk)) {
      if (!pk) return '';
      const vv = addDakuten(pk);
      return vv ? table(vv) : '';
    }
    return '';
  }
  if (pk && HEPBURN.has(pk + kk)) return HEPBURN.get(pk + kk) as string;
  if (nk && HEPBURN.has(kk + nk)) return '';
  if (nk && SUTEGANA.has(nk)) {
    if (kk === 'っ') return '';
    const a = Array.from(table(kk));
    return a.slice(0, -1).join('') + table(nk);
  }
  if (SUTEGANA.has(kk)) return '';
  if (kk === 'ー') return 'ː';
  if (kk === 'っ') return 'ʔ';
  if (kk === 'ん') {
    const tnk = nk === null ? undefined : HEPBURN.get(nk);
    if (tnk) {
      const t0 = Array.from(tnk)[0];
      if ('mpb'.includes(t0)) return 'm';
      else if ('kɡ'.includes(t0)) return 'ŋ';
      else if (tnk.startsWith('ɲ') || tnk.startsWith('ʨ') || tnk.startsWith('ʥ')) return 'ɲ';
      else if ('ntdɾz'.includes(t0)) return 'n';
    }
    return 'ɴ';
  }
  return HEPBURN.has(kk) ? (HEPBURN.get(kk) as string) : '';
}

function zenToHan(s: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const m = ZEN_TO_HAN.get(s.charCodeAt(i));
    out += m === undefined ? s[i] : m;
  }
  return out;
}

const NO_SPACE_BEFORE = new Set(Array.from('!",.:;?»—…”'));
const NO_SPACE_AFTER = new Set(Array.from('"«“'));

/** re.sub(r'(?<![!",.:;?»—…”]) (?=ʔ)|(?<=ʔ) (?!["«“])', '', ps) */
function dropSpacesAroundGlottalStop(ps: string): string {
  if (ps.indexOf('ʔ') < 0) return ps;
  let out = '';
  for (let i = 0; i < ps.length; i++) {
    if (ps[i] === ' ') {
      const before = i > 0 ? ps[i - 1] : '';
      const after = i + 1 < ps.length ? ps[i + 1] : '';
      const a = !NO_SPACE_BEFORE.has(before) && after === 'ʔ';
      const b = before === 'ʔ' && !NO_SPACE_AFTER.has(after);
      if (a || b) continue;
    }
    out += ps[i];
  }
  return out;
}

