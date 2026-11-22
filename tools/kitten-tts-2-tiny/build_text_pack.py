#!/usr/bin/env python
"""Build the text data the RN SDK downloads for Kitten TTS 2 nano / pico / mini (`textDataURL`).

One folder, to upload as is (the SDK's default is DEFAULT_TEXT_DATA_URL in
src/tiny/KittenTTS2Tiny.ts):

    en/...               misaki lexicons, spaCy tokenizer + tagger (export_english.py)
    espeak-ng-data/...   espeak-ng 1.52.0 data for the 14 espeak languages (espeak_data.py)
    manifest.json        every file with its size and sha256, and the versions it came from

The model repositories already hold everything else (graphs, voices, g2p/). Run with the
Python env that has kittenml, misaki and en_core_web_sm:

    python -I tools/kitten-tts-2-tiny/build_text_pack.py OUT_DIR
"""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent


def main() -> None:
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, "-I", str(HERE / "export_english.py"), str(out)], check=True,
                   stdout=subprocess.DEVNULL)
    subprocess.run([sys.executable, "-I", str(HERE / "espeak_data.py"), "--out", str(out)], check=True,
                   stdout=subprocess.DEVNULL)
    en = json.loads((out / "en" / "manifest.json").read_text())
    espeak = json.loads((out / "manifest.json").read_text())
    (out / "en" / "manifest.json").unlink()
    files = {}
    for p in sorted(out.rglob("*")):
        if p.is_file() and p.name != "manifest.json":
            rel = p.relative_to(out).as_posix()
            files[rel] = {"size": p.stat().st_size, "sha256": hashlib.sha256(p.read_bytes()).hexdigest()}
    manifest = {
        "name": "kitten-tts-2-text",
        "version": 1,
        "sources": {
            "misaki": en.get("misaki"),
            "spacy": en.get("spacy"),
            "spacyModel": en.get("spacyModel"),
            "espeak-ng": "1.52.0 (espeakng_loader 0.2.4 data)",
        },
        "espeakLanguages": espeak.get("languages"),
        "files": files,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
    total = sum(f["size"] for f in files.values())
    print(f"{len(files)} files, {total / 1e6:.1f} MB in {out}")


if __name__ == "__main__":
    main()
