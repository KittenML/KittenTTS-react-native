// Text -> phoneme chunks for the Kitten TTS 2 nano / pico / mini models, exactly as in
// their training (kittenml/kittentts2_tiny/frontend/__init__.py). English goes through
// EnglishG2P (always filtered with the v1 symbol set, then folded for v2 models), Japanese
// (Mini) through misaki's cutlet G2P (JapaneseG2P), every other language through espeak-ng
// (EspeakG2P). Text longer than MAX_PHON phonemes is cut at sentence ends, then at spaces.

import type { EnglishG2P } from './english/EnglishG2P';
import { pyLen, pyStripSpace } from './pystr';
import type { EspeakG2P, PhonemizerVersion } from './espeak/EspeakG2P';
import type { JapaneseG2P } from './japanese/JapaneseG2P';
import { foldExtra } from './phonemize';
import { memo } from '../assets';

const MAX_PHON = 350;                    // p90 phoneme length of the training lists
const SENT_MULTI = /(?<=[.!?…।])\s+|(?<=[。！？])/u;

interface G2PLike {
  phonemize(text: string, normalise?: boolean): Promise<{ text: string; phonemes: string }>;
  dispose(): void;
}

/**
 * A non-English language as in training (LangG2P in Python): the language's G2P, then only
 * the characters in the model's vocab.
 */
function filtered(g2p: (text: string) => string, vocab: ReadonlySet<string>, dispose: () => void): G2PLike {
  return {
    async phonemize(text) {
      return { text, phonemes: Array.from(g2p(text)).filter(c => vocab.has(c)).join('') };
    },
    dispose,
  };
}

/** Cut one over-long phoneme string at spaces. */
function* wrap(ps: string): Generator<string> {
  let chars = Array.from(ps);
  while (chars.length > MAX_PHON) {
    let cut = chars.slice(0, MAX_PHON).lastIndexOf(' ');
    cut = cut > 0 ? cut : MAX_PHON;
    yield chars.slice(0, cut).join('');
    chars = Array.from(pyStripSpace(chars.slice(cut).join('')));
  }
  if (chars.length) yield chars.join('');
}

/** front_end: text -> phoneme chunks. Text of up to MAX_PHON phonemes is one G2P call. */
async function frontEnd(g2p: G2PLike, text: string): Promise<string[]> {
  const whole = await g2p.phonemize(text);
  if (pyLen(whole.phonemes) <= MAX_PHON) return whole.phonemes ? [whole.phonemes] : [];
  const chunks: string[] = [];
  let cur = '';
  for (const sent of whole.text.split(SENT_MULTI)) {
    if (!pyStripSpace(sent)) continue;
    const r = await g2p.phonemize(sent, false);
    for (const ps of wrap(r.phonemes)) {
      if (cur && pyLen(cur) + 1 + pyLen(ps) > MAX_PHON) {
        chunks.push(cur);
        cur = ps;
      } else {
        cur = pyStripSpace(`${cur} ${ps}`);
      }
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

interface FrontendLoaders {
  english(vocabV1: ReadonlySet<string>): Promise<EnglishG2P>;
  espeak(lang: string): Promise<EspeakG2P>;
  japanese(): Promise<JapaneseG2P>;
}

/** The text front end of one model repository: its phonemizer version and vocab. */
export class TinyFrontend {
  private readonly vocab: ReadonlySet<string>;
  private readonly g2ps = new Map<string, Promise<G2PLike>>();

  constructor(
    private readonly phonemizer: PhonemizerVersion,
    vocab: Record<string, number>,
    private readonly loaders: FrontendLoaders,
  ) {
    this.vocab = new Set(Object.keys(vocab));
  }

  private g2p(lang: string): Promise<G2PLike> {
    return memo(this.g2ps, lang, async () => {
      if (lang === 'en') {
        // English always filters with the v1 symbol set, as in training (v2 = v1 +
        // U+0289 on the unused id 29); the v2 models then fold with fold_extra.
        return this.loaders.english(new Set(Array.from(this.vocab).filter(k => k !== 'ʉ')));
      }
      if (lang === 'ja') {
        const ja = await this.loaders.japanese();
        return filtered(text => ja.phonemize(text), this.vocab, () => ja.dispose());
      }
      const espeak = await this.loaders.espeak(lang);
      return filtered(text => espeak.phonemizeLang(text, lang, this.phonemizer), this.vocab, () => espeak.dispose());
    });
  }

  /** Load a language's text processing ahead of its first sentence. */
  async ready(lang: string): Promise<void> {
    await this.g2p(lang);
  }

  /** text -> the phoneme chunks the model speaks. */
  async phonemize(text: string, lang: string): Promise<string[]> {
    let chunks = await frontEnd(await this.g2p(lang), text);
    if (lang === 'en' && this.phonemizer === 'v2') chunks = chunks.map(foldExtra);
    return chunks;
  }

  /** Free every language's text processing (the English tagger's ONNX session among them). */
  async dispose(): Promise<void> {
    const all = Array.from(this.g2ps.values());
    this.g2ps.clear();
    for (const g of await Promise.all(all.map(p => p.catch(() => null)))) g?.dispose();
  }
}
