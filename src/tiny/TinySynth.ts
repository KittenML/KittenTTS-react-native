// Phoneme chunk -> audio for the Kitten TTS 2 nano / pico / mini ONNX graphs, following
// KittenTTS2Tiny._chunk in the Python package: tokens [0] + phonemes + [10] + [0], the
// voice pack row of the token count, then the end token's frames cut (and the start
// pause, except for the first chunk), 5 ms fades and clipping. The durations also give
// each phoneme word's time range, for word timings.

import type { OrtLike, OrtSessionLike } from './ort';
import type { VoiceEmbedding } from '../loader/NPZParser';
import { memo } from './assets';

const END_TOKEN = 10;
export const GAP_SECONDS = 0.15;

/** Python's round(): halves go to the even neighbour. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

/** KittenTTS2Tiny._tokens for one character: its id, or none (brackets read as commas). */
function tokenOf(ch: string, vocab: Record<string, number>): number | undefined {
  if (Object.prototype.hasOwnProperty.call(vocab, ch)) return vocab[ch];
  return ch === '(' || ch === ')' ? vocab[','] : undefined;
}

/** KittenTTS2Tiny._tokens */
export function tokenize(phonemes: string, vocab: Record<string, number>): number[] {
  const ids: number[] = [];
  for (const ch of phonemes) {
    const id = tokenOf(ch, vocab);
    if (id !== undefined) ids.push(id);
  }
  return [0, ...ids, END_TOKEN, 0];
}

export interface PhonemeWordTime {
  phonemes: string;
  /** Seconds from the start of the chunk's (trimmed) audio. */
  start: number;
  end: number;
}

/**
 * Time ranges of the space-separated phoneme words of one chunk: every token has its frames
 * in `durations` ([0] + phonemes + [10] + [0]); `lead` samples were trimmed from the start.
 */
function wordTimes(
  phonemes: string,
  vocab: Record<string, number>,
  durations: readonly number[],
  trim: { lead: number; spf: number; length: number },
  sampleRate: number,
): PhonemeWordTime[] {
  const out: PhonemeWordTime[] = [];
  const seconds = (frames: number) => Math.min(trim.length, Math.max(0, frames * trim.spf - trim.lead)) / sampleRate;
  let frame = durations[0] ?? 0;          // the start token
  let token = 1;
  let word = '';
  let start = 0;
  let end = 0;
  for (const ch of phonemes) {
    const d = tokenOf(ch, vocab) !== undefined ? durations[token++] ?? 0 : 0;
    if (ch === ' ') {
      if (word) out.push({ phonemes: word, start: seconds(start), end: seconds(end) });
      word = '';
    } else {
      if (!word) start = frame;
      word += ch;
      end = frame + d;
    }
    frame += d;
  }
  if (word) out.push({ phonemes: word, start: seconds(start), end: seconds(end) });
  return out;
}

/** np.linspace(start, stop, n) cast to float32. */
function linspace(start: number, stop: number, n: number): Float32Array {
  const out = new Float32Array(n);
  if (n === 1) {
    out[0] = start;
    return out;
  }
  const step = (stop - start) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = i * step + start;
  out[n - 1] = stop;
  return out;
}

/**
 * The trimming and fades of _chunk, on the graph's raw waveform and durations. Also returns
 * where the kept audio starts (`lead`, in samples) and samples per frame (`spf`).
 */
function trimChunk(
  wav: Float32Array,
  dur: readonly number[],
  keepStart: boolean,
): { samples: Float32Array; lead: number; spf: number } {
  let w = new Float32Array(wav.length);
  for (let i = 0; i < wav.length; i++) w[i] = Math.min(1, Math.max(-1, wav[i]));
  const total = dur.reduce((a, b) => a + b, 0);
  const spf = Math.max(1, roundHalfEven(w.length / Math.max(total, 1)));   // samples per duration frame
  let lead = keepStart ? 0 : Math.max(0, dur[0] - 1) * spf;
  const trail = Math.max(0, dur[dur.length - 1] - 1) * spf;
  if (lead + trail + spf < w.length) w = w.slice(lead, trail ? w.length - trail : w.length);
  else lead = 0;
  const f = Math.min(120, Math.floor(w.length / 8));                         // ~5 ms fades
  if (f) {
    const up = linspace(0, 1, f);
    const down = linspace(1, 0, f);
    for (let i = 0; i < f; i++) w[i] *= up[i];
    for (let i = 0; i < f; i++) w[w.length - f + i] *= down[i];
  }
  return { samples: w, lead, spf };
}

export class TinySynth {
  private readonly sessions = new Map<string, Promise<OrtSessionLike>>();
  private closed = false;

  constructor(
    private readonly ort: OrtLike,
    private readonly vocab: Record<string, number>,
    private readonly sampleRate: number,
    private readonly openSession: (file: string) => Promise<OrtSessionLike>,
  ) {}

  private session(file: string): Promise<OrtSessionLike> {
    if (this.closed) return Promise.reject(new Error('TinySynth: disposed'));
    return memo(this.sessions, file, () => this.openSession(file));
  }

  /** Load a graph ahead of the first chunk. */
  async prepare(file: string): Promise<void> {
    await this.session(file);
  }

  /** One phoneme chunk -> float32 audio at 24 kHz and the time range of each phoneme word. */
  async chunk(file: string, pack: VoiceEmbedding, phonemes: string, speed: number, keepStart: boolean):
    Promise<{ samples: Float32Array; words: PhonemeWordTime[] }> {
    const { waveform, durations } = await this.run(file, pack, phonemes, speed);
    const { samples, lead, spf } = trimChunk(waveform, durations, keepStart);
    const words = wordTimes(phonemes, this.vocab, durations, { lead, spf, length: samples.length }, this.sampleRate);
    return { samples, words };
  }

  /** The graph's raw outputs for one chunk: waveform and frames per token. */
  async run(file: string, pack: VoiceEmbedding, phonemes: string, speed: number): Promise<{ waveform: Float32Array; durations: number[] }> {
    const tok = tokenize(phonemes, this.vocab);
    const row = Math.min(tok.length - 1, pack.rows - 1);
    // Fresh arrays: onnxruntime-react-native's JSI binding ignores a typed array's byteOffset.
    const style = new Float32Array(pack.data.subarray(row * pack.cols, (row + 1) * pack.cols));
    const session = await this.session(file);
    const out = await session.run({
      input_ids: new this.ort.Tensor('int64', BigInt64Array.from(tok, BigInt), [1, tok.length]),
      style: new this.ort.Tensor('float32', style, [1, pack.cols]),
      speed: new this.ort.Tensor('float32', Float32Array.from([speed]), [1]),
    });
    const [wavName, durName] = session.outputNames;
    return {
      waveform: out[wavName].data as Float32Array,
      durations: Array.from(out[durName].data as ArrayLike<number | bigint>, Number),
    };
  }

  async dispose(): Promise<void> {
    this.closed = true;
    const all = Array.from(this.sessions.values());
    this.sessions.clear();
    await Promise.all(all.map(p => p.then(s => s.release?.()).catch(() => {})));
  }
}
