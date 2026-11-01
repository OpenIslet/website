#!/usr/bin/env node
// A small stand-in for GitHub, so the whole submission flow can be tried on this machine with no account and no network.
//
//   npm run mock-github          start it (first run: also writes .dev.vars with throwaway secrets)
//   npm run dev                  in a second terminal: the Worker, pointed at this mock by .dev.vars
//   open http://127.0.0.1:8788/_mock/    the issues the Worker has opened, as they would look on GitHub
//
// It answers only what the Worker calls:
//   GET  /login/oauth/authorize            "signs the person in" at once and sends the browser back with a one-time code
//   POST /login/oauth/access_token         swaps the code for a user token (checks the client secret, the redirect address, PKCE)
//   GET  /user                             who the user token belongs to
//   GET  /user/:id                         an account's username now, by its ID (as the bot)
//   DELETE /applications/:client/token     lets a user token go
//   POST /app/installations/:id/access_tokens   the bot's token (checks the app's signed JWT with the public half of your test key)
//   POST /repos/:owner/:repo/issues        opens an issue
//   POST /repos/:owner/:repo/issues/:n/comments
//   GET  /_mock/ and /_mock/issues         what it has received (page, and JSON)
//   POST /_mock/user, /_mock/mode, /_mock/reset   choose who signs in, switch on a failure to rehearse, start again
//
// Everything is kept in memory and goes when it stops. It listens on 127.0.0.1 only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const connector = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const devVarsPath = path.join(connector, '.dev.vars');
const examplePath = path.join(connector, '.dev.vars.example');

// ---------------------------------------------------------------------------------------------------------------
// Settings: the same .dev.vars the Worker reads, so the two always agree
// ---------------------------------------------------------------------------------------------------------------

export function parseDotenv(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) value = value.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
    else if (value.startsWith("'") && value.endsWith("'") && value.length >= 2) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

/** Writes .dev.vars from .dev.vars.example, replacing the three "make one for me" placeholders with fresh throwaway values. */
export function writeDevVars() {
  const example = fs.readFileSync(examplePath, 'utf8');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  const filled = example
    .replace('GENERATE_CLIENT_SECRET', crypto.randomBytes(20).toString('hex'))
    .replace('GENERATE_SIGNING_KEY', crypto.randomBytes(32).toString('base64'))
    .replace('GENERATE_PRIVATE_KEY', privateKey.trim().replace(/\n/g, '\\n'));
  fs.writeFileSync(devVarsPath, filled, { mode: 0o600 });
}

const args = process.argv.slice(2);
const argValue = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

if (args.includes('--help')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).map((l) => l.replace(/^\/\/ ?/, '')).join('\n'));
  process.exit(0);
}
if (args.includes('--init') || !fs.existsSync(devVarsPath)) {
  if (!fs.existsSync(examplePath)) {
    console.error('Cannot find .dev.vars.example next to this script.');
    process.exit(1);
  }
  if (fs.existsSync(devVarsPath) && !args.includes('--force')) {
    console.error('.dev.vars already exists. Delete it (or add --force) to make fresh throwaway values.');
    process.exit(1);
  }
  writeDevVars();
  console.log('Wrote .dev.vars with fresh throwaway secrets (nothing in it is real, and the file is not committed).');
  if (args.includes('--init')) process.exit(0);
}

const vars = parseDotenv(fs.readFileSync(devVarsPath, 'utf8'));
const need = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID'];
const missing = need.filter((k) => !vars[k] || vars[k].startsWith('GENERATE'));
if (missing.length) {
  console.error(`.dev.vars is missing ${missing.join(', ')}. Delete it and start again to make a fresh one.`);
  process.exit(1);
}
const PORT = Number(argValue('--port') ?? new URL(vars.GITHUB_WEB_BASE ?? 'http://127.0.0.1:8788').port ?? 8788) || 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const CLIENT_ID = vars.GITHUB_CLIENT_ID;
const CLIENT_SECRET = vars.GITHUB_CLIENT_SECRET;
const APP_ID = vars.GITHUB_APP_ID;
const INSTALLATION_ID = vars.GITHUB_APP_INSTALLATION_ID;
const SITE_ORIGIN = (vars.SITE_ORIGIN ?? 'http://localhost:4321').replace(/\/+$/, '');

