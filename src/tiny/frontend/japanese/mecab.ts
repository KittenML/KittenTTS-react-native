// MeCab 0.996's one-best tokenizer (the libmecab inside fugashi 1.5.2) over the unidic-lite
// 1.0.8 dictionary, ported from mecab/src/tokenizer.cpp, viterbi.cpp, char_property.h and
// darts.h. Only what changes the segmentation, or what cutlet reads from a node, is kept:
//
//   lattice    the input as UTF-8 bytes; at every byte position where a node ends, lookup()
//              adds the dictionary entries whose surface starts there (after skipping SPACE
//              characters) and the unknown-word candidates of char.def / unk.dic
//   viterbi    each new node takes the cheapest left neighbour (path cost + connection cost +
//              word cost); ties go to the first one in MeCab's list order, which is reproduced
//              exactly (end lists are newest first, a position's nodes are visited newest first)
//   node       surface, reading (feature.pron or feature.kana, kata2hira'd when the data was
//              built), char_type (the first character's category) and whether it is unknown
//   limits     a lookup sees at most 65535 bytes, and a node's length and rlength (its length
//              plus the whitespace skipped before it) are 16-bit, as in MeCab: they only
//              matter for more than 64 KB of whitespace in a row
//
// The dictionary is a sorted array of UTF-8 surfaces instead of MeCab's double array: the
// prefix search returns the same surfaces in the same order (shortest first), and each
// surface's entries keep sys.dic's order.
//
// MeCab, like fugashi's C-string call, ends the input at the first NUL character.

import type { Container } from './container';
import { unitsToString } from './unicode';

export interface MecabNode {
  surface: string;
  /** jaconv.kata2hira(feature.pron or feature.kana); null when both are empty or for unknown words. */
  reading: string | null;
  /** MeCab's node char_type: the category (char.def order) of the node's first character. */
  charType: number;
  isUnk: boolean;
}

const TYPE_MASK = 0x3ffff;
const MAX_GROUPING_SIZE = 24;   // common.h DEFAULT_MAX_GROUPING_SIZE (dicrc leaves it unset)
const WINDOW = 65535;           // tokenizer.cpp: a lookup sees at most 65535 bytes
const NO_READING = 0xffffffff;

const defaultType = (info: number) => (info >>> 18) & 0xff;
const charLength = (info: number) => (info >>> 26) & 0xf;
const isGroup = (info: number) => (info >>> 30) & 1;
const isInvoke = (info: number) => info >>> 31;

class NodePool {
  count = 0;
  attr = new Uint16Array(0);
  col = new Uint16Array(0);
  wcost = new Int32Array(0);
  start = new Int32Array(0);
  len = new Int32Array(0);
  rlen = new Int32Array(0);
  prev = new Int32Array(0);
  enext = new Int32Array(0);
  tok = new Int32Array(0);     // sys.dic entry, or -1 for an unknown word
  ctype = new Uint8Array(0);
  cost = new Float64Array(0);

  reset(): void {
    this.count = 0;
  }

  add(): number {
    if (this.count === this.attr.length) this.grow(Math.max(1024, this.attr.length * 2));
    return this.count++;
  }

  private grow(n: number): void {
    const g = <T extends Uint16Array | Int32Array | Uint8Array | Float64Array>(a: T, b: T): T => {
      b.set(a);
      return b;
    };
    this.attr = g(this.attr, new Uint16Array(n));
    this.col = g(this.col, new Uint16Array(n));
    this.wcost = g(this.wcost, new Int32Array(n));
    this.start = g(this.start, new Int32Array(n));
    this.len = g(this.len, new Int32Array(n));
    this.rlen = g(this.rlen, new Int32Array(n));
    this.prev = g(this.prev, new Int32Array(n));
    this.enext = g(this.enext, new Int32Array(n));
    this.tok = g(this.tok, new Int32Array(n));
    this.ctype = g(this.ctype, new Uint8Array(n));
    this.cost = g(this.cost, new Float64Array(n));
  }
}

