import createCEPhonemizerModule from './generated/cephonemizer';
import type { CEPhonemizerModule } from './generated/cephonemizer';
import type { KittenPhonemizerProtocol } from './types';
import {
  KittenTTSError,
  errorMessage,
  isKittenTTSError,
} from '../KittenTTSError';
import type {
  DownloadProgressAsset,
  ProgressHandler,
} from '../loader/ModelDownloader.web';
import {
  type AssetStorage,
  defaultAssetStorage,
  isNodeRuntime,
} from '../storage/AssetStorage';

const DEFAULT_RULES_URL =
  'https://raw.githubusercontent.com/espeak-ng/espeak-ng/59eb19938f12e30881c81d86ce4a7de25414c9f4/dictsource/en_rules';

const DEFAULT_LIST_URL =
  'https://raw.githubusercontent.com/espeak-ng/espeak-ng/59eb19938f12e30881c81d86ce4a7de25414c9f4/dictsource/en_list';

const VIRTUAL_RULES_PATH = '/cephonemizer/en_rules';
const VIRTUAL_LIST_PATH = '/cephonemizer/en_list';
const DEFAULT_DOWNLOAD_RETRIES = 4;
const RETRY_DELAY_MS = 750;

export interface CEPhonemizerOptions {
  /** Override the English pronunciation rules URL. Useful for tests or mirrors. */
  rulesURL?: string;
  /** Override the English dictionary list URL. Useful for tests or mirrors. */
  listURL?: string;
  /** Local English pronunciation rules file. Node.js only. Skips the rules download. */
  rulesPath?: string;
  /** Local English dictionary list file. Node.js only. Skips the list download. */
  listPath?: string;
  /** English pronunciation rules text. Skips the rules download and file read. */
  rulesText?: string;
  /** English dictionary list text. Skips the list download and file read. */
  listText?: string;
  /** Dialect passed through to the C++ engine, for example `en-us`. */
  dialect?: string;
  /** Asset cache implementation. */
  storage?: AssetStorage;
  /** Fetch implementation. Defaults to globalThis.fetch. */
  fetch?: typeof fetch;
}

type CreateHandle = (rulesPath: string, listPath: string, dialect: string) => number;
type DestroyHandle = (handle: number) => void;
type PhonemizeHandle = (handle: number, text: string) => number;
type FreeString = (ptr: number) => void;
type PhonemizerAsset = Extract<
  DownloadProgressAsset,
  'phonemizer-rules' | 'phonemizer-list'
>;

/**
 * Web/Node adapter for the original KittenTTS CEPhonemizer C++ engine.
 *
 * The C++ source is compiled to a JS-only Emscripten module, so browser and
 * backend runtimes can use the same phonemizer logic without platform-native
 * bindings.
 */
export class CEPhonemizer implements KittenPhonemizerProtocol {
  static readonly defaultRulesURL = DEFAULT_RULES_URL;
  static readonly defaultListURL = DEFAULT_LIST_URL;

  private readonly rulesURL: string;
  private readonly listURL: string;
  private readonly rulesPath?: string;
  private readonly listPath?: string;
  private readonly rulesText?: string;
  private readonly listText?: string;
  private readonly dialect: string;
  private readonly storage?: AssetStorage;
  private readonly fetch?: typeof fetch;

  private module: CEPhonemizerModule | null = null;
  private handle = 0;
  private createHandle: CreateHandle | null = null;
  private destroyHandle: DestroyHandle | null = null;
  private phonemizeHandle: PhonemizeHandle | null = null;
  private freeString: FreeString | null = null;

  constructor(options: CEPhonemizerOptions = {}) {
    this.rulesURL = options.rulesURL ?? DEFAULT_RULES_URL;
    this.listURL = options.listURL ?? DEFAULT_LIST_URL;
    this.rulesPath = options.rulesPath;
    this.listPath = options.listPath;
    this.rulesText = options.rulesText;
    this.listText = options.listText;
    this.dialect = options.dialect ?? 'en-us';
    this.storage = options.storage;
    this.fetch = options.fetch;
  }

