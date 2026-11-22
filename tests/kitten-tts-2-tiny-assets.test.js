// The download cache's shared logic (src/tiny/assets.ts): each file is fetched once even when
// asked for twice, progress only goes up and ends at 1, failures are retried.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Downloader } = require('../lib/tiny/assets');

function fakeStore({ failFirst = 0 } = {}) {
  const files = new Map();
  const fetched = [];
  let failures = failFirst;
  const downloader = new Downloader(3, async key => files.has(key), async (f, progress) => {
    fetched.push(f.key);
    await new Promise(r => setTimeout(r, 5));
    if (failures-- > 0) throw new Error('network');
    progress(50, 100);
    progress(100, 100);
    files.set(f.key, f.url);
  });
  return { downloader, files, fetched };
}

test('a file asked for twice, in one call or two at once, is fetched once', async () => {
  const { downloader, fetched } = fakeStore();
  const a = { key: 'x/base', url: 'u1' };
  const b = { key: 'x/de', url: 'u2' };
  const c = { key: 'x/fr', url: 'u3' };
  await Promise.all([downloader.ensure([a, b, a]), downloader.ensure([a, c])]);
  assert.deepEqual([...fetched].sort(), ['x/base', 'x/de', 'x/fr']);
  await downloader.ensure([a, b, c]);
  assert.equal(fetched.length, 3, 'cached files are not fetched again');
});

test('progress only goes up and ends at 1', async () => {
  const { downloader } = fakeStore();
  const seen = [];
  await downloader.ensure([1, 2, 3, 4, 5, 6].map(i => ({ key: `f${i}`, url: `u${i}` })), p => seen.push(p));
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], `progress went back: ${seen}`);
  assert.equal(seen[seen.length - 1], 1);
  const cached = [];
  await downloader.ensure([{ key: 'f1', url: 'u1' }], p => cached.push(p));
  assert.deepEqual(cached, [1], 'all cached: one report of 1');
});

test('a failed download is retried', async () => {
  const { downloader, files, fetched } = fakeStore({ failFirst: 2 });
  await downloader.ensure([{ key: 'g', url: 'u' }]);
  assert.equal(fetched.length, 3);
  assert.ok(files.has('g'));
});
