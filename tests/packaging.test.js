const test = require('node:test');
const assert = require('node:assert/strict');

test('every "browser" redirect is cancelled on native by a "react-native" entry', () => {
  // Metro's native main fields are react-native, browser, main, so without this
  // the web files are bundled into iOS and Android apps and bundling fails.
  const pkg = require('../package.json');
  assert.deepEqual(Object.keys(pkg['react-native']).sort(), Object.keys(pkg.browser).sort());
  for (const [file, target] of Object.entries(pkg['react-native'])) assert.equal(target, file);
  for (const [file, target] of Object.entries(pkg.browser)) assert.equal(target, file.replace(/\.js$/, '.web.js'));
});
