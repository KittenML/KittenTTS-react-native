# Contributing

## Setup

```bash
npm install
npm run typecheck
npm test
```

`npm test` needs no Emscripten. Tests that need something you have not built or
downloaded skip and say why. [docs/development.md](docs/development.md) has the full
recipe, with the Kitten TTS 2 text data and `@kittentts/espeak-ng`.

## Build

```bash
npm run build
```

The build makes the 0.8 models' phonemizer runtime from `vendor/cephonemizer` with
Emscripten (`npm run build:phonemizer`), compiles TypeScript into `lib/`, and copies
the runtime into `lib/` (TypeScript does not copy it). The runtime is generated, not
committed. After the first build, `npm run build:ts` is enough until the C++ changes.

## Licence

The package is Apache-2.0. Do not add code that is only available under the GPL or
LGPL. espeak-ng lives in its own package, `@kittentts/espeak-ng`, which the SDK finds
at run time and never imports.

## Trying Changes in the Examples

```bash
npm run example:install -- ExpoExample
```

This builds and packs this checkout and installs it into the example without changing
its `package.json`. Set `KITTENTTS_ESPEAK_NG_DIR` to a built `@kittentts/espeak-ng`
checkout to install that too.
