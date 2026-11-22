#!/usr/bin/env python
"""Export the English text front end of the KittenTTS 2 nano / pico / mini models for the RN SDK.

The Python package phonemizes English with misaki, which tags words with spaCy's
en_core_web_sm before looking them up. The SDK reimplements both in TypeScript, so
this writes the data they read, taken from the same package versions Python uses:

    en/misaki-us-gold.json      misaki's lexicons, unchanged
    en/misaki-us-silver.json
    en/spacy-tokenizer.json     the tokenizer's regexes (rewritten for JavaScript) and
                                special cases
    en/spacy-tagger.json        the tagger's feature columns, hash seeds, tags and norm
                                tables
    en/spacy-tagger.onnx        the tagger's network (tok2vec + softmax) as ONNX, float16
                                weights
    en/cmu_misaki_us.json       CMUdict in misaki's alphabet, from the model repositories'
                                g2p/ folder (kept here so it can be downloaded gzipped)
    en/manifest.json            the package versions, for build_text_pack.py (which removes it)

build_text_pack.py runs this; on its own:

    python -I tools/kitten-tts-2-tiny/export_english.py OUT_DIR
"""
from __future__ import annotations

import importlib.resources
import json
import re
import shutil
import sys
from importlib.metadata import version
from pathlib import Path

import numpy as np
import spacy

SPACY_MODEL = "en_core_web_sm"
# Characters JavaScript's `u` regex mode lets you escape outside a class (`-` too
# inside one). Python allows escaping anything; any other escape must lose its backslash.
JS_SYNTAX = set("^$\\.*+?()[]{}|/")


def js_regex(pattern: str) -> dict:
    """A Python `re` pattern as a JavaScript one for the `u` flag: {source, flags}.

    Rewrites \\UXXXXXXXX escapes, the Unicode meaning of \\d and \\w, and identity escapes
    the `u` flag rejects. The result is checked against Python in tests, not trusted."""
    flags = "u"
    m = re.match(r"^\(\?([aiLmsux]+)\)", pattern)
    if m:
        pattern = pattern[m.end():]
        if "i" in m.group(1):
            flags += "i"
    out, i, in_class = [], 0, False
    while i < len(pattern):
        c = pattern[i]
        if c == "\\":
            n = pattern[i + 1]
            if n == "U":
                out.append("\\u{%X}" % int(pattern[i + 2:i + 10], 16))
                i += 10
                continue
            if n == "u":
                out.append(pattern[i:i + 6])
                i += 6
                continue
            if n == "x":
                out.append(pattern[i:i + 4])
                i += 4
                continue
            if n == "d":
                out.append("\\p{Nd}")
            elif n == "D":
                out.append("\\P{Nd}")
            elif n == "w":
                out.append("\\p{L}\\p{N}_" if in_class else "[\\p{L}\\p{N}_]")
            elif n == "W":
                if in_class:
                    raise ValueError("\\W inside a class")
                out.append("[^\\p{L}\\p{N}_]")
            elif n in "sSbBnrtfv0123456789" or n in JS_SYNTAX or (n == "-" and in_class):
                out.append(c + n)
            else:
                out.append(n)          # identity escape: drop the backslash
            i += 2
            continue
        if c == "[" and not in_class:
            in_class = True
            out.append(c)
            if pattern[i + 1:i + 2] == "^":
                out.append("^")
                i += 1
            if pattern[i + 1:i + 2] == "]":     # a leading ] is a literal in Python
                out.append("\\]")
                i += 1
        elif c == "[" and in_class:
            out.append("\\[")                # a literal [ inside a class
        elif c == "]" and in_class:
            in_class = False
            out.append(c)
        else:
            out.append(c)
        i += 1
    return {"source": "".join(out), "flags": flags}


def export_tokenizer(nlp) -> dict:
    t = nlp.tokenizer
    specials = {}
    matcher = []
    for string, substrings in sorted(t.rules.items()):
        specials[string] = [[s[65] if 65 in s else s["ORTH"], s.get(67, s.get("NORM"))] for s in substrings]
        # tokenizer.pyx add_special_case: with faster_heuristics, only these reach the
        # PhraseMatcher pass that runs after affix splitting.
        if (not t.faster_heuristics or t.find_prefix(string) or t.find_infix(string)
                or t.find_suffix(string) or " " in string):
            matcher.append(string)
    return {
        "spacy": spacy.__version__,
        "model": f"{SPACY_MODEL}-{nlp.meta['version']}",
        "prefix": js_regex(t.prefix_search.__self__.pattern),
        "suffix": js_regex(t.suffix_search.__self__.pattern),
        "infix": js_regex(t.infix_finditer.__self__.pattern),
        "url": js_regex(t.url_match.__self__.pattern) if t.url_match else None,
        "tokenMatch": js_regex(t.token_match.__self__.pattern) if t.token_match else None,
        "specials": specials,
        "matcher": matcher,
    }


