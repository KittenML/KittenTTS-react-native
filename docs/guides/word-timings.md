# Word Timings

`generate()` returns `wordTimings`, which you can use for read-aloud UI,
karaoke-style highlighting, or reader apps.

```tsx
const result = await tts.generate(
  'KittenTTS can return word-level timestamps.',
);

console.log(result.wordTimings);
```

Each timing includes the word, its index in the generated chunk, and start/end
times in seconds.

## Highlight While Playing

Generate first, then start your UI timer from `onPlaybackStart`:

```tsx
const result = await tts.generate(text);
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
- Use `generateStreaming()` for long text.
- Treat `wordIndex` as local to the generated chunk.

The complete UI example is
[`examples/ExpoWordTimingsExample`](../../examples/ExpoWordTimingsExample).

## Long Text

For chapters, articles, and reader apps, do not generate the whole document in
one call. Stream sentence-sized chunks and update the UI for the chunk that is
currently playing:

```tsx
for await (const chunk of tts.generateStreaming(chapterText)) {
  queue.push(chunk);
  // Start playback when the first chunk is ready.
}
```

For a longer walkthrough, see the reader tutorials:

- [macOS](../tutorials/epub-reader/mac.md)
- [Windows](../tutorials/epub-reader/windows.md)
