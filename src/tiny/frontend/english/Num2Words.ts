// English number words (cardinal, ordinal, year): an independent implementation that
// matches the outputs of Python num2words 0.5.14 (lang "en"), worked out by calling it and
// comparing results, not by porting its code. Apache-2.0, like the rest of the SDK.
//
// Measured behaviour this reproduces:
// - British joins: "one hundred and five", "one thousand, two hundred", "one million and one".
// - Short-scale names up to centillion (10^303); abs >= 10^306 is an OverflowError.
// - bigint (Python int) is exact. A whole `number` (Python float) is split by float divmod
//   with float(10**k), so 1e24 (just under 10**24) reads "nine hundred and ninety-nine
//   sextillion, ...". A float with a fraction reads "<int(x)> point <digits>": as many
//   digits as repr(x) has, from abs(x - int(x)) * 10**digits, rounded within 0.01 of a
//   whole number and floored otherwise. int(x) carries the sign, so -0.5 has no "minus".
// - A string is read like Python's Decimal(string): whole values exact, except that abs()
//   and group remainders round to 28 significant digits; fractions go through float(x).

import { PyError, decimalValue, floatToInt, pyStripSpace } from '../pystr';

export type Num2WordsTo = 'cardinal' | 'ordinal' | 'year';

const ONES = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

/** Scale names by power of ten (3, 6, ..., 303). */
const SCALES: Record<number, string> = (() => {
  const first = ['m', 'b', 'tr', 'quadr', 'quint', 'sext', 'sept', 'oct', 'non'];
  const unit = ['', 'un', 'duo', 'tre', 'quattuor', 'quin', 'sex', 'sept', 'octo', 'novem'];
  const ten = ['', 'dec', 'vigint', 'trigint', 'quadragint', 'quinquagint', 'sexagint',
    'septuagint', 'octogint', 'nonagint'];
  const out: Record<number, string> = { 3: 'thousand', 303: 'centillion' };
  for (let i = 1; i < 100; i++) {
    out[3 * i + 3] = (i < 10 ? first[i - 1] : unit[i % 10] + ten[Math.floor(i / 10)]) + 'illion';
  }
  return out;
})();
const TOP_SCALE = 303;
const LIMIT_EXP = 306;

const POW10: bigint[] = [1n];
for (let i = 1; i <= LIMIT_EXP + 3; i++) POW10.push(POW10[i - 1] * 10n);
const LIMIT = POW10[LIMIT_EXP];

/** Decimal's default context precision. */
const DEC_PREC = 28;

const ORDINAL_WORDS: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth',
  twelve: 'twelfth',
};

// ---------------------------------------------------------------------------
// Words for whole numbers

function under1000(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = TENS[Math.floor(n / 10)];
    return n % 10 ? `${t}-${ONES[n % 10]}` : t;
  }
  const rest = n % 100;
  const head = `${ONES[Math.floor(n / 100)]} hundred`;
  return rest ? `${head} and ${under1000(rest)}` : head;
}

function joinScale(head: string, k: number, rest: string | null, restBelow100: boolean): string {
  const s = `${head} ${SCALES[k]}`;
  if (rest === null) return s;
  return s + (restBelow100 ? ' and ' : ', ') + rest;
}

/** The largest scale power k (3..303, step 3) with 10**k <= n, for n >= 1000. */
function scaleOf(n: bigint): number {
  let k = 3;
  while (k < TOP_SCALE && POW10[k + 3] <= n) k += 3;
  return k;
}

/** Python int, exact; with `decimal`, each remainder is rounded as Decimal arithmetic does. */
function wordsInt(n: bigint, decimal: boolean): string {
  if (n < 1000n) return under1000(Number(n));
  const k = scaleOf(n);
  const q = n / POW10[k];
  let r = n - q * POW10[k];
  if (decimal) r = roundSig(r);
  return joinScale(wordsInt(q, decimal), k, r ? wordsInt(r, decimal) : null, r < 100n);
}

/** A whole, finite, non-negative Python float, split with float divmod. */
function wordsFloat(n: number): string {
  if (n < 1000) return under1000(n);
  const k = scaleOf(BigInt(n));
  const [q, r] = floatDivmod(n, Number(POW10[k]));
  return joinScale(wordsFloat(q), k, r ? wordsFloat(r) : null, r < 100);
}

function ordinalize(words: string): string {
  const cut = Math.max(words.lastIndexOf(' '), words.lastIndexOf('-')) + 1;
  const last = words.slice(cut);
  const ord = ORDINAL_WORDS[last] ?? (last.endsWith('y') ? `${last.slice(0, -1)}ieth` : `${last}th`);
  return words.slice(0, cut) + ord;
}

// ---------------------------------------------------------------------------
// Python float helpers

