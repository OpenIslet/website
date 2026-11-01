// Staging only: a simple password page in front of the staging copy of the site (Kev, 28 October 2026: "just so people can't
// easily access if they come across it"). The live site has no gate: wrangler.site.jsonc uses this file only under env.staging.
// The password is the Worker secret STAGING_PASSWORD. With no
// password set, the gate stays shut. After the right password a cookie keeps the browser in for 30 days.
// The security headers come from the staging build (scripts/security-headers.mjs): Cloudflare's _headers file does not
// reach answers made here, so every answer gets them below. Build into dist-staging before deploying.
import security from '../dist-staging/security-headers.json';
import { isMedia, serveMedia } from './media.js';

const COOKIE = 'openislet_staging';
const enc = new TextEncoder();

async function token(password) {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`openislet-staging:${password}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Compares without stopping at the first difference.
function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const cookieValue = (request) =>
  (request.headers.get('cookie') ?? '').split(/;\s*/).find((c) => c.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1) ?? '';
// Only send people back to a page on this site. A browser reads "\" as "/", so "/\example.com" would be another site.
const safePath = (p) => (typeof p === 'string' && p.startsWith('/') && !p.startsWith('//') && !/[\\\u0000-\u001f\u007f]/.test(p) ? p : '/');
const escape = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const closed = { ...security, 'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow' };

const page = (next, wrong) =>
  new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow"><title>OpenIslet preview</title>
<style>
  body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1b26;color:#e6edf2;font:16px/1.5 'IBM Plex Sans',system-ui,-apple-system,'Segoe UI',sans-serif}
  form{width:min(22rem,calc(100vw - 2rem));display:grid;gap:.75rem}
  h1{margin:0 0 .25rem;font-size:1.375rem;font-weight:600}
  p{margin:0;color:#c5d1da}
  label{font-weight:500;margin-top:.5rem}
  input{font:inherit;font-size:16px;padding:.7rem .8rem;border-radius:.5rem;border:1px solid #4b5d69;background:#102a3b;color:#fff}
  input:focus{outline:2px solid #8ea0ff;outline-offset:2px}
  button{font:inherit;font-weight:600;padding:.75rem;border:0;border-radius:.5rem;background:#2a3fd6;color:#fff;cursor:pointer}
  button:focus-visible{outline:2px solid #8ea0ff;outline-offset:2px}
  .wrong{color:#f7c875}
</style></head>
<body><form method="post" action="/__unlock">
  <h1>OpenIslet preview</h1>
  <p>This is a private preview. Enter the password to continue.</p>
  ${wrong ? '<p class="wrong" role="alert">That password is not right.</p>' : ''}
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
  <input type="hidden" name="next" value="${escape(next)}">
  <button type="submit">Continue</button>
</form></body></html>`,
    { status: 401, headers: { 'content-type': 'text/html; charset=utf-8', ...closed } },
  );

export default {
  async fetch(request, env) {
    if (!env.STAGING_PASSWORD) return new Response('This preview is locked.', { status: 503, headers: { 'content-type': 'text/plain; charset=utf-8', ...closed } });
    const url = new URL(request.url);
    const expected = await token(env.STAGING_PASSWORD);
    if (url.pathname === '/__unlock' && request.method === 'POST') {
      const form = await request.formData();
      const next = safePath(form.get('next'));
      if (!same(await token(String(form.get('password') ?? '')), expected)) return page(next, true);
      return new Response(null, {
        status: 303,
        headers: { location: next, 'set-cookie': `${COOKIE}=${expected}; Path=/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax`, ...closed },
      });
    }
    if (same(cookieValue(request), expected)) {
      if (isMedia(url.pathname)) return serveMedia(request, env, { ...security, 'cache-control': 'private, no-store' });
      const res = await env.ASSETS.fetch(request);
      const out = new Response(res.body, res);
      out.headers.set('cache-control', 'private, no-store'); // never let a shared cache keep a page that sits behind the password
      for (const [name, value] of Object.entries(security)) out.headers.set(name, value);
      return out;
    }
    return page(url.pathname + url.search, false);
  },
};
