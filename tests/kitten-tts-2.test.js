const test = require('node:test');
const assert = require('node:assert/strict');
const util = require('node:util');

const { KittenTTS2Base, isKittenTTS2Model } = require('../lib/api/KittenTTS2Base');
const { PCM16Decoder, QuietSplitter, decodePCM16 } = require('../lib/api/pcm');
const { KittenAPIError, KittenTTSError, isKittenAPIError, isKittenTTSError } = require('../lib/KittenTTSError');
const { KittenTTSResult } = require('../lib/KittenTTSResult');

const KEY = 'sk_kitten_test_0123456789';
const RATE = 24000;

// --- Helpers ---------------------------------------------------------------------

/** The class apps get, with the platform swapped for fakes. */
class TestKittenTTS2 extends KittenTTS2Base {
  static async create(options, platform = fakePlatform()) {
    return new TestKittenTTS2(await KittenTTS2Base.connect(options, platform));
  }
}

function fakePlatform() {
  const played = [];
  return {
    played,
    files: { 'file:///recordings/me.m4a': new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 1, 2]) },
    audioOutput: {
      play: async (samples, sampleRate) => { played.push({ samples, sampleRate }); },
      stop: async () => {},
    },
    async readFile(uri) {
      if (!this.files[uri]) throw new Error('ENOENT');
      return this.files[uri];
    },
  };
}

function headers(values = {}) {
  const lower = Object.fromEntries(Object.entries(values).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: name => lower[name.toLowerCase()] ?? null };
}

/** A fetch Response. `chunks` makes a streaming body; `stream: false` hides it like classic React Native. */
function response(status, body, extraHeaders = {}, { chunks, stream = true } = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body ?? new Uint8Array();
  const parts = chunks ?? [bytes];
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: headers(extraHeaders),
    body: stream
      ? {
        getReader() {
          let index = 0;
          return {
            read: async () => (index < parts.length ? { done: false, value: parts[index++] } : { done: true }),
            cancel: async () => {},
          };
        },
      }
      : undefined,
    text: async () => new TextDecoder().decode(bytes),
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

const PUBLIC_VOICES = [
  { id: 'bella_en', name: 'Bella', type: 'public', language: 'en', experimental: false },
  { id: 'diego_es', name: 'Diego', type: 'public', language: 'es', experimental: false },
];

function voicesPage(data, more) {
  return response(200, JSON.stringify({
    object: 'list', data, has_more: Boolean(more), last_custom_id: more ?? null,
  }), { 'content-type': 'application/json' });
}

/** A fetch that records requests and answers from a script of handlers. */
function scriptedFetch(...script) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, ...init });
    const next = script.length > 1 ? script.shift() : script[0];
    return typeof next === 'function' ? next(url, init) : next;
  };
  fetch.calls = calls;
  return fetch;
}

/** Voices first, then whatever the test needs for speech. */
function apiFetch(...speech) {
  return scriptedFetch(voicesPage(PUBLIC_VOICES), ...speech);
}

function pcm(samples) {
  const bytes = new Uint8Array(samples.length * 2);
  samples.forEach((value, index) => {
    const int = Math.max(-32768, Math.min(32767, Math.round(value * 32768)));
    bytes[index * 2] = int & 0xff;
    bytes[index * 2 + 1] = (int >> 8) & 0xff;
  });
  return bytes;
}

function tone(seconds, amplitude = 0.5) {
  return Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin(i / 3));
}

function silence(seconds) {
  return new Array(Math.round(seconds * RATE)).fill(0);
}

const AUDIO = { 'content-type': 'audio/L16; rate=24000; channels=1', 'x-request-id': 'req_1' };

async function rejectsWith(promise, check) {
  await assert.rejects(promise, error => {
    check(error);
    return true;
  });
}

async function collect(iterable) {
  const items = [];
  for await (const item of iterable) items.push(item);
  return items;
}

function joined(results) {
  const total = results.reduce((sum, r) => sum + r.samples.length, 0);
  const all = new Float32Array(total);
  let offset = 0;
  for (const r of results) {
    all.set(r.samples, offset);
    offset += r.samples.length;
  }
  return all;
}

function multipartFields(body) {
  const text = Buffer.from(body).toString('latin1');
  const fields = {};
  for (const match of text.matchAll(/name="([^"]+)"(?:; filename="([^"]+)"\r\nContent-Type: ([^\r]+))?\r\n\r\n([\s\S]*?)\r\n--/g)) {
    fields[match[1]] = match[2] ? { filename: match[2], type: match[3], size: match[4].length } : match[4];
  }
  return fields;
}

