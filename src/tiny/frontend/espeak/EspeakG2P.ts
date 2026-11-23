/**
 * Non-English text -> phonemes for the Kitten TTS 2 nano / pico (phonemizer v1)
 * and mini (phonemizer v2) models, matching the Python kittenml package exactly:
 *
 *   phonemize_vN.phonemize_lang(get_g2p(lang), text, lang)
 *     -> misaki EspeakG2P (kittenml/kittentts2_tiny/frontend/espeak.py)
 *     -> phonemizer 3.6.0 EspeakBackend(preserve_punctuation=True, with_stress=True,
 *        tie='^', language_switch='remove-flags')
 *     -> espeak-ng 1.52.0 espeak_TextToPhonemes (compiled to plain JS)
 *
 * Every Python step is ported here, in order, with the Python names in the
 * comments. Python string semantics that differ from JavaScript are spelled out:
 * str.strip()/split() and the regex \s use Python's whitespace set (isPySpace),
 * the regex `.` does not match "\n" only, and the punctuation regex (which has a
 * lookbehind) is a hand-written scanner.
 *
 * No Node, React Native or file APIs: the caller hands in espeak-ng-data files
 * as bytes (see espeakDataFilesFor). Japanese (misaki's own G2P) and Korean on
 * v1 (misaki's ko G2P) are not espeak and not handled here.
 *
 * espeak-ng is GPL-3.0-or-later.
 */
import createEspeakNgModule from './generated/espeakng';
import { BASE_FILES, espeakDataFilesFor, espeakVoiceFor } from './files';

export { espeakDataFilesFor };
import type { EspeakNgModule } from './generated/espeakng';
import { FOLD_V1, FOLD_V2, applyFold } from '../phonemize';
import { isPySpace, pyStripSpace, replaceAll } from '../pystr';

/** espeak-ng-data files: path relative to espeak-ng-data/ -> bytes. */
export type EspeakDataFiles = Record<string, Uint8Array>;
export type PhonemizerVersion = 'v1' | 'v2';

const DATA_DIR = '/espeak-ng-data';

// phonemizer EspeakWrapper.text_to_phonemes with a tie:
// espeakPHONEMES_IPA | espeakPHONEMES_TIE | ord('\u0361') << 8
const PHONEME_MODE = 0x02 | 0x80 | (0x361 << 8);


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
const TEXT_MAP_V2_HI: ReadonlyArray<readonly [string, string]> = [['\u0964', '.'], ['\u0965', '.']];

/** misaki EspeakG2P.e2m for version None, sorted by key as in Python. */
const E2M: ReadonlyArray<readonly [string, string]> = [
  ['a^\u026a', 'I'], ['a^\u028a', 'W'], ['d^z', '\u02a3'], ['d^\u0292', '\u02a4'],
  ['e^\u026a', 'A'], ['o^\u028a', 'O'], ['s^s', 'S'], ['t^s', '\u02a6'],
  ['t^\u0283', '\u02a7'], ['\u0254^\u026a', 'Y'], ['\u0259^\u028a', 'Q'],
];

// ---------------------------------------------------------------------------
// Python string helpers

/** Python's \s inside a character class. */
const PY_WS_CLASS = '\\t\\n\\v\\f\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';

function isAsciiDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

// ---------------------------------------------------------------------------
// phonemizer.punctuation.Punctuation with the default marks

/** _DEFAULT_MARKS without the decimal separators , and . */
const OTHER_MARKS = new Set<number>(
  [0x3b, 0x3a, 0x21, 0x3f, 0xa1, 0xbf, 0x2014, 0x2026, 0x22, 0xab, 0xbb, 0x201c, 0x201d, 0x28, 0x29, 0x7b, 0x7d, 0x5b, 0x5d],
);
/** _INLINE_MARKS */
const INLINE_MARKS = new Set<number>(
  [0x22, 0xab, 0xbb, 0x201c, 0x201d, 0x2018, 0x2019, 0x201e, 0x2039, 0x203a, 0x28, 0x29, 0x5b, 0x5d, 0x7b, 0x7d],
);

/**
 * One character of the punctuation regex
 *   (\s*(?:[others]|(?<![0-9])[,.]|[,.](?![0-9]))+\s*)+
 * A , or . is a mark unless it sits between two ASCII digits.
 */
function isMarkAt(s: string, i: number): boolean {
  const c = s.charCodeAt(i);
  if (OTHER_MARKS.has(c)) return true;
  if (c === 0x2c || c === 0x2e) {
    const prevDigit = i > 0 && isAsciiDigit(s.charCodeAt(i - 1));
    const nextDigit = i + 1 < s.length && isAsciiDigit(s.charCodeAt(i + 1));
    return !(prevDigit && nextDigit);
  }
  return false;
}

