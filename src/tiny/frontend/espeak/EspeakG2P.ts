/**
 * Non-English text -> phonemes for the Kitten TTS 2 nano / pico (phonemizer v1)
 * and mini (phonemizer v2) models, matching the Python kittenml package exactly:
 *
 *   phonemize_vN.phonemize_lang(get_g2p(lang), text, lang)
 *     -> misaki EspeakG2P (kittenml/kittentts2_tiny/frontend/espeak.py)
 *     -> phonemizer EspeakBackend over espeak-ng 1.52.0
 *
 * This file holds kittenml's and misaki's steps (Apache-2.0). phonemizer's backend and
 * espeak-ng itself are GPL-3.0-or-later, so they come in their own package,
 * @kittentts/espeak-ng, which an app installs and imports once when it needs these
 * languages. It registers itself under a global key, so this SDK never imports it and
 * stays Apache-2.0: apps that only speak English or Japanese ship no GPL code.
 *
 * No Node, React Native or file APIs: the caller hands in espeak-ng-data files as bytes
 * (see espeakDataFilesFor). Japanese (misaki's own G2P) and Korean on v1 (misaki's ko G2P)
 * are not espeak and not handled here.
 */
import { KittenTTSError } from '../../../KittenTTSError';
import { espeakDataFilesFor, espeakVoiceFor } from './files';
import { FOLD_V1, FOLD_V2, applyFold } from '../phonemize';
import { pyStripSpace, replaceAll } from '../pystr';

export { espeakDataFilesFor };

/** espeak-ng-data files: path relative to espeak-ng-data/ -> bytes. */
export type EspeakDataFiles = Record<string, Uint8Array>;
export type PhonemizerVersion = 'v1' | 'v2';

/** The espeak-ng release the text data's espeak-ng-data is built for. */
export const ESPEAK_NG_VERSION = '1.52.0';
export const ESPEAK_NG_PACKAGE = '@kittentts/espeak-ng';

/** phonemizer's EspeakBackend, as @kittentts/espeak-ng provides it. */
export interface EspeakBackendLike {
  addFiles(files: EspeakDataFiles): void;
  /** EspeakBackend(voice, preserve_punctuation=True, with_stress=True, tie='^', language_switch='remove-flags').phonemize([text])[0] */
  phonemize(text: string, voice: string): string;
  readonly version: string;
  dispose(): void;
}

/** What @kittentts/espeak-ng registers under Symbol.for('@kittentts/espeak-ng'). */
export interface EspeakNgRegistration {
  api: 1;
  espeakVersion: string;
  createBackend(files: EspeakDataFiles): Promise<EspeakBackendLike>;
}

const REGISTRY_KEY = Symbol.for(ESPEAK_NG_PACKAGE);

/** The registered @kittentts/espeak-ng, or null when the app has not imported it. */
export function registeredEspeakNg(): EspeakNgRegistration | null {
  const found = (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] as EspeakNgRegistration | undefined;
  return found && found.api === 1 ? found : null;
}

/** The registration, or an error that says how to add it. */
export function requireEspeakNg(lang: string): EspeakNgRegistration {
  const espeakNg = registeredEspeakNg();
  if (!espeakNg) {
    throw KittenTTSError.missingDependency(
      `Language "${lang}" goes through espeak-ng, which is GPL-3.0 and comes in its own package. ` +
      `Run npm install ${ESPEAK_NG_PACKAGE} and add import '${ESPEAK_NG_PACKAGE}'; once in your app.`,
    );
  }
  if (espeakNg.espeakVersion !== ESPEAK_NG_VERSION) {
    throw KittenTTSError.missingDependency(
      `${ESPEAK_NG_PACKAGE} has espeak-ng ${espeakNg.espeakVersion}; this SDK's text data needs ${ESPEAK_NG_VERSION}. ` +
      `Install the ${ESPEAK_NG_PACKAGE} version that matches @kittentts/react-native.`,
    );
  }
  return espeakNg;
}

/** Languages each phonemizer version sends to espeak (the others use misaki). */
const V1_LANGS = ['de', 'es', 'it', 'pt', 'ru', 'hi', 'fr'];
const ESPEAK_LANGS: Record<PhonemizerVersion, readonly string[]> = {
  v1: V1_LANGS,
  v2: [...V1_LANGS, 'da', 'fi', 'nl', 'sv', 'sw', 'tr', 'ko'],
};

// ---------------------------------------------------------------------------
// kittenml and misaki tables (phonemize_v2.py, espeak.py), in Python's dict order:
// the replacements run one after another.

/** phonemize_v2.TEXT_MAP for the espeak languages (only Hindi has an entry). */
const TEXT_MAP_V2_HI: ReadonlyArray<readonly [string, string]> = [['।', '.'], ['॥', '.']];

