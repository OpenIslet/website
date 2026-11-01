// The web API the openislet.org form calls: /api/check, /api/stage, /api/staged/:id and /api/begin, with CORS and the limits.
// (Finishing the sign-in, /api/complete, is in queue-flow.test.ts.) Everything goes through the Worker's own fetch.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDraft, makeReview, shownQuote } from './fixtures';
import { type World, bindingFor, installWorld, makeWorld, req, restore } from './queue-fakes';

vi.mock('agents/mcp', async () => import('agents/mcp/server'));

const SITE = 'https://openislet.org';
const f = shownQuote();
const draft = makeDraft({ evidence: [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`] });
const review = makeReview();
const IP = '203.0.113.7';

let world: World;
async function setup(vars: Parameters<typeof makeWorld>[0] = {}) {
  restore();
  world = await makeWorld(vars);
  installWorld(world);
}
beforeEach(async () => setup());
afterEach(restore);

const post = async (path: string, json: unknown, o: { origin?: string | null; ip?: string } = {}) => {
  const res = await world.call(req(path, { json, origin: o.origin === null ? undefined : (o.origin ?? SITE), ip: o.ip ?? IP }));
  return { res, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};
const begin = async (extra: Record<string, unknown> = {}, o: { ip?: string } = {}) =>
  post('/api/begin', { draft, review, consent: true, binding_hash: await bindingFor('a-secret'), ...extra }, o);
const stage = (extra: Record<string, unknown> = {}, o: { ip?: string } = {}) => post('/api/stage', { draft, review, consent: true, ...extra }, o);
const onlyKeysStartingWith = (kv: World['kv'], ...prefixes: string[]) => kv.keys().every((k) => prefixes.some((p) => k.startsWith(p)));

describe('POST /api/check', () => {
  it('runs the same checks as the tool, and answers with the documented fields', async () => {
    const { res, body } = await post('/api/check', { draft, review, consent: true });
    expect(res.status).toBe(200);
    expect(Object.keys(body)).toEqual(expect.arrayContaining(['ready', 'door', 'checks', 'what_to_fix', 'labels', 'summary']));
    expect(body.ready).toBe(true);
    expect(body.labels).toEqual(expect.arrayContaining(['submission', 'type:problem-found', 'design:a']));
    expect(body.summary).toMatch(/basic rules/);
    expect(Array.isArray(body.door) && Array.isArray(body.checks) && Array.isArray(body.what_to_fix)).toBe(true);
  });

  it('stores nothing but its own rate counter', async () => {
    await post('/api/check', { draft, review, consent: true });
    expect(onlyKeysStartingWith(world.kv, 'rl:ip:check:')).toBe(true);
    expect(world.kv.keys()).toHaveLength(1);
  });

  it('says what is wrong, with a 200, when the files fail the basic rules', async () => {
    const { res, body } = await post('/api/check', { draft: 'too short', review: '' });
    expect(res.status).toBe(200);
    expect(body.ready).toBe(false);
    expect(body.summary).toMatch(/Not ready/);
    expect(body.what_to_fix.length).toBeGreaterThan(0);
    expect(body.door.filter((d: { status: string }) => d.status === 'fail').map((d: { id: string }) => d.id)).toEqual(expect.arrayContaining(['draft_present', 'review_present']));
  });

  it('treats missing files as empty, so the person is told what is missing', async () => {
    const { res, body } = await post('/api/check', {});
    expect(res.status).toBe(200);
    expect(body.ready).toBe(false);
  });

  it('works while submissions are closed, and then writes nothing at all', async () => {
    await setup({ SUBMISSIONS_OPEN: 'false' });
    const { res, body } = await post('/api/check', { draft, review, consent: true });
    expect(res.status).toBe(200);
    expect(body.ready).toBe(true);
    expect(world.kv.writeCount).toBe(0);
    expect(world.oauthKv.writeCount).toBe(0);
  });

  it('allows 30 calls an hour from one address, then says how long to wait', async () => {
    for (let i = 0; i < 30; i++) expect((await post('/api/check', {})).res.status).toBe(200);
    const { res, body } = await post('/api/check', {});
    expect(res.status).toBe(429);
    expect(body.error).toBe('rate_limited');
    expect(body.message).toMatch(/wait about \d+ minutes?/);
    expect(body.retry_after_seconds).toBeGreaterThan(0);
    expect(body.retry_after_seconds).toBeLessThanOrEqual(3600);
    expect(res.headers.get('retry-after')).toBe(String(body.retry_after_seconds));
    // Another address is not held up, and the next hour starts afresh.
    expect((await post('/api/check', {}, { ip: '203.0.113.99' })).res.status).toBe(200);
    world.clock.advance(3600);
    expect((await post('/api/check', {})).res.status).toBe(200);
  });

  it('answers queue_not_configured when open but without its counters', async () => {
    await setup({ QUEUE_KV: undefined });
    const { res, body } = await post('/api/check', {});
    expect(res.status).toBe(503);
    expect(body.error).toBe('queue_not_configured');
    await setup({ STATE_SIGNING_KEY: 'too short' });
    expect((await post('/api/check', {})).body.error).toBe('queue_not_configured');
  });
});

describe('POST /api/stage and GET /api/staged/:id', () => {
  it('saves the files for 24 hours and returns the link to the pre-filled form', async () => {
    const { res, body } = await stage({ ai_tools: { draft: 'Model A', review: 'Model B' }, contributor: { name: 'Ada', orcid: '0000-0002-1825-0097', x: '@ada' } });
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['expires_at', 'form_url', 'staged_id']);
    expect(body.staged_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(body.form_url).toBe(`${SITE}/submit#staged=${body.staged_id}`);
    expect(Date.parse(body.expires_at) - world.clock.now()).toBe(24 * 3600 * 1000);

    const got = await world.call(req(`/api/staged/${body.staged_id}`, { origin: SITE }));
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({
      draft,
      review,
      ai_tools: { draft: 'Model A', review: 'Model B' },
      contributor: { name: 'Ada', orcid: '0000-0002-1825-0097', x: 'ada' },
      expires_at: body.expires_at,
    });
  });

  it('never uses the id itself as a key, and does not list anything', async () => {
    const { body } = await stage();
    expect(world.kv.dump()).not.toContain(`staged:${body.staged_id}`);
    expect(world.kv.keys().join('\n')).not.toContain(body.staged_id);
  });

  it('forgets a draft after 24 hours', async () => {
    const { body } = await stage();
    world.clock.advance(24 * 3600 - 1);
    expect((await world.call(req(`/api/staged/${body.staged_id}`, { origin: SITE }))).status).toBe(200);
    world.clock.advance(2);
    const gone = await world.call(req(`/api/staged/${body.staged_id}`, { origin: SITE }));
    expect(gone.status).toBe(404);
    expect(((await gone.json()) as { error: string }).error).toBe('staged_unknown');
  });

  it.each(['nope', 'x'.repeat(22), '..%2f..', 'a/b'])('answers staged_unknown for the id %s', async (id) => {
    const res = await world.call(req(`/api/staged/${id}`, { origin: SITE }));
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toMatch(/staged_unknown|not_found/);
  });

  it('gives the same link for a retry with the same key and the same files, and a new one for different files', async () => {
    const a = await stage({ idempotency_key: 'retry-1' });
    const b = await stage({ idempotency_key: 'retry-1' });
    expect(b.body.staged_id).toBe(a.body.staged_id);
    expect(world.kv.keys().filter((k) => k.startsWith('staged:'))).toHaveLength(1);
    const other = await stage({ idempotency_key: 'retry-1', draft: draft.replace('Too little CD47', 'Not enough CD47') });
    expect(other.body.staged_id).not.toBe(a.body.staged_id);
  });

  it('never hands a retry someone else’s details, or a link without the consent tick', async () => {
    const first = await stage({ idempotency_key: 'shared-key', contributor: { name: 'First Person' }, ai_tools: { draft: 'Tool One', review: 'Tool One' } });
    const same = await stage({ idempotency_key: 'shared-key', ai_tools: { review: 'Tool One', draft: 'Tool One' }, contributor: { name: 'First Person' } }, { ip: '203.0.113.77' });
    expect(same.body.staged_id).toBe(first.body.staged_id); // the same submission, its fields in another order
    const changed = await stage({ idempotency_key: 'shared-key', contributor: { name: 'Second Person' }, ai_tools: { draft: 'Tool Two', review: 'Tool Two' } }, { ip: '203.0.113.78' });
    expect(changed.res.status).toBe(200);
    expect(changed.body.staged_id).not.toBe(first.body.staged_id);
    const got = (await (await world.call(req(`/api/staged/${changed.body.staged_id}`, { origin: SITE }))).json()) as { contributor: { name?: string }; ai_tools: { draft?: string } };
    expect(got.contributor.name).toBe('Second Person');
    expect(got.ai_tools.draft).toBe('Tool Two');
    const noConsent = await stage({ idempotency_key: 'shared-key', consent: false, contributor: { name: 'First Person' }, ai_tools: { draft: 'Tool One', review: 'Tool One' } }, { ip: '203.0.113.79' });
    expect(noConsent.res.status).toBe(422);
    expect(noConsent.body.error).toBe('consent_needed');
  });

  it('refuses in the contract order: rules, then consent, then contributor', async () => {
    const rules = await stage({ draft: 'tiny', consent: false, contributor: { orcid: 'bad' } });
    expect(rules.res.status).toBe(422);
    expect(rules.body.error).toBe('basic_rules');
    expect(rules.body.what_to_fix.length).toBeGreaterThan(0);
    expect(rules.body.door.some((d: { status: string }) => d.status === 'fail')).toBe(true);
    const consent = await stage({ consent: false, contributor: { orcid: 'bad' } });
    expect(consent.body.error).toBe('consent_needed');
    const contributor = await stage({ contributor: { orcid: '0000-0002-1825-0098' } });
    expect(contributor.res.status).toBe(422);
    expect(contributor.body).toMatchObject({ error: 'bad_contributor', field: 'orcid' });
    expect(world.kv.keys().filter((k) => k.startsWith('staged:'))).toHaveLength(0);
  });

  it('shares the begin limit: 10 an hour from one address', async () => {
    for (let i = 0; i < 10; i++) expect((await stage({ idempotency_key: `k${i}`, draft: draft + ' '.repeat(i) })).res.status).toBe(200);
    expect((await stage()).res.status).toBe(429);
  });
});

