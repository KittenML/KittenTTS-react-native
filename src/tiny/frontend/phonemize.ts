// The phonemizer-v1 / v2 symbol folds (kittenml/kittentts2_tiny/frontend/phonemize_v1.py
// and phonemize_v2.py). Order matters: replacements run in this order, as Python's dict
// iteration does.

import { pyStripSpace, replaceAll } from './pystr';

type Fold = ReadonlyArray<readonly [string, string]>;

export const FOLD_V1: Fold = [
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

const FOLD_EXTRA: Fold = [
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

/** phonemize_v2.FOLD = {**phonemize_v1.FOLD, **FOLD_EXTRA} (no key of FOLD_EXTRA is in v1's). */
export const FOLD_V2: Fold = [...FOLD_V1, ...FOLD_EXTRA];

export function applyFold(ps: string, table: Fold): string {
  for (const [src, dst] of table) ps = replaceAll(ps, src, dst);
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
