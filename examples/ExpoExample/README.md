# KittenTTS Expo Example

An Expo (SDK 58) app for `@kittentts/react-native` with every engine the SDK has:

- **Kitten TTS 2 on the device** (the default): Nano, Pico and Mini, 8 languages
  (Mini 16), each language's own voices. A language's files download the first
  time it is used.
- **Kitten TTS 2 in the cloud**: Kitten TTS 2 Cloud, and Nano, Pico and Mini, on
  the Kitten API. Needs an API key (or your own backend, below).
- **Kitten TTS 0.8**: the older Nano, Nano int8, Micro and Mini on the device,
  English, 8 voices.

It imports `@kittentts/espeak-ng` (a dependency, `^1.0.0`) so that Nano, Pico
and Mini speak every language, not only English and Japanese. That package is
GPL-3.0-or-later; an app that leaves it out ships no GPL code, and those
languages then fail with `MISSING_DEPENDENCY`.

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

Until `@kittentts/react-native` 2.0.0 and `@kittentts/espeak-ng` are on npm, or
to try changes to the SDK, install local builds instead of `npm install`, from
the repository root, with `KITTENTTS_ESPEAK_NG_DIR` pointing at a checkout of
`@kittentts/espeak-ng` where `npm run build` has run:

```bash
KITTENTTS_ESPEAK_NG_DIR=../kittentts-espeak-ng npm run example:install -- ExpoExample
```

It builds both packages and installs them without changing the example's
`package.json` (the SDK's CEPhonemizer runtime must exist: `npm run build` makes
it once, see [Development](../../docs/development.md)).

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
import '@kittentts/espeak-ng'; // German and the other espeak languages
import * as ExpoAudio from 'expo-audio';
import { KittenModel, KittenTTS, KittenVoice, createExpoAudioPlayer } from '@kittentts/react-native';

const player = createExpoAudioPlayer(ExpoAudio);

const tiny = await KittenTTS.create({ model: 'kitten-tts-2-nano', player });              // on device
const cloud = await KittenTTS.create({ model: 'kitten-tts-2-cloud', apiKey, player });    // Kitten API
const onnx = await KittenTTS.create({ model: KittenModel.NanoInt8, player });            // 0.8

await tiny.speak('Guten Morgen!', { voice: 'Anna', language: 'de' });
await cloud.speak('Hello.', 'bella_en');
await onnx.speak('Hello.', KittenVoice.Luna);
await cloud.stopSpeaking();
```

Voices differ per engine: `tts.voices()` (per language) for Kitten TTS 2 on the
device, `tts.voices` for the cloud, `ALL_VOICES` for 0.8. `App.tsx` reads them into one picker.
On the web it plays through `createBrowserAudioPlayer()` instead of expo-audio.

For word highlighting, see `examples/ExpoWordTimingsExample`; for shipping the
model files inside the app, `examples/OfflineBundledAssetsExample`.
