// `bundle-assets` (bin/kittentts-react-native.js) without network: fetch is replaced by a
// fake Hugging Face that serves small made-up repositories, so the tests check which files
// the CLI picks, how it stores them and the manifest it writes. With the real text data
// (KITTEN_TTS_2_TINY_DATA) and Nano in the Hugging Face cache, one test also bundles the real
// files and runs create() and generate() from the bundle.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const { bundleAssets, parseArgs } = require('../bin/kittentts-react-native');
const { KittenTTS2Tiny, DEFAULT_TEXT_DATA_URL } = require('../lib/tiny/KittenTTS2Tiny');
const { readOnlyStore } = require('../lib/tiny/assets');
const { copyBundledFiles } = require('../lib/tiny/bundled');
// The web helpers load the 0.8 phonemizer runtime, which a fresh clone does not have
// until `npm run build:phonemizer` (Emscripten) has run.
const webSkip = fs.existsSync(path.join(__dirname, '../lib/phonemizer/generated/cephonemizer-runtime.js'))
  ? false
  : 'cephonemizer runtime missing in lib/: npm run build:phonemizer, then npm run build:test';
const web = webSkip ? null : require('../lib/KittenTTSBundledAssets.web');
const { ENGLISH_G2P_FILES, ENGLISH_TEXT_FILES } = require('../lib/tiny/frontend/english/load');
const { JAPANESE_DATA_FILES } = require('../lib/tiny/frontend/japanese/JapaneseG2P');
const { espeakDataFilesFor } = require('../lib/tiny/frontend/espeak/files');
const data = require('./helpers/tiny-data');

const HF = 'https://huggingface.co';
const TEXT = DEFAULT_TEXT_DATA_URL;
const sha256 = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

// ---- a fake Hugging Face ----------------------------------------------------------------

function tinyConfig(name, languages, graphFor) {
  const entries = {};
  const voices = {};
  for (const lang of languages) {
    const graph = graphFor(lang);
    entries[lang] = {
      model_file: `${graph}.onnx`,
      model_files: { int8: `${graph}.onnx`, int4: `${graph}_int4.onnx` },
      voices: `voices_${lang}.npz`,
    };
    voices[lang] = [{ key: `${lang}_1`, name: `Voice ${lang}` }];
  }
  return {
    name, type: 'KITTEN2_TINY', vocab: 'vocab.json', g2p_dir: 'g2p',
    default_language: 'en', default_weights: 'int8', languages: entries, voices,
  };
}

const REPOS = {
  'kitten-tts-2-nano': tinyConfig('Nano', ['en', 'de', 'fr'], lang => `nano_${lang}`),
  'kitten-tts-2-mini': tinyConfig('Mini', ['en', 'de', 'ja'], () => 'mini'),
};

/** Text data: every file a test language needs, the big ones gzipped as on Hugging Face. */
function textData() {
  const names = [
    ...ENGLISH_TEXT_FILES,
    ...JAPANESE_DATA_FILES,
    ...['de', 'fr'].flatMap(lang => espeakDataFilesFor(lang)).map(f => `espeak-ng-data/${f}`),
  ];
  const files = {};
  const served = new Map();
  for (const name of new Set(names)) {
    const plain = Buffer.from(`text data ${name}\n`.repeat(20));
    const entry = { size: plain.length, sha256: sha256(plain) };
    if (name.endsWith('.json') || name.startsWith('ja/')) {
      const gz = zlib.gzipSync(plain);
      entry.gzip = { size: gz.length, sha256: sha256(gz) };
      served.set(`${TEXT}/${name}.gz`, gz);
    } else {
      served.set(`${TEXT}/${name}`, plain);
    }
    files[name] = entry;
  }
  served.set(`${TEXT}/manifest.json`, Buffer.from(JSON.stringify({ version: 2, files })));
  return { files, served };
}

