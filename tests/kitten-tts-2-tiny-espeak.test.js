// Parity of src/tiny/frontend/espeak/EspeakG2P.ts with the Python kittenml front end
// (tests/fixtures/kitten-tts-2-tiny-espeak.json, written by
// tools/kitten-tts-2-tiny/espeak_fixtures.py).
//
// espeak-ng itself is the separate GPL package @kittentts/espeak-ng. The parity tests load
// a built copy of it from KITTENTTS_ESPEAK_NG_DIR (its folder, after npm run build there)
// and need KITTEN_TTS_2_TINY_DATA (tests/helpers/tiny-data.js); they skip without either.
// The tests at the end, of what happens without the package, always run.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const data = require('./helpers/tiny-data');

const fixtures = require('./fixtures/kitten-tts-2-tiny-espeak.json');
const espeak = require('../lib/tiny/frontend/espeak/EspeakG2P');
const { espeakDataFilesFor } = require('../lib/tiny/frontend/espeak/files');

const REGISTRY = Symbol.for('@kittentts/espeak-ng');
const packageDir = process.env.KITTENTTS_ESPEAK_NG_DIR;
const packageEntry = packageDir && path.join(path.resolve(packageDir), 'lib', 'index.js');
const skip = !packageEntry
  ? 'set KITTENTTS_ESPEAK_NG_DIR to a built @kittentts/espeak-ng (docs/development.md)'
  : !fs.existsSync(packageEntry)
    ? `${packageEntry} missing: npm run build in @kittentts/espeak-ng`
    : data.textDataSkip('espeak-ng-data/phontab', 'manifest.json');
// Importing the package registers it, as an app's import '@kittentts/espeak-ng' does.
const registration = skip ? null : require(packageEntry).default;
const dataDir = skip ? null : path.join(data.textDir, 'espeak-ng-data');

/** Run fn with the registry set to `value` (undefined: as if the package were not imported). */
async function withRegistry(value, fn) {
  const before = globalThis[REGISTRY];
  if (value === undefined) delete globalThis[REGISTRY];
  else globalThis[REGISTRY] = value;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete globalThis[REGISTRY];
    else globalThis[REGISTRY] = before;
  }
}

function readFiles(names) {
  return Object.fromEntries(names.map(name => [name, data.readBytes(dataDir, name)]));
}

function filesFor(langs) {
  const names = new Set();
  for (const lang of langs) for (const f of espeakDataFilesFor(lang)) names.add(f);
  return readFiles([...names]);
}

const allLangs = fixtures.versions.v2;

// ownFilesOnly: the instance has only espeakDataFilesFor(lang). Words in other scripts
// ("other_script" cases) then lack the dictionaries Python reads them with, so they
// are only checked to phonemize without an error.
function compareAll(g2p, version, lang, mismatches, ownFilesOnly = false) {
  for (const c of fixtures.cases[lang]) {
    const got = g2p.phonemizeLang(c.text, lang, version);
    if (ownFilesOnly && c.other_script) {
      assert.equal(typeof got, 'string');
      continue;
    }
    if (got !== c[version]) mismatches.push({ version, lang, text: c.text, got, want: c[version] });
  }
}

function report(mismatches) {
  return mismatches
    .slice(0, 20)
    .map((m) => `${m.version} ${m.lang} ${JSON.stringify(m.text)}\n   got  ${JSON.stringify(m.got)}\n   want ${JSON.stringify(m.want)}`)
    .join('\n');
}

test('espeak G2P matches Python for every language and phonemizer version', { skip }, async (t) => {
  const g2p = await espeak.EspeakG2P.create(filesFor(allLangs));
  assert.equal(g2p.version, '1.52.0');
  const mismatches = [];
  for (const version of ['v1', 'v2']) {
    for (const lang of fixtures.versions[version]) {
      const before = mismatches.length;
      compareAll(g2p, version, lang, mismatches);
      const n = fixtures.cases[lang].length;
      t.diagnostic(`${version} ${lang}: ${n - (mismatches.length - before)}/${n}`);
    }
  }
  g2p.dispose();
  assert.equal(mismatches.length, 0, `${mismatches.length} mismatches\n${report(mismatches)}`);
});

test('espeak G2P output does not depend on the order of languages and texts', { skip }, async () => {
  const g2p = await espeak.EspeakG2P.create(filesFor(allLangs));
  const jobs = [];
  for (const version of ['v1', 'v2']) {
    for (const lang of fixtures.versions[version]) {
      fixtures.cases[lang].forEach((c, i) => jobs.push({ version, lang, c, i }));
    }
  }
  // deterministic shuffle: the voice changes between almost every two texts
  let seed = 12345;
  for (let i = jobs.length - 1; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    const j = seed % (i + 1);
    [jobs[i], jobs[j]] = [jobs[j], jobs[i]];
  }
  const mismatches = [];
  for (const { version, lang, c } of jobs) {
    const got = g2p.phonemizeLang(c.text, lang, version);
    if (got !== c[version]) mismatches.push({ version, lang, text: c.text, got, want: c[version] });
  }
  g2p.dispose();
  assert.equal(mismatches.length, 0, `${mismatches.length} mismatches\n${report(mismatches)}`);
});

