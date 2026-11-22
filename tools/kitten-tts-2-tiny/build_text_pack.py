#!/usr/bin/env python
"""Build the text data the RN SDK downloads for Kitten TTS 2 nano / pico / mini (`textDataURL`).

One folder, to upload as is (the SDK's default is DEFAULT_TEXT_DATA_URL in
src/tiny/KittenTTS2Tiny.ts):

    en/...               misaki lexicons, CMUdict, spaCy tokenizer + tagger (export_english.py)
    espeak-ng-data/...   espeak-ng 1.52.0 data for the 14 espeak languages (espeak_data.py)
    ja/...               UniDic (unidic-lite 1.0.8) rebuilt for the TypeScript MeCab, and cutlet's
                         tables, for Mini's Japanese (japanese_data.py)
    manifest.json        every file with its size and sha256, and the versions it came from
    README.md            the sources and licences, for the hosting repository

Files over 32 kB that gzip to under 75% of their size are stored only as "<file>.gz"; the
manifest says so (`gzip`), and the SDK downloads the .gz and unpacks it once on the device.

The model repositories already hold everything else (graphs, voices, g2p/). Run with the
Python environment docs/development.md describes:

    python -I tools/kitten-tts-2-tiny/build_text_pack.py OUT_DIR
"""
from __future__ import annotations

import gzip
import hashlib
import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

README = """---
license: other
tags:
- text-to-speech
- kitten-tts
---

# Kitten TTS 2 text data for the React Native SDK

Text-processing data the [KittenTTS React Native SDK](https://github.com/KittenML/KittenTTS-react-native)
downloads for Kitten TTS 2 Nano, Pico and Mini, so it phonemizes text exactly like the Python package
(`kittenml`). Built by `tools/kitten-tts-2-tiny/build_text_pack.py`; `manifest.json` lists every file
with its size and sha256. Files that compress well are stored gzipped (`<file>.gz`).

| Path | What | From | Licence |
| --- | --- | --- | --- |
| `en/misaki-us-*.json` | misaki 0.9.4 American English lexicons | [hexgrad/misaki](https://github.com/hexgrad/misaki) | Apache-2.0 |
| `en/cmu_misaki_us.json` | CMUdict in misaki's alphabet | the KittenML/kitten-tts-2-* repositories (`g2p/`) | CMUdict (BSD-style) |
| `en/spacy-*` | spaCy en_core_web_sm 3.8.0 tokenizer rules and part-of-speech tagger (network as ONNX, float16 weights) | [explosion/spacy-models](https://github.com/explosion/spacy-models) | MIT |
| `espeak-ng-data/` | espeak-ng 1.52.0 compiled data (via espeakng_loader 0.2.4) | [espeak-ng](https://github.com/espeak-ng/espeak-ng) | GPL-3.0-or-later |
| `ja/unidic-*.bin` | unidic-lite 1.0.8 (UniDic 2.1.2) entries, costs and connection matrix, rebuilt compact; readings only | [polm/unidic-lite](https://github.com/polm/unidic-lite) | BSD-3-Clause / LGPL-2.1 / GPL-2.0 |
| `ja/cutlet.bin` | misaki's Japanese word list, cutlet's tables, Unicode 15.0 tables | [hexgrad/misaki](https://github.com/hexgrad/misaki), [polm/cutlet](https://github.com/polm/cutlet) | Apache-2.0 / MIT |
"""


def main() -> None:
    out = Path(sys.argv[1]).resolve()
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, "-I", str(HERE / "export_english.py"), str(out)], check=True,
                   stdout=subprocess.DEVNULL)
    subprocess.run([sys.executable, "-I", str(HERE / "espeak_data.py"), "--out", str(out)], check=True,
                   stdout=subprocess.DEVNULL)
    subprocess.run([sys.executable, "-I", str(HERE / "japanese_data.py"), "--out", str(out)], check=True,
                   stdout=subprocess.DEVNULL)
    # Each script leaves a manifest; keep their versions and language lists, not the files.
    en = json.loads((out / "en" / "manifest.json").read_text())
    ja = json.loads((out / "ja" / "manifest.json").read_text())
    espeak = json.loads((out / "manifest.json").read_text())
    (out / "en" / "manifest.json").unlink()
    (out / "ja" / "manifest.json").unlink()
    files = {}
    for p in sorted(out.rglob("*")):
        if not p.is_file() or p.name == "manifest.json" or p.suffix == ".gz":
            continue
        rel = p.relative_to(out).as_posix()
        raw = p.read_bytes()
        entry = {"size": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        packed = gzip.compress(raw, compresslevel=9, mtime=0)
        if len(raw) > 32_000 and len(packed) < 0.75 * len(raw):
            p.with_name(p.name + ".gz").write_bytes(packed)
            p.unlink()
            entry["gzip"] = {"size": len(packed), "sha256": hashlib.sha256(packed).hexdigest()}
        files[rel] = entry
    manifest = {
        "name": "kitten-tts-2-text",
        "version": 2,
        "sources": {
            **en,
            "espeak-ng": f"{espeak['espeak_ng']} ({espeak['source']})",
            "japanese": ja["sources"],
        },
        "espeakLanguages": espeak["languages"],
        "files": files,
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False), encoding="utf-8")
    (out / "README.md").write_text(README, encoding="utf-8")
    total = sum(f["size"] for f in files.values())
    hosted = sum(f["gzip"]["size"] if "gzip" in f else f["size"] for f in files.values())
    print(f"{len(files)} files, {total / 1e6:.1f} MB ({hosted / 1e6:.1f} MB to download) in {out}")


if __name__ == "__main__":
    main()
