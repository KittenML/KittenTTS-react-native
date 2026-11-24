# KittenTTS Expo Word Timings Example

Expo SDK 58 development-build example. This app showcases
`KittenTTSResult.wordTimings` by generating audio and displaying each word's
start and end time. It also shows how to start highlighting only after playback
begins. Pick Kitten TTS 2 Nano (the default), Pico or Mini, or the 0.8 Nano
int8 model: every on-device model returns word timings (the cloud models do
not). The text is English, so the app does not need `@kittentts/espeak-ng`.

Expo Go will not work for this app because `@kittentts/react-native` depends on
native modules for ONNX Runtime and filesystem access.

## Run The Example

Run these commands from the repository root. Use a development build; Expo Go
will not work.

Prerequisites:

- Node.js >= 20
- Android Studio with an emulator open for Android
- Xcode with an iOS simulator available for iOS

Android:

```bash
cd examples/ExpoWordTimingsExample
npm install
npm run android
```

iOS:

```bash
cd examples/ExpoWordTimingsExample
npm install
npm run ios
```

After the native app opens, keep Metro running. If you already built the app and
only want to restart JavaScript, use:

```bash
cd examples/ExpoWordTimingsExample
npm start -- --clear
```

Until `@kittentts/react-native` 2.0.0 is on npm, or to try changes to the SDK,
install this checkout instead of `npm install`, from the repository root:

```bash
npm run example:install -- ExpoWordTimingsExample
```

## Build A Debug APK

The APK will be written under `android/app/build/outputs/apk/debug/`.
This is a development-build APK, so start Metro with `npm start` when testing it
after manual install.

```bash
cd examples/ExpoWordTimingsExample
npm install
npx expo prebuild --platform android && cd android && ./gradlew assembleDebug
```

On Windows, run the same command in PowerShell but use `.\gradlew.bat
assembleDebug` inside the `android` folder.

## Notes

Tap **Generate** to inspect word-level timestamps without playback, or **Speak**
to generate, play (with **Stop**), and show the same timing metadata. Choosing a
model downloads it the first time; later runs reuse the local cache.

## What To Copy Into Your App

Use this flow when you want synced word highlighting:

```typescript
const result = await tts.generate(text, voice); // 'Eleanor' for Kitten TTS 2, a KittenVoice for 0.8
setResult(result);

await tts.play(result, {
  onPlaybackStart: () => startWordHighlighting(result),
});
```

The example's `startWordHighlighting()` reads `result.wordTimings` and compares
each word's `startTime` / `endTime` against the playback timer.

For long documents, generate smaller chunks instead of one large string, and
highlight each as it plays:

```typescript
for (const paragraph of paragraphs) {
  const result = await tts.generate(paragraph, voice);
  await tts.play(result, {
    onPlaybackStart: () => startWordHighlighting(result),
  });
}
```

`generateStreaming()` starts sooner, but with Kitten TTS 2 Nano, Pico and Mini
its chunks carry no word timings (the 0.8 models' sentence chunks do).

This is the recommended starting point for EPUB readers, articles, and other
long-form text. Build your own queue if you need pause, resume, chapter state,
or preloading the next paragraph while the current one plays.
