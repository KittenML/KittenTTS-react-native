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
- `src/*.web.ts`: React Native Web entrypoints and platform-specific browser implementations.
  Each one needs an entry in `package.json` under `browser` (native file to web
  file) **and** under `react-native` (native file to itself). Metro reads
  `browser` on iOS and Android too, so without the second entry the web file is
  bundled into native apps and bundling fails. A test enforces the pairing.
- `src/KittenTTSError.ts`: SDK error codes and helpers.
- `src/KittenModel.ts`: model names, download URLs, sizes, speed priors.
- `src/KittenVoice.ts`: voice enum and display helpers.
- `src/loader/ModelDownloader.ts`: model cache and Hugging Face downloads.
- `src/loader/NPZLoader.ts`: `voices.npz` ZIP/NPY parsing.
- `src/engine/TTSEngine.ts`: text-to-token-to-ONNX inference.
- `src/phonemizer/CEPhonemizer.ts`: JS/Emscripten phonemizer adapter.
- `src/audio/AudioOutput.ts`: optional playback helpers.
- `src/storage/AssetStorage.ts`: web/Node asset cache abstraction used by the web platform files.
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
- `react-native-fs` stays below 2.41.0: 2.41 needs React Native 0.88 (its codegen
  spec uses `ArrayBuffer`), so newer versions break `pod install` on older apps.
- `onnxruntime-react-native` 1.24 casts to `RCTCxxBridge`, which React Native
  0.88 removed; the postinstall patch replaces that cast. Check both Expo SDK 55
  and the newest SDK build after changing either dependency.
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

## Kitten TTS 2 Nano, Pico and Mini

`src/tiny/` runs the small Kitten TTS 2 models (`KittenTTS2Tiny`). Its text
processing must give exactly the Python package's phonemes (kittenml,
`kittenml/kittentts2_tiny/`), and the tests check that against fixtures the
Python package writes (`tools/kitten-tts-2-tiny/*_fixtures.py`):

- `src/tiny/frontend/english/`: tts_norm, num2words, spaCy's tokenizer and
  tagger features (the tagger network is `en/spacy-tagger.onnx`), misaki, and the
  CMUdict/BART fallback. Python string semantics (`pystr.ts`) matter: code-point
  lengths, Unicode `\d`/`\w`, `str.lower()` without the final-sigma rule.
- `src/tiny/frontend/espeak/`: espeak-ng 1.52.0 compiled to plain JS
  (`npm run build:espeak`), with phonemizer's and misaki's post-processing.
- `src/tiny/frontend/japanese/`: Mini's Japanese: cutlet ported, and MeCab's
  lattice/Viterbi in TypeScript over UniDic rebuilt by
  `tools/kitten-tts-2-tiny/japanese_data.py` (ja/*.bin; JapaneseG2P keeps views
  on the bytes it is given and decodes the matrix in place).
- `src/tiny/WordTimings.ts`: word timings from the graph's durations.
- `src/tiny/KittenTTS2Tiny.ts`, `TinySynth.ts`: downloads per language, voices,
  chunk trimming and fades as in Python's `_chunk`.
- The text data (`en/`, `espeak-ng-data/`, `ja/`, `manifest.json`) is built by
  `tools/kitten-tts-2-tiny/build_text_pack.py`, hosted on Hugging Face
  (`DEFAULT_TEXT_DATA_URL`, dewan-sl/kitten-tts-2-text) and downloaded per
  language; big files are gzipped there and unpacked once on the device.
- On React Native, read files with `platform.ts` (base64 + atob), not
  react-native-fs's utf8 reading, which decodes in JavaScript and took seconds.

Traps:

- spaCy gives reserved strings ("X", POS tags) fixed small ids instead of hashes,
  and its encoder pads each doc with 4 zero rows that change the edge tokens:
  both are in the exported graph and `SpacyTagger.ts`.
- The speech graphs add random noise, so audio is never sample-identical; a
  duration on x.5 can round either way between ONNX Runtime builds.
- Metro applies the `browser` map on native too; every entry needs a matching
  `react-native` entry (`tests/packaging.test.js`), and code shared by native
  and web must not import `node:` modules (hence `loader/NPZParser.ts`).
- Both Emscripten runtimes need `-sWASM=0` (Hermes has no WebAssembly), which
  Emscripten 7 marks deprecated: pin the emsdk version if it is removed.
- The models need Hermes from React Native 0.75: the regexes built at run time
  use `\p{...}` and `\u{...}`, which Babel cannot rewrite (it rewrites literals).
- Tests that need data skip without `KITTEN_TTS_2_TINY_DATA` (the text data
  folder as built, gzipped files included); model files come from the Hugging
  Face cache (`tests/helpers/tiny-data.js`).

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
