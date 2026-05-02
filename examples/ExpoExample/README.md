# KittenTTS Expo Example

An Expo development-build example for `@kittentts/react-native`.

Expo Go is not supported because the SDK depends on native modules for ONNX
inference and filesystem access.

This example uses Expo SDK 54. For the Expo SDK 55 version, see
`examples/ExpoWordTimingsExample`.

Use this example when you want a simple Expo app with model, voice, speed,
generate, and speak controls. Use `ExpoWordTimingsExample` when you specifically
want word highlighting.

## Run The Example

Run these commands from the repository root. Use a development build; Expo Go
will not work.

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
cd examples/ExpoExample
npm install
npm run android
```

iOS:

```bash
cd examples/ExpoExample
npm install
npm run ios
```

## Build A Debug APK

The APK will be written under `android/app/build/outputs/apk/debug/`.
This is a development-build APK, so start Metro with `npm start` when testing it
after manual install.

```bash
cd examples/ExpoExample
npm install
npx expo prebuild --platform android && cd android && ./gradlew assembleDebug
```

## Notes

The example consumes the local SDK tarball through
`file:../../kittentts-react-native-0.8.0.tgz`, matching how a published package
is installed. Run `npm pack` from the repository root again after SDK changes.
Android 16 KB page-size handling lives in the SDK package, so
regenerating `android/` does not require app-side patches.

The first app run downloads the model and phonemizer files. Later runs reuse the
local cache.

## Beginner Implementation Notes

The important setup is:

```typescript
import * as ExpoAudio from 'expo-audio';
import { KittenTTS, createExpoAudioPlayer } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  player: createExpoAudioPlayer(ExpoAudio),
});
```

Then either generate metadata:

```typescript
const result = await tts.generate('Hello from KittenTTS.');
```

Or generate and play:

```typescript
await tts.speak('Hello from KittenTTS.');
```

For word highlighting, copy the pattern from
`examples/ExpoWordTimingsExample`.
