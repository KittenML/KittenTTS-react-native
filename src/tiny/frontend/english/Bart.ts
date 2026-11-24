// The 0.75M-parameter character BART (PeterReid/graphemes_to_phonemes_en_us, Apache-2.0)
// the Python package uses for English words neither misaki nor CMUdict knows. One
// encoder and one decoder layer, d_model 128, one head: small enough to run in plain
// TypeScript. It mirrors transformers' BartForConditionalGeneration.generate() with
// num_beams=1, do_sample=False and max_length=max_position_embeddings (greedy, forced
// EOS at the last step).

export interface BartConfig {
  grapheme_chars: string;
  phoneme_chars: string;
  max_position_embeddings: number;
  d_model: number;
  encoder_layers: number;
  decoder_layers: number;
  encoder_attention_heads: number;
  decoder_attention_heads: number;
  vocab_size: number;
  bos_token_id: number;
  eos_token_id: number;
  decoder_start_token_id: number;
  forced_eos_token_id?: number;
  activation_function?: string;
  scale_embedding?: boolean;
}

type Tensors = Record<string, Float32Array>;

const LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Parse a .safetensors file of float32 tensors (what every model repository ships). */
export function parseSafetensors(bytes: Uint8Array): Tensors {
  if (!LITTLE_ENDIAN) throw new Error('parseSafetensors needs a little-endian platform');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerLen = Number(view.getBigUint64(0, true));
  let json = '';
  for (let i = 0; i < headerLen; i++) json += String.fromCharCode(bytes[8 + i]);
  const header = JSON.parse(json) as Record<string, { dtype: string; data_offsets: [number, number] }>;
  const base = 8 + headerLen;
  const out: Tensors = {};
  for (const [name, info] of Object.entries(header)) {
    if (name === '__metadata__') continue;
    if (info.dtype !== 'F32') throw new Error(`unsupported dtype ${info.dtype} for ${name} (only F32)`);
    const [a, b] = info.data_offsets;
    // A copy starts at offset 0, so the view is aligned.
    out[name] = new Float32Array(bytes.slice(base + a, base + b).buffer);
  }
  return out;
}

// erf for exact GELU: the Taylor series below 3, a continued fraction for erfc above.
function erf(x: number): number {
  const ax = Math.abs(x);
  let r: number;
  if (ax < 3) {
    let term = ax;
    let sum = ax;
    const x2 = ax * ax;
    for (let n = 1; n < 80; n++) {
      term *= -x2 / n;
      const t = term / (2 * n + 1);
      sum += t;
      if (Math.abs(t) < 1e-17 * Math.abs(sum)) break;
    }
    r = (2 / Math.sqrt(Math.PI)) * sum;
  } else {
    // erfc(x) = exp(-x^2)/sqrt(pi) * 1/(x + (1/2)/(x + 1/(x + (3/2)/(x + 2/(x + ...)))))
    let f = ax;
    for (let k = 60; k >= 1; k--) f = ax + k / 2 / f;
    r = 1 - Math.exp(-ax * ax) / Math.sqrt(Math.PI) / f;
  }
  return x < 0 ? -r : r;
}

function gelu(x: number): number {
  return 0.5 * x * (1 + erf(x / Math.SQRT2));
}

/** y[n, out] = x[n, in] @ W[out, in]^T + b */
function linear(x: Float32Array, n: number, W: Float32Array, b: Float32Array, nIn: number, nOut: number): Float32Array {
  const y = new Float32Array(n * nOut);
  for (let r = 0; r < n; r++) {
    const xo = r * nIn;
    for (let o = 0; o < nOut; o++) {
      let s = b[o];
      const wo = o * nIn;
      for (let i = 0; i < nIn; i++) s += x[xo + i] * W[wo + i];
      y[r * nOut + o] = s;
    }
  }
  return y;
}

