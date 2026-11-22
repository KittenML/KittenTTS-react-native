// Builds the English front end from its files: the text pack written by
// tools/kitten-tts-2-tiny/export_english.py (en/...) and the model repository's g2p/
// folder (CMUdict lexicon and BART), both read through the caller's asset reader.

import type { OrtLike } from '../../ort';
import { BartG2P, parseSafetensors } from './Bart';
import type { BartConfig } from './Bart';
import { EnglishG2P } from './EnglishG2P';
import type { Lexicon } from './Misaki';
import { SpacyTagger } from './SpacyTagger';
import type { SpacyTaggerMeta } from './SpacyTagger';
import { SpacyTokenizer } from './SpacyTokenizer';
import type { SpacyTokenizerData } from './SpacyTokenizer';

export interface AssetReader {
  text(name: string): Promise<string>;
  bytes(name: string): Promise<Uint8Array>;
  /** A local file ONNX Runtime can open itself (faster than handing it bytes on device). */
  filePath?(name: string): Promise<string | undefined>;
}

/** From the text data (textDataURL). */
export const ENGLISH_TEXT_FILES = [
  'en/spacy-tokenizer.json',
  'en/spacy-tagger.json',
  'en/spacy-tagger.onnx',
  'en/misaki-us-gold.json',
  'en/misaki-us-silver.json',
  'en/cmu_misaki_us.json',
] as const;

/** From the model repository's g2p/ folder. */
export const ENGLISH_G2P_FILES = [
  'g2p/g2p_bart_en_us/config.json',
  'g2p/g2p_bart_en_us/model.safetensors',
] as const;

export async function loadEnglishG2P(
  reader: AssetReader,
  ort: OrtLike,
  vocab: ReadonlySet<string>,
): Promise<EnglishG2P> {
  const json = async <T>(name: string): Promise<T> => JSON.parse(await reader.text(name)) as T;
  const [tokenizerData, taggerMeta, golds, silvers, cmu, bartConfig, bartBytes] = await Promise.all([
    json<SpacyTokenizerData>('en/spacy-tokenizer.json'),
    json<SpacyTaggerMeta>('en/spacy-tagger.json'),
    json<Lexicon>('en/misaki-us-gold.json'),
    json<Lexicon>('en/misaki-us-silver.json'),
    json<Record<string, string>>('en/cmu_misaki_us.json'),
    json<BartConfig>('g2p/g2p_bart_en_us/config.json'),
    reader.bytes('g2p/g2p_bart_en_us/model.safetensors'),
  ]);
  const taggerModel = (await reader.filePath?.('en/spacy-tagger.onnx')) ?? (await reader.bytes('en/spacy-tagger.onnx'));
  const tagger = await SpacyTagger.create(ort, taggerMeta, taggerModel);
  const g2p = new EnglishG2P(
    {
      golds,
      silvers,
      cmu,
      bart: new BartG2P(bartConfig, parseSafetensors(bartBytes)),
      tokenizer: new SpacyTokenizer(tokenizerData),
      tagger,
    },
    vocab,
  );
  // One sentence through every stage compiles the tokenizer's patterns and runs the
  // tagger once, so the first real sentence doesn't pay for it.
  await g2p.phonemize('Hello there, 2 friends.');
  return g2p;
}
