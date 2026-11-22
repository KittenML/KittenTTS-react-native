#!/usr/bin/env node

// Builds src/tiny/frontend/espeak/generated/espeakng-runtime.js: espeak-ng
// 1.52.0 (the version of espeakng_loader 0.2.4, which the Python kittenml
// package uses) plus vendor/espeak-ng-bridge/bridge.c, compiled with Emscripten
// to plain JavaScript. Hermes has no WebAssembly, so -sWASM=0.
//
// The espeak-ng sources are fetched once into a cache folder outside the repo:
//   $KITTENTTS_ESPEAK_CACHE, default ~/.cache/kittentts-espeak-ng
//
// espeak-ng is GPL-3.0-or-later; the generated runtime is too.

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ESPEAK_TAG = '1.52.0';
const ESPEAK_COMMIT = '4870adfa25b1a32b4361592f1be8a40337c58d6c';
const ESPEAK_REPO = 'https://github.com/espeak-ng/espeak-ng.git';

const root = path.resolve(__dirname, '..');
const cacheDir =
  process.env.KITTENTTS_ESPEAK_CACHE ||
  path.join(os.homedir(), '.cache', 'kittentts-espeak-ng');
const srcDir = path.join(cacheDir, `espeak-ng-${ESPEAK_TAG}`);
const buildDir = path.join(cacheDir, `build-${ESPEAK_TAG}`);
const bridge = path.join(root, 'vendor', 'espeak-ng-bridge', 'bridge.c');
const outFile = path.join(
  root,
  'src',
  'tiny',
  'frontend',
  'espeak',
  'generated',
  'espeakng-runtime.js',
);

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, { encoding: 'utf8', stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.slice(0, 3).join(' ')} ... exited with ${result.status}`);
  }
  return result;
}

function fetchSources() {
  if (!fs.existsSync(path.join(srcDir, 'src', 'libespeak-ng', 'speech.c'))) {
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.rmSync(srcDir, { recursive: true, force: true });
    console.log(`Fetching espeak-ng ${ESPEAK_TAG} into ${srcDir}`);
    run('git', [
      '-c',
      'advice.detachedHead=false',
      'clone',
      '--quiet',
      '--depth',
      '1',
      '--branch',
      ESPEAK_TAG,
      ESPEAK_REPO,
      srcDir,
    ]);
  }
  const head = spawnSync('git', ['-C', srcDir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (head.status !== 0 || head.stdout.trim() !== ESPEAK_COMMIT) {
    throw new Error(
      `${srcDir} is not espeak-ng ${ESPEAK_TAG} (${ESPEAK_COMMIT}); delete it and rerun.`,
    );
  }
}

function writeConfigHeader() {
  // The build options only change audio output and synthesis back ends, never
  // the text -> phoneme path: no async thread, no audio device, no sonic, no
  // mbrola, no klatt / speech-player (none of the voices used selects them).
  const includeDir = path.join(buildDir, 'include');
  fs.mkdirSync(includeDir, { recursive: true });
  fs.writeFileSync(
    path.join(includeDir, 'config.h'),
    [
      '#define HAVE_MKSTEMP 1',
      '#define USE_ASYNC 0',
      '#define USE_KLATT 0',
      '#define USE_LIBPCAUDIO 0',
      '#define USE_LIBSONIC 0',
      '#define USE_MBROLA 0',
      '#define USE_SPEECHPLAYER 0',
      `#define PACKAGE_VERSION "${ESPEAK_TAG}"`,
      '',
    ].join('\n'),
  );
  return includeDir;
}

