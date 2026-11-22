// Port of the English parts of the Python `num2words` 0.5.14 package (num2words/base.py,
// lang_EU.py, lang_EN.py) that Kitten TTS 2 Nano/Pico/Mini's text front end uses:
// tts_norm calls num2words(int), to='ordinal' and to='year'; misaki's en.py also calls
// num2words(float(word)). Output matches Python string for string, including its quirks:
//
//   - Python ints are `bigint` here (callers pass digit strings far beyond 2^53).
//   - Python floats are `number`. An integral float takes the integer path, but Python
//     then splits it with float divmod, so a big float like 1e305 is NOT spelled like
//     int(1e305); that float arithmetic is reproduced.
//   - A non-integral float is spelled "<int part> point <digit> <digit> ...", with the
//     number of digits taken from repr(float), and the sign of -0.5 lost ("zero point
//     five"), as in Python.
//   - Errors carry the Python exception name (OverflowError, TypeError, ValueError).

import { floatToInt, PyError } from '../pystr';

export type Num2WordsTo = 'cardinal' | 'ordinal' | 'year';

interface Pair {
  text: string;
  num: bigint;
}
type Item = Pair | Item[];

// ---- the number words (Num2Word_EU.setup + Num2Word_EN.setup) ----

const HIGH_LOWS = ['non', 'oct', 'sept', 'sext', 'quint', 'quadr', 'tr', 'b', 'm'];
const HIGH_UNITS = ['', 'un', 'duo', 'tre', 'quattuor', 'quin', 'sex', 'sept', 'octo', 'novem'];
const HIGH_TENS = [
  'dec', 'vigint', 'trigint', 'quadragint', 'quinquagint',
  'sexagint', 'septuagint', 'octogint', 'nonagint',
];
const MID_NUMWORDS: Array<[number, string]> = [
  [1000, 'thousand'], [100, 'hundred'], [90, 'ninety'], [80, 'eighty'], [70, 'seventy'],
  [60, 'sixty'], [50, 'fifty'], [40, 'forty'], [30, 'thirty'],
];
const LOW_NUMWORDS = [
  'twenty', 'nineteen', 'eighteen', 'seventeen', 'sixteen', 'fifteen', 'fourteen',
  'thirteen', 'twelve', 'eleven', 'ten', 'nine', 'eight', 'seven', 'six', 'five',
  'four', 'three', 'two', 'one', 'zero',
];
const ORDS: Record<string, string> = {
  one: 'first', two: 'second', three: 'third', four: 'fourth', five: 'fifth',
  six: 'sixth', seven: 'seventh', eight: 'eighth', nine: 'ninth', ten: 'tenth',
  eleven: 'eleventh', twelve: 'twelfth',
};

function pow10(n: number): bigint {
  let p = BigInt(1);
  const ten = BigInt(10);
  for (let i = 0; i < n; i++) p *= ten;
  return p;
}

/** self.cards, in OrderedDict order: 10^303 ... 10^6, 1000, 100, 90 ... 30, 20 ... 0. */
const CARD_NUMS: bigint[] = [];
/** float(key), what Python's divmod(float, int) converts each key to (correctly rounded). */
const CARD_FLOATS: number[] = [];
const CARD_WORDS: string[] = [];

(function buildCards() {
  // gen_high_numwords: [u + t for t in tens for u in units], reversed, then the lows
  const gen: string[] = [];
  for (const t of HIGH_TENS) for (const u of HIGH_UNITS) gen.push(u + t);
  gen.reverse();
  const high = ['cent', ...gen, ...HIGH_LOWS];
  // Num2Word_EN.set_high_numwords: zip(high, range(3 + 3 * len(high), 3, -3))
  for (let i = 0, n = 3 + 3 * high.length; i < high.length && n > 3; i++, n -= 3) {
    CARD_NUMS.push(pow10(n));
    CARD_FLOATS.push(Number('1e' + n));
    CARD_WORDS.push(high[i] + 'illion');
  }
  for (const [n, word] of MID_NUMWORDS) {
    CARD_NUMS.push(BigInt(n));
    CARD_FLOATS.push(n);
    CARD_WORDS.push(word);
  }
  for (let i = 0; i < LOW_NUMWORDS.length; i++) {
    const n = LOW_NUMWORDS.length - 1 - i;
    CARD_NUMS.push(BigInt(n));
    CARD_FLOATS.push(n);
    CARD_WORDS.push(LOW_NUMWORDS[i]);
  }
})();

