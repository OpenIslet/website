// The connector's own sign-in for AI apps, and what it does to /mcp: reading stays open, a good token adds who is signed in,
// a bad token is told to sign in again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
// @ts-expect-error The script is plain JavaScript, shared with the command line.
import { prefixesFor, signedOutRecord } from '../scripts/sign-out-account.mjs';
import { SIGNED_OUT_TTL_SECONDS, signedOutKey } from '../src/connector-oauth';
import { SIGN_IN_BODY_MAX_BYTES, SIGN_IN_FORM_FIELDS_MAX } from '../src/connector-oauth';
import { makeDraft, makeReview, shownQuote } from './fixtures';
import { Jar, PUBLIC_ORIGIN, type World, callTool, installWorld, makeWorld, readRpc, req, restore, rpcRequest, signIn } from './queue-fakes';

vi.mock('agents/mcp', async () => import('agents/mcp/server'));

const f = shownQuote();
const draft = makeDraft({ evidence: [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`] });
const review = makeReview();
const ADA = { id: 1234, login: 'octo-cat' };
const INIT = { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'oauth-test', version: '1.0.0' } };

let world: World;
async function setup(vars: Parameters<typeof makeWorld>[0] = {}) {
  restore();
  world = await makeWorld(vars);
  installWorld(world);
}
beforeEach(async () => setup());
afterEach(restore);

const json = async (res: Response) => (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const read = (o: { token?: string; origin?: string; host?: string } = {}) => {
  const r = rpcRequest('tools/list', {}, o);
  if (o.host) r.headers.set('host', o.host);
  return world.call(r);
};

describe('/mcp stays open for reading', () => {
  it('serves a request with no Authorization header, whether or not sign-in is set up', async () => {
    for (const vars of [{}, { OAUTH_KV: undefined, QUEUE_KV: undefined, SUBMISSIONS_OPEN: undefined }]) {
      await setup(vars);
      const init = await world.call(rpcRequest('initialize', INIT));
      expect(init.status).toBe(200);
      expect(JSON.stringify(await readRpc(init))).toContain('openislet');
      const tools = await readRpc(await read());
      expect(tools.result.tools.map((t: { name: string }) => t.name)).toHaveLength(12);
      const answer = await callTool(world, 'get_blueprint_overview', {});
      expect(answer.result?.isError).toBeFalsy();
      expect(answer.result?.content[0].text).toContain('Islet-1');
    }
  });

  it('writes nothing to either store when someone only reads', async () => {
    await callTool(world, 'get_blueprint_overview', {});
    await read();
    expect(world.kv.writeCount + world.oauthKv.writeCount).toBe(0);
  });

  it('answers a bad token with 401 and a pointer to the sign-in', async () => {
    const res = await read({ token: 'not-a-real-token' });
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate')!;
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(`resource_metadata="${PUBLIC_ORIGIN}/.well-known/oauth-protected-resource/mcp"`);
    expect(challenge).toContain('error="invalid_token"');
    expect(challenge).toContain('scope="submit"');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it.each(['Bearer', 'Bearer ', 'Bearer a b', 'Basic dXNlcjpwYXNz', 'Token abc', ''])('answers the Authorization header %j with 401 too', async (authorization) => {
    const r = rpcRequest('tools/list', {});
    r.headers.set('authorization', authorization);
    const res = await world.call(r);
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('resource_metadata=');
  });

  it('answers an expired token with 401, and a fresh sign-in works again', async () => {
    const t = await signIn(world, ADA);
    expect((await read({ token: t.accessToken })).status).toBe(200);
    world.clock.advance(3600 + 5);
    const expired = await read({ token: t.accessToken });
    expect(expired.status).toBe(401);
    expect(expired.headers.get('www-authenticate')).toContain('error="invalid_token"');
    // The refresh token gets a new one.
    const refreshed = await world.call(req('/token', { form: { grant_type: 'refresh_token', refresh_token: t.refreshToken!, client_id: t.clientId } }));
    expect(refreshed.status).toBe(200);
    const next = (await json(refreshed)).access_token as string;
    expect((await read({ token: next })).status).toBe(200);
  });

  it('can be ended early for one account by deleting the keys scripts/sign-out-account.mjs deletes', async () => {
    const t = await signIn(world, ADA);
    const other = await signIn(world, { id: 99, login: 'someone-else' });
    expect((await read({ token: t.accessToken })).status).toBe(200);
    const prefixes = prefixesFor(ADA.id);
    const keys = world.oauthKv.keys().filter((k) => prefixes.some((p: string) => k.startsWith(p)));
    // If a new version of the sign-in library renamed its keys, this would stop finding them.
    expect(keys.some((k) => k.startsWith('grant:'))).toBe(true);
    expect(keys.some((k) => k.startsWith('token:'))).toBe(true);
    for (const k of keys) await world.oauthKv.delete(k);
    expect((await read({ token: t.accessToken })).status).toBe(401);
    const refreshed = await world.call(req('/token', { form: { grant_type: 'refresh_token', refresh_token: t.refreshToken!, client_id: t.clientId } }));
    expect(refreshed.status).toBe(400);
    expect((await read({ token: other.accessToken })).status).toBe(200);
    expect(() => prefixesFor('octo-cat')).toThrow(/number, not the name/);
  });

  it('stays signed out when a refresh under way writes the approval back after the keys are deleted', async () => {
    const t = await signIn(world, ADA);
    expect((await read({ token: t.accessToken })).status).toBe(200);
    // What the script writes first. The keys are left in place here, as a refresh that read them just before would put them back.
    const record = signedOutRecord(ADA.id);
    expect(record.key).toBe(signedOutKey(ADA.id));
    expect(record.ttl).toBe(SIGNED_OUT_TTL_SECONDS);
    await world.oauthKv.put(record.key, record.value);
    expect((await read({ token: t.accessToken })).status).toBe(401);
    const refreshed = await world.call(req('/token', { form: { grant_type: 'refresh_token', refresh_token: t.refreshToken!, client_id: t.clientId } }));
    if (refreshed.status === 200) expect((await read({ token: (await json(refreshed)).access_token as string })).status).toBe(401);
    // Approving the app again afterwards works.
    world.clock.advance(60);
    const again = await signIn(world, ADA);
    expect((await read({ token: again.accessToken })).status).toBe(200);
    expect(() => signedOutRecord('octo-cat')).toThrow(/number, not the name/);
  });

  it('keeps an AI app signed in for seven days, then asks the person to sign in again', async () => {
    const t = await signIn(world, ADA);
    world.clock.advance(6 * 24 * 3600);
    const week = await world.call(req('/token', { form: { grant_type: 'refresh_token', refresh_token: t.refreshToken!, client_id: t.clientId } }));
    expect(week.status).toBe(200);
    const nextRefresh = (await json(week)).refresh_token as string;
    world.clock.advance(24 * 3600 + 120);
    const late = await world.call(req('/token', { form: { grant_type: 'refresh_token', refresh_token: nextRefresh, client_id: t.clientId } }));
    expect(late.status).toBe(400);
    expect((await json(late)).error).toBe('invalid_grant');
  });

  it('ignores an Authorization header while sign-in is switched off, so closing the queue never breaks reading', async () => {
    await setup({ SUBMISSIONS_OPEN: 'false' });
    const res = await read({ token: 'a-token-from-before' });
    expect(res.status).toBe(200);
  });

  it('keeps the host and origin rules for a signed-in caller', async () => {
    const t = await signIn(world, ADA);
    expect((await read({ token: t.accessToken })).status).toBe(200);
    expect((await read({ token: t.accessToken, origin: 'http://localhost:4321' })).status).toBe(200);
    expect((await read({ token: t.accessToken, origin: 'https://openislet.org' })).status).toBe(403);
    expect((await read({ token: t.accessToken, origin: 'https://evil.example' })).status).toBe(403);
    for (const host of ['evil.example', 'mcp.openislet.org.evil.example']) expect((await read({ token: t.accessToken, host })).status, host).toBe(403);
    // A bad token from an address we do not answer on is a 403 from the MCP rules, not a hint about sign-in.
    expect((await read({ token: 'bad', host: 'evil.example' })).status).toBe(403);
  });

  it('answers a valid token the same way it answers an anonymous caller', async () => {
    const t = await signIn(world, ADA);
    const signedIn = await callTool(world, 'list_versions', {}, { token: t.accessToken });
    const anonymous = await callTool(world, 'list_versions', {});
    expect(signedIn.result?.structuredContent).toEqual(anonymous.result?.structuredContent);
  });
});

describe('the two discovery documents', () => {
  it('describes the protected resource (/mcp) and the sign-in it relies on', async () => {
    for (const path of ['/.well-known/oauth-protected-resource/mcp', '/.well-known/oauth-protected-resource']) {
      const res = await world.call(req(path));
      expect(res.status, path).toBe(200);
      expect(await json(res)).toMatchObject({
        resource: `${PUBLIC_ORIGIN}/mcp`,
        authorization_servers: [PUBLIC_ORIGIN],
        scopes_supported: ['submit'],
        bearer_methods_supported: ['header'],
      });
    }
  });

  it('describes the sign-in server: its addresses, PKCE S256 and the one scope', async () => {
    const res = await world.call(req('/.well-known/oauth-authorization-server'));
    expect(res.status).toBe(200);
    const doc = await json(res);
    expect(doc).toMatchObject({
      issuer: PUBLIC_ORIGIN,
      authorization_endpoint: `${PUBLIC_ORIGIN}/authorize`,
      token_endpoint: `${PUBLIC_ORIGIN}/token`,
      registration_endpoint: `${PUBLIC_ORIGIN}/register`,
      scopes_supported: ['submit'],
      response_types_supported: ['code'],
      code_challenge_methods_supported: ['S256'],
    });
    expect(doc.grant_types_supported).toEqual(expect.arrayContaining(['authorization_code', 'refresh_token']));
  });

  it('is built on the address the connector was reached at, but only for its own hosts', async () => {
    const local = await world.call(req('/.well-known/oauth-authorization-server', { base: 'http://localhost:8787' }));
    expect((await json(local)).issuer).toBe('http://localhost:8787');
    const resource = await world.call(req('/.well-known/oauth-protected-resource/mcp', { base: 'http://127.0.0.1:8787' }));
    expect((await json(resource)).resource).toBe('http://127.0.0.1:8787/mcp');
    const stranger = await world.call(req('/.well-known/oauth-authorization-server', { host: 'evil.example' }));
    expect(stranger.status).toBe(403);
    const plain = await world.call(req('/.well-known/oauth-authorization-server', { base: 'http://mcp.openislet.org' }));
    expect(plain.status).toBe(403);
    const plainStaging = await world.call(req('/.well-known/oauth-authorization-server', { base: 'http://mcp-staging.openislet.org' }));
    expect(plainStaging.status).toBe(403);
    const staging = await world.call(req('/.well-known/oauth-authorization-server', { base: 'https://mcp-staging.openislet.org' }));
    expect((await json(staging)).issuer).toBe('https://mcp-staging.openislet.org');
  });

  it('does not exist while submissions are closed or sign-in is not set up', async () => {
    for (const vars of [{ SUBMISSIONS_OPEN: 'false' }, { OAUTH_KV: undefined }, { GITHUB_CLIENT_SECRET: undefined }]) {
      await setup(vars);
      expect((await world.call(req('/.well-known/oauth-authorization-server'))).status, JSON.stringify(vars)).toBe(404);
      expect((await world.call(req('/.well-known/oauth-protected-resource/mcp'))).status).toBe(404);
      const authorize = await world.call(req('/authorize?response_type=code'));
      expect(authorize.status).toBe(503);
      const unavailable = await authorize.text();
      expect(unavailable).toContain('not available');
      expect(unavailable).toContain('Sending an Islet Improvement Proposal (IIP) from an AI app is not switched on yet');
      expect((await world.call(req('/register', { json: { redirect_uris: ['http://localhost:1/cb'] } }))).status).toBe(503);
      expect(world.oauthKv.writeCount).toBe(0);
    }
  });
});

describe('registering an app', () => {
  const register = (redirect = 'http://localhost:53682/callback', ip = '198.51.100.9', name = 'Test AI app') =>
    world.call(req('/register', { json: { client_name: name, redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] }, ip }));

  it('registers a public client, as MCP apps do', async () => {
    const res = await register();
    expect(res.status).toBe(201);
    expect(await json(res)).toMatchObject({ client_name: 'Test AI app', redirect_uris: ['http://localhost:53682/callback'], token_endpoint_auth_method: 'none' });
  });

  it('refuses a redirect address that is neither https nor local', async () => {
    const res = await register('http://example.org/callback');
    expect(res.status).toBe(400);
  });

  it('allows 200 registrations an hour from one address (an AI app registers everyone from its own few servers)', async () => {
    for (let i = 0; i < 200; i++) expect((await register('http://localhost:53682/callback', '198.51.100.20')).status).toBe(201);
    const limited = await register('http://localhost:53682/callback', '198.51.100.20');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^\d+$/);
    expect((await json(limited)).error).toBe('temporarily_unavailable');
    expect((await register('http://localhost:53682/callback', '198.51.100.21')).status).toBe(201);
  });
});

describe('the approval page', () => {
  async function open(o: { name?: string; redirect?: string } = {}) {
    const redirect = o.redirect ?? 'http://localhost:53682/callback';
    const reg = await world.call(req('/register', { json: { client_name: o.name ?? 'Test AI app', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] } }));
    const { client_id } = await json(reg);
    const q = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: redirect, scope: 'submit', state: 'xyz', code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', resource: `${PUBLIC_ORIGIN}/mcp` });
    const res = await world.call(req(`/authorize?${q}`));
    const jar = new Jar();
    jar.take(res);
    const html = await res.text();
    return { res, html, jar, handle: /name="handle" value="([^"]+)"/.exec(html)?.[1] ?? '', redirect };
  }

  it('is a plain page that says who is asking, where the person goes next, and what is shared', async () => {
    const { res, html } = await open();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(html).toContain('<html lang="en-GB">');
    expect(html).toContain('<title>');
    expect(html).toContain('Test AI app');
    expect(html).toContain('localhost'); // where the sign-in goes back to
    expect(html).toMatch(/public profile/);
    expect(html).toMatch(/CC BY 4\.0/);
    expect(html).toContain('send Islet Improvement Proposals (IIPs) to OpenIslet as you');
    expect(html).not.toMatch(/finding/i);
    expect(html).toMatch(/Continue with GitHub/);
    expect(html).toMatch(/Cancel/);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/ORCID/i);
    expect(html).toContain('This sends the sign-in back to an app on your own computer');
  });

  it('cannot be framed, cached, or made to run script, and binds itself to this browser with a cookie', async () => {
    const { res } = await open();
    expect(res.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-store');
    const cookies = res.headers.getSetCookie().join('\n');
    expect(cookies).toMatch(/__Host-oauth-consent-/);
    expect(cookies).toMatch(/Secure/);
    expect(cookies).toMatch(/HttpOnly/);
    expect(cookies).toMatch(/SameSite=Lax/);
  });

  it('escapes everything the app supplied', async () => {
    const { html } = await open({ name: '<script>alert(1)</script> "quoted" & more' });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&#60;script&#62;alert(1)&#60;/script&#62;');
    expect(html).toContain('&#34;quoted&#34; &#38; more');
  });

  it('does not show the on-your-computer warning for a web address', async () => {
    const { html } = await open({ redirect: 'https://claude.ai/api/mcp/auth_callback' });
    expect(html).not.toContain('app on your own computer');
    expect(html).toContain('claude.ai');
  });

  it('sends Cancel back to the app as access_denied, with its own state', async () => {
    const { handle, jar, redirect } = await open();
    const res = await world.call(req('/authorize', { form: { handle, decision: 'deny' }, headers: jar.header() }));
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(to.origin + to.pathname).toBe(redirect);
    expect(to.searchParams.get('error')).toBe('access_denied');
    expect(to.searchParams.get('state')).toBe('xyz');
    expect(to.searchParams.get('iss')).toBe(PUBLIC_ORIGIN);
    expect(world.github.requests).toHaveLength(0);
  });

  it('sends Continue on to GitHub, and only then: the GitHub login asks for nothing but the public profile', async () => {
    const { handle, jar } = await open();
    const res = await world.call(req('/authorize', { form: { handle, decision: 'approve' }, headers: jar.header() }));
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(to.origin + to.pathname).toBe('https://github.test/login/oauth/authorize');
    expect(to.searchParams.get('client_id')).toBe(world.github.clientId);
    expect(to.searchParams.get('redirect_uri')).toBe(`${PUBLIC_ORIGIN}/callback`);
    expect(to.searchParams.get('allow_signup')).toBe('true');
    expect(to.searchParams.get('scope')).toBeNull();
    expect(to.searchParams.get('code_challenge_method')).toBe('S256');
    expect(to.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(to.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(res.headers.getSetCookie().join('\n')).toMatch(/__Host-oauth-upstream-/);
  });

  it('refuses an approval that did not come from the browser that saw the page, and one used twice', async () => {
    const { handle, jar } = await open();
    const forged = await world.call(req('/authorize', { form: { handle, decision: 'approve' } })); // no cookie
    expect(forged.status).toBe(400);
    expect(await forged.text()).toMatch(/start connecting again|start again/i);
    const ok = await world.call(req('/authorize', { form: { handle, decision: 'approve' }, headers: jar.header() }));
    expect(ok.status).toBe(302);
    const twice = await world.call(req('/authorize', { form: { handle, decision: 'approve' }, headers: jar.header() }));
    expect(twice.status).toBe(400);
  });

  it('shows a plain message, and does not redirect, when the app or its address is not one it knows', async () => {
    const res = await world.call(req(`/authorize?${new URLSearchParams({ response_type: 'code', client_id: 'nobody', redirect_uri: 'http://localhost:1/cb', state: 's', code_challenge: 'c'.repeat(43), code_challenge_method: 'S256' })}`));
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('refuses an app that does not use PKCE', async () => {
    const reg = await world.call(req('/register', { json: { client_name: 'No PKCE', redirect_uris: ['http://localhost:1/cb'], token_endpoint_auth_method: 'none' } }));
    const { client_id } = await json(reg);
    const res = await world.call(req(`/authorize?${new URLSearchParams({ response_type: 'code', client_id, redirect_uri: 'http://localhost:1/cb', state: 's', resource: `${PUBLIC_ORIGIN}/mcp` })}`));
    // Sent back to the app as an error, or shown as a message: either way there is no approval page.
    expect(await res.text()).not.toContain('name="handle"');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('only answers on its own hosts', async () => {
    const res = await world.call(req('/authorize?response_type=code', { host: 'evil.example' }));
    expect(res.status).toBe(403);
  });

  it('shows a plain message, not an error page, when the form cannot be read', async () => {
    const res = await world.call(req('/authorize', { text: 'not a form', contentType: 'text/plain', method: 'POST' }));
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toMatch(/could not be read/);
  });

  it('opens 30 times an hour from one address, then pauses with a plain page and saves nothing more', async () => {
    const reg = await world.call(req('/register', { json: { client_name: 'Test AI app', redirect_uris: ['http://localhost:53682/callback'], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] } }));
    const { client_id } = await json(reg);
    const q = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: 'http://localhost:53682/callback', scope: 'submit', state: 'xyz', code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', resource: `${PUBLIC_ORIGIN}/mcp` });
    for (let i = 0; i < 30; i++) expect((await world.call(req(`/authorize?${q}`, { ip: '198.51.100.30' }))).status).toBe(200);
    const saved = (await world.oauthKv.list()).keys.length;
    const paused = await world.call(req(`/authorize?${q}`, { ip: '198.51.100.30' }));
    expect(paused.status).toBe(429);
    expect(paused.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(paused.headers.get('content-type')).toContain('text/html');
    expect(await paused.text()).toMatch(/Sign-in paused[\s\S]*wait about \d+ minutes?/);
    expect((await world.oauthKv.list()).keys.length).toBe(saved);
    expect((await world.call(req(`/authorize?${q}`, { ip: '198.51.100.31' }))).status).toBe(200);
  });
});

describe('coming back from GitHub (/callback)', () => {
  async function toGitHub() {
    const redirect = 'http://localhost:53682/callback';
    const reg = await world.call(req('/register', { json: { client_name: 'Test AI app', redirect_uris: [redirect], token_endpoint_auth_method: 'none', grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'] } }));
    const { client_id } = await json(reg);
    const jar = new Jar();
    const q = new URLSearchParams({ response_type: 'code', client_id, redirect_uri: redirect, scope: 'submit', state: 'app-state', code_challenge: 'c'.repeat(43), code_challenge_method: 'S256', resource: `${PUBLIC_ORIGIN}/mcp` });
    const page = await world.call(req(`/authorize?${q}`));
    jar.take(page);
    const handle = /name="handle" value="([^"]+)"/.exec(await page.text())![1];
    const approved = await world.call(req('/authorize', { form: { handle, decision: 'approve' }, headers: jar.header() }));
    jar.take(approved);
    const to = new URL(approved.headers.get('location')!);
    return { jar, state: to.searchParams.get('state')!, challenge: to.searchParams.get('code_challenge')!, redirect };
  }
  const callback = (s: { jar: Jar; state: string }, params: Record<string, string>) => world.call(req(`/callback?${new URLSearchParams({ state: s.state, ...params })}`, { headers: s.jar.header() }));

  it('hands the app a code of our own and lets the GitHub token go', async () => {
    const s = await toGitHub();
    const res = await callback(s, { code: world.github.issueCode(ADA) });
    expect(res.status).toBe(302);
    const to = new URL(res.headers.get('location')!);
    expect(to.origin + to.pathname).toBe(s.redirect);
    expect(to.searchParams.get('code')).toBeTruthy();
    expect(to.searchParams.get('state')).toBe('app-state');
    expect(to.searchParams.get('iss')).toBe(PUBLIC_ORIGIN);
    await world.ctx.flush();
    expect(world.github.revoked).toHaveLength(1);
    expect(to.href).not.toContain('ghu_');
  });

  it('tells the app when the person said no to GitHub, or GitHub said no to us', async () => {
    let s = await toGitHub();
    let to = new URL((await callback(s, { error: 'access_denied' })).headers.get('location')!);
    expect(to.searchParams.get('error')).toBe('access_denied');
    expect(to.searchParams.get('state')).toBe('app-state');
    s = await toGitHub();
    to = new URL((await callback(s, { code: 'a-code-github-never-made' })).headers.get('location')!);
    expect(to.searchParams.get('error')).toBe('access_denied');
    s = await toGitHub();
    world.github.failNext(/access_token/, 503, 'down');
    to = new URL((await callback(s, { code: world.github.issueCode(ADA) })).headers.get('location')!);
    expect(to.searchParams.get('error')).toBe('temporarily_unavailable');
    s = await toGitHub();
    to = new URL((await callback(s, {})).headers.get('location')!);
    expect(to.searchParams.get('error')).toBe('invalid_request');
  });

  it('tells the app the fault is ours when GitHub refuses our own client details', async () => {
    const s = await toGitHub();
    world.github.failNext(/access_token/, 200, { error: 'incorrect_client_credentials' });
    const to = new URL((await callback(s, { code: world.github.issueCode(ADA) })).headers.get('location')!);
    expect(to.searchParams.get('error')).toBe('temporarily_unavailable');
    expect(to.searchParams.get('error_description')).toMatch(/fault on our side, not yours/);
    expect(to.searchParams.get('error_description')).not.toMatch(/secret|client/i);
  });

  it('shows a plain message for a state it does not know, one used before, or one from another browser', async () => {
    const s = await toGitHub();
    const unknown = await world.call(req(`/callback?${new URLSearchParams({ state: 'nope', code: 'x' })}`, { headers: s.jar.header() }));
    expect(unknown.status).toBe(400);
    const otherBrowser = await world.call(req(`/callback?${new URLSearchParams({ state: s.state, code: world.github.issueCode(ADA) })}`));
    expect(otherBrowser.status).toBe(400);
    expect(world.github.requests.filter((r) => r.url.includes('access_token'))).toHaveLength(0);
    expect((await callback(s, { code: world.github.issueCode(ADA) })).status).toBe(302);
    expect((await callback(s, { code: world.github.issueCode(ADA) })).status).toBe(400);
  });
});

describe('the token', () => {
  it('stores only the GitHub number and username, and none of the GitHub tokens or secrets', async () => {
    const t = await signIn(world, ADA);
    const stored = world.oauthKv.dump();
    expect(stored).not.toContain(world.github.clientSecret);
    expect(stored).not.toContain('ghu_');
    expect(stored).not.toContain(t.accessToken);
    expect(stored).not.toContain(t.refreshToken!);
    expect(world.oauthKv.keys().some((k) => k.startsWith('token:1234:'))).toBe(true);
    expect(world.oauthKv.keys().some((k) => k.startsWith('grant:1234:'))).toBe(true);
    expect(world.kv.dump()).not.toContain('octo-cat'); // the queue's own store never learns the name from the sign-in
  });

  it('is refused for a wrong PKCE verifier, and a code works once', async () => {
    const t = await signIn(world, ADA);
    expect(t.accessToken).toBeTruthy();
    const reuse = await world.call(req('/token', { form: { grant_type: 'authorization_code', code: 'made-up', redirect_uri: t.redirectUri, client_id: t.clientId, code_verifier: 'v'.repeat(43) } }));
    expect(reuse.status).toBe(400);
    expect((await json(reuse)).error).toBe('invalid_grant');
  });

  it('refuses a sign-in request that is too large or has too many fields, before the sign-in library reads it', async () => {
    const many: Record<string, string> = { client_id: 'invalid', grant_type: 'authorization_code' };
    for (let i = 0; i < SIGN_IN_FORM_FIELDS_MAX; i++) many[`k${i}`] = 'x';
    const crowded = await world.call(req('/token', { form: many }));
    expect(crowded.status).toBe(400);
    expect(await json(crowded)).toMatchObject({ error: 'invalid_request', error_description: expect.stringMatching(/too many fields/) });
    const huge = await world.call(req('/token', { form: { client_id: 'invalid', grant_type: 'authorization_code', padding: 'x'.repeat(SIGN_IN_BODY_MAX_BYTES) } }));
    expect(huge.status).toBe(413);
    // Streamed with no declared length, it is still stopped at the limit.
    const chunk = new TextEncoder().encode(`a=${'x'.repeat(4096)}`);
    const stream = new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(chunk); } });
    const streamed = req('/token');
    const endless = new Request(streamed.url, { method: 'POST', headers: { host: streamed.headers.get('host')!, 'content-type': 'application/x-www-form-urlencoded' }, body: stream, duplex: 'half' } as RequestInit);
    expect((await world.call(endless)).status).toBe(413);
    // An ordinary request still reaches the library: an unknown app is its answer.
    const plain = await world.call(req('/token', { form: { client_id: 'invalid', grant_type: 'authorization_code', code: 'x' } }));
    expect((await json(plain)).error).toBe('invalid_client');
  });

  it('tells the signed-in tool who is asking: it posts as that GitHub account', async () => {
    const t = await signIn(world, ADA);
    const sent = await callTool(world, 'submit_proposal', { draft, review, consent: true, contributor: { name: 'Ada Lovelace' } }, { token: t.accessToken, ip: '198.51.100.30' });
    expect(sent.result?.isError).toBeFalsy();
    expect(sent.result?.structuredContent).toMatchObject({ submitted: true, record_id: 'IIP-0001', contributor: { github: 'octo-cat', name: 'Ada Lovelace' } });
    expect(world.github.newestIssue.body.startsWith('Submitted by @octo-cat (verified through GitHub)')).toBe(true);
    expect(world.github.newestIssue.body).toMatch(/"via":"mcp_signed_in"/);
  });

  it('gives the link to the form to a caller with no token', async () => {
    const anon = await callTool(world, 'submit_proposal', { draft, review, consent: true }, { ip: '198.51.100.31' });
    expect(anon.result?.isError).toBeFalsy();
    expect(anon.result?.structuredContent).toMatchObject({ submitted: false, reason: 'sign_in_needed' });
    expect(anon.result?.structuredContent?.form_url).toMatch(/^https:\/\/openislet\.org\/submit#staged=[A-Za-z0-9_-]{22}$/);
    expect(world.github.issues).toHaveLength(0);
  });
});
