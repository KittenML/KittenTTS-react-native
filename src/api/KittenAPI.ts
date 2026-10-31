import { base64ToUint8Array } from '../audio/Base64';
import { KittenAPIError, KittenTTSError, KittenTTSErrorCode } from '../KittenTTSError';

export const DEFAULT_BASE_URL = 'https://api.kittenml.com/v1';

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_RETRIES = 2;
// A Retry-After longer than this is handed back to the caller instead of slept on.
const MAX_RETRY_WAIT_SECONDS = 60;

/** The parts of a fetch `Response` the client uses. */
export interface FetchResponseLike {
  readonly ok: boolean;
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body?: unknown;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
  blob?(): Promise<unknown>;
}

/**
 * A `fetch` implementation: the global one unless you pass your own, such as
 * `fetch` from `expo/fetch`, which streams on iOS and Android. `init` is typed
 * loosely so that any fetch's own init type fits.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FetchLike = (url: string, init: any) => Promise<FetchResponseLike>;

/** The parts of an `AbortSignal` the client uses. */
export interface AbortSignalLike {
  readonly aborted: boolean;
  addEventListener(type: 'abort', listener: () => void): void;
  removeEventListener(type: 'abort', listener: () => void): void;
}

/** How to reach the Kitten API. */
export interface KittenAPIOptions {
  /**
   * Your Kitten API key, from https://platform.kittenml.com/developers/api-keys.
   * A key in an app can be extracted from it: ship with `baseUrl` pointing at
   * your own backend instead, which adds the key.
   */
  apiKey?: string;
  /** API root. Defaults to `https://api.kittenml.com/v1`. */
  baseUrl?: string;
  /** Extra headers sent with every request, e.g. your own session token. */
  headers?: Record<string, string>;
  /** Per-request timeout in milliseconds. Defaults to 300000 (5 minutes). */
  timeoutMs?: number;
  /** Retries for rate limits and temporary server errors. Defaults to 2. */
  maxRetries?: number;
  /** Replaces the global `fetch`. */
  fetch?: FetchLike;
}

/** A file to upload, already read into memory. */
export interface UploadFile {
  bytes: Uint8Array;
  name: string;
  type: string;
}

interface RequestInit {
  method: 'GET' | 'POST';
  json?: unknown;
  form?: { fields: Record<string, string>; fileField: string; file: UploadFile };
  /** Only for requests that change nothing: a lost connection is retried too. */
  idempotent?: boolean;
}

interface Platform {
  fetch?: FetchLike;
  navigator?: { product?: string };
  AbortController?: new () => { signal: AbortSignalLike; abort(): void };
  FileReader?: new () => {
    result: unknown;
    onload: (() => void) | null;
    onerror: (() => void) | null;
    readAsDataURL(blob: unknown): void;
  };
  TextEncoder?: new () => { encode(text: string): Uint8Array };
}

const platform = globalThis as unknown as Platform;

/** An open response. Call `release()` once its body has been read. */
export interface OpenResponse {
  response: FetchResponseLike;
  requestId?: string;
  /** Stop the timeout: for streams, which may legitimately run long. */
  clearTimeout(): void;
  release(): void;
  /** Turn an error thrown while reading the body into a {@link KittenTTSError}. */
  failure(error: unknown): unknown;
}

/** Talks to the Kitten API. Holds the key in a runtime-private field. */
export class KittenAPI {
  readonly baseUrl: string;
  /** Replaced in tests so retries do not slow them down. */
  sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

  // Runtime-private, unlike TypeScript's `private`: an instance that gets
  // logged, serialised or attached to a crash report must not carry the key.
  readonly #apiKey?: string;
  readonly #headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetch: FetchLike;
  private readonly customFetch: boolean;
  private readonly closed?: { signal: AbortSignalLike; abort(): void };