describe('POST /api/begin', () => {
  it('starts the sign-in for files typed on the form', async () => {
    const { res, body } = await begin({ ai_tools: { draft: 'A' }, contributor: { name: 'Ada' } });
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['authorize_url', 'expires_at', 'staged_id']);
    const url = new URL(body.authorize_url);
    expect(url.origin + url.pathname).toBe('https://github.test/login/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe(world.github.clientId);
    expect(url.searchParams.get('redirect_uri')).toBe(`${SITE}/submit/finish`);
    expect(url.searchParams.get('allow_signup')).toBe('true');
    expect(url.searchParams.get('scope')).toBeNull(); // no scopes: the sign-in sees only the public profile
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Date.parse(body.expires_at) - world.clock.now()).toBe(15 * 60 * 1000);
    // The staged files are kept for the finish step, under the id the page was given.
    const staged = await world.call(req(`/api/staged/${body.staged_id}`, { origin: SITE }));
    expect(((await staged.json()) as { draft: string }).draft).toBe(draft);
  });

  it('keeps the browser-side hash and the sign-in state out of the key names', async () => {
    const { body } = await begin();
    const state = new URL(body.authorize_url).searchParams.get('state')!;
    expect(world.kv.keys().join('\n')).not.toContain(state);
    expect(world.kv.keys().join('\n')).not.toContain(await bindingFor('a-secret'));
  });

  it('takes the files from an earlier staging, and reuses its id', async () => {
    const staged = await stage({ contributor: { name: 'From the connector' } });
    const { res, body } = await post('/api/begin', { staged_id: staged.body.staged_id, consent: true, binding_hash: await bindingFor('s') });
    expect(res.status).toBe(200);
    expect(body.staged_id).toBe(staged.body.staged_id);
    const got = await world.call(req(`/api/staged/${body.staged_id}`, { origin: SITE }));
    expect(((await got.json()) as { contributor: object }).contributor).toEqual({ name: 'From the connector' });
  });

  it('lets typed values replace the staged ones', async () => {
    const staged = await stage();
    const edited = draft.replace('Too little CD47', 'Not enough CD47');
    const { res, body } = await post('/api/begin', { staged_id: staged.body.staged_id, draft: edited, consent: true, binding_hash: await bindingFor('s'), contributor: { x: 'ada' } });
    expect(res.status).toBe(200);
    const got = (await (await world.call(req(`/api/staged/${body.staged_id}`, { origin: SITE }))).json()) as { draft: string; review: string; contributor: object };
    expect(got.draft).toBe(edited);
    expect(got.review).toBe(review);
    expect(got.contributor).toEqual({ x: 'ada' });
  });

  it('says staged_unknown for an id it cannot find, unless both files were typed', async () => {
    const missing = await post('/api/begin', { staged_id: 'A'.repeat(22), consent: true, binding_hash: await bindingFor('s') });
    expect(missing.res.status).toBe(404);
    expect(missing.body.error).toBe('staged_unknown');
    const typed = await begin({ staged_id: 'A'.repeat(22) });
    expect(typed.res.status).toBe(200);
    expect(typed.body.staged_id).not.toBe('A'.repeat(22));
  });

  it('checks things in the order the contract gives', async () => {
    const bad = { draft: 'tiny', consent: false, contributor: { orcid: 'bad' } };
    // closed beats everything
    await setup({ SUBMISSIONS_OPEN: 'false' });
    expect((await begin(bad)).body.error).toBe('queue_not_open');
    // then not configured
    await setup({ GITHUB_CLIENT_SECRET: undefined });
    expect((await begin(bad)).body.error).toBe('queue_not_configured');
    // then the limits (ten calls first; the eleventh is refused before its files are even read)
    await setup();
    for (let i = 0; i < 10; i++) await begin(bad);
    expect((await begin(bad)).body.error).toBe('rate_limited');
    // then the basic rules, consent, and the contributor's fields
    await setup();
    expect((await begin(bad)).body.error).toBe('basic_rules');
    expect((await begin({ consent: false, contributor: { orcid: 'bad' } })).body.error).toBe('consent_needed');
    const last = await begin({ contributor: { x: 'not valid!' } });
    expect(last.res.status).toBe(422);
    expect(last.body).toMatchObject({ error: 'bad_contributor', field: 'x' });
  });

  it.each([false, 'true', 1, 'yes', null, undefined])('wants consent to be exactly true, not %j', async (consent) => {
    const { res, body } = await begin({ consent });
    expect(res.status).toBe(422);
    expect(body.error).toBe('consent_needed');
    expect(body.message).toContain('CC BY 4.0');
    expect(body.message).toContain('Islet Improvement Proposal (IIP)');
    expect(body.message).not.toMatch(/finding/i);
  });

  it('allows 10 an hour from one address', async () => {
    for (let i = 0; i < 10; i++) expect((await begin()).res.status).toBe(200);
    const { res, body } = await begin();
    expect(res.status).toBe(429);
    expect(body.error).toBe('rate_limited');
    expect(body.retry_after_seconds).toBeGreaterThan(0);
    expect((await begin({}, { ip: '203.0.113.50' })).res.status).toBe(200);
  });

  it('refuses a malformed binding hash or staged id before doing anything', async () => {
    for (const binding_hash of ['', 'ABC', 'g'.repeat(64), (await bindingFor('x')).toUpperCase(), 5]) {
      const { res, body } = await post('/api/begin', { draft, review, consent: true, binding_hash });
      expect(res.status, String(binding_hash)).toBe(400);
      expect(body).toMatchObject({ error: 'bad_request', field: 'binding_hash' });
    }
    expect((await post('/api/begin', { draft, review, consent: true })).body.field).toBe('binding_hash');
    expect(world.kv.writeCount).toBe(0);
  });
});

