# Third-party notices

This package's own code is Apache-2.0 ([LICENSE](./LICENSE)). It also ships, or
downloads at run time, the third-party code and data below.

## Shipped in the package

| What | Where | Licence |
| --- | --- | --- |
| [espeak-ng](https://github.com/espeak-ng/espeak-ng) 1.52.0 (commit `4870adfa25b1a32b4361592f1be8a40337c58d6c`, with its ucd-tools), compiled to JavaScript together with `vendor/espeak-ng-bridge/bridge.c` | `lib/tiny/frontend/espeak/generated/espeakng-runtime.js` | GPL-3.0-or-later |

The runtime is built by `scripts/build-espeak-ng.js` from the espeak-ng sources
at that commit and `vendor/espeak-ng-bridge/`. It runs only when a Kitten TTS 2
Nano, Pico or Mini model speaks a language other than English or Japanese, but
React Native bundles it into every app that uses this package.

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

The default `CEPhonemizer` of the Kitten TTS 1 models is an Apache-2.0
reimplementation; it downloads espeak-ng's English rule files (`en_rules`,
`en_list`, GPL-3.0-or-later) at run time.
