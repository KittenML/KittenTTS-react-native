// End to end: KittenTTS2Tiny against the Python package (tests/fixtures/kitten-tts-2-tiny-synth.json,
// from tools/kitten-tts-2-tiny/synth_fixtures.py): same phoneme chunks, same tokens, same
// durations from the speech graph, same audio length. The graphs add random noise in the
// vocoder, so samples are not compared. A duration that sits on x.5 before rounding can
// land on either side in another ONNX Runtime build (5.50024 in Python's, just under 5.5
// in onnxruntime-web), so one or two tokens may be one frame (600 samples) off.
//
// It reaches into private members (tts.config, tts.vocab, tts.pack, tts.synth) on purpose, to
// compare each chunk's tokens and graph run with Python's.
//
// Needs local files, no network: KITTEN_TTS_2_TINY_DATA and the model repositories (see
// tests/helpers/tiny-data.js). They are read through modelDirectory and textDataDirectory,
// so this also covers loading from local folders and gzipped text data.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = require('./helpers/tiny-data');
const { KittenTTS2Tiny } = require('../lib/tiny/KittenTTS2Tiny');
const { modelFiles } = require('../lib/tiny/TinyRepo');
const { tokenize } = require('../lib/tiny/TinySynth');

const FIXTURE = path.join(__dirname, 'fixtures', 'kitten-tts-2-tiny-synth.json');

const { cases } = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));

/** false when the case's files are here, else why it skips. */
function skipReason(c, dir) {
  const noText = data.textDataSkip('manifest.json');
  if (noText) return noText;
  if (!dir) return `no local ${c.model} (KITTEN_TTS_2_TINY_MODEL_DIR or the Hugging Face cache)`;
  const configPath = path.join(dir, 'config.json');
  if (!fs.existsSync(configPath)) return `config.json missing in ${dir}`;
  const entry = JSON.parse(fs.readFileSync(configPath, 'utf8')).languages[c.resolved[0]];
  if (!entry) return false; // the test fails with the SDK's error
  const missing = ['vocab.json', modelFiles(entry)[c.weights], entry.voices]
    .find(file => file && !fs.existsSync(path.join(dir, file)));
  return missing ? `${missing} missing in ${dir}` : false;
}

for (const c of cases) {
  const name = `${c.model} ${c.weights} ${c.language}: ${c.text.slice(0, 40)}`;
  const dir = data.modelDir(c.model);
  const skip = skipReason(c, dir);
  test(name, { skip }, async () => {
    const tts = await KittenTTS2Tiny.create({
      model: c.model, weights: c.weights, languages: [c.language], platform: await data.nodePlatform(),
      modelDirectory: dir, textDataDirectory: data.textDir,
    });
    try {
      assert.deepEqual(tts.resolveVoice(c.voice ?? undefined, c.language), c.resolved);
      const chunks = await tts.phonemize(c.text, c.language);
      assert.deepEqual(chunks, c.chunks);
      const [lang, key] = c.resolved;
      const pack = (await tts.pack(lang))[key];
      const file = require('../lib/tiny/TinyRepo').modelFiles(tts.config.languages[lang])[c.weights];
      const vocab = JSON.parse(fs.readFileSync(path.join(dir, 'vocab.json'), 'utf8'));
      let frameDrift = 0;
      for (let i = 0; i < chunks.length; i++) {
        assert.deepEqual(tokenize(chunks[i], vocab), c.runs[i].tokens);
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
      // Word timings: in order, inside the audio, the words of the text.
      const timings = result.wordTimings;
      assert.ok(timings.length > 0, 'word timings');
      const words = c.text.split(/\s+/).filter(Boolean);
      timings.forEach((t, k) => {
        assert.equal(t.word, words[t.wordIndex]);
        assert.ok(t.startTime <= t.endTime && t.endTime <= result.duration + 1e-6, JSON.stringify(t));
        if (k) assert.ok(t.startTime >= timings[k - 1].startTime, JSON.stringify([timings[k - 1], t]));
      });
    } finally {
      await tts.dispose();
    }
  });
}
