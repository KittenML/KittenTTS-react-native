// The TypeScript English front end against the Python package's output
// (tests/fixtures/kitten-tts-2-tiny-english.json, from tools/kitten-tts-2-tiny/english_fixtures.py).
//
// It needs the text pack and the g2p/ folder in one directory:
//   KITTEN_TTS_2_TINY_DATA=/path/with/en-and-g2p npm test
// and skips without it. KITTEN_TTS_2_TINY_ENGLISH_FIXTURE points at another fixture file.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DATA = process.env.KITTEN_TTS_2_TINY_DATA;
const FIXTURE = process.env.KITTEN_TTS_2_TINY_ENGLISH_FIXTURE
  || path.join(__dirname, 'fixtures', 'kitten-tts-2-tiny-english.json');

function reader(dir) {
  return {
    text: async name => fs.readFileSync(path.join(dir, name), 'utf8'),
    bytes: async name => new Uint8Array(fs.readFileSync(path.join(dir, name))),
  };
}

async function loadFrontend() {
  const ort = require('onnxruntime-web');
  const { loadEnglishG2P } = require('../lib/tiny/frontend/english/load');
  const vocab = JSON.parse(fs.readFileSync(path.join(DATA, 'vocab-nano.json'), 'utf8'));
  const v1 = new Set(Object.keys(vocab).filter(k => k !== 'ʉ'));
  return loadEnglishG2P(reader(DATA), ort, v1);
}

test('English front end matches the Python package', { skip: !DATA && 'set KITTEN_TTS_2_TINY_DATA' }, async () => {
  const { cases } = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  const g2p = await loadFrontend();
  const { normalize } = require('../lib/tiny/frontend/english/TtsNorm');
  const misaki = g2p.misaki;
  const tokenizer = misaki.tokenizer;
  const tagger = misaki.tagger;
  const bad = { normalized: [], tokens: [], tags: [], misaki: [], phonemes: [] };
  for (const c of cases) {
    const norm = normalize(c.text);
    if (norm !== c.normalized) bad.normalized.push({ text: c.text, want: c.normalized, got: norm });
    const doc = tokenizer.tokenize(c.normalized);
    const toks = doc.map(t => [t.text, t.spacy]);
    const want = c.tokens.map(t => [t[0], t[1]]);
    if (JSON.stringify(toks) !== JSON.stringify(want)) {
      bad.tokens.push({ text: c.normalized, want, got: toks });
      continue;
    }
    const tags = await tagger.tag(doc);
    const wantTags = c.tokens.map(t => t[2]);
    if (JSON.stringify(tags) !== JSON.stringify(wantTags)) bad.tags.push({ text: c.normalized, want: wantTags, got: tags });
    const raw = (await misaki.phonemize(c.normalized)).phonemes;
    if (raw !== c.misaki) bad.misaki.push({ text: c.normalized, want: c.misaki, got: raw });
    const res = await g2p.phonemize(c.text);
    if (res.phonemes !== c.phonemes) bad.phonemes.push({ text: c.text, want: c.phonemes, got: res.phonemes });
  }
  const summary = Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, v.length]));
  if (process.env.KITTEN_TTS_2_TINY_REPORT) {
    fs.writeFileSync(process.env.KITTEN_TTS_2_TINY_REPORT, JSON.stringify({ summary, bad }, null, 1));
  }
  assert.deepEqual(summary, { normalized: 0, tokens: 0, tags: 0, misaki: 0, phonemes: 0 },
    JSON.stringify(Object.fromEntries(Object.entries(bad).map(([k, v]) => [k, v.slice(0, 3)])), null, 1));
});
