# Playback

KittenTTS separates generation from playback. That keeps the SDK usable in apps
that want to save WAV data, stream chunks, use a custom player, or sync UI state
with the audio.

## Generate Without Playing

```tsx
const result = await tts.generate('Save this as audio.');

const wavBytes = result.wavData();
const wavBase64 = result.wavBase64();
```

Use this when your app uploads audio, stores files, or has its own playback
stack.

## Use `speak()`

Pass a player to `KittenTTS.create()`, then call `speak()`:

```tsx
await tts.speak('Read this sentence.', KittenVoice.Bella, 1.0);
```

The optional third argument is speed. Valid values are `0.5` to `2.0`.

## Expo Audio

```tsx
import * as ExpoAudio from 'expo-audio';
import { KittenTTS, createExpoAudioPlayer } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  player: createExpoAudioPlayer(ExpoAudio),
});

await tts.speak('This plays through expo-audio.');
```

## React Native Sound

```tsx
import Sound from 'react-native-sound';
import { KittenTTS, createRNSoundPlayer } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  player: createRNSoundPlayer(Sound),
});

await tts.speak('This plays through react-native-sound.');
```

## Browser Audio

React Native Web builds can use the browser audio helper:

```tsx
import {
  KittenTTS,
  createBrowserAudioPlayer,
} from '@kittentts/react-native';

const tts = await KittenTTS.create({
  player: createBrowserAudioPlayer(),
});

await tts.speak('This plays through an HTML audio element.');
```

## Generate First, Then Play

This is useful when the UI needs metadata from the generated result before
audio starts.

```tsx
const result = await tts.generate('Highlight this sentence.');

await tts.play(result, {
  onPlaybackStart: () => {
    startHighlighting(result.wordTimings);
  },
});
```

`onPlaybackStart` should fire when audio is actually playing, not when the file
only starts loading. That detail matters for word highlighting.

## Custom Player

Implement `AudioPlayer` if your app already has an audio layer:

```tsx
import type { AudioPlayer } from '@kittentts/react-native';

const player: AudioPlayer = {
  async playFile(filePath, onPlaybackStart) {
    // Play the WAV file at filePath.
    onPlaybackStart?.();
  },
  async stop() {
    // Stop active playback.
  },
};
```

Then pass it to the SDK:

```tsx
const tts = await KittenTTS.create({ player });
```
