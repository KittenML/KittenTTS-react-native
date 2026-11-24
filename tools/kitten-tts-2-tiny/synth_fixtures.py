#!/usr/bin/env python
"""Reference synthesis of the Python package for the RN SDK's end-to-end test.

For each (model, weights, language, voice, text): the phoneme chunks, and per chunk the
ONNX graph's durations and waveform length. The graphs add random noise in the vocoder,
so waveforms are not compared sample for sample; durations come from the text side and
are deterministic.

    python -I tools/kitten-tts-2-tiny/synth_fixtures.py [--out FILE]

The output goes to tests/fixtures/kitten-tts-2-tiny-synth.json unless --out says otherwise.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from kittenml import KittenTTS

OUT = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "kitten-tts-2-tiny-synth.json"

CASES = [
    ("kitten-tts-2-nano", "int8", "en", "Eleanor", "Hello there. Dr. Smith read 3 books on 2026-10-13 at 3:45pm."),
    ("kitten-tts-2-nano", "int8", "en", None, "The quick brown fox jumps over the lazy dog, twice!"),
    ("kitten-tts-2-nano", "int4", "en", "otis", "Kevin met Søren at the café on Friday."),
    ("kitten-tts-2-nano", "int8", "de", None, "Guten Morgen, wie geht es dir heute?"),
    ("kitten-tts-2-pico", "int4", "en", None, "Pico is four megabytes and runs on one phone thread."),
    ("kitten-tts-2-pico", "int8", "fr", None, "Bonjour, je m'appelle Marie et j'habite à Paris."),
    ("kitten-tts-2-mini", "int8", "en", None, "Mini speaks sixteen languages; this is English."),
    ("kitten-tts-2-mini", "int4", "es", None, "Hola, ¿cómo estás? Hoy hace buen tiempo."),
    ("kitten-tts-2-mini", "int8", "ja", None, "今日はいい天気ですね。東京タワーに行きましょう！"),
]
LONG = ("This sentence repeats to make a long text that is cut into chunks. " * 14).strip()
CASES.append(("kitten-tts-2-nano", "int8", "en", None, LONG))


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=OUT)
    args = ap.parse_args()
    out = []
    models = {}
    for model, weights, lang, voice, text in CASES:
        key = (model, weights)
        if key not in models:
            models[key] = KittenTTS(f"KittenML/{model}", weights=weights)
        m = models[key]
        lang_, vkey = m.resolve_voice(voice, lang)
        chunks = m.frontend(text, lang_)[0]
        pack = m._pack(lang_, vkey)
        runs = []
        for ps in chunks:
            tok = m._tokens(ps)
            style = pack[min(len(tok) - 1, pack.shape[0] - 1)][None]
            wav, dur = m._run(lang_, tok, style, 1.0)
            runs.append({"tokens": tok, "durations": [int(d) for d in dur], "samples": int(len(wav))})
        audio = m.generate(text, voice=voice, language=lang)
        out.append({"model": model, "weights": weights, "language": lang, "voice": voice, "resolved": [lang_, vkey],
                    "text": text, "chunks": chunks, "runs": runs, "audioSamples": int(len(audio))})
        print(model, weights, lang, len(chunks), "chunks", len(audio) / 24000, "s")
    with open(args.out, "w", encoding="utf-8") as f:
        json.dump({"cases": out}, f, ensure_ascii=False, indent=0)


if __name__ == "__main__":
    main()
