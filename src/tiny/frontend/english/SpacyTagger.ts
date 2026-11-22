// spaCy en_core_web_sm's part-of-speech tagger, which misaki uses to pick between a
// word's pronunciations. The features and hashing run here; the network (tok2vec +
// softmax) runs in ONNX Runtime from spacy-tagger.onnx, written by
// tools/kitten-tts-2-tiny/export_english.py, where it was checked against spaCy.

import type { OrtLike, OrtSessionLike } from '../../ort';
import { createSession } from '../../ort';
import { hashString, hashUint64 } from './hash';
import type { SpacyToken } from './SpacyTokenizer';
import { own, pyIsAlpha, pyIsDigit, pyIsUpper, pyLower, pyStrIsSpace } from '../pystr';

export interface SpacyTaggerMeta {
  /** One per feature column, in the network's order. */
  embed: Array<{ attr: string; rows: number; offset: number; seed: number }>;
  tags: string[];
  /** spaCy's lexeme_norm table: decimal string hash -> norm. */
  lexemeNorm: Record<string, string>;
  baseNorms: Record<string, string>;
  /** spaCy's reserved symbols: string -> fixed id instead of a hash. */
  symbols: Record<string, number>;
}

/** spacy.lang.lex_attrs.word_shape */
function wordShape(text: string): string {
  const chars = Array.from(text);
  if (chars.length >= 100) return 'LONG';
  let shape = '';
  let last = '';
  let seq = 0;
  for (const ch of chars) {
    let s: string;
    if (pyIsAlpha(ch)) s = pyIsUpper(ch) ? 'X' : 'x';
    else if (pyIsDigit(ch)) s = 'd';
    else s = ch;
    if (s === last) {
      seq += 1;
    } else {
      seq = 0;
      last = s;
    }
    if (seq < 4) shape += s;
  }
  return shape;
}

export class SpacyTagger {
  private readonly hashes = new Map<string, bigint>();

  private constructor(
    private readonly ort: OrtLike,
    private readonly session: OrtSessionLike,
    private readonly meta: SpacyTaggerMeta,
  ) {}

  static async create(
    ort: OrtLike,
    meta: SpacyTaggerMeta,
    model: string | Uint8Array,
  ): Promise<SpacyTagger> {
    return new SpacyTagger(ort, await createSession(ort, model, 1), meta);
  }

  /** The Penn Treebank tag of each token (token.tag_). */
  async tag(tokens: readonly SpacyToken[]): Promise<string[]> {
    if (tokens.length === 0) return [];
    const rows = this.rows(tokens);
    const out = await this.session.run({
      rows: new this.ort.Tensor('int64', rows, [tokens.length, this.meta.embed.length, 4]),
    });
    const ids = out.tags.data as BigInt64Array | Int32Array | number[];
    return Array.from(ids as ArrayLike<number | bigint>, id => this.meta.tags[Number(id)]);
  }

  /** The embedding rows HashEmbed picks for each token: [T, columns, 4], offset into one table. */
  private rows(tokens: readonly SpacyToken[]): BigInt64Array {
    const cols = this.meta.embed;
    const rows = new BigInt64Array(tokens.length * cols.length * 4);
    tokens.forEach((tok, t) => {
      cols.forEach((col, c) => {
        const keys = hashUint64(this.feature(tok, col.attr), col.seed);
        for (let k = 0; k < 4; k++) {
          rows[(t * cols.length + c) * 4 + k] = BigInt((keys[k] % col.rows) + col.offset);
        }
      });
    });
    return rows;
  }

  async dispose(): Promise<void> {
    await this.session.release?.();
  }

  private feature(tok: SpacyToken, attr: string): bigint {
    const text = tok.text;
    switch (attr) {
      case 'NORM':
        return this.hash(tok.norm ?? this.lexemeNorm(text));
      case 'PREFIX':
        return this.hash(String.fromCodePoint(text.codePointAt(0) as number));
      case 'SUFFIX':
        return this.hash(Array.from(text).slice(-3).join(''));
      case 'SHAPE':
        return this.hash(wordShape(text));
      case 'SPACY':
        return tok.spacy ? 1n : 0n;
      case 'IS_SPACE':
        return pyStrIsSpace(text) ? 1n : 0n;
      default:
        throw new Error(`unknown spaCy feature ${attr}`);
    }
  }

  /** util._get_attr_unless_lookup: the lexeme_norm table, then the base norms, then lower. */
  private lexemeNorm(text: string): string {
    const fromTable = this.meta.lexemeNorm[this.hash(text).toString()];
    // (the table's keys are string ids too, so symbols are found by their id)
    if (fromTable !== undefined) return fromTable;
    const base = this.meta.baseNorms[text];
    return base !== undefined ? base : pyLower(text);
  }

  /** strings.get_string_id: 0 for "", a reserved symbol's id, else the string's hash. */
  private hash(text: string): bigint {
    let h = this.hashes.get(text);
    if (h === undefined) {
      if (text === '') h = 0n;
      else if (own(this.meta.symbols, text)) h = BigInt(this.meta.symbols[text]);
      else h = hashString(text);
      if (this.hashes.size > 50_000) this.hashes.clear();
      this.hashes.set(text, h);
    }
    return h;
  }
}
