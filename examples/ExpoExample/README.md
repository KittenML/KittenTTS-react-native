# KittenTTS Expo Example

An Expo (SDK 58) app for `@kittentts/react-native` with every engine the SDK has:

- **0.8**: Nano, Nano int8, Micro and Mini on the device, English, 8 voices.
- **TTS 2 on device**: Kitten TTS 2 Nano, Pico and Mini on the device, 8 languages
  (Mini 16), each language's own voices. A language's files download the first
  time it is used.
- **TTS 2 cloud**: Kitten TTS 2 Cloud, and Nano, Pico and Mini, on the Kitten API. Needs
  an API key (or your own backend, below).

One screen: pick a model (they are grouped by where they run), type, choose a
language, voice and speed, then **Speak** (and **Stop**) or **Generate**, which
shows how long it took. It runs on iOS, Android and the web, in light and dark
mode, with the look of KittenML's web app (`components/ui.tsx`, no UI library).

Expo Go is not supported because the SDK depends on native modules for ONNX
inference and filesystem access. Use a development build.

## Run The Example

Prerequisites:

- Node.js >= 20
- Android Studio with an emulator open for Android
- Xcode with an iOS simulator available for iOS

```bash
cd examples/ExpoExample
npm install
npm run ios       # or: npm run android, npm run web
```

Until `@kittentts/react-native` 2.0.0 is on npm, or to try changes to the SDK,
install this checkout instead of `npm install`, from the repository root:

```bash
npm run example:install -- ExpoExample
```

It builds the SDK and installs it without changing the example's
`package.json` (the generated runtimes must exist: `npm run build` makes them
once, see [Development](../../docs/development.md)).

## The Cloud Models

Type a key from the
[API key dashboard](https://platform.kittenml.com/developers/api-keys) into the
app, or put it in `.env.local` while you try things out:

```bash
EXPO_PUBLIC_KITTENML_API_KEY=sk_kitten_live_...
```

A key inside an app can be extracted from it, so a real app sends the requests to
its own backend, which adds the key (see the
[Kitten API guide](../../docs/guides/kitten-api.md#keep-your-key-off-the-device)).
Point the example at one with:

```bash
EXPO_PUBLIC_KITTENML_BASE_URL=https://your-backend.example/kitten
```

Each cloud generation is billed to your KittenML account.

## Build A Debug APK

The APK is written under `android/app/build/outputs/apk/debug/`. It is a
development build, so start Metro with `npm start` when you install it by hand.

```bash
cd examples/ExpoExample
npm install
npx expo prebuild --platform android && cd android && ./gradlew assembleDebug
```

## How It Works

One call creates every engine; the model decides which one you get:

```typescript
import * as ExpoAudio from 'expo-audio';
import { KittenModel, KittenTTS, KittenVoice, createExpoAudioPlayer } from '@kittentts/react-native';

const player = createExpoAudioPlayer(ExpoAudio);

const onnx = await KittenTTS.create({ model: KittenModel.NanoInt8, player });            // 0.8
const tiny = await KittenTTS.create({ model: 'kitten-tts-2-nano', player });              // on device
const cloud = await KittenTTS.create({ model: 'kitten-tts-2-cloud', apiKey, player });    // Kitten API

await onnx.speak('Hello.', KittenVoice.Luna);
await tiny.speak('Guten Morgen!', { voice: 'Anna', language: 'de' });
await cloud.speak('Hello.', 'bella_en');
await cloud.stopSpeaking();
```

Voices differ per engine: `ALL_VOICES` for 0.8, `tts.voices()` (per language) on
the device, `tts.voices` for the cloud. `App.tsx` reads them into one picker.
On the web it plays through `createBrowserAudioPlayer()` instead of expo-audio.

For word highlighting, see `examples/ExpoWordTimingsExample`; for shipping the
model files inside the app, `examples/OfflineBundledAssetsExample`.