describe('when the queue is closed or not set up, nothing is written', () => {
  it('answers queue_not_open on every submit path and touches no storage', async () => {
    await setup({ SUBMISSIONS_OPEN: 'false' });
    const binding_hash = await bindingFor('s');
    const answers = [
      await post('/api/begin', { draft, review, consent: true, binding_hash }),
      await post('/api/stage', { draft, review, consent: true }),
      await post('/api/complete', { code: 'c', state: 's', binding: 'b' }),
      { res: await world.call(req(`/api/staged/${'A'.repeat(22)}`, { origin: SITE })), body: undefined },
    ];
    for (const a of answers) expect(a.res.status).toBe(503);
    for (const a of answers.slice(0, 3)) expect(a.body!.error).toBe('queue_not_open');
    expect(((await answers[3].res.json()) as { error: string }).error).toBe('queue_not_open');
    expect(world.kv.writeCount).toBe(0);
    expect(world.kv.reads).toBe(0);
    expect(world.oauthKv.writeCount).toBe(0);
    expect(world.github.requests).toHaveLength(0);
  });

  it('answers queue_not_open first, even to a request that could not be read, without reading its body', async () => {
    await setup({ SUBMISSIONS_OPEN: 'false' });
    for (const path of ['/api/begin', '/api/stage', '/api/complete']) {
      for (const bad of [{ json: {} }, { text: 'not json' }, { text: 'x'.repeat(300_000) }, { text: '[]', contentType: 'text/plain' }]) {
        const res = await world.call(req(path, { ...bad, origin: SITE, ip: IP }));
        expect(res.status, `${path} ${JSON.stringify(Object.keys(bad))}`).toBe(503);
        expect(((await res.json()) as { error: string }).error).toBe('queue_not_open');
      }
    }
    expect(world.kv.writeCount + world.kv.reads).toBe(0);
  });

  it('answers queue_not_configured first too, when open but not set up', async () => {
    await setup({ GITHUB_APP_ID: undefined });
    for (const path of ['/api/begin', '/api/stage', '/api/complete']) {
      const res = await world.call(req(path, { text: 'not json', origin: SITE, ip: IP }));
      expect(res.status, path).toBe(503);
      expect(((await res.json()) as { error: string }).error).toBe('queue_not_configured');
    }
  });

  it.each(['QUEUE_KV', 'GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GITHUB_APP_ID', 'GITHUB_APP_INSTALLATION_ID', 'GITHUB_APP_PRIVATE_KEY', 'STATE_SIGNING_KEY'])(
    'answers queue_not_configured on every submit path when %s is missing, and does nothing else',
    async (name) => {
      await setup({ [name]: undefined });
      const binding_hash = await bindingFor('s');
      const answers = [
        await post('/api/begin', { draft, review, consent: true, binding_hash }),
        await post('/api/stage', { draft, review, consent: true }),
        await post('/api/complete', { code: 'c', state: 's', binding: 'b' }),
        { res: await world.call(req(`/api/staged/${'A'.repeat(22)}`, { origin: SITE })), body: undefined },
      ];
      for (const a of answers) expect(a.res.status).toBe(503);
      for (const a of answers.slice(0, 3)) expect(a.body!.error).toBe('queue_not_configured');
      expect(world.kv.writeCount).toBe(0);
      expect(world.github.requests).toHaveLength(0);
    },
  );

  it('treats a setting that is there but unusable as missing', async () => {
    for (const bad of [{ GITHUB_APP_PRIVATE_KEY: 'not a pem' }, { STATE_SIGNING_KEY: 'short' }, { QUEUE_REPO: 'no-slash' }, { SITE_ORIGIN: 'not a url' }, { DAILY_LIMIT_PER_ACCOUNT: '0' }, { GITHUB_APP_ID: 'abc' }]) {
      await setup(bad);
      const r = await begin();
      expect(r.body.error, JSON.stringify(bad)).toBe('queue_not_configured');
    }
  });

  it('never says which setting is missing in its answer', async () => {
    await setup({ GITHUB_APP_PRIVATE_KEY: undefined });
    const { body } = await begin();
    expect(JSON.stringify(body)).not.toMatch(/GITHUB_APP|PRIVATE|KV|SIGNING/);
  });
});

