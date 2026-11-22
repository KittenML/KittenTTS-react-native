// Word timings for the Kitten TTS 2 nano / pico / mini models. TinySynth gives each
// space-separated phoneme word an exact time range from the graph's durations; here they are
// shared out over the words of the input text: one each where counts agree, more for words
// the text processing expands (numbers, dates, abbreviations), estimated with the same
// English normaliser.

import type { KittenWordTiming } from '../KittenWordTiming';
import { normalize } from './frontend/english/TtsNorm';
import type { PhonemeWordTime } from './TinySynth';

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
  let counts = words.map(w => estimate(w, language));
  const total = counts.reduce((a, b) => a + b, 0);
  if (total !== groups.length) {
    // Scale the estimates to the real number of groups, keeping every spoken word at least one.
    const spoken = counts.filter(c => c > 0).length;
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
