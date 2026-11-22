// End to end: KittenTTS2Tiny against the Python package (tests/fixtures/kitten-tts-2-tiny-synth.json,
// from tools/kitten-tts-2-tiny/synth_fixtures.py): same phoneme chunks, same tokens, same
// durations from the speech graph, same audio length. The graphs add random noise in the
// vocoder, so samples are not compared. A duration that sits on x.5 before rounding can
// land on either side in another ONNX Runtime build (5.50024 in Python's, just under 5.5
// in onnxruntime-web), so one or two tokens may be one frame (600 samples) off.
//
// Needs local files, no network:
//   KITTEN_TTS_2_TINY_DATA    the text data folder (en/..., espeak-ng-data/...)
//   KITTEN_TTS_2_TINY_MODELS  a folder holding kitten-tts-2-nano/, -pico/, -mini/ laid out like
//                             the Hugging Face repositories (default: the Hugging Face cache)

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DATA = process.env.KITTEN_TTS_2_TINY_DATA;
const FIXTURE = path.join(__dirname, 'fixtures', 'kitten-tts-2-tiny-synth.json');

function modelDir(name) {
  if (process.env.KITTEN_TTS_2_TINY_MODELS) return path.join(process.env.KITTEN_TTS_2_TINY_MODELS, name);
  const snaps = path.join(os.homedir(), '.cache', 'huggingface', 'hub', `models--KittenML--${name}`, 'snapshots');
  if (!fs.existsSync(snaps)) return null;
  const revs = fs.readdirSync(snaps);
  return revs.length ? path.join(snaps, revs[0]) : null;
}

/** A store over local folders: key "<folder>/<file>" -> roots[folder]/<file>. */
function dirStore(roots) {
  const local = key => {
    const [top, ...rest] = key.split('/');
    if (!roots[top]) throw new Error(`no local folder for ${key}`);
    return path.join(roots[top], ...rest);
  };
  return {
    async ensure(files) {
      const missing = files.filter(f => !fs.existsSync(local(f.key))).map(f => f.key);
      if (missing.length) throw new Error(`missing local files: ${missing.join(', ')}`);
    },
    async has(key) { return fs.existsSync(local(key)); },
    async text(key) { return fs.readFileSync(local(key), 'utf8'); },
    async bytes(key) { return new Uint8Array(fs.readFileSync(local(key))); },
    async clear() {},
  };
}

const { cases } = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

for (const c of cases) {
  const name = `${c.model} ${c.weights} ${c.language}: ${c.text.slice(0, 40)}`;
  const dir = modelDir(c.model);
  const espeakNeeded = c.language !== 'en';
  const skip = !DATA ? 'set KITTEN_TTS_2_TINY_DATA'
    : !dir ? `no local ${c.model}`
      : espeakNeeded && !fs.existsSync(path.join(DATA, 'espeak-ng-data', 'phontab')) ? 'no espeak-ng-data in KITTEN_TTS_2_TINY_DATA'
        : false;
  test(name, { skip }, async () => {
    const ort = require('onnxruntime-web');
    const { KittenTTS2Tiny } = require('../lib/tiny/KittenTTS2Tiny');
    const store = dirStore({ [c.model]: dir, 'kitten-tts-2-text-v1': DATA });
    const tts = await KittenTTS2Tiny.create({
      model: c.model, weights: c.weights, languages: [c.language], platform: { ort, store },
    });
    try {
      assert.deepEqual(tts.resolveVoice(c.voice ?? undefined, c.language), c.resolved);
      const chunks = await tts.phonemize(c.text, c.language);
      assert.deepEqual(chunks, c.chunks);
      const [lang, key] = c.resolved;
      const pack = (await tts.pack(lang))[key];
      const file = require('../lib/tiny/TinyRepo').modelFiles(tts.config.languages[lang])[c.weights];
      let frameDrift = 0;
      for (let i = 0; i < chunks.length; i++) {
        const { tokenize } = require('../lib/tiny/TinySynth');
        assert.deepEqual(tokenize(chunks[i], tts.vocab), c.runs[i].tokens);
        const raw = await tts.synth.run(file, pack, chunks[i], 1.0);
        const want = c.runs[i].durations;
        assert.equal(raw.durations.length, want.length);
        const off = raw.durations.map((d, k) => d - want[k]).filter(d => d !== 0);
        assert.ok(off.length <= 2 && off.every(d => Math.abs(d) === 1), `chunk ${i} durations off: ${off}`);
        const drift = off.reduce((a, b) => a + b, 0);
        assert.equal(raw.waveform.length, c.runs[i].samples + 600 * drift, `chunk ${i} samples`);
        frameDrift += Math.abs(drift);
      }
      const result = await tts.generate(c.text, { voice: c.voice ?? undefined, language: c.language });
      assert.ok(Math.abs(result.samples.length - c.audioSamples) <= 600 * frameDrift,
        `${result.samples.length} vs ${c.audioSamples} samples`);
      assert.ok(result.samples.some(v => Math.abs(v) > 0.05), 'audible audio');
    } finally {
      await tts.dispose();
    }
  });
}
