import * as RNFS from 'react-native-fs';
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
} from '../loader/ModelDownloader';

// The CEPhonemizer C++ engine expects the same English dictionary files used
// by the Swift SDK. They are downloaded and cached at runtime so the npm
// package stays small while still keeping the C++ implementation as source of
// truth.
const DEFAULT_RULES_URL =
  'https://raw.githubusercontent.com/espeak-ng/espeak-ng/59eb19938f12e30881c81d86ce4a7de25414c9f4/dictsource/en_rules';

const DEFAULT_LIST_URL =
  'https://raw.githubusercontent.com/espeak-ng/espeak-ng/59eb19938f12e30881c81d86ce4a7de25414c9f4/dictsource/en_list';

// Paths inside Emscripten's in-memory filesystem. The native C++ code reads
// from file paths, so the React Native adapter writes cached dictionary text
// into this virtual filesystem before creating the phonemizer handle.
const VIRTUAL_RULES_PATH = '/cephonemizer/en_rules';
const VIRTUAL_LIST_PATH = '/cephonemizer/en_list';
const DEFAULT_DOWNLOAD_RETRIES = 4;
const RETRY_DELAY_MS = 750;
const CONNECTION_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 30_000;
const BACKGROUND_TIMEOUT_MS = 10 * 60_000;

export interface CEPhonemizerOptions {
  /** Override the English pronunciation rules URL. Useful for tests or mirrors. */
  rulesURL?: string;
  /** Override the English dictionary list URL. Useful for tests or mirrors. */
  listURL?: string;
  /** Dialect passed through to the C++ engine, for example `en-us`. */
  dialect?: string;
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
 * React Native adapter for the original KittenTTS Swift CEPhonemizer C++ engine.
 *
 * The C++ source is compiled to a JS-only Emscripten module, so Expo/RN can use
 * the same phonemizer logic without CocoaPods, JNI, or platform-specific native
 * bindings.
 */
export class CEPhonemizer implements KittenPhonemizerProtocol {
  static readonly defaultRulesURL = DEFAULT_RULES_URL;
  static readonly defaultListURL = DEFAULT_LIST_URL;

  private readonly rulesURL: string;
  private readonly listURL: string;
  private readonly dialect: string;

  // Emscripten module and opaque C++ handle. These are created lazily after the
  // dictionary data is cached, then reused across phonemize() calls.
  private module: CEPhonemizerModule | null = null;
  private handle = 0;

  // Typed wrappers around the C ABI exported from vendor/cephonemizer.
  private createHandle: CreateHandle | null = null;
  private destroyHandle: DestroyHandle | null = null;
  private phonemizeHandle: PhonemizeHandle | null = null;
  private freeString: FreeString | null = null;

  constructor(options: CEPhonemizerOptions = {}) {
    this.rulesURL = options.rulesURL ?? DEFAULT_RULES_URL;
    this.listURL = options.listURL ?? DEFAULT_LIST_URL;
    this.dialect = options.dialect ?? 'en-us';
  }

  async downloadIfNeeded(
    storageDirectory: string,
    progressHandler?: ProgressHandler,
  ): Promise<void> {
    // Store the dictionary next to the model cache by default. Keeping it under
    // KittenTTS makes it safe for apps to clear all SDK-managed assets together.
    const base = storageDirectory || `${RNFS.DocumentDirectoryPath}/KittenTTS`;
    const dir = `${base}/CEPhonemizer`;
    const rulesPath = `${dir}/en_rules`;
    const listPath = `${dir}/en_list`;

    try {
      await RNFS.mkdir(dir);

      const [rulesExists, listExists] = await Promise.all([
        RNFS.exists(rulesPath),
        RNFS.exists(listPath),
      ]);

      if (rulesExists && listExists) {
        progressHandler?.(1, { stage: 'cached', cached: true });
      } else {
        progressHandler?.(0, { stage: 'checking-cache', cached: false });
      }

      const aggregateProgress = createAggregateProgress(progressHandler);

      const downloads: Promise<void>[] = [];
      if (!rulesExists) {
        downloads.push(
          downloadFile(this.rulesURL, rulesPath, 'phonemizer-rules', aggregateProgress),
        );
      }
      if (!listExists) {
        downloads.push(
          downloadFile(this.listURL, listPath, 'phonemizer-list', aggregateProgress),
        );
      }

      await Promise.all(downloads);

      const [rules, list] = await Promise.all([
        RNFS.readFile(rulesPath, 'utf8'),
        RNFS.readFile(listPath, 'utf8'),
      ]);

      // Load after reading from disk even when files were already cached. This
      // keeps app startup deterministic and avoids storing dictionary text in JS
      // bundles or persistent globals.
      await this.load(rules, list);
      progressHandler?.(1, { stage: 'complete', cached: rulesExists && listExists });
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
      // phonemizer_phonemize returns a heap-allocated C string. Convert it to a
      // JS string, then always release the native allocation.
      return this.module.UTF8ToString(resultPtr);
    } finally {
      this.freeString(resultPtr);
    }
  }

