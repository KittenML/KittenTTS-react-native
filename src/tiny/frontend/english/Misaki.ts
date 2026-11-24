// misaki 0.9.4's English G2P (misaki/en.py, Apache-2.0, https://github.com/hexgrad/misaki),
// American English, ported function by function. The Kitten TTS 2 nano / pico / mini
// models were trained on its output, so every branch is kept, including ones that look
// odd. spaCy's tokenizer and tagger come from SpacyTokenizer and SpacyTagger. Ratings
// are left out: they never change the phonemes.

import { num2words } from './Num2Words';
import type { SpacyTagger } from './SpacyTagger';
import type { SpacyTokenizer } from './SpacyTokenizer';
import {
  digitValue,
  own,
  pyCapitalize,
  pyIsAlpha,
  pyIsDigit,
  pyIsSpaceChar,
  pyLen,
  pyLower,
  pyLstripSpace,
  pyNormalize,
  pyRstrip,
  pySplitSpace,
  pyStrIsAlpha,
  pyStrip,
  pyUpper,
} from '../pystr';

type LexValue = string | Record<string, string | null>;
export type Lexicon = Record<string, LexValue>;
type PS = string | null;

export interface MToken {
  text: string;
  tag: string;
  whitespace: string;
  phonemes: PS;
  isHead: boolean;
  alias: string | null;
  stress: number | null;
  currency: string | null;
  numFlags: string;
  prespace: boolean;
}

interface TokenContext {
  futureVowel: boolean | null;
  futureTo: boolean;
}

/** The fallback misaki calls for a word its lexicon can't say: phonemes or null. */
type FallbackFn = (token: MToken) => PS;

const DIPHTHONGS = new Set('AIOQWYʤʧ');
const SUBTOKEN_JUNKS = new Set("',-._‘’/");
const PUNCTS = new Set(';:,.!?—…"“”');
const NON_QUOTE_PUNCTS = new Set(Array.from(PUNCTS).filter(p => !'"“”'.includes(p)));
const PUNCT_TAGS = new Set(['.', ',', '-LRB-', '-RRB-', '``', '""', "''", ':', '$', '#', 'NFP']);
const PUNCT_TAG_PHONEMES: Record<string, string> = {
  '-LRB-': '(',
  '-RRB-': ')',
  '``': '“',
  '""': '”',
  "''": '”',
};
const LEXICON_ORDS = new Set([39, 45, ...range(65, 91), ...range(97, 123)]);
const CONSONANTS = new Set('bdfhjklmnpstvwzðŋɡɹɾʃʒʤʧθ');
const US_TAUS = new Set('AIOWYiuæɑəɛɪɹʊʌ');
const CURRENCIES: Record<string, [string, string]> = {
  $: ['dollar', 'cent'],
  '£': ['pound', 'pence'],
  '€': ['euro', 'cent'],
};
const ORDINALS = new Set(['st', 'nd', 'rd', 'th']);
const ADD_SYMBOLS: Record<string, string> = { '.': 'dot', '/': 'slash' };
const SYMBOLS: Record<string, string> = { '%': 'percent', '&': 'and', '+': 'plus', '@': 'at' };
const PRIMARY_STRESS = 'ˈ';
const SECONDARY_STRESS = 'ˌ';
const STRESSES = new Set([SECONDARY_STRESS, PRIMARY_STRESS]);
const VOWELS = new Set('AIOQWYaiuæɑɒɔəɛɜɪʊʌᵻ');
const LINK_REGEX = /\[([^\]]+)\]\(([^)]*)\)/g;
const SUBTOKEN_REGEX =
  /^['‘’]+|\p{Lu}(?=\p{Lu}\p{Ll})|(?:^-)?(?:\p{Nd}?[,.]?\p{Nd})+|[-_]+|['‘’]{2,}|\p{L}*?(?:['‘’]\p{L})*?\p{Ll}(?=\p{Lu})|\p{L}+(?:['‘’]\p{L})*|[^-_\p{L}'‘’\p{Nd}]|['‘’]+$/gu;

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i < b; i++) out.push(i);
  return out;
}

function chars(s: string): string[] {
  return Array.from(s);
}

function last(s: string): string {
  const c = chars(s);
  return c[c.length - 1];
}

function isDigitStr(text: string): boolean {
  return /^[0-9]+$/.test(text);
}

function stressWeight(ps: PS): number {
  if (!ps) return 0;
  let n = 0;
  for (const c of ps) n += DIPHTHONGS.has(c) ? 2 : 1;
  return n;
}

function hasAny(ps: string, set: Set<string>): boolean {
  for (const c of ps) if (set.has(c)) return true;
  return false;
}

