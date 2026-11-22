#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

// TypeScript does not copy plain .js assets into lib/. The generated
// Emscripten runtimes are required by their typed wrappers in lib/, so
// npm run build copies them after tsc finishes.
const files = [
  // Required by lib/phonemizer/generated/cephonemizer.js (npm run build:phonemizer).
  { dir: path.join('phonemizer', 'generated'), file: 'cephonemizer-runtime.js', required: true },
  // Required by lib/tiny/frontend/espeak/generated/espeakng.js (npm run build:espeak).
  // Optional here because npm run build does not build it yet.
  { dir: path.join('tiny', 'frontend', 'espeak', 'generated'), file: 'espeakng-runtime.js', required: false },
];

// Copy every runtime that exists before failing on a missing required one.
const missing = [];
for (const { dir, file, required } of files) {
  const from = path.join(root, 'src', dir, file);
  const to = path.join(root, 'lib', dir, file);

  if (!fs.existsSync(from)) {
    if (required) missing.push(path.relative(root, from));
    else console.warn(`copy-generated: skipping missing ${path.relative(root, from)}`);
    continue;
  }

  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

if (missing.length > 0) {
  throw new Error(`Missing generated phonemizer runtime: ${missing.join(', ')}`);
}
