// English text -> phonemes for the Kitten TTS 2 nano / pico / mini models, as kittenml
// 0.9.7 does it (kittenml/kittentts2_tiny/frontend/english.py): tts_norm text
// normalisation, misaki's lexicon, then CMUdict and the small BART for the words misaki
// lacks, then the phonemizer-v1 FOLD table and the model's vocab.

import type { BartG2P } from './Bart';
import type { MToken, Lexicon } from './Misaki';
import { MisakiG2P } from './Misaki';
import type { SpacyTagger } from './SpacyTagger';
import type { SpacyTokenizer } from './SpacyTokenizer';
import { normalize } from './TtsNorm';
import { decimalValue, ND_CLASS, own, pyIsCombining, pyLower, pyNormalize, pyStrip } from '../pystr';
import { foldV1 } from '../phonemize';

const DIGITS = 'zero one two three four five six seven eight nine'.split(' ');
// Latin letters NFKD does not decompose; without this "Søren" reaches the lookup as
// "S" and "ren".
const TRANSLIT: Record<string, string> = {
  'ø': 'o', 'Ø': 'O', 'ß': 'ss', 'æ': 'ae', 'Æ': 'AE', 'œ': 'oe', 'Œ': 'OE', 'ł': 'l', 'Ł': 'L',
  'đ': 'd', 'Đ': 'D', '’': "'",
};

export interface EnglishG2PResult {
  /** The text after normalisation, as the G2P saw it. */
  text: string;
  /** Only symbols the model has a row for. */
  phonemes: string;
}

/** english.Fallback: CMUdict first, the BART for the rest. */
class Fallback {
  private readonly memo = new Map<string, string>();
  private readonly pieces: RegExp;

  constructor(private readonly cmu: Record<string, string>, private readonly bart: BartG2P) {
    const letters = bart.letters.replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
    // re: (\d+)|([letters]+)|(.) with re.S
    this.pieces = new RegExp(`([${ND_CLASS}]+)|([${letters}]+)|([\\s\\S])`, 'gu');
  }

  private bartWord(word: string): string {
    let ps = this.memo.get(word);
    if (ps === undefined) {
      const step = this.bart.maxLen - 2;    // room for <s> and </s>
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
  private word(word: string): string {
    const ps = this.cmuWord(word);
    if (ps === null && word.includes('-')) {
      return word.split('-').filter(p => p).map(p => this.word(p)).join(' ');
    }
    return ps || this.bartWord(word);
  }

  private say(text: string): string {
    // fold accents and the typographic apostrophe so "café" and "it’s" stay sayable
    let t = Array.from(text, c => (own(TRANSLIT, c) ? TRANSLIT[c] : c)).join('');
    t = Array.from(pyNormalize(t, 'NFKD')).filter(c => !pyIsCombining(c)).join('');
    const out: string[] = [];
    for (const [, digits, letters] of t.matchAll(this.pieces)) {
      if (digits) {
        out.push(Array.from(digits, d => this.word(DIGITS[decimalValue(d)])).join(' '));
      } else if (letters && pyStrip(letters, "'-.")) {
        out.push(this.word(pyStrip(letters, "'-.")));
      }
    }
    return out.filter(p => p).join(' ');
  }

  call = (token: MToken): string | null => this.say(token.text) || null;
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
  private readonly misaki: MisakiG2P;
  private readonly tagger: SpacyTagger;

  constructor(data: EnglishG2PData, private readonly vocab: ReadonlySet<string>) {
    const fallback = new Fallback(data.cmu, data.bart);
    // unk="" because an unsayable token is left out of the phoneme string rather than
    // marked with a symbol the vocab lacks.
    this.misaki = new MisakiG2P(data.tokenizer, data.tagger, data.golds, data.silvers, fallback.call, '');
    this.tagger = data.tagger;
  }

  async phonemize(text: string, normalise = true): Promise<EnglishG2PResult> {
    const t = normalise ? normalize(text) : text;
    // phonemize_lang applies the same FOLD table the training lists went through
    const ps = foldV1(await this.misaki.phonemize(t));
    return { text: t, phonemes: Array.from(ps).filter(c => this.vocab.has(c)).join('') };
  }

  /** Releases the tagger's ONNX session. */
  dispose(): Promise<void> {
    return this.tagger.dispose();
  }
}
