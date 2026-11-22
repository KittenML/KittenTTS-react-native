// Word timings for the Kitten TTS 2 nano / pico / mini models. The graph returns frames per
// token, and every phoneme character is one token, so each space-separated phoneme word gets
// an exact time range. Those are then shared out over the words of the input text: one each
// where counts agree, more for words the text processing expands (numbers, dates,
// abbreviations), estimated with the same English normaliser.

import type { KittenWordTiming } from '../KittenWordTiming';
import { normalize } from './frontend/english/TtsNorm';

export interface PhonemeWordTime {
  phonemes: string;
  /** Seconds from the start of the chunk's (trimmed) audio. */
  start: number;
  end: number;
}

/**
 * Time ranges of the phoneme words of one chunk. `durations` are the graph's frames per
 * token for tokens [0] + phonemes + [10] + [0]; `lead` is the number of samples trimmed from
 * the start, `spf` samples per frame.
 */
export function phonemeWordTimes(
  phonemes: string,
  vocab: Record<string, number>,
  durations: readonly number[],
  spf: number,
  lead: number,
  sampleRate: number,
  length: number,
): PhonemeWordTime[] {
  const out: PhonemeWordTime[] = [];
  const toSeconds = (frames: number) => Math.min(length, Math.max(0, frames * spf - lead)) / sampleRate;
  let frame = durations[0] ?? 0;          // the start token
  let token = 1;
  let word = '';
  let start = 0;
  let end = 0;
  for (const ch of phonemes) {
    // KittenTTS2Tiny._tokens: characters outside the vocab make no token, except brackets.
    const hasToken = Object.prototype.hasOwnProperty.call(vocab, ch) || ch === '(' || ch === ')';
    const d = hasToken ? durations[token++] ?? 0 : 0;
    if (ch === ' ') {
      if (word) out.push({ phonemes: word, start: toSeconds(start), end: toSeconds(end) });
      word = '';
    } else {
      if (!word) start = frame;
      word += ch;
      end = frame + d;
    }
    frame += d;
  }
  if (word) out.push({ phonemes: word, start: toSeconds(start), end: toSeconds(end) });
  return out;
}

/** How many phoneme words one input word is likely to become. */
function estimate(word: string, language: string): number {
  const core = word.replace(/^[^\p{L}\p{N}$€£¥]+/u, '').replace(/[^\p{L}\p{N}%]+$/u, '');
  if (!core) return 0;
  if (language !== 'en') return 1;
  try {
    return Math.max(1, normalize(core).split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w)).length);
  } catch {
    return 1;
  }
}

/** Shares phoneme-word timings (in order, across chunks) out over the text's words. */
export function wordTimings(text: string, language: string, groups: readonly PhonemeWordTime[]): KittenWordTiming[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || groups.length === 0) return [];
  const want = words.map(w => estimate(w, language));
  let counts = want.map(n => Math.max(n, 0));
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== groups.length) {
    // Scale the estimates to the real number of groups, keeping every spoken word at least one.
    const spoken = counts.filter(c => c > 0).length || words.length;
    if (groups.length <= spoken) {
      counts = counts.map(c => (c > 0 ? 1 : 0));
    } else {
      const scale = groups.length / Math.max(1, total);
      counts = counts.map(c => (c > 0 ? Math.max(1, Math.round(c * scale)) : 0));
    }
    let diff = groups.length - counts.reduce((a, b) => a + b, 0);
    for (let i = counts.length - 1; diff !== 0 && i >= 0; i--) {
      if (counts[i] === 0) continue;
      const step = diff > 0 ? diff : Math.max(diff, 1 - counts[i]);
      counts[i] += step;
      diff -= step;
    }
  }
  const out: KittenWordTiming[] = [];
  let g = 0;
  words.forEach((word, wordIndex) => {
    const n = counts[wordIndex];
    if (n <= 0 || g >= groups.length) return;
    const first = groups[g];
    const last = groups[Math.min(groups.length, g + n) - 1];
    out.push({ wordIndex, word, startTime: first.start, endTime: last.end });
    g += n;
  });
  return out;
}