  constructor(options: KittenAPIOptions) {
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
    const origin = /^(https?):\/\/(\[[^\]]+\]|[^/:?#]+)/i.exec(this.baseUrl);
    if (!origin) {
      throw KittenTTSError.invalidArgument('baseUrl must be an http(s) URL such as https://api.kittenml.com/v1');
    }

    const apiKey = options.apiKey?.trim();
    if (!apiKey && options.baseUrl === undefined) {
      throw KittenTTSError.invalidArgument(
        'Kitten TTS 2 runs on the Kitten API: pass apiKey, or baseUrl for your own backend that adds the key. ' +
        'Create a key at https://platform.kittenml.com/developers/api-keys',
      );
    }
    if (apiKey) {
      // eslint-disable-next-line no-control-regex
      if (/[\s\x00-\x1f\x7f]/.test(apiKey)) {
        throw KittenTTSError.invalidArgument('The API key contains whitespace or control characters.');
      }
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin[2].toLowerCase());
      if (origin[1].toLowerCase() === 'http' && !loopback) {
        throw KittenTTSError.invalidArgument('Refusing to send an API key over plain http. Use an https baseUrl.');
      }
    }

    const fetchImpl = options.fetch ?? platform.fetch;
    if (!fetchImpl) {
      throw KittenTTSError.invalidArgument('No fetch implementation is available. Pass one as the fetch option.');
    }
    this.#apiKey = apiKey || undefined;
    // Called unbound: window.fetch throws "Illegal invocation" as a method of this.
    this.fetch = (url, init) => fetchImpl(url, init);
    this.customFetch = options.fetch !== undefined;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES);
    this.#headers = { Accept: '*/*', ...options.headers };
    this.closed = platform.AbortController ? new platform.AbortController() : undefined;
  }

  /** Cancel every request in flight, and refuse new ones. */
  close(): void {
    this.closed?.abort();
  }

  /**
   * Send a request, retrying rate limits and temporary server errors, and
   * return the successful response. Redirects are followed: the API answers
   * with one while a generation waits for capacity.
   */
  async open(path: string, init: RequestInit, signal?: AbortSignalLike): Promise<OpenResponse> {
    const headers = { ...this.#headers };
    if (this.#apiKey) headers.Authorization = `Bearer ${this.#apiKey}`;
    let body: unknown;
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    } else if (init.form) {
      // Encoded here rather than by FormData: runtimes disagree about file
      // parts (React Native wants { uri }, Expo's fetch rejects it), but every
      // fetch can send bytes.
      const upload = encodeMultipart(init.form.fields, init.form.fileField, init.form.file);
      headers['Content-Type'] = upload.contentType;
      body = upload.body;
    }

    for (let attempt = 0; ; attempt += 1) {
      const scope = new RequestScope(this.timeoutMs, signal, this.closed?.signal);
      try {
        let response: FetchResponseLike;
        try {
          response = await this.fetch(`${this.baseUrl}${path}`, {
            method: init.method,
            headers,
            body,
            signal: scope.signal,
          });
        } catch (error) {
          throw scope.failure(error);
        }
        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw apiError(response.status, text, response.headers);
        }
        return {
          response,
          requestId: response.headers.get('x-request-id') ?? undefined,
          clearTimeout: () => scope.clearTimeout(),
          release: () => scope.release(),
          failure: error => scope.failure(error),
        };
      } catch (error) {
        scope.release();
        const wait = this.retryWaitMs(error, attempt, init.idempotent === true);
        if (wait === undefined) throw error;
        await this.sleep(wait);
      }
    }
  }

  /** GET a JSON document. */
  async getJson(path: string, signal?: AbortSignalLike): Promise<Record<string, unknown>> {
    const open = await this.open(path, { method: 'GET', idempotent: true }, signal);
    try {
      const text = await open.response.text();
      try {
        const payload = JSON.parse(text);
        if (typeof payload === 'object' && payload !== null) return payload;
      } catch {
        // Reported below.
      }
      throw new KittenAPIError(
        KittenTTSErrorCode.ApiError,
        'The Kitten API returned a response that is not JSON.',
        { status: open.response.status, requestId: open.requestId },
      );
    } catch (error) {
      throw open.failure(error);
    } finally {
      open.release();
    }
  }

  /** The whole response body as bytes, on every platform. */
  async readBytes(response: FetchResponseLike): Promise<Uint8Array> {
    // React Native's classic fetch cannot produce an ArrayBuffer on every
    // supported version, but it can always read a Blob out as a data URL. A
    // fetch that streams (Expo's, the web's) is a native one: trust arrayBuffer().
    const classicReactNativeFetch =
      !this.customFetch && platform.navigator?.product === 'ReactNative' && !hasBodyReader(response);
    if (classicReactNativeFetch && platform.FileReader && typeof response.blob === 'function') {
      return blobBytes(await response.blob());
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /** The body as it arrives, or in one piece where fetch cannot stream. */
  async *readChunks(response: FetchResponseLike): AsyncGenerator<Uint8Array, void, void> {
    if (!hasBodyReader(response)) {
      yield await this.readBytes(response);
      return;
    }
    const reader = (response.body as { getReader(): Reader }).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        if (value && value.byteLength > 0) yield value;
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
  }

  private retryWaitMs(error: unknown, attempt: number, idempotent: boolean): number | undefined {
    if (attempt >= this.maxRetries || !(error instanceof KittenAPIError)) return undefined;
    // A lost connection may have reached the model, and a second generation is
    // billed again, so only requests that change nothing are retried for it.
    const transient = error.status === undefined
      ? idempotent && error.code === KittenTTSErrorCode.NetworkError
      : error.status === 429 || error.status >= 500;
    if (!transient) return undefined;

    const backoff = Math.min(8000, 500 * 2 ** attempt) * (1 + Math.random() * 0.25);
    if (error.retryAfter === undefined) return backoff;
    if (error.retryAfter > MAX_RETRY_WAIT_SECONDS) return undefined;
    return Math.max(backoff, error.retryAfter * 1000);
  }
}

interface Reader {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
  cancel(): Promise<unknown>;
}

function hasBodyReader(response: FetchResponseLike): boolean {
  const body = response.body as { getReader?: unknown } | null | undefined;
  return typeof body?.getReader === 'function';
}

/** One attempt's timeout, linked to the caller's signal and to `close()`. */
class RequestScope {
  readonly signal: unknown;
  private timedOut = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly controller?: { signal: AbortSignalLike; abort(): void };
  private readonly onAbort = () => this.controller?.abort();

  constructor(
    timeoutMs: number,
    private readonly callerSignal?: AbortSignalLike,
    private readonly closedSignal?: AbortSignalLike,
  ) {
    this.controller = platform.AbortController ? new platform.AbortController() : undefined;
    this.signal = this.controller?.signal;
    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.controller?.abort();
    }, timeoutMs);
    for (const signal of [callerSignal, closedSignal]) {
      signal?.addEventListener('abort', this.onAbort);
      if (signal?.aborted) this.controller?.abort();
    }
  }

  clearTimeout(): void {
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }

  release(): void {
    this.clearTimeout();
    this.callerSignal?.removeEventListener('abort', this.onAbort);
    this.closedSignal?.removeEventListener('abort', this.onAbort);
  }

  /** Name a transport failure; SDK errors pass through unchanged. */
  failure(error: unknown): unknown {
    if (error instanceof KittenTTSError) return error;
    if (this.closedSignal?.aborted) {
      return new KittenAPIError(KittenTTSErrorCode.Cancelled, 'The request was cancelled by dispose().', { cause: error });
    }
    if (this.callerSignal?.aborted) {
      return new KittenAPIError(KittenTTSErrorCode.Cancelled, 'The request was cancelled.', { cause: error });
    }
    if (this.timedOut) {
      return new KittenAPIError(KittenTTSErrorCode.NetworkError, 'The Kitten API request timed out.', { cause: error });
    }
    const reason = error instanceof Error ? error.message : String(error);
    return new KittenAPIError(
      KittenTTSErrorCode.NetworkError,
      `The connection to the Kitten API failed: ${reason}`,
      { cause: error },
    );
  }
}

