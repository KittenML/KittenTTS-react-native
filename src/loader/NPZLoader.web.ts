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
    const data = await readFileBytes(filePath);
    return loadNPZData(data, filePath);
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

async function readFileBytes(filePath: string): Promise<Uint8Array> {
  if (typeof process === 'undefined' || !process.versions?.node) {
    throw KittenTTSError.voicesFileNotFound(filePath);
  }
  const fs = await import('node:fs/promises');
  const data = await fs.readFile(stripFileScheme(filePath));
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

function stripFileScheme(filePath: string): string {
  return filePath.startsWith('file://') ? filePath.slice('file://'.length) : filePath;
}
