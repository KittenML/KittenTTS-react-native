/**
 * Normalises English text before phonemisation.
 *
 * Pipeline: expand currency -> expand percentages -> expand ordinals ->
 * expand numbers -> clean punctuation -> collapse whitespace.
 */

/** Apply the full normalisation pipeline to the input text. */
export function preprocess(text: string): string {
  let t = text;
  t = expandInlineAcronyms(t);
  t = expandCurrency(t);
  t = expandPercentages(t);
  t = expandOrdinals(t);
  t = expandNumbers(t);
  t = cleanPunctuation(t);
  t = normaliseWhitespace(t);
  return t;
}

function expandInlineAcronyms(text: string): string {
  return text.replace(/\b([A-Z]?[a-z]+)([A-Z]{2,})\b/g, (_match, word: string, acronym: string) => {
    return `${word} ${acronym.split('').join(' ')}`;
  });
}

// ---------------------------------------------------------------------------
// Currency
// ---------------------------------------------------------------------------

function expandCurrency(text: string): string {
  return text.replace(
    /(-)?([$€£¥])(-)?(\d+(?:[,\d]*\d)?(?:\.\d+)?)(K|M|B|T)?/g,
    (
      _match,
      leadingMinus: string | undefined,
      symbol: string,
      innerMinus: string | undefined,
      amountStr: string,
      multiplier: string | undefined,
    ) => {
      const cleaned = amountStr.replace(/,/g, '');
      let amount = parseFloat(cleaned);
      const negative = Boolean(leadingMinus || innerMinus);

      let multiplierWord = '';
      switch (multiplier) {
        case 'K': multiplierWord = ' thousand'; break;
        case 'M': multiplierWord = ' million'; break;
        case 'B': multiplierWord = ' billion'; break;
        case 'T': multiplierWord = ' trillion'; break;
      }

      let currencyName: string;
      switch (symbol) {
        case '$': currencyName = amount === 1 ? ' dollar' : ' dollars'; break;
        case '€': currencyName = amount === 1 ? ' euro' : ' euros'; break;
        case '£': currencyName = amount === 1 ? ' pound' : ' pounds'; break;
        case '¥': currencyName = ' yen'; break;
        default: currencyName = '';
      }

      const prefix = negative ? 'negative ' : '';
      if (amount === Math.floor(amount)) {
        return prefix + moneyAmountToWords(amount) + multiplierWord + currencyName;
      }
      const intPart = moneyAmountToWords(Math.floor(amount));
      const fracPart = cleaned.split('.')[1] || '';
      const fracWords = fracPart.split('').map(digitWord).join(' ');
      return prefix + intPart + ' point ' + fracWords + multiplierWord + currencyName;
    },
  );
}

function moneyAmountToWords(amount: number): string {
  if (amount >= 1100 && amount < 2000 && amount % 100 === 0) {
    return `${numberToWords(amount / 100)} hundred`;
  }
  return numberToWords(amount);
}

// ---------------------------------------------------------------------------
// Percentages
// ---------------------------------------------------------------------------

function expandPercentages(text: string): string {
  return text.replace(
    /(\d+(?:\.\d+)?)\s*%/g,
    (_match, numStr: string) => {
      const num = parseFloat(numStr);
      if (Number.isInteger(num)) {
        return numberToWords(num) + ' percent';
      }
      const parts = numStr.split('.');
      const intWords = numberToWords(Math.floor(num));
      const fracWords = (parts[1] || '').split('').map(digitWord).join(' ');
      return intWords + ' point ' + fracWords + ' percent';
    },
  );
}

// ---------------------------------------------------------------------------
// Ordinals
// ---------------------------------------------------------------------------

const ORDINAL_MAP: Record<string, string> = {
  '1st': 'first', '2nd': 'second', '3rd': 'third', '4th': 'fourth',
  '5th': 'fifth', '6th': 'sixth', '7th': 'seventh', '8th': 'eighth',
  '9th': 'ninth', '10th': 'tenth', '11th': 'eleventh', '12th': 'twelfth',
  '13th': 'thirteenth', '14th': 'fourteenth', '15th': 'fifteenth',
  '16th': 'sixteenth', '17th': 'seventeenth', '18th': 'eighteenth',
  '19th': 'nineteenth', '20th': 'twentieth',
  '21st': 'twenty-first', '22nd': 'twenty-second', '23rd': 'twenty-third',
  '30th': 'thirtieth', '40th': 'fortieth', '50th': 'fiftieth',
  '100th': 'one hundredth', '1000th': 'one thousandth',
};

function expandOrdinals(text: string): string {
  return text.replace(
    /\b(\d+)(st|nd|rd|th)\b/gi,
    (match, num: string, suffix: string) => {
      const full = match.toLowerCase();
      if (ORDINAL_MAP[full]) return ORDINAL_MAP[full];
      const n = parseInt(num, 10);
      if (!isNaN(n)) return ordinalToWords(n);
      return match;
    },
  );
}