/**
 * Row i += row i-1, for every row in order, with int16 wrap-around. Two columns at a time in an
 * Int32Array when the rows are 4-byte aligned (the data pads the width to even): a lane-wise add
 * of two int16 lanes, 3-4x faster than one column at a time under Hermes.
 */
function sumRows(m: Int16Array, cols: number): void {
  if (cols % 2 === 0 && m.byteOffset % 4 === 0) {
    const w = new Int32Array(m.buffer, m.byteOffset, m.length >> 1);
    const h = cols >> 1;
    const n = w.length;   // (a property read per iteration costs Hermes 2x)
    for (let i = h; i < n; i++) {
      const a = w[i];
      const b = w[i - h];
      w[i] = ((a & 0x7fff7fff) + (b & 0x7fff7fff)) ^ ((a ^ b) & 0x80008000);
    }
    return;
  }
  const n = m.length;
  for (let o = cols; o < n; o += cols) {
    for (let c = 0; c < cols; c++) m[o + c] += m[o - cols + c];
  }
}

/** Python str.encode('utf-8') (strict); also maps each byte offset that starts a character to its UTF-16 offset. */
function encodeUtf8(s: string): { bytes: Uint8Array; unitAt: Int32Array } {
  const bytes = new Uint8Array(s.length * 3);
  const unitAt = new Int32Array(s.length * 3 + 1).fill(-1);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    unitAt[n] = i;
    let c = s.charCodeAt(i);
    if (c < 0x80) {
      bytes[n++] = c;
    } else if (c < 0x800) {
      bytes[n++] = 0xc0 | (c >> 6);
      bytes[n++] = 0x80 | (c & 0x3f);
    } else if (c >= 0xd800 && c <= 0xdfff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c > 0xdbff || d < 0xdc00 || d > 0xdfff) {
        throw new Error(`UnicodeEncodeError: 'utf-8' codec can't encode character '\\u${c.toString(16)}': surrogates not allowed`);
      }
      c = ((c - 0xd800) << 10) + (d - 0xdc00) + 0x10000;
      i++;
      bytes[n++] = 0xf0 | (c >> 18);
      bytes[n++] = 0x80 | ((c >> 12) & 0x3f);
      bytes[n++] = 0x80 | ((c >> 6) & 0x3f);
      bytes[n++] = 0x80 | (c & 0x3f);
    } else {
      bytes[n++] = 0xe0 | (c >> 12);
      bytes[n++] = 0x80 | ((c >> 6) & 0x3f);
      bytes[n++] = 0x80 | (c & 0x3f);
    }
  }
  unitAt[n] = s.length;
  return { bytes: bytes.subarray(0, n), unitAt };
}

export class Mecab {
  // unidic-lex.bin
  private readonly keyOff: Uint32Array;
  private readonly keyBytes: Uint8Array;
  private readonly tokStart: Uint32Array;
  private readonly tokAttr: Uint16Array;
  private readonly tokCost: Int16Array;
  private readonly tokRead: Uint32Array;
  private readonly readOff: Uint32Array;
  private readonly readChars: Uint16Array;
  private readonly unkStart: Uint32Array;
  private readonly unkAttr: Uint16Array;
  private readonly unkCost: Int16Array;
  private readonly charInfo = new Uint32Array(0x10000);
  private readonly space: number;
  private readonly firstLo = new Uint32Array(256);
  private readonly firstHi = new Uint32Array(256);
  // unidic-matrix.bin
  private readonly rowMap: Uint16Array;
  private readonly colMap: Uint16Array;
  private readonly cols: number;
  private readonly matrix: Int16Array;

  // per call
  private pool = new NodePool();
  private bytes: Uint8Array = new Uint8Array(0);
  private n = 0;
  private mblen = 0;

