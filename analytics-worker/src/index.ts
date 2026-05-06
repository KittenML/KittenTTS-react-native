export interface Env {
  DB: D1Database;
  EVENT_SALT?: string;
  ALLOWED_ORIGIN?: string;
  ENVIRONMENT?: string;
}

type PlatformName = 'ios' | 'android' | 'unknown';
type AppRuntime = 'expo' | 'bare-react-native' | 'unknown';
type PlaybackHelper = 'expo-audio' | 'react-native-sound' | 'custom' | 'none';
type AssetSource = 'bundled' | 'runtime-download' | 'cache';

interface IncomingBody {
  events?: unknown;
}

interface AnalyticsEvent {
  name: EventName;
  anonymousId: string;
  timestamp: string;
  sdkVersion: string;
  platform: PlatformName;
  reactNativeVersion: string | null;
  appRuntime: AppRuntime;
  model: string | null;
  voice: string | null;
  playbackHelper: PlaybackHelper | null;
  assetSource: AssetSource | null;
  cacheHit: boolean | null;
  errorCode: string | null;
}

type EventName =
  | 'sdk_initialized'
  | 'model_download_succeeded'
  | 'model_download_failed'
  | 'inference_succeeded'
  | 'inference_failed'
  | 'voice_played'
  | 'playback_failed';

const EVENT_NAMES = new Set<EventName>([
  'sdk_initialized',
  'model_download_succeeded',
  'model_download_failed',
  'inference_succeeded',
  'inference_failed',
  'voice_played',
  'playback_failed',
]);

const PLATFORMS = new Set<PlatformName>(['ios', 'android', 'unknown']);
const RUNTIMES = new Set<AppRuntime>(['expo', 'bare-react-native', 'unknown']);
const PLAYBACK_HELPERS = new Set<PlaybackHelper>([
  'expo-audio',
  'react-native-sound',
  'custom',
  'none',
]);
const ASSET_SOURCES = new Set<AssetSource>(['bundled', 'runtime-download', 'cache']);

const MAX_BODY_BYTES = 16 * 1024;
const MAX_EVENTS_PER_REQUEST = 20;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(env) });
    }

    if (request.method === 'GET' && url.pathname === '/health') {
      return json({ ok: true, environment: env.ENVIRONMENT ?? 'unknown' }, env);
    }

    if (request.method === 'POST' && url.pathname === '/v1/events') {
      return ingestEvents(request, env);
    }

    return json({ error: 'not_found' }, env, 404);
  },
};

async function ingestEvents(request: Request, env: Env): Promise<Response> {
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: 'payload_too_large' }, env, 413);
  }

  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return json({ error: 'payload_too_large' }, env, 413);
  }

  let body: IncomingBody;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, env, 400);
  }

  const eventsInput = Array.isArray(body.events) ? body.events : [];
  if (eventsInput.length === 0 || eventsInput.length > MAX_EVENTS_PER_REQUEST) {
    return json({ error: 'invalid_event_count' }, env, 400);
  }

  const events: AnalyticsEvent[] = [];
  for (const eventInput of eventsInput) {
    const parsed = parseEvent(eventInput);
    if (!parsed.ok) return json({ error: parsed.error }, env, 400);
    events.push(parsed.event);
  }

  for (const event of events) {
    await writeEvent(env, event);
  }

  return json({ ok: true, accepted: events.length }, env);
}

type ParseResult =
  | { ok: true; event: AnalyticsEvent }
  | { ok: false; error: string };

function parseEvent(input: unknown): ParseResult {
  if (!input || typeof input !== 'object') {
    return { ok: false, error: 'invalid_event' };
  }

  const record = input as Record<string, unknown>;
  const name = enumValue(record.name, EVENT_NAMES);
  const anonymousId = cleanString(record.anonymousId, 128);
  const sdkVersion = cleanString(record.sdkVersion, 32);
  const platform = enumValue(record.platform, PLATFORMS) ?? 'unknown';
  const appRuntime = enumValue(record.appRuntime, RUNTIMES) ?? 'unknown';

  if (!name || !anonymousId || !sdkVersion) {
    return { ok: false, error: 'missing_required_fields' };
  }

  return {
    ok: true,
    event: {
      name,
      anonymousId,
      timestamp: parseTimestamp(record.timestamp),
      sdkVersion,
      platform,
      appRuntime,
      reactNativeVersion: cleanString(record.reactNativeVersion, 32),
      model: cleanString(record.model, 96),
      voice: cleanString(record.voice, 64),
      playbackHelper: enumValue(record.playbackHelper, PLAYBACK_HELPERS),
      assetSource: enumValue(record.assetSource, ASSET_SOURCES),
      cacheHit: typeof record.cacheHit === 'boolean' ? record.cacheHit : null,
      errorCode: cleanString(record.errorCode, 64),
    },
  };
}

async function writeEvent(env: Env, event: AnalyticsEvent): Promise<void> {
  const eventDate = event.timestamp.slice(0, 10);
  const anonymousIdHash = await hashAnonymousId(event.anonymousId, env.EVENT_SALT);
  const eventId = await hashAnonymousId(
    `${event.anonymousId}:${event.timestamp}:${event.name}:${crypto.randomUUID()}`,
    env.EVENT_SALT,
  );
  const cacheHitValue = event.cacheHit === null ? null : event.cacheHit ? 1 : 0;

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO raw_events (
        event_id,
        event_name,
        event_date,
        anonymous_id_hash,
        sdk_version,
        platform,
        app_runtime,
        react_native_version,
        model,
        voice,
        playback_helper,
        asset_source,
        cache_hit,
        error_code,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
    ).bind(
      eventId,
      event.name,
      eventDate,
      anonymousIdHash,
      event.sdkVersion,
      event.platform,
      event.appRuntime,
      event.reactNativeVersion,
      event.model,
      event.voice,
      event.playbackHelper,
      event.assetSource,
      cacheHitValue,
      event.errorCode,
    ),
    env.DB.prepare(
      `INSERT INTO daily_metrics (
        event_date,
        event_name,
        sdk_version,
        platform,
        app_runtime,
        model,
        voice,
        playback_helper,
        asset_source,
        cache_hit,
        error_code,
        count
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
      ON CONFLICT (
        event_date,
        event_name,
        sdk_version,
        platform,
        app_runtime,
        model,
        voice,
        playback_helper,
        asset_source,
        cache_hit,
        error_code
      ) DO UPDATE SET count = count + 1`,
    ).bind(
      eventDate,
      event.name,
      event.sdkVersion,
      event.platform,
      event.appRuntime,
      event.model ?? '',
      event.voice ?? '',
      event.playbackHelper ?? '',
      event.assetSource ?? '',
      cacheHitValue ?? -1,
      event.errorCode ?? '',
    ),
  ]);
}

function cleanString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[^\w .:/@+-]/g, '').slice(0, maxLength);
}

function enumValue<T extends string>(
  value: unknown,
  allowed: Set<T>,
): T | null {
  if (typeof value !== 'string') return null;
  return allowed.has(value as T) ? value as T : null;
}

function parseTimestamp(value: unknown): string {
  if (typeof value !== 'string') return new Date().toISOString();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

async function hashAnonymousId(value: string, salt = ''): Promise<string> {
  const encoded = new TextEncoder().encode(`${salt}:${value}`);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function json(
  body: unknown,
  env: Env,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...corsHeaders(env),
    },
  });
}

function corsHeaders(env: Env): HeadersInit {
  return {
    'access-control-allow-origin': env.ALLOWED_ORIGIN || '*',
    'access-control-allow-methods': 'POST, OPTIONS, GET',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
  };
}
