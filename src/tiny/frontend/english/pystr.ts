// Python str semantics the ported text code depends on. JavaScript's own methods
// differ in small ways (context-sensitive lowercasing, UTF-16 lengths, ASCII-only
// \d), and phoneme strings must come out identical to Python's.

const ALPHA = /^\p{L}$/u;
const UPPER = /^\p{Lu}$/u;
const LOWER_CH = /^\p{Ll}$/u;
const ND = /^\p{Nd}$/u;
// Characters Python's isdigit() also accepts (Numeric_Type=Digit, not Decimal).
const OTHER_DIGITS = /^[²³¹፩-፱᧚⁰⁴-⁹₀-₉①-⑨⑴-⑼⒈-⒐⓪⓵-⓽⓿❶-❾➀-➈➊-➒\u{10a40}-\u{10a43}\u{10e60}-\u{10e68}\u{11052}-\u{1105a}\u{1f100}-\u{1f10a}]$/u;

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

/** One character: str.isdigit() */
export function pyIsDigit(ch: string): boolean {
  return ND.test(ch) || OTHER_DIGITS.test(ch);
}

/** str.isalpha() on a whole string: non-empty and every character a letter. */
export function pyStrIsAlpha(s: string): boolean {
  if (!s) return false;
  for (const ch of s) if (!ALPHA.test(ch)) return false;
  return true;
}

/** str.isdigit() on a whole string. */
export function pyStrIsDigit(s: string): boolean {
  if (!s) return false;
  for (const ch of s) if (!pyIsDigit(ch)) return false;
  return true;
}

/** str.isspace() on a whole string. */
const SPACE = /^[\t\n\v\f\r\x1c-\x1f \x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]$/u;
export function pyStrIsSpace(s: string): boolean {
  if (!s) return false;
  for (const ch of s) if (!SPACE.test(ch)) return false;
  return true;
}

export function pyIsSpaceChar(ch: string): boolean {
  return SPACE.test(ch);
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
  const arr = Array.from(s);
  let a = 0;
  while (a < arr.length && SPACE.test(arr[a])) a++;
  return arr.slice(a).join('');
}

/** str.strip() with no arguments. */
export function pyStripSpace(s: string): string {
  const arr = Array.from(s);
  let a = 0;
  let b = arr.length;
  while (a < b && SPACE.test(arr[a])) a++;
  while (b > a && SPACE.test(arr[b - 1])) b--;
  return arr.slice(a, b).join('');
}

/** str.split() with no arguments. */
export function pySplitSpace(s: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of s) {
    if (SPACE.test(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** The value of a decimal digit character (unicodedata.numeric for Nd). */
export function digitValue(ch: string): number {
  const cp = ch.codePointAt(0) as number;
  if (cp >= 48 && cp <= 57) return cp - 48;
  // Decimal digits come in runs of exactly ten consecutive code points.
  let start = cp;
  while (start > 0 && ND.test(String.fromCodePoint(start - 1))) start--;
  return (cp - start) % 10;
}

export function isLowerChar(ch: string): boolean {
  return LOWER_CH.test(ch);
}

/** unicodedata.normalize; Hermes builds without Intl may lack String.prototype.normalize. */
export function pyNormalize(s: string, form: 'NFC' | 'NFD' | 'NFKC' | 'NFKD'): string {
  try {
    return typeof s.normalize === 'function' ? s.normalize(form) : s;
  } catch {
    return s;
  }
}

/** dict membership without the prototype chain. */
export function own<T>(obj: Record<string, T>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}