  constructor(lex: Container, mat: Container) {
    const meta = lex.u32('meta');
    this.keyOff = lex.u32('keyOff');
    this.keyBytes = lex.u8('keyBytes');
    this.tokStart = lex.u32('tokStart');
    this.readOff = lex.u32('readOff');
    // The offset arrays are stored as differences: sum them up once, in place in the caller's
    // bytes, and set flag bit 0 so the same bytes can be loaded again. Sections that had to be
    // copied (unaligned bytes) are summed in the copy and leave the flag alone.
    if (!(lex.flags & 1)) {
      for (const a of [this.keyOff, this.tokStart, this.readOff]) {
        const n = a.length;
        for (let i = 1; i < n; i++) a[i] += a[i - 1];
      }
      if (lex.isView('keyOff')) lex.flags |= 1;
    }
    this.tokAttr = lex.u16('tokAttr');
    this.tokCost = lex.i16('tokCost');
    this.tokRead = lex.u32('tokRead');
    this.readChars = lex.u16('readChars');
    this.unkStart = lex.u32('unkStart');
    this.unkAttr = lex.u16('unkAttr');
    this.unkCost = lex.i16('unkCost');
    const nKeys = meta[2];
    if (this.keyOff.length !== nKeys + 1 || this.tokStart.length !== nKeys + 1 || this.tokAttr.length !== meta[3]) {
      throw new Error(`${lex.name}: inconsistent lexicon`);
    }
    // char.bin: runs of (first code point, CharInfo); U+FFFF reads as 0 (see japanese_data.py)
    const runs = lex.u32('charRuns');
    for (let i = 0; i < runs.length; i += 2) {
      const end = i + 2 < runs.length ? runs[i + 2] : 0x10000;
      this.charInfo.fill(runs[i + 1], runs[i], end);
    }
    this.space = this.charInfo[0x20];   // tokenizer.cpp: space_ = getCharInfo(0x20)
    // first-byte ranges of the sorted surfaces
    let k = 0;
    for (let b = 0; b < 256; b++) {
      this.firstLo[b] = k;
      while (k < nKeys && this.keyBytes[this.keyOff[k]] === b) k++;
      this.firstHi[b] = k;
    }

    const mm = mat.u32('meta');
    const rows = mm[0];
    this.cols = mm[1];
    if (mm[2] !== meta[0] || mm[3] !== meta[1]) throw new Error(`${mat.name}: does not match ${lex.name}`);
    this.rowMap = mat.u16('rowMap');
    this.colMap = mat.u16('colMap');
    this.matrix = mat.i16('cost');
    if (this.matrix.length !== rows * this.cols) throw new Error(`${mat.name}: bad size`);
    // Rows are stored as differences from the previous row: add them back up, the same way.
    if (!(mat.flags & 1)) {
      sumRows(this.matrix, this.cols);
      if (mat.isView('cost')) mat.flags |= 1;
    }
  }

  /** utf8_to_ucs2 + CharProperty::getCharInfo; sets this.mblen. Reading at the end of the text gives NUL. */
  private infoAt(p: number, end: number): number {
    const b = this.bytes;
    const len = end - p;
    const c0 = p < this.n ? b[p] : 0;
    let u = 0;
    if (c0 < 0x80) {
      this.mblen = 1;
      u = c0;
    } else if (len >= 2 && (c0 & 0xe0) === 0xc0) {
      this.mblen = 2;
      u = ((c0 & 0x1f) << 6) | (b[p + 1] & 0x3f);
    } else if (len >= 3 && (c0 & 0xf0) === 0xe0) {
      this.mblen = 3;
      u = (((c0 & 0x0f) << 12) | ((b[p + 1] & 0x3f) << 6) | (b[p + 2] & 0x3f)) & 0xffff;
    } else if (len >= 4 && (c0 & 0xf8) === 0xf0) {
      this.mblen = 4;   // outside UCS-2: category of U+0000
    } else if (len >= 5 && (c0 & 0xfc) === 0xf8) {
      this.mblen = 5;
    } else if (len >= 6 && (c0 & 0xfe) === 0xfc) {
      this.mblen = 6;
    } else {
      this.mblen = 1;
    }
    return this.charInfo[u];
  }

