#!/usr/bin/env python
"""Copy the espeak-ng-data files the Kitten TTS 2 nano / pico / mini espeak languages need, for hosting.

Source: the compiled espeak-ng 1.52.0 data of espeakng_loader 0.2.4, the package the Python kittenml front end
uses (so the bytes are exactly what the Python reference reads). Output:

    <out>/espeak-ng-data/<path>     the files, paths relative to espeak-ng-data/ as EspeakG2P expects them
    <out>/manifest.json             the espeak-ng version and the file list of each language (build_text_pack.py
                                    reads it and writes the text data's manifest over it)

Each language needs the four base files espeak_Initialize reads (phontab, phonindex, phondata, intonations), its
voice file under lang/ (the voice phonemizer's set_voice picks), its dictionary, en_dict (espeak reads words its
dictionary marks as English, and Latin script in hi / ru / ko text, with its English translator) and el_dict (Greek
letters, read with the Greek translator). Words in other scripts espeak ties to a language (Devanagari, Hangul,
Armenian, Georgian, Indic scripts; Cyrillic in it, ß in pt) open that language's dictionary too; those are not
included (see SHARED_DICTS in EspeakG2P.ts). The list
was measured by tracing every file espeak-ng opens while phonemizing the parity texts; --verify proves it: each
language is phonemized again by the Python reference with ONLY its files in the data folder and compared with
tests/fixtures/kitten-tts-2-tiny-espeak.json. Keep LANG_FILES in step with VOICES in
src/tiny/frontend/espeak/EspeakG2P.ts.

build_text_pack.py runs this; on its own:

    python -I tools/kitten-tts-2-tiny/espeak_data.py --out DIR [--verify]
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
from importlib.metadata import version as pkg_version
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "tests" / "fixtures" / "kitten-tts-2-tiny-espeak.json"

BASE_FILES = ["phontab", "phonindex", "phondata", "intonations"]
SHARED_DICTS = ["en_dict", "el_dict"]
# language -> (voice file under lang/, dictionary)
LANG_FILES = {
    "de": ("gmw/de", "de_dict"),
    "es": ("roa/es", "es_dict"),
    "it": ("roa/it", "it_dict"),
    "pt": ("roa/pt-BR", "pt_dict"),
    "ru": ("zle/ru", "ru_dict"),
    "hi": ("inc/hi", "hi_dict"),
    "fr": ("roa/fr", "fr_dict"),
    "da": ("gmq/da", "da_dict"),
    "fi": ("urj/fi", "fi_dict"),
    "nl": ("gmw/nl", "nl_dict"),
    "sv": ("gmq/sv", "sv_dict"),
    "sw": ("bnt/sw", "sw_dict"),
    "tr": ("trk/tr", "tr_dict"),
    "ko": ("ko", "ko_dict"),
}


def files_for(lang: str) -> list[str]:
    voice, dictionary = LANG_FILES[lang]
    return BASE_FILES + [f"lang/{voice}", dictionary] + SHARED_DICTS


def copy_files(src: Path, dst: Path, files: list[str]) -> None:
    for rel in files:
        (dst / rel).parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src / rel, dst / rel)


def check_voice_choice() -> None:
    """The voice files must be the ones phonemizer's EspeakWrapper.set_voice selects with the full data."""
    from kittenml.kittentts2_tiny.frontend import espeak  # noqa: F401  (sets up the espeakng_loader library)
    from kittenml.kittentts2_tiny.frontend import phonemize_v2
    from phonemizer.backend.espeak.wrapper import EspeakWrapper

    first = {}
    for v in EspeakWrapper().available_voices():
        if not str(v.identifier).replace("\\", "/").startswith("mb/"):
            first.setdefault(v.language, v.identifier)
    for lang, (voice, _) in LANG_FILES.items():
        picked = first.get(phonemize_v2.ESPEAK_VOICE[lang])
        if picked != voice:
            sys.exit(f"{lang}: phonemizer selects voice {picked!r}, LANG_FILES says {voice!r}")


def verify(src: Path, langs: list[str]) -> int:
    """Phonemize the fixture texts of each language with only its files; return the number of mismatches."""
    from kittenml.kittentts2_tiny.frontend import espeak, phonemize_v1, phonemize_v2
    from phonemizer.backend.espeak.wrapper import EspeakWrapper

    fixtures = json.loads(FIXTURES.read_text(encoding="utf-8"))
    mods = {"v1": phonemize_v1, "v2": phonemize_v2}
    bad = 0
    full = EspeakWrapper._ESPEAK_DATA_PATH
    try:
        for lang in langs:
            with tempfile.TemporaryDirectory() as tmp:
                data = Path(tmp) / "espeak-ng-data"
                copy_files(src, data, files_for(lang))
                EspeakWrapper.set_data_path(str(data))
                for version, mod in mods.items():
                    if lang not in fixtures["versions"][version]:
                        continue
                    g2p = espeak.EspeakG2P(language=mod.ESPEAK_VOICE[lang])
                    # words in other scripts need other languages' dictionaries (see the module docstring)
                    cases = [c for c in fixtures["cases"][lang] if not c.get("other_script")]
                    n = 0
                    for case in cases:
                        got = mod.phonemize_lang(g2p, case["text"], lang)
                        if got != case[version]:
                            n += 1
                            print(f"  {lang} {version} {case['text']!r}: {got!r} != {case[version]!r}")
                    print(f"verify {lang} {version}: {len(cases) - n}/{len(cases)} match with only "
                          f"{len(files_for(lang))} files")
                    bad += n
    finally:
        EspeakWrapper.set_data_path(full)
    return bad


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--langs", default=",".join(LANG_FILES), help="comma-separated language codes")
    ap.add_argument("--data", type=Path, help="espeak-ng-data folder (default: espeakng_loader's)")
    ap.add_argument("--verify", action="store_true",
                    help="re-run the Python reference with only each language's files (needs the fixtures)")
    args = ap.parse_args()

    langs = [lang for lang in args.langs.split(",") if lang]
    unknown = [lang for lang in langs if lang not in LANG_FILES]
    if unknown:
        sys.exit(f"unknown languages: {unknown}")
    if args.data:
        src, source = args.data, str(args.data)
    else:
        import espeakng_loader
        src = Path(espeakng_loader.get_data_path())
        source = f"espeakng_loader {pkg_version('espeakng_loader')} espeak-ng-data"
    check_voice_choice()

    out_data = args.out / "espeak-ng-data"
    every = sorted({f for lang in langs for f in files_for(lang)})
    copy_files(src, out_data, every)

    manifest = {
        "espeak_ng": "1.52.0",
        "source": source,
        "languages": {lang: files_for(lang) for lang in langs},
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=1) + "\n", encoding="utf-8")

    def mb(paths):
        return sum((out_data / p).stat().st_size for p in paths) / 1e6

    print(f"wrote {len(every)} files ({mb(every):.2f} MB) to {out_data}")
    print(f"  base {', '.join(BASE_FILES)}: {mb(BASE_FILES):.2f} MB; "
          f"{' + '.join(SHARED_DICTS)}: {mb(SHARED_DICTS):.2f} MB")
    for lang in langs:
        own = [p for p in files_for(lang) if p not in BASE_FILES and p not in SHARED_DICTS]
        print(f"  {lang}: {' + '.join(own)} = {mb(own):.3f} MB; all files {mb(files_for(lang)):.2f} MB")

    if args.verify:
        bad = verify(src, langs)
        print(f"verify: {bad} mismatches")
        sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
