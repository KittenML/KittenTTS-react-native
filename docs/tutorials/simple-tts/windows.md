# Simple TTS App On Windows

This is the long version of the quick start for Windows. It builds a small
Android app with a text box, a Speak button, and on-device speech generation.

iOS builds require macOS, so this guide focuses on Android.

## What You Will Build

You will create:

- A React Native Android app
- A text box
- A `Speak` button
- A download progress message
- A debug APK you can install on a device

It uses Kitten TTS 2 Nano, which runs on the device. It does not need a server
or cloud TTS key.

## Choose Your App Type

| App type | Use this when | Audio package |
| --- | --- | --- |
| Expo development build | You want Expo tooling with native modules | `expo-audio` |
| Bare React Native | You want the React Native CLI directly | `react-native-sound` |

Expo Go will not work. KittenTTS needs native modules, and Expo Go does not ship
with this SDK inside it.

## Install Windows Tools

Install:

- Node.js 20 or newer
- Android Studio
- Git, optional but useful

Open Android Studio, then go to:

```text
Settings > Languages & Frameworks > Android SDK > SDK Tools
```

Install these tools:

| Tool | Required? | Why |
| --- | --- | --- |
| Android SDK Build-Tools | Yes | Compiles Android projects |
| Android SDK Platform-Tools | Yes | Provides `adb` |
| Android SDK Command-line Tools | Yes | Required by Gradle and React Native |
| Android Emulator | Yes for emulator testing | Runs an Android virtual device |
| NDK Side by side | Yes | Builds native ONNX Runtime code |
| CMake | Yes | Builds native C++ dependencies |

## Add Android Tools To PATH

Open PowerShell and run:

```powershell
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable("ANDROID_SDK_ROOT", "$env:LOCALAPPDATA\Android\Sdk", "User")
[Environment]::SetEnvironmentVariable(
  "Path",
  $env:Path + ";$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin",
  "User"
)
```

Close PowerShell, open a new PowerShell window, then check:

```powershell
node -v
npm -v
adb version
```

If `adb version` works, your Android Platform Tools path is ready.

## Put The Project In A Short Path

On Windows, native Android builds can fail when the folder path is too long.
Use a short folder:

```powershell
mkdir C:\ktts
cd C:\ktts
```

Avoid paths like:

```text
C:\Users\Administrator\Downloads\very-long-folder-name\another-long-folder-name
```

## Option A: Create An Expo App

Use this if you want Expo with a native development build.

```powershell
npx create-expo-app SimpleKittenTTS
cd SimpleKittenTTS
npm install @kittentts/react-native
npx expo install expo-audio expo-dev-client
npx expo prebuild --platform android
npx expo run:android
```

What the commands do:

| Command | Meaning |
| --- | --- |
| `create-expo-app` | Creates a new Expo project |
| `npm install @kittentts/react-native` | Adds the SDK |
| `expo install expo-audio expo-dev-client` | Adds audio playback and dev-build support |
| `expo prebuild --platform android` | Creates the native `android/` folder |
| `expo run:android` | Builds and installs the development app |

## Option B: Create A Bare React Native App

Use this if you want a normal React Native CLI project.

```powershell
npx @react-native-community/cli init SimpleKittenTTS
cd SimpleKittenTTS
npm install @kittentts/react-native react-native-sound
npm run android
```

## Add A Working TTS Screen

Open `App.tsx` and replace it with the version for your app type.

### Expo `App.tsx`

```tsx
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as ExpoAudio from 'expo-audio';
import {
  KittenTTS,
  createExpoAudioPlayer,
  isKittenTTSError,
} from '@kittentts/react-native';

export default function App() {
  const [text, setText] = useState('Hello from KittenTTS on Android.');
  const [status, setStatus] = useState('Ready');
  const [busy, setBusy] = useState(false);
  const player = useMemo(() => createExpoAudioPlayer(ExpoAudio), []);

  const speak = useCallback(async () => {
    if (!text.trim()) return;

    setBusy(true);
    setStatus('Preparing voice model...');

    try {
      const tts = await KittenTTS.create({ model: 'kitten-tts-2-nano', player }, (progress, info) => {
        if (info?.stage === 'downloading') {
          setStatus(`Downloading model ${Math.round(progress * 100)}%`);
        }
      });

      setStatus('Speaking...');
      await tts.speak(text, { voice: 'Eleanor' });
      setStatus('Done');
      await tts.dispose();
    } catch (error) {
      setStatus(readableError(error));
    } finally {
      setBusy(false);
    }
  }, [player, text]);

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.content}>
        <Text style={styles.title}>Simple KittenTTS</Text>
        <TextInput
          value={text}
          onChangeText={setText}
          multiline
          editable={!busy}
          style={styles.input}
        />
        <Button title={busy ? 'Working...' : 'Speak'} onPress={speak} disabled={busy} />
        <View style={styles.status}>
          {busy ? <ActivityIndicator /> : null}
          <Text style={styles.statusText}>{status}</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

function readableError(error: unknown) {
  if (isKittenTTSError(error)) {
    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Something went wrong.';
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#F7F8FA',
  },
  content: {
    flex: 1,
    gap: 16,
    padding: 24,
    justifyContent: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
  },
  input: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#D5DAE1',
    borderRadius: 8,
    padding: 14,
    backgroundColor: '#FFFFFF',
    fontSize: 17,
  },
  status: {
    minHeight: 28,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  statusText: {
    fontSize: 15,
    color: '#4B5563',
  },
});
```

