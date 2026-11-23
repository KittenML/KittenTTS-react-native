# Kitten TTS 2 Nano, Pico and Mini

Small multilingual Kitten TTS 2 models that run on the phone's CPU with ONNX
Runtime, and the SDK's main on-device engine. They are the same models, voices
and text processing as the Python package's
`KittenTTS("KittenML/kitten-tts-2-nano")`, and the SDK gives the same phonemes
for the same text.

| Model | Parameters | int8 per model | int4 per model | Languages |
| --- | --- | --- | --- | --- |
| `kitten-tts-2-mini` | 82M | 83 MB | 47 MB | 16: en de es it pt ru hi fr da fi ja ko nl sv sw tr |
| `kitten-tts-2-nano` | 17M | 17 MB per language | 8.8 MB per language | 8: en de es it pt ru hi fr |
| `kitten-tts-2-pico` | 7.2M | 8 MB per language | 4 MB per language | 8: en de es it pt ru hi fr |

They need Hermes from React Native 0.75 (Unicode regular expressions and BigInt);
`create()` says so on older engines. Tested on React Native 0.83 and 0.88 (Expo
SDK 55 and 58), iOS and Android, and in the browser through React Native Web.

## Usage

```tsx
import '@kittentts/espeak-ng';    // only for de, fr, es, ...: see below
import { KittenTTS } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  model: 'kitten-tts-2-nano',     // or 'kitten-tts-2-pico', 'kitten-tts-2-mini'
  weights: 'int8',                 // or 'int4': about half the size
  languages: ['en', 'de'],         // downloaded now; others on first use
});

tts.languages;                     // ['en', 'de', 'es', ...]
tts.availableVoices;               // { en: ['Eleanor', ...], de: ['Anna', ...] }
tts.voices('de');                  // [{ key, name, description, language }, ...]
tts.onnxWeights;                   // ['int8', 'int4']

const result = await tts.generate('Hello there.');                    // English, first voice
await tts.generate('Guten Morgen.', { language: 'de' });              // German, first voice
await tts.generate('Guten Morgen.', { voice: 'Paul' });               // a German voice: German
await tts.generate('Hello there.', { voice: 'eleanor', speed: 1.1 }); // names in any case
await tts.generate('Hello there.', 'Eleanor', 1.1);                   // the same, positional

for await (const chunk of tts.generateStreaming(longText, { language: 'fr' })) {
  // each chunk as soon as it is ready
}

await tts.generateToFile('Hello there.', `${dir}/hello.wav`);         // 16-bit WAV
await tts.phonemize('Hello there.');   // the phoneme chunks the model will say
await tts.speak('Hello!');             // with a player passed to create()
await tts.dispose();
```

`KittenTTS2Tiny.predownload(options, onProgress)` downloads a model's files for
`options.languages` without loading it.

