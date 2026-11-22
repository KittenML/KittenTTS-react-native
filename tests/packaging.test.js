const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');

test('every "browser" redirect is cancelled on native by a "react-native" entry', () => {
  // Metro's native main fields are react-native, browser, main, so without this
  // the web files are bundled into iOS and Android apps and bundling fails.
  assert.deepEqual(Object.keys(pkg['react-native']).sort(), Object.keys(pkg.browser).sort());
  for (const [file, target] of Object.entries(pkg['react-native'])) assert.equal(target, file);
  for (const [file, target] of Object.entries(pkg.browser)) assert.equal(target, file.replace(/\.js$/, '.web.js'));
});

test('every src/**/*.web.ts has a "browser" entry', () => {
  const src = path.join(__dirname, '..', 'src');
  const webFiles = fs.readdirSync(src, { recursive: true })
    .map(f => f.split(path.sep).join('/'))
    .filter(f => f.endsWith('.web.ts'))
    .map(f => `./lib/${f.replace(/\.web\.ts$/, '.js')}`)
    .sort();
  assert.deepEqual(Object.keys(pkg.browser).sort(), webFiles);
});
