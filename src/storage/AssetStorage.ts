export interface AssetStorage {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, data: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
  has?(key: string): Promise<boolean>;
  pathForKey?(key: string): Promise<string | null>;
}

export class MemoryAssetStorage implements AssetStorage {
  private readonly entries = new Map<string, Uint8Array>();

  async get(key: string): Promise<Uint8Array | null> {
    const data = this.entries.get(key);
    return data ? new Uint8Array(data) : null;
  }

  async set(key: string, data: Uint8Array): Promise<void> {
    this.entries.set(key, new Uint8Array(data));
  }

  async delete(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async has(key: string): Promise<boolean> {
    return this.entries.has(key);
  }
}

export class BrowserCacheAssetStorage implements AssetStorage {
  constructor(private readonly cacheName = 'kittentts-web') {}

  async get(key: string): Promise<Uint8Array | null> {
    if (!hasCacheStorage()) return null;
    const cache = await caches.open(this.cacheName);
    const response = await cache.match(cacheRequest(key));
    if (!response || !response.ok) return null;
    return new Uint8Array(await response.arrayBuffer());
  }

  async set(key: string, data: Uint8Array): Promise<void> {
    if (!hasCacheStorage()) return;
    const cache = await caches.open(this.cacheName);
    await cache.put(cacheRequest(key), new Response(toArrayBuffer(data)));
  }

  async delete(key: string): Promise<void> {
    if (!hasCacheStorage()) return;
    const cache = await caches.open(this.cacheName);
    await cache.delete(cacheRequest(key));
  }

  async has(key: string): Promise<boolean> {
    return (await this.get(key)) !== null;
  }
}

export class NodeFileAssetStorage implements AssetStorage {
  constructor(private readonly rootDirectory?: string) {}

  async get(key: string): Promise<Uint8Array | null> {
    const filePath = await this.pathForKey(key);
    try {
      const fs = await import('node:fs/promises');
      const data = await fs.readFile(filePath);
      return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    } catch {
      return null;
    }
  }

  async set(key: string, data: Uint8Array): Promise<void> {
    const filePath = await this.pathForKey(key);
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const tempPath = `${filePath}.download`;
    await fs.writeFile(tempPath, data);
    await fs.rename(tempPath, filePath);
  }

  async delete(key: string): Promise<void> {
    const filePath = await this.pathForKey(key);
    const fs = await import('node:fs/promises');
    await fs.unlink(filePath).catch(() => {});
    await fs.unlink(`${filePath}.download`).catch(() => {});
  }

  async has(key: string): Promise<boolean> {
    const filePath = await this.pathForKey(key);
    const fs = await import('node:fs/promises');
    return fs.access(filePath).then(() => true, () => false);
  }

  async pathForKey(key: string): Promise<string> {
    const path = await import('node:path');
    const root = this.rootDirectory ?? await defaultNodeCacheDirectory();
    return path.join(root, ...key.split('/').map(safeSegment));
  }
}

let memoryFallback: MemoryAssetStorage | null = null;

export function defaultAssetStorage(storageDirectory?: string): AssetStorage {
  if (isNodeRuntime()) return new NodeFileAssetStorage(storageDirectory);
  if (hasCacheStorage()) return new BrowserCacheAssetStorage(storageDirectory || 'kittentts-web');
  memoryFallback ??= new MemoryAssetStorage();
  return memoryFallback;
}

export function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && Boolean(process.versions?.node);
}

function hasCacheStorage(): boolean {
  return typeof caches !== 'undefined' && typeof Response !== 'undefined';
}

function cacheRequest(key: string): Request {
  return new Request(`https://kittentts.local/cache/${encodeURIComponent(key)}`);
}

async function defaultNodeCacheDirectory(): Promise<string> {
  const os = await import('node:os');
  const path = await import('node:path');
  return path.join(os.homedir(), '.cache', 'kittentts-web');
}

function safeSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9._-]/g, '_') || '_';
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}
