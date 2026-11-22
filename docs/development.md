# Development

Notes for people working on this SDK repository.

## Fresh Clone Check

```bash
npm install
npm run typecheck
npm test
```

`npm test` compiles the TypeScript needed by the unit tests and does not require
Emscripten.

## Build

```bash
npm run build
```

The build regenerates the phonemizer runtime, compiles TypeScript into `lib/`,
and copies the generated Emscripten runtime into `lib/`.

Generated files are not committed:

- `lib/`
- `*.tgz`
- `src/phonemizer/generated/cephonemizer-runtime.js`
- `src/tiny/frontend/espeak/generated/espeakng-runtime.js`

Source files that stay committed:

- `src/`
- `src/phonemizer/generated/cephonemizer.ts`
- `vendor/cephonemizer/`

## Phonemizer Runtime

Regenerating the CEPhonemizer JavaScript runtime requires Emscripten:

```bash
emcc --version
```

On macOS:

```bash
brew install emscripten
```

Then run:

```bash
npm run build:phonemizer
```

`npm run build:espeak` builds espeak-ng 1.52.0 for the Kitten TTS 2 Nano, Pico
and Mini models the same way (it clones espeak-ng into
`~/.cache/kittentts-espeak-ng/`). Both were last built with Emscripten 7.0.1
(`emsdk install 7.0.1`).

You do not need Emscripten to install the published npm package.

## Kitten TTS 2 Nano, Pico and Mini Data

The scripts in `tools/kitten-tts-2-tiny/` run with a Python environment that has
`kittenml` (from KittenML/KittenTTS), `onnx` and spaCy's `en_core_web_sm`:

- `build_text_pack.py OUT`: the text data folder to host at `textDataURL`.
- `english_fixtures.py`, `espeak_fixtures.py`, `text_norm_fixtures.py`,
  `synth_fixtures.py`: regenerate the test fixtures from the Python package.

Upload the folder `build_text_pack.py` writes to the text data repository
(`hf upload dewan-sl/kitten-tts-2-text OUT . --repo-type model`). Run the
data-dependent tests with that folder; model files come from the Hugging Face
cache (download the three repositories once, e.g. with the Python package):

```bash
KITTEN_TTS_2_TINY_DATA=/path/to/data npm test
```

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
`@kittentts/react-native` from npm, not from a local tarball.

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
`prepack` rebuilds the phonemizer runtime plus `lib/`.
