// UTF-8 bytes -> string for the files the Kitten TTS 2 nano / pico / mini code reads.

/** Decode UTF-8 bytes (no TextDecoder: Hermes builds may lack it). */
export function utf8Decode(bytes: Uint8Array): string {
  let out = '';
  const parts: string[] = [];
  for (let i = 0; i < bytes.length;) {
    const b = bytes[i];
    let cp: number;
    if (b < 0x80) {
      cp = b;
      i += 1;
    } else if (b >= 0xc0 && b < 0xe0 && i + 1 < bytes.length) {
      cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f);
      i += 2;
    } else if (b >= 0xe0 && b < 0xf0 && i + 2 < bytes.length) {
      cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f);
      i += 3;
    } else if (b >= 0xf0 && i + 3 < bytes.length) {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      i += 4;
    } else {
      cp = 0xfffd;
      i += 1;
    }
    out += String.fromCodePoint(cp);
    if (out.length > 8192) {
      parts.push(out);
      out = '';
    }
  }
  parts.push(out);
  return parts.join('');
}
