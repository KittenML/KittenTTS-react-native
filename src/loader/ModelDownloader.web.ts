import {
  KittenModel,
  huggingFaceBaseURL,
  onnxFileName,
  voicesFileName,
} from '../KittenModel';
import {
  KittenTTSError,
  errorMessage,
  isKittenTTSError,
} from '../KittenTTSError';
import {
  type AssetStorage,
  defaultAssetStorage,
  isNodeRuntime,
} from '../storage/AssetStorage';

export type DownloadProgressStage =
  | 'checking-cache'
  | 'cached'
  | 'downloading'
  | 'retrying'
  | 'complete';

export type DownloadProgressAsset =
  | 'model'
  | 'voices'
  | 'phonemizer-rules'
  | 'phonemizer-list';

export interface DownloadProgressInfo {
  stage: DownloadProgressStage;
  asset?: DownloadProgressAsset;
  cached?: boolean;
  attempt?: number;
  totalAttempts?: number;
  bytesWritten?: number;
  contentLength?: number;
  message?: string;
}

export type ProgressHandler = (
  progress: number,
  info?: DownloadProgressInfo,
) => void;

export interface ModelPaths {
  onnxPath?: string;
  voicesPath?: string;
  onnxData?: Uint8Array;
  voicesData?: Uint8Array;
}

export interface FileModelPaths {
  onnxPath: string;
  voicesPath: string;
}

export interface ModelCacheInfo extends FileModelPaths {
  model: KittenModel;
  directory: string;
  onnxExists: boolean;
  voicesExists: boolean;
  isCached: boolean;
}

export interface ModelDownloadOptions {
  force?: boolean;
  retries?: number;
  baseURL?: string;
  storage?: AssetStorage;
  fetch?: typeof fetch;
}

export interface ModelResolveOptions extends ModelDownloadOptions {
  modelFiles?: ModelPaths;
}

const activeDownloads = new Map<string, Promise<ModelPaths>>();
const DEFAULT_DOWNLOAD_RETRIES = 4;
const RETRY_DELAY_MS = 750;

export async function isModelCached(
  model: KittenModel,
  storageDir: string,
  storage?: AssetStorage,
): Promise<boolean> {
  return (await getModelCacheInfo(model, storageDir, storage)).isCached;
}

export async function getModelCacheInfo(
  model: KittenModel,
  storageDir: string,
  storage = defaultAssetStorage(storageDir),
): Promise<ModelCacheInfo> {
  const dir = resolveDir(model, storageDir);
  const onnxPath = `${dir}/${onnxFileName(model)}`;
  const voicesPath = `${dir}/${voicesFileName(model)}`;
  const [onnxExists, voicesExists] = await Promise.all([
    hasStorageKey(storage, onnxPath),
    hasStorageKey(storage, voicesPath),
  ]);
  return {
    model,
    directory: dir,
    onnxPath,
    voicesPath,
    onnxExists,
    voicesExists,
    isCached: onnxExists && voicesExists,
  };
}

export async function getProvidedModelCacheInfo(
  model: KittenModel,
  files: ModelPaths,
): Promise<ModelCacheInfo> {
  if (files.onnxData || files.voicesData) {
    return {
      model,
      directory: '',
      onnxPath: files.onnxPath ?? '<provided model data>',
      voicesPath: files.voicesPath ?? '<provided voices data>',
      onnxExists: Boolean(files.onnxData || files.onnxPath),
      voicesExists: Boolean(files.voicesData || files.voicesPath),
      isCached: Boolean((files.onnxData || files.onnxPath) && (files.voicesData || files.voicesPath)),
    };
  }

  const paths = normalizeModelPaths(files);
  if (!paths.onnxPath) throw KittenTTSError.modelFileNotFound('<missing model path>');
  if (!paths.voicesPath) throw KittenTTSError.voicesFileNotFound('<missing voices path>');

  if (!isNodeRuntime()) {
    return {
      model,
      directory: commonDirectory(paths.onnxPath, paths.voicesPath),
      onnxPath: paths.onnxPath,
      voicesPath: paths.voicesPath,
      onnxExists: true,
      voicesExists: true,
      isCached: true,
    };
  }

  const [onnxExists, voicesExists] = await Promise.all([
    nodeFileExists(paths.onnxPath),
    nodeFileExists(paths.voicesPath),
  ]);
  return {
    model,
    directory: commonDirectory(paths.onnxPath, paths.voicesPath),
    onnxPath: paths.onnxPath,
    voicesPath: paths.voicesPath,
    onnxExists,
    voicesExists,
    isCached: onnxExists && voicesExists,
  };
}

