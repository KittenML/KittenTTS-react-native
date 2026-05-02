# Changelog

## Unreleased

- Added Swift-parity word timing metadata via `KittenTTSResult.wordTimings`.
- Added `KittenTTS.generateStreaming()` for sentence-by-sentence generation.
- Added `tts.play(result)` so apps can inspect timings before playback.

## 0.8.0

- Initial developer-preview React Native SDK for KittenTTS.
- Supports iOS and Android with ONNX Runtime, Expo development builds, and bare React Native.
- Includes runtime model downloads, local cache reuse, built-in voices, WAV output, and example apps.
