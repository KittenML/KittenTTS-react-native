# Contributing

## Setup

```bash
npm install
npm run typecheck
npm test
```

## Build

```bash
npm run build
```

The build runs TypeScript and then `scripts/copy-generated.js`. The copy step is
required because TypeScript does not copy the generated Emscripten runtime into
`lib/`.

## Phonemizer Runtime

The checked-in phonemizer runtime is generated from `vendor/cephonemizer`.
Rebuild it only when the C++ source changes:

```bash
npm run build:phonemizer
npm run build
```

`build:phonemizer` requires Emscripten.

## Local Package

The examples install the SDK from the checked-in tarball. After SDK changes that
should be tested in examples, regenerate it:

```bash
npm --cache /tmp/kittentts-npm-cache pack
```
