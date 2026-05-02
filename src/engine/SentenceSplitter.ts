/**
 * Split text into sentence-sized chunks for progressive generation.
 *
 * Short sentences are merged so each chunk has enough context for natural
 * speech, matching the Swift SDK streaming behavior.
 */
export function splitSentences(text: string): string[] {
  const sentences: string[] = [];
  let current = '';

  for (const char of text) {
    current += char;
    if ('.!?'.includes(char)) {
      const trimmed = current.trim();
      if (trimmed) sentences.push(trimmed);
      current = '';
    }
  }

  const remaining = current.trim();
  if (remaining) {
    if (sentences.length === 0) {
      sentences.push(remaining);
    } else {
      sentences[sentences.length - 1] += ` ${remaining}`;
    }
  }

  const merged: string[] = [];
  let buffer = '';
  for (const sentence of sentences) {
    buffer += `${buffer ? ' ' : ''}${sentence}`;
    if (buffer.length >= 200) {
      merged.push(buffer);
      buffer = '';
    }
  }

  if (buffer) {
    if (merged.length === 0) {
      merged.push(buffer);
    } else {
      merged[merged.length - 1] += ` ${buffer}`;
    }
  }

  return merged.length === 0 ? [text] : merged;
}
