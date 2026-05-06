# Analytics

KittenTTS collects anonymous SDK analytics by default. The goal is to understand
which platforms, models, and SDK paths are working in real apps so compatibility
issues can be fixed faster.

Analytics must never include input text, generated audio, phonemes, tokens, file
paths, app user IDs, advertising IDs, or stack traces.

## Collected Events

- SDK initialization.
- Selected model and voice.
- Platform: iOS, Android, or unknown.
- React Native version when available.
- SDK version.
- Expo vs bare React Native when detectable.
- Model asset source: bundled, runtime download, or cache.
- Model download success/failure.
- Inference success/failure.
- Playback helper: Expo Audio, React Native Sound, custom, or none.

## Disable Analytics

Disable analytics for one SDK instance:

```tsx
const tts = await KittenTTS.create({
  analytics: false,
});
```

Disable analytics globally before creating instances:

```tsx
KittenTTS.configureAnalytics(false);
```

## Custom Endpoint

The default endpoint is
`https://kittentts-analytics.dewana-sl.workers.dev/v1/events`.

Use a different endpoint when developing or self-hosting the analytics Worker:

```tsx
KittenTTS.configureAnalytics({
  endpoint: 'http://localhost:8787/v1/events',
  debug: true,
});
```

Per-instance configuration also works:

```tsx
const tts = await KittenTTS.create({
  analytics: {
    endpoint: 'https://your-worker.example.com/v1/events',
  },
});
```

## Server

The Cloudflare Worker implementation lives in
[`analytics-worker`](../../analytics-worker). It uses D1 for raw events and
daily aggregate metrics.
