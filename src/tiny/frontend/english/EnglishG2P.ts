// English text -> phonemes for the Kitten TTS 2 nano / pico / mini models, as the Python
// package does it (kittenml/kittentts2_tiny/frontend/english.py): tts_norm text
// normalisation, misaki's lexicon, then CMUdict and the small BART for the words misaki
// lacks, then the phonemizer-v1 FOLD table and the model's vocab.

import { BartG2P } from './Bart';
import type { MToken, Lexicon } from './Misaki';
import { MisakiG2P } from './Misaki';
import type { SpacyTagger } from './SpacyTagger';
import type { SpacyTokenizer } from './SpacyTokenizer';
import { normalize } from './TtsNorm';
import { digitValue, own, pyLower, pyNormalize, pyStrip } from './pystr';
import { foldV1 } from '../phonemize';

const DIGITS = 'zero one two three four five six seven eight nine'.split(' ');
// Latin letters NFKD does not decompose; without this "Søren" reaches the lookup as
// "S" and "ren".
const TRANSLIT: Record<string, string> = {
  'ø': 'o', 'Ø': 'O', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ł': 'l', 'Ł': 'L',
  'đ': 'd', 'Đ': 'D', '’': "'",
};
const COMBINING = /^\p{M}$/u;

export interface EnglishG2PResult {
  /** The text after normalisation, as the G2P saw it. */
  text: string;
  /** Only symbols the model has a row for. */
  phonemes: string;
  /** Words the fallback said: [word, phonemes, source]. */
  fallback: Array<[string, string, string]>;
  /** Text nothing could pronounce. */
  skipped: string[];
  /** Phoneme symbols dropped for being outside the vocab. */
  dropped: string[];
}

/** english.Fallback: CMUdict first, the BART for the rest. */
export class Fallback {
  private readonly memo = new Map<string, string>();
  private readonly pieces: RegExp;
  used: Array<[string, string, string]> = [];
  skipped: string[] = [];

  constructor(private readonly cmu: Record<string, string>, private readonly bart: BartG2P) {
    const letters = bart.letters.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
    this.pieces = new RegExp(`(\\p{Nd}+)|([${letters}]+)|([\\s\\S])`, 'gu');
  }

  reset(): void {
    this.used = [];
    this.skipped = [];
  }

  private bartWord(word: string): string {
    let ps = this.memo.get(word);
    if (ps === undefined) {
      const step = 64 - 2;            // room for <s> and </s>
      const chars = Array.from(word);
      let out = '';
      for (let i = 0; i < chars.length; i += step) out += this.bart.predict(chars.slice(i, i + step).join(''));
      // the same final substitution misaki applies to its own lexicon output
      ps = out.split('ɾ').join('T').split('ʔ').join('t');
      this.memo.set(word, ps);
    }
    return ps;
  }

  private cmuWord(word: string): string | null {
    const w = pyLower(word);
    if (own(this.cmu, w)) return this.cmu[w];
    if (w.endsWith("'s") && own(this.cmu, w.slice(0, -2))) {
      const stem = this.cmu[w.slice(0, -2)];
      const c = Array.from(stem).pop() as string;
      return stem + ('ptkfθ'.includes(c) ? 's' : 'szʃʒʧʤ'.includes(c) ? 'ᵻz' : 'z');
    }
    return null;
  }

  /** One spelled word: CMUdict whole, else its hyphen parts, else the BART. */
  private word(word: string, sources: Set<string>): string {
    const ps = this.cmuWord(word);
    if (ps === null && word.includes('-')) {
      return word.split('-').filter(p => p).map(p => this.word(p, sources)).join(' ');
    }
    sources.add(ps ? 'CMUdict' : 'BART');
    return ps || this.bartWord(word);
  }

  say(text: string): [string, string] {
    // fold accents and the typographic apostrophe so "café" and "it’s" stay sayable
    let t = Array.from(text, c => (own(TRANSLIT, c) ? TRANSLIT[c] : c)).join('');
    t = Array.from(pyNormalize(t, 'NFKD')).filter(c => !COMBINING.test(c)).join('');
    const out: string[] = [];
    const sources = new Set<string>();
    this.pieces.lastIndex = 0;
    for (const m of t.matchAll(this.pieces)) {
      const [, digits, letters, other] = m;
      if (digits) {
        out.push(Array.from(digits, d => this.word(DIGITS[digitValue(d)], sources)).join(' '));
      } else if (letters && pyStrip(letters, "'-.")) {
        out.push(this.word(pyStrip(letters, "'-."), sources));
      } else if (other && other.trim()) {
        this.skipped.push(other);
      }
    }
    return [out.filter(p => p).join(' '), Array.from(sources).sort().join('+')];
  }

  call = (token: MToken): string | null => {
    const [ps, source] = this.say(token.text);
    if (!ps) {
      this.skipped.push(token.text);
      return null;
    }
    this.used.push([token.text, ps, source]);
    return ps;
  };
}

export interface EnglishG2PData {
  golds: Lexicon;
  silvers: Lexicon;
  cmu: Record<string, string>;
  bart: BartG2P;
  tokenizer: SpacyTokenizer;
  tagger: SpacyTagger;
}

/** tts_norm -> misaki lexicon -> CMUdict -> BART -> the model's phoneme vocab. */
export class EnglishG2P {
  private readonly fallback: Fallback;
  private readonly misaki: MisakiG2P;

  constructor(data: EnglishG2PData, private readonly vocab: ReadonlySet<string>) {
    this.fallback = new Fallback(data.cmu, data.bart);
    // unk="" because an unsayable token is reported through skipped rather than
    // marked in the phoneme string with a symbol the vocab lacks.
    this.misaki = new MisakiG2P(data.tokenizer, data.tagger, data.golds, data.silvers, this.fallback.call, '');
  }

  async phonemize(text: string, normalise = true): Promise<EnglishG2PResult> {
    const t = normalise ? normalize(text) : text;
    this.fallback.reset();
    const { phonemes, tokens } = await this.misaki.phonemize(t);
    const unsaid = tokens.filter(tk => tk.phonemes === null).map(tk => tk.text);
    // phonemize_lang applies the same FOLD table the training lists went through
    let ps = foldV1(phonemes);
    const dropped = Array.from(new Set(Array.from(ps).filter(c => !this.vocab.has(c)))).sort();
    if (dropped.length) ps = Array.from(ps).filter(c => this.vocab.has(c)).join('');
    const skipped = Array.from(new Set([...this.fallback.skipped, ...unsaid]));
    return { text: t, phonemes: ps, fallback: [...this.fallback.used], skipped, dropped };
  }
}
