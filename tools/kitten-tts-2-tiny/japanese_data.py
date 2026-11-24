#!/usr/bin/env python
"""Write the data files the RN SDK's Japanese G2P (src/tiny/frontend/japanese/) needs, for hosting.

The Kitten TTS 2 mini reads Japanese with misaki's cutlet G2P: MeCab (fugashi 1.5.2) with the unidic-lite 1.0.8
dictionary (UniDic 2.1.2), then cutlet's kana -> IPA rules. The TypeScript port runs MeCab's lattice itself, so it
needs exactly what MeCab's segmentation depends on, and what cutlet reads from each node:

    the dictionary trie (every surface of sys.dic), each entry's context id, word cost and reading
    (feature.pron or feature.kana, through jaconv.kata2hira), the unknown-word entries of unk.dic, the
    character categories of char.bin, and the connection costs of matrix.bin.

The 158 MB of other UniDic features are dropped. Output:

    <out>/ja/unidic-lex.bin      surfaces (UTF-8, sorted), entries, readings, unknown words, char categories
                                 (offset arrays stored as differences; the loader sums them up in place)
    <out>/ja/unidic-matrix.bin   connection costs: duplicate rows and columns merged (5981x5981 -> 4613x4595,
                                 padded to an even width), rows and columns reordered so neighbours are
                                 alike, each row stored as its difference from the previous one (gzip
                                 6.6 MB instead of 19 MB); the loader adds them back up in place
    <out>/ja/cutlet.bin          misaki's ja_words.txt (cutlet's word list), and the Unicode tables of the
                                 Python that wrote it (NFKC, the regex \\d, str.isdigit), so the phone
                                 normalises text exactly as Python 3.12 does
    <out>/ja/manifest.json       the versions they came from, for build_text_pack.py (which removes it)

Every file is one container (layout in src/tiny/frontend/japanese/container.ts): "KTJA", a version, flags, then
named typed arrays, 8-byte aligned, little-endian.

build_text_pack.py runs this; on its own:

    python -I tools/kitten-tts-2-tiny/japanese_data.py --out DIR

UniDic is BSD-3-Clause / LGPL-2.1 / GPL-2.0 (tri-licence); misaki's ja_words.txt is Apache-2.0.
"""
from __future__ import annotations

import argparse
import csv
import json
import struct
import sys
import time
import unicodedata
from pathlib import Path

import numpy as np

FORMAT_VERSION = 1

# dtype codes of the container (container.ts)
U8, U16, I16, U32 = 1, 2, 3, 4
NP = {U8: np.uint8, U16: np.uint16, I16: np.int16, U32: np.uint32}

TOKEN = np.dtype([("lc", "<u2"), ("rc", "<u2"), ("posid", "<u2"), ("wcost", "<i2"),
                  ("feature", "<u4"), ("compound", "<u4")])
NO_READING = 0xFFFFFFFF


# ---------------------------------------------------------------------------------------------------------------
# containers

def write_container(path: Path, sections: list[tuple[str, int, np.ndarray]]) -> None:
    head = 16 + 32 * len(sections)
    off = (head + 7) & ~7
    descs, blobs = [], []
    for name, code, arr in sections:
        a = np.ascontiguousarray(arr, dtype=np.dtype(NP[code]).newbyteorder("<"))
        assert len(name) < 20, name
        descs.append(struct.pack("<20sIII", name.encode(), code, off, a.size))
        b = a.tobytes()
        blobs.append((off, b))
        off = (off + len(b) + 7) & ~7
    out = bytearray(off)
    out[0:16] = struct.pack("<4sIII", b"KTJA", FORMAT_VERSION, 0, len(sections))
    out[16:head] = b"".join(descs)
    for o, b in blobs:
        out[o:o + len(b)] = b
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(bytes(out))


# ---------------------------------------------------------------------------------------------------------------
# MeCab binary dictionaries (mecab/src/dictionary.cpp, darts.h)

