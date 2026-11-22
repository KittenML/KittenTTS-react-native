// Where the Kitten TTS 2 nano / pico / mini files come from and where they are kept.
// A store downloads what is missing and reads files back; platform.ts / platform.web.ts
// provide one for React Native (react-native-fs) and for the web and Node (fetch).

import type { DownloadProgressInfo, ProgressHandler } from '../loader/ModelDownloader';

export interface AssetRequest {
  /** Cache key, a relative path such as "kitten-tts-2-nano/config.json". */
  key: string;
  url: string;
}

export interface TinyAssetStore {
  /** Download whichever of these files are not cached yet. */
  ensure(files: readonly AssetRequest[], onProgress?: ProgressHandler): Promise<void>;
  has(key: string): Promise<boolean>;
  text(key: string): Promise<string>;
  bytes(key: string): Promise<Uint8Array>;
  /** A local file path for ONNX Runtime, where the platform has files. */
  path?(key: string): string | undefined;
  /** Delete cached files under a key prefix (a folder). */
  clear(prefix: string): Promise<void>;
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