// The public half of the app's key, so the bot's signed token can be checked the way GitHub checks it.
let appPublicKey = null;
try {
  appPublicKey = crypto.createPublicKey(vars.GITHUB_APP_PRIVATE_KEY);
} catch {
  console.warn('Note: GITHUB_APP_PRIVATE_KEY in .dev.vars is not a readable key, so the bot token request will not have its signature checked.');
}

// ---------------------------------------------------------------------------------------------------------------
// What it remembers
// ---------------------------------------------------------------------------------------------------------------

const state = {
  /** Who "signs in" next. Change it with POST /_mock/user, or with ?login=name on the authorize address. */
  user: { login: process.env.MOCK_GITHUB_LOGIN ?? 'mock-contributor', id: Number(process.env.MOCK_GITHUB_ID ?? 4242) },
  /** ok | down (every GitHub address answers 503) | refuse_code (the code swap fails) | decline (the person presses Cancel) | issues_fail (opening an issue fails) */
  mode: 'ok',
  codes: new Map(),
  userTokens: new Map(),
  /** Every account that has signed in: ID to its username now. */
  accounts: new Map(),
  installationTokens: new Map(),
  issues: [],
  log: [],
};

const note = (line) => {
  state.log.push(`${new Date().toISOString()} ${line}`);
  if (state.log.length > 200) state.log.shift();
  console.log(line);
};
const token = (prefix) => `${prefix}_${crypto.randomBytes(18).toString('hex')}`;
const b64urlToBuffer = (s) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ---------------------------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------------------------

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function send(res, status, body, headers = {}) {
  const isText = typeof body === 'string';
  res.writeHead(status, { 'content-type': isText ? 'text/html; charset=utf-8' : 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(body === undefined ? '' : isText ? body : JSON.stringify(body, null, 2));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4 * 1024 * 1024) throw new Error('body too large');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text) return {};
  // JSON, whatever the content-type says (curl -d sends form headers by default), else a form.
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return Object.fromEntries(new URLSearchParams(text));
  }
}

/** GitHub accepts a callback address only if it is one registered for the app. Here: the site's form page, the connector's /callback, on this machine. */
function redirectAllowed(uri) {
  try {
    const u = new URL(uri);
    if (uri === `${SITE_ORIGIN}/submit/finish`) return true;
    return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) && (u.pathname === '/submit/finish' || u.pathname === '/callback');
  } catch {
    return false;
  }
}

function userFromAuthorization(header) {
  const t = /^(?:Bearer|token)\s+(\S+)$/i.exec(header ?? '')?.[1];
  return t ? { token: t, user: state.userTokens.get(t) } : { token: null, user: undefined };
}

function checkAppJwt(header) {
  const jwt = /^Bearer\s+(\S+)$/i.exec(header ?? '')?.[1];
  const parts = jwt?.split('.');
  if (!parts || parts.length !== 3) return 'a JSON web token is required';
  let head;
  let claims;
  try {
    head = JSON.parse(b64urlToBuffer(parts[0]).toString());
    claims = JSON.parse(b64urlToBuffer(parts[1]).toString());
  } catch {
    return 'the token could not be decoded';
  }
  const now = Date.now() / 1000;
  if (head.alg !== 'RS256') return 'the token must be signed with RS256';
  if (String(claims.iss) !== APP_ID) return `the token's iss is not this app (${APP_ID})`;
  if (!(claims.iat <= now + 5)) return "the token's iat is in the future";
  if (!(claims.exp > now)) return 'the token has expired';
  if (claims.exp - now > 600) return "the token's exp is more than ten minutes away";
  if (appPublicKey && !crypto.verify('sha256', Buffer.from(`${parts[0]}.${parts[1]}`), appPublicKey, b64urlToBuffer(parts[2]))) return 'the token signature does not match the app key';
  return null;
}

function botFromAuthorization(header) {
  const t = /^(?:Bearer|token)\s+(\S+)$/i.exec(header ?? '')?.[1];
  const expires = t ? state.installationTokens.get(t) : undefined;
  return expires !== undefined && expires > Date.now();
}

// ---------------------------------------------------------------------------------------------------------------
// The pages
// ---------------------------------------------------------------------------------------------------------------

