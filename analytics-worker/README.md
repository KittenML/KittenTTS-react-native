# KittenTTS Analytics Worker

This Cloudflare Worker receives anonymous SDK analytics from
`@kittentts/react-native` and stores both raw events and daily aggregates in D1.

The endpoint is intentionally public because mobile SDK secrets can be extracted
from app bundles. Protection comes from strict validation, a small request body,
an event-name allowlist, and never accepting text, audio, local file paths, stack
traces, or app user IDs.

## What It Collects

- SDK initialized.
- Selected model and voice.
- Platform: iOS, Android, or unknown.
- React Native version when available.
- SDK version.
- Expo vs bare React Native when detectable.
- Model asset source: bundled, runtime download, or cache.
- Model download success/failure.
- Inference success/failure.
- Playback helper: Expo Audio, React Native Sound, custom, or none.

It does not collect input text, generated audio, phonemes, tokens, file paths,
advertising IDs, app user IDs, or stack traces.

## Cloudflare Setup

Create the Worker and D1 database from this folder:

```bash
cd analytics-worker
npm install
npx wrangler login
npx wrangler d1 create kittentts_analytics
```

Copy the generated `database_id` into `wrangler.jsonc`, replacing
`REPLACE_WITH_D1_DATABASE_ID`.

Apply the schema:

```bash
npm run db:migrate:remote
```

Set a salt used to hash SDK anonymous IDs before they are stored:

```bash
npx wrangler secret put EVENT_SALT
```

Deploy:

```bash
npm run deploy
```

The SDK default endpoint is:

```text
https://kittentts-analytics.dewana-sl.workers.dev/v1/events
```

Add a Cloudflare route or custom domain for that hostname, or override the SDK
endpoint:

```ts
KittenTTS.configureAnalytics({
  endpoint: 'https://your-worker.your-subdomain.workers.dev/v1/events',
});
```

## Local Development

```bash
cd analytics-worker
npm install
npm run db:migrate:local
npm run dev
```

Send a test event:

```bash
curl -X POST http://localhost:8787/v1/events \
  -H 'content-type: application/json' \
  -d '{
    "events": [
      {
        "name": "sdk_initialized",
        "anonymousId": "local-test",
        "sdkVersion": "1.2.0",
        "platform": "ios",
        "appRuntime": "expo",
        "model": "kitten-tts-nano-0.8-int8",
        "voice": "expr-voice-2-f",
        "playbackHelper": "expo-audio",
        "assetSource": "runtime-download"
      }
    ]
  }'
```

## Useful Queries

Daily event counts:

```bash
npx wrangler d1 execute kittentts_analytics --remote --command \
  "SELECT event_date, event_name, SUM(count) AS count FROM daily_metrics GROUP BY 1, 2 ORDER BY 1 DESC, 2"
```

Model usage:

```bash
npx wrangler d1 execute kittentts_analytics --remote --command \
  "SELECT model, SUM(count) AS count FROM daily_metrics WHERE model != '' GROUP BY 1 ORDER BY count DESC"
```
