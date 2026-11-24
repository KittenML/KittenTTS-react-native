// The browser player (src/audio/AudioOutput.web.ts): stopping, or playing something
// else, ends the play() call that was waiting, so speak() returns.
const test = require('node:test');
const assert = require('node:assert/strict');

const clips = [];
class FakeAudio {
  constructor(url) { this.url = url; this.paused = false; clips.push(this); }
  play() { return new Promise((resolve, reject) => { this.start = resolve; this.abort = reject; }); }
  pause() { this.paused = true; this.abort?.(new Error('The play() request was interrupted by a call to pause().')); }
}
globalThis.Audio = FakeAudio;
URL.createObjectURL = () => `blob:${clips.length}`;
URL.revokeObjectURL = () => {};

const { createBrowserAudioPlayer } = require('../lib/audio/AudioOutput.web');
const samples = new Float32Array(2400);
const settled = promise => Promise.race([promise.then(() => 'resolved', () => 'rejected'), new Promise(r => setTimeout(() => r('pending'), 20))]);

test('stop() ends the play() call that was waiting', async () => {
  const player = createBrowserAudioPlayer();
  const playing = player.play(samples, 24000);
  await new Promise(r => setTimeout(r, 0));
  await player.stop();
  assert.equal(await settled(playing), 'resolved');
  assert.ok(clips.at(-1).paused);
});

test('playing another clip ends the first play() call', async () => {
  const player = createBrowserAudioPlayer();
  const first = player.play(samples, 24000);
  await new Promise(r => setTimeout(r, 0));
  const second = player.play(samples, 24000);
  assert.equal(await settled(first), 'resolved');
  await new Promise(r => setTimeout(r, 0));
  clips.at(-1).onended();
  assert.equal(await settled(second), 'resolved');
});

test('a clip that ends on its own resolves, and an error rejects', async () => {
  const player = createBrowserAudioPlayer();
  const done = player.play(samples, 24000);
  await new Promise(r => setTimeout(r, 0));
  clips.at(-1).onended();
  assert.equal(await settled(done), 'resolved');
  const failing = player.play(samples, 24000);
  await new Promise(r => setTimeout(r, 0));
  clips.at(-1).onerror();
  assert.equal(await settled(failing), 'rejected');
});