const PAGE_STYLE = 'body{font:16px/1.5 system-ui,sans-serif;max-width:56rem;margin:2rem auto;padding:0 1rem;color:#1b2430}pre{white-space:pre-wrap;background:#f3f1ec;padding:.75rem;border-radius:.4rem;overflow-wrap:anywhere}code{background:#f3f1ec;padding:0 .25rem}.label{display:inline-block;border:1px solid #888;border-radius:1rem;padding:0 .6rem;margin:0 .25rem .25rem 0;font-size:.85rem}.comment{border-left:4px solid #0b5cad;padding-left:1rem;margin:1rem 0}';

const page = (title, inner) => `<!doctype html><html lang="en-GB"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title><style>${PAGE_STYLE}</style><body>${inner}</body></html>`;

function indexPage() {
  const rows = state.issues
    .map((i) => `<li><a href="/${escapeHtml(i.repo)}/issues/${i.number}">#${i.number} ${escapeHtml(i.title)}</a> <small>(${i.comments.length} comment${i.comments.length === 1 ? '' : 's'})</small></li>`)
    .join('');
  return page(
    'Mock GitHub',
    `<h1>Mock GitHub</h1>
<p>This is a stand-in for GitHub, on your machine only. Next sign-in will be <code>${escapeHtml(state.user.login)}</code> (id ${state.user.id}). Mode: <code>${escapeHtml(state.mode)}</code>.</p>
<h2>Issues the Worker has opened (${state.issues.length})</h2>
<ul>${rows || '<li>None yet.</li>'}</ul>
<p>The same as data: <a href="/_mock/issues">/_mock/issues</a>. Change who signs in: <code>curl -X POST ${BASE}/_mock/user -d '{"login":"someone","id":99}'</code>. Rehearse a failure: <code>curl -X POST ${BASE}/_mock/mode -d '{"mode":"down"}'</code> (modes: ok, down, refuse_code, decline, issues_fail). Start again: <code>curl -X POST ${BASE}/_mock/reset</code>.</p>`,
  );
}

function issuePage(issue) {
  const labels = issue.labels.map((l) => `<span class="label">${escapeHtml(l)}</span>`).join('');
  const comments = issue.comments.map((c) => `<div class="comment"><strong>openislet-bot</strong> commented<pre>${escapeHtml(c)}</pre></div>`).join('');
  return page(
    `#${issue.number} ${issue.title}`,
    `<p><a href="/_mock/">All issues</a></p><h1>${escapeHtml(issue.title)} <small>#${issue.number}</small></h1><p>${labels}</p>
<p>This is the raw text of the issue body. On GitHub it would be shown as Markdown.</p><pre>${escapeHtml(issue.body)}</pre>${comments}`,
  );
}

// ---------------------------------------------------------------------------------------------------------------
// The routes
// ---------------------------------------------------------------------------------------------------------------