function fakeHub() {
  const served = new Map(textData().served);
  for (const [model, config] of Object.entries(REPOS)) {
    const base = `${HF}/KittenML/${model}/resolve/main`;
    served.set(`${base}/config.json`, Buffer.from(JSON.stringify(config)));
    served.set(`${base}/vocab.json`, Buffer.from('{"a": 1}'));
    for (const entry of Object.values(config.languages)) {
      for (const file of [...Object.values(entry.model_files), entry.voices]) served.set(`${base}/${file}`, Buffer.from(`${model} ${file}`));
    }
    for (const file of ENGLISH_G2P_FILES) served.set(`${base}/${file}`, Buffer.from(`${model} ${file}`));
  }
  for (const model of ['kitten-tts-nano-0.8-int8', 'kitten-tts-mini-0.8']) {
    const base = `${HF}/KittenML/${model}/resolve/main`;
    const onnx = model.includes('mini') ? 'kitten_tts_mini_v0_8.onnx' : 'kitten_tts_nano_v0_8.onnx';
    served.set(`${base}/${onnx}`, Buffer.from(`${model} onnx`));
    served.set(`${base}/voices.npz`, Buffer.from(`${model} voices`));
  }
  served.set('https://raw.githubusercontent.com/espeak-ng/espeak-ng/59eb19938f12e30881c81d86ce4a7de25414c9f4/dictsource/en_rules', Buffer.from('rules'));
  served.set('https://raw.githubusercontent.com/espeak-ng/espeak-ng/59eb19938f12e30881c81d86ce4a7de25414c9f4/dictsource/en_list', Buffer.from('list'));
  return served;
}

/** Run the CLI against a fake fetch (default: the fake hub); returns the URLs fetched. */
async function runCLI(argv, served = fakeHub()) {
  const fetched = [];
  const saved = { fetch: globalThis.fetch, log: console.log, warn: console.warn };
  const output = [];
  globalThis.fetch = async (url) => {
    fetched.push(String(url));
    const body = served.get(String(url));
    return body ? new Response(body) : new Response('not found', { status: 404 });
  };
  console.log = (...a) => output.push(a.join(' '));
  console.warn = console.log;
  try {
    await bundleAssets(parseArgs(['bundle-assets', ...argv]));
  } finally {
    Object.assign(globalThis, { fetch: saved.fetch });
    console.log = saved.log;
    console.warn = saved.warn;
  }
  return { fetched, output };
}

const tempDirs = [];
process.on('exit', () => { for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true }); });
function tempDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kt-bundle-'));
  tempDirs.push(dir);
  return dir;
}

