import * as RNFS from 'react-native-fs';
import { loadNPZData } from './NPZParser';
import type { VoiceEmbeddings } from './NPZParser';
import { KittenTTSError, errorMessage, isKittenTTSError } from '../KittenTTSError';

export type { VoiceEmbedding, VoiceEmbeddings } from './NPZParser';
export { loadNPZData } from './NPZParser';

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
    return loadNPZData(base64ToUint8Array(base64), filePath);
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