function layerNorm(x: Float32Array, n: number, d: number, g: Float32Array, b: Float32Array): Float32Array {
  const y = new Float32Array(n * d);
  for (let r = 0; r < n; r++) {
    let mean = 0;
    for (let i = 0; i < d; i++) mean += x[r * d + i];
    mean /= d;
    let v = 0;
    for (let i = 0; i < d; i++) {
      const t = x[r * d + i] - mean;
      v += t * t;
    }
    const inv = 1 / Math.sqrt(v / d + 1e-5);
    for (let i = 0; i < d; i++) y[r * d + i] = (x[r * d + i] - mean) * inv * g[i] + b[i];
  }
  return y;
}

function add(a: Float32Array, b: Float32Array): Float32Array {
  const y = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) y[i] = a[i] + b[i];
  return y;
}

/**
 * Single-head attention of q [nq, d] over k, v [nk, d], with no mask: the encoder sees
 * its whole input, and the decoder runs one step at a time over its cache.
 */
function attention(q: Float32Array, nq: number, k: Float32Array, v: Float32Array, nk: number, d: number): Float32Array {
  const out = new Float32Array(nq * d);
  const scale = 1 / Math.sqrt(d);
  const scores = new Float64Array(nk);
  for (let i = 0; i < nq; i++) {
    let max = -Infinity;
    for (let j = 0; j < nk; j++) {
      let s = 0;
      for (let t = 0; t < d; t++) s += q[i * d + t] * k[j * d + t];
      scores[j] = s * scale;
      if (scores[j] > max) max = scores[j];
    }
    let sum = 0;
    for (let j = 0; j < nk; j++) {
      scores[j] = Math.exp(scores[j] - max);
      sum += scores[j];
    }
    for (let j = 0; j < nk; j++) {
      const p = scores[j] / sum;
      for (let t = 0; t < d; t++) out[i * d + t] += p * v[j * d + t];
    }
  }
  return out;
}

export class BartG2P {
  private readonly g2i = new Map<string, number>();
  private readonly i2p = new Map<number, string>();
  private readonly d: number;
  /** max_position_embeddings: the longest token sequence, <s> and </s> included. */
  readonly maxLen: number;

  constructor(private readonly config: BartConfig, private readonly w: Tensors) {
    if (config.encoder_layers !== 1 || config.decoder_layers !== 1
      || config.encoder_attention_heads !== 1 || config.decoder_attention_heads !== 1) {
      throw new Error('BartG2P supports one layer with one attention head');
    }
    if ((config.activation_function ?? 'gelu') !== 'gelu' || config.scale_embedding) {
      throw new Error('BartG2P supports gelu and unscaled embeddings only');
    }
    // Both strings open with four "_" placeholders for <pad> <s> </s> <unk>, so a
    // character's index is its token id.
    Array.from(config.grapheme_chars).forEach((c, i) => { if (i > 3) this.g2i.set(c, i); });
    Array.from(config.phoneme_chars).forEach((c, i) => { if (i > 3) this.i2p.set(i, c); });
    this.d = config.d_model;
    this.maxLen = config.max_position_embeddings;
  }

  /** The characters the model can read. */
  get letters(): string {
    return Array.from(this.g2i.keys()).join('');
  }

  /** Graphemes -> phoneme string, as Fallback._bart does for one chunk (no substitutions). */
  predict(word: string): string {
    const ids = [this.config.bos_token_id, ...Array.from(word, c => this.g2i.get(c) as number),
      this.config.eos_token_id];
    const memory = this.encode(ids);
    const gen = this.generate(memory, ids.length);
    return gen.map(t => this.i2p.get(t) ?? '').join('');
  }

  private embed(prefix: string, ids: number[], start: number): Float32Array {
    const d = this.d;
    const tok = this.w['model.shared.weight'];
    const pos = this.w[`${prefix}.embed_positions.weight`];
    const x = new Float32Array(ids.length * d);
    ids.forEach((id, r) => {
      const p = start + r + 2;          // BartLearnedPositionalEmbedding offset
      for (let i = 0; i < d; i++) x[r * d + i] = tok[id * d + i] + pos[p * d + i];
    });
    return layerNorm(x, ids.length, d, this.w[`${prefix}.layernorm_embedding.weight`],
      this.w[`${prefix}.layernorm_embedding.bias`]);
  }

