# Getting Started

This page covers the smallest useful setup: install the SDK, create a TTS
instance, and generate speech.

## Requirements

| Requirement | Version |
| --- | --- |
| React Native | `>= 0.72` |
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

Do not install or register `onnxruntime-react-native` manually. The SDK depends
on it and registers the Android package it needs.

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

For playback with `speak()`, install a player:

```bash
npm install react-native-sound
cd ios && pod install && cd ..
```

## Web

React Native Web builds resolve the package's browser entrypoint. The web
runtime uses `onnxruntime-web`, Cache API storage for downloaded model files,
and the same JavaScript CE phonemizer.

```tsx
import {
  KittenTTS,
  createBrowserAudioPlayer,
} from '@kittentts/react-native';

const tts = await KittenTTS.create({
  player: createBrowserAudioPlayer(),
});

await tts.speak('Hello from KittenTTS on web.');
await tts.dispose();
```

The browser path also supports `generate()`, `wordTimings`, `wavData()`, and
`wavBase64()`. Pass `ortWasmPath` if your app needs to self-host ONNX Runtime
WASM assets instead of using the SDK defaults.

By default, browser builds load the pinned ONNX Runtime Web script and WASM
assets from jsDelivr. That keeps the SDK simple to drop into React Native Web,
but production apps that require tighter supply-chain control or CDN outage
isolation should self-host those files and set `ortWasmPath` to that directory.

## Generate Audio

Use `generate()` when you want audio data back without playing it immediately.

```tsx
import { KittenTTS } from '@kittentts/react-native';

const tts = await KittenTTS.create(undefined, (progress, info) => {
  if (info?.stage === 'cached') {
    console.log('model is already cached');
    return;
  }

  console.log(`setup ${Math.round(progress * 100)}%`);
});

const result = await tts.generate('Hello from KittenTTS on React Native.');

console.log(result.duration);
console.log(result.wordTimings);
console.log(result.wavBase64());

await tts.dispose();
```

`result.wavBase64()` returns a complete WAV file encoded as base64. You can save
it, upload it, or hand it to your own audio pipeline.

## Speak Through Expo Audio

```tsx
import * as ExpoAudio from 'expo-audio';
import { KittenTTS, createExpoAudioPlayer } from '@kittentts/react-native';

const tts = await KittenTTS.create({
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
  player: createRNSoundPlayer(Sound),
});

await tts.speak('This plays through react-native-sound.');
await tts.dispose();
```

## What Happens On First Run

The first `KittenTTS.create()` downloads the selected model, `voices.npz`, and
phonemizer files. Later calls reuse the device cache.
On web, the cache is stored through the browser Cache API when available and
falls back to memory storage.

Default model cache:

```text
<DocumentDirectory>/KittenTTS/<model>/
```

Default phonemizer cache:

```text
<DocumentDirectory>/KittenTTS/CEPhonemizer/
```

To avoid a first-run download, see [bundled offline assets](guides/offline-assets.md).
