import type { KittenWordTiming } from '../KittenWordTiming';
import { encode } from './TextCleaner';
import { preprocess } from './TextPreprocessor';

interface PhonemeGroupTiming {
  startTime: number;
  endTime: number;
  cursorEndTime: number;
}

/**
 * Computes word-level timestamps from KittenTTS phonemes and ONNX durations.
 *
 * Duration entries are per model token and include the start/end/pad wrapper
 * tokens. Phonemizers may emit multiple whitespace-delimited phoneme groups for
 * one visible word, such as "word-level" or "KittenTTS", so this first computes
 * timings for phoneme groups and then merges them back to input words.
 */
export function joinTimestamps(
  inputText: string,
  phonemes: string,
  durations: readonly number[],
): KittenWordTiming[] {
  const phonemeGroups = phonemes.split(' ').filter(Boolean);
  if (phonemeGroups.length === 0 || durations.length < 3) return [];

  const words = inputText.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];

  const groupTimings = computePhonemeGroupTimings(phonemeGroups, durations);
  if (groupTimings.length === 0) return [];

  const groupCounts = allocateGroupsToWords(words, groupTimings.length);
  const timings: KittenWordTiming[] = [];

  let groupIndex = 0;
  for (
    let wordIndex = 0;
    wordIndex < words.length && groupIndex < groupTimings.length;
    wordIndex += 1
  ) {
    const remainingWords = words.length - wordIndex - 1;
    const remainingGroups = groupTimings.length - groupIndex;
    const groupsForWord = Math.max(
      1,
      Math.min(groupCounts[wordIndex] ?? 1, remainingGroups - remainingWords),
    );

    const startGroup = groupTimings[groupIndex];
    const endGroup = groupTimings[groupIndex + groupsForWord - 1];
    timings.push({
      wordIndex,
      word: words[wordIndex],
      startTime: startGroup.startTime,
      endTime: groupsForWord > 1 ? endGroup.cursorEndTime : endGroup.endTime,
    });
    groupIndex += groupsForWord;
  }

  return timings;
}

function computePhonemeGroupTimings(
  phonemeGroups: readonly string[],
  durations: readonly number[],
): PhonemeGroupTiming[] {
  const magicDivisor = 80;
  const timings: PhonemeGroupTiming[] = [];
  let left = 2 * Math.max(0, durations[0] - 3);
  let right = left;
  let durationIndex = 1;

  for (let groupIndex = 0; groupIndex < phonemeGroups.length; groupIndex += 1) {
    const group = phonemeGroups[groupIndex];
    const phonemeCount = encodedTokenCount(group);
    if (durationIndex + phonemeCount > durations.length) break;

    const startTime = left / magicDivisor;
    let tokenDuration = 0;
    for (let i = durationIndex; i < durationIndex + phonemeCount; i += 1) {
      tokenDuration += durations[i];
    }

    const hasSpace = groupIndex < phonemeGroups.length - 1;
    const spaceDuration =
      hasSpace && durationIndex + phonemeCount < durations.length
        ? durations[durationIndex + phonemeCount]
        : 0;

    left = right + 2 * tokenDuration + spaceDuration;
    const endTime = left / magicDivisor;
    right = left + spaceDuration;

    timings.push({
      startTime,
      endTime,
      cursorEndTime: right / magicDivisor,
    });

    durationIndex += phonemeCount + (hasSpace ? 1 : 0);
  }

  return timings;
}

function encodedTokenCount(phonemeGroup: string): number {
  return Math.max(0, encode(phonemeGroup).length - 3);
}

function allocateGroupsToWords(words: readonly string[], groupCount: number): number[] {
  const counts = words.map(() => 1);
  let extraGroups = Math.max(0, groupCount - words.length);
  if (extraGroups === 0 || words.length === 0) return counts;

  const estimates = words.map(estimateGroupCountForWord);

  for (let index = 0; index < counts.length && extraGroups > 0; index += 1) {
    const available = estimates[index] - counts[index];
    if (available <= 0) continue;
    const add = Math.min(available, extraGroups);
    counts[index] += add;
    extraGroups -= add;
  }

  if (extraGroups > 0) {
    counts[counts.length - 1] += extraGroups;
  }

  return counts;
}

function estimateGroupCountForWord(word: string): number {
  const core = word
    .replace(/^[^\p{L}\p{N}$€£¥]+/u, '')
    .replace(/[^\p{L}\p{N}%]+$/u, '');
  if (!core) return 1;

  if (/^[A-Z]{2,}$/.test(core)) {
    return core.length;
  }

  const inlineAcronym = core.match(/^[A-Z]?[a-z]+([A-Z]{2,})$/);
  if (inlineAcronym) {
    return 1 + inlineAcronym[1].length;
  }

  const visibleParts = core.split(/[-‐‑‒–—/]+/u).filter(Boolean);
  if (visibleParts.length > 1) {
    return visibleParts.reduce(
      (sum, part) => sum + estimateGroupCountForWord(part),
      0,
    );
  }

  return Math.max(1, preprocess(core).split(/\s+/).filter(Boolean).length);
}
