// The launch film, served from R2 (the MEDIA bucket) at /media/<file>, on the site's own address. It cannot be a static file:
// those cannot answer byte-range requests, which iPhone Safari needs to play a video at all and every browser needs to skip
// ahead, and each one must be under 25 MiB. Used by site.js (the live site) and staging-gate.js (staging, behind the password).

// Only plain file names, so a request can never reach anything else in the bucket.
const FILE = /^\/media\/([a-z0-9][a-z0-9-]{0,80}\.(mp4|vtt))$/;
const TYPES = { mp4: 'video/mp4', vtt: 'text/vtt; charset=utf-8' };
// Static files get their headers from _headers, which does not reach answers made here. `same-origin` also stops other
// websites from playing the film from this address.
const BASE = { 'x-content-type-options': 'nosniff', 'cross-origin-resource-policy': 'same-origin' };

export const isMedia = (pathname) => pathname.startsWith('/media/');

/**
 * One byte range from a Range header, for a file of `size` bytes: `{ offset, length }`, `null` to send the whole file, or `false`
 * when the range starts past the end (416). A form this does not read, such as several ranges at once, gets the whole file,
 * which the standard allows.
 */
export function byteRange(header, size) {
  const m = /^bytes=(\d*)-(\d*)$/.exec((header ?? '').trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  if (m[1] === '') {
    const last = Number(m[2]);
    if (last === 0) return false;
    const length = Math.min(last, size);
    return { offset: size - length, length };
  }
  const start = Number(m[1]);
  if (start >= size) return false;
  const end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  if (end < start) return null;
  return { offset: start, length: end - start + 1 };
}

/** The answer for a /media/ request. `extra` adds or replaces headers (staging keeps everything out of shared caches). */
export async function serveMedia(request, env, extra = {}) {
  // `set` replaces a header whatever its capitals, so a name in both lists is sent once.
  const headers = new Headers(BASE);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  const text = (status, body) => {
    headers.set('content-type', 'text/plain; charset=utf-8');
    return new Response(body, { status, headers });
  };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('allow', 'GET, HEAD');
    return text(405, 'Only GET and HEAD work here.');
  }
  const m = FILE.exec(new URL(request.url).pathname);
  const info = m && env.MEDIA ? await env.MEDIA.head(m[1]) : null;
  if (!info) return text(404, 'Not found.');

  headers.set('content-type', TYPES[m[2]]);
  headers.set('accept-ranges', 'bytes');
  headers.set('etag', info.httpEtag);
  // Each new cut gets a new file name, so a browser may keep this one for good.
  if (!headers.has('cache-control')) headers.set('cache-control', 'public, max-age=31536000, immutable');
  if (request.headers.get('if-none-match') === info.httpEtag) return new Response(null, { status: 304, headers });

  // A range asked for "if the file is still this one" is ignored when the file has changed.
  const ifRange = request.headers.get('if-range');
  const range = ifRange && ifRange !== info.httpEtag ? null : byteRange(request.headers.get('range'), info.size);
  if (range === false) {
    headers.set('content-range', `bytes */${info.size}`);
    return new Response(null, { status: 416, headers });
  }
  const status = range ? 206 : 200;
  if (range) headers.set('content-range', `bytes ${range.offset}-${range.offset + range.length - 1}/${info.size}`);
  if (request.method === 'HEAD') {
    headers.set('content-length', String(range ? range.length : info.size));
    return new Response(null, { status, headers });
  }
  const object = await env.MEDIA.get(m[1], range ? { range } : undefined);
  if (!object) return text(404, 'Not found.');
  return new Response(object.body, { status, headers });
}
