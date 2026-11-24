# Word Timings

`generate()` returns `wordTimings`, which you can use for read-aloud UI,
karaoke-style highlighting, or reader apps. Every on-device model returns them:
Kitten TTS 2 Nano, Pico and Mini, and the 0.8 models. Kitten TTS 2 Cloud does
not (its `wordTimings` is empty).

```tsx
const tts = await KittenTTS.create({ model: 'kitten-tts-2-nano', player });

const result = await tts.generate(
  'KittenTTS can return word-level timestamps.',
  { voice: 'Eleanor' },
);

console.log(result.wordTimings);
```

Each timing includes the word, its index in the generated text (`wordIndex`,
zero-based, counting words split at spaces), and start/end times in seconds.

With Kitten TTS 2 Nano, Pico and Mini, the times come from the model's
durations for each spoken word, shared out over the words of the text: a number
or date that expands to several spoken words gets all of their time. Text
without spaces, such as Japanese, counts as one word.

## Highlight While Playing

Generate first, then start your UI timer from `onPlaybackStart`:

```tsx
const result = await tts.generate(text, { voice: 'Eleanor' });
setResult(result);

let timer: ReturnType<typeof setInterval> | null = null;

await tts.play(result, {
  onPlaybackStart: () => {
    const startedAt = Date.now();
    timer = setInterval(() => {
      const seconds = (Date.now() - startedAt) / 1000;
      const active = result.wordTimings.find(
        word => seconds >= word.startTime && seconds < word.endTime,
      );
      setActiveWordIndex(active?.wordIndex ?? null);
    }, 50);
  },
});

if (timer) clearInterval(timer);
setActiveWordIndex(null);
```

## Keep Chunks Short

Timings are model-predicted. They are good for UI highlighting, but they are
not a substitute for forced alignment.

For best results:

- Generate a sentence or short paragraph at a time.
- Treat `wordIndex` as local to the text of one `generate()` call.

The complete UI example is
[`examples/ExpoWordTimingsExample`](../../examples/ExpoWordTimingsExample), with
Kitten TTS 2 and 0.8.

## Long Text

For chapters, articles, and reader apps, do not generate the whole document in
one call. Split it into sentences or paragraphs, generate each with
`generate()`, and highlight the one that is playing:

```tsx
for (const paragraph of paragraphs) {
  const result = await tts.generate(paragraph, { voice: 'Eleanor' });
  await tts.play(result, {
    onPlaybackStart: () => startHighlighting(result.wordTimings),
  });
}
```

`generateStreaming()` starts playback sooner, but with Kitten TTS 2 Nano, Pico
and Mini its chunks carry no word timings. The 0.8 models' streamed chunks are
one sentence each and do carry them.

For a longer walkthrough, see the reader tutorials:

- [macOS](../tutorials/epub-reader/mac.md)
- [Windows](../tutorials/epub-reader/windows.md)
