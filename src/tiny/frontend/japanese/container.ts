// The data files of the Japanese G2P (written by tools/kitten-tts-2-tiny/japanese_data.py) are
// one container each, little-endian:
//
//   0   "KTJA"
//   4   u32 format version (1)
//   8   u32 flags (bit 0: the difference-coded sections were already summed up in place)
//   12  u32 number of sections n
//   16  n x { name: 20 bytes ASCII, NUL padded; u32 dtype; u32 byte offset; u32 element count }
//       then the sections, each 8-byte aligned.
//
// Sections are typed-array views on the bytes the caller hands in (no copy, unless the
// bytes are not aligned for the element size).

const FORMAT_VERSION = 1;

type Section = Uint8Array | Uint16Array | Int16Array | Uint32Array;

type ArrayKind = 'u8' | 'u16' | 'i16' | 'u32';
const KINDS: Record<number, ArrayKind> = { 1: 'u8', 2: 'u16', 3: 'i16', 4: 'u32' };
const SIZE: Record<ArrayKind, number> = { u8: 1, u16: 2, i16: 2, u32: 4 };

function littleEndian(): boolean {
  return new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
}

function view(kind: ArrayKind, buffer: ArrayBufferLike, offset: number, count: number): Section {
  switch (kind) {
    case 'u8': return new Uint8Array(buffer, offset, count);
    case 'u16': return new Uint16Array(buffer, offset, count);
    case 'i16': return new Int16Array(buffer, offset, count);
    case 'u32': return new Uint32Array(buffer, offset, count);
  }
}

export class Container {
  private readonly sections = new Map<string, { kind: ArrayKind; offset: number; count: number }>();

  constructor(readonly bytes: Uint8Array, readonly name: string) {
    if (!littleEndian()) throw new Error('the Japanese G2P data needs a little-endian platform');
    if (bytes.length < 16 || bytes[0] !== 0x4b || bytes[1] !== 0x54 || bytes[2] !== 0x4a || bytes[3] !== 0x41) {
      throw new Error(`${name}: not a Japanese G2P data file`);
    }
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = dv.getUint32(4, true);
    if (version !== FORMAT_VERSION) {
      throw new Error(`${name}: data format ${version}, this SDK reads ${FORMAT_VERSION}`);
    }
    const n = dv.getUint32(12, true);
    for (let i = 0; i < n; i++) {
      const at = 16 + 32 * i;
      let key = '';
      for (let j = 0; j < 20 && bytes[at + j] !== 0; j++) key += String.fromCharCode(bytes[at + j]);
      const kind = KINDS[dv.getUint32(at + 20, true)];
      const offset = dv.getUint32(at + 24, true);
      const count = dv.getUint32(at + 28, true);
      if (!kind || offset + count * SIZE[kind] > bytes.length) throw new Error(`${name}: bad section ${key}`);
      this.sections.set(key, { kind, offset, count });
    }
  }

  get flags(): number {
    return new DataView(this.bytes.buffer, this.bytes.byteOffset, 16).getUint32(8, true);
  }

  set flags(value: number) {
    new DataView(this.bytes.buffer, this.bytes.byteOffset, 16).setUint32(8, value >>> 0, true);
  }

  private get(key: string, kind: ArrayKind): Section {
    const s = this.sections.get(key);
    if (!s) throw new Error(`${this.name}: no section ${key}`);
    if (s.kind !== kind) throw new Error(`${this.name}: section ${key} is ${s.kind}, expected ${kind}`);
    const at = this.bytes.byteOffset + s.offset;
    if (at % SIZE[kind] === 0) return view(kind, this.bytes.buffer, at, s.count);
    // Not aligned for the element size: copy into a fresh buffer.
    const copy = view(kind, new ArrayBuffer(s.count * SIZE[kind]), 0, s.count);
    new Uint8Array(copy.buffer).set(this.bytes.subarray(s.offset, s.offset + s.count * SIZE[kind]));
    return copy;
  }

  u8(key: string): Uint8Array { return this.get(key, 'u8') as Uint8Array; }
  u16(key: string): Uint16Array { return this.get(key, 'u16') as Uint16Array; }
  i16(key: string): Int16Array { return this.get(key, 'i16') as Int16Array; }
  u32(key: string): Uint32Array { return this.get(key, 'u32') as Uint32Array; }

  /** Whether a section's view shares the caller's bytes (false when it had to be copied). */
  isView(key: string): boolean {
    const s = this.sections.get(key);
    return !!s && (this.bytes.byteOffset + s.offset) % SIZE[s.kind] === 0;
  }
}