  /** Dictionary nodes for the surfaces that are prefixes of bytes[begin2, end), shortest first. */
  private addDictionary(pos: number, begin2: number, end: number, ctype: number): boolean {
    const b = this.bytes;
    if (begin2 >= end) return false;
    const keyOff = this.keyOff;
    const keyBytes = this.keyBytes;
    const tokStart = this.tokStart;
    let lo = this.firstLo[b[begin2]];
    let hi = this.firstHi[b[begin2]];
    let added = false;
    for (let k = 1; lo < hi; k++) {
      // [lo, hi): the surfaces starting with bytes[begin2, begin2 + k); a surface of exactly
      // that length sorts first.
      if (keyOff[lo + 1] - keyOff[lo] === k) {
        for (let t = tokStart[lo]; t < tokStart[lo + 1]; t++) {
          const n = this.newNode(this.tokAttr[t], this.tokCost[t], begin2, k, begin2 - pos + k, ctype);
          this.pool.tok[n] = t;
          added = true;
        }
      }
      if (begin2 + k >= end) break;
      const c = b[begin2 + k];
      // the byte at k of surface i, or -1 where it ends: non-decreasing over [lo, hi)
      let a = lo;
      let z = hi;
      while (a < z) {
        const m = (a + z) >>> 1;
        const o = keyOff[m];
        if ((keyOff[m + 1] - o > k ? keyBytes[o + k] : -1) < c) a = m + 1;
        else z = m;
      }
      let a2 = a;
      z = hi;
      while (a2 < z) {
        const m = (a2 + z) >>> 1;
        const o = keyOff[m];
        if ((keyOff[m + 1] - o > k ? keyBytes[o + k] : -1) <= c) a2 = m + 1;
        else z = m;
      }
      lo = a;
      hi = a2;
    }
    return added;
  }

  private newNode(attr: number, wcost: number, start: number, len: number, rlen: number, ctype: number): number {
    const p = this.pool;
    const n = p.add();
    p.attr[n] = attr;
    p.col[n] = this.colMap[attr];
    p.wcost[n] = wcost;
    p.start[n] = start;
    // mecab_node_t.length and .rlength are unsigned short: past 65535 bytes they wrap around
    p.len[n] = len & 0xffff;
    p.rlen[n] = rlen & 0xffff;
    p.ctype[n] = ctype;
    p.tok[n] = -1;
    return n;
  }

  /** ADDUNKNWON: one node per unk.dic entry of the category. */
  private addUnknown(pos: number, begin2: number, begin3: number, cinfo: number): boolean {
    const cat = defaultType(cinfo);
    let added = false;
    for (let k = this.unkStart[cat]; k < this.unkStart[cat + 1]; k++) {
      this.newNode(this.unkAttr[k], this.unkCost[k], begin2, begin3 - begin2, begin3 - pos, cat);
      added = true;
    }
    return added;
  }

  /** Tokenizer::lookup: appends the nodes that start at pos (in creation order). */
  private lookup(pos: number): void {
    const end = this.n - pos >= WINDOW ? pos + WINDOW : this.n;
    // seekToOtherType(begin, end, space_, &cinfo, &mblen, &clen)
    let cinfo = 0;
    let mblen = 0;
    let p = pos;
    let c = this.space;
    while (p < end) {   // (MeCab: p != end; p never passes end)
      cinfo = this.infoAt(p, end);
      mblen = this.mblen;
      if (!(c & cinfo & TYPE_MASK)) break;
      p += mblen;
      c = cinfo;
    }
    const begin2 = p;
    // darts commonPrefixSearch with len 0 reads up to the terminating NUL instead
    let found = this.addDictionary(pos, begin2, end > begin2 ? end : this.n, defaultType(cinfo));
    if (found && !isInvoke(cinfo)) return;

    let begin3 = begin2 + mblen;
    let groupBegin3 = -1;
    if (begin3 > end) {
      found = this.addUnknown(pos, begin2, begin3, cinfo) || found;
      if (found) return;
    }
    if (isGroup(cinfo)) {
      const tmp = begin3;
      let q = begin3;
      let c2 = cinfo;
      let clen = 0;
      while (q < end) {
        const info = this.infoAt(q, end);
        if (!(c2 & info & TYPE_MASK)) break;
        q += this.mblen;
        clen++;
        c2 = info;
      }
      begin3 = q;
      if (clen <= MAX_GROUPING_SIZE) found = this.addUnknown(pos, begin2, begin3, cinfo) || found;
      groupBegin3 = begin3;
      begin3 = tmp;
    }
    const length = charLength(cinfo);
    for (let i = 1; i <= length; i++) {
      if (begin3 > end) break;
      if (begin3 === groupBegin3) continue;
      found = this.addUnknown(pos, begin2, begin3, cinfo) || found;
      const info = this.infoAt(begin3, end);
      if (!(cinfo & info & TYPE_MASK)) break;
      begin3 += this.mblen;
    }
    if (!found) this.addUnknown(pos, begin2, begin3, cinfo);
  }

