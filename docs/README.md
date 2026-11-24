# KittenTTS React Native Docs

These docs are split by job. If you just want to make the SDK speak, start with
getting started. If you are building a real app, read the guide that matches the
feature you need.

Kitten TTS 2 is the current model family: Nano, Pico and Mini on the device, and
Kitten TTS 2 Cloud on the Kitten API. Kitten TTS 0.8, the older English models,
is still supported.

## Start Here

- [Getting started](getting-started.md) - install the SDK and generate speech with Kitten TTS 2 Nano.
- [Troubleshooting](troubleshooting.md) - common native-module and download issues.
- [Examples](../examples) - runnable apps for Expo and bare React Native, with every engine: Kitten TTS 2 on the device and in the cloud, and 0.8.

## Guides

- [Kitten TTS 2 Nano, Pico and Mini](guides/kitten-tts-2-tiny.md) - the small multilingual models on the device, and the optional `@kittentts/espeak-ng` package.
- [Kitten TTS 2 Cloud](guides/kitten-api.md) - the largest model through the Kitten API, voice cloning, presets, and Nano, Pico and Mini in the cloud.
- [Playback](guides/playback.md) - Expo Audio, React Native Sound, and custom players.
- [Word timings](guides/word-timings.md) - highlight words while audio plays.
- [Bundled offline assets](guides/offline-assets.md) - ship models inside the app.

## Reference

- [API reference](reference/api.md)
- [Models and voices](reference/models.md)

## Tutorials

Longer walkthroughs live in [tutorials](tutorials/README.md):

- [Simple TTS app on macOS](tutorials/simple-tts/mac.md)
- [Simple TTS app on Windows](tutorials/simple-tts/windows.md)
- [Reader app on macOS](tutorials/epub-reader/mac.md)
- [Reader app on Windows](tutorials/epub-reader/windows.md)

## Maintainers

- [Development notes](development.md)
