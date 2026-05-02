# KittenTTS Bare RN Example

A React Native app demonstrating the `@kittentts/react-native` SDK.

This is the bare React Native example. Use it if you want to test the SDK in a
normal React Native app with native `ios/` and `android/` folders.

Install only `@kittentts/react-native` for the SDK. The example does not add
`onnxruntime-react-native` directly because the SDK registers ONNX Runtime from
its own Android package.

Use this example when your app is not Expo, or when you want direct control over
the native Android/iOS projects.

## Features

- Model selection (Nano, Nano int8, Micro, Mini)
- Voice selection (8 voices)
- Adjustable speed (0.5x to 2.0x)
- Generate and play speech on-device
- Download progress indicator
- Result card showing audio metadata

## Run The Example

Run these commands from the repository root.

From a fresh clone, generate the local SDK package first because the examples
install `file:../../kittentts-react-native-0.8.0.tgz` and `.tgz` files are not
committed:

```bash
npm install
npm pack
```

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

The same commands work on macOS, Linux, and Windows. Keep Metro running while
the app is open. Set `RCT_METRO_PORT=8082` if port `8081` is already in use.
The first run downloads the model files, so keep the simulator/emulator online.

On macOS/Linux, `npm run android:unix` and `npm run ios:unix` are optional
helpers that start Metro automatically.

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

1. On first launch, the app downloads the selected model (~56 MB for Nano)
2. Type any English text in the input field
3. Select a model, voice, and speed
4. Tap **Generate** to synthesise audio (returns metadata without playing)
5. Tap **Speak** to synthesise and play through the device speakers

The model is cached on disk after the first download, so subsequent launches are instant.

## Beginner Implementation Notes

Bare React Native needs an audio player. This example uses
`react-native-sound`:

```typescript
import Sound from 'react-native-sound';
import { KittenTTS, createRNSoundPlayer } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  player: createRNSoundPlayer(Sound),
});
```

Generate only:

```typescript
const result = await tts.generate('Hello from KittenTTS.');
console.log(result.duration, result.wordTimings);
```

Generate and play:

```typescript
await tts.speak('Hello from KittenTTS.');
```

If you need word highlighting, generate first and then play:

```typescript
const result = await tts.generate(text);
await tts.play(result, {
  onPlaybackStart: () => startWordHighlighting(result.wordTimings),
});
```

For a full highlighting UI, see `examples/ExpoWordTimingsExample`.