test('languages can be added one at a time with only their own files', { skip }, async () => {
  const base = espeak.espeakDataFilesFor('de');
  const g2p = await espeak.EspeakG2P.create(readFiles(base));
  assert.deepEqual(g2p.missingFiles('de'), []);
  assert.ok(g2p.missingFiles('ru').length > 0);
  assert.throws(() => g2p.phonemizeLang('Привет', 'ru', 'v1'), /missing espeak-ng-data files/);

  const mismatches = [];
  compareAll(g2p, 'v1', 'de', mismatches, true);
  for (const lang of ['ru', 'hi', 'ko']) {
    const extra = espeak.espeakDataFilesFor(lang).filter((f) => !base.includes(f));
    assert.deepEqual(extra, [`lang/${{ ru: 'zle/ru', hi: 'inc/hi', ko: 'ko' }[lang]}`, `${lang}_dict`]);
    g2p.addFiles(readFiles(extra));
    assert.deepEqual(g2p.missingFiles(lang), []);
    // the other-script cases need hi_dict and ko_dict: only complete once ko is in
    compareAll(g2p, 'v2', lang, mismatches, lang !== 'ko');
  }
  // with hi_dict and ko_dict loaded the other-script cases of de match too
  compareAll(g2p, 'v2', 'de', mismatches);
  g2p.dispose();
  assert.equal(mismatches.length, 0, `${mismatches.length} mismatches\n${report(mismatches)}`);
});

test('unsupported languages and versions are rejected', { skip }, async () => {
  const g2p = await espeak.EspeakG2P.create(filesFor(['ko']));
  assert.throws(() => g2p.phonemizeLang('안녕', 'ko', 'v1'), /does not go through espeak/);
  assert.throws(() => g2p.phonemizeLang('hello', 'en', 'v2'), /does not go through espeak/);
  assert.throws(() => g2p.phonemizeLang('こんにちは', 'ja', 'v2'), /does not go through espeak/);
  g2p.dispose();
  assert.throws(() => g2p.phonemizeLang('안녕', 'ko', 'v2'), /after dispose/);
  await assert.rejects(espeak.EspeakG2P.create({}), /missing espeak-ng-data files/);
});

test('espeakDataFilesFor matches the text data manifest', { skip }, () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(data.textDir, 'manifest.json'), 'utf8'));
  for (const lang of allLangs) {
    assert.deepEqual(espeak.espeakDataFilesFor(lang), manifest.espeakLanguages[lang], lang);
  }
});

test('without @kittentts/espeak-ng, an espeak language says which package to install', async () => {
  await withRegistry(undefined, async () => {
    await assert.rejects(espeak.EspeakG2P.create({}, 'de'), (error) => {
      assert.equal(error.code, 'MISSING_DEPENDENCY');
      assert.match(error.message, /npm install @kittentts\/espeak-ng/);
      assert.match(error.message, /"de"/);
      return true;
    });
  });
});

test('a registered espeak-ng with another espeak-ng version is refused', async () => {
  await withRegistry({ api: 1, espeakVersion: '1.51.0', createBackend: async () => ({}) }, async () => {
    await assert.rejects(espeak.EspeakG2P.create({}, 'fr'), { code: 'MISSING_DEPENDENCY' });
  });
});

test("misaki's and kittenml's steps run around the registered backend", async () => {
  const calls = [];
  const backend = {
    version: '1.52.0',
    addFiles() {},
    // What phonemizer's backend returns for "Hallo" in German, ties and all.
    phonemize(text, voice) { calls.push([text, voice]); return 'h\u02c8alo\u02d0 t^s '; },
    dispose() { calls.push('dispose'); },
  };
  await withRegistry({ api: 1, espeakVersion: '1.52.0', createBackend: async () => backend }, async () => {
    const files = Object.fromEntries(espeakDataFilesFor('de').map((f) => [f, new Uint8Array()]));
    const g2p = await espeak.EspeakG2P.create(files, 'de');
    // misaki: parentheses travel as angle quotes; e2m turns t^s into ʦ; the tie goes.
    assert.equal(g2p.phonemizeLang('Hallo (du)', 'de', 'v1'), 'h\u02c8alo\u02d0 \u02a6');
    assert.deepEqual(calls[0], ['Hallo \u00abdu\u00bb', 'gmw/de']);
    g2p.dispose();
    assert.equal(calls.at(-1), 'dispose');
  });
});