/**
 * _marks_re.finditer(line) as [start, end) spans. A match is a maximal run of
 * whitespace and marks holding at least one mark: the regex is greedy, and a
 * run without a mark cannot start a match anywhere inside it.
 */
function findMarks(s: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  const n = s.length;
  let i = 0;
  while (i < n) {
    const ws = isPySpace(s.charCodeAt(i));
    if (!ws && !isMarkAt(s, i)) {
      i++;
      continue;
    }
    let j = i;
    let hasMark = false;
    while (j < n) {
      if (isPySpace(s.charCodeAt(j))) {
        j++;
      } else if (isMarkAt(s, j)) {
        hasMark = true;
        j++;
      } else {
        break;
      }
    }
    if (hasMark) spans.push([i, j]);
    i = j;
  }
  return spans;
}

/** A part of a line: the index of a chunk, or a punctuation mark. */
type Part = number | string;

/** Punctuation.preserve(text) for one line. */
function preserve(line: string, chunks: string[]): Part[] {
  const parts: Part[] = [];
  let cursor = 0;
  for (const [start, end] of findMarks(line)) {
    if (start > cursor) {
      parts.push(chunks.length);
      chunks.push(line.slice(cursor, start));
    }
    parts.push(line.slice(start, end));
    cursor = end;
  }
  if (cursor < line.length) {
    parts.push(chunks.length);
    chunks.push(line.slice(cursor));
  }
  return parts;
}

/** Punctuation.is_inline(mark) */
function isInline(mark: Part | undefined): boolean {
  if (typeof mark !== 'string') return false;
  let any = false;
  for (let i = 0; i < mark.length; i++) {
    const c = mark.charCodeAt(i);
    if (isPySpace(c)) continue; // ''.join(mark.split())
    if (!INLINE_MARKS.has(c)) return false;
    any = true;
  }
  return any;
}

/** Punctuation.inline_groups(lines) */
function inlineGroups(lines: Part[][]): number[][] {
  const groups: number[][] = [];
  for (const parts of lines) {
    let group: number[] = [];
    parts.forEach((part, num) => {
      if (typeof part !== 'number') return;
      if (
        group.length > 0 &&
        num >= 2 &&
        parts[num - 2] === group[group.length - 1] &&
        isInline(parts[num - 1])
      ) {
        group.push(part);
      } else {
        if (group.length > 1) groups.push(group);
        group = [part];
      }
    });
    if (group.length > 1) groups.push(group);
  }
  return groups;
}

/** Punctuation._words(text, sep) with sep.word = ' ' */
function sepWords(text: string): string[] {
  return text.split(' ').filter((w) => w.length > 0);
}

/** Punctuation._context(text, group, phonemized, sep) with sep.word = ' ' */
function contextParts(text: string[], group: number[], phonemized: string): string[] | null {
  const counts = group.map((chunk) => sepWords(text[chunk]).length);
  const total = counts.reduce((a, b) => a + b, 0);
  if (counts.some((c) => c === 0) || sepWords(phonemized).length !== total) return null;

  const starts = new Set<number>();
  let acc = 0;
  for (let k = 0; k < counts.length - 1; k++) {
    acc += counts[k];
    starts.add(acc);
  }
  const pieces = phonemized.split(' ');
  const cuts = [0];
  let nwords = 0;
  pieces.forEach((piece, num) => {
    if (piece) {
      if (starts.has(nwords)) cuts.push(num);
      nwords++;
    }
  });
  cuts.push(pieces.length);
  const out: string[] = [];
  for (let k = 0; k + 1 < cuts.length; k++) out.push(pieces.slice(cuts[k], cuts[k + 1]).join(' '));
  return out;
}

