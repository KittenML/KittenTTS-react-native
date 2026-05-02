const test = require('node:test');
const assert = require('node:assert/strict');

const { splitSentences } = require('../lib/engine/SentenceSplitter');
const { joinTimestamps } = require('../lib/engine/TimestampJoiner');

test('splitSentences merges short sentences for streaming chunks', () => {
  assert.deepEqual(splitSentences('Hi. Bye! Last bit'), ['Hi. Bye! Last bit']);
});

test('splitSentences keeps long sentence groups separate', () => {
  const first = 'A'.repeat(201) + '.';
  const second = 'B'.repeat(201) + '.';
  assert.deepEqual(splitSentences(`${first} ${second}`), [first, second]);
});

test('joinTimestamps maps phoneme durations to input words', () => {
  assert.deepEqual(joinTimestamps('hello world', 'ab cd', [3, 1, 2, 1, 3, 4, 0]), [
    { wordIndex: 0, word: 'hello', startTime: 0, endTime: 0.0875 },
    { wordIndex: 1, word: 'world', startTime: 0.0875, endTime: 0.275 },
  ]);
});

test('joinTimestamps merges extra phoneme groups into visible words', () => {
  const timings = joinTimestamps(
    'KittenTTS returns word-level timestamps.',
    'a b c d e f g h',
    [3, 2, 1, 3, 1, 4, 1, 5, 1, 6, 1, 7, 1, 8, 1, 9, 0],
  );

  assert.deepEqual(timings.map(timing => timing.word), [
    'KittenTTS',
    'returns',
    'word-level',
    'timestamps.',
  ]);
  assert.equal(timings.length, 4);
  assert.ok(
    timings[0].endTime - timings[0].startTime >
      timings[1].endTime - timings[1].startTime,
  );
  assert.ok(timings[0].endTime >= timings[1].startTime);
  assert.ok(timings[2].endTime >= timings[3].startTime);
});

test('joinTimestamps returns empty timings without duration output', () => {
  assert.deepEqual(joinTimestamps('hello', 'ab', []), []);
});