### Bare React Native `App.tsx`

For a bare app, use `react-native-sound` instead of `expo-audio`:

```tsx
import Sound from 'react-native-sound';
import {
  KittenTTS,
  createRNSoundPlayer,
  isKittenTTSError,
} from '@kittentts/react-native';

const player = useMemo(() => createRNSoundPlayer(Sound), []);
```

The rest of the Expo `App.tsx` can stay the same.

## Test The App

Start the emulator from Android Studio or connect a physical Android phone with
USB debugging enabled.

Then run:

```powershell
npx expo run:android
```

or, for bare React Native:

```powershell
npm run android
```

Expected first run:

1. The app installs on the emulator or phone.
2. The app shows model download progress.
3. The app speaks the text.
4. The next run uses the local cache and should not download again.

## Retry A Failed Download

If the user loses internet in the middle of a download, tapping `Speak` again is
the retry: `KittenTTS.create()` downloads only the files that are still missing,
and tries each file 4 times (`downloadRetries`). A file that did not finish is
not kept.

## Download Before The First Speak

To show a setup screen before the user taps `Speak`, download the model's files
first with `KittenTTS2Tiny.predownload()`. It downloads nothing when the files
are already there:

```tsx
import { KittenTTS2Tiny } from '@kittentts/react-native';

async function prepareModel() {
  setBusy(true);

  try {
    await KittenTTS2Tiny.predownload({ model: 'kitten-tts-2-nano' }, (progress, info) => {
      if (info?.stage === 'downloading') {
        setStatus(`Downloading model ${Math.round(progress * 100)}%`);
      }
    });
    setStatus('Voice model is ready.');
  } catch (error) {
    setStatus(readableError(error));
  } finally {
    setBusy(false);
  }
}
```

## With Kitten TTS 0.8

The same screen works with the older English models: pass
`model: KittenModel.NanoInt8` to `create()`, and call
`tts.speak(text, KittenVoice.Bella)` (0.8 takes a `KittenVoice`, not a name). The 0.8 models also have cache helpers that Kitten TTS 2
does not: `KittenTTS.getModelCacheInfo()` checks the cache without downloading,
and `KittenTTS.redownloadModel()` deletes and downloads the model again:

```tsx
const cache = await KittenTTS.getModelCacheInfo({ model: KittenModel.NanoInt8 });
setStatus(cache.isCached ? 'Voice model is ready.' : 'Voice model needs to download.');

await KittenTTS.redownloadModel({ model: KittenModel.NanoInt8 }, (progress) => {
  setStatus(`Redownloading model ${Math.round(progress * 100)}%`);
});
```

## Build An APK

From your app folder:

```powershell
cd android
.\gradlew.bat assembleDebug
```

The debug APK is usually here:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

Install it manually with:

```powershell
adb install -r app\build\outputs\apk\debug\app-debug.apk
```

## Common Windows Issues

| Problem | What to do |
| --- | --- |
| `adb` is not recognized | Add Platform Tools to `Path`, then open a new PowerShell |
| CMake object path warning | Move the project to `C:\ktts\YourApp` |
| Expo Go opens | Use `npx expo run:android`, not Expo Go |
| Gradle cannot find SDK | Check `ANDROID_HOME` and `ANDROID_SDK_ROOT` |
| First generation is slow | Expected only on the first model download |
| Download fails | Keep internet on, then tap `Speak` again |

## Where To Go Next

- Read [EPUB reader on Windows](../epub-reader/windows.md) for streaming long text.
- Open the SDK examples in `examples/` for complete UI implementations.