// --- PCM ---------------------------------------------------------------------------

test('PCM16Decoder gives the same samples however the bytes are split', () => {
  const bytes = pcm([0, 0.5, -0.5, -1, 32767 / 32768, 0.25]);
  const whole = decodePCM16(bytes);
  assert.deepEqual([...whole], [0, 0.5, -0.5, -1, 32767 / 32768, 0.25]);

  for (const sizes of [[1, 1, 1, 9], [3, 3, 3, 3], [5, 7], [11, 1]]) {
    const decoder = new PCM16Decoder();
    const out = [];
    let offset = 0;
    for (const size of sizes) {
      out.push(...decoder.push(bytes.subarray(offset, offset + size)));
      offset += size;
    }
    assert.deepEqual(out, [...whole], `split ${sizes}`);
  }
});

test('QuietSplitter cuts in a pause after the first second, and loses nothing', () => {
  const signal = Float32Array.from([...tone(1.5), ...silence(0.3), ...tone(1), ...silence(0.08), ...tone(0.5)]);

  for (const step of [signal.length, 4801, 333]) {
    const splitter = new QuietSplitter(RATE);
    const chunks = [];
    for (let i = 0; i < signal.length; i += step) chunks.push(...splitter.push(signal.subarray(i, i + step)));
    chunks.push(splitter.flush());

    assert.equal(chunks.length, 2, `step ${step}`);
    // Cut 75 ms into the 300 ms pause; the 80 ms gap is too short to count.
    const pauseStart = 1.5 * RATE;
    assert.ok(Math.abs(chunks[0].length - (pauseStart + 0.075 * RATE)) <= RATE / 100, `cut at ${chunks[0].length}`);
    assert.deepEqual(Float32Array.from([...chunks[0], ...chunks[1]]), signal);
  }
});

test('QuietSplitter keeps a pause in the first second inside the chunk', () => {
  const splitter = new QuietSplitter(RATE);
  const chunks = splitter.push(Float32Array.from([...tone(0.4), ...silence(0.3), ...tone(0.4)]));
  assert.equal(chunks.length, 0);
  assert.equal(splitter.flush().length, Math.round(1.1 * RATE));
  assert.equal(splitter.flush(), null);
});

// --- create() ------------------------------------------------------------------------

test('isKittenTTS2Model picks out Kitten TTS 2 and nothing else', () => {
  for (const model of ['kitten-tts-2', 'kitten-tts-2-latest', 'kitten-tts-2-2026-11']) assert.ok(isKittenTTS2Model(model), model);
  for (const model of [undefined, '', 'kitten-tts-nano-0.8', 'kitten-tts-nano-0.8-int8', 'kitten-tts-20', 'KittenML/kitten-tts-2']) {
    assert.ok(!isKittenTTS2Model(model), String(model));
  }
});

test('create() lists the voices once, with the key as a bearer token', async () => {
  const saved = { id: 'voice_a', name: 'Mine', type: 'custom', language: 'en', experimental: false };
  const fetch = scriptedFetch(voicesPage([saved, ...PUBLIC_VOICES], 'voice_a'));
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch });

  assert.equal(tts.model, 'kitten-tts-2-latest');
  assert.equal(tts.sampleRate, 24000);
  assert.deepEqual(tts.availableVoices, ['voice_a', 'bella_en', 'diego_es']);
  assert.deepEqual(tts.voices[2], PUBLIC_VOICES[1]);
  assert.deepEqual(fetch.calls.map(call => call.url), [
    'https://api.kittenml.com/v1/voices?model=kitten-tts-2-latest&limit=100',
  ]);
  assert.equal(fetch.calls[0].headers.Authorization, `Bearer ${KEY}`);
  assert.equal(fetch.calls[0].redirect, undefined, 'continuation redirects must be followed');
});

