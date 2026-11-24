// Port of kittenml/kittentts2_tiny/frontend/tts_norm.py (KittenML/KittenTTS 5802f6b):
// expands text to its spoken form before G2P for Kitten TTS 2 Nano/Pico/Mini.
// Every rule runs in the Python order and gives the same string for the same input,
// including Python's own oddities (kept on purpose, see the notes by each rule).
//
// The Python regexes are kept verbatim and translated by pyRe() below, which gives
// JS the Python `re` meaning of:
//   \w \b   Unicode word characters (letters, numbers, "_"), not ASCII
//   \d      Unicode decimal digits (Nd), and int() reads any of them
//   \s      Python's whitespace set (has \x1c-\x1f and \x85, lacks \ufeff)
//   re.I    ASCII letters only, plus the extra letters Python folds onto them:
//           i ~ ı İ, s ~ ſ, k ~ K (JS's `i` flag differs, so it is not used)
// Python exceptions that can escape normalize() (int() of a 4301+ digit number,
// "1..2°C", an overflowing ordinal, a unit spelled with "İ") are thrown as PyError
// with the same name. The engine imports this module only after checking that the JS
// engine builds Unicode regexes (older Hermes cannot).

import { num2words } from './Num2Words';
import {
  decimalValue,
  floatToInt,
  ND_CLASS,
  own,
  PY_SPACE_CLASS,
  PyError,
  pyIsSpaceChar,
  pyNormalize,
  pyStripSpace,
  replaceAll,
} from '../pystr';

const r = String.raw;

// ---- Python `re` on JS RegExp ----

/** Python 3 str-pattern \w: str.isalnum() or "_" = Unicode categories L* and N*. */
const W = r`\p{L}\p{N}_`;
/** Python \s. */
const S = PY_SPACE_CLASS;
/** Python \d. */
const D = ND_CLASS;
/** Python \b. */
const B = `(?:(?<=[${W}])(?![${W}])|(?<![${W}])(?=[${W}]))`;
/** Letters Python's re.I matches for each ASCII letter, beyond its two cases. */
const FOLD_EXTRA: Record<string, string> = { i: 'ıİ', s: 'ſ', k: 'K' };
const SYNTAX = '^$\\.*+?()[]{}|/';

function caseVariants(ch: string): string {
  const lo = ch.toLowerCase();
  return lo + lo.toUpperCase() + (FOLD_EXTRA[lo] || '');
}

function isAsciiLetter(ch: string | undefined): boolean {
  return ch !== undefined && /^[A-Za-z]$/.test(ch);
}