async function handle(req, res) {
  const url = new URL(req.url ?? '/', BASE);
  const route = `${req.method} ${url.pathname}`;

  // ---- The mock's own controls ----
  if (url.pathname.startsWith('/_mock')) {
    if (route === 'GET /_mock/' || route === 'GET /_mock') return send(res, 200, indexPage());
    if (route === 'GET /_mock/issues') return send(res, 200, state.issues);
    if (route === 'GET /_mock/state') return send(res, 200, { user: state.user, mode: state.mode, issues: state.issues.length, recent: state.log.slice(-20) });
    if (route === 'POST /_mock/reset') {
      for (const k of ['codes', 'userTokens', 'accounts', 'installationTokens']) state[k].clear();
      state.issues.length = 0;
      state.mode = 'ok';
      note('reset');
      return send(res, 200, { ok: true });
    }
    if (route === 'POST /_mock/mode') {
      const { mode } = await readBody(req);
      if (!['ok', 'down', 'refuse_code', 'decline', 'issues_fail'].includes(mode)) return send(res, 400, { error: 'mode must be ok, down, refuse_code, decline or issues_fail' });
      state.mode = mode;
      note(`mode ${mode}`);
      return send(res, 200, { mode });
    }
    if (route === 'POST /_mock/user') {
      const { login, id } = await readBody(req);
      if (typeof login !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,38}$/.test(login)) return send(res, 400, { error: 'login should look like a GitHub username' });
      state.user = { login, id: Number.isSafeInteger(id) && id > 0 ? id : crypto.randomInt(10_000, 9_000_000) };
      note(`next sign-in is ${login}`);
      return send(res, 200, state.user);
    }
    return send(res, 404, { error: 'unknown control' });
  }

  // The issue pages the Worker links to.
  const issueView = /^\/([^/]+\/[^/]+)\/issues\/(\d+)$/.exec(url.pathname);
  if (req.method === 'GET' && issueView) {
    const issue = state.issues.find((i) => i.number === Number(issueView[2]));
    return issue ? send(res, 200, issuePage(issue)) : send(res, 404, page('Not found', '<h1>Not found</h1>'));
  }

  if (state.mode === 'down') {
    note(`503 ${route} (mode down)`);
    return send(res, 503, { message: 'The mock is pretending GitHub is down.' });
  }

  // ---- The contributor signs in ----
  if (route === 'GET /login/oauth/authorize') {
    const q = url.searchParams;
    if (q.get('client_id') !== CLIENT_ID) return send(res, 404, page('Not found', '<h1>404</h1><p>The mock does not know that client_id. Check GITHUB_CLIENT_ID in .dev.vars.</p>'));
    const redirect = q.get('redirect_uri') ?? '';
    if (!redirectAllowed(redirect)) return send(res, 422, page('Redirect problem', `<h1>Redirect URI mismatch</h1><p><code>${escapeHtml(redirect)}</code> is not a callback address the mock accepts (the site's /submit/finish or the connector's /callback on this machine).</p>`));
    const back = new URL(redirect);
    if (q.get('state')) back.searchParams.set('state', q.get('state'));
    if (state.mode === 'decline') {
      back.searchParams.set('error', 'access_denied');
      back.searchParams.set('error_description', 'The user has denied your application access.');
      note('person pressed Cancel (mode decline)');
      return send(res, 302, '', { location: back.href });
    }
    const user = q.get('login') ? { login: q.get('login'), id: Number(q.get('id')) || crypto.randomInt(10_000, 9_000_000) } : state.user;
    const code = token('code');
    state.accounts.set(user.id, user.login);
    state.codes.set(code, { user, clientId: CLIENT_ID, redirect, challenge: q.get('code_challenge') ?? null, method: q.get('code_challenge_method') ?? null, used: false, at: Date.now() });
    back.searchParams.set('code', code);
    note(`signed ${user.login} in, sent the browser back to ${back.origin}${back.pathname}`);
    return send(res, 302, '', { location: back.href });
  }

  if (route === 'POST /login/oauth/access_token') {
    const body = await readBody(req);
    const fail = (error, error_description) => send(res, 200, { error, error_description });
    if (body.client_id !== CLIENT_ID || body.client_secret !== CLIENT_SECRET) return fail('incorrect_client_credentials', 'The client_id and/or client_secret passed are incorrect.');
    const c = state.codes.get(body.code);
    if (state.mode === 'refuse_code' || !c || c.used || Date.now() - c.at > 10 * 60_000) {
      note('refused a code (unknown, used, expired, or mode refuse_code)');
      return fail('bad_verification_code', 'The code passed is incorrect or expired.');
    }
    if (body.redirect_uri && body.redirect_uri !== c.redirect) return fail('redirect_uri_mismatch', 'The redirect_uri MUST match the registered callback URL for this application.');
    if (c.challenge) {
      const wanted = crypto.createHash('sha256').update(String(body.code_verifier ?? '')).digest('base64url');
      if (c.method !== 'S256' || wanted !== c.challenge) return fail('bad_verification_code', 'The code_verifier does not match the code_challenge.');
    }
    c.used = true;
    const t = token('ghu');
    state.userTokens.set(t, c.user);
    note(`gave ${c.user.login} a user token`);
    return send(res, 200, { access_token: t, token_type: 'bearer', scope: '' });
  }

  if (route === 'GET /user') {
    const { user } = userFromAuthorization(req.headers.authorization);
    if (!user) return send(res, 401, { message: 'Bad credentials' });
    return send(res, 200, { login: user.login, id: user.id, type: 'User', site_admin: false });
  }

  const byId = /^\/user\/(\d+)$/.exec(url.pathname);
  if (req.method === 'GET' && byId) {
    if (!botFromAuthorization(req.headers.authorization)) return send(res, 401, { message: 'Bad credentials' });
    const login = state.accounts.get(Number(byId[1]));
    return login ? send(res, 200, { login, id: Number(byId[1]), type: 'User', site_admin: false }) : send(res, 404, { message: 'Not Found' });
  }

  const revoke = /^\/applications\/([^/]+)\/token$/.exec(url.pathname);
  if (req.method === 'DELETE' && revoke) {
    const basic = /^Basic\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (!basic || Buffer.from(basic, 'base64').toString() !== `${CLIENT_ID}:${CLIENT_SECRET}`) return send(res, 401, { message: 'Bad credentials' });
    const { access_token } = await readBody(req);
    state.userTokens.delete(access_token);
    note('a user token was let go');
    return send(res, 204, undefined);
  }

  // ---- The bot ----
  const mint = /^\/app\/installations\/(\d+)\/access_tokens$/.exec(url.pathname);
  if (req.method === 'POST' && mint) {
    const problem = checkAppJwt(req.headers.authorization);
    if (problem) {
      note(`refused the app token: ${problem}`);
      return send(res, 401, { message: problem });
    }
    if (mint[1] !== INSTALLATION_ID) return send(res, 404, { message: 'Not Found' });
    const body = await readBody(req);
    const t = token('ghs');
    const expires = Date.now() + 60 * 60_000;
    state.installationTokens.set(t, expires);
    note(`minted a bot token for ${JSON.stringify(body.repositories ?? 'all repositories')}`);
    return send(res, 201, { token: t, expires_at: new Date(expires).toISOString(), permissions: body.permissions ?? { issues: 'write' }, repository_selection: 'selected' });
  }

  const issues = /^\/repos\/([^/]+\/[^/]+)\/issues$/.exec(url.pathname);
  if (req.method === 'POST' && issues) {
    if (!botFromAuthorization(req.headers.authorization)) return send(res, 401, { message: 'Bad credentials' });
    if (state.mode === 'issues_fail') {
      note('refused to open an issue (mode issues_fail)');
      return send(res, 500, { message: 'The mock is pretending issue creation fails.' });
    }
    const body = await readBody(req);
    if (typeof body.title !== 'string' || !body.title.trim()) return send(res, 422, { message: 'Validation Failed', errors: [{ resource: 'Issue', field: 'title', code: 'missing_field' }] });
    if (typeof body.body === 'string' && body.body.length > 65536) return send(res, 422, { message: 'Validation Failed', errors: [{ resource: 'Issue', field: 'body', code: 'custom', message: 'body is too long (maximum is 65536 characters)' }] });
    const issue = { number: state.issues.length + 1, repo: issues[1], title: body.title, body: typeof body.body === 'string' ? body.body : '', labels: Array.isArray(body.labels) ? body.labels.map(String) : [], comments: [], created_at: new Date().toISOString() };
    state.issues.push(issue);
    note(`opened issue #${issue.number} "${issue.title.slice(0, 60)}"`);
    return send(res, 201, { number: issue.number, html_url: `${BASE}/${issue.repo}/issues/${issue.number}`, title: issue.title, state: 'open', labels: issue.labels.map((name) => ({ name })) });
  }

  const comments = /^\/repos\/([^/]+\/[^/]+)\/issues\/(\d+)\/comments$/.exec(url.pathname);
  if (req.method === 'POST' && comments) {
    if (!botFromAuthorization(req.headers.authorization)) return send(res, 401, { message: 'Bad credentials' });
    const issue = state.issues.find((i) => i.number === Number(comments[2]));
    if (!issue) return send(res, 404, { message: 'Not Found' });
    const { body } = await readBody(req);
    issue.comments.push(String(body ?? ''));
    note(`commented on #${issue.number}`);
    return send(res, 201, { id: issue.comments.length, body });
  }

  note(`404 ${route}`);
  return send(res, 404, { message: `The mock does not handle ${route}` });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((error) => {
    note(`error in ${req.method} ${req.url}: ${error.message}`);
    if (!res.headersSent) send(res, 500, { message: 'The mock failed.' });
  });
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nMock GitHub is listening on ${BASE}`);
  console.log(`  See what it receives:   ${BASE}/_mock/`);
  console.log(`  Next sign-in is:        ${state.user.login}  (change it: curl -X POST ${BASE}/_mock/user -d '{"login":"someone"}')`);
  console.log(`  The Worker should have GITHUB_WEB_BASE and GITHUB_API_BASE set to ${BASE} (.dev.vars does that).`);
  console.log('  Stop it with Ctrl+C.\n');
});