test('create() needs a key or a backend, and never exposes the key', async () => {
  await rejectsWith(TestKittenTTS2.create({ model: 'kitten-tts-2', fetch: apiFetch() }), error => {
    assert.equal(error.code, 'INVALID_ARGUMENT');
    assert.match(error.message, /apiKey/);
  });
  await rejectsWith(
    TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, baseUrl: 'http://example.com/v1', fetch: apiFetch() }),
    error => assert.match(error.message, /plain http/),
  );
  await rejectsWith(TestKittenTTS2.create({ model: 'kitten-tts-nano-0.8', apiKey: KEY, fetch: apiFetch() }), error => {
    assert.equal(error.code, 'INVALID_ARGUMENT');
  });

  const backend = await TestKittenTTS2.create({
    model: 'kitten-tts-2', baseUrl: 'http://localhost:8787/kitten/', headers: { 'X-Session': 's1' }, fetch: apiFetch(),
  });
  assert.equal(backend.voices.length, 2);

  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch: apiFetch() });
  assert.ok(!JSON.stringify(tts).includes(KEY));
  assert.ok(!util.inspect(tts, { depth: 10, showHidden: true }).includes(KEY));
});

// --- generate() ------------------------------------------------------------------------

test('generate() sends Python-style options as API fields and returns a result', async () => {
  const fetch = apiFetch(response(200, pcm([0, 0.5, -0.5]), AUDIO));
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch });

  const result = await tts.generate('  Hello there.  ', {
    voice: 'bella_en', preset: 'stable', speed: 1.2, normalize: false,
    temperature: 0.7, topK: 40, topP: 0.9, minP: 0.05, maxNewTokens: 800,
  });

  const call = fetch.calls[1];
  assert.equal(call.url, 'https://api.kittenml.com/v1/audio/speech');
  assert.equal(call.method, 'POST');
  assert.equal(call.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.body), {
    model: 'kitten-tts-2-latest', input: 'Hello there.', response_format: 'pcm', stream: false,
    voice: 'bella_en', speed: 1.2, normalize: 'no', mode: 'stable',
    temperature: 0.7, top_k: 40, top_p: 0.9, min_p: 0.05, max_new_tokens: 800,
  });

  assert.ok(result instanceof KittenTTSResult);
  assert.deepEqual([...result.samples], [0, 0.5, -0.5]);
  assert.equal(result.sampleRate, 24000);
  assert.equal(result.voice, 'bella_en');
  assert.equal(result.effectiveSpeed, 1.2);
  assert.equal(result.inputText, 'Hello there.');
  assert.deepEqual(result.wordTimings, []);
  assert.equal(result.wavData().length, 44 + 6);
});

test('generate(text, voice, speed) works like the on-device KittenTTS', async () => {
  const fetch = apiFetch(response(200, pcm([0.1]), AUDIO));
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch });
  await tts.generate('Hi.', 'diego_es', 0.9);
  const body = JSON.parse(fetch.calls[1].body);
  assert.equal(body.voice, 'diego_es');
  assert.equal(body.speed, 0.9);
});

test('saved voices are sent as {id}, and defaults fill in what a call leaves out', async () => {
  const fetch = apiFetch(response(200, pcm([0.1]), AUDIO));
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, defaultVoice: 'bella_en', speed: 1.1, fetch });

  await tts.generate('One.', 'voice_0123');
  await tts.generate('Two.');
  const [saved, fallback] = fetch.calls.slice(1).map(call => JSON.parse(call.body));
  assert.deepEqual(saved.voice, { id: 'voice_0123' });
  assert.equal(fallback.voice, 'bella_en');
  assert.equal(fallback.speed, 1.1);

  const plain = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch: apiFetch(response(200, pcm([0.1]), AUDIO)) });
  const result = await plain.generate('Three.');
  assert.equal(result.voice, '', 'the API picked its default voice');
});

test('generate() refuses what the Python SDK refuses', async () => {
  const fetch = apiFetch(response(200, pcm([0.1]), AUDIO));
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch });

  await rejectsWith(tts.generate('   '), error => assert.equal(error.code, 'EMPTY_INPUT'));
  await rejectsWith(tts.generate('Hi.', { voice: 'bella_en', reference: new Uint8Array([1]) }), error => {
    assert.equal(error.code, 'INVALID_ARGUMENT');
    assert.match(error.message, /either voice or reference/);
  });
  await rejectsWith(tts.generate('Hi.', { referenceText: 'Hello.' }), error => assert.equal(error.code, 'INVALID_ARGUMENT'));
  await rejectsWith(tts.generate('Hi.', { voice: ' ' }), error => assert.equal(error.code, 'INVALID_ARGUMENT'));
  assert.equal(fetch.calls.length, 1, 'nothing was sent');
});

// --- Voice cloning ---------------------------------------------------------------------

