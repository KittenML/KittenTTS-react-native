// Where the Kitten TTS 2 nano / pico / mini files come from and where they are kept.
// A store downloads what is missing and reads files back; platform.ts / platform.web.ts
// provide one for React Native (react-native-fs) and for the web and Node (fetch).

import pako from 'pako';
import { KittenTTSError, errorMessage } from '../KittenTTSError';
import type { ProgressHandler } from '../loader/ModelDownloader';
import type { OrtLike } from './ort';
import { utf8Decode } from './utf8';

export interface AssetRequest {
  /** Cache key, a relative path such as "kitten-tts-2-nano/config.json". */
  key: string;
  url: string;
  /** The URL serves the file gzipped: unpack it once, after the download. */
  gzip?: boolean;
  /** Expected size of the (unpacked) file, checked after the download. */
  size?: number;
  /** Extra request headers (a Hugging Face token). */
  headers?: Record<string, string>;
}

/** Files to read: the download cache, or a folder the app provides. */
export interface TinyFileSource {
  /** Make sure these files are there, downloading the missing ones. */
  ensure(files: readonly AssetRequest[], onProgress?: ProgressHandler): Promise<void>;
  text(key: string): Promise<string>;
  bytes(key: string): Promise<Uint8Array>;
  /** A local path ONNX Runtime can open itself, when the file is on disk unpacked. */
  filePath(key: string): Promise<string | undefined>;
  /** Delete one cached file. */
  clear(key: string): Promise<void>;
}

export interface TinyAssetStore extends TinyFileSource {
  /** A read-only source over a folder the app provides (no downloads). */
  local(directory: string): TinyFileSource;
  /** Write a file (generateToFile). */
  writeFile(path: string, data: Uint8Array): Promise<void>;
}

/** ONNX Runtime and a file store: what the engine needs from the platform. */
export interface TinyPlatform {
  ort: OrtLike;
  store: TinyAssetStore;
}

export interface TinyPlatformOptions {
  storageDirectory?: string;
  downloadRetries?: number;
}

const PARALLEL_DOWNLOADS = 4;
const RETRY_DELAY_MS = 750;

/**
 * Downloads the missing files for a store, 4 at a time, each tried `retries` times. A file
 * asked for again while it downloads (every espeak language needs the same base files) is
 * fetched once.
 */
export class Downloader {
  private readonly inFlight = new Map<string, Promise<void>>();

  constructor(
    private readonly retries: number,
    private readonly exists: (key: string) => Promise<boolean>,
    /** Fetch one file into the store, reporting (bytes so far, total bytes) as it goes. */
    private readonly fetchOne: (file: AssetRequest, progress: (written: number, total: number) => void) => Promise<void>,
  ) {}

  async ensure(files: readonly AssetRequest[], onProgress?: ProgressHandler): Promise<void> {
    const unique = Array.from(new Map(files.map(f => [f.key, f])).values());
    const missing: AssetRequest[] = [];
    for (const f of unique) if (this.inFlight.has(f.key) || !(await this.exists(f.key))) missing.push(f);
    // Each file counts the same: sizes are only known once its download starts.
    const done = missing.map(() => 0);
    const report = (i: number, written: number, total: number) => {
      done[i] = total > 0 ? Math.min(1, written / total) : 0;
      onProgress?.(done.reduce((a, b) => a + b, 0) / done.length, {
        stage: 'downloading', bytesWritten: written, contentLength: total,
      });
    };
    let next = 0;
    const worker = async () => {
      while (next < missing.length) {
        const i = next++;
        await this.download(missing[i], (w, t) => report(i, w, t));
        report(i, 1, 1);
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALLEL_DOWNLOADS, missing.length) }, worker));
    onProgress?.(1, { stage: 'complete', cached: missing.length === 0 });
  }

  private download(file: AssetRequest, progress: (written: number, total: number) => void): Promise<void> {
    let p = this.inFlight.get(file.key);
    if (!p) {
      p = this.attempts(file, progress).finally(() => this.inFlight.delete(file.key));
      this.inFlight.set(file.key, p);
    }
    return p;
  }

  private async attempts(file: AssetRequest, progress: (written: number, total: number) => void): Promise<void> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.retries; attempt++) {
      try {
        return await this.fetchOne(file, progress);
      } catch (error) {
        lastError = error;
        if (attempt < this.retries) await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
      }
    }
    throw KittenTTSError.downloadFailed(`Failed after ${this.retries} attempts: ${errorMessage(lastError)}`, lastError);
  }
}

