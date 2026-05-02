const CHUNK_SIZE = 8192;

export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const end = Math.min(i + CHUNK_SIZE, bytes.length);
    parts.push(String.fromCharCode(...bytes.subarray(i, end)));
  }
  return btoa(parts.join(''));
}