/** misaki EspeakG2P.e2m for version None, sorted by key as in Python. */
const E2M: ReadonlyArray<readonly [string, string]> = [
  ['a^ɪ', 'I'], ['a^ʊ', 'W'], ['d^z', 'ʣ'], ['d^ʒ', 'ʤ'],
  ['e^ɪ', 'A'], ['o^ʊ', 'O'], ['s^s', 'S'], ['t^s', 'ʦ'],
  ['t^ʃ', 'ʧ'], ['ɔ^ɪ', 'Y'], ['ə^ʊ', 'Q'],
];

// ---------------------------------------------------------------------------
// kittenml phonemize_v2 Hindi rules

/** Python's \s inside a character class. */
const PY_WS_CLASS = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
/** r\.(?=[^\s.,?!;:…]) */
const HI_R_DOT_IN_WORD = new RegExp(`r\\.(?=[^${PY_WS_CLASS}.,?!;:\\u2026])`, 'g');
/** _HI_FLAP = "[ड़ढ़]|[डढ]़": the flaps written precomposed or with a nukta */
const HI_FLAP = /[ड़ढ़]|[डढ]़/;

function checkLanguage(lang: string, version: PhonemizerVersion): void {
  if (version !== 'v1' && version !== 'v2') {
    throw new Error(`EspeakG2P: unknown phonemizer version ${JSON.stringify(version)}`);
  }
  if (ESPEAK_LANGS[version].indexOf(lang) < 0) {
    throw new Error(`EspeakG2P: language ${JSON.stringify(lang)} does not go through espeak in phonemizer ${version}`);
  }
}

export class EspeakG2P {
  private backend: EspeakBackendLike | null;
  private files = new Set<string>();

  private constructor(backend: EspeakBackendLike) {
    this.backend = backend;
  }

  /**
   * Load espeak-ng through @kittentts/espeak-ng. `files` must hold at least phontab,
   * phonindex, phondata and intonations; languages can come with it or later through
   * addFiles(). `lang` names the language asked for, for the error when the package is missing.
   */
  static async create(files: EspeakDataFiles, lang = 'this language'): Promise<EspeakG2P> {
    const backend = await requireEspeakNg(lang).createBackend(files);
    const g2p = new EspeakG2P(backend);
    for (const rel of Object.keys(files)) g2p.files.add(rel);
    return g2p;
  }

  /** Write more espeak-ng-data files (for example one more language). */
  addFiles(files: EspeakDataFiles): void {
    this.live().addFiles(files);
    for (const rel of Object.keys(files)) this.files.add(rel);
  }

  /** The files espeakDataFilesFor(lang) lists that have not been given yet. */
  missingFiles(lang: string): string[] {
    return espeakDataFilesFor(lang).filter((f) => !this.files.has(f));
  }

  /** The espeak-ng version string ("1.52.0"). */
  get version(): string {
    return this.live().version;
  }

  /**
   * Exactly Python's phonemize_vN.phonemize_lang(get_g2p(lang), text, lang),
   * before any vocab filtering.
   */
  phonemizeLang(text: string, lang: string, version: PhonemizerVersion): string {
    this.live();
    checkLanguage(lang, version);
    if (version === 'v2' && lang === 'hi') text = applyFold(text, TEXT_MAP_V2_HI);
    // phonemize(g2p, text)
    let ps = applyFold(pyStripSpace(this.misakiEspeak(text, lang)), version === 'v1' ? FOLD_V1 : FOLD_V2);
    if (version === 'v2' && lang === 'hi') {
      ps = replaceAll(ps, 'r.h', 'ɽʰ');
      ps = ps.replace(HI_R_DOT_IN_WORD, 'ɽ');
      if (HI_FLAP.test(text)) ps = replaceAll(ps, 'r.', 'ɽ');
    }
    return ps;
  }

  /** Drop espeak-ng. The instance cannot be used afterwards. */
  dispose(): void {
    this.backend?.dispose();
    this.backend = null;
    this.files.clear();
  }

  /** misaki EspeakG2P.__call__(text)[0] with version None. */
  private misakiEspeak(text: string, lang: string): string {
    const missing = this.missingFiles(lang);
    if (missing.length > 0) {
      throw new Error(`EspeakG2P: missing espeak-ng-data files ${missing.join(', ')}`);
    }
    // Angles to curly quotes, parentheses to angles
    text = replaceAll(replaceAll(text, '«', '“'), '»', '”');
    text = replaceAll(replaceAll(text, '(', '«'), ')', '»');
    let ps = pyStripSpace(this.live().phonemize(text, espeakVoiceFor(lang)!));
    for (const [oldS, newS] of E2M) ps = replaceAll(ps, oldS, newS);
    // Delete any remaining tie characters, hyphens
    ps = replaceAll(ps, '^', '');
    ps = replaceAll(ps, '-', '');
    // Angles back to parentheses
    return replaceAll(replaceAll(ps, '«', '('), '»', ')');
  }

  private live(): EspeakBackendLike {
    if (this.backend === null) throw new Error('EspeakG2P: used after dispose()');
    return this.backend;
  }
}
