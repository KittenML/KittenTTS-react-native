import { AudioOutput, type AudioPlayer } from './audio/AudioOutput.web';
import { KittenTTS2Base, type KittenTTS2Options } from './api/KittenTTS2Base';

/** Options for `KittenTTS.create({ model: 'kitten-tts-2', ... })`. */
export interface KittenTTS2CreateOptions extends KittenTTS2Options {
  /** Audio player for `speak()` and `play()`, such as {@link createBrowserAudioPlayer}. */
  player?: AudioPlayer;
}

/**
 * Kitten TTS 2 through the Kitten API: the model runs on KittenML's servers,
 * and the text you pass is sent to the API. It has the same calls as an
 * on-device `KittenTTS`, plus voice cloning, presets and the decoding controls.
 *
 * In a browser, keep the API key off the page: point `baseUrl` at your own
 * backend, which adds the key.
 *
 * @example
 * ```typescript
 * import { KittenTTS, createBrowserAudioPlayer } from '@kittentts/react-native';
 *
 * const tts = await KittenTTS.create({
 *   model: 'kitten-tts-2',
 *   baseUrl: 'https://your-backend.example/kitten',
 *   player: createBrowserAudioPlayer(),
 * });
 *
 * await tts.speak('Hi! How are you?', 'bella_en');
 * ```
 */
export class KittenTTS2 extends KittenTTS2Base {
  /** Connect to the Kitten API and list the available voices. */
  static async create(options: KittenTTS2CreateOptions): Promise<KittenTTS2> {
    const state = await KittenTTS2Base.connect(options, {
      audioOutput: new AudioOutput(options?.player),
      readFile,
    });
    return new KittenTTS2(state);
  }
}

/** In a browser a reference URI is a `blob:`, `data:` or http(s) URL. */
async function readFile(uri: string): Promise<Uint8Array> {
  const response = await fetch(uri);
  if (!response.ok) throw new Error(`status ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