function main() {
  const emcc = spawnSync('emcc', ['--version'], { encoding: 'utf8' });
  if (emcc.error || emcc.status !== 0) {
    throw new Error(
      'emcc is required to build the espeak-ng JS runtime. Install Emscripten (emsdk), ' +
        'source emsdk_env.sh, then rerun npm run build:espeak.',
    );
  }
  if (!fs.existsSync(bridge)) throw new Error(`Missing ${bridge}`);

  fetchSources();
  const configDir = writeConfigHeader();

  const lib = path.join(srcDir, 'src', 'libespeak-ng');
  const ucd = path.join(srcDir, 'src', 'ucd-tools', 'src');
  // The same list as src/libespeak-ng/CMakeLists.txt without the optional parts.
  const sources = [
    'common.c',
    'mnemonics.c',
    'error.c',
    'ieee80.c',
    'compiledata.c',
    'compiledict.c',
    'dictionary.c',
    'encoding.c',
    'intonation.c',
    'langopts.c',
    'numbers.c',
    'phoneme.c',
    'phonemelist.c',
    'readclause.c',
    'setlengths.c',
    'soundicon.c',
    'spect.c',
    'ssml.c',
    'synthdata.c',
    'synthesize.c',
    'tr_languages.c',
    'translate.c',
    'translateword.c',
    'voices.c',
    'wavegen.c',
    'speech.c',
    'espeak_api.c',
  ].map((f) => path.join(lib, f));
  const ucdSources = ['case.c', 'categories.c', 'ctype.c', 'proplist.c', 'scripts.c', 'tostring.c'].map(
    (f) => path.join(ucd, f),
  );

  fs.mkdirSync(path.dirname(outFile), { recursive: true });

  const exported = [
    '_kt_espeak_initialize',
    '_kt_espeak_set_voice',
    '_kt_espeak_text_to_phonemes',
    '_kt_espeak_version',
    '_malloc',
    '_free',
  ];
  const runtime = ['FS', 'UTF8ToString', 'stringToUTF8', 'lengthBytesUTF8'];

  const args = [
    ...sources,
    ...ucdSources,
    bridge,
    `-I${configDir}`,
    `-I${path.join(srcDir, 'src', 'include')}`,
    `-I${path.join(srcDir, 'src', 'include', 'compat')}`,
    `-I${path.join(ucd, 'include')}`,
    `-I${lib}`,
    // musl's <wchar.h> declares the isw* functions that the compat <wctype.h>
    // renames to ucd-tools; read it before those macros exist.
    '-include',
    'wchar.h',
    '-DLIBESPEAK_NG_EXPORT=1',
    '-DPATH_ESPEAK_DATA="/espeak-ng-data"',
    // As espeak-ng's own CMake build: signed overflow wraps like on the
    // native library the Python reference uses.
    '-fwrapv',
    '-w',
    '-O3',
    // Plain JS (asm.js style), no WebAssembly: Hermes has none.
    '-sWASM=0',
    '-sMODULARIZE=1',
    '-sEXPORT_NAME=createEspeakNgModule',
    '-sENVIRONMENT=web,worker,shell',
    // Data files are written into MEMFS from JS; espeak reads them by path.
    '-sFILESYSTEM=1',
    '-sALLOW_MEMORY_GROWTH=1',
    // 16 MB to start; it grows when a big dictionary is read (ru_dict is 8.5 MB).
    '-sINITIAL_MEMORY=16777216',
    // espeak keeps large buffers on the stack (TranslateClause, TranslateWord).
    '-sSTACK_SIZE=2097152',
    // No eval / new Function: not available in Hermes release builds.
    '-sDYNAMIC_EXECUTION=0',
    `-sEXPORTED_FUNCTIONS=${JSON.stringify(exported)}`,
    `-sEXPORTED_RUNTIME_METHODS=${JSON.stringify(runtime)}`,
    '-o',
    outFile,
  ];

  const started = Date.now();
  run('emcc', args, { cwd: buildDir });
  const banner =
    `/* Generated by scripts/build-espeak-ng.js: espeak-ng ${ESPEAK_TAG} (${ESPEAK_REPO} ` +
    `${ESPEAK_COMMIT}) and vendor/espeak-ng-bridge, compiled with Emscripten to plain JavaScript. ` +
    'espeak-ng (with its ucd-tools) is GPL-3.0-or-later, see COPYING* in its sources. Do not edit. */\n';
  fs.writeFileSync(outFile, banner + fs.readFileSync(outFile, 'utf8'));
  const size = fs.statSync(outFile).size;
  console.log(
    `Built ${path.relative(root, outFile)} (${(size / 1024 / 1024).toFixed(2)} MB) in ${(
      (Date.now() - started) /
      1000
    ).toFixed(1)} s`,
  );
}

main();
