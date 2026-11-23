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
- `src/engineFor.ts`: which engine `KittenTTS.create()` builds from the model, as
  the Python package does: 0.8 on the device, Kitten TTS 2 Nano/Pico/Mini on the
  device (`src/tiny/`), or the Kitten API (`src/api/`, `src/KittenTTS2.ts`) for
  `kitten-tts-2-cloud` / `kitten-tts-2` and for any Kitten TTS 2 model given an
  `apiKey` or `baseUrl`.
- `src/KittenTTSConfig.ts`: user config and defaults.
- `src/*.web.ts`: React Native Web entrypoints and platform-specific browser implementations.
  Each one needs an entry in `package.json` under `browser` (native file to web
  file) **and** under `react-native` (native file to itself). Metro reads
  `browser` on iOS and Android too, so without the second entry the web file is
  bundled into native apps and bundling fails. A test enforces the pairing.
- `src/KittenTTSError.ts`: SDK error codes and helpers, including `KittenAPIError`
  for the Kitten API.
- `src/KittenTTS2.ts` / `src/KittenTTS2.web.ts`: Kitten TTS 2 through the hosted
  Kitten API. `KittenTTS.create()` returns one for `model: 'kitten-tts-2-cloud'`
  (or `'kitten-tts-2'`). They
  only wire in the platform's `AudioOutput` and file reading; the logic is in
  `src/api/KittenTTS2Base.ts` (requests, cloning uploads, voice listing) and
  `src/api/KittenAPI.ts` (fetch, retries, errors), which run in Node so
  `tests/kitten-tts-2.test.js` can test them with a fake `fetch`. Voices, models
  and API error codes are strings because the API adds them over time: do not
  validate them client-side.
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
- `scripts/build-espeak-ng.js`: builds the espeak-ng runtime for Kitten TTS 2
  (`vendor/espeak-ng-bridge/`).
- `scripts/patch-onnxruntime-react-native.js`: postinstall ONNX Runtime compatibility patches.
- `examples/BareRNExample/`: bare React Native (0.81) example, the same app as
  ExpoExample. Its `App.tsx` is ExpoExample's with react-native-sound instead of
  expo-audio; keep the two in step. It lists `onnxruntime-react-native` itself
  (React Native CLI links only direct dependencies on iOS) and turns its Android
  linking off in `react-native.config.js`; its iOS app uses a `SceneDelegate`
  (the iOS 27 SDK requires the scene lifecycle).
- `examples/ExpoExample/`: Expo SDK 58 example with every engine: 0.8, Kitten TTS
  2 Nano/Pico/Mini on the device, Kitten TTS 2 Cloud and the cloud Nano/Pico/Mini
  (key from the app or
  `EXPO_PUBLIC_KITTENML_API_KEY`, or `EXPO_PUBLIC_KITTENML_BASE_URL`); iOS,
  Android and web.
- `examples/ExpoWordTimingsExample/`: Expo SDK 58 word timing example (0.8 and
  Kitten TTS 2 on the device).
- `examples/OfflineBundledAssetsExample/`: Expo SDK 58, models bundled into the
  app (0.8 and Kitten TTS 2 Nano).
- The examples share one design: `components/ui.tsx` (shadcn-style controls in
  KittenML's light and dark colors, the KittenML logo from `assets/kittenml.png`,
  no UI library) is the same file in all four; change it in all of them.
- The examples depend on the published SDK version and have no lockfiles;
  `npm run example:install -- <example>` installs this checkout into one.

## Build And Validation

Use these from the repository root:

```bash
npm run typecheck
npm run build
npm test
```

`npm run test:live` runs `tests/live/` against the real Kitten API. It is
skipped unless `KITTENML_API_KEY` is set, and it makes billed requests. Never
commit a key, and keep credentials in runtime-private (`#`) fields so a logged
or serialised instance cannot leak them.

`npm run build` writes compiled output to `lib/` and copies the generated
Emscripten runtimes. Do not hand-edit `lib/` unless the user explicitly asks;
prefer editing `src/` and rebuilding.

`npm run build:phonemizer` and `npm run build:espeak` require Emscripten
(`docs/development.md`) and regenerate the runtimes under
`src/phonemizer/generated/` and `src/tiny/frontend/espeak/generated/`.

## Dependency Notes

- Runtime dependencies are `onnxruntime-react-native`,
  `@dr.pogodin/react-native-fs` via the `react-native-fs` alias, and `pako`.
- `react-native-fs` stays below 2.41.0: 2.41 needs React Native 0.88 (its codegen
  spec uses `ArrayBuffer`), so newer versions break `pod install` on older apps.
- `onnxruntime-react-native` 1.24 casts to `RCTCxxBridge`, which React Native
  0.88 removed; the postinstall patch replaces that cast. Check an older React
  Native (the bare example's 0.81) and the newest Expo SDK after changing either
  dependency.
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
  CMUdict/BART fallback. Python string semantics (`src/tiny/frontend/pystr.ts`)
  matter: code-point lengths, Unicode `\d`/`\w`, `str.lower()` without the
  final-sigma rule.
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
  `tools/kitten-tts-2-tiny/build_text_pack.py` (`docs/development.md`), hosted on
  Hugging Face (`DEFAULT_TEXT_DATA_URL`, dewan-sl/kitten-tts-2-text) and
  downloaded per language; big files are gzipped there and unpacked once on the
  device.
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
- Tests that need data skip, and say why, without `KITTEN_TTS_2_TINY_DATA` (the
  text data folder as built, gzipped files included); model files come from the
  Hugging Face cache or `KITTEN_TTS_2_TINY_MODEL_DIR` (`tests/helpers/tiny-data.js`).
  `docs/development.md` has the recipe that runs them all.

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
