#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = ['cephonemizer-runtime.js'];

// TypeScript does not copy plain .js assets into lib/. The generated
// Emscripten runtime is required by lib/phonemizer/generated/cephonemizer.js,
// so npm run build copies it after tsc finishes.
for (const file of files) {
  const from = path.join(root, 'src', 'phonemizer', 'generated', file);
  const to = path.join(root, 'lib', 'phonemizer', 'generated', file);

  if (!fs.existsSync(from)) {
    throw new Error(`Missing generated phonemizer runtime: ${path.relative(root, from)}`);
  }

  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}
