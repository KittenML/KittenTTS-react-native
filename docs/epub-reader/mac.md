# EPUB Reader Tutorial On macOS

This tutorial shows how to add KittenTTS to a reader app on macOS. The same
pattern works for EPUB readers, article readers, accessibility readers, study
apps, and "read aloud" modes.

KittenTTS does not parse EPUB files. Your app should extract plain text from the
book first, then give that plain text to KittenTTS.

## What You Will Build

You will learn how to:

- Prepare a React Native app for KittenTTS
- Check whether the model is already downloaded
- Download the model before reading starts
- Split long book text into smaller sections
- Generate audio sentence by sentence with `generateStreaming()`
- Play each generated result
- Highlight the current spoken word
- Recover from interrupted downloads

## The Reader Flow

A reader app should not send an entire book to TTS at once. Use this flow:

| Step | What happens |
| --- | --- |
| 1. Extract | EPUB parser extracts chapter text |
| 2. Clean | App removes headings, footnotes, or unwanted markup |
| 3. Chunk | App splits text into paragraphs or short sections |
| 4. Prepare | App checks/downloads the KittenTTS model |
| 5. Generate | SDK generates one sentence or section |
| 6. Play | SDK plays generated audio |
| 7. Highlight | App uses `wordTimings` during playback |
| 8. Queue | App prepares the next chunk |

This keeps the UI responsive and lets users stop, skip, or resume reading.

## Install macOS Tools

Install:

| Tool | Why |
| --- | --- |
| Node.js 20 or newer | Runs npm and Metro |
| Xcode | Builds iOS apps |
| CocoaPods | Installs iOS pods |
| Android Studio | Builds Android apps and emulators |

Check your terminal:

```bash
node -v
npm -v
xcodebuild -version
pod --version
```

If you only use the published npm package, you do not need Emscripten. You need
Emscripten only when building this SDK repo from source.

## Create The App

### Expo Development Build

Expo Go will not work. Use a development build.

```bash
npx create-expo-app KittenReader
cd KittenReader
npm install @kittentts/react-native
npx expo install expo-audio expo-dev-client
npx expo prebuild
npx expo run:ios
```

Run Android later with:

```bash
npx expo run:android
```

### Bare React Native

```bash
npx @react-native-community/cli init KittenReader
cd KittenReader
npm install @kittentts/react-native react-native-sound
cd ios && pod install && cd ..
npm run ios
```

## Create The Audio Player

Expo:

```tsx
import * as ExpoAudio from 'expo-audio';
import { createExpoAudioPlayer } from '@kittentts/react-native';

const player = createExpoAudioPlayer(ExpoAudio);
```

Bare React Native:

```tsx
import Sound from 'react-native-sound';
import { createRNSoundPlayer } from '@kittentts/react-native';

const player = createRNSoundPlayer(Sound);
```

Pass this player into `KittenTTS.create()`.

## Prepare The Model Before Reading

Do this when the reader screen opens or when the user enables "read aloud".
This avoids showing "downloading" if the model is already cached.

```tsx
import {
  KittenModel,
  KittenTTS,
} from '@kittentts/react-native';

async function prepareReaderModel() {
  const cache = await KittenTTS.getModelCacheInfo({
    model: KittenModel.NanoInt8,
  });

  if (cache.isCached) {
    setSetupStatus('Voice model is ready.');
    return;
  }

  await KittenTTS.predownload(
    { model: KittenModel.NanoInt8 },
    (progress, info) => {
      if (info?.stage === 'downloading') {
        setSetupStatus(`Downloading ${info.asset ?? 'model'} ${Math.round(progress * 100)}%`);
      }

      if (info?.stage === 'retrying') {
        setSetupStatus(`Network issue. Retrying ${info.attempt}/${info.totalAttempts}...`);
      }
    },
  );

  setSetupStatus('Voice model is ready.');
}
```

The SDK retries downloads automatically. Use a retry button for users who lose
internet completely:

```tsx
async function retryDownload() {
  await KittenTTS.redownloadModel(
    { model: KittenModel.NanoInt8 },
    (progress) => setSetupStatus(`Redownloading ${Math.round(progress * 100)}%`),
  );
}
```

## Convert EPUB Text Into Reader Chunks

Use your EPUB parser to get chapter text. Then split it into paragraphs. Keep
chunks short enough that users can stop or skip quickly.

```tsx
function splitIntoParagraphs(chapterText: string) {
  return chapterText
    .split(/\n\s*\n/g)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
```

