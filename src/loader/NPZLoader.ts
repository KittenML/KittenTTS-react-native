import * as RNFS from 'react-native-fs';
import pako from 'pako';
import { KittenTTSError, errorMessage, isKittenTTSError } from '../KittenTTSError';

/**
 * A voice embedding loaded from a `.npz` file.
 *
 * The rows dimension is indexed by `min(text_length, rows - 1)` following
 * the KittenTTS Python implementation.
 */
export interface VoiceEmbedding {
  rows: number;
  cols: number;
  data: Float32Array;
}

/** Map of voice name to embedding data. */
export type VoiceEmbeddings = Record<string, VoiceEmbedding>;

/**
 * Load all float arrays from a `.npz` file on disk.
 *
 * Supports ZIP stored (method 0) and DEFLATE-compressed (method 8) entries,
 * float32 and float16 NPY arrays, little-endian.
 *
 * @param filePath - Absolute path to the `.npz` file on device.
 * @returns Dictionary mapping array names to VoiceEmbedding values.
 */
export async function loadNPZ(filePath: string): Promise<VoiceEmbeddings> {
  try {
    const exists = await RNFS.exists(filePath);
    if (!exists) {
      throw KittenTTSError.voicesFileNotFound(filePath);
    }

    const base64 = await RNFS.readFile(filePath, 'base64');
    const data = base64ToUint8Array(base64);
    const embeddings = parseZIP(data);
    if (Object.keys(embeddings).length === 0) {
      throw KittenTTSError.invalidModelData(
        `No voice embeddings were found in ${filePath}`,
      );
    }
    return embeddings;
  } catch (error) {
    if (isKittenTTSError(error)) {
      throw error;
    }
    throw KittenTTSError.invalidModelData(
      `Could not load voice embeddings from ${filePath}: ${errorMessage(error)}`,
      error,
    );
  }
}

// ---------------------------------------------------------------------------
// ZIP parsing
// ---------------------------------------------------------------------------

function parseZIP(data: Uint8Array): VoiceEmbeddings {
  const result: VoiceEmbeddings = {};
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let offset = 0;

  while (offset + 30 <= data.length) {
    // Check local file header signature
    if (view.getUint32(offset, true) !== 0x04034b50) break;

    const method = view.getUint16(offset + 8, true);
    let compressedSize = view.getUint32(offset + 18, true);
    let uncompressedSize = view.getUint32(offset + 22, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);

    const nameStart = offset + 30;
    const extraStart = nameStart + nameLen;
    const dataStart = extraStart + extraLen;

    // ZIP64: sizes are 0xFFFFFFFF -> read from ZIP64 extra field (tag 0x0001)
    if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF) {
      let exOff = extraStart;
      while (exOff + 4 <= extraStart + extraLen) {
        const tag = view.getUint16(exOff, true);
        const size = view.getUint16(exOff + 2, true);
        if (tag === 0x0001 && exOff + 4 + size >= exOff + 20) {
          const uncompressedHigh = view.getUint32(exOff + 8, true);
          const compressedHigh = view.getUint32(exOff + 16, true);
          if (uncompressedHigh !== 0 || compressedHigh !== 0) {
            throw KittenTTSError.invalidModelData(
              'ZIP64 voice embedding entries larger than 4 GB are not supported.',
            );
          }
          uncompressedSize = view.getUint32(exOff + 4, true);
          compressedSize = view.getUint32(exOff + 12, true);
          break;
        }
        exOff += 4 + size;
      }
    }

    const dataEnd = dataStart + compressedSize;
    if (dataEnd > data.length) break;

    const entryName = TEXT_DECODER.decode(data.slice(nameStart, nameStart + nameLen));

    if (entryName.endsWith('.npy')) {
      const compressed = data.slice(dataStart, dataEnd);
      let fileData: Uint8Array;
      if (method === 0) {
        fileData = compressed;
      } else if (method === 8) {
        fileData = pako.inflateRaw(compressed);
      } else {
        offset = dataEnd;
        continue;
      }

      const arrayName = entryName.slice(0, -4);
      const embedding = parseNPY(fileData);
      if (embedding) {
        result[arrayName] = embedding;
      }
    }

    offset = dataEnd;
  }

  return result;
}

// ---------------------------------------------------------------------------
// NPY parsing
// ---------------------------------------------------------------------------

function parseNPY(data: Uint8Array): VoiceEmbedding | null {
  if (data.length < 10) return null;

  // Magic bytes: 0x93 NUMPY
  if (
    data[0] !== 0x93 ||
    data[1] !== 0x4e ||
    data[2] !== 0x55 ||
    data[3] !== 0x4d ||
    data[4] !== 0x50 ||
    data[5] !== 0x59
  ) {
    return null;
  }

  const major = data[6];
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  let headerLen: number;
  let headerBase: number;
  if (major >= 2) {
    if (data.length < 12) return null;
    headerLen = view.getUint32(8, true);
    headerBase = 12;
  } else {
    headerLen = view.getUint16(8, true);
    headerBase = 10;
  }

  const dataStartOffset = headerBase + headerLen;
  if (dataStartOffset > data.length) return null;

  const header = TEXT_DECODER.decode(data.slice(headerBase, headerBase + headerLen));
  const shape = parseShape(header);
  if (!shape || shape.length < 1) return null;

  const rawData = data.slice(dataStartOffset);

  if (header.includes("'f4'") || header.includes('<f4') || header.includes('>f4')) {
    return makeFloat32Embedding(rawData, shape, header.includes('>f4'));
  }
  if (header.includes("'f2'") || header.includes('<f2') || header.includes('>f2')) {
    return makeFloat16Embedding(rawData, shape, header.includes('>f2'));
  }

  return null;
}