/** Move a leading stress mark to just before the first vowel after it. */
function restress(ps: string): string {
  const cs = chars(ps);
  const keyed: Array<[number, string]> = cs.map((c, i) => [i, c]);
  cs.forEach((c, i) => {
    if (!STRESSES.has(c)) return;
    let j = i;
    while (j < cs.length && !VOWELS.has(cs[j])) j++;
    keyed[i] = [j - 0.5, c];
  });
  keyed.sort((a, b) => a[0] - b[0]);
  return keyed.map(([, c]) => c).join('');
}

function applyStress(ps: PS, stress: number | null): PS {
  if (stress === null || ps === null) return ps;
  if (stress < -1) return ps.split(PRIMARY_STRESS).join('').split(SECONDARY_STRESS).join('');
  if (stress === -1 || ((stress === 0 || stress === -0.5) && ps.includes(PRIMARY_STRESS))) {
    return ps.split(SECONDARY_STRESS).join('').split(PRIMARY_STRESS).join(SECONDARY_STRESS);
  }
  if ((stress === 0 || stress === 0.5 || stress === 1) && !hasAny(ps, STRESSES)) {
    if (!hasAny(ps, VOWELS)) return ps;
    return restress(SECONDARY_STRESS + ps);
  }
  if (stress >= 1 && !ps.includes(PRIMARY_STRESS) && ps.includes(SECONDARY_STRESS)) {
    return ps.split(SECONDARY_STRESS).join(PRIMARY_STRESS);
  }
  if (stress > 1 && !hasAny(ps, STRESSES)) {
    if (!hasAny(ps, VOWELS)) return ps;
    return restress(PRIMARY_STRESS + ps);
  }
  return ps;
}

/** Lexicon.grow_dictionary, looked up lazily instead of building a second table. */
function grownGet(d: Lexicon, w: string): LexValue | undefined {
  if (own(d, w)) return d[w];
  // A lowercase key also answers its capitalized form ...
  const lw = pyLower(w);
  if (lw !== w && own(d, lw) && pyLen(lw) >= 2 && lw !== pyCapitalize(lw) && pyCapitalize(lw) === w) {
    return d[lw];
  }
  // ... and a capitalized key its lowercase form.
  const cw = pyCapitalize(w);
  if (cw !== w && own(d, cw) && pyLen(cw) >= 2 && cw !== pyLower(cw) && pyLower(cw) === w
    && cw === pyCapitalize(pyLower(cw))) {
    return d[cw];
  }
  return undefined;
}

function parentTag(tag: string | null): string | null {
  if (tag === null) return tag;
  if (tag.startsWith('VB')) return 'VERB';
  if (tag.startsWith('NN')) return 'NOUN';
  if (tag.startsWith('ADV') || tag.startsWith('RB')) return 'ADV';
  if (tag.startsWith('ADJ') || tag.startsWith('JJ')) return 'ADJ';
  return tag;
}

class EnglishLexicon {
  private readonly capStresses: [number, number] = [0.5, 2];

  constructor(private readonly golds: Lexicon, private readonly silvers: Lexicon) {}

  private gold(w: string): LexValue | undefined {
    return grownGet(this.golds, w);
  }

  private silver(w: string): LexValue | undefined {
    return grownGet(this.silvers, w);
  }

  private goldStr(w: string): string {
    return this.gold(w) as string;
  }

  getNNP(word: string): PS {
    const parts: string[] = [];
    for (const c of word) {
      if (!pyIsAlpha(c)) continue;
      const p = this.gold(pyUpper(c));
      if (p === undefined || p === null) return null;
      parts.push(p as string);
    }
    const ps = applyStress(parts.join(''), 0) as string;
    const at = ps.lastIndexOf(SECONDARY_STRESS);
    return at < 0 ? ps : ps.slice(0, at) + PRIMARY_STRESS + ps.slice(at + SECONDARY_STRESS.length);
  }

