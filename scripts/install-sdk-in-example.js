#!/usr/bin/env node
// Installs this checkout of the SDK into examples, for trying changes (or a version
// that is not on npm yet) before it is published:
//
//   npm run example:install -- ExpoExample BareRNExample
//
// Builds lib/, packs it, and runs `npm install --no-save <tarball>` in each example, so
// the example's package.json and lockfile keep pointing at the published package. With
// KITTENTTS_ESPEAK_NG_DIR set to a checkout of @kittentts/espeak-ng, that is packed and
// installed too (the examples that speak every language use it).
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const names = process.argv.slice(2);
const all = fs.readdirSync(path.join(root, 'examples'))
  .filter(name => fs.existsSync(path.join(root, 'examples', name, 'package.json')));
if (names.length === 0 || names.some(name => !all.includes(name))) {
  console.error(`Usage: npm run example:install -- <example...>\nExamples: ${all.join(', ')}`);
  process.exit(1);
}

const run = (args, cwd) => execFileSync(npm, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });

function pack(dir) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kittentts-pack-'));
  run(['pack', '--ignore-scripts', '--pack-destination', out], dir);
  return path.join(out, fs.readdirSync(out).find(file => file.endsWith('.tgz')));
}

// The generated 0.8 phonemizer runtime must exist: `npm run build` makes it once, with
// Emscripten (docs/development.md).
run(['run', 'build:ts'], root);
const tarballs = [pack(root)];
const espeakDir = process.env.KITTENTTS_ESPEAK_NG_DIR;
if (espeakDir) {
  run(['run', 'build:ts'], path.resolve(espeakDir));
  tarballs.push(pack(path.resolve(espeakDir)));
}
for (const name of names) {
  console.log(`\n${name}: installing ${tarballs.map(t => path.basename(t)).join(', ')}`);
  run(['install', '--no-save', '--no-audit', '--no-fund', ...tarballs], path.join(root, 'examples', name));
}
