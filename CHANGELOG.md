# Changelog

## Unreleased

- Added Kitten TTS 2 Nano, Pico and Mini (`KittenTTS.create({ model:
  'kitten-tts-2-nano' })`): 8 languages (Mini 16), int8 or int4 weights, and
  the Python package's phonemes. They need React Native 0.75+. espeak-ng, used
  for most non-English languages, is GPL-3.0-or-later. See the
  [guide](docs/guides/kitten-tts-2-tiny.md).
- `KittenTTSResult` takes the voice type as a parameter; `KittenTTSErrorCode`
  has `INVALID_ARGUMENT` and `UNSUPPORTED_RUNTIME`.
- `npm run build:phonemizer` links with `em++` (current Emscripten no longer
  links C++ through `emcc`), and `npm run build` also builds espeak-ng.

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
