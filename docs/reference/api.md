# API Reference

This page lists the main public APIs. The TypeScript types in the package are
the source of truth.

## `KittenTTS.create(options?, onProgress?)`

Creates and initializes a TTS instance. The model picks the engine, as in the
Python package:

| `model` | Without a key | With `apiKey` or `baseUrl` |
| --- | --- | --- |
| `'kitten-tts-2-nano'`, `'-pico'`, `'-mini'` | [`KittenTTS2Tiny`](#kitten-tts-2-nano-pico-and-mini-kittentts2tiny), on the device | [`KittenTTS2`](#kitten-tts-2-cloud-kittentts2), on the API |
| `'kitten-tts-2-cloud'` (or `'kitten-tts-2'`) | error: it runs on the API only | [`KittenTTS2`](#kitten-tts-2-cloud-kittentts2), on the API |
| Kitten TTS 0.8 models, and no `model` at all | [`KittenTTS`](#kitten-tts-08-kittentts), on the device | [`KittenTTS`](#kitten-tts-08-kittentts), on the device |

All three have `generate()`, `generateStreaming()`, `speak()`, `play()`,
`stopSpeaking()` and `dispose()`, and return a [`KittenTTSResult`](#kittenttsresult).

```tsx
const tts = await KittenTTS.create({
  model: 'kitten-tts-2-nano',
  languages: ['en'],
  player: createExpoAudioPlayer(ExpoAudio),
});
```

The progress callback receives a number from `0` to `1`. The optional second
argument describes the current stage:

```tsx
const tts = await KittenTTS.create(options, (progress, info) => {
  if (info?.stage === 'downloading') {
    console.log(Math.round(progress * 100));
  }
});
```

Kitten TTS 2 Nano, Pico and Mini report `downloading`, then `complete` (with
`cached: true` when nothing had to be downloaded). The 0.8 models also report
`checking-cache`, `cached` and `retrying`. Kitten TTS 2 Cloud downloads nothing
and reports `complete` once.

## Kitten TTS 2 Nano, Pico and Mini: `KittenTTS2Tiny`

`KittenTTS.create({ model: 'kitten-tts-2-nano' })` (or `'kitten-tts-2-pico'`,
`'kitten-tts-2-mini'`) returns a `KittenTTS2Tiny`, running on the device. It
needs React Native 0.75+ (Hermes). See
[Kitten TTS 2 Nano, Pico and Mini](../guides/kitten-tts-2-tiny.md).

```tsx
const tts = await KittenTTS.create({ model: 'kitten-tts-2-nano', languages: ['en'], player });

await tts.speak('Hello there.', { voice: 'Eleanor', speed: 1.1 });
```

| Option | Default | Description |
| --- | --- | --- |
| `model` | required | `'kitten-tts-2-nano'`, `'kitten-tts-2-pico'`, `'kitten-tts-2-mini'`, or the `KittenML/...` repository |
| `weights` | `'int8'` | `'int8'` or `'int4'` (about half the size) |
| `languages` | the model's default (`['en']`) | Languages to download and load in `create()`; others are fetched on first use |
| `storageDirectory` | `<DocumentDirectory>/KittenTTS` | Cache folder |
| `modelBaseURL` | Hugging Face | Another host for the model files |
| `modelDirectory` | none | A local folder laid out like the repository, used instead of downloading |
| `textDataURL` | `DEFAULT_TEXT_DATA_URL` | Another host for the text data |
| `textDataDirectory` | none | A local copy of the text data, used instead of downloading |
| `hfToken` | none | Sent with Hugging Face downloads |
| `downloadRetries` | `4` | Attempts per file |
| `ortNumThreads` | ONNX Runtime's default | ONNX Runtime threads for the speech model |
| `player` | none | Required for `speak()` and `play()` |

| Member | Description |
| --- | --- |
| `generate(text, voice?, speed?)` or `generate(text, { voice, language, speed })` | Complete speech as a `KittenTTSResult<string>`, with `wordTimings` |
| `generateStreaming(text, ...)` | Yields chunks as they are ready; chunks carry no `wordTimings` |
| `generateToFile(text, path, options?)` | Writes a 16-bit WAV and returns the path (not in a browser) |
| `speak(text, ...)`, `play(result, options?)`, `stopSpeaking()` | Playback through the `player` |
| `phonemize(text, language?)` | The phoneme chunks the model will speak |
| `availableVoices` | Voice names per language: `{ en: ['Eleanor', ...], de: ['Anna', ...] }` |
| `voices(language?)` | `{ key, name, description, language }` for each voice |
| `languages`, `defaultLanguage` | Language codes the model speaks, and the default (`'en'`) |
| `onnxWeights`, `weights` | Weight formats the model has, and the one loaded |
| `repoId`, `sampleRate` | The repository, such as `KittenML/kitten-tts-2-nano`; `24000` |
| `dispose()` | Stops playback and releases the ONNX sessions |
| `KittenTTS2Tiny.predownload(options, onProgress?)` | Downloads the files for `options.languages` without loading the model |

`voice` is a name from `availableVoices`, in any case, or a voice's description;
without one, the language's first voice speaks. `speed` is any positive number,
larger is faster (default `1`).

The languages other than English and Japanese need `@kittentts/espeak-ng`
installed and imported (`import '@kittentts/espeak-ng';`). Without it they throw
`MISSING_DEPENDENCY`. See
[Languages that need espeak-ng](../guides/kitten-tts-2-tiny.md#languages-that-need-espeak-ng).

`KITTEN_TTS_2_TINY_MODELS` maps the model names to their repositories, and
`isTinyModel(model)` tells whether a name is one of them.

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

## Kitten TTS 0.8: `KittenTTS`

The older English models (`KittenModel.Nano`, `NanoInt8`, `Micro`, `Mini`), on
the device. `KittenTTS.create()` returns a `KittenTTS` for them, and for a call
with no `model` (0.8 Nano). It resolves config, prepares the phonemizer, loads
or downloads model assets, reads `voices.npz`, and creates the ONNX Runtime
session.

```tsx
const tts = await KittenTTS.create({
  model: KittenModel.NanoInt8,
  defaultVoice: KittenVoice.Luna,
  speed: 1.1,
  player: createExpoAudioPlayer(ExpoAudio),
});
```

### Options

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

### `tts.generate(text, voice?, speed?)`

Synthesizes speech and returns a `KittenTTSResult` without playing it.

```tsx
const result = await tts.generate('Save this as audio.', KittenVoice.Jasper);
```

`wordTimings` may be empty when duration output is unavailable or when the text
is split across multiple model chunks.

### `tts.generateStreaming(text, voice?, speed?)`

Synthesizes long text sentence by sentence. Each chunk is one sentence, with its
own `wordTimings`.

```tsx
for await (const chunk of tts.generateStreaming(longText, KittenVoice.Luna)) {
  await tts.play(chunk);
}
```

### `tts.speak(text, voice?, speed?)`

Synthesizes speech and plays it through the configured player.

```tsx
await tts.speak('Play this sentence.', KittenVoice.Rosie, 1.1);
```

### `tts.play(result, options?)`

Plays a previously generated result, from any model.

```tsx
const result = await tts.generate('Highlight words while this plays.');

await tts.play(result, {
  onPlaybackStart: () => startWordHighlighting(result.wordTimings),
});
```

## Cache Methods

For the 0.8 models:

| Method | Description |
| --- | --- |
| `KittenTTS.isModelCached(config?)` | Checks whether model files exist locally |
| `KittenTTS.isModelDownloaded(config?)` | App-facing alias for model cache checks |
| `KittenTTS.getModelCacheInfo(config?)` | Returns cache paths and file existence |
| `KittenTTS.predownload(config?, onProgress?)` | Downloads model and phonemizer assets |
| `KittenTTS.prewarm(config?, onProgress?)` | Deprecated alias for `predownload()` |
| `KittenTTS.redownloadModel(config?, onProgress?)` | Deletes and downloads the selected model |
| `KittenTTS.clearModelCache(config?)` | Deletes cached files for the selected model |

For Kitten TTS 2 Nano, Pico and Mini, `KittenTTS2Tiny.predownload(options,
onProgress?)` downloads a model's files for `options.languages`; `create()`
downloads only the files that are missing.

## `KittenTTSResult`

| Property or method | Description |
| --- | --- |
| `samples` | Raw mono `Float32Array` PCM |
| `sampleRate` | Always `24000` |
| `duration` | Audio duration in seconds |
| `voice` | Voice used for generation: a name such as `'Eleanor'` (Kitten TTS 2 on the device), a voice ID (cloud), or a `KittenVoice` (0.8) |
| `effectiveSpeed` | Speed after model-specific adjustments |
| `inputText` | Input text that was synthesized |
| `wordTimings` | Per-word `{ wordIndex, word, startTime, endTime }[]`; empty for the cloud |
| `wavData()` | Complete 16-bit PCM WAV as `Uint8Array` |
| `wavBase64()` | Complete WAV as a base64 string |

## Bundled Asset Helpers

`npx @kittentts/react-native bundle-assets` writes the model files and a manifest
for shipping inside the app.

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

For a bundled 0.8 model, `createBundledAssetConfig(manifest, options)` creates a
`KittenTTSConfig`, and `bundledAssetModels(manifest)` lists them. Use it with the
Expo config plugin or pass `basePath` when files are available as normal
filesystem paths.

```tsx
const config = await createBundledAssetConfig(manifest, {
  model: KittenModel.NanoInt8,
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
| `ENGINE_NOT_READY` | The instance was used after `dispose()` |
| `MODEL_FILE_NOT_FOUND` | A model file is missing, for example a language that is not in a bundle |
| `VOICES_FILE_NOT_FOUND` | The 0.8 voices file is missing |
| `NO_VOICE_EMBEDDING` | The 0.8 voices file has no entry for the voice |
| `EMPTY_OUTPUT` | The model produced no audio |
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
| `MISSING_DEPENDENCY` | An optional package the call needs is not installed: `@kittentts/espeak-ng` for the Kitten TTS 2 languages other than English and Japanese (or a version of it with another espeak-ng) |

`KittenAPIError` also carries `status`, `apiCode` (the API's own code, such as
`invalid_voice`), `param`, `requestId` and `retryAfter`. Check for it with
`isKittenAPIError(error)`.
