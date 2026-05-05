# Reader App Tutorial On Windows

This guide shows the read-aloud pattern on Windows: prepare the model once,
split long text into chunks, stream generated audio, and highlight words as
they play. It focuses on Android because iOS builds require macOS.

KittenTTS does not parse EPUB files. Use an EPUB parser to extract plain chapter
text, then pass that plain text to KittenTTS.

## What You Will Build

You will learn how to build:

- A React Native Android reader screen
- A model setup step that does not redownload cached assets
- Long-text reading with `generateStreaming()`
- Word highlighting that starts exactly when playback starts
- A retry flow for failed downloads
- A debug APK for device testing

## Reader Architecture

Do not send a full book to TTS in one call. Use smaller chunks.

| Layer | Job |
| --- | --- |
| EPUB parser | Extract chapter text from `.epub` |
| Text cleaner | Remove unwanted whitespace or book metadata |
| Chunker | Split chapter text into paragraphs or short sections |
| TTS engine | Generate audio for each section |
| Audio player | Play the generated WAV audio |
| Highlighter | Use `wordTimings` to style the active word |
| Progress store | Save chapter, paragraph, and word position |

## Install Windows Tools

Install:

- Node.js 20 or newer
- Android Studio
- Git, optional

In Android Studio, open:

```text
Settings > Languages & Frameworks > Android SDK > SDK Tools
```

Install:

| Tool | Why |
| --- | --- |
| Android SDK Build-Tools | Android build output |
| Android SDK Platform-Tools | `adb` command |
| Android SDK Command-line Tools | Gradle/SDK management |
| Android Emulator | Virtual Android device |
| NDK Side by side | Native ONNX Runtime build |
| CMake | Native C++ build |

## Configure Android Paths

Open PowerShell:

```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", "$env:LOCALAPPDATA\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable(
  "Path",
  $env:Path + ";$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin",
  "User"
)
```

Close PowerShell and open a new one:

```powershell
node -v
npm -v
adb version
```

If `adb version` prints a version, the terminal can see Android Platform Tools.

## Keep The Project Path Short

Native Android dependencies create long build paths. Put the app in a short
folder:

```powershell
mkdir C:\ktts
cd C:\ktts
```

This avoids CMake and Ninja path-length failures.

## Create The App

### Expo Development Build

Expo Go will not work. Use a development build.

```powershell
npx create-expo-app KittenReader
cd KittenReader
npm install @kittentts/react-native
npx expo install expo-audio expo-dev-client
npx expo prebuild --platform android
npx expo run:android
```

### Bare React Native

```powershell
npx @react-native-community/cli init KittenReader
cd KittenReader
npm install @kittentts/react-native react-native-sound
npm run android
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

## Preload The Model

A reader app should download the model before the user taps play. It should also
avoid showing download UI when assets are already cached.

```tsx
import { KittenModel, KittenTTS } from '@kittentts/react-native';

async function prepareReaderModel() {
  const cache = await KittenTTS.getModelCacheInfo({
    model: KittenModel.NanoInt8,
  });

  if (cache.isCached) {
    setSetupText('Voice model is ready.');
    return;
  }

  await KittenTTS.predownload(
    { model: KittenModel.NanoInt8 },
    (progress, info) => {
      if (info?.stage === 'downloading') {
        setSetupText(`Downloading ${info.asset ?? 'model'} ${Math.round(progress * 100)}%`);
      }

      if (info?.stage === 'retrying') {
        setSetupText(`Network issue. Retrying ${info.attempt}/${info.totalAttempts}...`);
      }
    },
  );

  setSetupText('Voice model is ready.');
}
```

Add a retry button for failed or interrupted downloads:

```tsx
async function retryDownload() {
  await KittenTTS.redownloadModel(
    { model: KittenModel.NanoInt8 },
    (progress) => setSetupText(`Redownloading ${Math.round(progress * 100)}%`),
  );
}
```

## Split Book Text

After your EPUB parser gives you a chapter string, split it into manageable
paragraphs.

```tsx
function splitIntoParagraphs(chapterText: string) {
  return chapterText
    .split(/\n\s*\n/g)
    .map(part => part.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}
```

For very large paragraphs:

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

## Create One TTS Engine

Create the engine once for the reading session:

```tsx
const tts = await KittenTTS.create({
  model: KittenModel.NanoInt8,
  player,
});
```

Reuse that instance while the reader is open. Dispose it when leaving the
reader:

```tsx
await tts.dispose();
```

## Stream And Play Paragraphs

`generateStreaming()` yields results sentence by sentence, so playback can start
sooner than if you generated the full chapter first.

```tsx
async function readParagraph(tts: KittenTTS, paragraph: string) {
  for await (const result of tts.generateStreaming(paragraph)) {
    setCurrentResult(result);

    await tts.play(result, {
      onPlaybackStart: () => startWordHighlighting(result),
    });
  }
}
```

Use this for a stop button:

```tsx
await tts.stopSpeaking();
```

## Highlight The Current Word

Start timing only when audio playback starts:

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

Render highlighted words inline:

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

Inline text keeps the paragraph stable while the highlight changes.

## Important Word Timing Notes

- `wordIndex` is inside the current generated result, not the whole book.
- Keep chunks short for better timing and faster generation.
- Start from `onPlaybackStart`, not from `generate()`.
- Audio can include trailing silence, so `result.duration` may be longer than
  the last word timing.

## Build A Debug APK

From the app folder:

```powershell
cd android
.\gradlew.bat assembleDebug
```

APK location:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

Install it on a connected device:

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

## Debug Checklist

| Symptom | What to check |
| --- | --- |
| Expo Go error | Use `npx expo run:android` |
| `adb` not found | Add Platform Tools to `Path` and reopen PowerShell |
| CMake or Ninja path warning | Move project to `C:\ktts\KittenReader` |
| No audio | Confirm the `player` was passed to `KittenTTS.create()` |
| Highlight starts early | Start the timer in `onPlaybackStart` |
| Highlight layout jumps | Render inline `Text`, not separate word boxes |
| `wordTimings` is empty | Try a shorter sentence or paragraph |
| Download failed | Retry with `KittenTTS.redownloadModel()` |

## Suggested Reader UX

- Show "model ready" when cache is already downloaded.
- Show real download progress only while assets are downloading.
- Keep a retry button near setup errors.
- Let users choose voice and speed before playback.
- Save progress by chapter, paragraph, and word index.

## Related Docs

- [Simple TTS on Windows](../simple-tts/windows.md)
- [Simple TTS on macOS](../simple-tts/mac.md)
