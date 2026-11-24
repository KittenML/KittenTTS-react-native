# KittenTTS Bare RN Example

A React Native app demonstrating the `@kittentts/react-native` SDK.

This is the bare React Native example. Use it if you want to test the SDK in a
normal React Native app with native `ios/` and `android/` folders.

It is the same app as `examples/ExpoExample` (every engine: Kitten TTS 2 Nano,
Pico and Mini on the device, Kitten TTS 2 Cloud with the cloud Nano, Pico and
Mini, and the 0.8 models), in React Native 0.81 with `react-native-sound` for
playback.

Like the Expo example, it imports `@kittentts/espeak-ng` (a dependency,
`^1.0.0`) so that Nano, Pico and Mini speak every language, not only English
and Japanese. That package is GPL-3.0-or-later; an app that leaves it out ships
no GPL code, and those languages then fail with `MISSING_DEPENDENCY`.

Besides `@kittentts/react-native`, a bare app lists `onnxruntime-react-native` and
`react-native-fs` itself: React Native CLI links only the app's own dependencies
on iOS. `react-native.config.js` keeps the CLI from also linking ONNX Runtime on
Android, where the SDK registers it. The iOS app uses the scene lifecycle
(`SceneDelegate` in `AppDelegate.mm`), which apps built with the iOS 27 SDK need.

Use this example when your app is not Expo, or when you want direct control over
the native Android/iOS projects.

## Features

- One model picker for every engine: Kitten TTS 2 on the device (Nano, Pico,
  Mini), 0.8 (Nano, Nano int8, Micro, Mini), Kitten TTS 2 Cloud and the cloud
  Nano, Pico and Mini
- Language and voice pickers filled from the loaded model, and speed
- Speak, stop and generate, with download progress and how long it took
- Light and dark mode, in the style of KittenML's web app (`components/ui.tsx`)

For the cloud models, type a Kitten API key into the app, or set `ENV_BASE_URL` in
`App.tsx` to your own backend, which adds the key (see the
[Kitten API guide](../../docs/guides/kitten-api.md#keep-your-key-off-the-device)).

## Run The Example

Run these commands from the repository root.

Prerequisites:

- Node.js >= 20
- Android Studio with an emulator open for Android
- Xcode with an iOS simulator available for iOS

Android:

```bash
cd examples/BareRNExample
npm install
npm start
```

In a second terminal:

```bash
cd examples/BareRNExample
npm run android
```

iOS:

```bash
cd examples/BareRNExample
npm install
cd ios
pod install
cd ..
npm start
```

In a second terminal:

```bash
cd examples/BareRNExample
npm run ios
```

Android works the same way on macOS, Linux and Windows; iOS needs a Mac. Keep
Metro running while the app is open. Set `RCT_METRO_PORT=8082` if port `8081` is already in use.
The first run downloads the model files, so keep the simulator/emulator online.

On macOS/Linux, `npm run android:unix` and `npm run ios:unix` are optional
helpers that start Metro automatically.

Until `@kittentts/react-native` 2.0.0 and `@kittentts/espeak-ng` are on npm, or
to try changes to the SDK, install local builds instead of `npm install`, from
the repository root, with `KITTENTTS_ESPEAK_NG_DIR` pointing at a checkout of
`@kittentts/espeak-ng` where `npm run build` has run (then `pod install` in
`ios/` as above):

```bash
KITTENTTS_ESPEAK_NG_DIR=../kittentts-espeak-ng npm run example:install -- BareRNExample
```

## Build A Debug APK

The APK will be written under `android/app/build/outputs/apk/debug/`.
This is a debug APK, so start Metro with `npm start` when testing it.

```bash
cd examples/BareRNExample
npm install
cd android
./gradlew assembleDebug
```

On Windows, use `gradlew.bat assembleDebug` in the `android` folder.

## Troubleshooting

If the app opens with "No script URL provided", Metro is not running on the port
the app expects. Run `npm start` from `examples/BareRNExample`, then reload.

## How It Works

1. On first launch, the app loads Kitten TTS 2 Nano, the first model in the
   list, and downloads its English files
2. Select a model, language, voice, and speed (another language's files
   download the first time it is used)
3. Type text in the input field
4. Tap **Generate** to synthesise audio (returns metadata without playing)
5. Tap **Speak** to synthesise and play through the device speakers

The files are cached on disk after the first download, so later launches skip
the download.

## Beginner Implementation Notes

Bare React Native needs an audio player. This example uses
`react-native-sound`:

```typescript
import Sound from 'react-native-sound';
import { KittenTTS, createRNSoundPlayer } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  model: 'kitten-tts-2-nano',
  player: createRNSoundPlayer(Sound),
});
```

Generate only:

```typescript
const result = await tts.generate('Hello from KittenTTS.', { voice: 'Eleanor' });
console.log(result.duration, result.wordTimings);
```

Generate and play:

```typescript
await tts.speak('Hello from KittenTTS.', { voice: 'Eleanor' });
```

If you need word highlighting, generate first and then play:

```typescript
const result = await tts.generate(text);
await tts.play(result, {
  onPlaybackStart: () => startWordHighlighting(result.wordTimings),
});
```

For a full highlighting UI, see `examples/ExpoWordTimingsExample`.