test('a reference is uploaded as multipart, without the default voice', async () => {
  const fetch = apiFetch(response(200, pcm([0.2, 0.3]), AUDIO));
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, defaultVoice: 'bella_en', fetch });
  const wav = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 5]);

  const result = await tts.generate('Clone this.', { reference: wav, referenceText: 'What I said.', preset: 'expressive' });

  const call = fetch.calls[1];
  assert.match(call.headers['Content-Type'], /^multipart\/form-data; boundary=/);
  assert.ok(call.body instanceof Uint8Array, 'sent as bytes, which every fetch accepts');
  assert.deepEqual(multipartFields(call.body), {
    model: 'kitten-tts-2-latest',
    input: 'Clone this.',
    response_format: 'pcm',
    mode: 'expressive',
    stream: 'false',
    reference_transcript: 'What I said.',
    reference_audio: { filename: 'reference.wav', type: 'audio/wav', size: wav.length },
  });
  assert.equal(result.voice, '');
});

test('a reference URI is read through the platform and named after the file', async () => {
  const fetch = apiFetch(response(200, pcm([0.2]), AUDIO));
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch });

  await tts.generate('Clone this.', { reference: 'file:///recordings/me.m4a' });
  assert.deepEqual(multipartFields(fetch.calls[1].body).reference_audio, { filename: 'me.m4a', type: 'audio/mp4', size: 10 });

  await rejectsWith(tts.generate('Clone this.', { reference: 'file:///missing.wav' }), error => {
    assert.equal(error.code, 'INVALID_ARGUMENT');
    assert.match(error.message, /missing\.wav: ENOENT/);
  });
  await rejectsWith(tts.generate('Clone this.', { reference: { nope: true } }), error => assert.equal(error.code, 'INVALID_ARGUMENT'));
  await rejectsWith(tts.generate('Clone this.', { reference: new Uint8Array() }), error => assert.match(error.message, /empty/));
});

// --- Errors and retries ----------------------------------------------------------------

test('API errors keep the status, code, field and request id', async () => {
  const body = JSON.stringify({
    error: { message: 'Unknown voice "nope".', type: 'invalid_request_error', param: 'voice', code: 'invalid_voice' },
    request_id: 'req_42',
  });
  const fetch = apiFetch(response(400, body, { 'content-type': 'application/json' }));
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch });

  await rejectsWith(tts.generate('Hi.', 'nope'), error => {
    assert.ok(isKittenAPIError(error) && isKittenTTSError(error) && error instanceof KittenTTSError);
    assert.equal(error.code, 'API_ERROR');
    assert.equal(error.status, 400);
    assert.equal(error.apiCode, 'invalid_voice');
    assert.equal(error.param, 'voice');
    assert.equal(error.requestId, 'req_42');
    assert.equal(error.message, 'Kitten API error 400: Unknown voice "nope".');
  });
  assert.equal(fetch.calls.length, 2, 'a client error is not retried');
});

test('422 detail errors are readable too', async () => {
  const body = JSON.stringify({ detail: [{ loc: ['body', 'speed'], msg: 'must be at most 4' }] });
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch: apiFetch(response(422, body)) });
  await rejectsWith(tts.generate('Hi.', { speed: 9 }), error => {
    assert.equal(error.message, 'Kitten API error 422: speed: must be at most 4');
    assert.equal(error.param, 'speed');
  });
});

test('rate limits and server errors are retried; long waits are left to the caller', async () => {
  const fetch = apiFetch(response(503, '{}'), response(429, '{}', { 'retry-after': '1' }), response(200, pcm([0.1]), AUDIO));
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch });
  const waits = [];
  tts.api.sleep = async ms => { waits.push(ms); };

  await tts.generate('Hi.');
  assert.equal(fetch.calls.length, 4);
  assert.ok(waits[1] >= 1000, 'Retry-After is honoured');

  const slow = await TestKittenTTS2.create({
    model: 'kitten-tts-2', apiKey: KEY, fetch: apiFetch(response(429, '{}', { 'retry-after': '120' })),
  });
  await rejectsWith(slow.generate('Hi.'), error => assert.equal(error.retryAfter, 120));
});

test('a lost connection is retried for the voice list but not for speech, which is billed', async () => {
  let failures = 1;
  const flaky = scriptedFetch(async () => {
    if (failures-- > 0) throw new TypeError('Network request failed');
    return voicesPage(PUBLIC_VOICES);
  });
  const listed = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch: flaky });
  assert.equal(listed.voices.length, 2);

  const fetch = apiFetch(async () => { throw new TypeError('Network request failed'); });
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch });
  await rejectsWith(tts.generate('Hi.'), error => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.match(error.message, /Network request failed/);
  });
  assert.equal(fetch.calls.length, 2);
});

