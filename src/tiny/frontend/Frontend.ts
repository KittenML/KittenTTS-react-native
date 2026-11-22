// Text -> phoneme chunks for the Kitten TTS 2 nano / pico / mini models, exactly as in
// their training (kittenml/kittentts2_tiny/frontend/__init__.py). English goes through
// EnglishG2P (always filtered with the v1 symbol set, then folded for v2 models); every
// other language through espeak-ng (EspeakG2P). Text longer than MAX_PHON phonemes is cut
// at sentence ends, then at spaces.

import type { EnglishG2P } from './english/EnglishG2P';
import { pyLen, pyStripSpace } from './english/pystr';
import type { EspeakG2P, PhonemizerVersion } from './espeak/EspeakG2P';
import type { JapaneseG2P } from './japanese/JapaneseG2P';
import { foldExtra } from './phonemize';

export const MAX_PHON = 350;             // p90 phoneme length of the training lists
const SENT_MULTI = /(?<=[.!?…।])\s+|(?<=[。！？])/u;

interface G2PLike {
  phonemize(text: string, normalise?: boolean): Promise<{ text: string; phonemes: string }>;
}

/** One non-English language as in training. */
class LangG2P implements G2PLike {
  constructor(
    private readonly espeak: EspeakG2P,
    private readonly lang: string,
    private readonly version: PhonemizerVersion,
    private readonly vocab: ReadonlySet<string>,
  ) {}

  async phonemize(text: string): Promise<{ text: string; phonemes: string }> {
    const ps = this.espeak.phonemizeLang(text, this.lang, this.version);
    return { text, phonemes: Array.from(ps).filter(c => this.vocab.has(c)).join('') };
  }
}

/** Japanese (Mini): misaki's cutlet G2P, then the vocab filter, as LangG2P does. */
class JaG2P implements G2PLike {
  constructor(private readonly ja: JapaneseG2P, private readonly vocab: ReadonlySet<string>) {}

  async phonemize(text: string): Promise<{ text: string; phonemes: string }> {
    const ps = this.ja.phonemize(text);
    return { text, phonemes: Array.from(ps).filter(c => this.vocab.has(c)).join('') };
  }
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
export async function frontEnd(g2p: G2PLike, text: string): Promise<string[]> {
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

export interface FrontendLoaders {
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
    let g = this.g2ps.get(lang);
    if (!g) {
      if (lang === 'en') {
        // English always filters with the v1 symbol set, as in training (v2 = v1 +
        // U+0289 on the unused id 29); the v2 models then fold with fold_extra.
        const v1 = new Set(Array.from(this.vocab).filter(k => k !== 'ʉ'));
        g = this.loaders.english(v1);
      } else if (lang === 'ja') {
        g = this.loaders.japanese().then(j => new JaG2P(j, this.vocab));
      } else {
        g = this.loaders.espeak(lang).then(e => new LangG2P(e, lang, this.phonemizer, this.vocab));
      }
      g.catch(() => this.g2ps.delete(lang));
      this.g2ps.set(lang, g);
    }
    return g;
  }

  /** Load a language's text processing ahead of its first sentence. */
  async ready(lang: string): Promise<void> {
    await this.g2p(lang);
  }

  /** text -> the phoneme chunks the model speaks. */
  async phonemize(text: string, lang: string): Promise<string[]> {
    let chunks = await frontEnd(await this.g2p(lang), text || '');
    if (lang === 'en' && this.phonemizer === 'v2') chunks = chunks.map(foldExtra);
    return chunks;
  }
}
