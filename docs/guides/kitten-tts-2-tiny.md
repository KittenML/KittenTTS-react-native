# Kitten TTS 2 Nano, Pico and Mini

Small multilingual Kitten TTS 2 models that run on the phone's CPU with ONNX
Runtime. They are the same models, voices and text processing as the Python
package's `KittenTTS("KittenML/kitten-tts-2-nano")`, and the SDK gives the same
phonemes for the same text.

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

`generate()` returns a `KittenTTSResult` (24 kHz float samples, `wavData()`,
`duration`); `result.voice` is the voice's name. Long text is cut at sentence
ends into chunks of at most 350 phonemes, joined with 0.15 s of silence, as in
Python. `result.wordTimings` gives each input word's start and end: exact per
phoneme word from the model's durations, shared out over the text's words (a
number or date that expands to several spoken words gets all of their time).
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

The English lexicons, the spaCy tagger and espeak-ng's data are not in the model
repositories (Python gets them from pip packages), so the SDK downloads them from
`textDataURL`, by default
[huggingface.co/dewan-sl/kitten-tts-2-text](https://huggingface.co/dewan-sl/kitten-tts-2-text)
(`DEFAULT_TEXT_DATA_URL`). To host it elsewhere, build the folder with the
Python environment that has `kittenml` and upload it as is:

```bash
python -I tools/kitten-tts-2-tiny/build_text_pack.py out/kitten-tts-2-text
```

It writes `en/`, `espeak-ng-data/`, a `manifest.json` (every file with its size
and sha256, and which are gzipped) and a README with the sources and licences.
Point `textDataURL` at it, or copy it into the app and use `textDataDirectory`.

## How it matches Python

- **English:** `tts_norm` text normalisation, misaki's lexicon (with spaCy
  `en_core_web_sm`'s part-of-speech tags), then CMUdict and a small BART model
  for unknown words. All are ported to TypeScript, and the tagger's network runs
  in ONNX Runtime with float16 weights. Every stage gives Python's output on 3,078
  Wikipedia sentences, and the BART matches PyTorch on 8,846 words.
- **Japanese (Mini):** misaki's cutlet G2P with MeCab and unidic-lite, as the
  Python package runs it (`pip install "kittenml[ja]"`). MeCab's lattice and
  Viterbi search are ported to TypeScript over the same dictionary, trimmed to the
  costs, connection ids and readings that decide the output (65 MB instead of
  unidic-lite's 248 MB). It matches Python on 2,439 texts (2,000 Wikipedia
  sentences, paragraphs and hard cases), token by token against fugashi.
- **Other languages:** espeak-ng 1.52.0 (the version the Python package loads),
  compiled to plain JavaScript, with phonemizer's and misaki's post-processing
  ported. It matches Python on 2,214 sentences in 14 languages.
- **Speech:** the same tokens, voice style row and post-processing (trimming,
  fades, gaps) as Python. The graphs add random noise in the vocoder, so two runs
  never give identical samples, in Python either. Rarely, a duration that sits on
  x.5 before rounding comes out one frame (25 ms) different, because another
  ONNX Runtime build rounds it the other way.
- **On devices:** the same 22 sentences in 8 languages gave exactly Python's
  phonemes in the iOS simulator and Android emulator on React Native 0.83 and
  0.88, and Whisper heard the right words in every clip.

The tests in `tests/kitten-tts-2-tiny-*.test.js` check all of this against
fixtures written by the Python package (`tools/kitten-tts-2-tiny/*_fixtures.py`).

## Speed

"Real-time factor" (RTF) is seconds of work per second of audio: below 1 is
faster than real time. Release builds with Hermes, median over 22 sentences in 8
languages.

Real phones on TestMu (React Native 0.83, files downloaded on the device; the
phone that answered is listed, TestMu sometimes swaps them):

| Phone | Nano int8 | Pico int4 | Mini int8 | First audio of a long text, Nano / Pico / Mini |
| --- | --- | --- | --- | --- |
| Galaxy S24 Ultra (Snapdragon 8 Gen 3) | 0.084 | 0.054 | 0.44 | 1.35 / 0.75 / 7.7 s |
| Galaxy S24 (Exynos 2400), two runs | 0.094–0.097 | 0.054–0.060 | 0.43–0.53 | 1.4–1.5 / 0.75–0.93 / 7.2–11.3 s |
| Galaxy S22 Ultra | 0.112 | 0.077 | 0.66 | 2.0 / 1.3 / 10.5 s |
| Pixel 8 (Tensor G3) | 0.142 | 0.092 | 0.72 | 2.3 / 1.3 / 20.2 s |
| Pixel 6 (Tensor G1) | 0.154 | 0.098 | 0.71 | 2.3 / 1.3 / 12.5 s |

"First audio" is the first chunk of a long text (about 18 s of speech): the
chunks are long, so streaming starts after one chunk's work.

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

Turning a sentence into phonemes takes 1–10 ms on these devices, or about 100 ms
when an unknown English word goes through the small G2P model.

## Licence

espeak-ng is GPL-3.0-or-later, and its compiled JavaScript
(`lib/tiny/frontend/espeak/generated/espeakng-runtime.js`) ships in this package.
It loads only when a language other than English or Japanese is used. UniDic is
BSD-3-Clause / LGPL-2.1 / GPL-2.0; the text data's README lists the licences of
everything it holds.