  getSpecialCase(word: string, tag: string, stress: number | null, ctx: TokenContext): PS | undefined {
    if (tag === 'ADD' && own(ADD_SYMBOLS, word)) return this.lookup(ADD_SYMBOLS[word], null, -0.5, ctx);
    if (own(SYMBOLS, word)) return this.lookup(SYMBOLS[word], null, null, ctx);
    if (pyStrip(word, '.').includes('.') && pyStrIsAlpha(word.split('.').join(''))
      && Math.max(...word.split('.').map(pyLen)) < 3) {
      return this.getNNP(word);
    }
    if (word === 'a' || word === 'A') return tag === 'DT' ? 'ɐ' : 'ˈA';
    if (word === 'am' || word === 'Am' || word === 'AM') {
      if (tag.startsWith('NN')) return this.getNNP(word);
      if (ctx.futureVowel === null || word !== 'am' || (stress !== null && stress > 0)) {
        return this.goldStr('am');
      }
      return 'ɐm';
    }
    if (word === 'an' || word === 'An' || word === 'AN') {
      if (word === 'AN' && tag.startsWith('NN')) return this.getNNP(word);
      return 'ɐn';
    }
    if (word === 'I' && tag === 'PRP') return `${SECONDARY_STRESS}I`;
    if ((word === 'by' || word === 'By' || word === 'BY') && parentTag(tag) === 'ADV') return 'bˈI';
    if (word === 'to' || word === 'To' || (word === 'TO' && (tag === 'TO' || tag === 'IN'))) {
      if (ctx.futureVowel === null) return this.goldStr('to');
      return ctx.futureVowel ? 'tʊ' : 'tə';
    }
    if (word === 'in' || word === 'In' || (word === 'IN' && tag !== 'NNP')) {
      const s = ctx.futureVowel === null || tag !== 'IN' ? PRIMARY_STRESS : '';
      return s + 'ɪn';
    }
    if (word === 'the' || word === 'The' || (word === 'THE' && tag === 'DT')) {
      return ctx.futureVowel === true ? 'ði' : 'ðə';
    }
    if (tag === 'IN' && /^vs\.?$/i.test(word)) return this.lookup('versus', null, null, ctx);
    if (word === 'used' || word === 'Used' || word === 'USED') {
      const used = this.gold('used') as Record<string, string>;
      if ((tag === 'VBD' || tag === 'JJ') && ctx.futureTo) return used.VBD;
      return used.DEFAULT;
    }
    return undefined;
  }

  // `_tag` is unused, as in misaki's is_known(word, tag)
  isKnown(word: string, _tag: string | null): boolean {
    if (this.gold(word) !== undefined || own(SYMBOLS, word) || this.silver(word) !== undefined) return true;
    if (!pyStrIsAlpha(word) || !chars(word).every(c => LEXICON_ORDS.has(c.codePointAt(0) as number))) {
      return false;
    }
    if (pyLen(word) === 1) return true;
    if (word === pyUpper(word) && this.gold(pyLower(word)) !== undefined) return true;
    const rest = chars(word).slice(1).join('');
    return rest === pyUpper(rest);
  }

  lookup(word: string, tag: string | null, stress: number | null, ctx: TokenContext | null): PS {
    let isNNP: boolean | null = null;
    if (word === pyUpper(word) && this.gold(word) === undefined) {
      word = pyLower(word);
      isNNP = tag === 'NNP';
    }
    let ps: LexValue | null | undefined = this.gold(word);
    if (ps === undefined && !isNNP) ps = this.silver(word);
    if (ps !== undefined && ps !== null && typeof ps === 'object') {
      const dict = ps;
      let key = tag;
      if (ctx && ctx.futureVowel === null && own(dict, 'None')) key = 'None';
      else if (key === null || !own(dict, key)) key = parentTag(key);
      ps = key !== null && own(dict, key) ? dict[key] : dict.DEFAULT;
    }
    const value = ps === undefined ? null : (ps as string | null);
    if (value === null || (isNNP && !value.includes(PRIMARY_STRESS))) {
      const nnp = this.getNNP(word);
      if (nnp !== null) return nnp;
    }
    return applyStress(value, stress);
  }

  private s(stem: PS): PS {
    if (!stem) return null;
    const c = last(stem);
    if ('ptkfθ'.includes(c)) return stem + 's';
    if ('szʃʒʧʤ'.includes(c)) return stem + 'ᵻz';
    return stem + 'z';
  }

  stemS(word: string, tag: string | null, stress: number | null, ctx: TokenContext | null): PS {
    const n = pyLen(word);
    if (n < 3 || !word.endsWith('s')) return null;
    let stem: string;
    if (!word.endsWith('ss') && this.isKnown(word.slice(0, -1), tag)) stem = word.slice(0, -1);
    else if ((word.endsWith("'s") || (n > 4 && word.endsWith('es') && !word.endsWith('ies')))
      && this.isKnown(word.slice(0, -2), tag)) stem = word.slice(0, -2);
    else if (n > 4 && word.endsWith('ies') && this.isKnown(word.slice(0, -3) + 'y', tag)) {
      stem = word.slice(0, -3) + 'y';
    } else return null;
    return this.s(this.lookup(stem, tag, stress, ctx));
  }

