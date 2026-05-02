const test = require('node:test');
const assert = require('node:assert/strict');

const { preprocess, numberToWords } = require('../lib/engine/TextPreprocessor');
const { uint8ArrayToBase64 } = require('../lib/audio/Base64');

test('numberToWords handles trillions', () => {
  assert.equal(numberToWords(1_000_000_000_000), 'one trillion');
  assert.equal(
    numberToWords(1_234_000_000_000),
    'one trillion two hundred thirty-four billion',
  );
});

test('preprocess expands large ordinals without garbled suffixes', () => {
  assert.equal(preprocess('Ranked 101st.'), 'Ranked one hundred first.');
  assert.equal(preprocess('The 1000th item.'), 'The one thousandth item.');
});

test('preprocess expands negative currency', () => {
  assert.equal(preprocess('-$5'), 'negative five dollars');
  assert.equal(preprocess('$-1.25'), 'negative one point two five dollars');
});

test('uint8ArrayToBase64 encodes binary chunks', () => {
  assert.equal(uint8ArrayToBase64(new Uint8Array([0, 1, 2, 253, 254, 255])), 'AAEC/f7/');
});
