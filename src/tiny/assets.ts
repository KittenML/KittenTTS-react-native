// Where the Kitten TTS 2 nano / pico / mini files come from and where they are kept.
// A store downloads what is missing and reads files back; platform.ts / platform.web.ts
// provide one for React Native (react-native-fs) and for the web and Node (fetch).

import pako from 'pako';
import type { DownloadProgressInfo, ProgressHandler } from '../loader/ModelDownloader';

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

export interface TinyAssetStore {
  /** Download whichever of these files are not cached yet. */
  ensure(files: readonly AssetRequest[], onProgress?: ProgressHandler): Promise<void>;
  has(key: string): Promise<boolean>;
  text(key: string): Promise<string>;
  bytes(key: string): Promise<Uint8Array>;
  /** A local file path ONNX Runtime can open itself, when the file exists unpacked on disk. */
  filePath?(key: string): Promise<string | undefined>;
  /** Delete cached files under a key prefix (a folder). */
  clear(prefix: string): Promise<void>;
  /** A read-only store over a folder the app provides (no downloads). */
  local(directory: string): TinyAssetStore;
  /** Write a file (generateToFile). */
  writeFile(path: string, data: Uint8Array): Promise<void>;
}

export type TinyProgressInfo = DownloadProgressInfo & { file?: string };

/** Sums byte progress over several files into one 0..1 value. */
export function aggregateProgress(onProgress?: ProgressHandler): (key: string, written: number, total: number) => void {
  const files = new Map<string, { written: number; total: number }>();
  return (key, written, total) => {
    if (!onProgress) return;
    files.set(key, { written: Math.min(written, total), total });
    let w = 0;
    let t = 0;
    for (const f of files.values()) {
      w += f.written;
      t += f.total;
    }
    const info: TinyProgressInfo = { stage: written >= total ? 'complete' : 'downloading', bytesWritten: written, contentLength: total, file: key };
    onProgress(t > 0 ? Math.max(0, Math.min(1, w / t)) : 0, info);
  };
}

/** Run tasks with at most `limit` in flight. */
export async function inBatches<T>(items: readonly T[], limit: number, run: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await run(items[next++]);
  });
  await Promise.all(workers);
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
 * A read-only view of one folder the app provides, shared by the platform stores'
 * local(). A file may also be there gzipped, as the hosted text data is ("x.gz").
 */
export function readOnlyStore(
  path: (key: string) => string,
  exists: (path: string) => Promise<boolean>,
  read: { text(path: string): Promise<string>; bytes(path: string): Promise<Uint8Array> },
  decodeText: (bytes: Uint8Array) => string,
  parent: TinyAssetStore,
  filePaths: boolean,
): TinyAssetStore {
  const present = async (key: string) => (await exists(path(key))) || exists(path(key) + '.gz');
  const store: TinyAssetStore = {
    async ensure(files) {
      const missing: string[] = [];
      for (const f of files) if (!(await present(f.key))) missing.push(path(f.key));
      if (missing.length) throw new Error(`missing files: ${missing.join(', ')}`);
    },
    has: present,
    async text(key) {
      if (await exists(path(key))) return read.text(path(key));
      return decodeText(pako.inflate(await read.bytes(path(key) + '.gz')));
    },
    async bytes(key) {
      if (await exists(path(key))) return read.bytes(path(key));
      return pako.inflate(await read.bytes(path(key) + '.gz'));
    },
    clear: async () => {},
    local: dir => parent.local(dir),
    writeFile: (p, d) => parent.writeFile(p, d),
  };
  // ONNX Runtime opens files itself only when they are stored unpacked.
  if (filePaths) store.filePath = async key => ((await exists(path(key))) ? path(key) : undefined);
  return store;
}

/**
 * Routes keys under some folders to other stores (local folders the app provides), and
 * the rest to the download cache.
 */
export function routedStore(base: TinyAssetStore, routes: Record<string, TinyAssetStore>): TinyAssetStore {
  const pick = (key: string): [TinyAssetStore, string] => {
    const top = key.split('/')[0];
    const r = routes[top];
    return r ? [r, key.slice(top.length + 1)] : [base, key];
  };
  return {
    async ensure(files, onProgress) {
      const byStore = new Map<TinyAssetStore, AssetRequest[]>();
      for (const f of files) {
        const [s, k] = pick(f.key);
        byStore.set(s, [...(byStore.get(s) ?? []), { ...f, key: k }]);
      }
      for (const [s, fs] of byStore) await s.ensure(fs, onProgress);
    },
    has: key => { const [s, k] = pick(key); return s.has(k); },
    text: key => { const [s, k] = pick(key); return s.text(k); },
    bytes: key => { const [s, k] = pick(key); return s.bytes(k); },
    filePath: async key => { const [s, k] = pick(key); return s.filePath?.(k); },
    clear: prefix => { const [s, k] = pick(prefix); return s.clear(k); },
    local: dir => base.local(dir),
    writeFile: (p, d) => base.writeFile(p, d),
  };
}
