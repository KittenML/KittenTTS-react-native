# Kitten TTS 2 Nano, Pico and Mini

Small multilingual Kitten TTS 2 models that run on the phone's CPU with ONNX
Runtime. They are the same models, voices and text processing as the Python
package's `KittenTTS("KittenML/kitten-tts-2-nano")`, and the SDK gives the same
phonemes for the same text.

| Model | Parameters | int8 per model | int4 per model | Languages |
| --- | --- | --- | --- | --- |
| `kitten-tts-2-mini` | 82M | 83 MB | 47 MB | 16: en de es it pt ru hi fr da fi ja ko nl sv sw tr (ja not yet in the SDK) |
| `kitten-tts-2-nano` | 17M | 17 MB per language | 8.8 MB per language | 8: en de es it pt ru hi fr |
| `kitten-tts-2-pico` | 7.2M | 8 MB per language | 4 MB per language | 8: en de es it pt ru hi fr |

## Usage

```tsx
import { KittenTTS } from '@kittentts/react-native';

const tts = await KittenTTS.create({
  model: 'kitten-tts-2-nano',     // or 'kitten-tts-2-pico', 'kitten-tts-2-mini'
  weights: 'int8',                 // or 'int4': about half the size
  languages: ['en', 'de'],         // downloaded now; others on first use
  textDataURL: 'https://your-host/kitten-tts-2-text', // see "Text data" below
});

tts.languages;                     // ['en', 'de', 'es', ...]
tts.availableVoices;               // { en: ['Eleanor', ...], de: ['Anna', ...] }
tts.voices('de');                  // [{ key, name, description, language }, ...]

const result = await tts.generate('Hello there.');                    // English, first voice
await tts.generate('Guten Morgen.', { language: 'de' });              // German, first voice
await tts.generate('Guten Morgen.', { voice: 'Paul' });               // a German voice: German
await tts.generate('Hello there.', { voice: 'eleanor', speed: 1.1 }); // names in any case

for await (const chunk of tts.generateStreaming(longText, { language: 'fr' })) {
  // each chunk as soon as it is ready
}

await tts.phonemize('Hello there.');   // the phoneme chunks the model will say
await tts.speak('Hello!');             // with a player passed to create()
await tts.dispose();
```

`generate()` returns a `KittenTTSResult` (24 kHz float samples, `wavData()`,
`duration`); `result.voice` is the voice's name. Long text is cut at sentence
ends into chunks of at most 350 phonemes, joined with 0.15 s of silence, as in
Python. `wordTimings` is empty for these models.

| Option | Default | |
| --- | --- | --- |
| `voice` | the language's first voice | a name from `availableVoices` in any case, or a voice's description |
| `language` | the voice's language, else the model's default (`en`) | a code from `languages` |
| `speed` | `1` | larger is faster |

## What gets downloaded

Files are cached under `<DocumentDirectory>/KittenTTS/` (or `storageDirectory`)
and fetched only for the languages used:

- From the model's Hugging Face repository (or `modelBaseURL`):
  `config.json`, `vocab.json`, the language's ONNX graph and its voices file.
- English text processing: misaki's lexicons and spaCy's tokenizer and tagger
  (12.6 MB, from `textDataURL`), plus CMUdict and the small G2P model from the
  model repository's `g2p/` folder (6.4 MB).
- Every other language: espeak-ng's data for it (about 1 MB; Russian 9.4 MB
  because of its dictionary), from `textDataURL`.

## Text data

The English lexicons, the spaCy tagger and espeak-ng's data are not in the model
repositories (Python gets them from pip packages), so the SDK downloads them from
`textDataURL`. The default, `DEFAULT_TEXT_DATA_URL`, points at
`huggingface.co/KittenML/kitten-tts-2-text`, which has to be created first.
Build the folder to upload with the Python environment that has `kittenml`:

```bash
python -I tools/kitten-tts-2-tiny/build_text_pack.py out/kitten-tts-2-text
```

It writes `en/`, `espeak-ng-data/` and a `manifest.json` (39 files, 23 MB).
Upload the folder as is.

## How it matches Python

- **English:** `tts_norm` text normalisation, misaki's lexicon (with spaCy
  `en_core_web_sm`'s part-of-speech tags), then CMUdict and a small BART model
  for unknown words. All are ported to TypeScript, and the tagger's network runs
  in ONNX Runtime. Every stage gives Python's output on 3,078 Wikipedia
  sentences.
- **Other languages:** espeak-ng 1.52.0 (the version the Python package loads),
  compiled to plain JavaScript, with phonemizer's and misaki's post-processing
  ported. It matches Python on 2,214 sentences in 14 languages.
- **Speech:** the same tokens, voice style row and post-processing (trimming,
  fades, gaps) as Python. The graphs add random noise in the vocoder, so two runs
  never give identical samples, in Python either. Rarely, a duration that sits on
  x.5 before rounding comes out one frame (25 ms) different, because another
  ONNX Runtime build rounds it the other way.

The tests in `tests/kitten-tts-2-tiny-*.test.js` check all of this against
fixtures written by the Python package (`tools/kitten-tts-2-tiny/*_fixtures.py`).

## Speed

Measured on a Mac (M5 Pro) in the iOS simulator (iPhone 18 Pro, iOS 27.2) and the
Android emulator (arm64, Android 17), Release builds with Hermes, not on phones.
"Real-time factor" is seconds of work per second of audio.

| | iOS simulator | Android emulator |
| --- | --- | --- |
| Nano int8 | 0.03–0.04 | 0.05–0.08 |
| Pico int4 | 0.02 | 0.03 |
| Mini int8 | 0.13–0.16 | 0.34–0.39 |
| `create()` with English, files cached | 3 s | 3 s |
| First sentence in another language, files cached | 0.35–0.45 s | 0.15–0.6 s |

Turning a sentence into phonemes takes 1–10 ms, or about 100 ms when an unknown
English word goes through the small G2P model. Most of `create()` is loading
English's lexicons and tagger.

## Licence

espeak-ng is GPL-3.0-or-later, and its compiled JavaScript
(`lib/tiny/frontend/espeak/generated/espeakng-runtime.js`) ships in this package.
It loads only when a non-English language is used.

## Not supported yet

- Japanese on Mini: the Python package uses misaki's own Japanese G2P
  (pyopenjtalk), which is not ported.
- Word timings.
- Bundling the files in the app instead of downloading them.
