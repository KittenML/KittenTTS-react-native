// Runs against the real Kitten API: `KITTENML_API_KEY=... npm run test:live`.
// Skipped without a key. Each speech request is billed, so the texts are short.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');

const { KittenTTS2Base } = require('../../lib/api/KittenTTS2Base');

const apiKey = process.env.KITTENML_API_KEY;
const live = { skip: apiKey ? false : 'KITTENML_API_KEY is not set' };

class NodeKittenTTS2 extends KittenTTS2Base {
  static async create(options) {
    const platform = {
      audioOutput: { play: async () => {}, stop: async () => {} },
      readFile: async path => new Uint8Array(await readFile(path)),
    };
    return new NodeKittenTTS2(await KittenTTS2Base.connect(options, platform));
  }
}

function peak(samples) {
  let max = 0;
  for (const value of samples) max = Math.max(max, Math.abs(value));
  return max;
}

let tts;
async function client() {
  tts ??= await NodeKittenTTS2.create({ model: 'kitten-tts-2', apiKey, baseUrl: process.env.KITTENML_API_BASE_URL });
  return tts;
}

test('lists the built-in voices', live, async () => {
  const kitten = await client();
  const builtIn = kitten.voices.filter(voice => voice.type === 'public');
  assert.ok(builtIn.length > 100, `${builtIn.length} built-in voices`);
  assert.ok(kitten.availableVoices.includes('bella_en'));
  assert.ok(builtIn.every(voice => voice.id && voice.name && voice.language));
});

let reference;
test('generate() returns complete speech', live, async () => {
  const kitten = await client();
  const result = await kitten.generate('The harbor lights came on one by one.', 'bella_en');
  assert.ok(result.duration > 1 && result.duration < 10, `${result.duration} s`);
  assert.ok(peak(result.samples) > 0.05, 'not silent');
  assert.equal(result.voice, 'bella_en');
  reference = result.wavData();
});

test('presets and decoding controls are accepted', live, async () => {
  const kitten = await client();
  const result = await kitten.generate('[joyful] We shipped it!', {
    voice: 'maeve_en', preset: 'stable', temperature: 0.8, topK: 40, normalize: 'no', speed: 1.1,
  });
  assert.ok(result.duration > 0.5);
});

test('generateStreaming() yields playable chunks as they arrive', live, async () => {
  const kitten = await client();
  const chunks = [];
  for await (const chunk of kitten.generateStreaming(
    'The first sentence can play early. Meanwhile the second one is still on its way.',
    'bella_en',
  )) {
    chunks.push(chunk);
  }
  const seconds = chunks.reduce((sum, chunk) => sum + chunk.duration, 0);
  assert.ok(chunks.length >= 2, `${chunks.length} chunks`);
  assert.ok(seconds > 2, `${seconds} s`);
});

test('a reference recording clones the voice', live, async () => {
  assert.ok(reference, 'needs the generate() test');
  const kitten = await client();
  const result = await kitten.generate('This sentence uses the uploaded voice.', {
    reference,
    referenceText: 'The harbor lights came on one by one.',
  });
  assert.ok(result.duration > 1);
  assert.ok(peak(result.samples) > 0.05);
});

test('API errors arrive with their code', live, async () => {
  const kitten = await client();
  await assert.rejects(kitten.generate('Hello.', 'no_such_voice_0'), error => {
    assert.equal(error.code, 'API_ERROR');
    assert.equal(error.status, 400);
    assert.equal(error.apiCode, 'invalid_voice');
    assert.ok(error.requestId);
    return true;
  });
});