def read_dic(path: Path):
    b = path.read_bytes()
    magic, version, typ, lexsize, lsize, rsize, dsize, tsize, fsize, _ = struct.unpack("<10I", b[:40])
    assert version == 102 and magic ^ 0xEF718F77 == len(b), (path, version)
    charset = b[40:72].split(b"\0")[0].decode()
    assert charset.lower() in ("utf8", "utf-8"), charset
    da = np.frombuffer(b, dtype="<i4", count=dsize // 4, offset=72).reshape(-1, 2)
    tokens = np.frombuffer(b, dtype=TOKEN, count=lexsize, offset=72 + dsize)
    assert tsize == lexsize * TOKEN.itemsize
    features = b[72 + dsize + tsize:72 + dsize + tsize + fsize]
    return dict(type=typ, lsize=lsize, rsize=rsize, da=da, tokens=tokens, features=features)


def da_keys(da) -> list[tuple[bytes, int]]:
    """Every key of a Darts double array with its value. A child of the node with base b sits at b + byte + 1
    with check == b; the end of a key at b itself, with check == b and base = -value - 1."""
    base = da[:, 0].astype(np.int64)
    check = da[:, 1].view(np.uint32).astype(np.int64)
    order = np.argsort(check, kind="stable")
    sorted_check = check[order]
    out: list[tuple[bytes, int]] = []
    stack = [(0, b"")]
    while stack:
        pos, key = stack.pop()
        b = int(base[pos])
        lo, hi = np.searchsorted(sorted_check, b, "left"), np.searchsorted(sorted_check, b, "right")
        for p in order[lo:hi].tolist():
            if p == b:
                if base[p] < 0:
                    out.append((key, int(-base[p] - 1)))
            elif 1 <= p - b - 1 <= 255:
                stack.append((p, key + bytes([p - b - 1])))
    return out


def da_exact(da, key: bytes):
    """Darts exactMatchSearch, to check da_keys."""
    b = int(da[0, 0])
    for c in key:
        p = b + c + 1
        if p >= len(da) or (int(da[p, 1]) & 0xFFFFFFFF) != b:
            return None
        b = int(da[p, 0])
    if (int(da[b, 1]) & 0xFFFFFFFF) == b and da[b, 0] < 0:
        return int(-da[b, 0] - 1)
    return None


def fugashi_fields(features: bytes, offset: int, n_fields: int) -> list:
    """fugashi UnidicNode.set_feature: csv when the feature has a double quote, else split(','); then
    padded with None to the wrapper's field count."""
    end = features.index(b"\0", offset)
    raw = features[offset:end].decode("utf-8")
    fields = next(csv.reader([raw])) if '"' in raw else raw.split(",")
    return fields + [None] * (n_fields - len(fields))


# ---------------------------------------------------------------------------------------------------------------
# the parts

def build_lexicon(dicdir: Path):
    import jaconv
    from fugashi.fugashi import UnidicFeatures26

    names = UnidicFeatures26._fields
    i_pron, i_kana = names.index("pron"), names.index("kana")

    sysdic = read_dic(dicdir / "sys.dic")
    unkdic = read_dic(dicdir / "unk.dic")
    assert sysdic["type"] == 0 and unkdic["type"] == 2
    tokens, features = sysdic["tokens"], sysdic["features"]
    assert (tokens["lc"] == tokens["rc"]).all(), "UniDic gives every entry one context id for both sides"

    t = time.time()
    keys = da_keys(sysdic["da"])
    keys.sort()                                   # bytes order: what the byte-wise prefix search expects
    print(f"  {len(keys)} surfaces, {len(tokens)} entries ({time.time() - t:.1f} s)")
    for k, v in keys[:: max(1, len(keys) // 2000)]:
        assert da_exact(sysdic["da"], k) == v, k

    # MeCab's results buffer holds 512 prefixes (tokenizer.h kResultsSize); no surface chain comes close.
    key_set = {k for k, _ in keys}
    longest_chain = max(sum(1 for i in range(1, len(k) + 1) if k[:i] in key_set) for k, _ in keys)
    assert longest_chain < 512, longest_chain

    key_off = np.zeros(len(keys) + 1, np.uint32)
    key_bytes = bytearray()
    tok_start = np.zeros(len(keys) + 1, np.uint32)
    tok_attr, tok_cost, tok_read = [], [], []
    read_index: dict[str, int] = {}
    read_off = [0]
    read_chars: list[int] = []
    for i, (k, v) in enumerate(keys):
        key_bytes += k
        key_off[i + 1] = len(key_bytes)
        first, count = v >> 8, v & 0xFF
        tok_start[i + 1] = tok_start[i] + count
        for j in range(first, first + count):
            tok = tokens[j]
            tok_attr.append(int(tok["lc"]))
            tok_cost.append(int(tok["wcost"]))
            f = fugashi_fields(features, int(tok["feature"]), len(names))
            if len(f) != len(names):
                raise SystemExit(f"entry {k.decode()!r} has {len(f)} features; fugashi would fail on it")
            reading = f[i_pron] or f[i_kana]           # cutlet: w.feature.pron or w.feature.kana or w.surface
            if not reading:
                tok_read.append(NO_READING)
                continue
            hira = jaconv.kata2hira(reading)
            idx = read_index.get(hira)
            if idx is None:
                idx = read_index[hira] = len(read_off) - 1
                units = hira.encode("utf-16-le")
                read_chars.extend(np.frombuffer(units, "<u2").tolist())
                read_off.append(len(read_chars))
            tok_read.append(idx)
    assert tok_start[-1] == len(tokens)

    # unk.dic: the entries of each character category, in char.bin's category order (Tokenizer::open)
    cb = (dicdir / "char.bin").read_bytes()
    ncat = struct.unpack("<I", cb[:4])[0]
    cats = [cb[4 + 32 * i:4 + 32 * (i + 1)].split(b"\0")[0].decode() for i in range(ncat)]
    assert len(cb) == 4 + 32 * ncat + 4 * 0xFFFF
    unk_tokens = unkdic["tokens"]
    unk_start, unk_attr, unk_cost = [0], [], []
    for name in cats:
        v = da_exact(unkdic["da"], name.encode())
        assert v is not None, name
        for j in range(v >> 8, (v >> 8) + (v & 0xFF)):
            tok = unk_tokens[j]
            assert tok["lc"] == tok["rc"]
            f = fugashi_fields(unkdic["features"], int(tok["feature"]), len(names))
            assert not (f[i_pron] or f[i_kana]), (name, f)   # unknown words read as their surface
            unk_attr.append(int(tok["lc"]))
            unk_cost.append(int(tok["wcost"]))
        unk_start.append(len(unk_attr))

    # char.bin: CharInfo for U+0000..U+FFFE (bit fields type:18, default_type:8, length:4, group:1, invoke:1).
    # MeCab reads U+FFFF one entry past the map, which is zero (the mmap's tail), so the runs end with 0.
    cmap = np.frombuffer(cb, "<u4", count=0xFFFF, offset=4 + 32 * ncat)
    starts = np.concatenate([[0], np.nonzero(cmap[1:] != cmap[:-1])[0] + 1, [0xFFFF]])
    runs = np.stack([starts, np.concatenate([cmap[starts[:-1]], [0]])], 1).astype(np.uint32).ravel()

    # The three offset arrays are stored as differences (each entry minus the one before), which gzip
    # to a tenth; the loader adds them back up in place (meta[6] = 1).
    def deltas(a) -> np.ndarray:
        a = np.asarray(a, np.int64)
        return np.diff(a, prepend=0).astype(np.uint32)

    meta = np.array([sysdic["lsize"], sysdic["rsize"], len(keys), len(tokens), len(read_off) - 1, ncat, 1], np.uint32)
    sections = [
        ("meta", U32, meta),
        ("keyOff", U32, deltas(key_off)),
        ("keyBytes", U8, np.frombuffer(bytes(key_bytes), np.uint8)),
        ("tokStart", U32, deltas(tok_start)),
        ("tokAttr", U16, np.array(tok_attr, np.uint16)),
        ("tokCost", I16, np.array(tok_cost, np.int16)),
        ("tokRead", U32, np.array(tok_read, np.uint32)),
        ("readOff", U32, deltas(read_off)),
        ("readChars", U16, np.array(read_chars, np.uint16)),
        ("unkStart", U32, np.array(unk_start, np.uint32)),
        ("unkAttr", U16, np.array(unk_attr, np.uint16)),
        ("unkCost", I16, np.array(unk_cost, np.int16)),
        ("charRuns", U32, runs),
    ]
    info = dict(surfaces=len(keys), entries=len(tokens), readings=len(read_off) - 1,
                no_reading=sum(1 for r in tok_read if r == NO_READING), categories=cats)
    return sections, info, (sysdic["lsize"], sysdic["rsize"])


def greedy_order(a: np.ndarray, sample: int = 256, seed: int = 0) -> np.ndarray:
    """Nearest-neighbour chain over the rows of a (L1 distance on a column sample): neighbours alike."""
    rng = np.random.default_rng(seed)
    cols = rng.choice(a.shape[1], min(sample, a.shape[1]), replace=False)
    x = a[:, cols].astype(np.float32)
    used = np.zeros(len(x), bool)
    order = [0]
    used[0] = True
    for _ in range(len(x) - 1):
        d = np.abs(x - x[order[-1]]).sum(1)
        d[used] = np.inf
        j = int(d.argmin())
        order.append(j)
        used[j] = True
    return np.array(order)


def build_matrix(dicdir: Path, lsize: int, rsize: int):
    """matrix.bin: lsize, rsize (u16), then cost[l + lsize * r] (i16) for the left node's right id l and the
    right node's left id r (connector.h). As rows r and columns l: cost[r][l]."""
    raw = (dicdir / "matrix.bin").read_bytes()
    ls, rs = struct.unpack("<2H", raw[:4])
    assert (ls, rs) == (lsize, rsize)
    m = np.frombuffer(raw, "<i2", offset=4).reshape(rs, ls)
    rows, row_inv = np.unique(m, axis=0, return_inverse=True)
    cols, col_inv = np.unique(rows, axis=1, return_inverse=True)
    t = time.time()
    ro = greedy_order(cols)
    co = greedy_order(cols[ro].T)
    print(f"  matrix {rs}x{ls} -> {cols.shape[0]}x{cols.shape[1]} distinct ({time.time() - t:.1f} s ordering)")
    u = cols[ro][:, co].astype(np.int32)
    row_pos = np.empty(len(ro), np.int64)
    row_pos[ro] = np.arange(len(ro))
    col_pos = np.empty(len(co), np.int64)
    col_pos[co] = np.arange(len(co))
    row_map = row_pos[row_inv.ravel()].astype(np.uint16)
    col_map = col_pos[col_inv.ravel()].astype(np.uint16)
    assert (u[row_map][:, col_map] == m).all()
    if u.shape[1] % 2:
        # an unused zero column: with an even width every row is 4-byte aligned, and the loader
        # adds two columns at a time
        u = np.concatenate([u, np.zeros((u.shape[0], 1), np.int32)], axis=1)
    # row i holds row i - row i-1, wrapped to int16 (the loader adds them back up the same way)
    delta = np.diff(u, axis=0, prepend=np.zeros((1, u.shape[1]), np.int32)).astype(np.int16)
    meta = np.array([u.shape[0], u.shape[1], ls, rs, 1], np.uint32)   # 1: rows stored as differences
    sections = [("meta", U32, meta), ("rowMap", U16, row_map), ("colMap", U16, col_map),
                ("cost", I16, delta.ravel())]
    return sections, dict(rows=int(u.shape[0]), cols=int(u.shape[1]))


def ranges(pred) -> np.ndarray:
    """[start, end) pairs of the code points where pred holds."""
    out, start = [], None
    for cp in range(0x110001):
        ok = cp <= 0x10FFFF and not (0xD800 <= cp <= 0xDFFF) and pred(chr(cp))
        if ok and start is None:
            start = cp
        elif not ok and start is not None:
            out += [start, cp]
            start = None
    return np.array(out, np.uint32)


def build_cutlet():
    import importlib.resources

    from misaki import data

    with importlib.resources.open_text(data, "ja_words.txt") as r:
        words = sorted({line.strip() for line in r}, key=lambda w: w.encode("utf-16-be"))
    word_off, word_chars = [0], []
    for w in words:
        word_chars.extend(np.frombuffer(w.encode("utf-16-le"), "<u2").tolist())
        word_off.append(len(word_chars))

    # NFKC = full compatibility decomposition, canonical reordering, canonical composition (UAX #15), with
    # Python's Unicode version. Hangul syllables are algorithmic and left out of the tables.
    dec_cp, dec_off, dec_chars = [], [0], []
    ccc_cp, ccc_val = [], []
    comp = []
    for cp in range(0x110000):
        if 0xD800 <= cp <= 0xDFFF:
            continue
        ch = chr(cp)
        c = unicodedata.combining(ch)
        if c:
            ccc_cp.append(cp)
            ccc_val.append(c)
        if 0xAC00 <= cp <= 0xD7A3:
            continue
        d = unicodedata.normalize("NFKD", ch)
        if d != ch:
            dec_cp.append(cp)
            dec_chars.extend(np.frombuffer(d.encode("utf-16-le"), "<u2").tolist())
            dec_off.append(len(dec_chars))
        raw = unicodedata.decomposition(ch)
        if raw and not raw.startswith("<"):
            parts = [int(x, 16) for x in raw.split()]
            # a primary composite: canonical pair that NFC composes back (not excluded, not a singleton)
            if len(parts) == 2 and unicodedata.normalize("NFC", chr(parts[0]) + chr(parts[1])) == ch:
                comp.append((parts[0], parts[1], cp))
    comp.sort()
    comp_a = np.array(comp, np.uint32)
    sections = [
        ("wordOff", U32, np.array(word_off, np.uint32)),
        ("wordChars", U16, np.array(word_chars, np.uint16)),
        ("decCp", U32, np.array(dec_cp, np.uint32)),
        ("decOff", U32, np.array(dec_off, np.uint32)),
        ("decChars", U16, np.array(dec_chars, np.uint16)),
        ("cccCp", U32, np.array(ccc_cp, np.uint32)),
        ("cccVal", U8, np.array(ccc_val, np.uint8)),
        ("compPairs", U32, comp_a.ravel()),
        ("ndRanges", U32, ranges(lambda c: unicodedata.category(c) == "Nd")),   # regex \d
        ("digitRanges", U32, ranges(lambda c: c.isdigit())),                   # str.isdigit
    ]
    return sections, dict(words=len(words), max_word_len=max(len(w) for w in words), unicode=unicodedata.unidata_version)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()

    import fugashi
    import unidic_lite

    dicdir = Path(unidic_lite.DICDIR)
    used = fugashi.Tagger().dictionary_info[0]["filename"]
    if Path(used).resolve() != (dicdir / "sys.dic").resolve():
        sys.exit(f"fugashi uses {used}, not unidic-lite's {dicdir}")
    out = args.out / "ja"

    print("lexicon")
    lex, lex_info, (lsize, rsize) = build_lexicon(dicdir)
    write_container(out / "unidic-lex.bin", lex)
    print("matrix")
    mat, mat_info = build_matrix(dicdir, lsize, rsize)
    write_container(out / "unidic-matrix.bin", mat)
    print("cutlet")
    cut, cut_info = build_cutlet()
    write_container(out / "cutlet.bin", cut)

    from importlib.metadata import version
    sources = {
        "unidic-lite": version("unidic-lite") + f" (UniDic {unidic_lite.VERSION})",
        "fugashi": version("fugashi"),
        "misaki": version("misaki"),
        "jaconv": version("jaconv"),
        "python-unicode": unicodedata.unidata_version,
    }
    (out / "manifest.json").write_text(json.dumps({"sources": sources}, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"lexicon": lex_info, "matrix": mat_info, "cutlet": cut_info}, ensure_ascii=False))

    import gzip
    for name in ["unidic-lex.bin", "unidic-matrix.bin", "cutlet.bin"]:
        b = (out / name).read_bytes()
        print(f"  ja/{name}: {len(b) / 1e6:.2f} MB, gzip {len(gzip.compress(b, 9, mtime=0)) / 1e6:.2f} MB")
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