export async function resolveModelPaths(
  model: KittenModel,
  storageDir: string,
  progressHandler?: ProgressHandler,
  options: ModelResolveOptions = {},
): Promise<ModelPaths> {
  if (options.modelFiles) {
    progressHandler?.(0, { stage: 'checking-cache', cached: false });
    const info = await getProvidedModelCacheInfo(model, options.modelFiles);
    if (!info.onnxExists) throw KittenTTSError.modelFileNotFound(info.onnxPath);
    if (!info.voicesExists) throw KittenTTSError.voicesFileNotFound(info.voicesPath);
    progressHandler?.(1, { stage: 'cached', cached: true });
    return normalizeModelPaths(options.modelFiles);
  }

  return downloadModelIfNeeded(model, storageDir, progressHandler, options);
}

export async function downloadModelIfNeeded(
  model: KittenModel,
  storageDir: string,
  progressHandler?: ProgressHandler,
  options: ModelDownloadOptions = {},
): Promise<ModelPaths> {
  const storage = options.storage ?? defaultAssetStorage(storageDir);
  const retryCount = normalizeRetryCount(options.retries);
  const baseURL = options.baseURL ?? huggingFaceBaseURL(model);
  const dir = resolveDir(model, storageDir);
  const cacheKey = `${model}:${dir}:${baseURL}:${options.force ? 'force' : 'cached'}:${retryCount}`;
  const activeDownload = activeDownloads.get(cacheKey);
  if (activeDownload) {
    const paths = await activeDownload;
    progressHandler?.(1, { stage: 'complete' });
    return paths;
  }

  const download = downloadModelFilesIfNeeded(model, dir, progressHandler, {
    force: options.force ?? false,
    retries: retryCount,
    baseURL,
    storage,
    fetch: options.fetch,
  });
  activeDownloads.set(cacheKey, download);
  try {
    return await download;
  } finally {
    activeDownloads.delete(cacheKey);
  }
}

export async function clearModelCache(
  model: KittenModel,
  storageDir: string,
  storage = defaultAssetStorage(storageDir),
): Promise<void> {
  const dir = resolveDir(model, storageDir);
  await Promise.all([
    storage.delete(`${dir}/${onnxFileName(model)}`),
    storage.delete(`${dir}/${voicesFileName(model)}`),
  ]);
}

async function downloadModelFilesIfNeeded(
  model: KittenModel,
  dir: string,
  progressHandler: ProgressHandler | undefined,
  options: Required<Pick<ModelDownloadOptions, 'force' | 'retries' | 'baseURL'>> & {
    storage: AssetStorage;
    fetch?: typeof fetch;
  },
): Promise<ModelPaths> {
  const onnxPath = `${dir}/${onnxFileName(model)}`;
  const voicesPath = `${dir}/${voicesFileName(model)}`;

  if (options.force) {
    await Promise.all([
      options.storage.delete(onnxPath),
      options.storage.delete(voicesPath),
    ]);
  }

  progressHandler?.(0, { stage: 'checking-cache', cached: false });

  const [onnxExists, voicesExists] = await Promise.all([
    hasStorageKey(options.storage, onnxPath),
    hasStorageKey(options.storage, voicesPath),
  ]);

  if (onnxExists && voicesExists) {
    progressHandler?.(1, { stage: 'cached', cached: true });
    return {
      onnxPath,
      voicesPath,
      onnxData: await requireStorageData(options.storage, onnxPath),
      voicesData: await requireStorageData(options.storage, voicesPath),
    };
  }

  const aggregateProgress = createAggregateProgress(progressHandler);
  const downloads: Promise<void>[] = [];

  if (!onnxExists) {
    downloads.push(
      downloadFile(
        `${options.baseURL}/${onnxFileName(model)}`,
        onnxPath,
        'model',
        options.retries,
        options.storage,
        options.fetch,
        aggregateProgress,
      ),
    );
  }

  if (!voicesExists) {
    downloads.push(
      downloadFile(
        `${options.baseURL}/${voicesFileName(model)}`,
        voicesPath,
        'voices',
        options.retries,
        options.storage,
        options.fetch,
        aggregateProgress,
      ),
    );
  }

  await Promise.all(downloads);
  progressHandler?.(1, { stage: 'complete', cached: false });
  return {
    onnxPath,
    voicesPath,
    onnxData: await requireStorageData(options.storage, onnxPath),
    voicesData: await requireStorageData(options.storage, voicesPath),
  };
}