/** Punctuation.restore(text, lines, sep, strip=False, context) with sep.word = ' ' */
function restore(text: string[], lines: Part[][], context: Array<[number[], string]>): string[] {
  const position = new Map<number, [number, number]>();
  lines.forEach((parts, num) =>
    parts.forEach((part, pos) => {
      if (typeof part === 'number') position.set(part, [num, pos]);
    }),
  );

  const inContext = new Map<number, string>();
  for (const [group, phonemized] of context) {
    const places = group.map((chunk) => position.get(chunk));
    let usable = places.every((p) => p !== undefined);
    for (let k = 0; usable && k + 1 < places.length; k++) {
      const first = places[k] as [number, number];
      const second = places[k + 1] as [number, number];
      if (
        second[0] !== first[0] ||
        second[1] !== first[1] + 2 ||
        !isInline(lines[first[0]][first[1] + 1])
      ) {
        usable = false;
      }
    }
    if (!usable) continue;
    const parts = contextParts(text, group, phonemized);
    if (parts !== null) {
      for (let k = 0; k < group.length; k++) inContext.set(group[k], parts[k]);
    }
  }

  return lines.map((line) => {
    let punctuated = '';
    let mark: string | null = null;
    for (const part of line) {
      if (typeof part === 'string') {
        // remove the last word separator before the mark; its internal spaces
        // are replaced by the word separator, a space, so the mark is unchanged
        if (punctuated.endsWith(' ')) punctuated = punctuated.slice(0, -1);
        mark = part;
        punctuated += mark;
      } else {
        const chunk = inContext.has(part) ? (inContext.get(part) as string) : text[part];
        if (chunk) {
          punctuated += chunk;
          mark = null;
        }
      }
    }
    if (mark !== null && !mark.endsWith(' ')) punctuated += ' ';
    return punctuated;
  });
}

// ---------------------------------------------------------------------------
// phonemizer EspeakBackend._postprocess_line and RemoveFlags

/** BaseLanguageSwitch._ESPEAK_FLAGS_RE = r'\(.+?\)'; Python's . is anything but \n. */
const ESPEAK_FLAGS_RE = /\([^\n]+?\)/g;

/** EspeakBackend._postprocess_line(line, num, separator, strip=False) with tie '^'. */
function postprocessLine(raw: string): string {
  let line = replaceAll(replaceAll(pyStripSpace(raw), '\n', ' '), '  ', ' ');
  if (line.indexOf('__') >= 0) line = line.replace(/_+/g, '_');
  line = replaceAll(line, '_ ', ' ');
  // RemoveFlags.process: drop the (lang) flags of espeak's language switches
  line = line.replace(ESPEAK_FLAGS_RE, '');
  if (!line) return '';
  const words = line.split(' ').map((word) => replaceAll(pyStripSpace(word), '\u0361', '^'));
  return words.join(' ') + ' ';
}

// ---------------------------------------------------------------------------
// kittenml phonemize_v2 Hindi rules

/** r\.(?=[^\s.,?!;:…]) */
const HI_R_DOT_IN_WORD = new RegExp(`r\\.(?=[^${PY_WS_CLASS}.,?!;:\\u2026])`, 'g');
/** _HI_FLAP = "[\u095c\u095d]|[\u0921\u0922]\u093c": the flaps written precomposed or with a nukta */
const HI_FLAP = /[\u095c\u095d]|[\u0921\u0922]\u093c/;

function checkPath(rel: string): void {
  if (!rel || rel[0] === '/' || rel.split('/').some((p) => p === '' || p === '.' || p === '..')) {
    throw new Error(`EspeakG2P: invalid espeak-ng-data path ${JSON.stringify(rel)}`);
  }
}

function checkLanguage(lang: string, version: PhonemizerVersion): void {
  if (version !== 'v1' && version !== 'v2') {
    throw new Error(`EspeakG2P: unknown phonemizer version ${JSON.stringify(version)}`);
  }
  if (ESPEAK_LANGS[version].indexOf(lang) < 0) {
    throw new Error(`EspeakG2P: language ${JSON.stringify(lang)} does not go through espeak in phonemizer ${version}`);
  }
}



export class EspeakG2P {
  private module: EspeakNgModule | null;
  private files = new Set<string>();
  /** The voice selected in espeak, null when it must be (re)loaded. */
  private voice: string | null = null;

  private constructor(module: EspeakNgModule) {
    this.module = module;
  }

  /**
   * Load espeak-ng. `files` must hold at least phontab, phonindex, phondata and
   * intonations; languages can come with it or later through addFiles().
   */
  static async create(files: EspeakDataFiles): Promise<EspeakG2P> {
    const missing = BASE_FILES.filter((f) => !(f in files));
    if (missing.length > 0) {
      throw new Error(`EspeakG2P: missing espeak-ng-data files ${missing.join(', ')}`);
    }
    const module = await createEspeakNgModule({
      print: () => undefined,
      printErr: () => undefined,
    });
    const g2p = new EspeakG2P(module);
    g2p.addFiles(files);
    const status = g2p.withCString(DATA_DIR, (ptr) => module._kt_espeak_initialize(ptr));
    if (status !== 0) {
      throw new Error(`EspeakG2P: espeak-ng failed to initialise (status 0x${(status >>> 0).toString(16)})`);
    }
    return g2p;
  }

