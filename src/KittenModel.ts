import { KittenVoice } from './KittenVoice';

/**
 * Available KittenTTS model variants.
 *
 * Each variant trades off size, speed, and quality. All models produce
 * 24 kHz mono audio output.
 */
export enum KittenModel {
  /** The fp32 nano model (~56 MB, 15M parameters). Smallest and fastest. */
  Nano = 'kitten-tts-nano-0.8',
  /** The int8-quantised nano model (~25 MB, 15M parameters). Half the size of Nano. */
  NanoInt8 = 'kitten-tts-nano-0.8-int8',
  /** The micro model (~41 MB, 40M parameters). Higher quality than nano. */
  Micro = 'kitten-tts-micro-0.8',
  /** The mini model (~80 MB, 80M parameters). Highest quality available. */
  Mini = 'kitten-tts-mini-0.8',
}

/** Hugging Face repository ID for the given model. */
export function huggingFaceRepo(model: KittenModel): string {
  return `KittenML/${model}`;
}

/** Base URL for direct file downloads from Hugging Face. */
export function huggingFaceBaseURL(model: KittenModel): string {
  return `https://huggingface.co/${huggingFaceRepo(model)}/resolve/main`;
}

/** ONNX model filename within the HuggingFace repository. */
export function onnxFileName(model: KittenModel): string {
  switch (model) {
    case KittenModel.Nano:
    case KittenModel.NanoInt8:
      return 'kitten_tts_nano_v0_8.onnx';
    case KittenModel.Micro:
      return 'kitten_tts_micro_v0_8.onnx';
    case KittenModel.Mini:
      return 'kitten_tts_mini_v0_8.onnx';
  }
}

/** Voice embeddings archive filename. */
export function voicesFileName(_model: KittenModel): string {
  return 'voices.npz';
}

/** Approximate total download size in bytes. */
export function approximateDownloadBytes(model: KittenModel): number {
  switch (model) {
    case KittenModel.Nano:
      return 59_000_000;
    case KittenModel.NanoInt8:
      return 28_000_000;
    case KittenModel.Micro:
      return 44_000_000;
    case KittenModel.Mini:
      return 83_000_000;
  }
}

/** Hardcoded per-voice speed multiplier matching the upstream model settings. */
export function speedPrior(model: KittenModel, voice: KittenVoice): number {
  switch (model) {
    case KittenModel.Nano:
    case KittenModel.NanoInt8:
      return voice === KittenVoice.Hugo ? 0.9 : 0.8;
    case KittenModel.Micro:
    case KittenModel.Mini:
      return 1.0;
  }
}

/** Human-readable display name. */
export function modelDisplayName(model: KittenModel): string {
  switch (model) {
    case KittenModel.Nano:
      return 'Nano (fp32)';
    case KittenModel.NanoInt8:
      return 'Nano (int8)';
    case KittenModel.Micro:
      return 'Micro';
    case KittenModel.Mini:
      return 'Mini';
  }
}
