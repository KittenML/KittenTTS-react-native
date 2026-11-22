// Parity of src/tiny/frontend/japanese/ (Kitten TTS 2 mini, Japanese) with the Python kittenml front end:
// phonemize_v2.phonemize_lang(get_g2p('ja'), text, 'ja') = misaki cutlet + fugashi/MeCab + unidic-lite
// (tests/fixtures/kitten-tts-2-tiny-japanese.json, written by tools/kitten-tts-2-tiny/japanese_fixtures.py).
//
// Needs KITTEN_TTS_2_TINY_DATA (its ja/ folder; tests/helpers/tiny-data.js). The tests skip without it.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const data = require('./helpers/tiny-data');

const fixtures = require('./fixtures/kitten-tts-2-tiny-japanese.json');

const lib = path.join(__dirname, '..', 'lib', 'tiny', 'frontend', 'japanese');
const skip = !fs.existsSync(path.join(lib, 'JapaneseG2P.js'))
  ? 'lib/ missing: npm run build:test'
  : data.textDataSkip('ja/unidic-lex.bin', 'ja/unidic-matrix.bin', 'ja/cutlet.bin');

const ja = skip ? null : require(path.join(lib, 'JapaneseG2P'));

function readFiles() {
  return Object.fromEntries(ja.JAPANESE_DATA_FILES.map(f => [f, data.readBytes(data.textDir, f)]));
}

function allCases() {
  const generated = fixtures.generated.map(g => ({ ...g, text: g.parts.map(([p, n]) => p.repeat(n)).join('') }));
  return [...fixtures.cases.hard, ...fixtures.cases.wiki, ...fixtures.cases.paragraphs, ...generated];
}

function compare(g2p, cases) {
  const mismatches = [];
  for (const c of cases) {
    let got;
    let err = null;
    try {
      got = g2p.phonemize(c.text);
    } catch (e) {
      err = e;
    }
    if (c.error) {
      if (!err) mismatches.push({ text: c.text, got, want: `${c.error} raised` });
      else if (!String(err.message).startsWith(c.error)) mismatches.push({ text: c.text, got: err.message, want: c.error });
    } else if (err) {
      mismatches.push({ text: c.text, got: `threw ${err.message}`, want: c.phonemes });
    } else if (c.phonemes_sha256) {
      const sha = crypto.createHash('sha256').update(got, 'utf8').digest('hex');
      if (sha !== c.phonemes_sha256) mismatches.push({ text: c.text, got, want: `${c.phonemes_len} chars, sha256 ${c.phonemes_sha256}` });
    } else if (got !== c.phonemes) {
      mismatches.push({ text: c.text, got, want: c.phonemes });
    }
  }
  return mismatches;
}

function short(s) {
  return s.length > 200 ? `${JSON.stringify(s.slice(0, 80))} ... (${s.length} chars)` : JSON.stringify(s);
}

function report(mismatches) {
  return mismatches
    .slice(0, 15)
    .map(m => `${short(m.text)}\n   got  ${JSON.stringify(m.got)}\n   want ${JSON.stringify(m.want)}`)
    .join('\n');
}

test('NFKC matches Python unicodedata', { skip }, () => {
  const { Container } = require(path.join(lib, 'container'));
  const { PyUnicode } = require(path.join(lib, 'unicode'));
  const files = readFiles();
  const uni = new PyUnicode(new Container(files['ja/cutlet.bin'], 'ja/cutlet.bin'));
  const bad = fixtures.nfkc.filter(([s, want]) => uni.nfkc(s) !== want);
  assert.equal(bad.length, 0, bad.slice(0, 5).map(([s, w]) => `${JSON.stringify(s)}: ${JSON.stringify(uni.nfkc(s))} != ${JSON.stringify(w)}`).join('\n'));
});

test('cutlet normalisation and MeCab tokens match fugashi', { skip }, () => {
  const { Container } = require(path.join(lib, 'container'));
  const { PyUnicode } = require(path.join(lib, 'unicode'));
  const { Mecab } = require(path.join(lib, 'mecab'));
  const { Cutlet, kata2hira } = require(path.join(lib, 'cutlet'));
  const files = readFiles();
  const data = new Container(files['ja/cutlet.bin'], 'ja/cutlet.bin');
  const mecab = new Mecab(new Container(files['ja/unidic-lex.bin'], 'lex'), new Container(files['ja/unidic-matrix.bin'], 'matrix'));
  const cutlet = new Cutlet(mecab, new PyUnicode(data), data);
  const bad = [];
  for (const c of fixtures.tokens) {
    const norm = c.text ? cutlet.normalizeText(c.text) : '';
    if (norm !== c.normalized) {
      bad.push(`${JSON.stringify(c.text)} normalised to ${JSON.stringify(norm)}, want ${JSON.stringify(c.normalized)}`);
      continue;
    }
    const got = mecab.parse(c.normalized).map(w => [w.surface, kata2hira(w.reading || w.surface), w.charType === 7 || !w.isUnk ? 6 : w.charType]);
    if (JSON.stringify(got) !== JSON.stringify(c.tokens)) {
      bad.push(`${JSON.stringify(c.text)}\n   got  ${JSON.stringify(got)}\n   want ${JSON.stringify(c.tokens)}`);
    }
  }
  assert.equal(bad.length, 0, `${bad.length}/${fixtures.tokens.length}\n${bad.slice(0, 8).join('\n')}`);
});

test('Japanese G2P matches Python for every fixture text', { skip }, async () => {
  const g2p = await ja.JapaneseG2P.create(readFiles());
  const cases = allCases();
  const mismatches = compare(g2p, cases);
  assert.equal(mismatches.length, 0, `${mismatches.length}/${cases.length} mismatches\n${report(mismatches)}`);
});

test('the same bytes load twice (the matrix is decoded in place once); dispose', { skip }, async () => {
  const files = readFiles();
  const first = await ja.JapaneseG2P.create(files);
  const second = await ja.JapaneseG2P.create(files);
  const cases = fixtures.cases.wiki.slice(0, 50);
  assert.equal(compare(second, cases).length, 0);
  assert.equal(compare(first, cases).length, 0);
  second.dispose();
  assert.throws(() => second.phonemize('テスト'), /disposed/);
  // misaligned bytes (copied sections) give the same results
  const shifted = {};
  for (const [k, v] of Object.entries(readFiles())) {
    const buf = new Uint8Array(v.length + 1);
    buf.set(v, 1);
    shifted[k] = buf.subarray(1);
  }
  const third = await ja.JapaneseG2P.create(shifted);
  assert.equal(compare(third, cases).length, 0);
  await assert.rejects(ja.JapaneseG2P.create({}), /missing ja\/unidic-lex.bin/);
});

test('lone surrogates raise UnicodeEncodeError, as fugashi does (not storable in the UTF-8 fixture)', { skip }, async () => {
  const g2p = await ja.JapaneseG2P.create(readFiles());
  assert.throws(() => g2p.phonemize('a\ud800b'), /^Error: UnicodeEncodeError/);
  assert.throws(() => g2p.phonemize('猫\udc00'), /^Error: UnicodeEncodeError/);
});
