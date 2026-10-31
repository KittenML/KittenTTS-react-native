import * as RNFS from 'react-native-fs';
import { AudioOutput, type AudioPlayer } from './audio/AudioOutput';
import { base64ToUint8Array } from './audio/Base64';
import { KittenTTS2Base, type KittenTTS2Options } from './api/KittenTTS2Base';

/** Options for `KittenTTS.create({ model: 'kitten-tts-2', ... })`. */
export interface KittenTTS2CreateOptions extends KittenTTS2Options {
  /**
   * Audio player for `speak()` and `play()`. Use {@link createExpoAudioPlayer}
   * or {@link createRNSoundPlayer}, or provide your own implementation.
   */
  player?: AudioPlayer;
}

/**
 * Kitten TTS 2 through the Kitten API: the model runs on KittenML's servers,
 * so nothing is downloaded to the device, and the text you pass is sent to
 * the API. It has the same calls as an on-device `KittenTTS`, plus voice
 * cloning, presets and the decoding controls.
 *
 * @example
 * ```typescript
 * import * as ExpoAudio from 'expo-audio';
 * import { KittenTTS, createExpoAudioPlayer } from '@kittentts/react-native';
 *
 * const tts = await KittenTTS.create({
 *   model: 'kitten-tts-2',
 *   apiKey: KITTENML_API_KEY,
 *   player: createExpoAudioPlayer(ExpoAudio),
 * });
 *
 * await tts.speak('Hi! How are you?', 'bella_en');
 * const cloned = await tts.generate('Hello.', { reference: recordingUri });
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

/** Recorders and pickers hand out URIs; react-native-fs takes paths, and content:// on Android. */
async function readFile(uri: string): Promise<Uint8Array> {
  let path = uri;
  if (uri.startsWith('file://')) {
    path = uri.slice('file://'.length);
    try {
      path = decodeURIComponent(path);
    } catch {
      // A literal "%" that is not an escape: the path is already plain.
    }
  }
  return base64ToUint8Array(await RNFS.readFile(path, 'base64'));
}
