/**
 * Decodes headerless 16-bit little-endian PCM into Float32 samples.
 *
 * Network chunks can split a sample across two reads, so an odd trailing byte
 * is held back and joined to the next chunk.
 */
export class PCM16Decoder {
  private carry: number | null = null;

  push(bytes: Uint8Array): Float32Array {
    const total = bytes.length + (this.carry === null ? 0 : 1);
    const samples = new Float32Array(total >> 1);
    let byteIndex = 0;
    let sampleIndex = 0;

    if (this.carry !== null && bytes.length > 0) {
      samples[sampleIndex++] = toFloat(this.carry, bytes[0]);
      byteIndex = 1;
      this.carry = null;
    }
    for (; byteIndex + 1 < bytes.length; byteIndex += 2) {
      samples[sampleIndex++] = toFloat(bytes[byteIndex], bytes[byteIndex + 1]);
    }
    if (byteIndex < bytes.length) this.carry = bytes[byteIndex];
    return samples;
  }
}

function toFloat(low: number, high: number): number {
  return (((high << 8) | low) << 16 >> 16) / 32768;
}

/** Decode a complete PCM16 body. */
export function decodePCM16(bytes: Uint8Array): Float32Array {
  return new PCM16Decoder().push(bytes);
}

export interface QuietSplitterOptions {
  /** Shortest chunk worth playing on its own, in seconds. */
  minChunkSeconds?: number;
  /** How long the audio must stay quiet to count as a pause, in seconds. */
  quietSeconds?: number;
  /** Peak amplitude below which a 10 ms frame counts as quiet. */
  threshold?: number;
}

/**
 * Cuts a stream of samples at pauses, so each chunk ends between phrases
 * instead of mid-word. A chunk is cut in the middle of the first pause found
 * once it is at least `minChunkSeconds` long.
 */
export class QuietSplitter {
  private buffer: Float32Array;
  private length = 0;
  private scanned = 0;
  private quietFrames = 0;
  private readonly frame: number;
  private readonly minSamples: number;
  private readonly framesNeeded: number;
  private readonly threshold: number;

  constructor(sampleRate: number, options: QuietSplitterOptions = {}) {
    this.frame = Math.round(sampleRate / 100);
    this.minSamples = Math.round(sampleRate * (options.minChunkSeconds ?? 1));
    this.framesNeeded = Math.max(1, Math.round((options.quietSeconds ?? 0.15) * 100));
    this.threshold = options.threshold ?? 0.02;
    this.buffer = new Float32Array(sampleRate * 4);
  }

  /** Add samples; returns the chunks that are now complete. */
  push(samples: Float32Array): Float32Array[] {
    this.append(samples);
    const chunks: Float32Array[] = [];

    while (this.scanned + this.frame <= this.length) {
      let peak = 0;
      for (let index = this.scanned; index < this.scanned + this.frame; index += 1) {
        const value = Math.abs(this.buffer[index]);
        if (value > peak) peak = value;
      }
      this.scanned += this.frame;
      this.quietFrames = peak < this.threshold ? this.quietFrames + 1 : 0;

      if (this.quietFrames < this.framesNeeded) continue;
      const pauseStart = this.scanned - this.quietFrames * this.frame;
      const cut = pauseStart + Math.floor((this.framesNeeded * this.frame) / 2);
      if (pauseStart < this.minSamples) continue;

      chunks.push(this.buffer.slice(0, cut));
      this.buffer.copyWithin(0, cut, this.length);
      this.length -= cut;
      this.scanned -= cut;
      this.quietFrames = 0;
    }
    return chunks;
  }

  /** The samples left over once the stream has ended, if any. */
  flush(): Float32Array | null {
    if (this.length === 0) return null;
    const rest = this.buffer.slice(0, this.length);
    this.length = 0;
    this.scanned = 0;
    this.quietFrames = 0;
    return rest;
  }

  private append(samples: Float32Array): void {
    if (this.length + samples.length > this.buffer.length) {
      const grown = new Float32Array(Math.max(this.buffer.length * 2, this.length + samples.length));
      grown.set(this.buffer.subarray(0, this.length));
      this.buffer = grown;
    }
    this.buffer.set(samples, this.length);
    this.length += samples.length;
  }
}
