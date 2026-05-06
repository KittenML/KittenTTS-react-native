import * as RNFS from 'react-native-fs';
import { NativeModules, Platform } from 'react-native';
import { KittenModel } from '../KittenModel';
import { KittenVoice } from '../KittenVoice';
import { KITTENTTS_SDK_VERSION } from './SDKVersion';

export type KittenTTSAnalyticsPlaybackHelper =
  | 'expo-audio'
  | 'react-native-sound'
  | 'custom'
  | 'none';

export type KittenTTSAnalyticsRuntime = 'expo' | 'bare-react-native' | 'unknown';
export type KittenTTSAnalyticsAssetSource = 'bundled' | 'runtime-download' | 'cache';

export interface KittenTTSAnalyticsOptions {
  /** Enable or disable SDK analytics. Defaults to true. */
  enabled?: boolean;
  /** Override the analytics ingestion endpoint. */
  endpoint?: string;
  /** Log analytics payloads and transport failures to the console. */
  debug?: boolean;
  /** Optional app-scoped anonymous ID. KittenTTS creates one when omitted. */
  anonymousId?: string;
}

export type KittenTTSAnalyticsConfig = boolean | KittenTTSAnalyticsOptions;

export interface ResolvedKittenTTSAnalyticsOptions {
  enabled: boolean;
  endpoint: string;
  debug: boolean;
  anonymousId?: string;
}

export type KittenTTSAnalyticsEventName =
  | 'sdk_initialized'
  | 'model_download_succeeded'
  | 'model_download_failed'
  | 'inference_succeeded'
  | 'inference_failed'
  | 'voice_played'
  | 'playback_failed';

export interface KittenTTSAnalyticsEventProperties {
  model?: KittenModel;
  voice?: KittenVoice;
  playbackHelper?: KittenTTSAnalyticsPlaybackHelper;
  assetSource?: KittenTTSAnalyticsAssetSource;
  cacheHit?: boolean;
  errorCode?: string;
}

const DEFAULT_ANALYTICS_ENDPOINT =
  'https://kittentts-analytics.dewana-sl.workers.dev/v1/events';
const ANALYTICS_FILE_NAME = 'analytics.json';
const REQUEST_TIMEOUT_MS = 1500;

let globalAnalyticsOptions: KittenTTSAnalyticsOptions = {};

export function configureGlobalAnalytics(
  options: KittenTTSAnalyticsConfig,
): void {
  globalAnalyticsOptions = normalizeAnalyticsConfig(options);
}

export function resolveAnalyticsOptions(
  config?: KittenTTSAnalyticsConfig,
): ResolvedKittenTTSAnalyticsOptions {
  const local = normalizeAnalyticsConfig(config);
  return {
    enabled: local.enabled ?? globalAnalyticsOptions.enabled ?? true,
    endpoint:
      local.endpoint ??
      globalAnalyticsOptions.endpoint ??
      DEFAULT_ANALYTICS_ENDPOINT,
    debug: local.debug ?? globalAnalyticsOptions.debug ?? false,
    anonymousId: local.anonymousId ?? globalAnalyticsOptions.anonymousId,
  };
}

export class KittenTTSAnalyticsClient {
  private readonly options: ResolvedKittenTTSAnalyticsOptions;
  private readonly storageDirectory: string;
  private readonly baseContext: AnalyticsBaseContext;
  private anonymousIdPromise: Promise<string> | null = null;

  constructor(options: {
    analytics: ResolvedKittenTTSAnalyticsOptions;
    storageDirectory: string;
    model: KittenModel;
    defaultVoice: KittenVoice;
    playbackHelper: KittenTTSAnalyticsPlaybackHelper;
    assetSource: KittenTTSAnalyticsAssetSource;
  }) {
    this.options = options.analytics;
    this.storageDirectory = options.storageDirectory;
    this.baseContext = {
      sdkVersion: KITTENTTS_SDK_VERSION,
      platform: normalizePlatform(Platform.OS),
      reactNativeVersion: reactNativeVersion(),
      appRuntime: detectRuntime(),
      model: options.model,
      defaultVoice: options.defaultVoice,
      playbackHelper: options.playbackHelper,
      assetSource: options.assetSource,
    };
  }