async function downloadFile(
  fromURL: string,
  toKey: string,
  asset: DownloadProgressAsset,
  retries: number,
  storage: AssetStorage,
  fetchImpl: typeof fetch | undefined,
  progressHandler?: ProgressHandler,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await downloadFileOnce(fromURL, toKey, asset, attempt, retries, storage, fetchImpl, progressHandler);
      return;
    } catch (error) {
      lastError = error;
      if (attempt === retries) break;
      progressHandler?.(0, {
        stage: 'retrying',
        asset,
        attempt: attempt + 1,
        totalAttempts: retries,
        message: errorMessage(error),
      });
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }

  if (isKittenTTSError(lastError)) {
    throw KittenTTSError.downloadFailed(
      `Failed after ${retries} attempts: ${lastError.message}`,
      lastError,
    );
  }

  throw KittenTTSError.downloadFailed(
    `Failed after ${retries} attempts: ${errorMessage(lastError)}`,
    lastError,
  );
}

async function downloadFileOnce(
  fromURL: string,
  toKey: string,
  asset: DownloadProgressAsset,
  attempt: number,
  totalAttempts: number,
  storage: AssetStorage,
  fetchImpl: typeof fetch | undefined,
  progressHandler?: ProgressHandler,
): Promise<void> {
  const runFetch = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (!runFetch) {
    throw KittenTTSError.downloadFailed('No fetch implementation is available.');
  }

  progressHandler?.(0, { stage: 'downloading', asset, attempt, totalAttempts });

  try {
    const response = await runFetch(fromURL);
    if (!response.ok) {
      throw KittenTTSError.downloadFailed(`HTTP ${response.status} downloading ${fromURL}`);
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    const data = await readResponseBytes(response, contentLength, (bytesWritten) => {
      if (contentLength > 0) {
        progressHandler?.(
          Math.max(0, Math.min(1, bytesWritten / contentLength)),
          {
            stage: 'downloading',
            asset,
            attempt,
            totalAttempts,
            bytesWritten,
            contentLength,
          },
        );
      }
    });

    await storage.set(toKey, data);
    progressHandler?.(1, { stage: 'complete', asset, attempt, totalAttempts });
  } catch (error) {
    await storage.delete(toKey).catch(() => {});
    if (isKittenTTSError(error)) throw error;
    throw KittenTTSError.downloadFailed(errorMessage(error), error);
  }
}

async function readResponseBytes(
  response: Response,
  contentLength: number,
  onProgress: (bytesWritten: number) => void,
): Promise<Uint8Array> {
  if (!response.body || !response.body.getReader) {
    const data = new Uint8Array(await response.arrayBuffer());
    onProgress(data.byteLength);
    return data;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    chunks.push(value);
    total += value.byteLength;
    onProgress(total);
  }

  const result = new Uint8Array(contentLength > 0 ? contentLength : total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function resolveDir(model: KittenModel, storageDir: string): string {
  const base = storageDir || 'KittenTTS';
  return `${base}/${model}`;
}

function normalizeModelPaths(files: ModelPaths): ModelPaths {
  return {
    onnxPath: files.onnxPath ? stripFileScheme(files.onnxPath) : undefined,
    voicesPath: files.voicesPath ? stripFileScheme(files.voicesPath) : undefined,
    onnxData: files.onnxData,
    voicesData: files.voicesData,
  };
}

function stripFileScheme(filePath: string): string {
  return filePath.startsWith('file://') ? filePath.slice('file://'.length) : filePath;
}

function commonDirectory(firstPath: string, secondPath: string): string {
  const firstDir = dirname(firstPath);
  return firstDir === dirname(secondPath) ? firstDir : '';
}

function dirname(filePath: string): string {
  const index = filePath.lastIndexOf('/');
  return index > 0 ? filePath.slice(0, index) : '';
}

async function hasStorageKey(storage: AssetStorage, key: string): Promise<boolean> {
  if (storage.has) return storage.has(key);
  return (await storage.get(key)) !== null;
}

async function requireStorageData(storage: AssetStorage, key: string): Promise<Uint8Array> {
  const data = await storage.get(key);
  if (!data) throw KittenTTSError.modelFileNotFound(key);
  return data;
}

async function nodeFileExists(filePath: string): Promise<boolean> {
  const fs = await import('node:fs/promises');
  return fs.access(stripFileScheme(filePath)).then(() => true, () => false);
}

function normalizeRetryCount(retries: number | undefined): number {
  return Math.max(1, Math.floor(retries ?? DEFAULT_DOWNLOAD_RETRIES));
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
