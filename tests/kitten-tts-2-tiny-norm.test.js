// Parity of the Kitten TTS 2 Nano/Pico/Mini text normaliser (TtsNorm.ts) and its
// num2words port (Num2Words.ts) with the Python originals. The fixture holds Python's
// outputs; regenerate it with tools/kitten-tts-2-tiny/text_norm_fixtures.py.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { normalize } = require('../lib/tiny/frontend/english/TtsNorm');
const { num2words } = require('../lib/tiny/frontend/english/Num2Words');

const fixture = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'fixtures', 'kitten-tts-2-tiny-norm.json'), 'utf8'),
);

function run(fn) {
  try {
    return { out: fn() };
  } catch (e) {
    return { error: e && e.name ? e.name : String(e) };
  }
}

function describe(value) {
  const s = JSON.stringify(value);
  return s.length > 120 ? `${s.slice(0, 117)}...` : s;
}

function checkAll(cases, call, label) {
  const mismatches = [];
  for (const c of cases) {
    const got = run(() => call(c));
    const want = 'error' in c ? { error: c.error } : { out: c.out };
    if (JSON.stringify(got) !== JSON.stringify(want)) {
      mismatches.push(`${label(c)}\n    want ${describe(want)}\n    got  ${describe(got)}`);
    }
  }
  assert.equal(
    mismatches.length,
    0,
    `${mismatches.length}/${cases.length} mismatches:\n  ${mismatches.slice(0, 40).join('\n  ')}`,
  );
}

function floatValue(v) {
  if (v === 'nan') return NaN;
  if (v === 'inf') return Infinity;
  if (v === '-inf') return -Infinity;
  return v;
}

test('normalize() matches Python tts_norm on every fixture input', () => {
  assert.ok(fixture.normalize.length > 1000);
  checkAll(fixture.normalize, (c) => normalize(c.in), (c) => `normalize(${describe(c.in)})`);
});

test('num2words() matches Python num2words on every fixture call', () => {
  assert.ok(fixture.num2words_cases.length > 1000);
  checkAll(
    fixture.num2words_cases,
    (c) => num2words(c.kind === 'int' ? BigInt(c.value) : floatValue(c.value), c.to),
    (c) => `num2words(${c.kind} ${describe(c.value)}, to=${c.to})`,
  );
});

test('num2words() reads integer strings as int() and other strings as float()', () => {
  assert.equal(num2words('12345678901234567890'), num2words(BigInt('12345678901234567890')));
  assert.equal(num2words('3.14'), 'three point one four');
  assert.equal(num2words('2026', 'year'), 'twenty twenty-six');
  assert.equal(num2words(21, 'ordinal'), 'twenty-first');
});
