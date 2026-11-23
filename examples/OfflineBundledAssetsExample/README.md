# Offline Bundled Assets Example

This app was created with `create-expo-app --template blank-typescript` and
loads KittenTTS from files bundled inside the native app. It does not download
the model at runtime.

Expo Go is not supported because KittenTTS uses native modules. Use an Expo
development build with `expo run:ios` or `expo run:android`.

## Run This Example

From this folder:

```bash
npm install
npm run bundle:kittentts
npm run ios
```

For Android:

```bash
npm run android
```

`npm run bundle:kittentts` downloads two models into `assets/kittentts` (about
57 MB): the 0.8 Nano int8 model with its voices and phonemizer files, and Kitten
TTS 2 Nano (int8) with English and its text data. The app lists both and loads
either from the app's own files, with no network.

Until `@kittentts/react-native` 2.0.0 is on npm, or to try changes to the SDK,
install this checkout instead of `npm install`, from the repository root:

```bash
npm run example:install -- OfflineBundledAssetsExample
```

To bundle other models, or more languages for Kitten TTS 2:

```bash
npx kittentts-react-native bundle-assets \
  --models nano-int8,micro,kitten-tts-2-pico \
  --languages en,de,fr --weights int4 \
  --out assets/kittentts
```

`--languages` and `--weights` apply to the Kitten TTS 2 models; a language that
is not bundled fails to load instead of downloading. See
[Bundled offline assets](../../docs/guides/offline-assets.md).

To bundle every supported model:

```bash
npm run bundle:kittentts:all
```

## Add This To Your Own Expo App

### 1. Create Or Open An Expo App

```bash
npx create-expo-app MyTTSApp --template blank-typescript
cd MyTTSApp
```

### 2. Install Dependencies

```bash
npm install @kittentts/react-native
npx expo install expo-audio expo-dev-client expo-build-properties
```

### 3. Generate Bundled KittenTTS Files

Run the CLI from your Expo app root:

```bash
npx kittentts-react-native bundle-assets \
  --models nano-int8 \
  --out assets/kittentts
```

This creates:

```text
assets/kittentts/
  manifest.json
  kitten-tts-nano-0.8-int8/kitten_tts_nano_v0_8.onnx
  kitten-tts-nano-0.8-int8/voices.npz
  CEPhonemizer/en_rules.txt
  CEPhonemizer/en_list.txt
```

### 4. Add The Expo Config Plugin

In `app.json`, add `@kittentts/react-native` to `expo.plugins`:

```json
{
  "expo": {
    "plugins": [
      "expo-audio",
      [
        "@kittentts/react-native",
        {
          "assetsDir": "./assets/kittentts"
        }
      ]
    ]
  }
}
```

This plugin copies `assets/kittentts` into the native iOS and Android app
bundles during prebuild.

### 5. Load The Bundled Assets In App Code

Import the generated manifest JSON and pass it to `createBundledAssetConfig()`.
That helper tells KittenTTS where the bundled model, voices file, and phonemizer
files are.

```typescript
import * as ExpoAudio from 'expo-audio';
import {
  KittenModel,
  KittenTTS,
  KittenVoice,
  createBundledAssetConfig,
  createExpoAudioPlayer,
  type KittenTTSBundledAssetsManifest,
} from '@kittentts/react-native';
import manifestJson from './assets/kittentts/manifest.json';

const manifest = manifestJson as KittenTTSBundledAssetsManifest;

const config = await createBundledAssetConfig(manifest, {
  model: KittenModel.NanoInt8,
  defaultVoice: KittenVoice.Bella,
});

const tts = await KittenTTS.create({
  ...config,
  player: createExpoAudioPlayer(ExpoAudio),
});

await tts.speak('KittenTTS is running from bundled app assets.');
```

For Kitten TTS 2 Nano, Pico or Mini, `createBundledTinyOptions()` gives the
options instead (on Android it copies the files out of the APK once, since APK
assets are not files):

```typescript
const tts = await KittenTTS.create({
  ...(await createBundledTinyOptions(manifest, { model: 'kitten-tts-2-nano' })),
  player: createExpoAudioPlayer(ExpoAudio),
});
```

The complete working version, with both, is in [`App.tsx`](./App.tsx).

### 6. Build The Native App

```bash
npx expo prebuild
npx expo run:ios
```

For Android:

```bash
npx expo run:android
```

After the development build is installed, use:

```bash
npx expo start --dev-client
```

Do not use Expo Go.

## Important Rebuild Rule

Bundled KittenTTS files are native build inputs. If you change
`assets/kittentts` by adding/removing models or regenerating phonemizer files,
you must rebuild the native app so the config plugin copies the updated files.

In this example you can run:

```bash
npm run ios:rebuild
npm run android:rebuild
```

In your own app, run:

```bash
npx expo prebuild --clean
npx expo run:ios
npx expo run:android
```

If `ios/` or `android/` was generated before adding the KittenTTS plugin or
before updating `assets/kittentts`, delete the stale native folder or run a
clean prebuild before building again.

On iOS the plugin adds `kittentts` as a folder resource. That keeps final app
bundle paths stable, for example:

```text
kittentts/kitten-tts-nano-0.8-int8/kitten_tts_nano_v0_8.onnx
```

## How The Pieces Fit Together

- `assets/kittentts/manifest.json` lists the bundled models and file names.
- The Expo config plugin copies `assets/kittentts` into the native app bundle.
- `createBundledAssetConfig(manifest)` reads the bundled files from the native
  app bundle.
- `KittenTTS.create(config)` starts without downloading model or phonemizer
  files from the network.