  dispose(): void {
    if (this.handle && this.destroyHandle) {
      // Destroying the C++ handle releases parsed dictionary/rule state inside
      // the Emscripten heap. The module itself can then be garbage-collected.
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

    // The C++ code is intentionally unchanged from the Swift implementation and
    // works with file paths. Writing into MEMFS lets us preserve that contract
    // without a platform-specific native bridge.
    module.FS.writeFile(VIRTUAL_RULES_PATH, rules);
    module.FS.writeFile(VIRTUAL_LIST_PATH, list);

    // cwrap exposes the small C ABI from swift_bridge.cpp to JavaScript. Keeping
    // this boundary narrow makes future C++ updates easier to compare against
    // the Swift SDK.
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
}

async function downloadFile(
  fromUrl: string,
  toFile: string,
  asset: PhonemizerAsset,
  progressHandler?: ProgressHandler,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= DEFAULT_DOWNLOAD_RETRIES; attempt += 1) {
    try {
      await downloadFileOnce(
        fromUrl,
        toFile,
        asset,
        attempt,
        DEFAULT_DOWNLOAD_RETRIES,
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

  if (isKittenTTSError(lastError)) {
    throw KittenTTSError.phonemizerFailed(
      `Failed after ${DEFAULT_DOWNLOAD_RETRIES} attempts: ${lastError.message}`,
      lastError,
    );
  }

  throw KittenTTSError.phonemizerFailed(
    `Failed after ${DEFAULT_DOWNLOAD_RETRIES} attempts: ${errorMessage(lastError)}`,
    lastError,
  );
}

async function downloadFileOnce(
  fromUrl: string,
  toFile: string,
  asset: PhonemizerAsset,
  attempt: number,
  totalAttempts: number,
  progressHandler?: ProgressHandler,
): Promise<void> {
  const tempFile = `${toFile}.download`;

  try {
    await RNFS.unlink(tempFile).catch(() => {});
    progressHandler?.(0, { stage: 'downloading', asset, attempt, totalAttempts });

    // RNFS handles the native download stream and writes directly to disk, which
    // avoids holding the dictionary file in memory during first-run setup.
    const result = RNFS.downloadFile({
      fromUrl,
      toFile: tempFile,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      readTimeout: READ_TIMEOUT_MS,
      backgroundTimeout: BACKGROUND_TIMEOUT_MS,
      progressDivider: 1,
      progress: (event) => {
        if (event.contentLength > 0) {
          progressHandler?.(
            Math.max(0, Math.min(1, event.bytesWritten / event.contentLength)),
            {
              stage: 'downloading',
              asset,
              attempt,
              totalAttempts,
              bytesWritten: event.bytesWritten,
              contentLength: event.contentLength,
            },
          );
        }
      },
    });
    const response = await result.promise;
    if (response.statusCode !== 200) {
      throw KittenTTSError.phonemizerFailed(
        `HTTP ${response.statusCode} downloading ${fromUrl}`,
      );
    }

    const tempExists = await RNFS.exists(tempFile);
    if (!tempExists) {
      throw KittenTTSError.phonemizerFailed(
        `Downloaded file was not written to ${tempFile}`,
      );
    }

    await RNFS.moveFile(tempFile, toFile);
    progressHandler?.(1, { stage: 'complete', asset, attempt, totalAttempts });
  } catch (error) {
    await RNFS.unlink(tempFile).catch(() => {});
    if (isKittenTTSError(error)) throw error;
    throw KittenTTSError.phonemizerFailed(errorMessage(error), error);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