  async downloadIfNeeded(
    storageDirectory: string,
    progressHandler?: ProgressHandler,
  ): Promise<void> {
    if (this.hasBundledText() || this.hasBundledPaths()) {
      await this.loadBundled(progressHandler);
      return;
    }

    this.assertNoPartialBundledData();

    const base = storageDirectory || 'KittenTTS';
    const rulesKey = `${base}/CEPhonemizer/en_rules`;
    const listKey = `${base}/CEPhonemizer/en_list`;
    const storage = this.storage ?? defaultAssetStorage(storageDirectory);

    try {
      const [rulesCached, listCached] = await Promise.all([
        hasStorageKey(storage, rulesKey),
        hasStorageKey(storage, listKey),
      ]);

      if (rulesCached && listCached) {
        progressHandler?.(1, { stage: 'cached', cached: true });
      } else {
        progressHandler?.(0, { stage: 'checking-cache', cached: false });
      }

      const aggregateProgress = createAggregateProgress(progressHandler);
      const downloads: Promise<void>[] = [];
      if (!rulesCached) {
        downloads.push(
          downloadTextFile(this.rulesURL, rulesKey, 'phonemizer-rules', storage, this.fetch, aggregateProgress),
        );
      }
      if (!listCached) {
        downloads.push(
          downloadTextFile(this.listURL, listKey, 'phonemizer-list', storage, this.fetch, aggregateProgress),
        );
      }

      await Promise.all(downloads);

      const [rulesData, listData] = await Promise.all([
        requireStorageData(storage, rulesKey),
        requireStorageData(storage, listKey),
      ]);

      await this.load(TEXT_DECODER.decode(rulesData), TEXT_DECODER.decode(listData));
      progressHandler?.(1, { stage: 'complete', cached: rulesCached && listCached });
    } catch (error) {
      if (isKittenTTSError(error)) throw error;
      throw KittenTTSError.phonemizerFailed(errorMessage(error), error);
    }
  }

  async phonemize(text: string): Promise<string> {
    if (!this.module || !this.handle || !this.phonemizeHandle || !this.freeString) {
      throw KittenTTSError.phonemizerFailed(
        'CEPhonemizer data is not ready. Call downloadIfNeeded() before phonemize().',
      );
    }

    const resultPtr = this.phonemizeHandle(this.handle, text);
    if (!resultPtr) {
      throw KittenTTSError.phonemizerFailed('CEPhonemizer failed to phonemize text.');
    }

    try {
      return this.module.UTF8ToString(resultPtr);
    } finally {
      this.freeString(resultPtr);
    }
  }

  dispose(): void {
    if (this.handle && this.destroyHandle) {
      this.destroyHandle(this.handle);
    }
    this.handle = 0;
    this.module = null;
    this.createHandle = null;
    this.destroyHandle = null;
    this.phonemizeHandle = null;
    this.freeString = null;
  }

  private async load(rules: string, list: string): Promise<void> {
    this.dispose();

    const module = await createCEPhonemizerModule();
    ensureDir(module, '/cephonemizer');

    module.FS.writeFile(VIRTUAL_RULES_PATH, rules);
    module.FS.writeFile(VIRTUAL_LIST_PATH, list);

    const createHandle = module.cwrap(
      'phonemizer_create',
      'number',
      ['string', 'string', 'string'],
    ) as CreateHandle;
    const destroyHandle = module.cwrap('phonemizer_destroy', null, ['number']) as DestroyHandle;
    const phonemizeHandle = module.cwrap(
      'phonemizer_phonemize',
      'number',
      ['number', 'string'],
    ) as PhonemizeHandle;
    const freeString = module.cwrap('phonemizer_free_string', null, ['number']) as FreeString;

    const handle = createHandle(VIRTUAL_RULES_PATH, VIRTUAL_LIST_PATH, this.dialect);
    if (!handle) {
      throw KittenTTSError.phonemizerFailed('CEPhonemizer failed to load en_rules/en_list.');
    }

    this.module = module;
    this.handle = handle;
    this.createHandle = createHandle;
    this.destroyHandle = destroyHandle;
    this.phonemizeHandle = phonemizeHandle;
    this.freeString = freeString;
  }

  private hasBundledText(): boolean {
    return this.rulesText !== undefined || this.listText !== undefined;
  }

  private hasBundledPaths(): boolean {
    return this.rulesPath !== undefined || this.listPath !== undefined;
  }

  private assertNoPartialBundledData(): void {
    if (this.rulesText !== undefined || this.listText !== undefined) {
      if (this.rulesText === undefined || this.listText === undefined) {
        throw KittenTTSError.phonemizerFailed(
          'Both rulesText and listText must be provided for bundled CEPhonemizer data.',
        );
      }
    }

    if (this.rulesPath !== undefined || this.listPath !== undefined) {
      if (this.rulesPath === undefined || this.listPath === undefined) {
        throw KittenTTSError.phonemizerFailed(
          'Both rulesPath and listPath must be provided for bundled CEPhonemizer data.',
        );
      }
    }
  }

  private async loadBundled(progressHandler?: ProgressHandler): Promise<void> {
    this.assertNoPartialBundledData();

    try {
      progressHandler?.(0, { stage: 'checking-cache', cached: false });

      if (this.rulesText !== undefined && this.listText !== undefined) {
        await this.load(this.rulesText, this.listText);
        progressHandler?.(1, { stage: 'complete', cached: true });
        return;
      }

      if (!this.rulesPath || !this.listPath) {
        throw KittenTTSError.phonemizerFailed(
          'Bundled CEPhonemizer data must provide text or Node.js file paths.',
        );
      }
      if (!isNodeRuntime()) {
        throw KittenTTSError.phonemizerFailed(
          'rulesPath/listPath are only supported in Node.js. Use rulesText/listText in browsers.',
        );
      }

      const [rules, list] = await Promise.all([
        readNodeTextFile(this.rulesPath),
        readNodeTextFile(this.listPath),
      ]);
      await this.load(rules, list);
      progressHandler?.(1, { stage: 'complete', cached: true });
    } catch (error) {
      if (isKittenTTSError(error)) throw error;
      throw KittenTTSError.phonemizerFailed(errorMessage(error), error);
    }
  }
}

