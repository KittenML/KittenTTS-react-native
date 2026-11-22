// React Native: files under <DocumentDirectory>/KittenTTS via react-native-fs, and
// onnxruntime-react-native.

import * as RNFS from 'react-native-fs';
import type { ProgressHandler } from '../loader/ModelDownloader';
import type { AssetRequest, TinyAssetStore, TinyFileSource, TinyPlatform, TinyPlatformOptions } from './assets';
import { Downloader, readOnlyStore, unpack } from './assets';
import type { OrtLike } from './ort';
import { utf8Decode } from './utf8';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

declare const atob: ((data: string) => string) | undefined;
declare const btoa: ((data: string) => string) | undefined;
declare function escape(s: string): string;

/** Base64 -> "binary string" (one char per byte). Hermes's atob is native and fast. */
function binaryString(b64: string): string {
  if (typeof atob === 'function') return atob(b64);
  const lut = new Uint8Array(128);
  for (let i = 0; i < 64; i++) lut[B64.charCodeAt(i)] = i;
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const parts: string[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = (lut[clean.charCodeAt(i)] << 18) | (lut[clean.charCodeAt(i + 1)] << 12)
      | (lut[clean.charCodeAt(i + 2)] << 6) | lut[clean.charCodeAt(i + 3)];
    const left = clean.length - i;
    parts.push(String.fromCharCode(n >> 16, (n >> 8) & 255, n & 255).slice(0, left >= 4 ? 3 : left - 1));
  }
  return parts.join('');
}

function bytesOf(bin: string): Uint8Array {
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) {
    parts.push(String.fromCharCode.apply(null, bytes.subarray(i, i + 8192) as unknown as number[]));
  }
  const bin = parts.join('');
  if (typeof btoa === 'function') return btoa(bin);
  let out = '';
  for (let i = 0; i < bin.length; i += 3) {
    const n = (bin.charCodeAt(i) << 16) | ((bin.charCodeAt(i + 1) || 0) << 8) | (bin.charCodeAt(i + 2) || 0);
    out += B64[n >> 18] + B64[(n >> 12) & 63] + (i + 1 < bin.length ? B64[(n >> 6) & 63] : '=')
      + (i + 2 < bin.length ? B64[n & 63] : '=');
  }
  return out;
}

/**
 * A UTF-8 file as a string. react-native-fs's own utf8 reading decodes base64 and UTF-8
 * in JavaScript (a Buffer polyfill), seconds for the English lexicons on a phone; atob
 * plus decodeURIComponent(escape(...)) does it natively in about 0.1 s.
 */
async function readText(path: string): Promise<string> {
  const bin = binaryString(await RNFS.readFile(path, 'base64'));
  try {
    return decodeURIComponent(escape(bin));
  } catch {
    return utf8Decode(bytesOf(bin));
  }
}

/**
 * Writes bytes in 3 MB slices (a multiple of 3, so each slice is whole base64). One
 * writeFile of a 42 MB file passed a 56 MB string to Java, which ran out of its 192 MB
 * heap on an Android emulator.
 */
async function writeBytes(path: string, data: Uint8Array): Promise<void> {
  const step = 3 * 1024 * 1024;
  await RNFS.writeFile(path, toBase64(data.subarray(0, step)), 'base64');
  for (let pos = step; pos < data.length; pos += step) {
    await RNFS.appendFile(path, toBase64(data.subarray(pos, pos + step)), 'base64');
  }
}

const SLICE = 4 * 1024 * 1024;

/**
 * A file's bytes. Big files (Japanese's 42 MB cost table) are read in 4 MB slices, so the
 * base64 and binary strings in between never hold more than one slice: memory peaks near
 * the file's own size instead of three to four times it.
 */
async function readBytes(path: string): Promise<Uint8Array> {
  const size = Number((await RNFS.stat(path)).size);
  if (size <= SLICE) return bytesOf(binaryString(await RNFS.readFile(path, 'base64')));
  const out = new Uint8Array(size);
  for (let pos = 0; pos < size; pos += SLICE) {
    const bin = binaryString(await RNFS.read(path, Math.min(SLICE, size - pos), pos, 'base64'));
    for (let i = 0; i < bin.length; i++) out[pos + i] = bin.charCodeAt(i);
  }
  return out;
}

class RNFSAssetStore implements TinyAssetStore {
  private readonly downloader: Downloader;

  constructor(private readonly root: string, retries: number) {
    this.downloader = new Downloader(retries, key => RNFS.exists(this.path(key)), (f, progress) => this.fetchOne(f, progress));
  }

  private path(key: string): string {
    return `${this.root}/${key}`;
  }

  ensure(files: readonly AssetRequest[], onProgress?: ProgressHandler): Promise<void> {
    return this.downloader.ensure(files, onProgress);
  }

  /** Download one file to a temporary name, unpack and check it, then move it in place. */
  private async fetchOne(f: AssetRequest, progress: (written: number, total: number) => void): Promise<void> {
    const target = this.path(f.key);
    const temp = `${target}.download`;
    await RNFS.mkdir(target.slice(0, target.lastIndexOf('/')));
    try {
      await RNFS.unlink(temp).catch(() => {});
      const res = await RNFS.downloadFile({
        fromUrl: f.url,
        toFile: temp,
        headers: f.headers,
        progressDivider: 1,
        connectionTimeout: 30_000,
        readTimeout: 30_000,
        backgroundTimeout: 10 * 60_000,
        progress: e => { if (e.contentLength > 0) progress(e.bytesWritten, e.contentLength); },
      }).promise;
      if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode} downloading ${f.url}`);
      if (f.gzip) {
        // Unpacked once here, so every later load reads the plain file.
        await writeBytes(temp, unpack(f, await readBytes(temp)));
      } else if (f.size !== undefined) {
        const stat = await RNFS.stat(temp);
        if (Number(stat.size) !== f.size) throw new Error(`${f.url}: expected ${f.size} bytes, got ${stat.size}`);
      }
      await RNFS.moveFile(temp, target);
    } catch (error) {
      await RNFS.unlink(temp).catch(() => {});
      throw error;
    }
  }

  async filePath(key: string): Promise<string | undefined> {
    return (await RNFS.exists(this.path(key))) ? this.path(key) : undefined;
  }

  text(key: string): Promise<string> {
    return readText(this.path(key));
  }

  bytes(key: string): Promise<Uint8Array> {
    return readBytes(this.path(key));
  }

  async clear(key: string): Promise<void> {
    await RNFS.unlink(this.path(key)).catch(() => {});
  }

  local(directory: string): TinyFileSource {
    const dir = directory.replace(/^file:\/\//, '').replace(/\/+$/, '');
    return readOnlyStore(key => `${dir}/${key}`, p => RNFS.exists(p), { text: readText, bytes: readBytes }, true);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await writeBytes(path.replace(/^file:\/\//, ''), data);
  }
}

export async function defaultTinyPlatform(options: TinyPlatformOptions = {}): Promise<TinyPlatform> {
  const ort = (await import('onnxruntime-react-native')) as unknown as OrtLike;
  const root = options.storageDirectory ?? `${RNFS.DocumentDirectoryPath}/KittenTTS`;
  return { ort, store: new RNFSAssetStore(root, Math.max(1, options.downloadRetries ?? 4)) };
}
