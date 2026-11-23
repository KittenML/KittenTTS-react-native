# Third-party notices

This package is Apache-2.0 ([LICENSE](./LICENSE)) and contains no GPL code. Below
is the third-party work it contains, the optional package that adds espeak-ng,
and the data it downloads at run time.

## Shipped in the package

Ported to TypeScript (or, for the 0.8 phonemizer, written from scratch) for
Kitten TTS 2 Nano, Pico and Mini and the 0.8 models. None of it is GPL:

| What | Licence |
| --- | --- |
| [kittenml](https://github.com/KittenML/KittenTTS), the Python package: its Kitten TTS 2 text processing (`tts_norm`, the phonemizer folds) and synthesis steps | Apache-2.0 |
| [misaki](https://github.com/hexgrad/misaki) 0.9.4: its English G2P, its Japanese cutlet G2P and its espeak post-processing | Apache-2.0 |
| [spaCy](https://github.com/explosion/spaCy) 3.8: the English tokenizer and the tagger's features | MIT |
| [cutlet](https://github.com/polm/cutlet) (as adapted in misaki) and [num2kana](https://github.com/Greatdane/Convert-Numbers-to-Japanese) | MIT |
| [MeCab](https://taku910.github.io/mecab/) 0.996: the tokenizer's lattice and Viterbi search | BSD (one of MeCab's three licence options) |
| The character BART for unknown English words ([PeterReid/graphemes_to_phonemes_en_us](https://huggingface.co/PeterReid/graphemes_to_phonemes_en_us)): its inference, in TypeScript (the weights download with the model's `g2p/` folder) | Apache-2.0 |
| English number words: an independent implementation that gives the same output as Python's `num2words` | Apache-2.0 (this package's own code) |
| `CEPhonemizer` of the 0.8 models (`vendor/cephonemizer/`): a reimplementation that reads espeak-ng's English rule files, not derived from espeak-ng's code | Apache-2.0 (this package's own code) |

## Optional: `@kittentts/espeak-ng`

Kitten TTS 2 Nano, Pico and Mini speak the languages other than English and
Japanese (de, fr, es, it, pt, ru, hi, and Mini's da, fi, nl, sv, sw, tr, ko)
through espeak-ng. It is GPL-3.0-or-later, so it comes in a separate package
from its own repository, which an app installs and imports once
(`import '@kittentts/espeak-ng';`). This package never imports it.

| What | Licence |
| --- | --- |
| [espeak-ng](https://github.com/espeak-ng/espeak-ng) 1.52.0, compiled to JavaScript | GPL-3.0-or-later |
| The [phonemizer](https://github.com/bootphon/phonemizer) 3.6.0 espeak backend, ported to TypeScript | GPL-3.0-or-later |

An app that includes `@kittentts/espeak-ng` distributes GPL-3.0-or-later code,
with the obligations that brings. An app that does not ships none. The Python
package is split the same way: kittenml (Apache-2.0) gets espeak-ng from the
separate `espeakng_loader` and `phonemizer` packages.

## Downloaded at run time

Kitten TTS 2 Nano, Pico and Mini download their text data from `textDataURL`
(default [huggingface.co/dewan-sl/kitten-tts-2-text](https://huggingface.co/dewan-sl/kitten-tts-2-text)),
only for the languages used. Its README lists the same sources:

| What | Licence |
| --- | --- |
| [misaki](https://github.com/hexgrad/misaki) 0.9.4 American English lexicons (`en/misaki-us-*.json`) | Apache-2.0 |
| CMUdict in misaki's alphabet (`en/cmu_misaki_us.json`) | CMUdict (BSD-style) |
| [spaCy](https://github.com/explosion/spacy-models) `en_core_web_sm` 3.8.0 tokenizer rules and tagger (`en/spacy-*`) | MIT |
| espeak-ng 1.52.0 compiled data (`espeak-ng-data/`) | GPL-3.0-or-later |
| [unidic-lite](https://github.com/polm/unidic-lite) 1.0.8 (UniDic 2.1.2), rebuilt (`ja/unidic-*.bin`) | BSD-3-Clause / LGPL-2.1 / GPL-2.0 |
| misaki's Japanese word list and [cutlet](https://github.com/polm/cutlet)'s tables (`ja/cutlet.bin`) | Apache-2.0 / MIT |

The espeak-ng data is downloaded only for the languages that go through
espeak-ng, the ones that need `@kittentts/espeak-ng`.

The default `CEPhonemizer` of the 0.8 models downloads espeak-ng's English rule
files (`en_rules`, `en_list`, GPL-3.0-or-later) at run time.