/** Both error shapes the API uses: its envelope, and FastAPI's `detail`. */
function apiError(
  status: number,
  body: string,
  headers: { get(name: string): string | null },
): KittenAPIError {
  let message: string | undefined;
  let apiCode: string | undefined;
  let type: string | undefined;
  let param: string | undefined;
  let requestId = headers.get('x-request-id') ?? undefined;

  try {
    const payload = JSON.parse(body) as Record<string, unknown>;
    const error = payload.error;
    if (typeof error === 'object' && error !== null) {
      const fields = error as Record<string, unknown>;
      message = stringOrUndefined(fields.message);
      apiCode = stringOrUndefined(fields.code);
      type = stringOrUndefined(fields.type);
      param = stringOrUndefined(fields.param);
    } else if (typeof payload.detail === 'string') {
      message = payload.detail;
    } else if (Array.isArray(payload.detail)) {
      const problems = payload.detail.filter(item => typeof item === 'object' && item !== null) as {
        loc?: unknown[];
        msg?: unknown;
      }[];
      message = problems
        .map(problem => {
          const field = (problem.loc ?? []).filter(part => part !== 'body').join('.');
          return field ? `${field}: ${String(problem.msg)}` : String(problem.msg);
        })
        .join('; ');
      const last = problems[0]?.loc?.[problems[0].loc.length - 1];
      param = typeof last === 'string' && last !== 'body' ? last : undefined;
    }
    requestId = stringOrUndefined(payload.request_id) ?? requestId;
  } catch {
    // Not JSON: a proxy's error page, say.
  }

  message = message || body.trim().slice(0, 200) || `HTTP ${status}`;
  return new KittenAPIError(KittenTTSErrorCode.ApiError, `Kitten API error ${status}: ${message}`, {
    status,
    apiCode,
    type,
    param,
    requestId,
    retryAfter: retryAfterSeconds(headers.get('retry-after')),
  });
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

function retryAfterSeconds(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, (date - Date.now()) / 1000);
}

