# Simple Text-To-Speech On Windows

This tutorial creates a small Android app that speaks text with KittenTTS. It is
written for beginners and assumes you are building Android from Windows.

iOS builds require macOS, so this guide focuses on Android.

## What You Will Build

You will create:

- A React Native Android app
- A text box
- A `Speak` button
- A download progress message
- A debug APK you can install on a device

KittenTTS runs on the device. It does not need a server or cloud TTS key.

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
      const tts = await KittenTTS.create({ player }, (progress, info) => {
        if (info?.stage === 'cached') {
          setStatus('Model is already downloaded.');
          return;
        }

        if (info?.stage === 'downloading') {
          setStatus(`Downloading model ${Math.round(progress * 100)}%`);
        }
      });

      setStatus('Speaking...');
      await tts.speak(text);
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

## Add A Retry Button

If Wi-Fi drops during the first download, use `redownloadModel()`:

```tsx
async function retryModelDownload() {
  setBusy(true);

  try {
    await KittenTTS.redownloadModel(undefined, (progress) => {
      setStatus(`Redownloading model ${Math.round(progress * 100)}%`);
    });
    setStatus('Model downloaded. Tap Speak again.');
  } catch (error) {
    setStatus(readableError(error));
  } finally {
    setBusy(false);
  }
}
```

Add a second button:

```tsx
<Button title="Retry model download" onPress={retryModelDownload} disabled={busy} />
```

## Check Whether The Model Is Already Downloaded

Use this before showing a download screen:

```tsx
const cache = await KittenTTS.getModelCacheInfo();

if (cache.isCached) {
  setStatus('Voice model is ready.');
} else {
  setStatus('Voice model needs to download.');
}
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

## Testing A Local SDK Tarball

If the SDK is not published yet, create a local package from the SDK repo:

```powershell
npm install
npm pack
```

Then install the generated `.tgz` in your app:

```powershell
npm install C:\path\to\kittentts-react-native-0.8.0.tgz
```

Run `npm pack` again after SDK changes.

## Common Windows Issues

| Problem | What to do |
| --- | --- |
| `adb` is not recognized | Add Platform Tools to `Path`, then open a new PowerShell |
| CMake object path warning | Move the project to `C:\ktts\YourApp` |
| Expo Go opens | Use `npx expo run:android`, not Expo Go |
| Gradle cannot find SDK | Check `ANDROID_HOME` and `ANDROID_SDK_ROOT` |
| First generation is slow | Expected only on the first model download |
| Download fails | Keep internet on, then call `KittenTTS.redownloadModel()` |

## Where To Go Next

- Read [EPUB reader on Windows](../epub-reader/windows.md) for streaming long text.
- Open the SDK examples in `examples/` for complete UI implementations.
