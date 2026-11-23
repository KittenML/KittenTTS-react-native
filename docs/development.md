# Development

Notes for people working on this SDK repository.

## Fresh Clone Check

```bash
npm install
npm run typecheck
npm test
```

`npm test` compiles the TypeScript needed by the unit tests and does not require
Emscripten. It copies the generated CEPhonemizer runtime into `lib/` when it has
been built. The Kitten TTS 2 tests that need a missing runtime, data file or
`@kittentts/espeak-ng` skip and say why.

## Build

```bash
npm run build
```

The build regenerates the Emscripten runtime of the 0.8 models' CEPhonemizer,
compiles TypeScript into `lib/`, and copies the runtime into `lib/`.

Generated files are not committed:

- `lib/`
- `*.tgz`
- `src/phonemizer/generated/cephonemizer-runtime.js`

Source files that stay committed:

- `src/`, including the typed wrapper `src/phonemizer/generated/cephonemizer.ts`
- `vendor/cephonemizer/`

espeak-ng, for the Kitten TTS 2 languages other than English and Japanese, is
not built here. It is GPL-3.0-or-later, so it lives in its own repository and
package, `@kittentts/espeak-ng`, which has its own `npm run build` (also with
Emscripten). The SDK looks it up at run time and never imports it.

## Emscripten Runtime

The CEPhonemizer runtime needs Emscripten 7.0.1 from emsdk. Pin the version: it
builds with `-sWASM=0` (Hermes has no WebAssembly), which Emscripten 7 marks
deprecated.

```bash
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
~/emsdk/emsdk install 7.0.1
~/emsdk/emsdk activate 7.0.1
source ~/emsdk/emsdk_env.sh
```

Then run:

```bash
npm run build:phonemizer   # src/phonemizer/generated/cephonemizer-runtime.js
```

You do not need Emscripten to install the published npm package.

## Kitten TTS 2 Nano, Pico and Mini Data

The scripts in `tools/kitten-tts-2-tiny/` need a Python environment with
`kittenml[ja]` (from KittenML/KittenTTS; it brings misaki, spaCy, phonemizer,
espeakng_loader, num2words, fugashi, unidic-lite and jaconv), spaCy's
`en_core_web_sm` and `onnx`. Run them with `python -I`.

The text data:

- `build_text_pack.py OUT`: the text data folder to host at `textDataURL`
  (`en/`, `espeak-ng-data/`, `ja/`, `manifest.json`, `README.md`). It runs the
  three scripts below.
- `export_english.py`: misaki's lexicons, CMUdict, spaCy's tokenizer and tagger
  (`en/`).
- `espeak_data.py`: the espeak-ng data files of the 14 espeak languages
  (`espeak-ng-data/`). `--verify` checks that each language needs only its files.
- `japanese_data.py`: UniDic rebuilt for the TypeScript MeCab, and cutlet's
  tables (`ja/`).

Upload the folder `build_text_pack.py` writes to the text data repository
(`hf upload dewan-sl/kitten-tts-2-text OUT . --repo-type model`).

The test fixtures, written by the Python package into `tests/fixtures/`
(`--out FILE` writes elsewhere):

- `english_fixtures.py [TEXTS.json]`, `espeak_fixtures.py`,
  `japanese_fixtures.py`, `text_norm_fixtures.py`, `synth_fixtures.py`.

The committed fixtures are samples. For a bigger English run, write a fixture
from your own sentences outside the repo and point the test at it:

```bash
python -I tools/kitten-tts-2-tiny/english_fixtures.py sentences.json --out /tmp/english.json
KITTEN_TTS_2_TINY_DATA=/path/to/data \
KITTEN_TTS_2_TINY_ENGLISH_FIXTURE=/tmp/english.json \
KITTEN_TTS_2_TINY_REPORT=/tmp/english-report.json \
  node --test tests/kitten-tts-2-tiny-english.test.js
```

`KITTEN_TTS_2_TINY_REPORT` names a JSON file that gets every mismatch.

### Run all the Kitten TTS 2 tests

The data tests read local files only. Model files come from the Hugging Face
cache (download the three repositories once, e.g. with the Python package), or
from `KITTEN_TTS_2_TINY_MODEL_DIR`, a folder holding `kitten-tts-2-nano/`,
`kitten-tts-2-pico/` and `kitten-tts-2-mini/`.

The parity tests of the espeak languages load a built `@kittentts/espeak-ng`
from `KITTENTTS_ESPEAK_NG_DIR`: its folder, after `npm run build` there. Without
it they skip; the tests of what happens when the package is missing always run.
With a checkout of `@kittentts/espeak-ng` next to this one:

```bash
python -I tools/kitten-tts-2-tiny/build_text_pack.py ~/kitten-tts-2-text
(cd ../kittentts-espeak-ng && npm install && npm run build)
npm run build
KITTENTTS_ESPEAK_NG_DIR=../kittentts-espeak-ng KITTEN_TTS_2_TINY_DATA=~/kitten-tts-2-text npm test
```

That runs all 79 tests.

## Packaging

Check the package before publishing:

```bash
npm install
npm test
npm pack --dry-run
```

Create a local tarball for inspection:

```bash
npm pack
```

The tarball is ignored by Git. The examples install
`@kittentts/react-native` from npm. To run one against this checkout instead (a
change to try, or a version not on npm yet):

```bash
npm run example:install -- ExpoExample
```

It builds `lib/`, packs it and installs the tarball into the example with
`npm install --no-save`, so the example's `package.json` keeps the published
version. The CEPhonemizer runtime must exist (`npm run build` once).

ExpoExample and BareRNExample also import `@kittentts/espeak-ng`. Until it is on
npm, point `KITTENTTS_ESPEAK_NG_DIR` at a checkout where `npm run build` has run,
and the script packs and installs it too:

```bash
KITTENTTS_ESPEAK_NG_DIR=../kittentts-espeak-ng npm run example:install -- ExpoExample
```

If npm cache permissions fail locally:

```bash
npm --cache /tmp/kittentts-npm-cache pack
```

## Publish

Log in once:

```bash
npm login
```

Publish:

```bash
npm run publish:npm
```

That runs `npm publish --access public`, which is required for the public scoped
package `@kittentts/react-native`. `prepublishOnly` runs the test suite, and
`prepack` rebuilds the CEPhonemizer runtime plus `lib/`. `@kittentts/espeak-ng`
is published from its own repository.
