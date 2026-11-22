// Web and Node: files fetched and kept in the browser's Cache Storage or, under Node,
// in a folder (the SDK's AssetStorage), and onnxruntime-web.

import { KittenTTSError } from '../KittenTTSError';
import type { ProgressHandler } from '../loader/ModelDownloader';
import { defaultAssetStorage, isNodeRuntime } from '../storage/AssetStorage';
import type { AssetStorage } from '../storage/AssetStorage';
import type { AssetRequest, TinyAssetStore, TinyFileSource, TinyPlatform, TinyPlatformOptions } from './assets';
import { Downloader, readOnlyStore, unpack } from './assets';
import type { OrtLike } from './ort';
import { utf8Decode } from './utf8';

const ORT_WEB_VERSION = '1.26.0';
let browserOrt: Promise<OrtLike> | undefined;

// Opaque to bundlers, as in TTSEngine.web.ts.
const importModule = new Function('s', 'return import(s)') as (s: string) => Promise<any>;

class FetchAssetStore implements TinyAssetStore {
  /** Files the storage could not keep (a full or missing Cache Storage), for this session. */
  private readonly memory = new Map<string, Uint8Array>();
  private readonly downloader: Downloader;

  constructor(private readonly storage: AssetStorage, retries: number) {
    this.downloader = new Downloader(retries, key => this.has(key), async (f, progress) => {
      const res = await fetch(f.url, f.headers ? { headers: f.headers } : undefined);
      if (!res.ok) throw new Error(`HTTP ${res.status} downloading ${f.url}`);
      const data = unpack(f, new Uint8Array(await res.arrayBuffer()));
      progress(data.length, data.length);
      await this.storage.set(f.key, data).catch(() => this.memory.set(f.key, data));
    });
  }

  private async has(key: string): Promise<boolean> {
    if (this.memory.has(key)) return true;
    return this.storage.has ? this.storage.has(key) : (await this.storage.get(key)) !== null;
  }

  ensure(files: readonly AssetRequest[], onProgress?: ProgressHandler): Promise<void> {
    return this.downloader.ensure(files, onProgress);
  }

  async bytes(key: string): Promise<Uint8Array> {
    const data = this.memory.get(key) ?? (await this.storage.get(key));
    if (!data) throw KittenTTSError.modelFileNotFound(key);
    return data;
  }

  async text(key: string): Promise<string> {
    return utf8Decode(await this.bytes(key));
  }

  /** ONNX Runtime Web takes the model's bytes. */
  async filePath(): Promise<undefined> {
    return undefined;
  }

  async clear(key: string): Promise<void> {
    this.memory.delete(key);
    await this.storage.delete(key).catch(() => {});
  }

  /** Under Node a folder on disk; in a browser a URL prefix to fetch from. */
  local(directory: string): TinyFileSource {
    const dir = directory.replace(/\/+$/, '');
    if (isNodeRuntime()) {
      const fs = () => importModule('node:fs/promises');
      const readBytes = async (p: string) => new Uint8Array(await (await fs()).readFile(p));
      return readOnlyStore(
        key => `${dir.replace(/^file:\/\//, '')}/${key}`,
        async p => (await fs()).access(p).then(() => true, () => false),
        { text: async p => utf8Decode(await readBytes(p)), bytes: readBytes },
        false,
      );
    }
    const get = async (p: string) => {
      const res = await fetch(p);
      if (!res.ok) throw KittenTTSError.modelFileNotFound(p);
      return new Uint8Array(await res.arrayBuffer());
    };
    return readOnlyStore(
      key => `${dir}/${key}`,
      async p => fetch(p, { method: 'HEAD' }).then(r => r.ok, () => false),
      { text: async p => utf8Decode(await get(p)), bytes: get },
      false,
    );
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    if (!isNodeRuntime()) throw KittenTTSError.invalidArgument('generateToFile() needs a file system; use result.wavData() in a browser');
    await (await importModule('node:fs/promises')).writeFile(path, data);
  }
}

async function loadOrt(): Promise<OrtLike> {
  const scope = globalThis as { ort?: OrtLike; document?: any };
  if (scope.ort?.InferenceSession) return scope.ort;
  if (isNodeRuntime()) {
    const mod = await importModule('onnxruntime-web');
    return (mod.default ?? mod) as OrtLike;
  }
  browserOrt ??= new Promise<OrtLike>((resolve, reject) => {
    const script = scope.document.createElement('script');
    script.async = true;
    script.src = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_WEB_VERSION}/dist/ort.wasm.min.js`;
    script.onload = () => (scope.ort ? resolve(scope.ort) : reject(new Error('ONNX Runtime did not load')));
    script.onerror = () => reject(new Error(`Failed to load ${script.src}`));
    scope.document.head.appendChild(script);
  });
  return browserOrt;
}

export async function defaultTinyPlatform(options: TinyPlatformOptions = {}): Promise<TinyPlatform> {
  return {
    ort: await loadOrt(),
    store: new FetchAssetStore(defaultAssetStorage(options.storageDirectory), Math.max(1, options.downloadRetries ?? 4)),
  };
}