To ship a model inside the app instead, so it works offline from the first
launch, bundle it with `npx @kittentts/react-native bundle-assets --models
kitten-tts-2-nano --languages en,de` and load it with `createBundledTinyOptions()`:
see [Bundled Offline Assets](offline-assets.md#kitten-tts-2-nano-pico-and-mini).

`generate()` returns a `KittenTTSResult` (24 kHz float samples, `wavData()`,
`duration`); `result.voice` is the voice's name. Long text is cut at sentence
ends into chunks of at most 350 phonemes, joined with 0.15 s of silence, as in
Python. `result.wordTimings` gives each input word's start and end: exact per
phoneme word from the model's durations, shared out over the text's words (a
number or date that expands to several spoken words gets all of their time).
Text is split into words at spaces, so Japanese text without spaces is one word.
Streaming chunks carry no word timings.

| `generate` option | Default | |
| --- | --- | --- |
| `voice` | the language's first voice | a name from `availableVoices` in any case, or a voice's description |
| `language` | the voice's language, else the model's default (`en`) | a code from `languages` |
| `speed` | `1` | larger is faster |

| `create` option | Python | |
| --- | --- | --- |
| `model` | `model_name` | `'kitten-tts-2-nano'`, `'kitten-tts-2-pico'`, `'kitten-tts-2-mini'` or the `KittenML/...` repository |
| `weights` | `weights` | `'int8'` (default) or `'int4'` |
| `languages` | | languages to download and load in `create()`; the rest on first use |
| `modelDirectory` | `model_name` as a folder | a local folder laid out like the repository, instead of downloading |
| `textDataDirectory` | | a local copy of the text data folder, instead of downloading |
| `storageDirectory` | `cache_dir` | cache folder (default `<DocumentDirectory>/KittenTTS`) |
| `hfToken` | `hf_token` | sent with Hugging Face downloads |
| `modelBaseURL`, `textDataURL` | | other hosts for the model files and the text data |
| `ortNumThreads` | `threads` | ONNX Runtime threads for the speech model |
| `downloadRetries`, `player` | | attempts per file; the player for `speak()` |

The Python package's `backend="torch"` and `device` have no counterpart: the SDK
always runs the ONNX graphs on the CPU.

## Languages that need espeak-ng

English goes through misaki, and Japanese (Mini) through misaki's cutlet G2P,
both in this package. The other languages go through espeak-ng, as in the
Python package:

| Models | Languages |
| --- | --- |
| Nano, Pico and Mini | `de` `fr` `es` `it` `pt` `ru` `hi` |
| Mini only | `da` `fi` `nl` `sv` `sw` `tr` `ko` |

espeak-ng is GPL-3.0-or-later, so it is not in this package. It comes in
`@kittentts/espeak-ng`, which an app installs and imports once:

```bash
npm install @kittentts/espeak-ng
```

```tsx
import '@kittentts/espeak-ng';   // for example in the app's entry file
```

The import registers espeak-ng with the SDK; nothing else changes. It works on
iOS, Android and the web. Without it, those languages fail with a
`KittenTTSError` whose code is `MISSING_DEPENDENCY` and whose message names the
package: in `create()` for the languages in `languages`, before anything
downloads, or on first use for any other language. English and Japanese never
need it.

This is the split the Python package has: kittenml (Apache-2.0) gets espeak-ng
from the separate `espeakng_loader` and `phonemizer` packages.

## What gets downloaded

Files are cached under `<DocumentDirectory>/KittenTTS/` (or `storageDirectory`)
and fetched only for the languages used:

- From the model's Hugging Face repository (or `modelBaseURL`): `config.json`,
  `vocab.json`, the language's ONNX graph and its voices file, and for English the
  small G2P model in `g2p/` (3 MB).
- From the text data (`textDataURL`): for English, misaki's lexicons, CMUdict and
  spaCy's tokenizer and tagger (5.5 MB to download, 12.9 MB unpacked); for
  Japanese (Mini), UniDic rebuilt for the SDK's MeCab and cutlet's tables (12.1 MB
  to download, 65 MB unpacked, about 67 MB of memory once loaded); for every other
  language, espeak-ng's data for it (about 0.5 MB; Russian 5.2 MB because of its
  dictionary).

Big files are hosted gzipped and unpacked once after the download, so later loads
read plain files.

## Text data

