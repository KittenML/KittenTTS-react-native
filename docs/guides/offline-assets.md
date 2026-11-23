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

## Kitten TTS 2 Nano, Pico and Mini

The same command bundles the [Kitten TTS 2 small models](kitten-tts-2-tiny.md).
They download per language, so say which languages and weights to ship:

```bash
npx @kittentts/react-native bundle-assets \
  --models kitten-tts-2-nano \
  --weights int8 \
  --languages en,de \
  --out assets/kittentts
```

| Flag | Default | |
| --- | --- | --- |
| `--models` | | `kitten-tts-2-nano`, `kitten-tts-2-pico`, `kitten-tts-2-mini`; can be mixed with 0.8 models |
| `--languages` | the model's default (`en`) | codes such as `en,de`; Mini also `da fi ja ko nl sv sw tr`. With several models, a language one of them lacks is left out for that model only |
| `--weights` | `int8` | `int4` is about half the size |
| `--text-data-url`, `--model-base-url` | Hugging Face | other hosts for the text data and the model files |

The CLI asks the SDK which files `KittenTTS.create()` and `generate()` read for
those languages and weights, and downloads exactly those:

```text
assets/kittentts/
  manifest.json
  kitten-tts-2-nano/                 laid out like the Hugging Face repository
    config.json
    vocab.json
    kitten_tts_2_nano_en.onnx
    voices_en.npz
    g2p/g2p_bart_en_us/...           English only
    kitten_tts_2_nano_de.onnx
    voices_de.npz
  kitten-tts-2-text/                 the text data, shared by the models
    manifest.json
    en/misaki-us-gold.json.gz ...    big files stay gzipped
    espeak-ng-data/...               languages other than English and Japanese
```

Nano int8 with English and German is 51 MB (23 files): 17 MB per language
graph, the voices, the 3 MB English G2P model and 5.9 MB of text data. Text
data files are checked against its manifest's sha256 sums. Running the command again
downloads only what is missing, and it lists files an earlier run left behind
(another language, say), since the config plugin would still copy them into the
app.

The manifest is then version 3: the 0.8 fields as before (`models` is `{}` when
there are no 0.8 models, so `bundledAssetModels()` still works) and a
`kittenTTS2` section with each model's weights, languages and files (path, size
and sha256). A bundle with only 0.8 models is still written as version 2.

Load it with `createBundledTinyOptions()` and spread the result into
`KittenTTS.create()`:

```tsx
import {
  KittenTTS,
  bundledTinyModels,
  createBundledTinyOptions,
  type KittenTTSBundledAssetsManifest,
} from '@kittentts/react-native';
import manifestJson from './assets/kittentts/manifest.json';

const manifest = manifestJson as KittenTTSBundledAssetsManifest;

bundledTinyModels(manifest);                       // ['kitten-tts-2-nano']
const tts = await KittenTTS.create({
  ...(await createBundledTinyOptions(manifest)),   // or { model: 'kitten-tts-2-nano' }
  player,
});
await tts.generate('Guten Morgen.', { language: 'de' });
```

It returns `{ model, weights, languages, modelDirectory, textDataDirectory }`,
so `create()` loads the bundled languages and downloads nothing. A language that
is not in the bundle fails with `MODEL_FILE_NOT_FOUND` instead of downloading.

- **iOS:** the folders point into the app bundle
  (`<MainBundle>/kittentts/...`). The gzipped text files are unpacked in memory
  each time a language loads.
- **Android:** APK assets are not files, so the model's files are copied once
  into `<DocumentDirectory>/KittenTTS/bundled` (`copyDirectory` changes it) and
  the folders point there. Files already there with the right size are kept; a
  file an app update changed is copied again. Android's build unpacks `.gz`
  assets and drops the extension, so those arrive plain.
- **Web:** the folders are URL prefixes under `assetRoot` (default
  `kittentts`) or `basePath`; serve the bundle as static files, with a 404 for
  missing files.

`basePath` points at a folder that already holds the bundle (your own asset
layer, or Node).
