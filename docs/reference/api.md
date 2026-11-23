# API Reference

This page lists the main public APIs. The TypeScript types in the package are
the source of truth.

## `KittenTTS.create(options?, onProgress?)`

Creates and initializes a TTS instance. It resolves config, prepares the
phonemizer, loads or downloads model assets, reads `voices.npz`, and creates the
ONNX Runtime session.

```tsx
const tts = await KittenTTS.create({
  model: KittenModel.NanoInt8,
  defaultVoice: KittenVoice.Luna,
  speed: 1.1,
  player: createExpoAudioPlayer(ExpoAudio),
});
```

The progress callback receives a number from `0` to `1`. The optional second
argument describes the current stage:

```tsx
const tts = await KittenTTS.create(options, (progress, info) => {
  if (info?.stage === 'cached') {
    console.log('model is already downloaded');
  }

  console.log(Math.round(progress * 100));
});
```

With `model: 'kitten-tts-2-nano'`, `'kitten-tts-2-pico'` or `'kitten-tts-2-mini'`
it returns a `KittenTTS2Tiny` instead: see
[Kitten TTS 2 Nano, Pico and Mini](../guides/kitten-tts-2-tiny.md) for its options
(`weights`, `languages`, `modelDirectory`, `textDataDirectory`, `hfToken`, ...) and
methods (`generate(text, { voice, language, speed })`, `generateStreaming`,
`generateToFile`, `phonemize`, `voices`, `availableVoices`, `onnxWeights`).

With `model: 'kitten-tts-2-cloud'` (or `'kitten-tts-2'`), or any Kitten TTS 2 model and an `apiKey` or
`baseUrl`, it returns a `KittenTTS2`, which runs on the Kitten API: see the
[Kitten API guide](../guides/kitten-api.md). The model picks the engine, as in the
Python package:

| `model` | Without a key | With `apiKey` or `baseUrl` |
| --- | --- | --- |
| 0.8 models (default) | `KittenTTS`, on the device | `KittenTTS`, on the device |
| `'kitten-tts-2-nano'`, `'-pico'`, `'-mini'` | `KittenTTS2Tiny`, on the device | `KittenTTS2`, on the API |
| `'kitten-tts-2-cloud'` (or `'kitten-tts-2'`) | error: it runs on the API only | `KittenTTS2`, on the API |

All three have `generate()`, `generateStreaming()`, `speak()`, `play()`,
`stopSpeaking()` and `dispose()`.

## Common Options

| Option | Default | Description |
| --- | --- | --- |
| `model` | `KittenModel.Nano` | Model variant |
| `defaultVoice` | `KittenVoice.Bella` | Voice used when omitted |
| `speed` | `1.0` | Speech speed from `0.5` to `2.0` |
| `storageDirectory` | Document directory | Custom model cache root |
| `modelBaseURL` | Hugging Face URL | Custom mirror/self-hosted model directory |
| `modelFiles` | none | Local ONNX and `voices.npz` paths/data |
| `downloadRetries` | `4` | Total download attempts per model file |
| `ortNumThreads` | `4` | ONNX Runtime thread count |
| `maxTokensPerChunk` | `400` | Long-text chunk size |
| `trimTrailingSilence` | `true` | Trim near-silent audio at chunk ends |
| `silenceThreshold` | `0.005` | Amplitude threshold for silence trimming |
| `maxSilenceTrimMs` | `250` | Maximum trailing silence removed per chunk |
| `phonemizer` | `CEPhonemizer` | Custom text-to-IPA converter |
| `forceRedownload` | `false` | Redownload model files before creating |
| `player` | none | Required for `speak()` and `play()` |

## `tts.generate(text, voice?, speed?)`

Synthesizes speech and returns a `KittenTTSResult` without playing it.

```tsx
const result = await tts.generate('Save this as audio.', KittenVoice.Jasper);
```

`wordTimings` may be empty when duration output is unavailable or when the text
is split across multiple model chunks.

## `tts.generateStreaming(text, voice?, speed?)`

Synthesizes long text sentence by sentence.

```tsx
for await (const chunk of tts.generateStreaming(longText, KittenVoice.Luna)) {
  await tts.play(chunk);
}
```

## `tts.speak(text, voice?, speed?)`

Synthesizes speech and plays it through the configured player.

```tsx
await tts.speak('Play this sentence.', KittenVoice.Rosie, 1.1);
```

## `tts.play(result, options?)`

Plays a previously generated result.

```tsx
const result = await tts.generate('Highlight words while this plays.');

await tts.play(result, {
  onPlaybackStart: () => startWordHighlighting(result.wordTimings),
});
```

## `KittenTTSResult`

| Property or method | Description |
| --- | --- |
| `samples` | Raw mono `Float32Array` PCM |
| `sampleRate` | Always `24000` |
| `duration` | Audio duration in seconds |
| `voice` | Voice used for generation |
| `effectiveSpeed` | Speed after model-specific adjustments |
| `inputText` | Input text that was synthesized |
| `wordTimings` | Per-word `{ wordIndex, word, startTime, endTime }[]` |
| `wavData()` | Complete 16-bit PCM WAV as `Uint8Array` |
| `wavBase64()` | Complete WAV as a base64 string |

## Kitten TTS 2 Cloud: `KittenTTS2`

`KittenTTS.create({ model: 'kitten-tts-2-cloud', ... })` returns a `KittenTTS2`:
Kitten TTS 2 Cloud (and Nano, Pico and Mini with a key) running on the hosted Kitten API, with the same calls as above.
See the [Kitten API guide](../guides/kitten-api.md).