  private proj(x: Float32Array, n: number, name: string): Float32Array {
    const W = this.w[`${name}.weight`];
    const b = this.w[`${name}.bias`];
    return linear(x, n, W, b, W.length / b.length, b.length);
  }

  private ln(x: Float32Array, n: number, name: string): Float32Array {
    return layerNorm(x, n, this.d, this.w[`${name}.weight`], this.w[`${name}.bias`]);
  }

  private ffn(x: Float32Array, n: number, layer: string): Float32Array {
    const h = this.proj(x, n, `${layer}.fc1`);
    for (let i = 0; i < h.length; i++) h[i] = gelu(h[i]);
    return this.proj(h, n, `${layer}.fc2`);
  }

  private encode(ids: number[]): { k: Float32Array; v: Float32Array } {
    const n = ids.length;
    const L = 'model.encoder.layers.0';
    let x = this.embed('model.encoder', ids, 0);
    const q = this.proj(x, n, `${L}.self_attn.q_proj`);
    const k = this.proj(x, n, `${L}.self_attn.k_proj`);
    const v = this.proj(x, n, `${L}.self_attn.v_proj`);
    const a = this.proj(attention(q, n, k, v, n, this.d), n, `${L}.self_attn.out_proj`);
    x = this.ln(add(x, a), n, `${L}.self_attn_layer_norm`);
    x = this.ln(add(x, this.ffn(x, n, L)), n, `${L}.final_layer_norm`);
    const D = 'model.decoder.layers.0.encoder_attn';
    return { k: this.proj(x, n, `${D}.k_proj`), v: this.proj(x, n, `${D}.v_proj`) };
  }

  private generate(memory: { k: Float32Array; v: Float32Array }, nMem: number): number[] {
    const d = this.d;
    const L = 'model.decoder.layers.0';
    const tokens = [this.config.decoder_start_token_id];
    const cacheK: number[] = [];
    const cacheV: number[] = [];
    const lm = this.w['model.shared.weight'];
    const bias = this.w.final_logits_bias;
    const vocab = this.config.vocab_size;
    const eos = this.config.eos_token_id;
    const forcedEos = this.config.forced_eos_token_id ?? eos;
    while (tokens.length < this.maxLen) {
      const pos = tokens.length - 1;
      let x = this.embed('model.decoder', [tokens[pos]], pos);
      const q = this.proj(x, 1, `${L}.self_attn.q_proj`);
      cacheK.push(...this.proj(x, 1, `${L}.self_attn.k_proj`));
      cacheV.push(...this.proj(x, 1, `${L}.self_attn.v_proj`));
      const sa = attention(q, 1, Float32Array.from(cacheK), Float32Array.from(cacheV), tokens.length, d);
      x = this.ln(add(x, this.proj(sa, 1, `${L}.self_attn.out_proj`)), 1, `${L}.self_attn_layer_norm`);
      const cq = this.proj(x, 1, `${L}.encoder_attn.q_proj`);
      const ca = attention(cq, 1, memory.k, memory.v, nMem, d);
      x = this.ln(add(x, this.proj(ca, 1, `${L}.encoder_attn.out_proj`)), 1, `${L}.encoder_attn_layer_norm`);
      x = this.ln(add(x, this.ffn(x, 1, L)), 1, `${L}.final_layer_norm`);
      let next: number;
      if (tokens.length === this.maxLen - 1) {
        next = forcedEos;           // ForcedEOSTokenLogitsProcessor
      } else {
        let best = -Infinity;
        next = 0;
        for (let t = 0; t < vocab; t++) {
          let s = bias[t];
          for (let i = 0; i < d; i++) s += x[i] * lm[t * d + i];
          if (s > best) {
            best = s;
            next = t;
          }
        }
      }
      tokens.push(next);
      if (next === eos) break;
    }
    return tokens;
  }
}