If a paragraph is very long, split it further:

```tsx
function splitLongParagraph(paragraph: string, maxLength = 500) {
  const sentences = paragraph.match(/[^.!?]+[.!?]+|\S.+$/g) ?? [paragraph];
  const chunks: string[] = [];
  let current = '';

  for (const sentence of sentences) {
    if ((current + ' ' + sentence).trim().length > maxLength && current) {
      chunks.push(current.trim());
      current = sentence;
    } else {
      current = `${current} ${sentence}`.trim();
    }
  }

  if (current) chunks.push(current.trim());
  return chunks;
}
```

## Create One TTS Instance Per Reader Session

Create the engine once, reuse it while the reader is open, then dispose it when
the reader closes.

```tsx
const tts = await KittenTTS.create({
  model: KittenModel.NanoInt8,
  player,
});
```

Do not create a new `KittenTTS` instance for every word or every sentence in a
reader. Create it once for the current reading session.

## Stream And Play Text

`generateStreaming()` yields generated results sentence by sentence. This is
useful for books because playback can start before the whole chapter is ready.

```tsx
async function readText(tts: KittenTTS, text: string) {
  for await (const result of tts.generateStreaming(text)) {
    setCurrentResult(result);

    await tts.play(result, {
      onPlaybackStart: () => startWordHighlighting(result),
    });
  }
}
```

Use `tts.stopSpeaking()` for a stop button:

```tsx
await tts.stopSpeaking();
```

## Highlight Words During Playback

Word timings belong to the generated result that is currently playing. Start
your timer inside `onPlaybackStart`; if you start the timer earlier, highlights
will move before the user hears audio.

```tsx
import type { KittenTTSResult } from '@kittentts/react-native';

function startWordHighlighting(result: KittenTTSResult) {
  const startedAt = Date.now();

  const timer = setInterval(() => {
    const seconds = (Date.now() - startedAt) / 1000;
    const active = result.wordTimings.find(
      item => seconds >= item.startTime && seconds < item.endTime,
    );

    setActiveWordIndex(active?.wordIndex ?? null);
  }, 50);

  return () => clearInterval(timer);
}
```

`wordIndex` is zero-based inside the generated result. In a full reader, store
the current chapter, paragraph, sentence, and `wordIndex` so resume works
correctly.

## Render Highlighted Text

For reliable layout, render words inline and only change the style of the active
word.

```tsx
function ReaderLine({
  words,
  activeWordIndex,
}: {
  words: string[];
  activeWordIndex: number | null;
}) {
  return (
    <Text style={{ fontSize: 20, lineHeight: 32 }}>
      {words.map((word, index) => (
        <Text
          key={`${word}-${index}`}
          style={index === activeWordIndex ? { backgroundColor: '#2D6CDF', color: 'white' } : null}
        >
          {word + ' '}
        </Text>
      ))}
    </Text>
  );
}
```

Avoid rendering each word as a separate flex box. That can make the paragraph
resize when the active word changes.

## Important Word Timing Notes

- `wordTimings` are returned for generated text where timings can be aligned.
- Very long input may be split internally; keep reader chunks short.
- Start highlights from `onPlaybackStart`, not from `generate()`.
- The final audio duration can include trailing silence, so the last word may
  end before `result.duration`.

## Build An Android APK On macOS

If you want an Android APK from the same app:

```bash
cd android
./gradlew assembleDebug
```

The APK is usually here:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Debug Checklist

| Symptom | Check |
| --- | --- |
| Expo Go error | Use `npx expo run:ios` or `npx expo run:android` |
| No audio | Confirm `player` is passed to `KittenTTS.create()` |
| Highlight starts too early | Start the timer inside `onPlaybackStart` |
| Highlight layout jumps | Render inline `Text`, not flex word chips |
| `wordTimings` is empty | Test with a shorter sentence or paragraph |
| Download gets interrupted | Call `KittenTTS.redownloadModel()` |

## Suggested Reader UX

- Show a first-run setup screen for model download.
- Cache whether the model is ready with `getModelCacheInfo()`.
- Let users choose voice before playback.
- Keep play, pause/stop, next paragraph, and retry controls visible.
- Save reading progress by chapter and paragraph, not just audio time.

## Related Docs

- [Simple TTS on macOS](../simple-tts/mac.md)
- [Simple TTS on Windows](../simple-tts/windows.md)