  /** Write more espeak-ng-data files (for example one more language). */
  addFiles(files: EspeakDataFiles): void {
    const module = this.live();
    for (const rel of Object.keys(files)) {
      checkPath(rel);
      const path = `${DATA_DIR}/${rel}`;
      const slash = path.lastIndexOf('/');
      module.FS.mkdirTree(path.slice(0, slash));
      module.FS.writeFile(path, files[rel]);
      this.files.add(rel);
    }
    // espeak reads a voice's files when the voice is selected: select it again.
    this.voice = null;
  }

  /** The files espeakDataFilesFor(lang) lists that have not been given yet. */
  missingFiles(lang: string): string[] {
    return espeakDataFilesFor(lang).filter((f) => !this.files.has(f));
  }

  /** The espeak-ng version string ("1.52.0"). */
  get version(): string {
    const module = this.live();
    return module.UTF8ToString(module._kt_espeak_version());
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
      ps = replaceAll(ps, 'r.h', '\u027d\u02b0');
      ps = ps.replace(HI_R_DOT_IN_WORD, '\u027d');
      if (HI_FLAP.test(text)) ps = replaceAll(ps, 'r.', '\u027d');
    }
    return ps;
  }

  /** Drop espeak-ng (its heap is freed with this object). The instance cannot be used afterwards. */
  dispose(): void {
    this.module = null;
    this.files.clear();
    this.voice = null;
  }

  /** misaki EspeakG2P.__call__(text)[0] with version None. */
  private misakiEspeak(text: string, lang: string): string {
    // Angles to curly quotes, parentheses to angles
    text = replaceAll(replaceAll(text, '\u00ab', '\u201c'), '\u00bb', '\u201d');
    text = replaceAll(replaceAll(text, '(', '\u00ab'), ')', '\u00bb');
    let ps = pyStripSpace(this.backendPhonemize(text, lang));
    for (const [oldS, newS] of E2M) ps = replaceAll(ps, oldS, newS);
    // Delete any remaining tie characters, hyphens
    ps = replaceAll(ps, '^', '');
    ps = replaceAll(ps, '-', '');
    // Angles back to parentheses
    return replaceAll(replaceAll(ps, '\u00ab', '('), '\u00bb', ')');
  }

  /** EspeakBackend.phonemize([text]) (BaseBackend.phonemize with njobs=1, strip=False). */
  private backendPhonemize(text: string, lang: string): string {
    this.selectVoice(lang);
    // _phonemize_preprocess: Punctuation.preserve
    const chunks: string[] = [];
    const lines = [preserve(text, chunks)];
    // the chunks separated by inline marks only, phonemized as a whole as well
    const groups = inlineGroups(lines);
    const all = chunks.concat(groups.map((group) => group.map((chunk) => chunks[chunk]).join(' ')));
    // _phonemize_aux
    const phonemized = all.map((line) => postprocessLine(this.textToPhonemes(line)));
    // _split_context
    const nchunks = phonemized.length - groups.length;
    const context = groups.map((group, k): [number[], string] => [group, phonemized[nchunks + k]]);
    // _phonemize_postprocess: Punctuation.restore
    return restore(phonemized.slice(0, nchunks), lines, context)[0];
  }

  private selectVoice(lang: string): void {
    const voice = espeakVoiceFor(lang)!;
    if (this.voice === voice) return;
    const missing = this.missingFiles(lang);
    if (missing.length > 0) {
      throw new Error(`EspeakG2P: missing espeak-ng-data files ${missing.join(', ')}`);
    }
    const module = this.live();
    const status = this.withCString(voice, (ptr) => module._kt_espeak_set_voice(ptr));
    if (status !== 0) throw new Error(`EspeakG2P: espeak-ng failed to load voice ${voice}`);
    this.voice = voice;
  }

  /** EspeakWrapper.text_to_phonemes(text, tie) */
  private textToPhonemes(text: string): string {
    const module = this.live();
    return this.withCString(text, (ptr) => {
      const out = module._kt_espeak_text_to_phonemes(ptr, PHONEME_MODE);
      if (!out) throw new Error('EspeakG2P: espeak-ng ran out of memory');
      return module.UTF8ToString(out);
    });
  }

  private withCString<T>(s: string, fn: (ptr: number) => T): T {
    const module = this.live();
    const size = module.lengthBytesUTF8(s) + 1;
    const ptr = module._malloc(size);
    if (!ptr) throw new Error('EspeakG2P: espeak-ng ran out of memory');
    try {
      module.stringToUTF8(s, ptr, size);
      return fn(ptr);
    } finally {
      module._free(ptr);
    }
  }

  private live(): EspeakNgModule {
    if (this.module === null) throw new Error('EspeakG2P: used after dispose()');
    return this.module;
  }
}
