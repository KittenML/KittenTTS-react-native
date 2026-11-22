// The phonemizer-v1 / v2 symbol folds (kittenml/kittentts2_tiny/frontend/phonemize_v1.py
// and phonemize_v2.py). Order matters: replacements run in this order, as Python's dict
// iteration does.

import { pyStripSpace } from './english/pystr';

export const FOLD_V1: Array<[string, string]> = [
  ['\u032a', ''],
  ['\u0329', ''],
  ['\u030d', ''],
  ['\u032f', ''],
  ['ɭ', 'l'],
  ['ɫ', 'l'],
  ['ɵ', 'ø'],
  ['ε', 'ɛ'],
  ['\u0005', ''],
  ['\u0006', ''],
  ['\u0007', ''],
  ['\u0008', ''],
  ['{', ''],
  ['}', ''],
  ['[', ''],
  [']', ''],
  ['¿', ''],
  ['¡', ''],
  ['\u202f', ' '],
];

export const FOLD_EXTRA: Array<[string, string]> = [
  ['\u2009', ' '],
  ['\t', ' '],
  ['«', ''],
  ['»', ''],
  ['‘', ''],
  ['’', ''],
  ["'", ''],
  ['~', ''],
  ['·', ''],
  ['#', ''],
  ['g', 'ɡ'],
];

function applyFold(ps: string, table: Array<[string, string]>): string {
  for (const [src, dst] of table) if (ps.includes(src)) ps = ps.split(src).join(dst);
  return ps;
}

/** phonemize_v1.phonemize after the G2P: strip, then FOLD. */
export function foldV1(ps: string): string {
  return applyFold(pyStripSpace(ps), FOLD_V1);
}

/** phonemize_v2.fold_extra */
export function foldExtra(ps: string): string {
  return applyFold(ps, FOLD_EXTRA);
}
