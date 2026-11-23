#!/usr/bin/env node

// TypeScript does not copy plain .js files into lib/. The generated Emscripten
// runtimes are required by their typed wrappers in lib/, so the build copies
// them after tsc finishes.
//
//   node scripts/copy-generated.js                  every runtime must exist (npm run build)
//   node scripts/copy-generated.js --allow-missing  copy the ones that exist (npm test; the
//                                                   tests that need a missing one skip)

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const allowMissing = process.argv.includes('--allow-missing');

const runtimes = [
  // Required by lib/phonemizer/generated/cephonemizer.js (npm run build:phonemizer).
  path.join('phonemizer', 'generated', 'cephonemizer-runtime.js'),
];

const missing = [];
for (const file of runtimes) {
  const from = path.join(root, 'src', file);
  if (!fs.existsSync(from)) {
    missing.push(path.relative(root, from));
    continue;
  }
  const to = path.join(root, 'lib', file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

if (missing.length > 0) {
  const message = `Missing generated runtime: ${missing.join(', ')} (npm run build:phonemizer)`;
  if (!allowMissing) throw new Error(message);
  console.warn(`copy-generated: ${message}`);
}