const MAXVAL: bigint = BigInt(1000) * CARD_NUMS[0];
const ZERO = BigInt(0);
const ONE = BigInt(1);
const TEN = BigInt(10);
const HUNDRED = BigInt(100);
const TWO_53 = 9007199254740992;

// ---- Python float helpers ----

/** Python's divmod(float, float) (Objects/floatobject.c _float_div_mod). */
function floatDivmod(vx: number, wx: number): [number, number] {
  // C truth tests: NaN counts as true, so compare with 0 instead of `if (mod)`
  let mod = vx % wx; // fmod: exact
  let div = (vx - mod) / wx;
  if (mod !== 0) {
    if ((wx < 0) !== (mod < 0)) {
      mod += wx;
      div -= 1.0;
    }
  } else {
    mod = wx < 0 ? -0 : 0;
  }
  let floordiv: number;
  if (div !== 0) {
    floordiv = Math.floor(div);
    if (div - floordiv > 0.5) floordiv += 1.0;
  } else {
    floordiv = vx / wx < 0 || Object.is(vx / wx, -0) ? -0 : 0;
  }
  return [floordiv, mod];
}

/** Python's round(x) for a float: half to even. */
function roundHalfEven(x: number): number {
  const f = Math.floor(x);
  const d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

/** abs(Decimal(str(x)).as_tuple().exponent): the decimal places of repr(x). */
function reprDecimalPlaces(x: number): number {
  // String(x) has the same shortest round-trip digits as Python's repr; only the
  // switch to exponent form differs, and the parse below does not care.
  const m = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/.exec(String(Math.abs(x)));
  if (!m) throw new PyError('ValueError', `cannot read float ${x}`);
  const frac = m[2] ? m[2].length : 0;
  const exp = m[3] ? parseInt(m[3], 10) : 0;
  return Math.abs(exp - frac);
}

// ---- Num2Word_Base ----

function splitnum(value: bigint): Item[] {
  for (let i = 0; i < CARD_NUMS.length; i++) {
    const elem = CARD_NUMS[i];
    if (elem > value) continue;
    const out: Item[] = [];
    let div: bigint;
    let mod: bigint;
    if (value === ZERO) {
      div = ONE;
      mod = ZERO;
    } else {
      div = value / elem;
      mod = value % elem;
    }
    if (div === ONE) {
      out.push({ text: 'one', num: ONE });
    } else {
      // Python's "tallying" branch (div == value) needs a card of 1 to be used with
      // value > 1, which English never does (2..20 all have their own card).
      if (div === value) throw new PyError('TypeError', 'tally branch is not reachable in English');
      out.push(splitnum(div));
    }
    out.push({ text: CARD_WORDS[i], num: elem });
    if (mod !== ZERO) out.push(splitnum(mod));
    return out;
  }
  throw new PyError('TypeError', `cannot split ${value}`);
}

/** splitnum() on a Python float holding an integer >= 2^53: float divmod, int keys. */
function splitnumFloat(value: number): Item[] {
  const exact = BigInt(value); // for the exact int/float comparison Python does
  for (let i = 0; i < CARD_NUMS.length; i++) {
    const elem = CARD_NUMS[i];
    if (elem > exact) continue;
    const out: Item[] = [];
    let div: number;
    let mod: number;
    if (value === 0) {
      div = 1;
      mod = 0;
    } else {
      [div, mod] = floatDivmod(value, CARD_FLOATS[i]);
    }
    if (div === 1) {
      out.push({ text: 'one', num: ONE });
    } else {
      if (div === value) throw new PyError('TypeError', 'tally branch is not reachable in English');
      out.push(div < TWO_53 ? splitnum(BigInt(div)) : splitnumFloat(div));
    }
    out.push({ text: CARD_WORDS[i], num: elem });
    if (mod !== 0) out.push(mod < TWO_53 ? splitnum(BigInt(mod)) : splitnumFloat(mod));
    return out;
  }
  throw new PyError('TypeError', `cannot split ${value}`);
}

/** Num2Word_EN.merge */
function merge(l: Pair, r: Pair): Pair {
  const ln = l.num;
  const rn = r.num;
  if (ln === ONE && rn < HUNDRED) return { text: r.text, num: rn };
  if (HUNDRED > ln && ln > rn) return { text: `${l.text}-${r.text}`, num: ln + rn };
  if (ln >= HUNDRED && HUNDRED > rn) return { text: `${l.text} and ${r.text}`, num: ln + rn };
  if (rn > ln) return { text: `${l.text} ${r.text}`, num: ln * rn };
  return { text: `${l.text}, ${r.text}`, num: ln + rn };
}

/** Num2Word_Base.clean, step for step (it nests the unmerged tail as one list). */
function clean(val: Item[]): Item {
  let out: Item[] = val;
  while (val.length !== 1) {
    out = [];
    const left = val[0];
    const right = val[1];
    if (!Array.isArray(left) && !Array.isArray(right)) {
      out.push(merge(left, right));
      if (val.length > 2) out.push(val.slice(2));
    } else {
      for (const elem of val) {
        if (Array.isArray(elem)) {
          out.push(elem.length === 1 ? elem[0] : clean(elem));
        } else {
          out.push(elem);
        }
      }
    }
    val = out;
  }
  return out[0];
}

function words(item: Item): string {
  if (Array.isArray(item)) throw new PyError('TypeError', 'clean() did not reduce to one pair');
  return item.text;
}

function cardinalInt(value: bigint): string {
  let out = '';
  if (value < ZERO) {
    value = -value;
    out = 'minus ';
  }
  if (value >= MAXVAL) {
    throw new PyError('OverflowError', `abs(${value}) must be less than ${MAXVAL}.`);
  }
  return out + words(clean(splitnum(value)));
}

function cardinalFloat(value: number): string {
  // to_cardinal_float + float2tuple
  const pre = Math.trunc(value);
  const precision = reprDecimalPlaces(value);
  const scale = Number('1e' + precision); // float(10 ** precision)
  if (!Number.isFinite(scale)) throw new PyError('OverflowError', 'int too large to convert to float');
  const post = Math.abs(value - pre) * scale;
  const rounded = roundHalfEven(post);
  const postInt = Math.abs(rounded - post) < 0.01 ? BigInt(rounded) : BigInt(Math.floor(post));
  let digits = postInt.toString();
  digits = '0'.repeat(Math.max(0, precision - digits.length)) + digits;

  const out = [cardinalInt(BigInt(pre))];
  if (precision) out.push('point');
  for (let i = 0; i < precision; i++) out.push(cardinalInt(BigInt(Number(digits[i]))));
  return out.join(' ');
}

function cardinalNumber(value: number): string {
  if (Number.isNaN(value)) throw new PyError('ValueError', 'cannot convert float NaN to integer');
  if (!Number.isFinite(value)) throw new PyError('OverflowError', 'cannot convert float infinity to integer');
  if (!Number.isInteger(value)) return cardinalFloat(value);
  let out = '';
  if (value < 0) {
    value = -value;
    out = 'minus ';
  }
  if (BigInt(value) >= MAXVAL) {
    throw new PyError('OverflowError', `abs(${value}) must be less than ${MAXVAL}.`);
  }
  // below 2^53 float divmod is exact, so the int path gives the same words
  return out + words(clean(value < TWO_53 ? splitnum(BigInt(value)) : splitnumFloat(value)));
}

function toCardinal(value: bigint | number): string {
  return typeof value === 'bigint' ? cardinalInt(value) : cardinalNumber(value);
}

function verifyOrdinal(value: bigint | number): void {
  if (typeof value === 'bigint') {
    if (value < ZERO) throw new PyError('TypeError', `Cannot treat negative num ${value} as ordinal.`);
    return;
  }
  floatToInt(value); // int(value) raises for nan / inf
  if (!Number.isInteger(value)) throw new PyError('TypeError', `Cannot treat float ${value} as ordinal.`);
  if (value < 0) throw new PyError('TypeError', `Cannot treat negative num ${value} as ordinal.`);
}

function toOrdinal(value: bigint | number): string {
  verifyOrdinal(value);
  const outwords = toCardinal(value).split(' ');
  const lastwords = outwords[outwords.length - 1].split('-');
  let lastword = lastwords[lastwords.length - 1].toLowerCase();
  if (Object.prototype.hasOwnProperty.call(ORDS, lastword)) {
    lastword = ORDS[lastword];
  } else {
    if (lastword[lastword.length - 1] === 'y') lastword = lastword.slice(0, -1) + 'ie';
    lastword += 'th';
  }
  lastwords[lastwords.length - 1] = lastword;
  outwords[outwords.length - 1] = lastwords.join('-');
  return outwords.join(' ');
}

function toYear(val: bigint | number): string {
  let suffix: string | null = null;
  let valtext: string;
  if (typeof val === 'bigint') {
    if (val < ZERO) {
      val = -val;
      suffix = 'BC';
    }
    const high = val / HUNDRED;
    const low = val % HUNDRED;
    if (high === ZERO || (high % TEN === ZERO && low < TEN) || high >= HUNDRED) {
      valtext = cardinalInt(val);
    } else {
      const hightext = cardinalInt(high);
      const lowtext = low === ZERO ? 'hundred' : low < TEN ? `oh-${cardinalInt(low)}` : cardinalInt(low);
      valtext = `${hightext} ${lowtext}`;
    }
  } else {
    if (val < 0) {
      val = Math.abs(val);
      suffix = 'BC';
    }
    const [high, low] = floatDivmod(val, 100);
    if (high === 0 || (floatDivmod(high, 10)[1] === 0 && low < 10) || high >= 100) {
      valtext = cardinalNumber(val);
    } else {
      const hightext = cardinalNumber(high);
      const lowtext = low === 0 ? 'hundred' : low < 10 ? `oh-${cardinalNumber(low)}` : cardinalNumber(low);
      valtext = `${hightext} ${lowtext}`;
    }
  }
  return suffix ? `${valtext} ${suffix}` : valtext;
}

/**
 * num2words(value, lang='en', to=...).
 *
 * - `bigint` is a Python int, `number` a Python float (an integral number below 2^53
 *   spells the same either way).
 * - A string is read the way the Python callers build their arguments: an integer
 *   string as int(s) (any length), anything else as float(s).
 */
export function num2words(value: number | bigint | string, to: Num2WordsTo = 'cardinal'): string {
  let v: number | bigint;
  if (typeof value === 'string') {
    const s = value.trim();
    if (/^[+-]?[0-9]+$/.test(s)) {
      v = BigInt(s);
    } else {
      v = Number(s);
      if (Number.isNaN(v) && !/^[+-]?nan$/i.test(s)) {
        throw new PyError('ValueError', `could not convert string to float: '${value}'`);
      }
    }
  } else {
    v = value;
  }
  switch (to) {
    case 'cardinal':
      return toCardinal(v);
    case 'ordinal':
      return toOrdinal(v);
    case 'year':
      return toYear(v);
    default:
      throw new PyError('NotImplementedError', `to='${String(to)}'`);
  }
}
