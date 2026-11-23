# Changelog

## 2.0.0 (not yet published)

A major version: two more engines behind `KittenTTS.create()`, and a licence and
size change every app gets. Upgrading from 1.x:

- **Licence:** the package is now `Apache-2.0 AND GPL-3.0-or-later`. It ships
  espeak-ng (GPL-3.0-or-later), compiled to JavaScript, for Kitten TTS 2's
  languages other than English and Japanese. React Native bundles it into the
  app even if only the 0.8 models are used. See
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **App size:** a 0.8-only app's release JavaScript bundle grew from 2.06 MB to
  2.89 MB (React Native 0.81, minified).
- **Bare React Native on iOS:** list `onnxruntime-react-native` in the app
  (React Native CLI links only direct dependencies on iOS) and keep its Android
  linking off; see [Getting started](docs/getting-started.md#bare-react-native).
- **`react-native-fs`** stays below 2.41 (2.41 needs React Native 0.88).
- **`KittenTTSErrorCode`** has new members, so an exhaustive `switch` over it needs
  a `default`.
- The 0.8 API is unchanged otherwise: `KittenTTS.create()` without a Kitten TTS 2
  model behaves as before.

- Added Kitten TTS 2 Cloud through the Kitten API:
  `KittenTTS.create({ model: 'kitten-tts-2-cloud', apiKey })` (or `'kitten-tts-2'`,
  the Python package's name) returns a `KittenTTS2`
  with the same `generate()`, `generateStreaming()`, `speak()` and `play()`,
  plus voice cloning from a `reference` recording, presets, decoding controls and
  `availableVoices`, like the Python package. Failed requests throw
  `KittenAPIError`. Existing on-device code is unchanged. With an `apiKey` or
  `baseUrl`, Kitten TTS 2 Nano, Pico and Mini run on the API too, with their own
  voices; without one they run on the device.
- Added Kitten TTS 2 Nano, Pico and Mini (`KittenTTS.create({ model:
  'kitten-tts-2-nano' })`): 8 languages (Mini 16), int8 or int4 weights, and
  the Python package's phonemes. They need React Native 0.75+. espeak-ng, used
  for most non-English languages, is GPL-3.0-or-later. See the
  [guide](docs/guides/kitten-tts-2-tiny.md).
- `bundle-assets` bundles Kitten TTS 2 Nano, Pico and Mini for offline use
  (`--models kitten-tts-2-nano --weights int8 --languages en,de`): exactly the
  model files and text data `create()` reads, in a version 3 manifest that the
  0.8 readers still accept. `createBundledTinyOptions(manifest)` gives the
  `KittenTTS.create()` options (on Android it copies the files out of the APK
  once). See [Bundled Offline Assets](docs/guides/offline-assets.md#kitten-tts-2-nano-pico-and-mini).
- `KittenTTSResult` takes the voice type as a parameter; `KittenTTSErrorCode`
  has `INVALID_ARGUMENT`, `API_ERROR`, `NETWORK_ERROR`, `CANCELLED` and
  `UNSUPPORTED_RUNTIME`.
- `play()` on a 0.8 `KittenTTS` takes a result from any model.
- The npm package no longer includes the README's images (`assets/`, 21.6 MB of
  GIFs): it is about 3 MB instead of 21.5 MB.
- `'kitten-tts-2-cloud'` names Kitten TTS 2 Cloud, as KittenML calls it;
  `'kitten-tts-2'` still works.
- `npm run example:install -- <example>` installs this checkout of the SDK into
  an example without changing its `package.json`.
- The examples run on Expo SDK 58 (React Native 0.88) and, for the bare one,
  React Native 0.81, on iOS, Android and the web (Expo). Each lets you pick 0.8,
  Kitten TTS 2 on the device or Kitten TTS 2 in the cloud; the word-timings and
  offline examples include Kitten TTS 2 Nano, Pico and Mini; all can stop
  playback.
- `npm run build:phonemizer` links with `em++` (current Emscripten no longer
  links C++ through `emcc`), and `npm run build` also builds espeak-ng.

- Fixed `stopSpeaking()` with the browser and react-native-sound players: the
  `speak()` or `play()` call that was waiting never returned (on iOS, stopping a
  Sound never calls its finish callback), and a stop while a clip was still
  loading let it play anyway. Playing a new clip also left the previous call
  waiting.
- Fixed the bare example on iOS: React Native CLI links only an app's own
  dependencies, so ONNX Runtime was missing and `create()` failed. Bare apps list
  `onnxruntime-react-native` (see Getting started), and the example adopts the
  scene lifecycle that apps built with the iOS 27 SDK need (they were killed at
  launch). The Expo examples moved to SDK 58, whose template adopts it.
- Fixed iOS builds on React Native 0.88 (Expo SDK 58), which failed with
  "unknown type name 'RCTCxxBridge'": the ONNX Runtime postinstall patch now
  reaches the JavaScript runtime without that class, which React Native 0.88
  removed.
- Fixed `pod install` on React Native 0.83 and older, which failed with
  "Unrecognized generic type 'ArrayBuffer'": `react-native-fs` is kept below
  2.41.0, which needs React Native 0.88.
- Fixed native bundling: the `browser` map added with web support also applied
  on iOS and Android, so Metro bundled the web files and failed with
  "Unable to resolve module node:fs/promises".
- Added Swift-parity word timing metadata via `KittenTTSResult.wordTimings`.
- Added `KittenTTS.generateStreaming()` for sentence-by-sentence generation.
- Added `tts.play(result)` so apps can inspect timings before playback.
- Added React Native Web support through browser-specific ONNX Runtime Web,
  Cache API asset storage, CE phonemizer, and audio playback implementations.

## 0.8.0

- Initial developer-preview React Native SDK for KittenTTS.
- Supports iOS and Android with ONNX Runtime, Expo development builds, and bare React Native.
- Includes runtime model downloads, local cache reuse, built-in voices, WAV output, and example apps.