/** Translate the Python regex subset tts_norm uses into a JS `u` regex source. */
function translate(src: string, ignoreCase: boolean): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const e = src[i + 1];
      i += 2;
      if (e === 'b') out += B;
      else if (e === 'd') out += `[${D}]`;
      else if (e === 'D') out += `[^${D}]`;
      else if (e === 's') out += `[${S}]`;
      else if (e === 'S') out += `[^${S}]`;
      else if (e === 'w') out += `[${W}]`;
      else if (e === 'W') out += `[^${W}]`;
      else if (SYNTAX.includes(e)) out += '\\' + e;
      else if (isAsciiLetter(e) || /[0-9]/.test(e)) throw new Error(`pyRe: unsupported escape \\${e}`);
      else out += e;
    } else if (c === '[') {
      let j = i + 1;
      let body = '';
      if (src[j] === '^') {
        body = '^';
        j++;
      }
      while (src[j] !== ']') {
        if (j >= src.length) throw new Error('pyRe: unterminated class');
        const ch = src[j];
        if (ch === '\\') {
          const e = src[j + 1];
          j += 2;
          if (e === 'd') body += D;
          else if (e === 's') body += S;
          else if (e === 'w') body += W;
          else if (SYNTAX.includes(e) || e === '-') body += '\\' + e;
          else if (isAsciiLetter(e) || /[0-9]/.test(e)) throw new Error(`pyRe: unsupported escape \\${e}`);
          else body += e;
        } else if (src[j + 1] === '-' && src[j + 2] !== undefined && src[j + 2] !== ']') {
          const hi = src[j + 2];
          body += `${ch}-${hi}`;
          if (ignoreCase) {
            if (ch === 'a' && hi === 'z') body += 'A-Z' + Object.values(FOLD_EXTRA).join('');
            else if (isAsciiLetter(ch) || isAsciiLetter(hi)) throw new Error('pyRe: unsupported re.I range');
          }
          j += 3;
        } else {
          if (ch === '-') body += '\\-';
          else if (ignoreCase && isAsciiLetter(ch)) body += caseVariants(ch);
          else body += ch;
          j++;
        }
      }
      out += `[${body}]`;
      i = j + 1;
    } else if (ignoreCase && isAsciiLetter(c)) {
      out += `[${caseVariants(c)}]`;
      i++;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** re.compile(src, flags) as a global JS regex for String.prototype.replace. */
function pyRe(src: string, ignoreCase = false): RegExp {
  return new RegExp(translate(src, ignoreCase), 'gu');
}

/** re.fullmatch(src, s) */
function pyFullmatch(src: string): RegExp {
  return new RegExp(`^(?:${translate(src, false)})$`, 'u');
}

interface Match {
  /** m.group(i); undefined for a group that did not take part (Python None) */
  g: (i: number) => string | undefined;
  /** m.group(0) */
  text: string;
  /** m.end(), in UTF-16 units of `string` */
  end: number;
  /** m.string */
  string: string;
}

/** re.sub(pattern, fn, s) */
function sub(re: RegExp, s: string, fn: (m: Match) => string): string {
  return s.replace(re, (...args: unknown[]) => {
    const string = args[args.length - 1] as string;
    const offset = args[args.length - 2] as number;
    const groups = args.slice(0, args.length - 2) as (string | undefined)[];
    const text = groups[0] as string;
    return fn({ g: (i) => groups[i], text, end: offset + text.length, string });
  });
}

// ---- Python str / int helpers ----

/** str.isupper() for one character: Lu plus Other_Uppercase (Unicode 15.0). */
const RE_UPPER_CHAR = /^[\p{Lu}Ⅰ-ⅯⒶ-Ⓩ\u{1f130}-\u{1f149}\u{1f150}-\u{1f169}\u{1f170}-\u{1f189}]$/u;

/** s[:1] by code point */
function firstChar(s: string): string {
  const cp = s.codePointAt(0);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

/** list(s): code points */
function chars(s: string): string[] {
  return Array.from(s);
}

/** Any Nd digits as ASCII (what int() / float() do first). */
function asciiDigits(s: string): string {
  let out = '';
  for (const ch of chars(s)) {
    const v = decimalValue(ch);
    out += v >= 0 ? String(v) : ch;
  }
  return out;
}

/** Python's default sys.get_int_max_str_digits() */
const INT_MAX_STR_DIGITS = 4300;

/** int(s) for the digit strings the rules capture (Unicode digits allowed). */
function pyInt(s: string): bigint {
  const cs = chars(s);
  if (cs.length === 0 || cs.some((c) => decimalValue(c) < 0)) {
    throw new PyError('ValueError', `invalid literal for int() with base 10: '${s}'`);
  }
  if (cs.length > INT_MAX_STR_DIGITS) {
    throw new PyError(
      'ValueError',
      `Exceeds the limit (${INT_MAX_STR_DIGITS} digits) for integer string conversion: value has ${cs.length} digits`,
    );
  }
  return BigInt(asciiDigits(s));
}

/** int(s) for a short group (\d{1,4}): a plain number is enough. */
function pyIntN(s: string): number {
  return Number(pyInt(s));
}

/** float(s) for a digits[.digits] string. */
function pyFloat(s: string): number {
  return Number(asciiDigits(s));
}

/** float(n) for an int: raises when it does not fit a double. */
function intToFloat(n: bigint): number {
  const f = Number(n);
  if (!Number.isFinite(f)) throw new PyError('OverflowError', 'int too large to convert to float');
  return f;
}

// ---- tables ----

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const UNITS: Record<string, string> = {
  km: 'kilometres', mi: 'miles', cm: 'centimetres', mm: 'millimetres',
  kg: 'kilograms', lb: 'pounds', lbs: 'pounds', oz: 'ounces',
  ml: 'millilitres', l: 'litres', ft: 'feet', in: 'inches',
  hr: 'hours', hrs: 'hours', min: 'minutes', mins: 'minutes',
  sec: 'seconds', secs: 'seconds', ms: 'milliseconds',
  gb: 'gigabytes', mb: 'megabytes', kb: 'kilobytes', tb: 'terabytes',
  hz: 'hertz', khz: 'kilohertz', mhz: 'megahertz', ghz: 'gigahertz',
  kw: 'kilowatts', mph: 'miles per hour', kph: 'kilometres per hour',
};
/** sorted(UNITS, key=len, reverse=True): longest first, ties in dict order. */
const UNITS_BY_LENGTH = ['mins', 'secs', 'lbs', 'hrs', 'min', 'sec', 'khz', 'mhz', 'ghz',
  'mph', 'kph', 'km', 'mi', 'cm', 'mm', 'kg', 'lb', 'oz', 'ml', 'ft', 'in', 'hr', 'ms',
  'gb', 'mb', 'kb', 'tb', 'hz', 'kw', 'l'];
const MAG: Record<string, string> = { k: 'thousand', m: 'million', b: 'billion', t: 'trillion' };
const FRACTIONS: Record<string, string> = {
  '1/2': 'a half', '1/3': 'a third', '2/3': 'two thirds',
  '1/4': 'a quarter', '3/4': 'three quarters', '1/8': 'an eighth',
};
const ABBREV: Array<[string, string]> = [
  ['mr', 'Mister'], ['mrs', 'Missus'], ['ms', 'Miss'], ['dr', 'Doctor'],
  ['prof', 'Professor'], ['rev', 'Reverend'], ['hon', 'Honourable'],
  ['ext', 'extension'], ['approx', 'approximately'], ['vs', 'versus'],
  ['est', 'estimated'], ['dept', 'department'], ['univ', 'university'],
  ['fig', 'figure'], ['eq', 'equation'], ['ref', 'reference'], ['vol', 'volume'],
  ['incl', 'including'], ['excl', 'excluding'], ['min', 'minimum'],
  ['max', 'maximum'], ['avg', 'average'], ['mt', 'mount'], ['ft', 'fort'],
  ['appt', 'appointment'], ['pp', 'pages'], ['jr', 'Junior'], ['sr', 'Senior'],
  ['inc', 'Incorporated'], ['ltd', 'Limited'], ['corp', 'Corporation'],
  ['mins', 'minutes'], ['hrs', 'hours'], ['wks', 'weeks'], ['yrs', 'years'],
];
/** {**DAYS, **MONTHS_ABBR} in order */
const DAYS_AND_MONTHS: Array<[string, string]> = [
  ['Mon', 'Monday'], ['Tue', 'Tuesday'], ['Tues', 'Tuesday'],
  ['Wed', 'Wednesday'], ['Weds', 'Wednesday'], ['Thu', 'Thursday'],
  ['Thur', 'Thursday'], ['Thurs', 'Thursday'], ['Fri', 'Friday'],
  ['Sat', 'Saturday'], ['Sun', 'Sunday'],
  ['Jan', 'January'], ['Feb', 'February'], ['Mar', 'March'],
  ['Apr', 'April'], ['Jun', 'June'], ['Jul', 'July'], ['Aug', 'August'],
  ['Sep', 'September'], ['Sept', 'September'], ['Oct', 'October'],
  ['Nov', 'November'], ['Dec', 'December'],
];
const SYMBOLS: Array<[string, string]> = [
  ['%', ' percent '], ['&', ' and '], ['@', ' at '], ['+', ' plus '],
  ['=', ' equals '], ['×', ' times '], ['÷', ' divided by '],
  ['<', ' less than '], ['>', ' greater than '], ['~', ' about '],
  ['°', ' degrees '], ['€', ' euros '], ['£', ' pounds '], ['¥', ' yen '],
  ['©', ' copyright '], ['™', ' trademark '], ['§', ' section '],
];
const ROMAN: Record<string, number> = {
  i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10, xi: 11, xii: 12,
};
const ROMAN_CTX = r`(?:chapter|section|part|volume|book|act|phase|appendix|world war|type|class|figure|table|step|stage)`;

// ---- number helpers ----

function card(n: bigint | number): string {
  const v = typeof n === 'bigint' ? n : BigInt(n);
  try {
    return num2words(v);
  } catch {
    return v.toString();
  }
}

function ordinal(n: bigint | number): string {
  return num2words(typeof n === 'bigint' ? n : BigInt(n), 'ordinal');
}

function year(y: number): string {
  if ((y >= 1100 && y <= 1999) || (y >= 2000 && y <= 2099)) {
    try {
      return num2words(BigInt(y), 'year');
    } catch {
      // fall through to the cardinal, as in Python
    }
  }
  return card(y);
}

// ---- rules ----

const RE_ISO = pyRe(r`\b(\d{4})-(\d{1,2})-(\d{1,2})\b`);
const RE_SLASH_DATE = pyRe(r`\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b`);
const RE_MONTH_DATE = pyRe(r`\b(` + MONTHS.join('|') + r`)\s+(\d{1,2}),?\s+(\d{4})\b`, true);

function dates(s: string): string {
  s = sub(RE_ISO, s, (m) => {
    const y = pyIntN(m.g(1) as string);
    const mo = pyIntN(m.g(2) as string);
    const d = pyIntN(m.g(3) as string);
    if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return m.text;
    return `${MONTHS[mo - 1]} ${ordinal(d)}, ${year(y)}`;
  });
  s = sub(RE_SLASH_DATE, s, (m) => {
    const a = pyIntN(m.g(1) as string);
    const b = pyIntN(m.g(2) as string);
    let y = pyIntN(m.g(3) as string);
    if (!(a >= 1 && a <= 12 && b >= 1 && b <= 31)) return m.text;
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return `${MONTHS[a - 1]} ${ordinal(b)}, ${year(y)}`;
  });
  // bare 4-digit year after a month name
  s = sub(RE_MONTH_DATE, s, (m) =>
    `${m.g(1)} ${ordinal(pyIntN(m.g(2) as string))}, ${year(pyIntN(m.g(3) as string))}`);
  return s;
}

/**
 * The am/pm group ends in an optional "." and will swallow a sentence-final period;
 * put it back when the match really did end the sentence.
 */
function keepFinalDot(m: Match, out: string): string {
  if (!m.text.endsWith('.')) return out;
  const rest = m.string.slice(m.end);
  const stripped = pyStripSpace(rest);
  if (stripped === '' || (pyIsSpaceChar(firstChar(rest)) && RE_UPPER_CHAR.test(firstChar(stripped)))) {
    return out + '.';
  }
  return out;
}

// \s* sits inside the optional am/pm group, so a bare H:MM keeps the space after it
const RE_TIME = pyRe(r`\b(\d{1,2}):(\d{2})(?:\s*([ap]\.?m\.?))?`, true);

function times(s: string): string {
  return sub(RE_TIME, s, (m) => {
    let h = pyIntN(m.g(1) as string);
    const mi = pyIntN(m.g(2) as string);
    const ampm = (m.g(3) || '').toLowerCase();
    if (h > 23 || mi > 59) return m.text;
    let suffix = '';
    if (ampm) {
      suffix = ampm.startsWith('a') ? ' AM' : ' PM';
    } else if (h === 0) {
      h = 12;
      suffix = ' AM';
    }
    let spoken: string;
    if (mi === 0) {
      // Python: _card(h if h <= 12 or ampm else h), the same either way
      spoken = !suffix ? `${card(h)} o'clock` : `${card(h <= 12 ? h : h - 12)}`;
    } else if (mi < 10) {
      spoken = `${card(h <= 12 || !suffix ? h : h - 12)} oh ${card(mi)}`;
    } else {
      spoken = `${card(h <= 12 || !suffix ? h : h - 12)} ${card(mi)}`;
    }
    return keepFinalDot(m, spoken + suffix);
  });
}

const RE_BARE_HOUR = pyRe(r`\b(\d{1,2})\s*([ap])\.?m\.?(?![a-z])`, true);

/** 9am / 9 PM / 11a.m. */
function bareHour(s: string): string {
  return sub(RE_BARE_HOUR, s, (m) => {
    const h = pyIntN(m.g(1) as string);
    if (!(h >= 1 && h <= 12)) return m.text;
    return keepFinalDot(m, `${card(h)} ${(m.g(2) as string).toLowerCase().startsWith('a') ? 'AM' : 'PM'}`);
  });
}

// Note: this also reads "1990-1995" as a phone number ("one nine nine, zero one nine,
// nine five"), because it runs before the range rule. Kept for parity.
const RE_PHONE = pyRe(r`\b(?:\+?1[-.\s]?)?(?:\(\d{3}\)|\d{3})[-.\s]\d{3}[-.\s]?\d{0,4}\b`);

function phones(s: string): string {
  return sub(RE_PHONE, s, (m) => {
    const digits = chars(m.text).filter((c) => decimalValue(c) >= 0);
    if (!(digits.length >= 7 && digits.length <= 11)) return m.text;
    const groups: string[] = [];
    let i = 0;
    if (digits.length === 11 && digits[0] === '1') {
      groups.push('one');
      i = 1;
    }
    for (const [a, b] of [[i, i + 3], [i + 3, i + 6], [i + 6, digits.length]]) {
      if (a < digits.length) groups.push(digits.slice(a, b).map((c) => card(pyInt(c))).join(' '));
    }
    return groups.filter((g) => g).join(', ');
  });
}

const RE_MONEY = pyRe(r`\$\s?(\d[\d,]*(?:\.\d+)?)(?:\s?([KkMmBbTt])\b)?`);

function money(s: string): string {
  return sub(RE_MONEY, s, (m) => {
    const amt = replaceAll(m.g(1) as string, ',', '');
    const suf = (m.g(2) || '').toLowerCase();
    if (suf) {
      let whole: string;
      if (amt.includes('.')) {
        const num = pyFloat(amt);
        if (Number.isInteger(num)) {
          whole = card(floatToInt(num));
        } else {
          const wholePart = card(floatToInt(num));
          whole = `${wholePart} point ${chars(amt.split('.')[1]).map((d) => card(pyInt(d))).join(' ')}`;
        }
      } else {
        const num = pyInt(amt);
        intToFloat(num); // float(num).is_integer() raises for a huge int
        whole = card(num);
      }
      return `${whole} ${MAG[suf]} dollars`;
    }
    if (amt.includes('.')) {
      const k = amt.indexOf('.');
      const d = amt.slice(0, k);
      const c = chars(amt.slice(k + 1) + '00').slice(0, 2).join('');
      const dn = pyInt(d);
      const dollars = `${card(dn)} dollar${dn === BigInt(1) ? '' : 's'}`;
      const cn = pyInt(c);
      if (cn !== BigInt(0)) return `${dollars} and ${card(cn)} cent${cn === BigInt(1) ? '' : 's'}`;
      return dollars;
    }
    const n = pyInt(amt);
    return `${card(n)} dollar${n === BigInt(1) ? '' : 's'}`;
  });
}

const RE_MAGNITUDE = pyRe(r`\b(\d[\d,]*(?:\.\d+)?)\s*([KMBT])\b`);

function magnitudes(s: string): string {
  return sub(RE_MAGNITUDE, s, (m) => `${decimal(m.g(1) as string)} ${MAG[(m.g(2) as string).toLowerCase()]}`);
}

function decimal(tok: string): string {
  tok = replaceAll(tok, ',', '');
  if (!chars(tok).some((c) => decimalValue(c) >= 0)) return tok; // backstop: never raise out of the text front end
  const k = tok.indexOf('.');
  if (k >= 0) {
    const a = tok.slice(0, k);
    const b = tok.slice(k + 1);
    // int(d) per character: a second "." here ("1..2°C") raises ValueError, as in Python
    return `${card(a ? pyInt(a) : BigInt(0))} point ${chars(b).map((d) => card(pyInt(d))).join(' ')}`;
  }
  return card(pyInt(tok));
}

const RE_FRACTION = pyRe(r`\b(\d{1,3})/(\d{1,3})\b`);

function fractions(s: string): string {
  return sub(RE_FRACTION, s, (m) => {
    const a = pyIntN(m.g(1) as string);
    const b = pyIntN(m.g(2) as string);
    const key = `${a}/${b}`;
    if (own(FRACTIONS, key)) return FRACTIONS[key];
    if (b === 0) return m.text;
    return `${card(a)} ${ordinal(b)}${a !== 1 ? 's' : ''}`;
  });
}

const RE_VERSION = pyRe(r`\b(\d+)\.(\d+)\.(\d+)\b`);

function versions(s: string): string {
  return sub(RE_VERSION, s, (m) => [1, 2, 3].map((i) => card(pyInt(m.g(i) as string))).join(' point '));
}

// the number must start with a digit: "[\d,]+" alone also matches a bare comma
const RE_UNIT = pyRe(r`\b(\d[\d,]*(?:\.\d+)?)\s?(` + UNITS_BY_LENGTH.join('|') + r`)\b`, true);
const RE_DEGREES = pyRe(r`([-−]?[\d.]+)\s?°\s?([CF])\b`);

function units(s: string): string {
  s = sub(RE_UNIT, s, (m) => {
    const n = m.g(1) as string;
    // str.lower(): "mİ" (matched by re.I) lowers to "mi\u0307", which is no key -> KeyError
    const unit = (m.g(2) as string).toLowerCase();
    const val = decimal(n);
    if (!own(UNITS, unit)) throw new PyError('KeyError', `'${unit}'`);
    let word = UNITS[unit];
    // rstrip("s") drops every trailing s: "1 in" -> "one inche". Kept for parity.
    if (['1', '1.0'].includes(replaceAll(n, ',', ''))) word = word.replace(/s+$/, '');
    return `${val} ${word}`;
  });
  s = sub(RE_DEGREES, s, (m) => {
    const raw = m.g(1) as string;
    const unit = (m.g(2) as string).toUpperCase();
    const neg = raw[0] === '-' || raw[0] === '−';
    const val = decimal(neg ? raw.slice(1) : raw);
    const scale = unit === 'C' ? 'Celsius' : 'Fahrenheit';
    return `${neg ? 'minus ' : ''}${val} degrees ${scale}`;
  });
  return s;
}

const RE_SAINT = pyRe(r`\bSt\.\s+(?=[A-Z])`);
const RE_STREET_END = pyRe(r`\bSt\.(?=\s*$)`);
const RE_STREET_QUOTE = pyRe(r`\bSt\.(?=\s*[\"'\)])`);
const RE_STREET = pyRe(r`\bSt\.(?!\s+[A-Z])`);
const RE_AVE = pyRe(r`\bAve\.`);
const RE_RD = pyRe(r`\bRd\.`);
const RE_BLVD = pyRe(r`\bBlvd\.`);
const RE_NO = pyRe(r`\bNo\.\s*(?=\d)`);
const RE_NOS = pyRe(r`\bNos\.\s*(?=\d)`);
const RE_DAYS_MONTHS: Array<[RegExp, string]> = DAYS_AND_MONTHS.map(([k, v]) => [pyRe(r`\b` + k + r`\.`), v]);
const RE_ABBREV: Array<[RegExp, string]> = ABBREV.map(([k, v]) => [pyRe(r`\b` + k + r`\.`, true), v]);

function abbrev(s: string): string {
  // St. is ambiguous: "St. Paul" is Saint, "Paul St." is Street
  s = s.replace(RE_SAINT, () => 'Saint ');
  // keep the terminator when "St." ends the sentence, else it swallows the full stop
  s = s.replace(RE_STREET_END, () => 'Street.');
  s = s.replace(RE_STREET_QUOTE, () => 'Street.');
  s = s.replace(RE_STREET, () => 'Street');
  s = s.replace(RE_AVE, () => 'Avenue');
  s = s.replace(RE_RD, () => 'Road');
  s = s.replace(RE_BLVD, () => 'Boulevard');
  s = s.replace(RE_NO, () => 'number ');
  s = s.replace(RE_NOS, () => 'numbers ');
  for (const [re, v] of RE_DAYS_MONTHS) s = s.replace(re, () => v); // case-sensitive
  for (const [re, v] of RE_ABBREV) s = s.replace(re, () => v);
  return s;
}

const RE_ROMAN = pyRe(r`\b(` + ROMAN_CTX + r`)\s+([IVX]{1,4})\b`, true);

function romans(s: string): string {
  return sub(RE_ROMAN, s, (m) => {
    const key = (m.g(2) as string).toLowerCase();
    return own(ROMAN, key) ? `${m.g(1)} ${card(ROMAN[key])}` : m.text;
  });
}

const RE_ORDINAL = pyRe(r`\b(\d+)(?:st|nd|rd|th)\b`, true);

function ordinals(s: string): string {
  // not wrapped like _card: 10^306 and up raises OverflowError out of normalize()
  return sub(RE_ORDINAL, s, (m) => ordinal(pyInt(m.g(1) as string)));
}

const RE_RANGE = pyRe(r`\b(\d+)\s?[-–—]\s?(\d+)\b`);

function ranges(s: string): string {
  return sub(RE_RANGE, s, (m) => `${card(pyInt(m.g(1) as string))} to ${card(pyInt(m.g(2) as string))}`);
}

const RE_MINUS = pyRe(r`(?<![\w.])[-−](\d)`);
const RE_NUMBER = pyRe(r`\b\d[\d,]*(?:\.\d+)?\b`);
const RE_FOUR_DIGITS = pyFullmatch(r`\d{4}`);

function numbers(s: string): string {
  s = sub(RE_MINUS, s, (m) => `minus ${m.g(1)}`);
  return sub(RE_NUMBER, s, (m) => {
    const tok = m.text;
    // a bare 4-digit integer is usually a year in prose; "1,234" is a cardinal
    if (!tok.includes(',') && RE_FOUR_DIGITS.test(tok)) {
      const y = pyIntN(tok);
      if (y >= 1100 && y <= 2099) return year(y);
    }
    return decimal(tok);
  });
}

const RE_URL = pyRe(r`https?://\S+|www\.\S+`);
const RE_EMAIL = pyRe(r`\b[\w.+-]+@[\w-]+\.[\w.]+\b`);
const RE_EG = pyRe(r`\be\.\s?g\.`, true);
const RE_IE = pyRe(r`\bi\.\s?e\.`, true);
const RE_ETC = pyRe(r`\betc\.`, true);
const RE_VS = pyRe(r`\bvs\.?\b`, true);
const RE_STRIP_SYMBOLS = pyRe(r`[_*` + '`' + r`^|\\/\[\]{}<>]`);
const RE_SPACE_BEFORE_PUNCT = pyRe(r`\s+([.,!?;])`);
const RE_PUNCT_NEEDS_SPACE = pyRe(r`([.,!?;])(?=[^\s\"',.!?;])`);
const RE_MULTI_SPACE = pyRe(r`\s{2,}`);

/** Expand `text` to spoken form. Keeps . , ! ? ; and dashes for prosody. */
export function normalize(text: string): string {
  let s = pyNormalize(String(text), 'NFKC');
  s = replaceAll(s, '’', "'");
  s = replaceAll(s, '‘', "'");
  s = replaceAll(s, '“', '"');
  s = replaceAll(s, '”', '"');
  s = replaceAll(s, '—', ' - ');
  s = replaceAll(s, '–', '-');
  s = replaceAll(s, '…', '...');
  s = s.replace(RE_URL, () => ' link ');
  s = s.replace(RE_EMAIL, () => ' email address ');
  s = s.replace(RE_EG, () => 'for example,');
  s = s.replace(RE_IE, () => 'that is,');
  s = s.replace(RE_ETC, () => 'etcetera');
  s = s.replace(RE_VS, () => 'versus');
  s = dates(s);
  s = times(s);
  s = bareHour(s);
  s = phones(s);
  s = money(s);
  s = versions(s);
  s = fractions(s);
  s = magnitudes(s);
  s = units(s);
  s = abbrev(s);
  s = romans(s);
  s = ordinals(s);
  s = ranges(s);
  for (const [k, v] of SYMBOLS) s = replaceAll(s, k, v);
  s = numbers(s);
  // any colon that survived the time rule becomes a comma: same pause, no stray token
  s = replaceAll(s, ':', ',');
  s = s.replace(RE_STRIP_SYMBOLS, () => ' ');
  s = sub(RE_SPACE_BEFORE_PUNCT, s, (m) => m.g(1) as string);
  // no space BEFORE another punctuation mark: "Mon.," must not become "Mon. ,"
  s = sub(RE_PUNCT_NEEDS_SPACE, s, (m) => `${m.g(1)} `);
  s = pyStripSpace(s.replace(RE_MULTI_SPACE, () => ' '));
  return s;
}
