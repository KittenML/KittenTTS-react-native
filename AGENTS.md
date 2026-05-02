# AGENTS.md

Guidance for coding agents working on `@kittentts/react-native`.

## Project Overview

This package is a React Native SDK for on-device KittenTTS speech synthesis.
The public API downloads/caches model assets, prepares a JavaScript phonemizer,
runs ONNX Runtime on-device, and optionally plays generated WAV audio.

Main flow:

1. `KittenTTS.create()` resolves config, prepares the phonemizer, downloads any
   missing model files, loads `voices.npz`, and creates the ONNX engine.
2. `tts.generate()` preprocesses text, phonemizes it, tokenizes IPA symbols,
   runs ONNX inference, and returns `KittenTTSResult`.
3. `tts.speak()` calls `generate()` and sends the result to an `AudioPlayer`.

## Important Paths

- `src/index.ts`: public exports.
- `src/KittenTTS.ts`: main SDK class and lifecycle.
- `src/KittenTTSConfig.ts`: user config and defaults.
- `src/KittenTTSError.ts`: SDK error codes and helpers.
- `src/KittenModel.ts`: model names, download URLs, sizes, speed priors.
- `src/KittenVoice.ts`: voice enum and display helpers.
- `src/loader/ModelDownloader.ts`: model cache and Hugging Face downloads.
- `src/loader/NPZLoader.ts`: `voices.npz` ZIP/NPY parsing.
- `src/engine/TTSEngine.ts`: text-to-token-to-ONNX inference.
- `src/phonemizer/CEPhonemizer.ts`: JS/Emscripten phonemizer adapter.
- `src/audio/AudioOutput.ts`: optional playback helpers.
- `vendor/cephonemizer/`: vendored C++ phonemizer source.
- `scripts/build-cephonemizer.js`: builds generated phonemizer runtime.
- `scripts/patch-onnxruntime-react-native.js`: postinstall ONNX Runtime compatibility patches.
- `examples/BareRNExample/`: bare React Native example.
- `examples/ExpoExample/`: Expo development-build example.
- `examples/ExpoWordTimingsExample/`: Expo SDK 55 word timing example.

## Build And Validation

Use these from the repository root:

```bash
npm run typecheck
npm run build
```

`npm run build` writes compiled output to `lib/` and copies generated
phonemizer files. Do not hand-edit `lib/` unless the user explicitly asks;
prefer editing `src/` and rebuilding.

`npm run build:phonemizer` requires Emscripten and regenerates files under
`src/phonemizer/generated/`.

## Dependency Notes

- Runtime dependencies are `onnxruntime-react-native`,
  `@dr.pogodin/react-native-fs` via the `react-native-fs` alias, and `pako`.
- Playback is optional. Users must pass either `createExpoAudioPlayer()` with
  `expo-audio`, `createRNSoundPlayer()` with `react-native-sound`, or their own
  `AudioPlayer`.
- Expo Go is not supported because ONNX Runtime and filesystem access require
  native modules. Use an Expo development build or prebuilt native project.

## Model Cache Behavior

Model files are cached under:

```text
<DocumentDirectory>/KittenTTS/<model>/
```

unless `storageDirectory` is provided. `downloadModelIfNeeded()` should only
download missing files and should not treat partial failed downloads as valid
cache entries. Keep cache behavior conservative because first-run downloads are
large.

The default `CEPhonemizer` also caches dictionary files under:

```text
<DocumentDirectory>/KittenTTS/CEPhonemizer/
```

## Error Handling

Public SDK failures should be surfaced as `KittenTTSError` with a stable
`KittenTTSErrorCode` whenever practical. Preserve underlying errors in `cause`
when wrapping them. App developers should be able to catch:

```typescript
if (isKittenTTSError(error)) {
  console.log(error.code, error.message);
}
```

Avoid leaking raw native, filesystem, parser, or playback errors from public
entry points unless there is no reasonable SDK boundary around that code.

## Editing Rules

- Keep public API changes small and documented in `README.md`.
- Prefer adding focused tests or at least running `npm run typecheck` for SDK
  changes.
- Keep generated phonemizer output untouched unless rebuilding the phonemizer.
- Preserve the package's TypeScript-first API and avoid adding app-side setup
  that breaks autolinking.
- Do not remove the ONNX Runtime postinstall patch without validating iOS dev
  reload behavior.