function parseShape(header: string): number[] | null {
  const openIdx = header.indexOf('(');
  const closeIdx = header.indexOf(')', openIdx);
  if (openIdx === -1 || closeIdx === -1) return null;

  const inside = header.substring(openIdx + 1, closeIdx).trim();
  if (!inside) return [1];

  const parts = inside
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map(Number);

  if (parts.some(isNaN)) return null;
  return parts;
}

function makeFloat32Embedding(
  rawData: Uint8Array,
  shape: number[],
  bigEndian: boolean,
): VoiceEmbedding {
  const count = Math.floor(rawData.length / 4);
  const floats = new Float32Array(count);
  const view = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);

  for (let i = 0; i < count; i++) {
    floats[i] = view.getFloat32(i * 4, !bigEndian);
  }

  const rows = shape.length >= 2 ? shape[0] : 1;
  const cols = shape.length >= 2 ? shape[1] : shape[0];
  return { rows, cols, data: floats };
}

function makeFloat16Embedding(
  rawData: Uint8Array,
  shape: number[],
  bigEndian: boolean,
): VoiceEmbedding {
  const count = Math.floor(rawData.length / 2);
  const floats = new Float32Array(count);
  const view = new DataView(rawData.buffer, rawData.byteOffset, rawData.byteLength);

  for (let i = 0; i < count; i++) {
    const bits = view.getUint16(i * 2, !bigEndian);
    floats[i] = float16ToFloat(bits);
  }

  const rows = shape.length >= 2 ? shape[0] : 1;
  const cols = shape.length >= 2 ? shape[1] : shape[0];
  return { rows, cols, data: floats };
}

// ---------------------------------------------------------------------------
// Float16 conversion
// ---------------------------------------------------------------------------

const FLOAT32_BUFFER = new ArrayBuffer(4);
const FLOAT32_VIEW = new DataView(FLOAT32_BUFFER);

function float16ToFloat(bits: number): number {
  const sign = (bits >>> 15) << 31;
  const exp16 = (bits >>> 10) & 0x1f;
  const mant16 = bits & 0x3ff;

  if (exp16 === 0) {
    if (mant16 === 0) {
      // Signed zero
      return bitsToFloat32(sign >>> 0);
    }
    // Subnormal
    let m = mant16;
    let e = -14;
    while ((m & 0x400) === 0) {
      m <<= 1;
      e -= 1;
    }
    m &= 0x3ff;
    const exp32 = ((e + 127) << 23) >>> 0;
    const bits32 = (sign | exp32 | (m << 13)) >>> 0;
    return bitsToFloat32(bits32);
  }
  if (exp16 === 31) {
    // Inf or NaN
    const bits32 = (sign | 0x7f800000 | (mant16 << 13)) >>> 0;
    return bitsToFloat32(bits32);
  }

  const exp32 = ((exp16 - 15 + 127) << 23) >>> 0;
  const bits32 = (sign | exp32 | (mant16 << 13)) >>> 0;
  return bitsToFloat32(bits32);
}

function bitsToFloat32(bits: number): number {
  FLOAT32_VIEW.setUint32(0, bits, false);
  return FLOAT32_VIEW.getFloat32(0, false);
}

// ---------------------------------------------------------------------------
// TextDecoder polyfill for Hermes
// ---------------------------------------------------------------------------

const TEXT_DECODER: { decode(input: Uint8Array): string } =
  typeof TextDecoder !== 'undefined'
    ? new TextDecoder()
    : {
    decode(input: Uint8Array): string {
      let result = '';
      for (let i = 0; i < input.length; i++) {
        result += String.fromCharCode(input[i]);
      }
      return result;
    },
  };

// ---------------------------------------------------------------------------
// Base64 decoding
// ---------------------------------------------------------------------------

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_LOOKUP = new Uint8Array(128);
for (let i = 0; i < BASE64_CHARS.length; i++) {
  BASE64_LOOKUP[BASE64_CHARS.charCodeAt(i)] = i;
}

function base64ToUint8Array(base64: string): Uint8Array {
  // Strip whitespace and padding
  const clean = base64.replace(/[\s=]/g, '');
  const len = clean.length;
  const byteLen = (len * 3) >>> 2;
  const bytes = new Uint8Array(byteLen);

  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const a = BASE64_LOOKUP[clean.charCodeAt(i)];
    const b = i + 1 < len ? BASE64_LOOKUP[clean.charCodeAt(i + 1)] : 0;
    const c = i + 2 < len ? BASE64_LOOKUP[clean.charCodeAt(i + 2)] : 0;
    const d = i + 3 < len ? BASE64_LOOKUP[clean.charCodeAt(i + 3)] : 0;

    bytes[p++] = (a << 2) | (b >>> 4);
    if (p < byteLen) bytes[p++] = ((b & 0xf) << 4) | (c >>> 2);
    if (p < byteLen) bytes[p++] = ((c & 0x3) << 6) | d;
  }

  return bytes;
}
