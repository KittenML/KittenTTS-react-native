// React Native: files under <DocumentDirectory>/KittenTTS via react-native-fs, and
// onnxruntime-react-native.

import * as RNFS from 'react-native-fs';
import { KittenTTSError, errorMessage } from '../KittenTTSError';
import { base64ToUint8Array } from '../audio/Base64';
import type { ProgressHandler } from '../loader/ModelDownloader';
import type { OrtLike } from './ort';
import type { AssetRequest, TinyAssetStore } from './assets';
import { aggregateProgress, inBatches } from './assets';

export interface TinyPlatformOptions {
  storageDirectory?: string;
  downloadRetries?: number;
}

export interface TinyPlatform {
  ort: OrtLike;
  store: TinyAssetStore;
}

const RETRY_DELAY_MS = 750;

class RNFSAssetStore implements TinyAssetStore {
  constructor(private readonly root: string, private readonly retries: number) {}

  path(key: string): string {
    return `${this.root}/${key}`;
  }

  has(key: string): Promise<boolean> {
    return RNFS.exists(this.path(key));
  }

  async ensure(files: readonly AssetRequest[], onProgress?: ProgressHandler): Promise<void> {
    const missing: AssetRequest[] = [];
    for (const f of files) if (!(await this.has(f.key))) missing.push(f);
    const progress = aggregateProgress(onProgress);
    await inBatches(missing, 4, f => this.download(f, progress));
  }

  private async download(f: AssetRequest, progress: (key: string, w: number, t: number) => void): Promise<void> {
    const target = this.path(f.key);
    const temp = `${target}.download`;
    await RNFS.mkdir(target.slice(0, target.lastIndexOf('/')));
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        await RNFS.unlink(temp).catch(() => {});
        const job = RNFS.downloadFile({
          fromUrl: f.url,
          toFile: temp,
          progressDivider: 1,
          connectionTimeout: 30_000,
          readTimeout: 30_000,
          backgroundTimeout: 10 * 60_000,
          progress: e => { if (e.contentLength > 0) progress(f.key, e.bytesWritten, e.contentLength); },
        });
        const res = await job.promise;
        if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} downloading ${f.url}`);
        await RNFS.moveFile(temp, target);
        return;
      } catch (error) {
        lastError = error;
        await RNFS.unlink(temp).catch(() => {});
        if (attempt < this.retries) await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
    throw KittenTTSError.downloadFailed(`Failed after ${this.retries} attempts: ${errorMessage(lastError)}`, lastError);
  }

  text(key: string): Promise<string> {
    return RNFS.readFile(this.path(key), 'utf8');
  }

  async bytes(key: string): Promise<Uint8Array> {
    return base64ToUint8Array(await RNFS.readFile(this.path(key), 'base64'));
  }

  async clear(prefix: string): Promise<void> {
    await RNFS.unlink(this.path(prefix)).catch(() => {});
  }
}

export async function defaultTinyPlatform(options: TinyPlatformOptions = {}): Promise<TinyPlatform> {
  const ort = (await import('onnxruntime-react-native')) as unknown as OrtLike;
  const root = options.storageDirectory ?? `${RNFS.DocumentDirectoryPath}/KittenTTS`;
  return { ort, store: new RNFSAssetStore(root, Math.max(1, options.downloadRetries ?? 4)) };
}
