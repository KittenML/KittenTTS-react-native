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
  player: createExpoAudioPlayer(ExpoAudio),
});
```

If you do not need playback, use `generate()` instead.

## First Run Is Slow

The selected model and phonemizer files download on first use. Later runs use
the local cache.

Check the cache before showing setup UI:

```tsx
const cache = await KittenTTS.getModelCacheInfo({
  model: KittenModel.NanoInt8,
});

console.log(cache.isCached);
```

## Downloads Fail Or Restart

Downloads are written to temporary `.download` files first. A partial failed
download is not treated as a valid model.

The SDK retries each model and phonemizer file 4 times by default. If setup was
interrupted, force a clean redownload:

```tsx
await KittenTTS.redownloadModel({ model: KittenModel.NanoInt8 }, setProgress);
```

## ONNX Runtime Issues

The package runs `scripts/patch-onnxruntime-react-native.js` during
`postinstall` to apply known compatibility fixes for
`onnxruntime-react-native`.

On Android, the SDK's own `android/` package registers ONNX Runtime. This avoids
the common `Cannot read property 'install' of null` crash when ONNX Runtime is
compiled but not added to `MainApplication`.

## Bundled Assets Are Missing In The App

If you use bundled assets, remember that `assets/kittentts` is copied during the
native build. After changing those files, rebuild the native app:

```bash
npx expo prebuild --clean
npx expo run:ios
```

See [bundled offline assets](guides/offline-assets.md).
