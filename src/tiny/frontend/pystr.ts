// Python str semantics the ported text code depends on. JavaScript's own methods
// differ in small ways (context-sensitive lowercasing, UTF-16 lengths, ASCII-only
// \d, a different whitespace set), and phoneme strings must come out identical to
// Python's. Shared by the English, espeak and Japanese front ends. The digit and
// combining-class tables come from Python 3.12's unicodedata (Unicode 15.0), so they
// don't depend on the JavaScript engine's Unicode version.

const ALPHA = /^\p{L}$/u;
const UPPER = /^\p{Lu}$/u;

/** First code point of each run of ten decimal (Nd) digits: what int() and re's \d read. */
const ND_ZEROS = [
  0x30, 0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66, 0xbe6, 0xc66, 0xce6, 0xd66,
  0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80,
  0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50,
  0xabf0, 0xff10, 0x104a0, 0x10d30, 0x11066, 0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450,
  0x114d0, 0x11650, 0x116c0, 0x11730, 0x118e0, 0x11950, 0x11c50, 0x11d50, 0x11da0, 0x11f50,
  0x16a60, 0x16ac0, 0x16b50, 0x1d7ce, 0x1d7d8, 0x1d7e2, 0x1d7ec, 0x1d7f6, 0x1e140, 0x1e2f0,
  0x1e4f0, 0x1e950, 0x1fbf0,
];
/** The other characters str.isdigit() accepts (², ①, ❶, ...): [first, last, value of first]. */
const OTHER_DIGITS = [
  0xb2, 0xb3, 2, 0xb9, 0xb9, 1, 0x1369, 0x1371, 1, 0x19da, 0x19da, 1, 0x2070, 0x2070, 0,
  0x2074, 0x2079, 4, 0x2080, 0x2089, 0, 0x2460, 0x2468, 1, 0x2474, 0x247c, 1,
  0x2488, 0x2490, 1, 0x24ea, 0x24ea, 0, 0x24f5, 0x24fd, 1, 0x24ff, 0x24ff, 0,
  0x2776, 0x277e, 1, 0x2780, 0x2788, 1, 0x278a, 0x2792, 1, 0x10a40, 0x10a43, 1,
  0x10e60, 0x10e68, 1, 0x11052, 0x1105a, 1, 0x1f100, 0x1f100, 0, 0x1f101, 0x1f10a, 0,
];
/** [first, last] runs of the characters with unicodedata.combining(c) != 0. */
const COMBINING = [
  0x300, 0x34e, 0x350, 0x36f, 0x483, 0x487, 0x591, 0x5bd, 0x5bf, 0x5bf, 0x5c1, 0x5c2,
  0x5c4, 0x5c5, 0x5c7, 0x5c7, 0x610, 0x61a, 0x64b, 0x65f, 0x670, 0x670, 0x6d6, 0x6dc,
  0x6df, 0x6e4, 0x6e7, 0x6e8, 0x6ea, 0x6ed, 0x711, 0x711, 0x730, 0x74a, 0x7eb, 0x7f3,
  0x7fd, 0x7fd, 0x816, 0x819, 0x81b, 0x823, 0x825, 0x827, 0x829, 0x82d, 0x859, 0x85b,
  0x898, 0x89f, 0x8ca, 0x8e1, 0x8e3, 0x8ff, 0x93c, 0x93c, 0x94d, 0x94d, 0x951, 0x954,
  0x9bc, 0x9bc, 0x9cd, 0x9cd, 0x9fe, 0x9fe, 0xa3c, 0xa3c, 0xa4d, 0xa4d, 0xabc, 0xabc,
  0xacd, 0xacd, 0xb3c, 0xb3c, 0xb4d, 0xb4d, 0xbcd, 0xbcd, 0xc3c, 0xc3c, 0xc4d, 0xc4d,
  0xc55, 0xc56, 0xcbc, 0xcbc, 0xccd, 0xccd, 0xd3b, 0xd3c, 0xd4d, 0xd4d, 0xdca, 0xdca,
  0xe38, 0xe3a, 0xe48, 0xe4b, 0xeb8, 0xeba, 0xec8, 0xecb, 0xf18, 0xf19, 0xf35, 0xf35,
  0xf37, 0xf37, 0xf39, 0xf39, 0xf71, 0xf72, 0xf74, 0xf74, 0xf7a, 0xf7d, 0xf80, 0xf80,
  0xf82, 0xf84, 0xf86, 0xf87, 0xfc6, 0xfc6, 0x1037, 0x1037, 0x1039, 0x103a, 0x108d, 0x108d,
  0x135d, 0x135f, 0x1714, 0x1715, 0x1734, 0x1734, 0x17d2, 0x17d2, 0x17dd, 0x17dd,
  0x18a9, 0x18a9, 0x1939, 0x193b, 0x1a17, 0x1a18, 0x1a60, 0x1a60, 0x1a75, 0x1a7c,
  0x1a7f, 0x1a7f, 0x1ab0, 0x1abd, 0x1abf, 0x1ace, 0x1b34, 0x1b34, 0x1b44, 0x1b44,
  0x1b6b, 0x1b73, 0x1baa, 0x1bab, 0x1be6, 0x1be6, 0x1bf2, 0x1bf3, 0x1c37, 0x1c37,
  0x1cd0, 0x1cd2, 0x1cd4, 0x1ce0, 0x1ce2, 0x1ce8, 0x1ced, 0x1ced, 0x1cf4, 0x1cf4,
  0x1cf8, 0x1cf9, 0x1dc0, 0x1dff, 0x20d0, 0x20dc, 0x20e1, 0x20e1, 0x20e5, 0x20f0,
  0x2cef, 0x2cf1, 0x2d7f, 0x2d7f, 0x2de0, 0x2dff, 0x302a, 0x302f, 0x3099, 0x309a,
  0xa66f, 0xa66f, 0xa674, 0xa67d, 0xa69e, 0xa69f, 0xa6f0, 0xa6f1, 0xa806, 0xa806,
  0xa82c, 0xa82c, 0xa8c4, 0xa8c4, 0xa8e0, 0xa8f1, 0xa92b, 0xa92d, 0xa953, 0xa953,
  0xa9b3, 0xa9b3, 0xa9c0, 0xa9c0, 0xaab0, 0xaab0, 0xaab2, 0xaab4, 0xaab7, 0xaab8,
  0xaabe, 0xaabf, 0xaac1, 0xaac1, 0xaaf6, 0xaaf6, 0xabed, 0xabed, 0xfb1e, 0xfb1e,
  0xfe20, 0xfe2f, 0x101fd, 0x101fd, 0x102e0, 0x102e0, 0x10376, 0x1037a, 0x10a0d, 0x10a0d,
  0x10a0f, 0x10a0f, 0x10a38, 0x10a3a, 0x10a3f, 0x10a3f, 0x10ae5, 0x10ae6, 0x10d24, 0x10d27,
  0x10eab, 0x10eac, 0x10efd, 0x10eff, 0x10f46, 0x10f50, 0x10f82, 0x10f85, 0x11046, 0x11046,
  0x11070, 0x11070, 0x1107f, 0x1107f, 0x110b9, 0x110ba, 0x11100, 0x11102, 0x11133, 0x11134,
  0x11173, 0x11173, 0x111c0, 0x111c0, 0x111ca, 0x111ca, 0x11235, 0x11236, 0x112e9, 0x112ea,
  0x1133b, 0x1133c, 0x1134d, 0x1134d, 0x11366, 0x1136c, 0x11370, 0x11374, 0x11442, 0x11442,
  0x11446, 0x11446, 0x1145e, 0x1145e, 0x114c2, 0x114c3, 0x115bf, 0x115c0, 0x1163f, 0x1163f,
  0x116b6, 0x116b7, 0x1172b, 0x1172b, 0x11839, 0x1183a, 0x1193d, 0x1193e, 0x11943, 0x11943,
  0x119e0, 0x119e0, 0x11a34, 0x11a34, 0x11a47, 0x11a47, 0x11a99, 0x11a99, 0x11c3f, 0x11c3f,
  0x11d42, 0x11d42, 0x11d44, 0x11d45, 0x11d97, 0x11d97, 0x11f41, 0x11f42, 0x16af0, 0x16af4,
  0x16b30, 0x16b36, 0x16ff0, 0x16ff1, 0x1bc9e, 0x1bc9e, 0x1d165, 0x1d169, 0x1d16d, 0x1d172,
  0x1d17b, 0x1d182, 0x1d185, 0x1d18b, 0x1d1aa, 0x1d1ad, 0x1d242, 0x1d244, 0x1e000, 0x1e006,
  0x1e008, 0x1e018, 0x1e01b, 0x1e021, 0x1e023, 0x1e024, 0x1e026, 0x1e02a, 0x1e08f, 0x1e08f,
  0x1e130, 0x1e136, 0x1e2ae, 0x1e2ae, 0x1e2ec, 0x1e2ef, 0x1e4ec, 0x1e4ef, 0x1e8d0, 0x1e8d6,
  0x1e944, 0x1e94a,
];