```tsx
const tts = await KittenTTS.create({
  model: 'kitten-tts-2-cloud',
  apiKey: KITTENML_API_KEY,
  player: createExpoAudioPlayer(ExpoAudio),
});

await tts.generate('Hello.', 'bella_en');
await tts.generate('Hello.', { reference: recordingUri, preset: 'stable' });
```

| Option | Default | Description |
| --- | --- | --- |
| `model` | required | `'kitten-tts-2-cloud'` or `'kitten-tts-2'` (Kitten TTS 2 Cloud), `'kitten-tts-2-nano'`, `'-pico'`, `'-mini'`, or a model ID the API lists, such as `'kitten-tts-2-latest'` |
| `apiKey` | none | Kitten API key; for development, see the guide |
| `baseUrl` | `https://api.kittenml.com/v1` | API root, or your own backend that adds the key |
| `headers` | none | Extra headers sent with every request |
| `defaultVoice` | the API's default | Voice used when a call names none |
| `speed` | `1.0` | Speed from `0.25` to `4.0` |
| `timeoutMs` | `300000` | Per-request timeout; streams are timed until they start |
| `maxRetries` | `2` | Retries for `429` and `5xx` responses |
| `fetch` | global `fetch` | Replacement `fetch`, e.g. from `expo/fetch` to stream on iOS and Android |
| `player` | none | Required for `speak()` and `play()` |

| Member | Description |
| --- | --- |
| `generate(text, voice?, speed?)` | Complete speech as a `KittenTTSResult<string>` |
| `generate(text, options)` | With `voice` or `reference`, `referenceText`, `preset`, `temperature`, `topK`, `topP`, `minP`, `maxNewTokens`, `normalize`, `speed`, `signal` |
| `generateStreaming(text, voice?, speed?)` or `(text, options)` | Yields chunks while generating, cut at pauses |
| `speak(...)`, `play(result)`, `stopSpeaking()` | As on the device |
| `availableVoices` | Voice IDs accepted by `voice` |
| `voices` | `{ id, name, language, type, experimental }` for each voice |
| `model` | Model ID sent to the API |
| `sampleRate` | `24000` |
| `dispose()` | Cancels requests in flight and stops playback |

`KittenTTSResult<string>` has the same members as an on-device result; its
`voice` is the voice ID sent, or `''` when the API chose the voice or it was
cloned from `reference`, and `wordTimings` is empty.

## Cache Methods

| Method | Description |
| --- | --- |
| `KittenTTS.isModelCached(config?)` | Checks whether model files exist locally |
| `KittenTTS.isModelDownloaded(config?)` | App-facing alias for model cache checks |
| `KittenTTS.getModelCacheInfo(config?)` | Returns cache paths and file existence |
| `KittenTTS.predownload(config?, onProgress?)` | Downloads model and phonemizer assets |
| `KittenTTS.prewarm(config?, onProgress?)` | Deprecated alias for `predownload()` |
| `KittenTTS.redownloadModel(config?, onProgress?)` | Deletes and downloads the selected model |
| `KittenTTS.clearModelCache(config?)` | Deletes cached files for the selected model |

## Bundled Asset Helper

`createBundledAssetConfig(manifest, options)` creates a `KittenTTSConfig` from
the manifest generated by:

```bash
npx @kittentts/react-native bundle-assets
```

Use it with the Expo config plugin or pass `basePath` when files are available
as normal filesystem paths.

```tsx
const config = await createBundledAssetConfig(manifest, {
  model: KittenModel.NanoInt8,
});
```

For bundled Kitten TTS 2 Nano, Pico or Mini, `createBundledTinyOptions(manifest,
{ model })` returns the `KittenTTS.create()` options (`model`, `weights`,
`languages`, `modelDirectory`, `textDataDirectory`), and `bundledTinyModels(manifest)`
lists them:

```tsx
const tts = await KittenTTS.create({
  ...(await createBundledTinyOptions(manifest, { model: 'kitten-tts-2-nano' })),
  player,
});
```

See [bundled offline assets](../guides/offline-assets.md).

## Errors

SDK errors are surfaced as `KittenTTSError` when possible.

```tsx
import {
  KittenTTSErrorCode,
  isKittenTTSError,
} from '@kittentts/react-native';

try {
  await tts.speak('Hello.');
} catch (error) {
  if (isKittenTTSError(error)) {
    console.log(error.code, error.message);
  }
}
```

| Code | Meaning |
| --- | --- |
| `EMPTY_INPUT` | Text was empty |
| `DOWNLOAD_FAILED` | Model or phonemizer download failed |
| `INVALID_MODEL_DATA` | Cached model data could not be parsed |
| `PHONEMIZER_FAILED` | Text-to-phoneme conversion failed |
| `INFERENCE_FAILED` | ONNX Runtime setup or inference failed |
| `PLAYBACK_FAILED` | Audio playback failed |
| `INVALID_ARGUMENT` | An option or argument was not valid: an unknown model, voice, language or weights, a bad speed, both `voice` and `reference`, `generateToFile()` in a browser |
| `API_ERROR` | The Kitten API answered with an error (`KittenAPIError`) |
| `NETWORK_ERROR` | The Kitten API could not be reached, or timed out (`KittenAPIError`) |
| `CANCELLED` | A Kitten API request was cancelled by its `signal` or `dispose()` |
| `UNSUPPORTED_RUNTIME` | The JavaScript engine lacks what Kitten TTS 2 Nano, Pico and Mini need (Hermes from React Native 0.75) |

`KittenAPIError` also carries `status`, `apiCode` (the API's own code, such as
`invalid_voice`), `param`, `requestId` and `retryAfter`. Check for it with
`isKittenAPIError(error)`.
