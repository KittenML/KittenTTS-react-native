import * as RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import {
  KittenTTSError,
  errorMessage,
  isKittenTTSError,
} from '../KittenTTSError';
import type { KittenTTSAnalyticsPlaybackHelper } from '../analytics/Analytics';
import { uint8ArrayToBase64 } from './Base64';
import { WAVEncoder } from './WAVEncoder';

/** Audio player interface that users can provide. */
export interface AudioPlayer {
  /** Internal analytics label. Custom players do not need to set this. */
  kittenTTSPlaybackHelper?: KittenTTSAnalyticsPlaybackHelper;
  /** Play a WAV file at the given path. Resolves when playback finishes. */
  playFile(filePath: string, onPlaybackStart?: () => void): Promise<void>;
  /** Stop current playback. */
  stop(): Promise<void>;
}

export interface AudioPlayOptions {
  /** Called after the configured player has started playback. */
  onPlaybackStart?: () => void;
}

interface ExpoAudioStatus {
  currentTime?: number;
  didJustFinish?: boolean;
  mediaServicesDidReset?: boolean;
  playing?: boolean;
}

interface ExpoAudioSubscription {
  remove(): void;
}

interface ExpoAudioPlayerInstance {
  play(): void;
  pause(): void;
  remove(): void;
  addListener(
    eventName: 'playbackStatusUpdate',
    listener: (status: ExpoAudioStatus) => void,
  ): ExpoAudioSubscription;
}

interface ExpoAudioModule {
  setAudioModeAsync?(mode: { playsInSilentMode?: boolean }): Promise<unknown>;
  createAudioPlayer(
    source: { uri: string },
    options?: { updateInterval?: number; keepAudioSessionActive?: boolean },
  ): ExpoAudioPlayerInstance;
}

interface RNSoundInstance {
  play(callback: (success: boolean) => void): void;
  stop(): void;
  release(): void;
}

interface RNSoundConstructor {
  new(filePath: string, basePath: string, callback: (error: Error | null) => void): RNSoundInstance;
  setCategory?(category: string): void;
}

/**
 * Built-in audio output that writes WAV to a temp file and plays it
 * using a user-provided {@link AudioPlayer}.
 *
 * If no player is provided, `speak()` fails with a configuration error.
 */
export class AudioOutput {
  private player: AudioPlayer | null;
  private playing = false;
  private playSequence = 0;

  constructor(player?: AudioPlayer) {
    this.player = player ?? null;
  }

  getPlaybackHelper(): KittenTTSAnalyticsPlaybackHelper {
    if (!this.player) return 'none';
    return this.player.kittenTTSPlaybackHelper ?? 'custom';
  }

  async play(
    samples: Float32Array,
    sampleRate: number,
    options: AudioPlayOptions = {},
  ): Promise<void> {
    if (!this.player) {
      throw KittenTTSError.playbackFailed(
        'No audio player configured. Pass an AudioPlayer to KittenTTS.create(), ' +
        'or use the built-in createExpoAudioPlayer() or createRNSoundPlayer() helpers.',
      );
    }

    await this.stop();

    const playId = ++this.playSequence;
    this.playing = true;
    const wavData = WAVEncoder.encode(samples, sampleRate);
    const tempPath =
      `${RNFS.CachesDirectoryPath}/kitten_tts_playback_${Date.now()}_${playId}.wav`;
    const base64 = uint8ArrayToBase64(wavData);

    try {
      await RNFS.writeFile(tempPath, base64, 'base64');
      if (this.playSequence !== playId) {
        return;
      }
      await this.player.playFile(tempPath, options.onPlaybackStart);
    } catch (error) {
      if (isKittenTTSError(error)) throw error;
      throw KittenTTSError.playbackFailed(errorMessage(error), error);
    } finally {
      if (this.playSequence === playId) {
        this.playing = false;
      }
      await RNFS.unlink(tempPath).catch(() => {});
    }
  }

  async stop(): Promise<void> {
    this.playSequence += 1;
    if (this.player && this.playing) {
      try {
        await this.player.stop();
      } catch (error) {
        throw KittenTTSError.playbackFailed(errorMessage(error), error);
      } finally {
        this.playing = false;
      }
    }
    this.playing = false;
  }
}

// ---------------------------------------------------------------------------
// Built-in player factories
// ---------------------------------------------------------------------------