  private ed(stem: PS): PS {
    if (!stem) return null;
    const c = last(stem);
    if ('pkfθʃsʧ'.includes(c)) return stem + 't';
    if (c === 'd') return stem + 'ᵻd';
    if (c !== 't') return stem + 'd';
    const cs = chars(stem);
    if (cs.length < 2) return stem + 'ɪd';
    if (US_TAUS.has(cs[cs.length - 2])) return cs.slice(0, -1).join('') + 'ɾᵻd';
    return stem + 'ᵻd';
  }

  stemEd(word: string, tag: string | null, stress: number | null, ctx: TokenContext | null): PS {
    const n = pyLen(word);
    if (n < 4 || !word.endsWith('d')) return null;
    let stem: string;
    if (!word.endsWith('dd') && this.isKnown(word.slice(0, -1), tag)) stem = word.slice(0, -1);
    else if (n > 4 && word.endsWith('ed') && !word.endsWith('eed') && this.isKnown(word.slice(0, -2), tag)) {
      stem = word.slice(0, -2);
    } else return null;
    return this.ed(this.lookup(stem, tag, stress, ctx));
  }

  private ing(stem: PS): PS {
    if (!stem) return null;
    const cs = chars(stem);
    if (cs.length > 1 && cs[cs.length - 1] === 't' && US_TAUS.has(cs[cs.length - 2])) {
      return cs.slice(0, -1).join('') + 'ɾɪŋ';
    }
    return stem + 'ɪŋ';
  }

  stemIng(word: string, tag: string | null, stress: number | null, ctx: TokenContext | null): PS {
    const n = pyLen(word);
    if (n < 5 || !word.endsWith('ing')) return null;
    let stem: string;
    if (n > 5 && this.isKnown(word.slice(0, -3), tag)) stem = word.slice(0, -3);
    else if (this.isKnown(word.slice(0, -3) + 'e', tag)) stem = word.slice(0, -3) + 'e';
    else if (n > 5 && /([bcdgklmnprstvxz])\1ing$|cking$/.test(word) && this.isKnown(word.slice(0, -4), tag)) {
      stem = word.slice(0, -4);
    } else return null;
    return this.ing(this.lookup(stem, tag, stress, ctx));
  }

  getWord(word: string, tag: string, stress: number | null, ctx: TokenContext): PS {
    const special = this.getSpecialCase(word, tag, stress, ctx);
    if (special !== undefined && special !== null) return special;
    const wl = pyLower(word);
    const rest = chars(word).slice(1).join('');
    if (pyLen(word) > 1 && pyStrIsAlpha(word.split("'").join('')) && word !== pyLower(word)
      && (tag !== 'NNP' || pyLen(word) > 7)
      && this.gold(word) === undefined && this.silver(word) === undefined
      && (word === pyUpper(word) || rest === pyLower(rest))
      && (this.gold(wl) !== undefined || this.silver(wl) !== undefined
        || [this.stemS, this.stemEd, this.stemIng].some(fn => !!fn.call(this, wl, tag, stress, ctx)))) {
      word = wl;
    }
    if (this.isKnown(word, tag)) return this.lookup(word, tag, stress, ctx);
    if (word.endsWith("s'") && this.isKnown(word.slice(0, -2) + "'s", tag)) {
      return this.lookup(word.slice(0, -2) + "'s", tag, stress, ctx);
    }
    if (word.endsWith("'") && this.isKnown(word.slice(0, -1), tag)) {
      return this.lookup(word.slice(0, -1), tag, stress, ctx);
    }
    const s = this.stemS(word, tag, stress, ctx);
    if (s !== null) return s;
    const ed = this.stemEd(word, tag, stress, ctx);
    if (ed !== null) return ed;
    return this.stemIng(word, tag, stress === null ? 0.5 : stress, ctx);
  }

  private static isCurrency(word: string): boolean {
    if (!word.includes('.')) return true;
    if (word.split('.').length - 1 > 1) return false;
    return pyLen(word.split('.')[1]) < 3;
  }

