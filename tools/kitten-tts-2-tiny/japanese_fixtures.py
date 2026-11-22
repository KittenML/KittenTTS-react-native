#!/usr/bin/env python
"""Write tests/fixtures/kitten-tts-2-tiny-japanese.json: the Python kittenml phonemes for Japanese (Kitten TTS 2 mini).

Each text goes through kittenml's own code, exactly what LangG2P does before its vocab filtering:

    phonemize_v2.phonemize_lang(phonemize_v2.get_g2p("ja"), text, "ja")     (misaki JAG2P -> cutlet -> fugashi)

tests/kitten-tts-2-tiny-japanese.test.js checks that src/tiny/frontend/japanese/JapaneseG2P.ts gives the same
strings (and throws where Python raises). Texts: sentences and paragraphs from Japanese Wikipedia
(wikimedia/wikipedia 20231101.ja through the datasets-server API, cached in --wiki-dir), plus hand-written hard cases.
The fixture also holds, for a subset, cutlet's normalised text and fugashi's tokens (to test the MeCab port on
its own), and NFKC cases (Python's unicodedata against the port's tables).

    python -I tools/kitten-tts-2-tiny/japanese_fixtures.py [--out FILE]

The output goes to tests/fixtures/kitten-tts-2-tiny-japanese.json unless --out says otherwise.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import random
import re
import sys
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tests" / "fixtures" / "kitten-tts-2-tiny-japanese.json"
WIKI_DIR = Path.home() / ".cache" / "kt2tiny-ja" / "wiki"
API = "https://datasets-server.huggingface.co/rows?dataset=wikimedia/wikipedia&config=20231101.ja&split=train"
OFFSETS = [0, 120000, 240000, 360000, 480000, 600000, 720000, 840000, 960000, 1080000, 1200000, 1320000]

HARD = [
    # empty and whitespace
    "", " ", "　", "\n", " \t\n", "。", "、", "！？", "…", "・",
    # numbers, dates, money, times
    "1", "0", "10", "15", "100", "300", "1000", "3000", "8000", "10000", "12345", "100000000", "123456789",
    "1234567890", "00123", "0.5", "3.14", "1,000", "1,234,567円", "２０２４年１２月３１日", "2024年1月1日（月）",
    "午前9時30分", "10:30", "1990～2000年", "1〜3日", "第3回", "5%", "¥1,500", "$100", "€50", "１０００円",
    "電話は03-1234-5678です。", "〒100-0001", "3人", "4月", "7時", "9月", "20歳", "1日", "2日", "8日", "一二三",
    "二〇二四年", "三百六十五日", "百万円", "①②③", "⑴⑵", "Ⅻ", "½", "²", "❶", "١٢٣",
    # katakana loanwords, long vowels, small kana, sokuon
    "コンピューター", "ティーパーティー", "ヴァイオリン", "ウィキペディア", "ディズニーランド", "ファイル", "フェスティバル",
    "チェック", "シェア", "ジェット", "トゥモロー", "デュエット", "クァルテット", "グァテマラ", "ツァイト", "スィーツ",
    "ラーメン", "ビール", "ケーキ", "おばあさん", "おじいさん", "とうきょう", "がっこう", "きって", "ちょっと",
    "やっぱり", "まっすぐ", "いっしょ", "ぁぃぅぇぉ", "ゃゅょ", "っ", "ッ", "ん", "ン", "ー", "ーー", "あー", "えっ！",
    "ヷヸヹヺ", "ゔぁゔぃゔぇゔぉ", "ヴ", "ゕゖ", "ゎ", "ゐゑ",
    # half-width katakana and full-width ASCII
    "ｶﾀｶﾅ", "ﾃﾞｰﾀﾍﾞｰｽ", "ﾊﾟｿｺﾝ", "ｱｲｳｴｵ", "ｳﾞｧｲｵﾘﾝ", "ｷｬｯﾁ", "｢ｶｷｸｹｺ｣｡", "ＡＢＣ", "ＡＢＣ（エービーシー）",
    "Ｗｉｎｄｏｗｓ１０", "ｐｙｔｈｏｎ", "＃タグ", "１２３", "Ｔｏｋｙｏ　２０２０", "！＂＃＄％＆＇（）＊＋，－．／",
    # mixed English
    "iPhoneを買いました。", "Pythonでプログラミング", "NHKのニュース", "AIとIoT", "USBメモリー", "Hello World",
    "This is English.", "e-mail", "Wi-Fi", "COVID-19", "YouTubeで動画を見る", "東京2020オリンピック", "JR東日本",
    "Mr. Smith", "OK!", "A-B-C", "F1", "G7サミット", "3D", "DNA", "GDP成長率",
    # kanji with rare or ambiguous readings, odoriji
    "今日", "明日", "昨日", "一人", "二人", "大人", "七夕", "紅葉", "時々", "人々", "山々", "佐々木", "こゝろ",
    "いすゞ", "ことゞ", "ヽ", "ヾ", "〃", "々", "鬱", "薔薇", "憂鬱", "蒟蒻", "麒麟", "齟齬", "躊躇", "魑魅魍魎",
    "𠮷野家", "𩸽", "髙島屋", "﨑", "嵜", "辻󠄀",
    # punctuation and brackets
    "「こんにちは」と言った。", "『吾輩は猫である』", "【速報】地震", "《注意》", "（かっこ）", "〈山〉", "«quote»",
    "“引用”", "‘single’", "え、本当？", "すごい！！", "まさか…", "ええと……", "そう‥", "あ・い・う", "A・B",
    "東京〜大阪", "東京～大阪", "1〜2", "5～10", "ー、", "――", "―", "〜", "～", "!?", "?!", "。。。", "、、",
    "(株)", "㈱", "㍻", "㌔", "㎞", "℃", "№1", "※注意", "★☆", "→", "♪", "〒", "〆切", "ゝ", "ゞ",
    # combining marks and odd code points
    "が", "ぱ", "゙", "゛", "゜", "ガ", "é", "Å", "ﬁ", "﻿テスト",
    "テ​スト", "テスト です", "a　b", "タブ\tです", "改行\nです", "\r\n", "x\x00y", "😀笑顔",
    "ㇰㇱㇲ", "ㇳㇴㇵ", "ㇶㇷㇸㇹㇺㇻㇼㇽㇾㇿ", "Ελληνικά", "Русский", "한국어", "中文简体", "ภาษาไทย", "العربية",
    "￿", "\U0001f1ef\U0001f1f5",
    # sentences
    "吾輩は猫である。名前はまだ無い。",
    "どこで生れたかとんと見当がつかぬ。",
    "国境の長いトンネルを抜けると雪国であった。",
    "私は昨日、東京駅で友達と会いました。",
    "この本は1,980円（税込）です。",
    "彼女は「明日また来ます」と言って帰った。",
    "２０２３年１０月１日から新しい制度が始まります。",
    "ＪＲ山手線は約１時間で一周します。",
    "えっ、本当ですか？信じられない！",
    "すみません、トイレはどこですか。",
    "ｶﾞｷﾞｸﾞｹﾞｺﾞ、ﾊﾟﾋﾟﾌﾟﾍﾟﾎﾟ。",
    "日本の人口は約1億2,500万人です。",
    "気温は-5℃まで下がりました。",
    "午後3時45分に出発します。",
    "第2次世界大戦は1945年に終わった。",
    "彼は100メートルを9.58秒で走った。",
    "ご飯を食べましょう、ね？",
    "東京特許許可局",
    "生麦生米生卵",
    "隣の客はよく柿食う客だ",
    "あ い う え お",
    "  前後に空白  ",
    "行末の空白 ",
    "連続   した   空白",
    "ーあ", "っあ", "んあ", "ゝあ",
    "こんにちは" * 30,
    "トーキョー" * 8 + "。",
    "あ" * 40,
    "ア" * 30,
    "漢" * 30,
]


# Long inputs, stored as [piece, repeat] lists: MeCab looks at most 65535 bytes ahead, and a node's
# length and rlength (length plus the whitespace before it) are 16-bit, so more than 64 KB of
# whitespace in a row changes the lattice (and can make fugashi raise SystemError). Runs of one
# character type stay short: cutlet's ja_words grouping is cubic in the length of a run.
GENERATED = [
    [[" ", 70000], ["猫です", 1]],
    [[" ", 65534], ["a猫です", 1]],
    [[" ", 65535], ["猫です", 1]],
    [["\t", 65536], ["猫", 1]],
    [["\n", 30000], ["犬", 1], [" ", 40000], ["猫", 1]],
    [["猫a", 25000]],
    [["猫。a", 9000], ["犬", 1]],
    [["東京Ｘ", 15000]],
]


def fetch_wiki(wiki_dir: Path) -> list[dict]:
    wiki_dir.mkdir(parents=True, exist_ok=True)
    rows = []
    for off in OFFSETS:
        path = wiki_dir / f"rows-{off}.json"
        if not path.exists():
            url = f"{API}&offset={off}&length=100"
            for attempt in range(8):
                try:
                    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "fixture-builder"}),
                                                timeout=120) as r:
                        data = r.read()
                    json.loads(data)
                    path.write_bytes(data)
                    break
                except (urllib.error.URLError, TimeoutError, ValueError) as e:
                    wait = 10 * (attempt + 1)
                    print(f"  offset {off}: {e}; retrying in {wait} s", file=sys.stderr)
                    time.sleep(wait)
            else:
                sys.exit(f"could not download offset {off}")
            time.sleep(3)
        rows += [r["row"] for r in json.loads(path.read_text(encoding="utf-8"))["rows"]]
    return rows


SENT_END = re.compile(r"(?<=[。！？])")


def wiki_texts(rows: list[dict], n_sentences: int, n_paragraphs: int) -> tuple[list[str], list[str]]:
    rng = random.Random(1234)
    sentences, paragraphs = [], []
    for row in rows:
        lines = [ln.strip() for ln in row["text"].split("\n") if ln.strip()]
        cands, paras = [], []
        for ln in lines:
            if len(ln) >= 40 and "。" in ln:
                paras.append(ln[:600])
            for s in SENT_END.split(ln):
                s = s.strip()
                if 6 <= len(s) <= 160:
                    cands.append(s)
        rng.shuffle(cands)
        sentences += cands[:4]
        if paras:
            paragraphs.append(rng.choice(paras))
    rng.shuffle(sentences)
    rng.shuffle(paragraphs)
    seen = set()
    out = []
    for s in sentences:
        if s not in seen:
            seen.add(s)
            out.append(s)
    return out[:n_sentences], paragraphs[:n_paragraphs]


def nfkc_cases() -> list[list[str]]:
    """Every code point NFKC changes (in chunks), and random runs of marks, jamo and kana."""
    changed = [chr(c) for c in range(0x110000)
               if not 0xD800 <= c <= 0xDFFF and unicodedata.normalize("NFKC", chr(c)) != chr(c)]
    cases = []
    for i in range(0, len(changed), 64):
        s = "".join(changed[i:i + 64])
        cases.append([s, unicodedata.normalize("NFKC", s)])
    rng = random.Random(7)
    marks = [chr(c) for c in range(0x300, 0x370)] + ["̣", "̛", "ͅ", "ְ", "่", "゙",
                                                      "゚", "᷀", "⃐", "︠"]
    bases = list("aeiouAEIOUnNcCsSzZyYwW") + ["α", "ω", "Α", "а", "И", "か", "ハ",
                                               "ｶ", "ﾊ", "ﾞ", "ﾟ", "ᄀ", "ᅡ", "ᆨ",
                                               "가", "ㄱ", "ㅏ", "Å", "Å", "ẛ", "̈́"]
    for _ in range(400):
        s = "".join(rng.choice(bases) if rng.random() < 0.45 else rng.choice(marks) for _ in range(rng.randint(1, 12)))
        cases.append([s, unicodedata.normalize("NFKC", s)])
    return cases


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--wiki-dir", type=Path, default=WIKI_DIR)
    ap.add_argument("--sentences", type=int, default=2000)
    ap.add_argument("--paragraphs", type=int, default=150)
    ap.add_argument("--tokens", type=int, default=400, help="texts whose fugashi tokens are stored too")
    args = ap.parse_args()

    import jaconv
    from jaconv.jaconv import K2H_TABLE

    from kittenml.kittentts2_tiny.frontend import phonemize_v2

    # cutlet.ts ports jaconv.kata2hira as: ァ-ヶ and ヽヾ shift down to hiragana, nothing else changes
    rule = {c: chr(c - 0x60) for c in list(range(0x30A1, 0x30F7)) + [0x30FD, 0x30FE]}
    assert {k: v for k, v in K2H_TABLE.items() if chr(k) != v} == rule

    rows = fetch_wiki(args.wiki_dir)
    sentences, paragraphs = wiki_texts(rows, args.sentences, args.paragraphs)
    print(f"{len(rows)} articles -> {len(sentences)} sentences, {len(paragraphs)} paragraphs, {len(HARD)} hard cases")

    g2p = phonemize_v2.get_g2p("ja")
    cut = g2p.cutlet

    def run(text: str) -> dict:
        try:
            return {"text": text, "phonemes": phonemize_v2.phonemize_lang(g2p, text, "ja")}
        except Exception as e:  # noqa: BLE001  (the port must fail the same way)
            return {"text": text, "error": type(e).__name__}

    t = time.time()
    cases = {"hard": [run(s) for s in HARD], "wiki": [run(s) for s in sentences],
             "paragraphs": [run(s) for s in paragraphs]}
    generated = []
    for parts in GENERATED:
        r = run("".join(p * n for p, n in parts))
        del r["text"]
        if len(r.get("phonemes", "")) > 1000:    # keep the fixture small: length and sha256 only
            ps = r.pop("phonemes")
            r["phonemes_len"] = len(ps)
            r["phonemes_sha256"] = hashlib.sha256(ps.encode("utf-8")).hexdigest()
        generated.append({"parts": parts, **r})
    n = sum(len(v) for v in cases.values())
    print(f"phonemized {n} texts in {time.time() - t:.1f} s ({(time.time() - t) / n * 1000:.2f} ms each)")

    tokens = []
    for text in HARD + sentences[: args.tokens]:
        try:
            norm = cut._normalize_text(text) if text else ""
        except Exception:  # noqa: BLE001
            continue
        toks = [[w.surface, jaconv.kata2hira(w.feature.pron or w.feature.kana or w.surface),
                 6 if w.char_type == 7 or not w.is_unk else w.char_type] for w in cut.tagger(norm)]
        tokens.append({"text": text, "normalized": norm, "tokens": toks})

    errors = sorted({c["error"] for v in cases.values() for c in v if "error" in c})
    fixture = {
        "reference": "phonemize_v2.phonemize_lang(get_g2p('ja'), text, 'ja')",
        "versions": {"python": sys.version.split()[0], "unicode": unicodedata.unidata_version},
        "cases": cases,
        "generated": generated,
        "tokens": tokens,
        "nfkc": nfkc_cases(),
    }
    args.out.write_text(json.dumps(fixture, ensure_ascii=False, indent=0) + "\n", encoding="utf-8")
    print(f"wrote {args.out} ({args.out.stat().st_size / 1e6:.2f} MB); errors raised by Python: {errors}")


if __name__ == "__main__":
    main()