function cpEscape(cp: number): string {
  return cp > 0xffff ? `\\u{${cp.toString(16)}}` : `\\u${cp.toString(16).padStart(4, '0')}`;
}

/** re's \d (the Nd digits) as the body of a character class for a `u` regex. */
export const ND_CLASS = ND_ZEROS.map(z => `${cpEscape(z)}-${cpEscape(z + 9)}`).join('');

/** re's \s, the str.isspace() set of isPySpace, as the body of a character class. */
export const PY_SPACE_CLASS = String.raw`\t\n\v\f\r\x1c-\x20\x85\xa0  -     　`;

/** The index of the last entry (one per `stride` numbers) starting at or below cp; negative if none. */
function floorIndex(table: readonly number[], stride: number, cp: number): number {
  let lo = 0;
  let hi = table.length / stride - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (table[mid * stride] <= cp) lo = mid + 1;
    else hi = mid - 1;
  }
  return hi * stride;
}

/** str.lower(), one code point at a time (no final-sigma rule, which Python lacks). */
export function pyLower(s: string): string {
  let out = '';
  for (const ch of s) out += ch.toLowerCase();
  return out;
}

/** str.upper() */
export function pyUpper(s: string): string {
  let out = '';
  for (const ch of s) out += ch.toUpperCase();
  return out;
}