def tagger_onnx(embeds, maxouts, norms, softmax):
    """tok2vec (MultiHashEmbed + MaxoutWindowEncoder) and the softmax tagger as an ONNX graph.

    Input `rows` int64 [T, 6, 4]: for each token and feature column, the four embedding
    rows HashEmbed picks (already offset into the concatenated table). Outputs `tags`
    int64 [T] (argmax) and `tensor` float32 [T, 96] (doc.tensor, for checks)."""
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    nodes, inits = [], []

    def const(name, arr):
        inits.append(numpy_helper.from_array(np.ascontiguousarray(arr), name))
        return name

    def node(op, inputs, outputs, **kw):
        nodes.append(helper.make_node(op, inputs, outputs, **kw))
        return outputs[0]

    width = int(maxouts[0].get_param("b").shape[0])
    pieces = int(maxouts[0].get_param("b").shape[1])
    E = np.concatenate([e.get_param("E") for e in embeds]).astype(np.float32)
    const("E", E)
    x = node("Gather", ["E", "rows"], ["gathered"], axis=0)                    # [T, 6, 4, W]
    x = node("ReduceSum", [x, const("axis2", np.array([2], np.int64))], ["summed"], keepdims=0)
    x = node("Reshape", [x, const("flat_shape", np.array([0, -1], np.int64))], ["concat"])

    def maxout_norm(i, x, mx, ln):
        W = mx.get_param("W").astype(np.float32)                              # [nO, nP, nI]
        nI = W.shape[2]
        Wt = W.reshape(width * pieces, nI).T.copy()                            # [nI, nO*nP]
        y = node("MatMul", [x, const(f"W{i}", Wt)], [f"mm{i}"])
        y = node("Add", [y, const(f"b{i}", mx.get_param("b").astype(np.float32).reshape(-1))], [f"lin{i}"])
        y = node("Reshape", [y, const(f"pieces{i}", np.array([0, width, pieces], np.int64))], [f"rs{i}"])
        y = node("ReduceMax", [y], [f"max{i}"], axes=[2], keepdims=0)          # axes attribute: opset 17
        # thinc LayerNorm: (x - mean) * (var + 1e-8) ** -0.5 * G + b, population variance.
        return node("LayerNormalization", [y, const(f"G{i}", ln.get_param("G").astype(np.float32)),
                                           const(f"Gb{i}", ln.get_param("b").astype(np.float32))],
                    [f"ln{i}"], axis=-1, epsilon=1e-8)

    x = maxout_norm(0, x, maxouts[0], norms[0])
    # MaxoutWindowEncoder wraps its blocks in with_array(pad=receptive field = 4): the doc
    # gets 4 zero rows on each side, which stop being zero after the first block and
    # reach the edge tokens through the windows. Cut back to the doc at the end.
    x = node("Pad", [x, const("encpad", np.array([4, 0, 4, 0], np.int64))], ["encoder_in"])
    for i in range(1, 5):
        # expand_window(1) = seq2col: [x[t-1], x[t], x[t+1]] with zeros past the ends.
        p = node("Pad", [x, const(f"pads{i}", np.array([1, 0, 1, 0], np.int64))], [f"pad{i}"])
        T = node("Shape", [x], [f"shape{i}"], start=0, end=1)
        T1 = node("Add", [T, const(f"one{i}", np.array([1], np.int64))], [f"t1_{i}"])
        T2 = node("Add", [T, const(f"two{i}", np.array([2], np.int64))], [f"t2_{i}"])
        zero, one, two = (const(f"{n}{i}", np.array([v], np.int64)) for n, v in (("z", 0), ("o", 1), ("w", 2)))
        prev = node("Slice", [p, zero, T], [f"prev{i}"])
        cur = node("Slice", [p, one, T1], [f"cur{i}"])
        nxt = node("Slice", [p, two, T2], [f"next{i}"])
        win = node("Concat", [prev, cur, nxt], [f"win{i}"], axis=1)
        y = maxout_norm(i, win, maxouts[i], norms[i])
        x = node("Add", [x, y], [f"res{i}"])
    node("Slice", [x, const("cut_start", np.array([4], np.int64)), const("cut_end", np.array([-4], np.int64))],
         ["tensor"])
    W = softmax.get_param("W").astype(np.float32)                              # [nTags, W]
    logits = node("MatMul", ["tensor", const("Ws", W.T.copy())], ["logits0"])
    logits = node("Add", [logits, const("bs", softmax.get_param("b").astype(np.float32))], ["logits"])
    node("ArgMax", [logits], ["tags"], axis=1, keepdims=0)
    graph = helper.make_graph(
        nodes, "spacy_tagger",
        [helper.make_tensor_value_info("rows", TensorProto.INT64, ["T", len(embeds), 4])],
        [helper.make_tensor_value_info("tags", TensorProto.INT64, ["T"]),
         helper.make_tensor_value_info("tensor", TensorProto.FLOAT, ["T", width])],
        inits)
    model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 17)], producer_name="kittentts")
    model.ir_version = 8
    to_float16(model)
    onnx.checker.check_model(model)
    return model