  getNumber(word: string, currency: string | null, isHead: boolean, numFlags: string): PS {
    const sm = /[a-z']+$/.exec(word);
    const suffix = sm ? sm[0] : null;
    if (suffix) word = word.slice(0, word.length - suffix.length);
    const result: PS[] = [];
    if (word.startsWith('-')) {
      result.push(this.lookup('minus', null, null, null));
      word = word.slice(1);
    }
    const extendNum = (num: string, first = true, escape = false) => {
      const splits = (escape ? num : num2words(num)).split(/[^a-z]+/);
      splits.forEach((w, i) => {
        if (w !== 'and' || numFlags.includes('&')) {
          if (first && i === 0 && splits.length > 1 && w === 'one' && numFlags.includes('a')) {
            result.push('ə');
          } else {
            result.push(this.lookup(w, null, w === 'point' ? -2 : null, null));
          }
        } else if (w === 'and' && numFlags.includes('n') && result.length) {
          result[result.length - 1] = result[result.length - 1] + 'ən';
        }
      });
    };
    if (isDigitStr(word) && suffix !== null && ORDINALS.has(suffix)) {
      extendNum(num2words(word, 'ordinal'), true, true);
    } else if (result.length === 0 && word.length === 4 && !(currency !== null && own(CURRENCIES, currency))
      && isDigitStr(word)) {
      extendNum(num2words(word, 'year'), true, true);
    } else if (!isHead && !word.includes('.')) {
      const num = word.split(',').join('');
      if (num[0] === '0' || num.length > 3) {
        for (const n of num) extendNum(n, false);
      } else if (num.length === 3 && !num.endsWith('00')) {
        extendNum(num[0]);
        if (num[1] === '0') {
          result.push(this.lookup('O', null, -2, null));
          extendNum(num[2], false);
        } else {
          extendNum(num.slice(1), false);
        }
      } else {
        extendNum(num);
      }
    } else if (word.split('.').length - 1 > 1 || !isHead) {
      let first = true;
      for (const num of word.split(',').join('').split('.')) {
        if (!num) {
          // skip
        } else if (num[0] === '0' || (num.length !== 2 && Array.from(num.slice(1)).some(n => n !== '0'))) {
          for (const n of num) extendNum(n, false);
        } else {
          extendNum(num, first);
        }
        first = false;
      }
    } else if (currency !== null && own(CURRENCIES, currency) && EnglishLexicon.isCurrency(word)) {
      let pairs: Array<[number, string]> = word.split(',').join('').split('.')
        .slice(0, 2)
        .map((num, i) => [num ? parseInt(num, 10) : 0, CURRENCIES[currency][i]]);
      if (pairs.length > 1) {
        if (pairs[1][0] === 0) pairs = pairs.slice(0, 1);
        else if (pairs[0][0] === 0) pairs = pairs.slice(1);
      }
      pairs.forEach(([num, unit], i) => {
        if (i > 0) result.push(this.lookup('and', null, null, null));
        extendNum(String(num), i === 0);
        result.push(Math.abs(num) !== 1 && unit !== 'pence'
          ? this.stemS(unit + 's', null, null, null)
          : this.lookup(unit, null, null, null));
      });
    } else {
      let w: string;
      if (isDigitStr(word)) {
        w = num2words(word, 'cardinal');
      } else if (!word.includes('.')) {
        w = num2words(word.split(',').join(''), suffix !== null && ORDINALS.has(suffix) ? 'ordinal' : 'cardinal');
      } else {
        w = word.split(',').join('');
        if (w[0] === '.') {
          w = 'point ' + Array.from(w.slice(1)).map(n => num2words(n)).join(' ');
        } else {
          w = num2words(Number(w));
        }
      }
      extendNum(w, true, true);
    }
    if (result.length === 0) return null;
    const joined = result.join(' ');
    if (suffix === 's' || suffix === "'s") return this.s(joined);
    if (suffix === 'ed' || suffix === "'d") return this.ed(joined);
    if (suffix === 'ing') return this.ing(joined);
    return joined;
  }

  appendCurrency(ps: PS, currency: string | null): PS {
    if (!currency) return ps;
    const c = own(CURRENCIES, currency) ? CURRENCIES[currency] : null;
    const word = c ? this.stemS(c[0] + 's', null, null, null) : null;
    return word ? `${ps} ${word}` : ps;
  }

  /** str(int(unicodedata.numeric(c))) for every str.isdigit() character (all are 0-9). */
  private static numericIfNeeded(c: string): string {
    return pyIsDigit(c) ? String(digitValue(c)) : c;
  }

  private static isNumber(word: string, isHead: boolean): boolean {
    if (chars(word).every(c => !isDigitStr(c))) return false;
    for (const s of ['ing', "'d", 'ed', "'s", ...ORDINALS, 's']) {
      if (word.endsWith(s)) {
        word = word.slice(0, word.length - s.length);
        break;
      }
    }
    return chars(word).every((c, i) => isDigitStr(c) || c === ',' || c === '.' || (isHead && i === 0 && c === '-'));
  }

  call(tk: MToken, ctx: TokenContext): PS {
    let word = (tk.alias === null ? tk.text : tk.alias).split('‘').join("'").split('’').join("'");
    word = pyNormalize(word, 'NFKC');
    word = chars(word).map(EnglishLexicon.numericIfNeeded).join('');
    const stress = word === pyLower(word) ? null : this.capStresses[word === pyUpper(word) ? 1 : 0];
    const ps = this.getWord(word, tk.tag, stress, ctx);
    if (ps !== null) return applyStress(this.appendCurrency(ps, tk.currency), tk.stress);
    if (EnglishLexicon.isNumber(word, tk.isHead)) {
      return applyStress(this.getNumber(word, tk.currency, tk.isHead, tk.numFlags), tk.stress);
    }
    return null;
  }
}

function newToken(text: string, tag: string, whitespace: string): MToken {
  return {
    text, tag, whitespace, phonemes: null, isHead: true, alias: null, stress: null,
    currency: null, numFlags: '', prespace: false,
  };
}

/** merge_tokens: several tokens as one, for lexicon lookups and the output. */
function mergeTokens(tokens: MToken[], unk: string | null = null): MToken {
  const stress = new Set(tokens.filter(t => t.stress !== null).map(t => t.stress as number));
  const currency = tokens.filter(t => t.currency !== null).map(t => t.currency as string);
  let phonemes: PS;
  if (unk === null) {
    phonemes = null;
  } else {
    phonemes = '';
    for (const tk of tokens) {
      if (tk.prespace && phonemes && !pyIsSpaceChar(last(phonemes)) && tk.phonemes) phonemes += ' ';
      phonemes += tk.phonemes === null ? unk : tk.phonemes;
    }
  }
  const weight = (t: MToken) => chars(t.text).reduce((n, c) => n + (c === pyLower(c) ? 1 : 2), 0);
  let best = tokens[0];
  for (const t of tokens) if (weight(t) > weight(best)) best = t;
  const flags = Array.from(new Set(tokens.flatMap(t => chars(t.numFlags)))).sort();
  return {
    text: tokens.slice(0, -1).map(t => t.text + t.whitespace).join('') + tokens[tokens.length - 1].text,
    tag: best.tag,
    whitespace: tokens[tokens.length - 1].whitespace,
    phonemes,
    isHead: tokens[0].isHead,
    alias: null,
    stress: stress.size === 1 ? Array.from(stress)[0] : null,
    currency: currency.length ? currency.reduce((a, b) => (b > a ? b : a)) : null,
    numFlags: flags.join(''),
    prespace: tokens[0].prespace,
  };
}

type Word = MToken | MToken[];

export class MisakiG2P {
  private readonly lexicon: EnglishLexicon;

