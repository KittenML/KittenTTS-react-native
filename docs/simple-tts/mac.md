# Simple Text-To-Speech On macOS

This tutorial takes you from an empty app to a working on-device TTS screen.
It is written for someone who has used React Native only a little, or not at
all.

KittenTTS runs the model on the phone or simulator. It does not call a cloud
TTS API and it does not need an API key.

## What You Will Build

By the end you will have:

- A React Native app with a text box
- A `Speak` button
- On-device speech generation
- A model download progress message
- A retry path if the model download is interrupted

## Choose Your App Type

KittenTTS works in two common React Native setups:

| App type | Use this when | Audio package |
| --- | --- | --- |
| Expo development build | You use Expo, but can build native code | `expo-audio` |
| Bare React Native | You use the React Native CLI directly | `react-native-sound` |

Expo Go will not work. Expo Go cannot load the native ONNX Runtime module that
KittenTTS needs. You must use an Expo development build.

## Install macOS Tools

Install these once on your Mac:

| Tool | Why it matters |
| --- | --- |
| Node.js 20 or newer | Runs npm and Metro |
| Xcode | Builds iOS apps and simulators |
| CocoaPods | Installs iOS native dependencies |
| Android Studio | Builds Android apps and emulators |

Check your terminal:

```bash
node -v
npm -v
xcodebuild -version
pod --version
```

Expected result:

- `node -v` should print `v20...` or newer.
- `xcodebuild -version` should print an Xcode version.
- `pod --version` should print a CocoaPods version.

If `pod` is missing:

```bash
sudo gem install cocoapods
```

You do not need Emscripten when installing the published npm package. Emscripten
is only needed when building this SDK repository from source.

## Option A: Create An Expo App

Use this path if you want the easiest project structure and you are okay using a
development build.

```bash
npx create-expo-app SimpleKittenTTS
cd SimpleKittenTTS
npm install @kittentts/react-native
npx expo install expo-audio expo-dev-client
npx expo prebuild
```

What these commands do:

| Command | Meaning |
| --- | --- |
| `create-expo-app` | Creates a new Expo project |
| `npm install @kittentts/react-native` | Adds the KittenTTS SDK |
| `expo install expo-audio expo-dev-client` | Adds Expo audio playback and dev-build support |
| `expo prebuild` | Creates the native `ios/` and `android/` folders |

Run iOS:

```bash
npx expo run:ios
```

Run Android:

```bash
npx expo run:android
```

If this opens Expo Go, stop it and run `npx expo run:ios` or
`npx expo run:android` again. You need the development build.

## Option B: Create A Bare React Native App

Use this path if you want a normal React Native CLI app.

```bash
npx @react-native-community/cli init SimpleKittenTTS
cd SimpleKittenTTS
npm install @kittentts/react-native react-native-sound
cd ios && pod install && cd ..
```

Run iOS:

```bash
npm run ios
```

Run Android:

```bash
npm run android
```

## Add A Working TTS Screen

Open `App.tsx` and replace it with the version for your app type.

### Expo `App.tsx`

Use this for the Expo development build.

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
  const [text, setText] = useState('Hello from KittenTTS. This speech is generated on device.');
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

The bare app is almost the same. Change the audio imports and player:

```tsx
import Sound from 'react-native-sound';
import {
  KittenTTS,
  createRNSoundPlayer,
  isKittenTTSError,
} from '@kittentts/react-native';

const player = useMemo(() => createRNSoundPlayer(Sound), []);
```

Everything else can stay the same as the Expo example.

## Test The App

Start with a short sentence. The first run needs internet because model assets
must download once.

Expected first run:

1. The app says it is preparing the model.
2. The app shows download progress.
3. The phone or simulator speaks the text.
4. The next run skips the download and uses the local cache.

## Add A Retry Button

If the user loses internet in the middle of a download, let them retry cleanly:

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

Add another button:

```tsx
<Button title="Retry model download" onPress={retryModelDownload} disabled={busy} />
```

## Check Whether The Model Is Already Downloaded

Use this if you want to show a setup screen before the user taps `Speak`:

```tsx
const cache = await KittenTTS.getModelCacheInfo();

if (cache.isCached) {
  setStatus('Voice model is ready.');
} else {
  setStatus('Voice model needs to download.');
}
```

## Build A Debug APK On macOS

For Android testing:

```bash
cd android
./gradlew assembleDebug
```

The APK will usually be here:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Testing A Local SDK Tarball

If you are testing this SDK before it is published to npm, build a local package
from the SDK repository:

```bash
npm install
npm pack
```

Then install the generated `.tgz` in your app:

```bash
npm install ../path/to/kittentts-react-native-0.8.0.tgz
```

Run `npm pack` again after SDK changes so the app receives the latest code.

## Common macOS Issues

| Problem | What to do |
| --- | --- |
| Expo Go opens | Use `npx expo run:ios` or `npx expo run:android` |
| iOS build cannot find pods | Run `cd ios && pod install && cd ..` |
| Android cannot find SDK | Open Android Studio and install Platform Tools |
| No sound on simulator | Check simulator volume and try a physical device |
| First generation is slow | Expected only on first model download |
| Download fails | Check internet, then call `KittenTTS.redownloadModel()` |

## Where To Go Next

- Read [EPUB reader on macOS](../epub-reader/mac.md) for streaming long text.
- Open the SDK examples in `examples/` for complete UI implementations.