describe('CORS', () => {
  it('lets an allowed origin call, and tells the browser so, on success and on errors', async () => {
    for (const origin of [SITE, 'http://localhost:4321']) {
      const ok = await post('/api/check', { draft, review }, { origin });
      expect(ok.res.headers.get('access-control-allow-origin')).toBe(origin);
      expect(ok.res.headers.get('vary')).toBe('Origin');
      const err = await post('/api/stage', { draft: 'x', review: 'y', consent: true }, { origin });
      expect(err.res.status).toBe(422);
      expect(err.res.headers.get('access-control-allow-origin')).toBe(origin);
    }
  });

  it('answers the preflight with the methods and the one header the form needs', async () => {
    const res = await world.call(req('/api/begin', { method: 'OPTIONS', origin: SITE, headers: { 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } }));
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe(SITE);
    expect(res.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    expect(res.headers.get('access-control-allow-headers')).toBe('content-type');
    expect(res.headers.get('vary')).toBe('Origin');
    expect(await res.text()).toBe('');
    expect(world.kv.writeCount).toBe(0);
  });

  it.each(['https://evil.example', 'https://openislet.org.evil.example', 'http://openislet.org', 'null', 'http://localhost:9999'])('refuses the origin %s, with no CORS headers and no work done', async (origin) => {
    const res = await world.call(req('/api/stage', { json: { draft, review, consent: true }, origin, ip: IP }));
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe('origin_not_allowed');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    const pre = await world.call(req('/api/stage', { method: 'OPTIONS', origin }));
    expect(pre.status).toBe(403);
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    expect(world.kv.writeCount).toBe(0);
  });

  it('serves callers that send no Origin (curl, servers) without CORS headers', async () => {
    const { res, body } = await post('/api/check', { draft, review }, { origin: null });
    expect(res.status).toBe(200);
    expect(body.ready).toBe(false); // no consent given
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('allows only https://openislet.org by default, and nobody if the list is empty', async () => {
    await setup({ ALLOWED_ORIGINS: undefined });
    expect((await post('/api/check', {}, { origin: SITE })).res.headers.get('access-control-allow-origin')).toBe(SITE);
    expect((await post('/api/check', {}, { origin: 'http://localhost:4321' })).res.status).toBe(403);
    await setup({ ALLOWED_ORIGINS: '' });
    expect((await post('/api/check', {}, { origin: SITE })).res.status).toBe(403);
  });

  it('sets no cookies, and does not read them', async () => {
    const res = await world.call(req('/api/check', { json: {}, origin: SITE, headers: { cookie: 'session=abc' } }));
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('cache-control')).toBe('no-store');
  });
});

describe('the request itself', () => {
  it('refuses a request that is not JSON, not an object, or not valid', async () => {
    const wrongType = await world.call(req('/api/check', { text: '{}', contentType: 'text/plain', origin: SITE }));
    expect(wrongType.status).toBe(400);
    expect(((await wrongType.json()) as { error: string }).error).toBe('bad_request');
    for (const text of ['not json', '[1,2]', '"text"', 'null', '']) {
      const res = await world.call(req('/api/check', { text, origin: SITE }));
      expect(res.status, text).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe('bad_request');
    }
  });

  it('refuses a body over 200 KB, whether or not the size is declared', async () => {
    const big = JSON.stringify({ draft: 'a'.repeat(205_000) });
    const undeclared = await world.call(req('/api/check', { text: big, origin: SITE }));
    expect(undeclared.status).toBe(413);
    expect(((await undeclared.json()) as { error: string }).error).toBe('payload_too_large');
    const declared = await world.call(req('/api/check', { text: '{}', origin: SITE, headers: { 'content-length': '300000' } }));
    expect(declared.status).toBe(413);
    // Just under the limit is read.
    const under = await world.call(req('/api/check', { json: { draft: 'a'.repeat(50_000), review: 'b'.repeat(50_000) }, origin: SITE }));
    expect(under.status).toBe(200);
  });

  it('refuses files over 60,000 characters, and fields of the wrong type, naming the field', async () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ draft: 'a'.repeat(60_001) }, 'draft'],
      [{ review: 'a'.repeat(60_001) }, 'review'],
      [{ draft: 5 }, 'draft'],
      [{ review: ['x'] }, 'review'],
      [{ ai_tools: 'Model' }, 'ai_tools'],
      [{ ai_tools: { draft: 'a'.repeat(201) } }, 'ai_tools.draft'],
      [{ ai_tools: { review: 'a'.repeat(201) } }, 'ai_tools.review'],
      [{ ai_tools: { review: 7 } }, 'ai_tools.review'],
      [{ consent: 'yes' }, 'consent'],
    ];
    for (const [extra, field] of cases) {
      const { res, body } = await post('/api/check', { draft, review, ...extra });
      expect(res.status, JSON.stringify(Object.keys(extra))).toBe(400);
      expect(body).toMatchObject({ error: 'bad_request', field });
    }
    const exactly = await post('/api/check', { draft: 'a'.repeat(60_000), review: 'b', ai_tools: { draft: 'a'.repeat(200) } });
    expect(exactly.res.status).toBe(200); // at the limit is fine (the basic rules then say it is too large)
    expect(exactly.body.ready).toBe(false);
  });

  it('knows its own addresses and methods', async () => {
    const nothing = await world.call(req('/api/nothing', { origin: SITE }));
    expect(nothing.status).toBe(404);
    expect(((await nothing.json()) as { error: string }).error).toBe('not_found');
    const get = await world.call(req('/api/check', { origin: SITE }));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toContain('POST');
    const wrong = await world.call(req(`/api/staged/${'A'.repeat(22)}`, { method: 'POST', json: {}, origin: SITE }));
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toContain('GET');
  });

  it('answers only on its own hosts', async () => {
    for (const host of ['evil.example', 'mcp.openislet.org.evil.example', 'localhost.evil.example', 'user@mcp.openislet.org']) {
      const res = await world.call(req('/api/check', { json: {}, host, origin: SITE }));
      expect(res.status, host).toBe(403);
      expect(((await res.json()) as { error: string }).error).toBe('host_not_allowed');
    }
    for (const base of ['http://localhost:8787', 'http://127.0.0.1:8787', 'http://[::1]:8787']) {
      expect((await world.call(req('/api/check', { json: {}, base, origin: SITE }))).status, base).toBe(200);
    }
  });

  it('answers on the addresses in PUBLIC_HOSTNAMES and no others, so a fork can use its own address', async () => {
    await setup({ PUBLIC_HOSTNAMES: 'mcp.example.org, Other.Example.org' });
    for (const host of ['mcp.example.org', 'other.example.org']) {
      expect((await world.call(req('/api/check', { json: {}, host, origin: SITE }))).status, host).toBe(200);
    }
    // OpenIslet's own address is refused, and the refusal points at the configured one.
    const ours = await world.call(req('/api/check', { json: {}, host: 'mcp.openislet.org', origin: SITE }));
    expect(ours.status).toBe(403);
    expect(((await ours.json()) as { error: string; message: string }).message).toContain('https://mcp.example.org');
    const withUserinfo = ['someone', 'mcp.example.org'].join('@'); // a Host header that smuggles in a user part
    for (const host of ['evil.example', 'mcp.example.org.evil.example', withUserinfo]) {
      expect((await world.call(req('/api/check', { json: {}, host, origin: SITE }))).status, host).toBe(403);
    }
    // This machine still answers.
    expect((await world.call(req('/api/check', { json: {}, base: 'http://localhost:8787', origin: SITE }))).status).toBe(200);
  });

  it('applies the same rule to the connector\'s sign-in addresses', async () => {
    await setup({ PUBLIC_HOSTNAMES: 'mcp.example.org' });
    expect((await world.call(req('/.well-known/oauth-authorization-server', { base: 'https://mcp.example.org' }))).status).toBe(200);
    const ours = await world.call(req('/.well-known/oauth-authorization-server', { base: 'https://mcp.openislet.org' }));
    expect(ours.status).toBe(403);
    // A public address is only trusted over https.
    expect((await world.call(req('/.well-known/oauth-authorization-server', { base: 'http://mcp.example.org' }))).status).toBe(403);
  });

  it('keeps OpenIslet\'s addresses when PUBLIC_HOSTNAMES is unset or holds nothing usable', async () => {
    for (const value of [undefined, '', ' , ', 'https://mcp.example.org', 'mcp.example.org/path']) {
      await setup({ PUBLIC_HOSTNAMES: value });
      expect((await world.call(req('/api/check', { json: {}, host: 'mcp.openislet.org', origin: SITE }))).status, String(value)).toBe(200);
      expect((await world.call(req('/api/check', { json: {}, host: 'mcp.example.org', origin: SITE }))).status, String(value)).toBe(403);
    }
  });

  it('never shows an internal error to the caller', async () => {
    world.kv.get = async () => { throw new Error('KV exploded with secret-detail-123'); };
    const { res, body } = await post('/api/stage', { draft, review, consent: true });
    expect(res.status).toBe(500);
    expect(body.error).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('secret-detail-123');
  });
});
