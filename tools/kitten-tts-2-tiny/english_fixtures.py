#!/usr/bin/env python
"""Reference outputs of the Python package's English front end, for the TypeScript port.

For each text: spaCy's tokens and tags (on the normalised text), misaki's raw phoneme
string, and the front end's final phonemes (EnglishG2P with the nano/pico v1 vocab).

    python -I tools/kitten-tts-2-tiny/english_fixtures.py OUT.json [TEXTS.json]

TEXTS.json is a JSON list of strings; without it, the built-in sentences are used.
"""
from __future__ import annotations

import json
import os
import sys

from huggingface_hub import snapshot_download

from kittenml.kittentts2_tiny.frontend import english
from kittenml.kittentts2_tiny.frontend.tts_norm import normalize

BUILTIN = [
    "Hello there.",
    "Dr. Smith read 3 books on 2026-10-13 at 3:45pm, costing $24.5B.",
    "I read the book yesterday, and I will read it again tomorrow.",
    "They live in a live music venue near St. Paul St.",
    "The U.S.A. and the U.K. signed it in 1999; it cost £3.50 per unit.",
    "She said, \"Don't go!\" — but he'd already left...",
    "Kevin, Diego and Søren met Paul at the café.",
    "What's the URL? It's https://kittenml.com/docs, or email hi@example.com.",
    "It's 5km away; walk 60 mph? No: 3/4 of a mile.",
    "COVID-19 vaccines rolled out in 2021 (mostly).",
    "The 1st, 2nd, 3rd and 103rd runners won $1,000,000.",
    "He used to live here, but he used the car.",
    "Call 555-0123 or +1 415 555 0123 ext. 42.",
    "Chapter IV: World War II ended in 1945.",
    "e.g. this, i.e. that, etc.",
    "AI, GPU, NASA, FBI and IKEA are acronyms.",
    "Mr. and Mrs. Jones live at 42 Elm St., Apt. 3B.",
    "Wow!!! Really?! Yes... no... maybe.",
    "The temperature dropped to -5°C (23°F) overnight.",
    "3.14159 is pi; 2.5% of 1,234 is 30.85.",
    "Tom's dogs' toys were in the Joneses' yard.",
    "I'm, you're, we've, they'll, she'd, it'd, can't, won't, shan't.",
    "Rock 'n' roll isn't dead.",
    "The quick brown fox jumps over the lazy dog.",
    "A an the. An apple a day. The end.",
    "To be or not to be, that is the question.",
    "Supercalifragilisticexpialidocious and antidisestablishmentarianism.",
    "Xochitl, Siobhan and Nguyen visited Llanfairpwllgwyngyll.",
    "\"Quoted,\" she said; 'single quotes' too.",
    "Numbers: 0, 7, 13, 42, 100, 1001, 2020s, 1990's, 90s.",
    "  Leading and trailing spaces.  ",
    "Line one.\nLine two.\n\nLine four.",
    "Tabs\tand  double  spaces.",
    "[Kitten](/kˈɪtᵊn/) TTS speaks.",
    "I scored 3-2 in the match, 10-20 people came.",
    "OK, so the 2 of us went 2gether.",
    "Emoji 😀 and symbols like © ™ § appear.",
]


def main() -> None:
    out_path = sys.argv[1]
    texts = json.load(open(sys.argv[2])) if len(sys.argv) > 2 else BUILTIN
    root = snapshot_download("KittenML/kitten-tts-2-nano", allow_patterns=["g2p/*", "g2p/**", "vocab.json"])
    vocab = json.load(open(os.path.join(root, "vocab.json"), encoding="utf-8"))
    v1 = {k: v for k, v in vocab.items() if k != "ʉ"}
    g2p = english.EnglishG2P(v1, os.path.join(root, "g2p"))
    nlp = g2p.g2p.nlp
    cases = []
    for text in texts:
        norm = normalize(text)
        doc = nlp(norm)
        raw, _ = g2p.g2p(norm)
        res = g2p(text)
        cases.append({
            "text": text,
            "normalized": res.text,
            "tokens": [[t.text, bool(t.whitespace_), t.tag_] for t in doc],
            "misaki": raw,
            "phonemes": res.phonemes,
        })
    json.dump({"cases": cases}, open(out_path, "w", encoding="utf-8"), ensure_ascii=False, indent=0)
    print(len(cases), "cases")


if __name__ == "__main__":
    main()
