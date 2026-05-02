import * as RNFS from 'react-native-fs';
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

/** Progress callback: value between 0 and 1, with optional status metadata. */
export type ProgressHandler = (
  progress: number,
  info?: DownloadProgressInfo,
) => void;

/** Resolved paths to the cached model files. */
export interface ModelPaths {
  onnxPath: string;
  voicesPath: string;
}

/** Detailed model cache status for app first-run UI. */
export interface ModelCacheInfo extends ModelPaths {
  model: KittenModel;
  directory: string;
  onnxExists: boolean;
  voicesExists: boolean;
  isCached: boolean;
}

/** Options used by model downloads. */
export interface ModelDownloadOptions {
  /** Redownload model files even if they already exist. */
  force?: boolean;
  /** Number of total attempts per file. Defaults to 4. */
  retries?: number;
  /** Override the model file host. Must point at a directory containing the model files. */
  baseURL?: string;
}

const activeDownloads = new Map<string, Promise<ModelPaths>>();
const DEFAULT_DOWNLOAD_RETRIES = 4;
const RETRY_DELAY_MS = 750;
const CONNECTION_TIMEOUT_MS = 30_000;
const READ_TIMEOUT_MS = 30_000;
const BACKGROUND_TIMEOUT_MS = 10 * 60_000;

/**
 * Returns `true` if both the ONNX model and voices file are cached on disk.
 */
export async function isModelCached(
  model: KittenModel,
  storageDir: string,
): Promise<boolean> {
  return (await getModelCacheInfo(model, storageDir)).isCached;
}

/**
 * Returns detailed cache state for a model.
 */