/** str.capitalize(): first character title-cased (upper for these scripts), the rest lower. */
export function pyCapitalize(s: string): string {
  const chars = Array.from(s);
  if (chars.length === 0) return s;
  return chars[0].toUpperCase() + pyLower(chars.slice(1).join(''));
}

export function pyLen(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** One character: str.isalpha() */
export function pyIsAlpha(ch: string): boolean {
  return ALPHA.test(ch);
}

/** One character: str.isupper() (for letters). */
export function pyIsUpper(ch: string): boolean {
  return UPPER.test(ch);
}

/** One character: its value if it is a decimal digit (what int() reads), else -1. */
export function decimalValue(ch: string): number {
  const cp = ch.codePointAt(0) as number;
  const i = floorIndex(ND_ZEROS, 1, cp);
  return i >= 0 && cp - ND_ZEROS[i] < 10 ? cp - ND_ZEROS[i] : -1;
}

/** One character: unicodedata.numeric(ch) if str.isdigit() (always 0-9), else -1. */
export function digitValue(ch: string): number {
  const v = decimalValue(ch);
  if (v >= 0) return v;
  const cp = ch.codePointAt(0) as number;
  const i = floorIndex(OTHER_DIGITS, 3, cp);
  return i >= 0 && cp <= OTHER_DIGITS[i + 1] ? OTHER_DIGITS[i + 2] + cp - OTHER_DIGITS[i] : -1;
}

/** One character: str.isdigit() */
export function pyIsDigit(ch: string): boolean {
  return digitValue(ch) >= 0;
}

/** One character: unicodedata.combining(ch) != 0 */
export function pyIsCombining(ch: string): boolean {
  const cp = ch.codePointAt(0) as number;
  const i = floorIndex(COMBINING, 2, cp);
  return i >= 0 && cp <= COMBINING[i + 1];
}

/** str.isalpha() on a whole string: non-empty and every character a letter. */
export function pyStrIsAlpha(s: string): boolean {
  if (!s) return false;
  for (const ch of s) if (!ALPHA.test(ch)) return false;
  return true;
}

/** str.isspace() for one UTF-16 unit (every Python whitespace character is in the BMP). */
export function isPySpace(c: number): boolean {
  return (
    (c >= 0x09 && c <= 0x0d) ||
    (c >= 0x1c && c <= 0x20) ||
    c === 0x85 ||
    c === 0xa0 ||
    c === 0x1680 ||
    (c >= 0x2000 && c <= 0x200a) ||
    c === 0x2028 ||
    c === 0x2029 ||
    c === 0x202f ||
    c === 0x205f ||
    c === 0x3000
  );
}

/** str.isspace() on one character. */
export function pyIsSpaceChar(ch: string): boolean {
  return ch.length === 1 && isPySpace(ch.charCodeAt(0));
}

/** str.isspace() on a whole string: non-empty and all whitespace. */
export function pyStrIsSpace(s: string): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length; i++) if (!isPySpace(s.charCodeAt(i))) return false;
  return true;
}