/** divmod(a, b) for Python floats, as CPython computes it. */
function floatDivmod(a: number, b: number): [number, number] {
  let mod = a % b;
  let div = (a - mod) / b;
  if (mod !== 0) {
    if ((b < 0) !== (mod < 0)) {
      mod += b;
      div -= 1;
    }
  } else {
    mod = b < 0 ? -0 : 0;
  }
  let floorDiv: number;
  if (div !== 0) {
    floorDiv = Math.floor(div);
    if (div - floorDiv > 0.5) floorDiv += 1;
  } else {
    const t = a / b;
    floorDiv = t < 0 || Object.is(t, -0) ? -0 : 0;
  }
  return [floorDiv, mod];
}

/** a % b for Python floats. */
function floatMod(a: number, b: number): number {
  return floatDivmod(a, b)[1];
}

/** Significant digits and decimal exponent of the shortest repr of a finite x != 0. */
function shortestDigits(x: number): { digits: string; exp: number } {
  const s = String(Math.abs(x));
  const e = s.indexOf('e');
  if (e >= 0) {
    return { digits: s.slice(0, e).replace('.', ''), exp: Number(s.slice(e + 1)) };
  }
  const dot = s.indexOf('.');
  const intLen = dot < 0 ? s.length : dot;
  const all = dot < 0 ? s : s.slice(0, dot) + s.slice(dot + 1);
  let lead = 0;
  while (all[lead] === '0') lead++;
  return { digits: all.slice(lead).replace(/0+$/, ''), exp: intLen - 1 - lead };
}

/** abs() of the exponent of Decimal(repr(x)): how many digits follow "point". */
function reprPlaces(x: number): number {
  if (x === 0) return 1; // '0.0'
  const { digits, exp } = shortestDigits(x);
  const nd = digits.length;
  // repr is positional for exponents -4..15 and always shows at least one fraction digit.
  if (exp >= -4 && exp < 16) return Math.max(nd - 1 - exp, 1);
  return Math.abs(exp - (nd - 1));
}

/** A float that may have a fraction: "<int part> point <digits>". */
function pointWords(x: number): string {
  const places = reprPlaces(x);
  if (places > 308) throw new PyError('OverflowError', 'int too large to convert to float');
  const whole = Math.trunc(x);
  const head = whole < 0 ? `minus ${wordsInt(BigInt(-whole), false)}` : wordsInt(BigInt(whole), false);
  if (places === 0) return head;
  const scaled = Math.abs(x - whole) * Number(`1e${places}`);
  const near = Math.round(scaled);
  const frac = Math.abs(near - scaled) < 0.01 ? near : Math.floor(scaled);
  const digits = BigInt(frac).toString().padStart(places, '0');
  return `${head} point ${Array.from(digits, d => ONES[Number(d)]).join(' ')}`;
}

function floatOverLimit(x: number): boolean {
  if (Number.isNaN(x)) return false;
  if (!Number.isFinite(x)) return true;
  return Math.abs(x) >= 1e305 && BigInt(Math.abs(x)) >= LIMIT;
}

function overflow(): PyError {
  return new PyError('OverflowError', 'abs(number) must be less than 10**306');
}

// ---------------------------------------------------------------------------
// Python decimal.Decimal, as much of it as num2words reaches for a string

/** coef * 10**exp, with a sign; or one of the special values. */
class Dec {
  constructor(
    readonly neg: boolean,
    readonly coef: bigint,
    readonly exp: number,
    readonly special: '' | 'inf' | 'nan' | 'snan' = '',
  ) {}

  private get coefDigits(): number {
    return this.coef.toString().length;
  }

  isZero(): boolean {
    return this.coef === 0n;
  }

  /** d < 0 (minus zero is not). */
  isNegative(): boolean {
    return this.neg && !this.isZero();
  }

  /** k such that 10**(k-1) <= abs(d) < 10**k, or 0 for zero. */
  magnitude(): number {
    return this.isZero() ? 0 : this.coefDigits + this.exp;
  }

  isWhole(): boolean {
    if (this.exp >= 0 || this.isZero()) return true;
    return -this.exp <= this.coefDigits && this.coef % pow10(-this.exp) === 0n;
  }

  /** abs(int(d)); only called once the magnitude is known to be small. */
  intPart(): bigint {
    if (this.exp >= 0) return this.coef * pow10(this.exp);
    return -this.exp > this.coefDigits ? 0n : this.coef / pow10(-this.exp);
  }

  /** float(d), correctly rounded like Python's. */
  toFloat(): number {
    return Number(`${this.neg ? '-' : ''}${this.coef}e${this.exp}`);
  }

  /** abs(d): Decimal rounds the result to the context precision. */
  abs(): Dec {
    const [coef, exp] = roundCoef(this.coef, this.exp);
    return new Dec(false, coef, exp);
  }

