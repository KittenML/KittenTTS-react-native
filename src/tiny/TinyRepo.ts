// A Kitten TTS 2 nano / pico / mini repository: its config.json and which files serve
// which language (kittenml/kittentts2_tiny/model.py).

export type KittenTinyWeights = 'int8' | 'int4';

/** The Kitten TTS 2 small models, by Hugging Face repository. */
export const KITTEN_TTS_2_TINY_MODELS = {
  'kitten-tts-2-nano': 'KittenML/kitten-tts-2-nano',
  'kitten-tts-2-pico': 'KittenML/kitten-tts-2-pico',
  'kitten-tts-2-mini': 'KittenML/kitten-tts-2-mini',
} as const;

export type KittenTinyModel = keyof typeof KITTEN_TTS_2_TINY_MODELS
  | (typeof KITTEN_TTS_2_TINY_MODELS)[keyof typeof KITTEN_TTS_2_TINY_MODELS];

export interface TinyVoice {
  key: string;
  name: string;
  description?: string;
  [extra: string]: unknown;
}

interface TinyLanguageEntry {
  model_file: string;
  model_files?: Partial<Record<KittenTinyWeights, string>>;
  voices: string;
}

export interface TinyRepoConfig {
  name?: string;
  type: string;
  sample_rate?: number;
  phonemizer?: 'v1' | 'v2';
  vocab?: string;
  g2p_dir?: string;
  default_language?: string;
  default_weights?: KittenTinyWeights;
  languages: Record<string, TinyLanguageEntry>;
  voices: Record<string, TinyVoice[]>;
}

/** The repository id for a model name ("kitten-tts-2-nano" or "KittenML/kitten-tts-2-nano"). */
export function tinyRepoId(model: string): string | null {
  if ((Object.values(KITTEN_TTS_2_TINY_MODELS) as string[]).includes(model)) return model;
  return (KITTEN_TTS_2_TINY_MODELS as Record<string, string>)[model] ?? null;
}

export function isTinyModel(model: unknown): model is KittenTinyModel {
  return typeof model === 'string' && tinyRepoId(model) !== null;
}

export function huggingFaceResolveURL(repoId: string): string {
  return `https://huggingface.co/${repoId}/resolve/main`;
}

/** {weight format: ONNX file} of one language. */
export function modelFiles(entry: TinyLanguageEntry): Partial<Record<KittenTinyWeights, string>> {
  return entry.model_files ?? { int8: entry.model_file };
}

/** The ONNX weight formats every language has. */
export function onnxWeights(config: TinyRepoConfig): KittenTinyWeights[] {
  const perLang = Object.values(config.languages).map(modelFiles);
  return (Object.keys(perLang[0] ?? {}) as KittenTinyWeights[]).filter(w => perLang.every(f => w in f));
}