/** Unpack a downloaded file if the request says it is gzipped, and check its size. */
export function unpack(request: AssetRequest, data: Uint8Array): Uint8Array {
  const out = request.gzip ? pako.inflate(data) : data;
  if (request.size !== undefined && out.length !== request.size) {
    throw new Error(`${request.url}: expected ${request.size} bytes, got ${out.length}`);
  }
  return out;
}

/**
 * A read-only view of one folder the app provides, for the platform stores' local(). A file
 * may also be there gzipped, as the hosted text data is ("x.gz").
 */
export function readOnlyStore(
  path: (key: string) => string,
  exists: (path: string) => Promise<boolean>,
  read: { text(path: string): Promise<string>; bytes(path: string): Promise<Uint8Array> },
  filePaths: boolean,
): TinyFileSource {
  const gz = (key: string) => `${path(key)}.gz`;
  return {
    async ensure(files) {
      const missing: string[] = [];
      for (const f of files) if (!(await exists(path(f.key))) && !(await exists(gz(f.key)))) missing.push(path(f.key));
      if (missing.length) throw KittenTTSError.modelFileNotFound(missing.join(', '));
    },
    async text(key) {
      if (await exists(path(key))) return read.text(path(key));
      return utf8Decode(pako.inflate(await read.bytes(gz(key))));
    },
    async bytes(key) {
      if (await exists(path(key))) return read.bytes(path(key));
      return pako.inflate(await read.bytes(gz(key)));
    },
    // ONNX Runtime opens files itself only when they are stored unpacked.
    filePath: async key => (filePaths && (await exists(path(key))) ? path(key) : undefined),
    clear: async () => {},
  };
}

/**
 * Routes keys under some top folders to other sources (folders the app provides), and the
 * rest to the download cache.
 */
export function routedStore(base: TinyAssetStore, routes: Record<string, TinyFileSource>): TinyAssetStore {
  const pick = (key: string): [TinyFileSource, string] => {
    const top = key.split('/')[0];
    const r = routes[top];
    return r ? [r, key.slice(top.length + 1)] : [base, key];
  };
  return {
    async ensure(files, onProgress) {
      const bySource = new Map<TinyFileSource, AssetRequest[]>();
      for (const f of files) {
        const [s, key] = pick(f.key);
        bySource.set(s, [...(bySource.get(s) ?? []), { ...f, key }]);
      }
      for (const [s, fs] of bySource) await s.ensure(fs, onProgress);
    },
    text: key => { const [s, k] = pick(key); return s.text(k); },
    bytes: key => { const [s, k] = pick(key); return s.bytes(k); },
    filePath: key => { const [s, k] = pick(key); return s.filePath(k); },
    clear: key => { const [s, k] = pick(key); return s.clear(k); },
    local: dir => base.local(dir),
    writeFile: (p, d) => base.writeFile(p, d),
  };
}

/** Cache a promise per key; a failed one is forgotten so the next call tries again. */
export function memo<K, V>(map: Map<K, Promise<V>>, key: K, make: () => Promise<V>): Promise<V> {
  let p = map.get(key);
  if (!p) {
    p = make();
    map.set(key, p);
    p.catch(() => { if (map.get(key) === p) map.delete(key); });
  }
  return p;
}