  /** Whether abs() keeps every digit. */
  absIsExact(): boolean {
    const [coef, exp] = roundCoef(this.coef, this.exp);
    return exp === this.exp || coef * pow10(exp - this.exp) === this.coef;
  }

  /** Compare a finite d with a small non-negative integer n: -1, 0 or 1. */
  cmp(n: number): number {
    if (this.isZero()) return n === 0 ? 0 : -1;
    if (this.neg) return -1;
    if (n === 0) return 1;
    const mag = this.magnitude();
    const nMag = String(n).length;
    if (mag !== nMag) return mag < nMag ? -1 : 1;
    // Same number of integer digits, so the exponent is small enough to scale.
    const a = this.exp >= 0 ? this.coef * pow10(this.exp) : this.coef;
    const b = this.exp >= 0 ? BigInt(n) : BigInt(n) * pow10(-this.exp);
    return a === b ? 0 : a < b ? -1 : 1;
  }
}

function pow10(k: number): bigint {
  return k < POW10.length ? POW10[k] : 10n ** BigInt(k);
}

/** Round a coefficient to DEC_PREC significant digits, half to even. */
function roundCoef(coef: bigint, exp: number): [bigint, number] {
  const drop = coef.toString().length - DEC_PREC;
  if (drop <= 0) return [coef, exp];
  const unit = pow10(drop);
  let q = coef / unit;
  const rest = coef - q * unit;
  const half = unit / 2n;
  if (rest > half || (rest === half && q % 2n === 1n)) q += 1n;
  return [q, exp + drop];
}

/** A non-negative whole number rounded to DEC_PREC significant digits. */
function roundSig(n: bigint): bigint {
  const [coef, exp] = roundCoef(n, 0);
  return coef * pow10(exp);
}

function syntaxError(): PyError {
  return new PyError('InvalidOperation', "[<class 'decimal.ConversionSyntax'>]");
}

/** Decimal(s): Python strips whitespace and every "_", and reads any Unicode decimal digit. */
function parseDecimal(text: string): Dec {
  let s = '';
  for (const ch of pyStripSpace(text)) {
    if (ch === '_') continue;
    if (ch.charCodeAt(0) < 128) {
      s += ch;
      continue;
    }
    const d = decimalValue(ch);
    if (d < 0) throw syntaxError();
    s += String(d);
  }
  const num = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s);
  if (num && (num[2] || num[3])) {
    const frac = num[3] ?? '';
    const coef = BigInt(num[2] + frac || '0');
    return new Dec(num[1] === '-', coef, Number(num[4] ?? '0') - frac.length);
  }
  const sp = /^([+-]?)(?:(inf|infinity)|(s?nan)\d*)$/i.exec(s);
  if (sp) {
    const kind = sp[2] ? 'inf' : sp[3].toLowerCase() === 'snan' ? 'snan' : 'nan';
    return new Dec(sp[1] === '-', 0n, 0, kind);
  }
  throw syntaxError();
}

/** divmod(d, 100) for a finite Dec >= 0. */
function decDivmod100(d: Dec): [Dec, Dec] {
  // The quotient may have at most DEC_PREC digits (else DivisionImpossible).
  if (d.magnitude() > DEC_PREC + 2) throw new PyError('InvalidOperation', "[<class 'decimal.DivisionImpossible'>]");
  if (d.exp >= 0) {
    const n = d.intPart();
    return [new Dec(false, n / 100n, 0), new Dec(false, n % 100n, 0)];
  }
  if (d.magnitude() <= 2) return [new Dec(false, 0n, 0), d.abs()];
  const unit = 100n * pow10(-d.exp);
  const q = d.coef / unit;
  const [coef, exp] = roundCoef(d.coef - q * unit, d.exp);
  return [new Dec(false, q, 0), new Dec(false, coef, exp)];
}

// ---------------------------------------------------------------------------
// The three modes, for each kind of Python number

type PyNumber = bigint | number | Dec;

function cardinal(x: PyNumber): string {
  if (typeof x === 'bigint') {
    if ((x < 0n ? -x : x) >= LIMIT) throw overflow();
    return x < 0n ? `minus ${wordsInt(-x, false)}` : wordsInt(x, false);
  }
  if (typeof x === 'number') {
    if (floatOverLimit(x)) throw overflow();
    if (Number.isNaN(x)) floatToInt(x); // int(nan): ValueError
    if (!Number.isInteger(x)) return pointWords(x);
    return x < 0 ? `minus ${wordsFloat(-x)}` : wordsFloat(x);
  }
  if (x.special === 'nan') throw new PyError('ValueError', 'cannot convert float NaN to integer');
  if (x.special === 'snan') throw new PyError('TypeError', 'type(sNaN) not in [long, int, float]');
  if (x.special === 'inf') throw new PyError('OverflowError', 'cannot convert Infinity to integer');
  if (x.magnitude() > LIMIT_EXP) throw overflow();
  if (!x.isWhole()) return pointWords(x.toFloat());
  // "minus" + the cardinal of abs(d), which Decimal rounds to 28 digits (it can round up
  // to the limit).
  if (x.isNegative()) return `minus ${cardinal(x.abs())}`;
  return wordsInt(x.intPart(), true);
}

