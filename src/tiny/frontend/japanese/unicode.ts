// Python 3.12 string semantics the Japanese G2P needs, with Python's own Unicode 15.0 tables
// (from cutlet.bin) so a phone gives the same answer whatever its ICU version:
//   unicodedata.normalize('NFKC', s)   NFKD + canonical reordering + canonical composition
//   the regex \d                       Unicode Nd
//   str.isdigit()                      Numeric_Type Digit or Decimal
//   str.isspace(), the regex \s        Python's whitespace set (fixed; every one is in the BMP)

import type { Container } from './container';
import { isPySpace } from '../pystr';

/** re.sub(r'\s+', ' ', s) */
export function collapseSpaces(s: string): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (isPySpace(s.charCodeAt(i))) {
      while (i < s.length && isPySpace(s.charCodeAt(i))) i++;
      out += ' ';
    } else {
      const start = i;
      while (i < s.length && !isPySpace(s.charCodeAt(i))) i++;
      out += s.slice(start, i);
    }
  }
  return out;
}

/** A UTF-16 string from a slice of code units, without TextDecoder. */
export function unitsToString(units: Uint16Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end; i += 4096) {
    s += String.fromCharCode.apply(null, Array.from(units.subarray(i, Math.min(end, i + 4096))));
  }
  return s;
}

/** The code points of a string (lone surrogates as themselves, as in Python). */
export function codePoints(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        out.push(((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000);
        i++;
        continue;
      }
    }
    out.push(c);
  }
  return out;
}

function inRanges(ranges: Uint32Array, cp: number): boolean {
  // [start, end) pairs, sorted
  let lo = 0;
  let hi = ranges.length >> 1;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (ranges[2 * m + 1] <= cp) lo = m + 1;
    else hi = m;
  }
  return lo < ranges.length >> 1 && ranges[2 * lo] <= cp;
}

// Hangul syllables (UAX #15, CPython unicodedata)
const S_BASE = 0xac00;
const L_BASE = 0x1100;
const V_BASE = 0x1161;
const T_BASE = 0x11a7;
const L_COUNT = 19;
const V_COUNT = 21;
const T_COUNT = 28;
const N_COUNT = V_COUNT * T_COUNT;
const S_COUNT = L_COUNT * N_COUNT;

export class PyUnicode {
  private readonly dec = new Map<number, number[]>();
  private readonly ccc = new Map<number, number>();
  private readonly comp = new Map<number, number>();
  private readonly nd: Uint32Array;
  private readonly digit: Uint32Array;

  constructor(c: Container) {
    const decCp = c.u32('decCp');
    const decOff = c.u32('decOff');
    const decChars = c.u16('decChars');
    for (let i = 0; i < decCp.length; i++) {
      let s = '';
      for (let j = decOff[i]; j < decOff[i + 1]; j++) s += String.fromCharCode(decChars[j]);
      this.dec.set(decCp[i], codePoints(s));
    }
    const cccCp = c.u32('cccCp');
    const cccVal = c.u8('cccVal');
    for (let i = 0; i < cccCp.length; i++) this.ccc.set(cccCp[i], cccVal[i]);
    const pairs = c.u32('compPairs');
    for (let i = 0; i < pairs.length; i += 3) this.comp.set(pairs[i] * 0x110000 + pairs[i + 1], pairs[i + 2]);
    this.nd = c.u32('ndRanges');
    this.digit = c.u32('digitRanges');
  }

  /** One code point is in the regex class \d (Unicode Nd). */
  isNd(cp: number): boolean {
    return cp >= 0x30 && cp <= 0x39 ? true : cp < 0x80 ? false : inRanges(this.nd, cp);
  }

  /** str.isdigit() of one code point. */
  isDigitChar(cp: number): boolean {
    return cp >= 0x30 && cp <= 0x39 ? true : cp < 0x80 ? false : inRanges(this.digit, cp);
  }

  /** str.isdigit() of a string. */
  isDigit(s: string): boolean {
    if (!s) return false;
    for (const cp of codePoints(s)) if (!this.isDigitChar(cp)) return false;
    return true;
  }

  private cccOf(cp: number): number {
    return this.ccc.get(cp) ?? 0;
  }

  private compose(a: number, b: number): number {
    if (a >= L_BASE && a < L_BASE + L_COUNT && b >= V_BASE && b < V_BASE + V_COUNT) {
      return S_BASE + ((a - L_BASE) * V_COUNT + (b - V_BASE)) * T_COUNT;
    }
    if (a >= S_BASE && a < S_BASE + S_COUNT && (a - S_BASE) % T_COUNT === 0 && b > T_BASE && b < T_BASE + T_COUNT) {
      return a + (b - T_BASE);
    }
    return this.comp.get(a * 0x110000 + b) ?? -1;
  }

  /** unicodedata.normalize('NFKC', s) */
  nfkc(s: string): string {
    let simple = true;
    for (let i = 0; i < s.length; i++) {
      if (s.charCodeAt(i) >= 0xa0) {
        simple = false;
        break;
      }
    }
    if (simple) return s;   // U+0000..U+009F: no decompositions, nothing composes with them
    // Full compatibility decomposition.
    const cps: number[] = [];
    for (const cp of codePoints(s)) {
      if (cp >= S_BASE && cp < S_BASE + S_COUNT) {
        const si = cp - S_BASE;
        cps.push(L_BASE + Math.floor(si / N_COUNT), V_BASE + Math.floor((si % N_COUNT) / T_COUNT));
        if (si % T_COUNT) cps.push(T_BASE + (si % T_COUNT));
        continue;
      }
      const d = this.dec.get(cp);
      if (d) for (const x of d) cps.push(x);
      else cps.push(cp);
    }
    // Canonical ordering: a stable sort of each run of non-starters by combining class.
    const cc = cps.map(cp => this.cccOf(cp));
    for (let i = 1; i < cps.length; i++) {
      const c = cc[i];
      if (c === 0) continue;
      const cp = cps[i];
      let j = i;
      while (j > 0 && cc[j - 1] > c) {
        cps[j] = cps[j - 1];
        cc[j] = cc[j - 1];
        j--;
      }
      cps[j] = cp;
      cc[j] = c;
    }
    return this.composeAll(cps);
  }

  private composeAll(cps: number[]): string {
    const out: number[] = [];
    const outCcc: number[] = [];
    let starter = -1;
    for (const cp of cps) {
      const c = this.cccOf(cp);
      if (starter >= 0) {
        const last = out.length - 1;
        // Not blocked: adjacent to the starter, or every character between has a lower class.
        if (last === starter || (outCcc[last] !== 0 && outCcc[last] < c)) {
          const comp = this.compose(out[starter], cp);
          if (comp >= 0) {
            out[starter] = comp;
            continue;
          }
        }
      }
      if (c === 0) starter = out.length;
      out.push(cp);
      outCcc.push(c);
    }
    let r = '';
    for (const cp of out) r += String.fromCodePoint(cp);
    return r;
  }
}