  track(
    name: KittenTTSAnalyticsEventName,
    properties: KittenTTSAnalyticsEventProperties = {},
  ): void {
    if (!this.options.enabled) return;

    void this.send(name, properties).catch((error) => {
      if (this.options.debug) {
        console.warn('[KittenTTS analytics] event dropped', error);
      }
    });
  }

  private async send(
    name: KittenTTSAnalyticsEventName,
    properties: KittenTTSAnalyticsEventProperties,
  ): Promise<void> {
    const anonymousId = this.options.anonymousId ?? await this.getAnonymousId();
    const payload = {
      events: [
        {
          name,
          anonymousId,
          timestamp: new Date().toISOString(),
          sdkVersion: this.baseContext.sdkVersion,
          platform: this.baseContext.platform,
          reactNativeVersion: this.baseContext.reactNativeVersion,
          appRuntime: this.baseContext.appRuntime,
          model: properties.model ?? this.baseContext.model,
          voice: properties.voice ?? this.baseContext.defaultVoice,
          playbackHelper:
            properties.playbackHelper ?? this.baseContext.playbackHelper,
          assetSource: properties.assetSource ?? this.baseContext.assetSource,
          cacheHit: properties.cacheHit,
          errorCode: properties.errorCode,
        },
      ],
    };

    if (this.options.debug) {
      console.log('[KittenTTS analytics]', JSON.stringify(payload));
    }

    const response = await withTimeout(
      fetch(this.options.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
      }),
      REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      throw new Error(`Analytics request failed with HTTP ${response.status}`);
    }
  }

  private getAnonymousId(): Promise<string> {
    if (!this.anonymousIdPromise) {
      this.anonymousIdPromise = loadOrCreateAnonymousId(this.storageDirectory);
    }
    return this.anonymousIdPromise;
  }
}

interface AnalyticsBaseContext {
  sdkVersion: string;
  platform: 'ios' | 'android' | 'unknown';
  reactNativeVersion: string;
  appRuntime: KittenTTSAnalyticsRuntime;
  model: KittenModel;
  defaultVoice: KittenVoice;
  playbackHelper: KittenTTSAnalyticsPlaybackHelper;
  assetSource: KittenTTSAnalyticsAssetSource;
}

function normalizeAnalyticsConfig(
  config?: KittenTTSAnalyticsConfig,
): KittenTTSAnalyticsOptions {
  if (typeof config === 'boolean') return { enabled: config };
  return config ?? {};
}

function normalizePlatform(os: string): 'ios' | 'android' | 'unknown' {
  if (os === 'ios' || os === 'android') return os;
  return 'unknown';
}

function reactNativeVersion(): string {
  const constants = Platform.constants as {
    reactNativeVersion?: {
      major?: number;
      minor?: number;
      patch?: number;
      prerelease?: string | null;
    };
  };
  const version = constants.reactNativeVersion;
  if (!version) return 'unknown';
  const base = `${version.major ?? 0}.${version.minor ?? 0}.${version.patch ?? 0}`;
  return version.prerelease ? `${base}-${version.prerelease}` : base;
}

function detectRuntime(): KittenTTSAnalyticsRuntime {
  const modules = NativeModules as Record<string, unknown>;
  if (modules.ExponentConstants || modules.ExpoConstants) return 'expo';
  return 'bare-react-native';
}

async function loadOrCreateAnonymousId(storageDirectory: string): Promise<string> {
  const analyticsPath = `${storageDirectory}/${ANALYTICS_FILE_NAME}`;
  try {
    const raw = await RNFS.readFile(analyticsPath, 'utf8');
    const parsed = JSON.parse(raw) as { anonymousId?: unknown };
    if (typeof parsed.anonymousId === 'string' && parsed.anonymousId.length >= 16) {
      return parsed.anonymousId;
    }
  } catch {
    // Missing or invalid analytics state is repaired below.
  }

  const anonymousId = createAnonymousId();
  try {
    await RNFS.mkdir(storageDirectory);
    await RNFS.writeFile(
      analyticsPath,
      JSON.stringify({ anonymousId }),
      'utf8',
    );
  } catch {
    // Analytics must never block SDK setup. Fall back to a session-scoped ID.
  }
  return anonymousId;
}

function createAnonymousId(): string {
  return [
    Date.now().toString(36),
    Math.random().toString(36).slice(2),
    Math.random().toString(36).slice(2),
  ].join('-');
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`Analytics request timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}