/**
 * Create an AudioPlayer using `expo-audio`.
 * Call this and pass the result to `KittenTTS.create()`.
 *
 * @example
 * ```typescript
 * import * as ExpoAudio from 'expo-audio';
 * import { KittenTTS, createExpoAudioPlayer } from '@kittentts/react-native';
 *
 * const tts = await KittenTTS.create({ player: createExpoAudioPlayer(ExpoAudio) });
 * ```
 */
export function createExpoAudioPlayer(Audio: ExpoAudioModule): AudioPlayer {
  type PlaybackState = {
    player: ExpoAudioPlayerInstance;
    subscription: ExpoAudioSubscription | null;
    resolve: (() => void) | null;
    reject: ((error: Error) => void) | null;
    settled: boolean;
    started: boolean;
  };

  let current: PlaybackState | null = null;

  const finish = (state: PlaybackState, error?: Error) => {
    if (state.settled) return;
    state.settled = true;
    try {
      state.subscription?.remove();
    } catch { /* non-fatal */ }
    state.subscription = null;
    try {
      state.player.remove();
    } catch { /* non-fatal */ }
    if (current === state) current = null;

    if (error) {
      state.reject?.(error);
    } else {
      state.resolve?.();
    }
  };

  const stopCurrent = () => {
    const state = current;
    if (!state) return;
    try {
      state.player.pause();
    } catch { /* non-fatal */ }
    finish(state);
  };

  return {
    kittenTTSPlaybackHelper: 'expo-audio',
    async playFile(
      filePath: string,
      onPlaybackStart?: () => void,
    ): Promise<void> {
      stopCurrent();

      if (Platform.OS === 'ios') {
        try {
          await Audio.setAudioModeAsync?.({ playsInSilentMode: true });
        } catch { /* non-fatal */ }
      }

      const player = Audio.createAudioPlayer(
        { uri: `file://${filePath}` },
        { updateInterval: 100, keepAudioSessionActive: false },
      );

      return new Promise<void>((resolve, reject) => {
        const state: PlaybackState = {
          player,
          subscription: null,
          resolve,
          reject,
          settled: false,
          started: false,
        };
        current = state;

        state.subscription = player.addListener('playbackStatusUpdate', (status) => {
          if (!state.started && status.playing) {
            state.started = true;
            onPlaybackStart?.();
          }
          if (status.mediaServicesDidReset) {
            finish(state, KittenTTSError.playbackFailed('iOS media services were reset'));
            return;
          }
          if (status.didJustFinish) {
            finish(state);
          }
        });

        try {
          player.play();
        } catch (error) {
          finish(
            state,
            KittenTTSError.playbackFailed(error instanceof Error ? error.message : String(error)),
          );
        }
      });
    },
    async stop(): Promise<void> {
      stopCurrent();
    },
  };
}

/**
 * Create an AudioPlayer using `react-native-sound`.
 * Call this and pass the result to `KittenTTS.create()`.
 *
 * @example
 * ```typescript
 * import Sound from 'react-native-sound';
 * import { KittenTTS, createRNSoundPlayer } from '@kittentts/react-native';
 *
 * const tts = await KittenTTS.create({ player: createRNSoundPlayer(Sound) });
 * ```
 */
export function createRNSoundPlayer(Sound: RNSoundConstructor): AudioPlayer {
  let currentSound: RNSoundInstance | null = null;

  // Required on iOS
  if (Platform.OS === 'ios' && Sound.setCategory) {
    Sound.setCategory('Playback');
  }

  return {
    kittenTTSPlaybackHelper: 'react-native-sound',
    async playFile(
      filePath: string,
      onPlaybackStart?: () => void,
    ): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const sound = new Sound(filePath, '', (error: Error | null) => {
          if (error) {
            reject(KittenTTSError.playbackFailed(error.message));
            return;
          }
          currentSound = sound;
          sound.play((success: boolean) => {
            sound.release();
            currentSound = null;
            if (success) {
              resolve();
            } else {
              reject(KittenTTSError.playbackFailed('Playback ended early'));
            }
          });
          onPlaybackStart?.();
        });
      });
    },
    async stop(): Promise<void> {
      if (currentSound) {
        currentSound.stop();
        currentSound.release();
        currentSound = null;
      }
    },
  };
}
