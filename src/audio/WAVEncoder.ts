/**
 * Encodes raw Float32 PCM samples into a standard 16-bit mono RIFF WAV file.
 */
export class WAVEncoder {
  /**
   * Encode Float32 PCM samples at the given sample rate into a complete RIFF WAV file.
   *
   * Samples are clamped to -1.0...+1.0 and converted to 16-bit signed PCM.
   *
   * @param samples - Float32 PCM samples (mono, normalised to roughly +/-1.0).
   * @param sampleRate - Sample rate in Hz (e.g. 24000).
   * @returns A Uint8Array containing the complete RIFF WAV file.
   */
  static encode(samples: Float32Array, sampleRate: number): Uint8Array {
    const numChannels = 1;
    const bitsPerSample = 16;
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const dataBytes = samples.length * blockAlign;
    const totalSize = 44 + dataBytes;

    const buffer = new ArrayBuffer(totalSize);
    const view = new DataView(buffer);
    let offset = 0;

    // RIFF header
    writeString(view, offset, 'RIFF'); offset += 4;
    view.setUint32(offset, 36 + dataBytes, true); offset += 4;
    writeString(view, offset, 'WAVE'); offset += 4;

    // fmt sub-chunk
    writeString(view, offset, 'fmt '); offset += 4;
    view.setUint32(offset, 16, true); offset += 4;          // fmt chunk size
    view.setUint16(offset, 1, true); offset += 2;            // PCM = 1
    view.setUint16(offset, numChannels, true); offset += 2;
    view.setUint32(offset, sampleRate, true); offset += 4;
    view.setUint32(offset, byteRate, true); offset += 4;
    view.setUint16(offset, blockAlign, true); offset += 2;
    view.setUint16(offset, bitsPerSample, true); offset += 2;

    // data sub-chunk
    writeString(view, offset, 'data'); offset += 4;
    view.setUint32(offset, dataBytes, true); offset += 4;

    // Write samples as 16-bit PCM
    for (let i = 0; i < samples.length; i++) {
      const clamped = Math.max(-1.0, Math.min(1.0, samples[i]));
      view.setInt16(offset, Math.round(clamped * 32767), true);
      offset += 2;
    }

    return new Uint8Array(buffer);
  }
}

function writeString(view: DataView, offset: number, str: string): void {
  for (let i = 0; i < str.length; i++) {
    view.setUint8(offset + i, str.charCodeAt(i));
  }
}