function negativeOrdinal(): PyError {
  return new PyError('TypeError', 'Cannot treat negative num as ordinal.');
}

function ordinal(x: PyNumber): string {
  if (typeof x === 'bigint') {
    if (x < 0n) throw negativeOrdinal();
    if (x >= LIMIT) throw overflow();
    return ordinalize(wordsInt(x, false));
  }
  if (typeof x === 'number') {
    floatToInt(x); // int(x) comes first: nan and inf fail here
    if (!Number.isInteger(x)) throw new PyError('TypeError', 'Cannot treat float as ordinal.');
    if (x < 0) throw negativeOrdinal();
    if (floatOverLimit(x)) throw overflow();
    return ordinalize(wordsFloat(x));
  }
  if (x.special === 'inf') throw new PyError('OverflowError', 'cannot convert Infinity to integer');
  if (x.special) throw new PyError('ValueError', 'cannot convert NaN to integer');
  if (!x.isWhole()) throw new PyError('TypeError', 'Cannot treat float as ordinal.');
  // Python checks abs(n) != n, and Decimal's abs() rounds to 28 digits.
  if (x.isNegative() || !x.absIsExact()) throw negativeOrdinal();
  if (x.magnitude() > LIMIT_EXP) throw overflow();
  return ordinalize(wordsInt(x.intPart(), true));
}

/** divmod(n, 100) of a year and the tests the year rule makes on it. */
interface YearParts {
  n: PyNumber;
  high: PyNumber;
  low: PyNumber;
  highIsZero: boolean;
  highEndsInZero: boolean;
  highOver99: boolean;
  lowIsZero: boolean;
  lowUnder10: boolean;
}

function yearWords(p: YearParts): string {
  if (p.highIsZero || (p.highEndsInZero && p.lowUnder10) || p.highOver99) return cardinal(p.n);
  if (p.lowIsZero) return `${cardinal(p.high)} hundred`;
  return `${cardinal(p.high)} ${p.lowUnder10 ? 'oh-' : ''}${cardinal(p.low)}`;
}

function year(x: PyNumber): string {
  let bc: boolean;
  let parts: YearParts;
  if (typeof x === 'bigint') {
    bc = x < 0n;
    const n = bc ? -x : x;
    const high = n / 100n;
    const low = n % 100n;
    parts = {
      n, high, low, highIsZero: high === 0n, highEndsInZero: high % 10n === 0n,
      highOver99: high >= 100n, lowIsZero: low === 0n, lowUnder10: low < 10n,
    };
  } else if (typeof x === 'number') {
    // Python float divmod: inf and nan give nan parts, and cardinal(nan) is a ValueError.
    bc = x < 0;
    const n = bc ? -x : x;
    const [high, low] = floatDivmod(n, 100);
    parts = {
      n, high, low, highIsZero: high === 0, highEndsInZero: floatMod(high, 10) === 0,
      highOver99: high >= 100, lowIsZero: low === 0, lowUnder10: low < 10,
    };
  } else {
    // Decimal: divmod of inf and ordering tests on nan are InvalidOperation.
    if (x.special) throw new PyError('InvalidOperation', "[<class 'decimal.InvalidOperation'>]");
    bc = x.isNegative();
    const n = bc ? x.abs() : x;
    const [high, low] = decDivmod100(n);
    parts = {
      n, high, low, highIsZero: high.isZero(), highEndsInZero: high.coef % 10n === 0n,
      highOver99: high.cmp(100) >= 0, lowIsZero: low.isZero(), lowUnder10: low.cmp(10) < 0,
    };
  }
  const words = yearWords(parts);
  return bc ? `${words} BC` : words;
}

/**
 * num2words(value, to=...) for lang "en". A bigint stands for a Python int, a number for a
 * Python float, and a string is read as Python's Decimal(string) would read it.
 */
export function num2words(value: number | bigint | string, to: Num2WordsTo = 'cardinal'): string {
  let x: PyNumber;
  if (typeof value === 'bigint' || typeof value === 'number') x = value;
  else if (typeof value === 'string') x = parseDecimal(value);
  else throw new PyError('TypeError', `type(${String(value)}) not in [long, int, float]`);
  if (to === 'cardinal') return cardinal(x);
  if (to === 'ordinal') return ordinal(x);
  if (to === 'year') return year(x);
  throw new PyError('NotImplementedError', `to=${String(to)} is not supported`);
}