  constructor(
    private readonly tokenizer: SpacyTokenizer,
    private readonly tagger: SpacyTagger,
    golds: Lexicon,
    silvers: Lexicon,
    private readonly fallback: FallbackFn,
    private readonly unk: string,
  ) {
    this.lexicon = new EnglishLexicon(golds, silvers);
  }

  /** G2P.__call__ with preprocess=True: the phoneme string. */
  async phonemize(text: string): Promise<string> {
    const pre = MisakiG2P.preprocess(text);
    let tokens = await this.tokenize(pre.text, pre.tokens, pre.features);
    tokens = this.foldLeft(tokens);
    const words = MisakiG2P.retokenize(tokens);
    let ctx: TokenContext = { futureVowel: null, futureTo: false };
    for (let i = words.length - 1; i >= 0; i--) {
      const w = words[i];
      if (!Array.isArray(w)) {
        if (w.phonemes === null) w.phonemes = this.lexicon.call(w, ctx);
        if (w.phonemes === null) w.phonemes = this.fallback(w);
        ctx = MisakiG2P.tokenContext(ctx, w.phonemes, w);
        continue;
      }
      let left = 0;
      let right = w.length;
      let shouldFallback = false;
      while (left < right) {
        const span = w.slice(left, right);
        const tk = span.some(t => t.alias !== null || t.phonemes !== null) ? null : mergeTokens(span);
        const ps = tk === null ? null : this.lexicon.call(tk, ctx);
        if (ps !== null && tk !== null) {
          w[left].phonemes = ps;
          for (const x of w.slice(left + 1, right)) x.phonemes = '';
          ctx = MisakiG2P.tokenContext(ctx, ps, tk);
          right = left;
          left = 0;
        } else if (left + 1 < right) {
          left += 1;
        } else {
          right -= 1;
          const t = w[right];
          if (t.phonemes === null) {
            if (chars(t.text).every(c => SUBTOKEN_JUNKS.has(c))) {
              t.phonemes = '';
            } else {
              shouldFallback = true;
              break;
            }
          }
          left = 0;
        }
      }
      if (shouldFallback) {
        const tk = mergeTokens(w);
        w[0].phonemes = this.fallback(tk);
        for (let j = 1; j < w.length; j++) w[j].phonemes = '';
      } else {
        MisakiG2P.resolveTokens(w);
      }
    }
    const out = words.map(w => (Array.isArray(w) ? mergeTokens(w, this.unk) : w));
    for (const tk of out) {
      if (tk.phonemes) tk.phonemes = tk.phonemes.split('ɾ').join('T').split('ʔ').join('t');
    }
    return out.map(tk => (tk.phonemes === null ? this.unk : tk.phonemes) + tk.whitespace).join('');
  }

