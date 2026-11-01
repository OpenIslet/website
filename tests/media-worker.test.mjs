// The launch film's route (site-worker/media.js): byte ranges, as iPhone Safari needs them, and nothing outside /media/<file>.
import test from 'node:test';
import assert from 'node:assert/strict';
import { byteRange, serveMedia } from '../site-worker/media.js';

const SIZE = 1000;
const bytes = new Uint8Array(SIZE).map((_, i) => i % 251);
// A stand-in for the R2 bucket: one file, and the calls it was asked for.
const bucket = () => {
  const calls = [];
  return {
    calls,
    async head(key) {
      calls.push(['head', key]);
      return key === 'film-1080p.mp4' ? { size: SIZE, httpEtag: '"abc"' } : null;
    },
    async get(key, options) {
      calls.push(['get', key, options?.range ?? null]);
      if (key !== 'film-1080p.mp4') return null;
      const { offset = 0, length = SIZE } = options?.range ?? {};
      return { body: new Blob([bytes.slice(offset, offset + length)]).stream() };
    },
  };
};
const ask = (path, headers = {}, method = 'GET') => new Request(`https://openislet.org${path}`, { method, headers });

test('reads one byte range the way browsers ask for it', () => {
  assert.deepEqual(byteRange('bytes=0-1', SIZE), { offset: 0, length: 2 });
  assert.deepEqual(byteRange('bytes=100-', SIZE), { offset: 100, length: 900 });
  assert.deepEqual(byteRange('bytes=-50', SIZE), { offset: 950, length: 50 });
  assert.deepEqual(byteRange('bytes=990-5000', SIZE), { offset: 990, length: 10 });
  assert.deepEqual(byteRange('bytes=-5000', SIZE), { offset: 0, length: SIZE });
  assert.equal(byteRange('bytes=1000-', SIZE), false);
  assert.equal(byteRange('bytes=-0', SIZE), false);
  for (const whole of [null, '', 'bytes=-', 'bytes=0-1,5-9', 'items=0-1', 'bytes=9-3']) assert.equal(byteRange(whole, SIZE), null, String(whole));
});

test('sends the whole film, or the piece asked for, with the right headers', async () => {
  const env = { MEDIA: bucket() };
  const whole = await serveMedia(ask('/media/film-1080p.mp4'), env);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'video/mp4');
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal(whole.headers.get('cross-origin-resource-policy'), 'same-origin');
  assert.equal(whole.headers.get('x-content-type-options'), 'nosniff');
  assert.match(whole.headers.get('cache-control'), /immutable/);
  assert.equal((await whole.arrayBuffer()).byteLength, SIZE);

  const piece = await serveMedia(ask('/media/film-1080p.mp4', { range: 'bytes=10-19' }), env);
  assert.equal(piece.status, 206);
  assert.equal(piece.headers.get('content-range'), 'bytes 10-19/1000');
  assert.deepEqual([...new Uint8Array(await piece.arrayBuffer())], [...bytes.slice(10, 20)]);

  const past = await serveMedia(ask('/media/film-1080p.mp4', { range: 'bytes=5000-' }), env);
  assert.equal(past.status, 416);
  assert.equal(past.headers.get('content-range'), 'bytes */1000');

  const head = await serveMedia(ask('/media/film-1080p.mp4', { range: 'bytes=0-1' }, 'HEAD'), env);
  assert.equal(head.status, 206);
  assert.equal(head.headers.get('content-length'), '2');
  assert.equal(env.MEDIA.calls.filter(([what]) => what === 'get').length, 2); // HEAD and 416 never read the file
});

test('answers a repeat visit from the browser cache, and ignores a range for a changed file', async () => {
  const env = { MEDIA: bucket() };
  assert.equal((await serveMedia(ask('/media/film-1080p.mp4', { 'if-none-match': '"abc"' }), env)).status, 304);
  const changed = await serveMedia(ask('/media/film-1080p.mp4', { range: 'bytes=0-1', 'if-range': '"old"' }), env);
  assert.equal(changed.status, 200);
});

test('reaches nothing but plain file names under /media/, and only reads them', async () => {
  const env = { MEDIA: bucket() };
  for (const path of ['/media/', '/media/../secret.mp4', '/media/a/b.mp4', '/media/.hidden.mp4', '/media/Film.mp4', '/media/film.exe', '/media/nothing.mp4']) {
    assert.equal((await serveMedia(ask(path), env)).status, 404, path);
  }
  assert.ok(env.MEDIA.calls.every(([, key]) => key === 'nothing.mp4'), 'only a plain name was ever looked up');
  const post = await serveMedia(ask('/media/film-1080p.mp4', {}, 'POST'), env);
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, HEAD');
  assert.equal((await serveMedia(ask('/media/film-1080p.mp4'), {})).status, 404); // no bucket bound
});

test('staging keeps the film out of shared caches', async () => {
  const res = await serveMedia(ask('/media/film-1080p.mp4'), { MEDIA: bucket() }, { 'cache-control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' });
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff'); // once, though both lists name it
});
