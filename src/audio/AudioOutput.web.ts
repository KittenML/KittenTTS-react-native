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
  let current: HTMLAudioElement | null = null;
  let currentUrl: string | null = null;

  const cleanup = () => {
    if (currentUrl) URL.revokeObjectURL(currentUrl);
    currentUrl = null;
    current = null;
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
      current = audio;
      currentUrl = url;

      return new Promise<void>((resolve, reject) => {
        let started = false;
        audio.onplaying = () => {
          if (started) return;
          started = true;
          options.onPlaybackStart?.();
        };
        audio.onended = () => {
          cleanup();
          resolve();
        };
        audio.onerror = () => {
          const error = new Error('Browser audio playback failed.');
          cleanup();
          reject(error);
        };
        audio.play().catch((error: unknown) => {
          cleanup();
          reject(error);
        });
      });
    },

    async stop(): Promise<void> {
      const audio = current;
      if (audio) {
        audio.pause();
        audio.currentTime = 0;
      }
      cleanup();
    },
  };
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