  private static preprocess(text: string): {
    text: string;
    tokens: string[];
    features: Map<number, number | string>;
  } {
    let result = '';
    const tokens: string[] = [];
    const features = new Map<number, number | string>();
    let lastEnd = 0;
    text = pyLstripSpace(text);
    for (const m of text.matchAll(LINK_REGEX)) {
      const start = m.index as number;
      result += text.slice(lastEnd, start);
      tokens.push(...pySplitSpace(text.slice(lastEnd, start)));
      let f: string | number | null = m[2];
      const head = f.slice(0, 1) === '-' || f.slice(0, 1) === '+' ? 1 : 0;
      if (isDigitStr(f.slice(head))) f = parseInt(f, 10);
      else if (f === '0.5' || f === '+0.5') f = 0.5;
      else if (f === '-0.5') f = -0.5;
      else if (pyLen(f) > 1 && f[0] === '/' && f[f.length - 1] === '/') f = f[0] + pyRstrip(f.slice(1), '/');
      else if (pyLen(f) > 1 && f[0] === '#' && f[f.length - 1] === '#') f = f[0] + pyRstrip(f.slice(1), '#');
      else f = null;
      if (f !== null) features.set(tokens.length, f);
      result += m[1];
      tokens.push(m[1]);
      lastEnd = start + m[0].length;
    }
    if (lastEnd < text.length) {
      result += text.slice(lastEnd);
      tokens.push(...pySplitSpace(text.slice(lastEnd)));
    }
    return { text: result, tokens, features };
  }

