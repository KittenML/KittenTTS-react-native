# Getting Started

This page covers the smallest useful setup: install the SDK, create a TTS
instance with Kitten TTS 2 Nano, and generate speech.

## Requirements

| Requirement | Version |
| --- | --- |
| React Native | `>= 0.75` (Hermes) for Kitten TTS 2 Nano, Pico and Mini; `>= 0.72` for Kitten TTS 2 Cloud and the 0.8 models |
| iOS | `15.1+` |
| Android | API `24+` |
| Web | modern browser with WebAssembly support |
| Node.js | `20+` recommended for examples |

Expo Go will not work. KittenTTS depends on native modules:

- `onnxruntime-react-native`
- `react-native-fs`

Use a bare React Native app, an Expo development build, or a prebuilt Expo app.
React Native Web builds use `onnxruntime-web` and do not require those native
modules at runtime.

## Install

```bash
npm install @kittentts/react-native
```

In an Expo app that is all: Expo links the SDK's native dependencies. A bare
React Native app needs one more step for iOS, below. For the Kitten TTS 2
languages other than English and Japanese, also install
[`@kittentts/espeak-ng`](#other-languages).

## Expo Development Build

```bash
npx expo install expo-audio expo-dev-client
npx expo prebuild
npx expo run:ios
```

For Android:

```bash
npx expo run:android
```

After the development build is installed, keep using that app with:

```bash
npx expo start --dev-client
```

## Bare React Native

React Native CLI links only the app's own dependencies on iOS, so add ONNX
Runtime and the file system module to the app, and keep the CLI from linking ONNX
Runtime on Android, where the SDK registers it itself. For playback with
`speak()`, install a player too:

```bash
npm install onnxruntime-react-native "react-native-fs@npm:@dr.pogodin/react-native-fs@>=2.38.2 <2.41.0" react-native-sound
cd ios && pod install && cd ..
```

```js
// react-native.config.js
module.exports = {
  dependencies: {
    'onnxruntime-react-native': { platforms: { android: null } },
  },
};
```

Without them, iOS fails at the first `create()` because the ONNX Runtime module
is missing. `react-native-fs` 2.41 needs React Native 0.88; keep the range above
on older apps.

## Generate Audio

Use `generate()` when you want audio data back without playing it immediately.

```tsx
import { KittenTTS } from '@kittentts/react-native';

const tts = await KittenTTS.create({ model: 'kitten-tts-2-nano' }, (progress, info) => {
  if (info?.stage === 'downloading') {
    console.log(`download ${Math.round(progress * 100)}%`);
  }
});

const result = await tts.generate('Hello from Kitten TTS 2 on React Native.', { voice: 'Eleanor' });

console.log(result.duration);
console.log(result.wordTimings);
console.log(result.wavBase64());

await tts.dispose();
```

`result.wavBase64()` returns a complete WAV file encoded as base64. You can save
it, upload it, or hand it to your own audio pipeline.

`model` can also be `'kitten-tts-2-pico'` (the fastest) or `'kitten-tts-2-mini'`
(16 languages). `tts.availableVoices` lists each language's voices. See
[Kitten TTS 2 Nano, Pico and Mini](guides/kitten-tts-2-tiny.md) for weights,
languages and the other options.

## Speak Through Expo Audio

```tsx
import * as ExpoAudio from 'expo-audio';
import { KittenTTS, createExpoAudioPlayer } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  model: 'kitten-tts-2-nano',
  player: createExpoAudioPlayer(ExpoAudio),
});

await tts.speak('This plays through expo-audio.');
await tts.dispose();
```

## Speak Through React Native Sound

```tsx
import Sound from 'react-native-sound';
import { KittenTTS, createRNSoundPlayer } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  model: 'kitten-tts-2-nano',
  player: createRNSoundPlayer(Sound),
});

await tts.speak('This plays through react-native-sound.');
await tts.dispose();
```

## Web

React Native Web builds resolve the package's browser entrypoint. The web
runtime uses `onnxruntime-web` and Cache API storage for downloaded files.

```tsx
import {
  KittenTTS,
  createBrowserAudioPlayer,
} from '@kittentts/react-native';

const tts = await KittenTTS.create({
  model: 'kitten-tts-2-nano',
  player: createBrowserAudioPlayer(),
});

await tts.speak('Hello from Kitten TTS 2 on the web.');
await tts.dispose();
```

The browser path also supports `generate()`, `wordTimings`, `wavData()`, and
`wavBase64()`. Pass `ortWasmPath` if your app needs to self-host ONNX Runtime
WASM assets instead of using the SDK defaults.

By default, browser builds load the pinned ONNX Runtime Web script and WASM
assets from jsDelivr. That keeps the SDK simple to drop into React Native Web,
but production apps that require tighter supply-chain control or CDN outage
isolation should self-host those files and set `ortWasmPath` to that directory.

## Other Languages

English, and Japanese on Mini, need nothing more. The other languages go through
espeak-ng, as in the Python package:

- Nano, Pico and Mini: German, French, Spanish, Italian, Portuguese, Russian,
  Hindi (`de fr es it pt ru hi`)
- Mini also: Danish, Finnish, Dutch, Swedish, Swahili, Turkish, Korean
  (`da fi nl sv sw tr ko`)

espeak-ng is GPL-3.0-or-later, so it comes in its own package. Install it and
import it once, for example in the app's entry file:

```bash
npm install @kittentts/espeak-ng
```

```tsx
import '@kittentts/espeak-ng';
import { KittenTTS } from '@kittentts/react-native';

const tts = await KittenTTS.create({ model: 'kitten-tts-2-nano', languages: ['en', 'de'] });
await tts.generate('Guten Morgen.', { language: 'de' });
```

Without the import, those languages fail in `create()` (before anything
downloads) or on first use with `KittenTTSErrorCode.MissingDependency`
(`MISSING_DEPENDENCY`), and the message names the package. An app that includes
it ships GPL-3.0-or-later code; one that doesn't ships none. See
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

## Kitten TTS 2 Cloud

Kitten TTS 2 Cloud, with voice cloning, presets and 20+ languages, runs on the
Kitten API and needs an API key:

```tsx
const tts = await KittenTTS.create({ model: 'kitten-tts-2-cloud', apiKey: KITTENML_API_KEY });
await tts.generate('Hello.', 'bella_en');
```

See the [Kitten TTS 2 Cloud guide](guides/kitten-api.md), including how to keep
the key off the device.

## Kitten TTS 0.8

The older English models are still supported. They have eight voices
(`KittenVoice`) and their own cache helpers:

```tsx
import { KittenModel, KittenTTS, KittenVoice } from '@kittentts/react-native';

const tts = await KittenTTS.create({ model: KittenModel.NanoInt8 }, (progress, info) => {
  if (info?.stage === 'cached') {
    console.log('model is already cached');
  }
});

const result = await tts.generate('Hello from Kitten TTS 0.8.', KittenVoice.Luna);
```

With no `model`, `KittenTTS.create()` loads 0.8 Nano, as before. See
[Models and voices](reference/models.md#kitten-tts-08).

## What Happens On First Run

The first `KittenTTS.create({ model: 'kitten-tts-2-nano' })` downloads the
model's config, the ONNX graph and voices of each language in `languages` (by
default English), and that language's text data. A language you use later
downloads on first use. Later calls reuse the device cache.
[What gets downloaded](guides/kitten-tts-2-tiny.md#what-gets-downloaded) has the
sizes.

A 0.8 model downloads its ONNX file, `voices.npz` and the CEPhonemizer files.

On web, the cache is stored through the browser Cache API when available and
falls back to memory storage.

Default cache folders:

```text
<DocumentDirectory>/KittenTTS/kitten-tts-2-nano/      Kitten TTS 2 (one per model)
<DocumentDirectory>/KittenTTS/kitten-tts-2-text-v2/   Kitten TTS 2 text data
<DocumentDirectory>/KittenTTS/<model>/                Kitten TTS 0.8
<DocumentDirectory>/KittenTTS/CEPhonemizer/           Kitten TTS 0.8 phonemizer
```

To avoid a first-run download, see [bundled offline assets](guides/offline-assets.md).