function hangingFetch() {
  return apiFetch((url, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }));
}

test('timeouts, signals and dispose() each end a request with their own code', async () => {
  const slow = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, timeoutMs: 20, fetch: hangingFetch() });
  await rejectsWith(slow.generate('Hi.'), error => {
    assert.equal(error.code, 'NETWORK_ERROR');
    assert.match(error.message, /timed out/);
  });

  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch: hangingFetch() });
  const controller = new AbortController();
  const cancelled = tts.generate('Hi.', { signal: controller.signal });
  controller.abort();
  await rejectsWith(cancelled, error => assert.equal(error.code, 'CANCELLED'));

  const pending = tts.generate('Hi.');
  await tts.dispose();
  await rejectsWith(pending, error => {
    assert.equal(error.code, 'CANCELLED');
    assert.match(error.message, /dispose/);
  });
  await rejectsWith(tts.generate('Hi.'), error => assert.equal(error.code, 'ENGINE_NOT_READY'));
});

test('a 200 that is not audio is an error, not noise', async () => {
  const html = response(200, '<html>Bad gateway</html>', { 'content-type': 'text/html; charset=utf-8' });
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch: apiFetch(html) });
  await rejectsWith(tts.generate('Hi.'), error => {
    assert.ok(error instanceof KittenAPIError);
    assert.match(error.message, /text\/html instead of audio/);
  });

  const empty = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch: apiFetch(response(200, new Uint8Array(), AUDIO)) });
  await rejectsWith(empty.generate('Hi.'), error => assert.equal(error.code, 'EMPTY_OUTPUT'));
});

test('generate() refuses complete audio the API cut at its 30-minute limit', async () => {
  const cut = response(200, pcm([0.1, 0.2]), { ...AUDIO, 'x-kittenml-audio-limit-reached': '1' });
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch: apiFetch(cut) });
  await rejectsWith(tts.generate('A very long book.'), error => {
    assert.equal(error.apiCode, 'audio_limit_reached');
    assert.equal(error.requestId, 'req_1');
    assert.match(error.message, /generateStreaming/);
  });
});

// --- Streaming and playback ------------------------------------------------------------

test('generateStreaming() yields audio cut at pauses, whatever size the network chunks are', async () => {
  const audio = pcm([...tone(1.2), ...silence(0.4), ...tone(0.6)]);
  const chunks = [];
  for (let offset = 0, size = 4799; offset < audio.length; offset += size, size = size === 4799 ? 1201 : 4799) {
    chunks.push(audio.subarray(offset, offset + size));
  }
  const fetch = apiFetch(response(200, audio, AUDIO, { chunks }));
  const tts = await TestKittenTTS2.create({ model: 'kitten-tts-2', apiKey: KEY, fetch });

  const results = await collect(tts.generateStreaming('One. Two.', 'bella_en'));

  assert.equal(results.length, 2);
  assert.deepEqual(joined(results), decodePCM16(audio));
  assert.ok(results.every(r => r.voice === 'bella_en' && r.inputText === 'One. Two.'));
  assert.equal(JSON.parse(fetch.calls[1].body).stream, undefined, 'streams use the low-latency path');
});

test('generateStreaming() still works where fetch cannot stream', async () => {
  const audio = pcm([...tone(1.2), ...silence(0.4), ...tone(0.6)]);
  const tts = await TestKittenTTS2.create({
    model: 'kitten-tts-2', apiKey: KEY, fetch: apiFetch(response(200, audio, AUDIO, { stream: false })),
  });
  const results = await collect(tts.generateStreaming('One. Two.'));
  assert.equal(results.length, 2);
  assert.deepEqual(joined(results), decodePCM16(audio));
});

test('speak() plays the generated audio, and nothing plays after dispose()', async () => {
  const platform = fakePlatform();
  const tts = await TestKittenTTS2.create(
    { model: 'kitten-tts-2', apiKey: KEY, fetch: apiFetch(response(200, pcm([0.25, -0.25]), AUDIO)) },
    platform,
  );

  const result = await tts.speak('Hi.', { voice: 'bella_en' });
  assert.equal(platform.played.length, 1);
  assert.equal(platform.played[0].samples, result.samples);
  assert.equal(platform.played[0].sampleRate, 24000);

  await tts.dispose();
  await rejectsWith(tts.play(result), error => assert.equal(error.code, 'ENGINE_NOT_READY'));
});
