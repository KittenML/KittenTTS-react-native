// The two hashes spaCy's tagger is built on, in BigInt (Hermes supports it):
// spaCy's string hash, MurmurHash64A of the UTF-8 bytes with seed 1 (strings.pyx
// hash_string), and thinc's MurmurHash3_x86_128_uint64, which HashEmbed uses to pick
// embedding rows for a 64-bit id (backends/numpy_ops.pyx).

const MASK64 = (1n << 64n) - 1n;
const M64A = 0xc6a4a7935bd1e995n;

/** UTF-8 bytes of a string (no TextEncoder: Hermes builds may lack it). */
function utf8(text: string): Uint8Array {
  const out: number[] = [];
  for (const ch of text) {
    let c = ch.codePointAt(0) as number;
    if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;    // lone surrogate
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return Uint8Array.from(out);
}

/** spaCy's hash of a string: MurmurHash64A(utf8, len, seed 1). */
export function hashString(text: string): bigint {
  const data = utf8(text);
  const len = data.length;
  let h = (1n ^ ((BigInt(len) * M64A) & MASK64)) & MASK64;
  const blocks = len >> 3;
  for (let i = 0; i < blocks; i++) {
    let k = 0n;
    for (let b = 7; b >= 0; b--) k = (k << 8n) | BigInt(data[i * 8 + b]);
    k = (k * M64A) & MASK64;
    k ^= k >> 47n;
    k = (k * M64A) & MASK64;
    h ^= k;
    h = (h * M64A) & MASK64;
  }
  const tail = len & 7;
  if (tail) {
    for (let b = tail - 1; b >= 0; b--) h ^= BigInt(data[blocks * 8 + b]) << BigInt(8 * b);
    h = (h * M64A) & MASK64;
  }
  h ^= h >> 47n;
  h = (h * M64A) & MASK64;
  h ^= h >> 47n;
  return h;
}

function fmix(k: bigint): bigint {
  k ^= k >> 33n;
  k = (k * 0xff51afd7ed558ccdn) & MASK64;
  k ^= k >> 33n;
  k = (k * 0xc4ceb9fe1a85ec53n) & MASK64;
  k ^= k >> 33n;
  return k;
}

/** thinc's MurmurHash3_x86_128_uint64(val, seed): four 32-bit keys. */
export function hashUint64(value: bigint, seed: number): [number, number, number, number] {
  let h1 = value & MASK64;
  h1 = (h1 * 0x87c37b91114253d5n) & MASK64;
  h1 = ((h1 << 31n) | (h1 >> 33n)) & MASK64;
  h1 = (h1 * 0x4cf5ad432745937fn) & MASK64;
  const s = BigInt(seed >>> 0);
  h1 ^= s;
  h1 ^= 8n;
  let h2 = s ^ 8n;
  h1 = (h1 + h2) & MASK64;
  h2 = (h2 + h1) & MASK64;
  h1 = fmix(h1);
  h2 = fmix(h2);
  h1 = (h1 + h2) & MASK64;
  h2 = (h2 + h1) & MASK64;
  return [
    Number(h1 & 0xffffffffn),
    Number(h1 >> 32n),
    Number(h2 & 0xffffffffn),
    Number(h2 >> 32n),
  ];
}