async function downloadTextFile(
  fromUrl: string,
  toKey: string,
  asset: PhonemizerAsset,
  storage: AssetStorage,
  fetchImpl: typeof fetch | undefined,
  progressHandler?: ProgressHandler,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DEFAULT_DOWNLOAD_RETRIES; attempt += 1) {
    try {
      await downloadTextFileOnce(
        fromUrl,
        toKey,
        asset,
        attempt,
        DEFAULT_DOWNLOAD_RETRIES,
        storage,
        fetchImpl,
        progressHandler,
      );
      return;
    } catch (error) {
      lastError = error;
      if (attempt === DEFAULT_DOWNLOAD_RETRIES) break;
      progressHandler?.(0, {
        stage: 'retrying',
        asset,
        attempt: attempt + 1,
        totalAttempts: DEFAULT_DOWNLOAD_RETRIES,
        message: errorMessage(error),
      });
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  throw KittenTTSError.phonemizerFailed(
    `Failed after ${DEFAULT_DOWNLOAD_RETRIES} attempts: ${errorMessage(lastError)}`,
    lastError,
  );
}

async function downloadTextFileOnce(
  fromUrl: string,
  toKey: string,
  asset: PhonemizerAsset,
  attempt: number,
  totalAttempts: number,
  storage: AssetStorage,
  fetchImpl: typeof fetch | undefined,
  progressHandler?: ProgressHandler,
): Promise<void> {
  const runFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!runFetch) {
    throw KittenTTSError.phonemizerFailed('No fetch implementation is available.');
  }

  progressHandler?.(0, { stage: 'downloading', asset, attempt, totalAttempts });

  const response = await runFetch(fromUrl);
  if (!response.ok) {
    throw KittenTTSError.phonemizerFailed(`HTTP ${response.status} downloading ${fromUrl}`);
  }

  const contentLength = Number(response.headers.get('content-length') || 0);
  const data = new Uint8Array(await response.arrayBuffer());
  progressHandler?.(1, {
    stage: 'downloading',
    asset,
    attempt,
    totalAttempts,
    bytesWritten: data.byteLength,
    contentLength: contentLength || data.byteLength,
  });
  await storage.set(toKey, data);
  progressHandler?.(1, { stage: 'complete', asset, attempt, totalAttempts });
}

async function hasStorageKey(storage: AssetStorage, key: string): Promise<boolean> {
  if (storage.has) return storage.has(key);
  return (await storage.get(key)) !== null;
}

async function requireStorageData(storage: AssetStorage, key: string): Promise<Uint8Array> {
  const data = await storage.get(key);
  if (!data) throw KittenTTSError.phonemizerFailed(`Cached phonemizer file not found: ${key}`);
  return data;
}

async function readNodeTextFile(filePath: string): Promise<string> {
  const fs = await import('node:fs/promises');
  return fs.readFile(stripFileScheme(filePath), 'utf8');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripFileScheme(filePath: string): string {
  return filePath.startsWith('file://') ? filePath.slice('file://'.length) : filePath;
}

function createAggregateProgress(
  progressHandler?: ProgressHandler,
): ProgressHandler {
  const files = new Map<
    DownloadProgressAsset,
    { bytesWritten: number; contentLength: number }
  >();

  return (progress, info) => {
    if (info?.asset && info.contentLength && info.contentLength > 0) {
      files.set(info.asset, {
        bytesWritten: Math.max(0, Math.min(info.bytesWritten ?? 0, info.contentLength)),
        contentLength: info.contentLength,
      });
    } else if (info?.asset && info.stage === 'complete' && !files.has(info.asset)) {
      files.set(info.asset, { bytesWritten: 1, contentLength: 1 });
    }

    const totalBytes = Array.from(files.values()).reduce(
      (sum, file) => sum + file.contentLength,
      0,
    );
    const writtenBytes = Array.from(files.values()).reduce(
      (sum, file) => sum + file.bytesWritten,
      0,
    );

    const aggregateProgress =
      totalBytes > 0
        ? Math.max(0, Math.min(1, writtenBytes / totalBytes))
        : progress;

    progressHandler?.(aggregateProgress, info);
  };
}

function ensureDir(module: CEPhonemizerModule, path: string): void {
  try {
    module.FS.mkdir(path);
  } catch {
    // Emscripten throws if the directory already exists.
  }
}

const TEXT_DECODER = new TextDecoder();