export async function getModelCacheInfo(
  model: KittenModel,
  storageDir: string,
): Promise<ModelCacheInfo> {
  const dir = resolveDir(model, storageDir);
  const onnxPath = `${dir}/${onnxFileName(model)}`;
  const voicesPath = `${dir}/${voicesFileName(model)}`;
  const [onnxExists, voicesExists] = await Promise.all([
    RNFS.exists(onnxPath),
    RNFS.exists(voicesPath),
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

/**
 * Download the ONNX model and voices file if not already cached.
 *
 * @param model - Which model variant to download.
 * @param storageDir - Custom storage directory, or empty string for default.
 * @param progressHandler - Optional callback for download progress [0, 1].
 * @returns Paths to the cached ONNX model and voices file.
 */
export async function downloadModelIfNeeded(
  model: KittenModel,
  storageDir: string,
  progressHandler?: ProgressHandler,
  options: ModelDownloadOptions = {},
): Promise<ModelPaths> {
  const dir = resolveDir(model, storageDir);
  const retryCount = normalizeRetryCount(options.retries);
  const baseURL = options.baseURL ?? huggingFaceBaseURL(model);
  const cacheKey = `${model}:${dir}:${baseURL}:${options.force ? 'force' : 'cached'}:${retryCount}`;
  const activeDownload = activeDownloads.get(cacheKey);
  if (activeDownload) {
    const paths = await activeDownload;
    progressHandler?.(1.0, { stage: 'complete' });
    return paths;
  }

  const download = downloadModelFilesIfNeeded(model, dir, progressHandler, {
    force: options.force ?? false,
    retries: retryCount,
    baseURL,
  });
  activeDownloads.set(cacheKey, download);
  try {
    return await download;
  } finally {
    activeDownloads.delete(cacheKey);
  }
}

async function downloadModelFilesIfNeeded(
  model: KittenModel,
  dir: string,
  progressHandler?: ProgressHandler,
  options: Required<ModelDownloadOptions> = {
    force: false,
    retries: DEFAULT_DOWNLOAD_RETRIES,
    baseURL: huggingFaceBaseURL(model),
  },
): Promise<ModelPaths> {
  const onnxPath = `${dir}/${onnxFileName(model)}`;
  const voicesPath = `${dir}/${voicesFileName(model)}`;

  if (options.force) {
    await Promise.all([
      deleteIfExists(onnxPath),
      deleteIfExists(voicesPath),
      deleteIfExists(`${onnxPath}.download`),
      deleteIfExists(`${voicesPath}.download`),
    ]);
  }

  progressHandler?.(0, { stage: 'checking-cache', cached: false });

  const [onnxExists, voicesExists] = await Promise.all([
    RNFS.exists(onnxPath),
    RNFS.exists(voicesPath),
  ]);

  if (onnxExists && voicesExists) {
    progressHandler?.(1.0, { stage: 'cached', cached: true });
    return { onnxPath, voicesPath };
  }

  // Ensure directory exists
  try {
    await RNFS.mkdir(dir);
  } catch (error) {
    throw KittenTTSError.downloadFailed(
      `Could not create model cache directory ${dir}: ${errorMessage(error)}`,
      error,
    );
  }

  const baseURL = options.baseURL;

  const aggregateProgress = createAggregateProgress(progressHandler);
  const downloads: Promise<void>[] = [];

  if (!onnxExists) {
    const onnxURL = `${baseURL}/${onnxFileName(model)}`;
    downloads.push(
      downloadFile(onnxURL, onnxPath, 'model', options.retries, aggregateProgress),
    );
  }

  if (!voicesExists) {
    const voicesURL = `${baseURL}/${voicesFileName(model)}`;
    downloads.push(
      downloadFile(voicesURL, voicesPath, 'voices', options.retries, aggregateProgress),
    );
  }

  await Promise.all(downloads);
  progressHandler?.(1.0, { stage: 'complete', cached: false });
  return { onnxPath, voicesPath };
}

/** Delete cached model files so the next create/prewarm call downloads again. */
export async function clearModelCache(
  model: KittenModel,
  storageDir: string,
): Promise<void> {
  const dir = resolveDir(model, storageDir);
  await Promise.all([
    deleteIfExists(`${dir}/${onnxFileName(model)}`),
    deleteIfExists(`${dir}/${voicesFileName(model)}`),
    deleteIfExists(`${dir}/${onnxFileName(model)}.download`),
    deleteIfExists(`${dir}/${voicesFileName(model)}.download`),
  ]);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function resolveDir(model: KittenModel, storageDir: string): string {
  const base = storageDir || `${RNFS.DocumentDirectoryPath}/KittenTTS`;
  return `${base}/${model}`;
}

async function downloadFile(
  fromURL: string,
  toPath: string,
  asset: DownloadProgressAsset,
  retries: number,
  progressHandler?: ProgressHandler,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await downloadFileOnce(fromURL, toPath, asset, attempt, retries, progressHandler);
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
  toPath: string,
  asset: DownloadProgressAsset,
  attempt: number,
  totalAttempts: number,
  progressHandler?: ProgressHandler,
): Promise<void> {
  progressHandler?.(0, {
    stage: 'downloading',
    asset,
    attempt,
    totalAttempts,
  });
  const tempPath = `${toPath}.download`;

  try {
    await deleteIfExists(tempPath);

    const result = RNFS.downloadFile({
      fromUrl: fromURL,
      toFile: tempPath,
      progressDivider: 1,
      connectionTimeout: CONNECTION_TIMEOUT_MS,
      readTimeout: READ_TIMEOUT_MS,
      backgroundTimeout: BACKGROUND_TIMEOUT_MS,
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
      throw KittenTTSError.downloadFailed(
        `HTTP ${response.statusCode} downloading ${fromURL}`,
      );
    }

    const tempExists = await RNFS.exists(tempPath);
    if (!tempExists) {
      throw KittenTTSError.downloadFailed(
        `Downloaded file was not written to ${tempPath}`,
      );
    }

    await RNFS.moveFile(tempPath, toPath);
    progressHandler?.(1, {
      stage: 'complete',
      asset,
      attempt,
      totalAttempts,
    });
  } catch (error) {
    await deleteIfExists(tempPath);
    if (isKittenTTSError(error)) {
      throw error;
    }
    throw KittenTTSError.downloadFailed(errorMessage(error), error);
  }
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

async function deleteIfExists(filePath: string): Promise<void> {
  await RNFS.unlink(filePath).catch(() => {});
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