const readManifest = out => JSON.parse(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'));

/** The text data files a language set needs, as stored in the bundle (.gz kept). */
function storedTextFiles(languages) {
  const { files } = textData();
  const names = new Set(['manifest.json']);
  for (const lang of languages) {
    const list = lang === 'en' ? ENGLISH_TEXT_FILES
      : lang === 'ja' ? JAPANESE_DATA_FILES
        : espeakDataFilesFor(lang).map(f => `espeak-ng-data/${f}`);
    for (const name of list) names.add(files[name].gzip ? `${name}.gz` : name);
  }
  return [...names].map(name => `kitten-tts-2-text/${name}`);
}

/**
 * KittenTTS2Tiny reading only from the bundle's folders (a file outside them fails): resolves
 * to the files it asked for, as bundle paths.
 */
async function sdkReads(out, model, languages, weights) {
  const asked = new Set();
  const local = dir => {
    const source = readOnlyStore(
      key => path.join(dir, key),
      async p => fs.existsSync(p),
      { text: async p => fs.readFileSync(p, 'utf8'), bytes: async p => new Uint8Array(fs.readFileSync(p)) },
      false,
    );
    return {
      ...source,
      async ensure(files) {
        for (const f of files) {
          const stored = fs.existsSync(path.join(dir, f.key)) ? f.key : `${f.key}.gz`;
          asked.add(path.relative(out, path.join(dir, stored)).split(path.sep).join('/'));
        }
        return source.ensure(files);
      },
    };
  };
  const nowhere = async () => { throw new Error('read outside the bundle'); };
  const store = { ensure: nowhere, text: nowhere, bytes: nowhere, filePath: nowhere, clear: nowhere, writeFile: nowhere, local };
  await KittenTTS2Tiny.predownload({
    model, weights, languages,
    modelDirectory: path.join(out, model),
    textDataDirectory: path.join(out, 'kitten-tts-2-text'),
    platform: { ort: {}, store },
  });
  return [...asked].sort();
}

// ---- 0.8 --------------------------------------------------------------------------------

test('0.8 models only: the same version 2 manifest and files as before', async () => {
  const out = tempDir();
  const { fetched } = await runCLI(['--models', 'nano-int8,mini', '--out', out]);
  assert.equal(fetched.length, 6);
  const expected = {
    version: 2,
    defaultModel: 'kitten-tts-nano-0.8-int8',
    models: {
      'kitten-tts-nano-0.8-int8': {
        onnx: 'kitten-tts-nano-0.8-int8/kitten_tts_nano_v0_8.onnx',
        voices: 'kitten-tts-nano-0.8-int8/voices.npz',
        sourceBaseURL: 'https://huggingface.co/KittenML/kitten-tts-nano-0.8-int8/resolve/main',
      },
      'kitten-tts-mini-0.8': {
        onnx: 'kitten-tts-mini-0.8/kitten_tts_mini_v0_8.onnx',
        voices: 'kitten-tts-mini-0.8/voices.npz',
        sourceBaseURL: 'https://huggingface.co/KittenML/kitten-tts-mini-0.8/resolve/main',
      },
    },
    files: { phonemizerRules: 'CEPhonemizer/en_rules.txt', phonemizerList: 'CEPhonemizer/en_list.txt' },
    sources: {
      phonemizerRulesURL: 'https://raw.githubusercontent.com/espeak-ng/espeak-ng/59eb19938f12e30881c81d86ce4a7de25414c9f4/dictsource/en_rules',
      phonemizerListURL: 'https://raw.githubusercontent.com/espeak-ng/espeak-ng/59eb19938f12e30881c81d86ce4a7de25414c9f4/dictsource/en_list',
    },
  };
  assert.equal(fs.readFileSync(path.join(out, 'manifest.json'), 'utf8'), `${JSON.stringify(expected, null, 2)}\n`);
  assert.deepEqual(fs.readdirSync(out).sort(), ['CEPhonemizer', 'kitten-tts-mini-0.8', 'kitten-tts-nano-0.8-int8', 'manifest.json']);
});

// ---- Kitten TTS 2 -----------------------------------------------------------------------

test('Kitten TTS 2 Nano int8 en+de: exactly the files create() reads, gzipped text data kept gzipped', async () => {
  const out = tempDir();
  const { fetched } = await runCLI(['--models', 'kitten-tts-2-nano', '--weights', 'int8', '--languages', 'en,de', '--out', out]);

  const base = `${HF}/KittenML/kitten-tts-2-nano/resolve/main`;
  const modelFiles = ['config.json', 'vocab.json', 'nano_en.onnx', 'voices_en.npz', ...ENGLISH_G2P_FILES, 'nano_de.onnx', 'voices_de.npz'];
  const textFiles = storedTextFiles(['en', 'de']);
  assert.deepEqual(
    [...new Set(fetched)].sort(),
    [...modelFiles.map(f => `${base}/${f}`), ...textFiles.map(f => `${TEXT}/${f.slice('kitten-tts-2-text/'.length)}`)].sort(),
  );
  assert.equal(fetched.length, new Set(fetched).size, 'each file is downloaded once');

  const manifest = readManifest(out);
  assert.equal(manifest.version, 3);
  assert.deepEqual(manifest.models, {}, 'no 0.8 model: models is empty, the 0.8 fields absent');
  assert.equal(manifest.defaultModel, undefined);
  assert.equal(manifest.files, undefined);
  assert.equal(fs.existsSync(path.join(out, 'CEPhonemizer')), false, 'no 0.8 phonemizer files');
  const { kittenTTS2 } = manifest;
  assert.equal(kittenTTS2.defaultModel, 'kitten-tts-2-nano');
  assert.equal(kittenTTS2.textDataDirectory, 'kitten-tts-2-text');
  assert.equal(kittenTTS2.textDataURL, TEXT);
  const nano = kittenTTS2.models['kitten-tts-2-nano'];
  assert.deepEqual(
    { ...nano, files: undefined },
    { repo: 'KittenML/kitten-tts-2-nano', weights: 'int8', languages: ['en', 'de'], modelDirectory: 'kitten-tts-2-nano', sourceBaseURL: base, files: undefined },
  );
  assert.deepEqual(Object.keys(nano.files).sort(), [...modelFiles.map(f => `kitten-tts-2-nano/${f}`), ...textFiles].sort());

  // Every entry is the file on disk; .gz files are the bytes served, with their unpacked size.
  const { files: text } = textData();
  for (const [file, entry] of Object.entries(nano.files)) {
    const bytes = fs.readFileSync(path.join(out, file));
    assert.equal(entry.size, bytes.length, file);
    assert.equal(entry.sha256, sha256(bytes), file);
    if (file.endsWith('.gz')) {
      const name = file.slice('kitten-tts-2-text/'.length, -3);
      assert.equal(entry.sha256, text[name].gzip.sha256);
      assert.equal(entry.unpackedSize, text[name].size);
    } else {
      assert.equal(entry.unpackedSize, undefined);
    }
  }

  // The SDK, reading only from the bundle, finds everything and asks for nothing else.
  assert.deepEqual(await sdkReads(out, 'kitten-tts-2-nano', ['en', 'de'], 'int8'), Object.keys(nano.files).sort());
  fs.rmSync(path.join(out, 'kitten-tts-2-nano', 'voices_de.npz'));
  await assert.rejects(sdkReads(out, 'kitten-tts-2-nano', ['en', 'de'], 'int8'), { code: 'MODEL_FILE_NOT_FOUND' });

  // Again: nothing is downloaded, the missing file is.
  const again = await runCLI(['--models', 'kitten-tts-2-nano', '--languages', 'en,de', '--out', out]);
  assert.deepEqual(again.fetched, [`${base}/voices_de.npz`]);
  assert.deepEqual(readManifest(out), manifest);
});

test('int4 weights and the default language', async () => {
  const out = tempDir();
  await runCLI(['--models', 'kitten-tts-2-nano', '--weights', 'int4', '--out', out]);
  const nano = readManifest(out).kittenTTS2.models['kitten-tts-2-nano'];
  assert.equal(nano.weights, 'int4');
  assert.deepEqual(nano.languages, ['en']);
  assert.ok(nano.files['kitten-tts-2-nano/nano_en_int4.onnx']);
  assert.equal(nano.files['kitten-tts-2-nano/nano_en.onnx'], undefined);
  assert.deepEqual(await sdkReads(out, 'kitten-tts-2-nano', ['en'], 'int4'), Object.keys(nano.files).sort());
  await assert.rejects(runCLI(['--models', 'kitten-tts-2-nano', '--weights', 'int3', '--out', out]), /no int3 ONNX weights/);
  await assert.rejects(runCLI(['--models', 'nano-int8', '--languages', 'de', '--out', out]), /are for Kitten TTS 2 models/);
});

test('several models: languages per model, shared text data, Mini\'s one graph once', async () => {
  const out = tempDir();
  const { output } = await runCLI(['--models', 'kitten-tts-2-nano,kitten-tts-2-mini', '--languages', 'en,ja', '--out', out]);
  assert.ok(output.some(line => line.includes('kitten-tts-2-nano does not speak ja')));
  const { kittenTTS2 } = readManifest(out);
  const nano = kittenTTS2.models['kitten-tts-2-nano'];
  const mini = kittenTTS2.models['kitten-tts-2-mini'];
  assert.deepEqual(nano.languages, ['en']);
  assert.deepEqual(mini.languages, ['en', 'ja']);
  assert.deepEqual(
    Object.keys(mini.files).filter(f => f.startsWith('kitten-tts-2-mini/')).sort(),
    ['config.json', 'mini.onnx', 'voices_en.npz', 'voices_ja.npz', 'vocab.json', ...ENGLISH_G2P_FILES].map(f => `kitten-tts-2-mini/${f}`).sort(),
  );
  assert.deepEqual(Object.keys(mini.files).filter(f => f.startsWith('kitten-tts-2-text/')).sort(), storedTextFiles(['en', 'ja']).sort());
  assert.deepEqual(Object.keys(nano.files).filter(f => f.startsWith('kitten-tts-2-text/')).sort(), storedTextFiles(['en']).sort());
  assert.deepEqual(await sdkReads(out, 'kitten-tts-2-mini', ['en', 'ja']), Object.keys(mini.files).sort());

  await assert.rejects(runCLI(['--models', 'kitten-tts-2-nano', '--languages', 'ja', '--out', out]), /No bundled Kitten TTS 2 model speaks ja/);
  await assert.rejects(runCLI(['--models', 'kitten-tts-2-nano', '--languages', 'en,xx', '--out', out]), /speaks xx/);
});

test('0.8 and Kitten TTS 2 in one bundle: version 3 that the 0.8 readers still accept', { skip: webSkip }, async () => {
  const out = tempDir();
  await runCLI(['--models', 'nano-int8,kitten-tts-2-nano', '--default-model', 'kitten-tts-2-nano', '--languages', 'de', '--out', out]);
  const manifest = readManifest(out);
  assert.equal(manifest.version, 3);
  assert.equal(manifest.defaultModel, 'kitten-tts-nano-0.8-int8', 'the 0.8 default stays a 0.8 model');
  assert.deepEqual(Object.keys(manifest.models), ['kitten-tts-nano-0.8-int8']);
  assert.deepEqual(manifest.files, { phonemizerRules: 'CEPhonemizer/en_rules.txt', phonemizerList: 'CEPhonemizer/en_list.txt' });
  assert.equal(manifest.kittenTTS2.defaultModel, 'kitten-tts-2-nano');
  assert.deepEqual(web.bundledAssetModels(manifest), ['kitten-tts-nano-0.8-int8']);
  assert.deepEqual(web.bundledTinyModels(manifest), ['kitten-tts-2-nano']);
  assert.deepEqual(web.bundledTinyModels({ version: 2, models: {} }), []);

  assert.deepEqual(await web.createBundledTinyOptions(manifest, { basePath: `${out}/` }), {
    model: 'kitten-tts-2-nano',
    weights: 'int8',
    languages: ['de'],
    modelDirectory: `${out}/kitten-tts-2-nano`,
    textDataDirectory: `${out}/kitten-tts-2-text`,
  });
  assert.equal((await web.createBundledTinyOptions(manifest)).modelDirectory, 'kittentts/kitten-tts-2-nano');
  await assert.rejects(web.createBundledTinyOptions(manifest, { model: 'kitten-tts-2-mini' }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(web.createBundledTinyOptions({ version: 2, models: {} }), { code: 'INVALID_ARGUMENT' });
  await assert.rejects(web.createBundledAssetConfig(manifest, { model: 'kitten-tts-2-nano' }), /createBundledTinyOptions/);
  await assert.rejects(
    web.createBundledAssetConfig({ version: 3, models: {}, kittenTTS2: manifest.kittenTTS2 }),
    /no KittenTTS 0\.8 model \(they have kitten-tts-2-nano/,
  );
});

test('an earlier run\'s files that are not in the bundle are pointed out', async () => {
  const out = tempDir();
  await runCLI(['--models', 'kitten-tts-2-nano', '--languages', 'en,fr', '--out', out]);
  const { output } = await runCLI(['--models', 'kitten-tts-2-nano', '--languages', 'en', '--out', out]);
  const note = output.find(line => line.startsWith('Note:'));
  assert.ok(note && note.includes('kitten-tts-2-nano/nano_fr.onnx') && note.includes('espeak-ng-data/fr_dict'), note);
});

// ---- the Android copy -------------------------------------------------------------------

function fakeAndroid(assets) {
  const files = new Map();
  const copies = [];
  return {
    files,
    copies,
    fs: {
      assetExists: async p => assets.has(p),
      async copyAsset(from, to) {
        if (!assets.has(from)) throw new Error(`no asset ${from}`);
        copies.push(from);
        files.set(to, assets.get(from));
      },
      size: async p => (files.has(p) ? files.get(p).length : null),
      mkdir: async () => {},
      async move(from, to) { files.set(to, files.get(from)); files.delete(from); },
      async unlink(p) { files.delete(p); },
      async readText(p) { if (!files.has(p)) throw new Error('missing'); return files.get(p).toString('utf8'); },
      async writeText(p, text) { files.set(p, Buffer.from(text)); },
    },
  };
}

test('Android: bundled files are copied once, again only when they changed', async () => {
  const graph = Buffer.from('graph');
  const lexicon = Buffer.from('lexicon, unpacked');
  const lexiconGz = zlib.gzipSync(lexicon);
  const entry = (bytes, extra = {}) => ({ size: bytes.length, sha256: sha256(bytes), ...extra });
  const files = {
    'kitten-tts-2-nano/nano_en.onnx': entry(graph),
    'kitten-tts-2-text/en/lexicon.json.gz': entry(lexiconGz, { unpackedSize: lexicon.length }),
  };
  // The build unpacked the .gz asset and dropped its extension, as Android's does.
  const assets = new Map([
    ['kittentts/kitten-tts-2-nano/nano_en.onnx', graph],
    ['kittentts/kitten-tts-2-text/en/lexicon.json', lexicon],
  ]);
  const android = fakeAndroid(assets);
  await copyBundledFiles(files, 'kittentts', '/docs/bundled', android.fs);
  assert.deepEqual(android.copies, ['kittentts/kitten-tts-2-nano/nano_en.onnx', 'kittentts/kitten-tts-2-text/en/lexicon.json']);
  assert.deepEqual(android.files.get('/docs/bundled/kitten-tts-2-text/en/lexicon.json'), lexicon);
  assert.deepEqual([...android.files.keys()].filter(f => f.endsWith('.copy')), [], 'no temporary files left');

  android.copies.length = 0;
  await copyBundledFiles(files, 'kittentts', '/docs/bundled', android.fs);
  assert.deepEqual(android.copies, [], 'files already there with the right size are kept');

  // An app update with a new graph of the same size is copied again; the rest is kept.
  const graph2 = Buffer.from('GRAPH');
  assets.set('kittentts/kitten-tts-2-nano/nano_en.onnx', graph2);
  await copyBundledFiles({ ...files, 'kitten-tts-2-nano/nano_en.onnx': entry(graph2) }, 'kittentts', '/docs/bundled', android.fs);
  assert.deepEqual(android.copies, ['kittentts/kitten-tts-2-nano/nano_en.onnx']);
  assert.deepEqual(android.files.get('/docs/bundled/kitten-tts-2-nano/nano_en.onnx'), graph2);

  // A .gz kept as it is (iOS-style assets) is copied gzipped, and a stale plain copy removed.
  const gzAssets = fakeAndroid(new Map([['kittentts/kitten-tts-2-text/en/lexicon.json.gz', lexiconGz]]));
  gzAssets.files.set('/d/kitten-tts-2-text/en/lexicon.json', Buffer.from('stale'));
  await copyBundledFiles({ 'kitten-tts-2-text/en/lexicon.json.gz': files['kitten-tts-2-text/en/lexicon.json.gz'] }, 'kittentts', '/d', gzAssets.fs);
  assert.deepEqual(gzAssets.files.get('/d/kitten-tts-2-text/en/lexicon.json.gz'), lexiconGz);
  assert.equal(gzAssets.files.has('/d/kitten-tts-2-text/en/lexicon.json'), false);

  await assert.rejects(
    copyBundledFiles({ 'kitten-tts-2-nano/missing.onnx': entry(graph) }, 'kittentts', '/d', gzAssets.fs),
    { code: 'MODEL_FILE_NOT_FOUND' },
  );
  const wrongSize = fakeAndroid(new Map([['kittentts/a.onnx', Buffer.from('short')]]));
  await assert.rejects(copyBundledFiles({ 'a.onnx': { size: 99, sha256: 'x' } }, 'kittentts', '/d', wrongSize.fs), { code: 'INVALID_MODEL_DATA' });
  assert.deepEqual([...wrongSize.files.keys()].filter(f => f.endsWith('.copy')), []);
});

// ---- the real files ---------------------------------------------------------------------

const nanoDir = data.modelDir('kitten-tts-2-nano');
const realSkip = data.textDataSkip('manifest.json', ...ENGLISH_TEXT_FILES)
  || data.espeakNgSkip()
  || (nanoDir ? false : 'kitten-tts-2-nano is not in the Hugging Face cache (or KITTEN_TTS_2_TINY_MODEL_DIR)')
  || (nanoDir && !fs.existsSync(path.join(nanoDir, 'kitten_tts_2_nano_de.onnx')) ? 'the cached kitten-tts-2-nano has no German graph' : false);

test('the real Nano int8 en+de bundle loads and speaks with no download', { skip: realSkip || webSkip, timeout: 300_000 }, async () => {
  // Hugging Face served from the local copies.
  const served = {
    get(url) {
      for (const [prefix, dir] of [[`${HF}/KittenML/kitten-tts-2-nano/resolve/main/`, nanoDir], [`${TEXT}/`, data.textDir]]) {
        if (url.startsWith(prefix)) {
          const file = path.join(dir, url.slice(prefix.length));
          return fs.existsSync(file) ? fs.readFileSync(file) : undefined;
        }
      }
      return undefined;
    },
  };
  const out = tempDir();
  await runCLI(['--models', 'kitten-tts-2-nano', '--weights', 'int8', '--languages', 'en,de', '--out', out], served);
  const manifest = readManifest(out);
  const opts = await web.createBundledTinyOptions(manifest, { basePath: out });
  assert.deepEqual(await sdkReads(out, opts.model, opts.languages, opts.weights), Object.keys(manifest.kittenTTS2.models[opts.model].files).sort());

  const tts = await KittenTTS2Tiny.create({ ...opts, platform: await data.nodePlatform() });
  try {
    assert.ok((await tts.generate('Hello there.')).samples.length > 4800);
    assert.ok((await tts.generate('Guten Morgen.', { language: 'de' })).samples.length > 4800);
  } finally {
    await tts.dispose();
  }
});