The English lexicons, the spaCy tagger, espeak-ng's data and the Japanese
dictionary are not in the model repositories (Python gets them from pip
packages), so the SDK downloads them from `textDataURL`, by default
[huggingface.co/dewan-sl/kitten-tts-2-text](https://huggingface.co/dewan-sl/kitten-tts-2-text)
(`DEFAULT_TEXT_DATA_URL`). The folder holds `en/`, `espeak-ng-data/`, `ja/`, a
`manifest.json` (every file with its size and sha256, and which are gzipped) and
a README with the sources and licences.

To host it elsewhere, build it with `tools/kitten-tts-2-tiny/build_text_pack.py`
([Development](../development.md#kitten-tts-2-nano-pico-and-mini-data)) and point
`textDataURL` at it, or copy it into the app and use `textDataDirectory`.

## How it matches Python

- **English:** `tts_norm` text normalisation, misaki's lexicon (with spaCy
  `en_core_web_sm`'s part-of-speech tags), then CMUdict and a small BART model
  for unknown words. All are ported to TypeScript, and the tagger's network runs
  in ONNX Runtime with float16 weights. The committed English fixture is a sample
  of 37 sentences. Bigger runs, with fixtures written by
  `english_fixtures.py TEXTS.json` and read through
  `KITTEN_TTS_2_TINY_ENGLISH_FIXTURE`, gave Python's output at every stage on 3,078
  Wikipedia sentences, and the BART matched PyTorch on 8,846 words.
- **Japanese (Mini):** misaki's cutlet G2P with MeCab and unidic-lite, as the
  Python package runs it (`pip install "kittenml[ja]"`). MeCab's lattice and
  Viterbi search are ported to TypeScript over the same dictionary, trimmed to the
  costs, connection ids and readings that decide the output (65 MB instead of
  unidic-lite's 248 MB). It matches Python on 2,439 texts (2,000 Wikipedia
  sentences, paragraphs and hard cases), token by token against fugashi.
- **Other languages:** espeak-ng 1.52.0 (the version the Python package loads),
  compiled to plain JavaScript in `@kittentts/espeak-ng` together with
  phonemizer's espeak backend; misaki's and kittenml's steps around it are in
  this package. It matches Python on 1,471 texts in 14 languages (2,214 checks
  over the two phonemizer versions).
- **Speech:** the same tokens, voice style row and post-processing (trimming,
  fades, gaps) as Python. The graphs add random noise in the vocoder, so two runs
  never give identical samples, in Python either. Rarely, a duration that sits on
  x.5 before rounding comes out one frame (25 ms) different, because another
  ONNX Runtime build rounds it the other way.
- **On devices:** the test texts in 9 languages gave exactly Python's phonemes
  on 16 real phones (5 iPhones and 11 Android phones, from a 2017 Galaxy Tab S3
  to a Galaxy S25; Japanese on the 13 of the last two runs), in the iOS simulator
  and in the Android emulator, on React Native 0.83 and 0.88. Whisper heard the
  right words in every clip.

The tests in `tests/kitten-tts-2-tiny-*.test.js` check all of this against
fixtures written by the Python package (`tools/kitten-tts-2-tiny/*_fixtures.py`);
[Development](../development.md#run-all-the-kitten-tts-2-tests) says how to run
them.

## Speed

"Real-time factor" (RTF) is seconds of work per second of audio: below 1 is
faster than real time. Release builds with Hermes, median over 24 texts in 9
languages.

Real phones on TestMu (React Native 0.83, files downloaded on the device; the
phone that answered is listed, TestMu sometimes swaps them):

| Phone | Nano int8 | Pico int4 | Mini int8 | First audio of a long text, Nano / Pico / Mini |
| --- | --- | --- | --- | --- |
| iPhone 16 Pro (A18 Pro, iOS 18.6) | 0.064 | 0.040 | 0.41 | 1.05 / 0.64 / 6.9 s |
| iPhone 15 Pro (A17 Pro, iOS 17.6) | 0.080 | 0.047 | 0.44 | 1.35 / 0.79 / 7.2 s |
| iPhone 15 (A16, iOS 17.6) | 0.091 | 0.055 | 0.50 | 1.45 / 0.90 / 8.5 s |
| iPhone 13 (A15, iOS 15.1 and 15.2), two runs | 0.100–0.102 | 0.053–0.061 | 0.58–0.61 | 1.7–1.8 / 0.96–1.0 / 9.8–10.2 s |
| iPhone 12 mini (A14, iOS 17.6) | 0.119 | 0.070 | 0.79 | 2.1 / 1.2 / 15.9 s |
| Galaxy S25 (Snapdragon 8 Elite, Android 15) | 0.077 | 0.038 | 0.54 | 1.26 / 0.72 / 6.8 s |
| Galaxy S24 Ultra (Snapdragon 8 Gen 3), two runs | 0.084–0.087 | 0.054–0.056 | 0.44–0.47 | 1.35–1.5 / 0.75–0.85 / 7.7–8.0 s |
| Galaxy S24 (Exynos 2400), two runs | 0.094–0.097 | 0.054–0.060 | 0.43–0.53 | 1.4–1.5 / 0.75–0.93 / 7.2–11.3 s |
| Galaxy S23 (Snapdragon 8 Gen 2) | 0.105 | 0.059 | 0.56 | 1.8 / 1.06 / 9.4 s |
| Galaxy S22 Ultra | 0.112 | 0.077 | 0.66 | 2.0 / 1.3 / 10.5 s |
| Pixel 8 (Tensor G3) | 0.142 | 0.092 | 0.72 | 2.3 / 1.3 / 20.2 s |
| Pixel 6 (Tensor G1), two runs | 0.154 | 0.098–0.10 | 0.71–0.74 | 2.3–2.4 / 1.3–1.5 / 12.4–12.5 s |
| Galaxy S20 5G (Snapdragon 865, Android 10) | 0.150 | 0.088 | 0.70 | 2.8 / 1.4 / 11.5 s |
| Huawei P50 Pro (JAD-AL80) | 0.157 | 0.095 | 0.81 | 2.4 / 1.9 / 12.9 s |
| OPPO A96 (Snapdragon 680, budget, Android 11) | 0.457 | 0.258 | 2.18 | 6.8 / 4.3 / 32 s |
| Galaxy Tab S3 (Snapdragon 820, 2017, 4 GB, Android 9) | 0.889 | 0.379 | 4.26 | 15.5 / 6.4 / 62 s |

"First audio" is the first chunk of a long text (about 18 s of speech): the
chunks are long, so streaming starts after one chunk's work. On phones from 2020
on, the first Japanese sentence of a fresh install took 11–20 s (downloading 12 MB
of dictionary, unpacking and loading it), and 43–56 s on the OPPO A96 and the
Galaxy Tab S3; later sentences run at Mini's speed.

On budget and older Android phones Mini is slower than real time (RTF 2–4), so
use Nano or Pico there: Pico stays well under real time even on the 2017 Galaxy
Tab S3, and Nano just under it.

On a Mac (M5 Pro) in the iOS simulator (iPhone 18 Pro, iOS 27.2) and the Android
emulator (arm64, Android 17), React Native 0.88:

| | iOS simulator | Android emulator |
| --- | --- | --- |
| Nano int8 | 0.026–0.041 | 0.051–0.065 |
| Pico int4 | 0.018–0.024 | 0.026–0.029 |
| Mini int8 | 0.12–0.15 | 0.29–0.34 |
| `create()` with English, files cached | 0.36–0.48 s | 0.32–0.65 s |
| `create()` with English, first run (downloads) | 2.3–9.1 s | 1.6–10.6 s |
| First sentence in another language, files cached | 0.2–0.43 s | 0.14–0.39 s |
| First Japanese sentence (Mini): cached / first run | 3.2 s / 9.8 s | 2.7 s / 9.1 s |

Turning a sentence into phonemes takes 1–10 ms on these devices, or about 100 ms
when an unknown English word goes through the small G2P model. Japanese's first
sentence mostly reads its 65 MB dictionary (react-native-fs hands files to
JavaScript as base64); later sentences take about 1 ms.

## Memory

A loaded Nano with English takes about 160 MB; Mini with Japanese adds its 83 MB
model and the 67 MB dictionary. A memory test (create, speak and dispose 8 times
with Nano and 4 times with Mini and Japanese, then 60 `generate()` calls and long
streams on one instance) found no leak on 8 real phones, in the iOS simulator and
in the Android emulator:

- The JavaScript heap stays at 36–44 MB, and the app's memory goes up and down
  with use without growing, also over 40 long streams and 200 `generate()` calls
  in a row.
- After `dispose()`, iPhones and Android 12 and newer give the memory back to the
  system. Android 9–11 keep the freed native memory in the app, where the next
  model reuses it.
- Every model, Japanese included, ran on 4 GB devices (iPhone 12 mini, iPhone 13,
  Galaxy Tab S3) without the system stopping the app.

## Licence

This package is Apache-2.0 and contains no GPL code: the ported text processing
(kittenml, misaki, spaCy, cutlet, MeCab) is under permissive licences.

`@kittentts/espeak-ng` is GPL-3.0-or-later. An app that includes it distributes
GPL-3.0 code; an app that speaks only English or Japanese can leave it out and
ships none.

The text data downloaded at run time has its own licences: espeak-ng's data
(GPL-3.0-or-later) is downloaded only for the espeak languages, and UniDic
(Japanese) is BSD-3-Clause / LGPL-2.1 / GPL-2.0. The text data's README lists
everything it holds. See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
