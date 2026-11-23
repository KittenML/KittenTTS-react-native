# Playback

KittenTTS separates generation from playback. That keeps the SDK usable in apps
that want to save WAV data, stream chunks, use a custom player, or sync UI state
with the audio.

The examples use Kitten TTS 2 Nano. The players and `speak()`, `play()` and
`stopSpeaking()` work the same with Kitten TTS 2 Cloud and the 0.8 models.

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
await tts.speak('Read this sentence.', 'Eleanor', 1.0);
await tts.speak('Read this sentence.', { voice: 'Eleanor', speed: 1.0 });
```

The optional third argument is speed; larger is faster. Kitten TTS 2 Nano, Pico
and Mini take any positive speed, Kitten TTS 2 Cloud `0.25` to `4.0`, and the
0.8 models `0.5` to `2.0` (with a `KittenVoice`, such as
`tts.speak(text, KittenVoice.Bella, 1.0)`).

## Expo Audio

```tsx
import * as ExpoAudio from 'expo-audio';
import { KittenTTS, createExpoAudioPlayer } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  model: 'kitten-tts-2-nano',
  player: createExpoAudioPlayer(ExpoAudio),
});

await tts.speak('This plays through expo-audio.');
```

## React Native Sound

```tsx
import Sound from 'react-native-sound';
import { KittenTTS, createRNSoundPlayer } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  model: 'kitten-tts-2-nano',
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
  model: 'kitten-tts-2-nano',
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

## Stop

`tts.stopSpeaking()` stops the current playback; the `speak()` or `play()` call
that was waiting returns.

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
const tts = await KittenTTS.create({ model: 'kitten-tts-2-nano', player });
```