function encodeMultipart(
  fields: Record<string, string>,
  fileField: string,
  file: UploadFile,
): { body: Uint8Array; contentType: string } {
  const boundary = `----KittenTTS${Math.random().toString(16).slice(2)}${Date.now().toString(16)}`;
  // The escaping browsers apply to multipart header parameters; it also stops
  // a crafted file name from injecting headers.
  const quote = (value: string) => value.replace(/"/g, '%22').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

  let head = '';
  for (const [name, value] of Object.entries(fields)) {
    head += `--${boundary}\r\nContent-Disposition: form-data; name="${quote(name)}"\r\n\r\n${value}\r\n`;
  }
  head += `--${boundary}\r\nContent-Disposition: form-data; name="${quote(fileField)}"; ` +
    `filename="${quote(file.name)}"\r\nContent-Type: ${quote(file.type)}\r\n\r\n`;

  const prefix = utf8(head);
  const suffix = utf8(`\r\n--${boundary}--\r\n`);
  const body = new Uint8Array(prefix.byteLength + file.bytes.byteLength + suffix.byteLength);
  body.set(prefix, 0);
  body.set(file.bytes, prefix.byteLength);
  body.set(suffix, prefix.byteLength + file.bytes.byteLength);
  return { body, contentType: `multipart/form-data; boundary=${boundary}` };
}

function utf8(text: string): Uint8Array {
  if (platform.TextEncoder) return new platform.TextEncoder().encode(text);
  // Older Hermes has no TextEncoder.
  const escaped = unescape(encodeURIComponent(text));
  const bytes = new Uint8Array(escaped.length);
  for (let index = 0; index < escaped.length; index += 1) bytes[index] = escaped.charCodeAt(index);
  return bytes;
}

/** A Blob's bytes through FileReader, which React Native has always implemented. */
export function blobBytes(blob: unknown): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const FileReader = platform.FileReader;
    if (!FileReader) {
      reject(new Error('FileReader is not available.'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve(base64ToUint8Array(dataUrl.slice(dataUrl.indexOf(',') + 1)));
    };
    reader.onerror = () => reject(new Error('Could not read the audio data.'));
    reader.readAsDataURL(blob);
  });
}
