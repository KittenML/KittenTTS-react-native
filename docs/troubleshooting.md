# Troubleshooting

## Expo Go Fails

Expo Go does not include the native modules KittenTTS needs. Use a development
build:

```bash
npx expo prebuild
npx expo run:ios
```

For Android:

```bash
npx expo run:android
```

## `speak()` Says No Audio Player Is Configured

Pass a player to `KittenTTS.create()`:

```tsx
const tts = await KittenTTS.create({
  model: 'kitten-tts-2-nano',
  player: createExpoAudioPlayer(ExpoAudio),
});
```

If you do not need playback, use `generate()` instead.

## A Language Fails With `MISSING_DEPENDENCY`

Kitten TTS 2 Nano, Pico and Mini speak German, French, Spanish, Italian,
Portuguese, Russian and Hindi (and Mini's Danish, Finnish, Dutch, Swedish,
Swahili, Turkish and Korean) through espeak-ng, which comes in its own package
because it is GPL-3.0-or-later. Install it and import it once, before the first
`create()`:

```bash
npm install @kittentts/espeak-ng
```

```tsx
import '@kittentts/espeak-ng';
```

English, Japanese, the 0.8 models and Kitten TTS 2 Cloud never need it. If the
error says the package has another espeak-ng version, install the
`@kittentts/espeak-ng` version that matches `@kittentts/react-native`.

## First Run Is Slow

The selected model's files download on first use. Later runs use the local
cache.

Kitten TTS 2 Nano, Pico and Mini download per language. Pass the languages you
need up front to `create()`, or download them before the screen that speaks:

```tsx
await KittenTTS2Tiny.predownload(
  { model: 'kitten-tts-2-nano', languages: ['en'] },
  (progress, info) => {
    if (info?.stage === 'complete' && info.cached) console.log('already downloaded');
  },
);
```

For the 0.8 models, check the cache before showing setup UI:

```tsx
const cache = await KittenTTS.getModelCacheInfo({
  model: KittenModel.NanoInt8,
});

console.log(cache.isCached);
```

## Downloads Fail Or Restart

Downloads are written to temporary `.download` files first. A partial failed
download is not treated as a valid model.

The SDK tries each file 4 times by default (`downloadRetries`). If setup was
interrupted, call `KittenTTS.create()` again: Kitten TTS 2 Nano, Pico and Mini
download only the files that are still missing.

For the 0.8 models, you can also force a clean redownload:

```tsx
await KittenTTS.redownloadModel({ model: KittenModel.NanoInt8 }, setProgress);
```

## ONNX Runtime Issues

The package runs `scripts/patch-onnxruntime-react-native.js` during
`postinstall` to apply known compatibility fixes for
`onnxruntime-react-native`.

Some package managers skip a dependency's install scripts unless you allow them
(pnpm 10's `onlyBuiltDependencies`, Bun's `trustedDependencies`). Without the
patch, iOS builds on React Native 0.88 (Expo SDK 58) fail with
`unknown type name 'RCTCxxBridge'`. Allow `@kittentts/react-native`'s script, or
run it from the app's root after installing, then rerun `pod install`:

```bash
node node_modules/@kittentts/react-native/scripts/patch-onnxruntime-react-native.js
```

On Android, the SDK's own `android/` package registers ONNX Runtime. This avoids
the common `Cannot read property 'install' of null` crash when ONNX Runtime is
compiled but not added to `MainApplication`.

In a bare React Native app, iOS needs `onnxruntime-react-native` in the app's own
`package.json`, because React Native CLI links only direct dependencies. Without
it `create()` fails on iOS because the ONNX Runtime module is missing; see
[Bare React Native](getting-started.md#bare-react-native). Expo links it on its
own.

## The App Closes At Launch On iOS 27

Apps built with the iOS 27 SDK (Xcode 27) must use the scene lifecycle, or iOS
stops them at launch (`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`
in the crash report). This is not about KittenTTS, but older templates hit it:
Expo SDK 54 and 55 and React Native 0.81's `RCTAppDelegate`. Move to Expo SDK
58, or create the window in a `SceneDelegate` and add
`UIApplicationSceneManifest` to `Info.plist`, as
[`examples/BareRNExample`](../examples/BareRNExample/ios/BasicExample/AppDelegate.mm)
does.

## Bundled Assets Are Missing In The App

If you use bundled assets, remember that `assets/kittentts` is copied during the
native build. After changing those files, rebuild the native app:

```bash
npx expo prebuild --clean
npx expo run:ios
```

See [bundled offline assets](guides/offline-assets.md).