  private async tokenize(
    text: string,
    words: string[],
    features: Map<number, number | string>,
  ): Promise<MToken[]> {
    const doc = this.tokenizer.tokenize(text);
    const tags = await this.tagger.tag(doc);
    const tokens = doc.map((t, i) => newToken(t.text, tags[i], t.spacy ? ' ' : ''));
    if (features.size === 0) return tokens;
    const y2x = alignY2X(words, tokens.map(t => t.text));
    for (const [k, v] of features) {
      let i = 0;
      // misaki en.py quirk, kept on purpose: j is a position in the flattened
      // align.y2x.data, used as if it were a token index
      y2x.forEach((x, j) => {
        if (x !== k) return;
        const idx = i++;
        if (j >= tokens.length) return;
        if (typeof v !== 'string') {
          tokens[j].stress = v;
        } else if (v.startsWith('/')) {
          tokens[j].isHead = idx === 0;
          tokens[j].phonemes = idx === 0 ? v.replace(/^\/+/, '') : '';
        } else if (v.startsWith('#')) {
          tokens[j].numFlags = v.replace(/^#+/, '');
        }
      });
    }
    return tokens;
  }

  private foldLeft(tokens: MToken[]): MToken[] {
    const result: MToken[] = [];
    for (const tk of tokens) {
      result.push(result.length && !tk.isHead ? mergeTokens([result.pop() as MToken, tk], this.unk) : tk);
    }
    return result;
  }

  private static retokenize(tokens: MToken[]): Word[] {
    const words: Word[] = [];
    let currency: string | null = null;
    tokens.forEach((token, i) => {
      let tks: MToken[];
      if (token.alias === null && token.phonemes === null) {
        tks = Array.from(token.text.matchAll(SUBTOKEN_REGEX), m => ({
          ...newToken(m[0], token.tag, ''),
          numFlags: token.numFlags,
          stress: token.stress,
        }));
      } else {
        tks = [token];
      }
      tks[tks.length - 1].whitespace = token.whitespace;
      tks.forEach((tk, j) => {
        if (tk.alias !== null || tk.phonemes !== null) {
          // keep
        } else if (tk.tag === '$' && own(CURRENCIES, tk.text)) {
          currency = tk.text;
          tk.phonemes = '';
        } else if (tk.tag === ':' && (tk.text === '-' || tk.text === '–')) {
          tk.phonemes = '—';
        } else if (PUNCT_TAGS.has(tk.tag)
          && !chars(tk.text).every(c => {
            const o = pyLower(c).codePointAt(0) as number;
            return o >= 97 && o <= 122;
          })) {
          tk.phonemes = own(PUNCT_TAG_PHONEMES, tk.tag)
            ? PUNCT_TAG_PHONEMES[tk.tag]
            : chars(tk.text).filter(c => PUNCTS.has(c)).join('');
        } else if (currency !== null) {
          if (tk.tag !== 'CD') currency = null;
          else if (j + 1 === tks.length && (i + 1 === tokens.length || tokens[i + 1].tag !== 'CD')) {
            tk.currency = currency;
          }
        } else if (j > 0 && j < tks.length - 1 && tk.text === '2'
          && pyStrIsAlpha(last(tks[j - 1].text) + chars(tks[j + 1].text)[0])) {
          tk.alias = 'to';
        }
        if (tk.alias !== null || tk.phonemes !== null) {
          words.push(tk);
        } else if (words.length && Array.isArray(words[words.length - 1])
          && !(words[words.length - 1] as MToken[])[(words[words.length - 1] as MToken[]).length - 1].whitespace) {
          tk.isHead = false;
          (words[words.length - 1] as MToken[]).push(tk);
        } else {
          words.push(tk.whitespace ? tk : [tk]);
        }
      });
    });
    return words.map(w => (Array.isArray(w) && w.length === 1 ? w[0] : w));
  }

  private static tokenContext(ctx: TokenContext, ps: PS, token: MToken): TokenContext {
    let vowel = ctx.futureVowel;
    if (ps) {
      for (const c of ps) {
        if (VOWELS.has(c) || CONSONANTS.has(c) || NON_QUOTE_PUNCTS.has(c)) {
          vowel = NON_QUOTE_PUNCTS.has(c) ? null : VOWELS.has(c);
          break;
        }
      }
    }
    const futureTo = token.text === 'to' || token.text === 'To'
      || (token.text === 'TO' && (token.tag === 'TO' || token.tag === 'IN'));
    return { futureVowel: vowel, futureTo };
  }

  private static resolveTokens(tokens: MToken[]): void {
    const text = tokens.slice(0, -1).map(t => t.text + t.whitespace).join('') + tokens[tokens.length - 1].text;
    const kinds = new Set<number>();
    for (const c of text) {
      if (SUBTOKEN_JUNKS.has(c)) continue;
      kinds.add(pyIsAlpha(c) ? 0 : isDigitStr(c) ? 1 : 2);
    }
    const prespace = text.includes(' ') || text.includes('/') || kinds.size > 1;
    tokens.forEach((tk, i) => {
      if (tk.phonemes === null) {
        if (i === tokens.length - 1 && NON_QUOTE_PUNCTS.has(tk.text)) {
          tk.phonemes = tk.text;
        } else if (chars(tk.text).every(c => SUBTOKEN_JUNKS.has(c))) {
          tk.phonemes = '';
        }
      } else if (i > 0) {
        tk.prespace = prespace;
      }
    });
    if (prespace) return;
    let indices: Array<[boolean, number, number]> = [];
    tokens.forEach((tk, i) => {
      if (tk.phonemes) indices.push([tk.phonemes.includes(PRIMARY_STRESS), stressWeight(tk.phonemes), i]);
    });
    if (indices.length === 2 && pyLen(tokens[indices[0][2]].text) === 1) {
      const i = indices[1][2];
      tokens[i].phonemes = applyStress(tokens[i].phonemes, -0.5);
      return;
    }
    const primaries = indices.reduce((n, [b]) => n + (b ? 1 : 0), 0);
    if (indices.length < 2 || primaries <= Math.floor((indices.length + 1) / 2)) return;
    indices = indices
      .slice()
      .sort((a, b) => (a[0] === b[0] ? (a[1] === b[1] ? a[2] - b[2] : a[1] - b[1]) : a[0] ? 1 : -1))
      .slice(0, Math.floor(indices.length / 2));
    for (const [, , i] of indices) tokens[i].phonemes = applyStress(tokens[i].phonemes, -0.5);
  }
}

/**
 * spacy.training.Alignment.from_strings(x, y).y2x.data: for each character-aligned
 * y token, the x tokens it overlaps, flattened.
 */
function alignY2X(x: string[], y: string[]): number[] {
  const owner = (toks: string[]) => {
    const out: number[] = [];
    toks.forEach((t, i) => {
      for (const c of t) if (!pyIsSpaceChar(c)) for (let k = 0; k < c.length; k++) out.push(i);
    });
    return out;
  };
  const xo = owner(x);
  const yo = owner(y);
  const data: number[] = [];
  let pos = 0;
  y.forEach((t, j) => {
    const seen: number[] = [];
    let n = 0;
    for (const c of t) if (!pyIsSpaceChar(c)) n += c.length;
    for (let k = 0; k < n; k++, pos++) {
      const xi = xo[pos];
      if (xi !== undefined && yo[pos] === j && !seen.includes(xi)) seen.push(xi);
    }
    data.push(...seen);
  });
  return data;
}