  private connect(pos: number, r: number, endHead: Int32Array): void {
    const p = this.pool;
    const rowBase = this.rowMap[p.attr[r]] * this.cols;
    const w = p.wcost[r];
    const m = this.matrix;
    const enext = p.enext;
    const pcost = p.cost;
    const col = p.col;
    let best = -1;
    let bestCost = 2147483647;
    for (let l = endHead[pos]; l >= 0; l = enext[l]) {
      const cost = pcost[l] + m[rowBase + col[l]] + w;
      if (cost < bestCost) {
        best = l;
        bestCost = cost;
      }
    }
    if (best < 0) throw new Error('MeCab: too long sentence.');
    p.prev[r] = best;
    p.cost[r] = bestCost;
    const x = pos + p.rlen[r];
    p.enext[r] = endHead[x];
    endHead[x] = r;
  }

  private reading(t: number): string | null {
    const r = this.tokRead[t];
    if (r === NO_READING) return null;
    const a = this.readOff[r];
    const b = this.readOff[r + 1];
    if (b - a <= 32) {
      let s = '';
      for (let i = a; i < b; i++) s += String.fromCharCode(this.readChars[i]);
      return s;
    }
    return unitsToString(this.readChars, a, b);
  }

  /** fugashi Tagger(text): the best path, without BOS/EOS. */
  parse(text: string): MecabNode[] {
    const nul = text.indexOf('\0');
    if (nul >= 0) text = text.slice(0, nul);
    const { bytes, unitAt } = encodeUtf8(text);
    this.bytes = bytes;
    const len = (this.n = bytes.length);
    const pool = this.pool;
    pool.reset();
    const endHead = new Int32Array(len + 8).fill(-1);
    const bos = this.newNode(0, 0, 0, 0, 0, 0);
    pool.cost[bos] = 0;
    pool.prev[bos] = -1;
    pool.enext[bos] = -1;
    endHead[0] = bos;
    for (let pos = 0; pos < len; pos++) {
      if (endHead[pos] < 0) continue;
      const first = pool.count;
      this.lookup(pos);
      // MeCab connects a position's nodes newest first (the bnext list).
      for (let r = pool.count - 1; r >= first; r--) this.connect(pos, r, endHead);
    }
    const eos = this.newNode(0, 0, len, 0, 0, 0);
    for (let pos = len; pos >= 0; pos--) {
      if (endHead[pos] >= 0) {
        this.connect(pos, eos, endHead);
        break;
      }
    }
    const path: number[] = [];
    for (let n = pool.prev[eos]; n !== bos; n = pool.prev[n]) path.push(n);
    path.reverse();
    const out: MecabNode[] = [];
    for (const n of path) {
      const a = unitAt[pool.start[n]];
      const b = unitAt[pool.start[n] + pool.len[n]];
      if (a < 0 || b < 0) throw new Error("UnicodeDecodeError: 'utf-8' codec can't decode a node surface");
      // fugashi slices the whitespace before a node as rlength - length bytes; when rlength has
      // wrapped below length (more than 64 KB of whitespace) Python raises SystemError there
      if (pool.rlen[n] < pool.len[n]) throw new Error('SystemError: Negative size passed to PyBytes_FromStringAndSize');
      const t = pool.tok[n];
      out.push({
        surface: text.slice(a, b),
        reading: t >= 0 ? this.reading(t) : null,
        charType: pool.ctype[n],
        isUnk: t < 0,
      });
    }
    this.bytes = new Uint8Array(0);
    if (pool.attr.length > 1 << 16) this.pool = new NodePool();   // let a huge text's lattice go
    return out;
  }
}
