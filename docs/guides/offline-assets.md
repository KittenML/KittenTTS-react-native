# Bundled Offline Assets

By default, KittenTTS downloads model and phonemizer files on first run. Bundled
assets are for apps that need to work before the user has a network connection.

## Generate The Bundle

Run this from your app root:

```bash
npx @kittentts/react-native bundle-assets
```

For CI, scripts, or AI coding tools, pass the models directly:

```bash
npx @kittentts/react-native bundle-assets \
  --models nano-int8,micro \
  --out assets/kittentts
```

This writes:

```text
assets/kittentts/
  manifest.json
  kitten-tts-nano-0.8-int8/kitten_tts_nano_v0_8.onnx
  kitten-tts-nano-0.8-int8/voices.npz
  kitten-tts-micro-0.8/kitten_tts_micro_v0_8.onnx
  kitten-tts-micro-0.8/voices.npz
  CEPhonemizer/en_rules.txt
  CEPhonemizer/en_list.txt
```

## Expo Setup

Add the KittenTTS config plugin to `app.json`:

```json
{
  "expo": {
    "plugins": [
      ["@kittentts/react-native", { "assetsDir": "./assets/kittentts" }]
    ]
  }
}
```

The plugin copies `assets/kittentts` into the native iOS and Android app
bundles during prebuild.

Bundled files are native build inputs. If you add, remove, or regenerate files
under `assets/kittentts`, rebuild the native app:

```bash
npx expo prebuild
npx expo run:ios
npx expo run:android
```

If `ios/` or `android/` was generated before adding the plugin or updating the
assets, run a clean prebuild. On iOS the plugin keeps `kittentts` as a folder
resource, so runtime paths remain stable:

```text
<MainBundle>/kittentts/<model>/...
```

## Load The Bundle

Import the generated manifest and create a config:

```tsx
import {
  KittenModel,
  KittenTTS,
  createBundledAssetConfig,
} from '@kittentts/react-native';
import manifest from './assets/kittentts/manifest.json';

const config = await createBundledAssetConfig(manifest, {
  model: KittenModel.NanoInt8,
});

const tts = await KittenTTS.create(config);
```

For a full app, see
[`examples/OfflineBundledAssetsExample`](../../examples/OfflineBundledAssetsExample).

## Manual Paths

If your app has its own asset-copying layer, you can provide paths yourself:

```tsx
import { CEPhonemizer, KittenModel, KittenTTS } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  model: KittenModel.NanoInt8,
  modelFiles: {
    onnxPath: `${assetDir}/kitten-tts-nano-0.8-int8/kitten_tts_nano_v0_8.onnx`,
    voicesPath: `${assetDir}/kitten-tts-nano-0.8-int8/voices.npz`,
  },
  phonemizer: new CEPhonemizer({
    rulesPath: `${assetDir}/CEPhonemizer/en_rules.txt`,
    listPath: `${assetDir}/CEPhonemizer/en_list.txt`,
  }),
});
```

When `modelFiles` and bundled `CEPhonemizer` paths/text are provided,
`KittenTTS.create()` skips network downloads.