// ---------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------

function expandNumbers(text: string): string {
  // Decimals first
  let t = text.replace(
    /\b(\d+)\.(\d+)\b/g,
    (_match, intPart: string, fracPart: string) => {
      const intWords = numberToWords(parseInt(intPart, 10));
      const fracWords = fracPart.split('').map(digitWord).join(' ');
      return intWords + ' point ' + fracWords;
    },
  );
  // Integers (with optional comma separators)
  t = t.replace(
    /\b\d{1,3}(?:,\d{3})*\b|\b\d+\b/g,
    (match) => {
      const numStr = match.replace(/,/g, '');
      const n = parseInt(numStr, 10);
      if (!isNaN(n)) return numberToWords(n);
      return match;
    },
  );
  return t;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanPunctuation(text: string): string {
  let t = text.replace(/<[^>]+>/g, ' ');
  t = t.replace(/\u2013/g, '\u2014').replace(/ - /g, ' \u2014 ');
  return t;
}

function normaliseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Number to words
// ---------------------------------------------------------------------------

const ONES = [
  '', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen',
];
const TENS = [
  '', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety',
];

/** Convert an integer to its English word representation. Handles up to trillions. */
export function numberToWords(n: number): string {
  if (n < 0) return 'negative ' + numberToWords(-n);
  if (n === 0) return 'zero';

  let result = '';
  let remaining = n;

  if (remaining >= 1_000_000_000_000) {
    result += numberToWords(Math.floor(remaining / 1_000_000_000_000)) + ' trillion ';
    remaining %= 1_000_000_000_000;
  }
  if (remaining >= 1_000_000_000) {
    result += numberToWords(Math.floor(remaining / 1_000_000_000)) + ' billion ';
    remaining %= 1_000_000_000;
  }
  if (remaining >= 1_000_000) {
    result += numberToWords(Math.floor(remaining / 1_000_000)) + ' million ';
    remaining %= 1_000_000;
  }
  if (remaining >= 1_000) {
    result += numberToWords(Math.floor(remaining / 1_000)) + ' thousand ';
    remaining %= 1_000;
  }
  if (remaining >= 100) {
    result += ONES[Math.floor(remaining / 100)] + ' hundred ';
    remaining %= 100;
  }
  if (remaining >= 20) {
    result += TENS[Math.floor(remaining / 10)];
    remaining %= 10;
    if (remaining > 0) result += '-' + ONES[remaining];
  } else if (remaining > 0) {
    result += ONES[remaining];
  }

  return result.trim();
}

function ordinalToWords(n: number): string {
  if (n < 0) return 'negative ' + ordinalToWords(-n);

  const direct = ORDINAL_WORDS[n];
  if (direct) return direct;

  if (n < 100) {
    const tens = Math.floor(n / 10) * 10;
    const ones = n % 10;
    if (ones === 0) return ORDINAL_TENS[tens] ?? numberToWords(n);
    return `${TENS[tens / 10]}-${ordinalToWords(ones)}`;
  }

  for (const scale of ORDINAL_SCALES) {
    if (n >= scale.value) {
      const count = Math.floor(n / scale.value);
      const remainder = n % scale.value;
      const prefix = `${numberToWords(count)} ${scale.name}`;
      return remainder === 0 ? `${prefix}th` : `${prefix} ${ordinalToWords(remainder)}`;
    }
  }

  return numberToWords(n);
}

const ORDINAL_WORDS: Record<number, string> = {
  0: 'zeroth',
  1: 'first',
  2: 'second',
  3: 'third',
  4: 'fourth',
  5: 'fifth',
  6: 'sixth',
  7: 'seventh',
  8: 'eighth',
  9: 'ninth',
  10: 'tenth',
  11: 'eleventh',
  12: 'twelfth',
  13: 'thirteenth',
  14: 'fourteenth',
  15: 'fifteenth',
  16: 'sixteenth',
  17: 'seventeenth',
  18: 'eighteenth',
  19: 'nineteenth',
};

const ORDINAL_TENS: Record<number, string> = {
  20: 'twentieth',
  30: 'thirtieth',
  40: 'fortieth',
  50: 'fiftieth',
  60: 'sixtieth',
  70: 'seventieth',
  80: 'eightieth',
  90: 'ninetieth',
};

const ORDINAL_SCALES = [
  { value: 1_000_000_000_000, name: 'trillion' },
  { value: 1_000_000_000, name: 'billion' },
  { value: 1_000_000, name: 'million' },
  { value: 1_000, name: 'thousand' },
  { value: 100, name: 'hundred' },
];

function digitWord(d: string): string {
  const map: Record<string, string> = {
    '0': 'zero', '1': 'one', '2': 'two', '3': 'three', '4': 'four',
    '5': 'five', '6': 'six', '7': 'seven', '8': 'eight', '9': 'nine',
  };
  return map[d] ?? d;
}