/** str.replace(a, b) for a non-empty `a`. */
export function replaceAll(s: string, a: string, b: string): string {
  return s.indexOf(a) < 0 ? s : s.split(a).join(b);
}

/** str.strip(chars) */
export function pyStrip(s: string, chars: string): string {
  const set = new Set(Array.from(chars));
  const arr = Array.from(s);
  let a = 0;
  let b = arr.length;
  while (a < b && set.has(arr[a])) a++;
  while (b > a && set.has(arr[b - 1])) b--;
  return arr.slice(a, b).join('');
}

/** str.rstrip(chars) */
export function pyRstrip(s: string, chars: string): string {
  const set = new Set(Array.from(chars));
  const arr = Array.from(s);
  let b = arr.length;
  while (b > 0 && set.has(arr[b - 1])) b--;
  return arr.slice(0, b).join('');
}

/** str.lstrip() with no arguments (Python whitespace). */
export function pyLstripSpace(s: string): string {
  let a = 0;
  while (a < s.length && isPySpace(s.charCodeAt(a))) a++;
  return a === 0 ? s : s.slice(a);
}

/** str.strip() with no arguments. */
export function pyStripSpace(s: string): string {
  let a = 0;
  let b = s.length;
  while (a < b && isPySpace(s.charCodeAt(a))) a++;
  while (b > a && isPySpace(s.charCodeAt(b - 1))) b--;
  return a === 0 && b === s.length ? s : s.slice(a, b);
}

/** str.split() with no arguments. */
export function pySplitSpace(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of s) {
    if (pyIsSpaceChar(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * unicodedata.normalize. Hermes builds without Intl may lack String.prototype.normalize;
 * going on without it would quietly change the phonemes, so that is an error.
 */
export function pyNormalize(s: string, form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD'): string {
  if (typeof s.normalize !== 'function') {
    throw new Error('String.prototype.normalize is missing: the text front end needs a JavaScript engine with Intl');
  }
  return s.normalize(form);
}

/** dict membership without the prototype chain. */
export function own<T>(obj: Record<string, T>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** An error standing in for a Python exception; `name` is the Python type name. */
export class PyError extends Error {
  constructor(pyType: string, message: string) {
    super(message);
    this.name = pyType;
  }
}

/** int(x) for a float, as a Python int. */
export function floatToInt(x: number): bigint {
  if (Number.isNaN(x)) throw new PyError('ValueError', 'cannot convert float NaN to integer');
  if (!Number.isFinite(x)) throw new PyError('OverflowError', 'cannot convert float infinity to integer');
  return BigInt(Math.trunc(x));
}
