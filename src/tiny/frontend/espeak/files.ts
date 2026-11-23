// Which espeak-ng-data files each language needs, apart from the espeak-ng runtime
// (generated/espeakng.js, GPL-3.0-or-later), so listing a language's downloads does not
// load the runtime.

/** Read by espeak_Initialize; needed by every language. */
const BASE_FILES = ['phontab', 'phonindex', 'phondata', 'intonations'];

/**
 * Per language: the voice code phonemize_vN.ESPEAK_VOICE gives it (in the comment),
 * the voice file phonemizer's EspeakWrapper.set_voice(code) selects with the full
 * espeak-ng 1.52.0 data (the first non-mbrola voice espeak_ListVoices lists for the
 * code), and the dictionary that voice loads.
 */
const VOICES: Record<string, { voice: string; dict: string }> = {
  de: { voice: 'gmw/de', dict: 'de_dict' },       // de
  es: { voice: 'roa/es', dict: 'es_dict' },       // es
  it: { voice: 'roa/it', dict: 'it_dict' },       // it
  pt: { voice: 'roa/pt-BR', dict: 'pt_dict' },    // pt-br
  ru: { voice: 'zle/ru', dict: 'ru_dict' },       // ru
  hi: { voice: 'inc/hi', dict: 'hi_dict' },       // hi
  fr: { voice: 'roa/fr', dict: 'fr_dict' },       // fr-fr
  da: { voice: 'gmq/da', dict: 'da_dict' },       // da
  fi: { voice: 'urj/fi', dict: 'fi_dict' },       // fi
  nl: { voice: 'gmw/nl', dict: 'nl_dict' },       // nl
  sv: { voice: 'gmq/sv', dict: 'sv_dict' },       // sv
  sw: { voice: 'bnt/sw', dict: 'sw_dict' },       // sw
  tr: { voice: 'trk/tr', dict: 'tr_dict' },       // tr
  ko: { voice: 'ko', dict: 'ko_dict' },           // ko
};

/**
 * Dictionaries of other languages that every language gets. espeak reads a
 * word with another language's translator, and so opens that language's
 * dictionary, when its own dictionary marks the word as English (en_dict;
 * Latin script in hi / ru / ko text too) or when the word is in a script
 * espeak ties to a language: Greek (el_dict), and also Devanagari (hi_dict),
 * Hangul (ko_dict), Armenian, Georgian, Bengali, Gurmukhi, Gujarati, Tamil,
 * Telugu, Kannada, Malayalam and Sinhala; plus Cyrillic in it (ru_dict) and
 * ß in pt (de_dict). Only en and el are included: give the others with
 * addFiles() to match Python on such mixed-script text too (without them
 * espeak reads those words differently, it does not fail).
 */
const SHARED_DICTS = ['en_dict', 'el_dict'];

/**
 * The espeak-ng-data files (paths relative to espeak-ng-data/) one language
 * needs, base files included. Measured by tracing every file espeak-ng opens;
 * see SHARED_DICTS for the dictionaries of other languages.
 */
export function espeakDataFilesFor(lang: string): string[] {
  const v = VOICES[lang];
  if (v === undefined) throw new Error(`EspeakG2P: no espeak voice for language ${JSON.stringify(lang)}`);
  return [...BASE_FILES, `lang/${v.voice}`, v.dict, ...SHARED_DICTS];
}

/** The espeak voice file a language uses, such as 'gmw/de'. */
export function espeakVoiceFor(lang: string): string | undefined {
  return VOICES[lang]?.voice;
}

export { BASE_FILES };
