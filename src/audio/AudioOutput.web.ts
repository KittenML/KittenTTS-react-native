import {
  KittenTTSError,
  errorMessage,
  isKittenTTSError,
} from '../KittenTTSError';
import { WAVEncoder } from './WAVEncoder';

export interface AudioPlayOptions {
  /** Called after the configured player has started playback. */
  onPlaybackStart?: () => void;
}

/** Audio player interface that users can provide. */
export interface AudioPlayer {
  /** Play generated PCM samples. Resolves when playback finishes. */
  play(
    samples: Float32Array,
    sampleRate: number,
    options?: AudioPlayOptions,
  ): Promise<void>;
  /** Stop current playback. */
  stop(): Promise<void>;
}

export class AudioOutput {
  private player: AudioPlayer | null;
  private playing = false;

  constructor(player?: AudioPlayer) {
    this.player = player ?? null;
  }

  async play(
    samples: Float32Array,
    sampleRate: number,
    options: AudioPlayOptions = {},
  ): Promise<void> {
    if (!this.player) {
      throw KittenTTSError.playbackFailed(
        'No audio player configured. Pass an AudioPlayer to KittenTTS.create(), ' +
        'or use createBrowserAudioPlayer() in browser apps.',
      );
    }

    await this.stop();
    this.playing = true;
    try {
      await this.player.play(samples, sampleRate, options);
    } catch (error) {
      if (isKittenTTSError(error)) throw error;
      throw KittenTTSError.playbackFailed(errorMessage(error), error);
    } finally {
      this.playing = false;
    }
  }

  async stop(): Promise<void> {
    if (this.player && this.playing) {
      try {
        await this.player.stop();
      } catch (error) {
        throw KittenTTSError.playbackFailed(errorMessage(error), error);
      }
    }
    this.playing = false;
  }
}

export function createBrowserAudioPlayer(): AudioPlayer {
  // The clip playing now. stop() ends its play() call too, so speak() returns.
  let current: { audio: HTMLAudioElement; url: string; done: () => void } | null = null;

  const end = () => {
    const playing = current;
    current = null;
    if (!playing) return;
    URL.revokeObjectURL(playing.url);
    playing.done();
  };

  return {
    async play(
      samples: Float32Array,
      sampleRate: number,
      options: AudioPlayOptions = {},
    ): Promise<void> {
      await this.stop();
      const wav = WAVEncoder.encode(samples, sampleRate);
      const blob = new Blob([toArrayBuffer(wav) as any], { type: 'audio/wav' } as any);
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);

      return new Promise<void>((resolve, reject) => {
        const entry = { audio, url, done: resolve };
        current = entry;
        let started = false;
        const fail = (error: unknown) => {
          if (current !== entry) return; // stopped: play() already returned
          current = null;
          URL.revokeObjectURL(url);
          reject(error);
        };
        audio.onplaying = () => {
          if (started) return;
          started = true;
          options.onPlaybackStart?.();
        };
        audio.onended = () => {
          if (current === entry) end();
        };
        audio.onerror = () => fail(new Error('Browser audio playback failed.'));
        audio.play().catch(fail);
      });
    },

    async stop(): Promise<void> {
      if (current) {
        current.audio.pause();
        current.audio.currentTime = 0;
      }
      end();
    },
  };
}

/**
 * Compatibility helper for Expo web builds.
 *
 * Native builds use the `expo-audio` implementation. Web builds play the
 * generated WAV through an HTML audio element, so the Expo module argument is
 * accepted for shared app code but is not needed.
 */
export function createExpoAudioPlayer(_Audio?: unknown): AudioPlayer {
  return createBrowserAudioPlayer();
}

/**
 * Compatibility helper for shared imports in web builds.
 *
 * React Native Sound is native-only; web builds use browser audio playback.
 */
export function createRNSoundPlayer(_Sound?: unknown): AudioPlayer {
  return createBrowserAudioPlayer();
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