def to_float16(model) -> None:
    """Store the large float32 weights as float16, cast back to float32 where they are used.

    Halves the download (6.3 -> 3.1 MB); the arithmetic stays float32. Checked against
    spaCy: the same tag on all 71,735 words of the parity corpus."""
    from onnx import TensorProto, helper, numpy_helper
    inits, casts = [], []
    for init in model.graph.initializer:
        arr = numpy_helper.to_array(init)
        if arr.dtype == np.float32 and arr.size > 256:
            inits.append(numpy_helper.from_array(arr.astype(np.float16), init.name + "_f16"))
            casts.append(helper.make_node("Cast", [init.name + "_f16"], [init.name], to=TensorProto.FLOAT))
        else:
            inits.append(init)
    del model.graph.initializer[:]
    model.graph.initializer.extend(inits)
    nodes = list(model.graph.node)
    del model.graph.node[:]
    model.graph.node.extend(casts + nodes)


def export_tagger(nlp, out: Path) -> dict:
    import onnx
    tok2vec = nlp.get_pipe("tok2vec").model
    tagger = nlp.get_pipe("tagger").model
    columns = tok2vec.layers[0].layers[0].attrs["columns"]
    embeds = [n for n in tok2vec.walk() if n.name == "hashembed"]
    assert [e.attrs["column"] for e in embeds] == list(range(len(columns)))
    embed_cfg, offset = [], 0
    for e in embeds:
        rows = int(e.get_param("E").shape[0])
        embed_cfg.append({"attr": columns[e.attrs["column"]], "rows": rows, "offset": offset,
                          "seed": int(e.attrs["seed"])})
        offset += rows
    maxouts = [n for n in tok2vec.walk() if n.name == "maxout"]
    norms = [n for n in tok2vec.walk() if n.name == "layernorm"]
    windows = [n for n in tok2vec.walk() if n.name == "expand_window"]
    assert len(maxouts) == len(norms) == 5 and len(windows) == 4 and all(
        w.attrs["window_size"] == 1 for w in windows)
    softmax = [n for n in tagger.walk() if n.name == "softmax"][0]
    onnx.save(tagger_onnx(embeds, maxouts, norms, softmax), str(out / "spacy-tagger.onnx"))

    # Lexeme norms: spaCy checks the lexeme_norm table (keyed by the string's hash),
    # then a small base table, then lowercases (lex_attrs._get_attr_unless_lookup).
    from spacy.attrs import NORM
    getter = nlp.vocab.lex_attr_getters[NORM]
    (table,) = getter.args[1]                 # util._get_attr_unless_lookup(default, lookups, s)
    (base_norms,) = getter.args[0].args[1]
    lexeme_norm = {str(k): v for k, v in table.items()}
    assert getter.args[0].args[0]("ÀB") == "àb"   # the last fallback is str.lower
    return {
        "spacy": spacy.__version__,
        "model": f"{SPACY_MODEL}-{nlp.meta['version']}",
        "embed": embed_cfg,
        "tags": list(nlp.get_pipe("tagger").labels),
        "lexemeNorm": lexeme_norm,
        "baseNorms": base_norms,
        # StringStore ids: "" is 0 and spaCy's reserved symbols (attribute names, POS
        # tags, "X", ...) have small fixed ids; every other string is its hash.
        "symbols": {k: int(v) for k, v in spacy.symbols.IDS.items() if k},
    }


def main() -> None:
    out = Path(sys.argv[1]) / "en"
    out.mkdir(parents=True, exist_ok=True)
    nlp = spacy.load(SPACY_MODEL, enable=["tok2vec", "tagger"])
    (out / "spacy-tokenizer.json").write_text(
        json.dumps(export_tokenizer(nlp), ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    meta = export_tagger(nlp, out)
    (out / "spacy-tagger.json").write_text(
        json.dumps(meta, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    # CMUdict as the Python package reads it, from the model repository's g2p/ folder
    # (the same file in all three repositories).
    from huggingface_hub import hf_hub_download
    shutil.copyfile(hf_hub_download("KittenML/kitten-tts-2-nano", "g2p/cmu_misaki_us.json"),
                    out / "cmu_misaki_us.json")
    from misaki import data as misaki_data
    for name in ("us_gold.json", "us_silver.json"):
        with importlib.resources.as_file(importlib.resources.files(misaki_data) / name) as src:
            shutil.copyfile(src, out / f"misaki-{name.replace('_', '-')}")
    manifest = {
        "misaki": version("misaki"),
        "spacy": spacy.__version__,
        "spacyModel": f"{SPACY_MODEL}-{nlp.meta['version']}",
    }
    print(json.dumps(manifest, indent=1))
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
