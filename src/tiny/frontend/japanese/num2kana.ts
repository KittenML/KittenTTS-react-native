// misaki/num2kana.py (from Greatdane/Convert-Numbers-to-Japanese, MIT), the part misaki's cutlet
// calls: Convert(digits) with the hiragana dictionary. Python's dict lookups raise KeyError for
// characters it has no entry for (digits other than ASCII 0-9); so does this port.
// Strings are handled as arrays of code points, like Python's len() and slicing.

const HIRAGANA: Record<string, string> = {
  '0': 'ゼロ', '1': 'いち', '2': 'に', '3': 'さん', '4': 'よん', '5': 'ご', '6': 'ろく', '7': 'なな',
  '8': 'はち', '9': 'きゅう', '10': 'じゅう', '100': 'ひゃく', '1000': 'せん', '10000': 'まん', '100000000': 'おく',
  '300': 'さんびゃく', '600': 'ろっぴゃく', '800': 'はっぴゃく', '3000': 'さんぜん', '8000': 'はっせん', '01000': 'いっせん',
};

type Num = string[];   // code points

function d(key: string): string {
  if (!Object.prototype.hasOwnProperty.call(HIRAGANA, key)) throw new Error(`KeyError: '${key}'`);
  return HIRAGANA[key];
}

const str = (n: Num) => n.join('');

function lenOne(n: string): string {
  return d(n);
}

function lenTwo(n: Num): string {
  if (n[0] === '0') return lenOne(n[1]);
  if (str(n) === '10') return d('10');
  if (n[0] === '1') return d('10') + ' ' + lenOne(n[1]);
  if (n[1] === '0') return lenOne(n[0]) + ' ' + d('10');
  const list = n.map(x => d(x));
  list.splice(1, 0, d('10'));
  return list.join(' ');
}

function lenThree(n: Num): string {
  const list: string[] = [];
  if (n[0] === '1') list.push(d('100'));
  else if (n[0] === '3') list.push(d('300'));
  else if (n[0] === '6') list.push(d('600'));
  else if (n[0] === '8') list.push(d('800'));
  else {
    list.push(d(n[0]));
    list.push(d('100'));
  }
  if (!(str(n.slice(1)) === '00' && n.length === 3)) {
    if (n[1] === '0') list.push(d(n[2]));
    else list.push(lenTwo(n.slice(1)));
  }
  return list.join(' ');
}

function lenFour(n: Num, standAlone: boolean): string {
  const list: string[] = [];
  if (str(n) === '0000') return '';
  while (n[0] === '0') n = n.slice(1);
  if (n.length === 1) return lenOne(n[0]);
  if (n.length === 2) return lenTwo(n);
  if (n.length === 3) return lenThree(n);
  if (n[0] === '1' && standAlone) list.push(d('1000'));
  else if (n[0] === '1') list.push(d('01000'));
  else if (n[0] === '3') list.push(d('3000'));
  else if (n[0] === '8') list.push(d('8000'));
  else {
    list.push(d(n[0]));
    list.push(d('1000'));
  }
  if (!(str(n.slice(1)) === '000' && n.length === 4)) {
    if (n[1] === '0') list.push(lenTwo(n.slice(2)));
    else list.push(lenThree(n.slice(1)));
  }
  return list.join(' ');
}

function lenX(n: Num): string {
  const list: string[] = [];
  const head = n.slice(0, Math.max(0, n.length - 4));
  if (head.length === 1) {
    list.push(d(str(head)));
    list.push(d('10000'));
  } else if (head.length === 2) {
    list.push(lenTwo(n.slice(0, 2)));
    list.push(d('10000'));
  } else if (head.length === 3) {
    list.push(lenThree(n.slice(0, 3)));
    list.push(d('10000'));
  } else if (head.length === 4) {
    list.push(lenFour(n.slice(0, 4), false));
    list.push(d('10000'));
  } else if (head.length === 5) {
    list.push(d(n[0]));
    list.push(d('100000000'));
    list.push(lenFour(n.slice(1, 5), false));
    if (str(n.slice(1, 5)) !== '0000') list.push(d('10000'));
  } else {
    throw new Error('AssertionError: Not yet implemented, please choose a lower number.');
  }
  list.push(lenFour(n.slice(-4), false));
  return list.join(' ');
}

function doConvert(n: Num): string {
  if (n.length === 1) return lenOne(n[0]);
  if (n.length === 2) return lenTwo(n);
  if (n.length === 3) return lenThree(n);
  if (n.length === 4) return lenFour(n, true);
  return lenX(n);
}

/**
 * num2kana.Convert(digits, 'hiragana') for a run of characters str.isdigit() accepts (cutlet
 * never passes a "." here, so the decimal branch is not ported).
 */
export function convertNumber(digits: string): string {
  let n: Num = Array.from(digits.split(',').join(''));
  if (n.length > 9) return 'Number length too long, choose less than 10 digits';
  while (n[0] === '0' && n.length > 1) n = n.slice(1);
  return doConvert(n).split(' ').join('');
}
