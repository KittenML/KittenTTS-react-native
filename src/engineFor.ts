import { isKittenTTS2Model } from './api/KittenTTS2Base';
import { isTinyModel } from './tiny/TinyRepo';

/**
 * Which engine `KittenTTS.create()` builds, picked from the model as the Python
 * package does: Kitten TTS 2 Nano, Pico and Mini run on the device unless an API
 * key or base URL sends them to the Kitten API; other Kitten TTS 2 models run only
 * there; everything else is a 0.8 model on the device.
 */
export function engineFor(
  options: { model?: unknown; apiKey?: unknown; baseUrl?: unknown } | undefined,
): 'tiny' | 'api' | 'onnx' {
  const cloud = options?.apiKey !== undefined || options?.baseUrl !== undefined;
  if (isTinyModel(options?.model)) return cloud ? 'api' : 'tiny';
  if (isKittenTTS2Model(options?.model)) return 'api';
  return 'onnx';
}
