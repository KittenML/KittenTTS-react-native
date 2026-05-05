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

You do not need Emscripten to install the published npm package.

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
