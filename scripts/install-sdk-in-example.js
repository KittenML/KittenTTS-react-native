#!/usr/bin/env node
// Installs this checkout of the SDK into examples, for trying changes (or a version
// that is not on npm yet) before it is published:
//
//   npm run example:install -- ExpoExample BareRNExample
//
// Builds lib/, packs it, and runs `npm install --no-save <tarball>` in each example, so
// the example's package.json and lockfile keep pointing at the published package.
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

// The generated runtimes (espeak-ng, the 0.8 phonemizer) must exist: `npm run build`
// makes them once, with Emscripten (docs/development.md).
run(['run', 'build:ts'], root);
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'kittentts-sdk-'));
run(['pack', '--ignore-scripts', '--pack-destination', out], root);
const tarball = path.join(out, fs.readdirSync(out).find(file => file.endsWith('.tgz')));
for (const name of names) {
  console.log(`\n${name}: installing ${path.basename(tarball)}`);
  run(['install', '--no-save', '--no-audit', '--no-fund', tarball], path.join(root, 'examples', name));
}
