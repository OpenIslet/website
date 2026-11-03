// "Verify my ORCID iD": /api/orcid/begin, /api/orcid/complete, and the proof /api/begin takes. What it must never allow is in
// docs/NOTE-FOR-NEXT-SESSION-2026-11-03-ORCID.md (T1 to T12); each test below names the threat it covers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeOrcidProof, readOrcidProof, ORCID_PROOF_TTL_SECONDS } from '../src/core/queue/orcid';
import { base64url, hmacHex, utf8 } from '../src/core/queue/crypto';
import { makeDraft, makeReview, shownQuote } from './fixtures';
import { SIGNING_KEY, type World, bindingFor, installWorld, makeWorld, req, restore } from './queue-fakes';

vi.mock('agents/mcp', async () => import('agents/mcp/server'));

const SITE = 'https://openislet.org';
const IP = '203.0.113.9';
const ADA = { id: 4321, login: 'ada-example' };
const f = shownQuote();
const draft = makeDraft({ evidence: [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`] });
const review = makeReview();
const ORCID = { ORCID_CLIENT_ID: 'APP-ABCDEFGHIJKLMNOP', ORCID_CLIENT_SECRET: '12345678-1234-4234-8234-123456789abc', ORCID_BASE: 'https://orcid.org' };
// ORCID's own example record, and a second valid iD.
const IID = '0000-0002-1825-0097';
const OTHER = '0000-0001-5109-3700';
const NAME = 'Example Name From ORCID';
const REAL = 'https://orcid.org';

/** A stand-in for ORCID's token and revoke endpoints. Anything else goes on to the fake GitHub. */
class FakeOrcid {
  readonly codes = new Map<string, { orcid: string; used: boolean }>();
  readonly revoked: string[] = [];
  readonly issued: string[] = [];
  exchanges = 0;
  mode: 'ok' | 'down' | 'invalid_client' | 'invalid_request' | 'no_id' | 'wide_scope' | 'extra_scope' = 'ok';
  issueCode(orcid: string): string {
    const code = `orcid-code-${Math.random().toString(36).slice(2)}`;
    this.codes.set(code, { orcid, used: false });
    return code;
  }
  handle = async (url: URL, init: RequestInit): Promise<Response> => {
    const form = new URLSearchParams(String(init.body ?? ''));
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    if (form.get('client_id') !== ORCID.ORCID_CLIENT_ID || form.get('client_secret') !== ORCID.ORCID_CLIENT_SECRET) return json(401, { error: 'invalid_client' });
    if (url.pathname === '/oauth/revoke') {
      this.revoked.push(form.get('token') ?? '');
      return new Response(null, { status: 200 });
    }
    if (url.pathname !== '/oauth/token') return json(404, { error: 'not_found' });
    this.exchanges++;
    if (this.mode === 'down') return json(503, { error: 'unavailable' });
    if (this.mode === 'invalid_client') return json(401, { error: 'invalid_client' });
    if (this.mode === 'invalid_request') return json(400, { error: 'invalid_request' });
    const code = this.codes.get(form.get('code') ?? '');
    if (!code || code.used || form.get('redirect_uri') !== `${SITE}/submit/orcid` || form.get('grant_type') !== 'authorization_code') return json(400, { error: 'invalid_grant' });
    code.used = true;
    const token = `orcid-token-${Math.random().toString(36).slice(2)}`;
    this.issued.push(token);
    if (this.mode === 'no_id') return json(200, { access_token: token, token_type: 'bearer', scope: '/authenticate', name: NAME });
    return json(200, { access_token: token, token_type: 'bearer', refresh_token: 'r', expires_in: 631138518, scope: this.mode === 'wide_scope' ? '/activities/update' : this.mode === 'extra_scope' ? '/authenticate /read-limited' : '/authenticate', name: NAME, orcid: code.orcid });
  };
}

let world: World;
let orcid: FakeOrcid;
async function setup(vars: Parameters<typeof makeWorld>[0] = ORCID) {
  restore();
  world = await makeWorld(vars);
  installWorld(world);
  orcid = new FakeOrcid();
  const github = world.github.fetch;
  // Like Cloudflare's runtime, this fetch refuses to be called away from the global object (an unbound method call is "Illegal
  // invocation" there, though Node would not mind): the Worker must always call it as a plain function.
  vi.stubGlobal('fetch', async function (this: unknown, input: string | URL | Request, init: RequestInit = {}) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    return url.origin === ORCID.ORCID_BASE ? orcid.handle(url, init) : github(input, init);
  });
}
beforeEach(async () => setup());
afterEach(restore);

const post = async (path: string, json: unknown, ip = IP) => {
  const res = await world.call(req(path, { json, origin: SITE, ip }));
  return { res, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** What the form does for "Verify my ORCID iD": a secret it keeps, its hash to begin, then ORCID's code to finish. */
async function orcidBegin(ip = IP) {
  const secret = `orcid-secret-${Math.random().toString(36).slice(2)}`;
  const { res, body } = await post('/api/orcid/begin', { binding_hash: await bindingFor(secret) }, ip);
  return { res, body, secret, state: body.authorize_url ? new URL(body.authorize_url).searchParams.get('state')! : '' };
}
const orcidComplete = (b: { secret: string; state: string }, code: string, binding = b.secret) => post('/api/orcid/complete', { code, state: b.state, binding });
async function verified(iid = IID) {
  const b = await orcidBegin();
  const { res, body } = await orcidComplete(b, orcid.issueCode(iid));
  expect(res.status, JSON.stringify(body)).toBe(200);
  return body as { orcid: string; proof: string; expires_at: string };
}
/** The submission, then the GitHub sign-in, as the form does them. */
async function submit(extra: Record<string, unknown>) {
  const secret = `browser-secret-${Math.random().toString(36).slice(2)}`;
  const begun = await post('/api/begin', { draft, review, consent: true, binding_hash: await bindingFor(secret), ...extra });
  if (begun.res.status !== 200) return begun;
  const state = new URL(begun.body.authorize_url).searchParams.get('state')!;
  return post('/api/complete', { code: world.github.issueCode(ADA), state, binding: secret });
}

describe('starting a check', () => {
  it('sends the browser to ORCID for the sign-in kind of access only, back to the form, with a fresh state', async () => {
    const { res, body } = await orcidBegin();
    expect(res.status).toBe(200);
    const url = new URL(body.authorize_url);
    expect(url.origin + url.pathname).toBe('https://orcid.org/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: ORCID.ORCID_CLIENT_ID,
      response_type: 'code',
      scope: '/authenticate',
      redirect_uri: `${SITE}/submit/orcid`,
      state: expect.stringMatching(/^[A-Za-z0-9_-]{22}$/),
    });
    // Capability ids are never KV keys as they are: only their hashes (T3).
    const state = url.searchParams.get('state')!;
    expect([...world.kv.data.keys()].some((k) => k.includes(state))).toBe(false);
  });

  it('is off, and says so, until ORCID is set up (T12)', async () => {
    await setup({ ORCID_CLIENT_ID: undefined });
    expect((await orcidBegin()).body.error).toBe('orcid_not_configured');
    await setup({ ORCID_CLIENT_SECRET: 'not-a-uuid' });
    expect((await orcidBegin()).body.error).toBe('orcid_not_configured');
    await setup({ ...ORCID, SUBMISSIONS_OPEN: 'false' });
    expect((await orcidBegin()).body.error).toBe('queue_not_open');
  });

  it('trusts only the real ORCID for the live site, ORCID\'s practice site only elsewhere, plain http only on this machine (T12)', async () => {
    const live = { ...ORCID, SITE_ORIGIN: SITE };
    for (const [base, site, works] of [
      ['https://orcid.org', SITE, true],
      ['https://sandbox.orcid.org', SITE, false],
      ['https://sandbox.orcid.org', 'http://127.0.0.1:4501', true],
      ['http://127.0.0.1:8788', SITE, true],
      ['http://orcid.org', SITE, false],
      ['https://orcid.example.com', 'http://127.0.0.1:4501', false],
    ] as const) {
      await setup({ ...live, ORCID_BASE: base, SITE_ORIGIN: site, ALLOWED_ORIGINS: `${SITE},${site}` });
      const res = await world.call(req('/api/orcid/begin', { json: { binding_hash: await bindingFor('s') }, origin: SITE, ip: IP }));
      const body = (await res.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
      expect([base, site, res.status === 200]).toEqual([base, site, works]);
      if (!works) expect(body.error).toBe('orcid_not_configured');
    }
  });

  it('is limited per address per hour, and for everyone together (T10)', async () => {
    for (let i = 0; i < 199; i++) expect((await orcidBegin(`198.51.100.${i % 50}`)).res.status, `call ${i}`).toBe(200);
    expect((await orcidBegin('192.0.2.1')).res.status).toBe(200);
    const crowded = await orcidBegin('192.0.2.2');
    expect(crowded.res.status).toBe(429);
  });

  it('is limited per address per hour (T10)', async () => {
    for (let i = 0; i < 20; i++) expect((await orcidBegin()).res.status).toBe(200);
    const { res, body } = await orcidBegin();
    expect(res.status).toBe(429);
    expect(body.error).toBe('rate_limited');
    expect((await orcidBegin('198.51.100.4')).res.status).toBe(200);
  });

  it('refuses a request without a proper binding hash', async () => {
    const { res, body } = await post('/api/orcid/begin', { binding_hash: 'abc' });
    expect(res.status).toBe(400);
    expect(body.field).toBe('binding_hash');
  });
});

describe('finishing a check', () => {
  it('gives the iD ORCID confirmed and a proof, never the name, and lets the token go (T1, T9)', async () => {
    const b = await orcidBegin();
    const { res, body } = await orcidComplete(b, orcid.issueCode(IID));
    expect(res.status).toBe(200);
    expect(Object.keys(body).sort()).toEqual(['expires_at', 'orcid', 'proof']);
    expect(body.orcid).toBe(IID);
    expect(Date.parse(body.expires_at) - world.clock.ms).toBe(ORCID_PROOF_TTL_SECONDS * 1000);
    await world.ctx.flush();
    expect(orcid.revoked).toEqual(orcid.issued);
    const everything = JSON.stringify(body) + world.logs.join('\n') + JSON.stringify([...world.kv.data.entries()]);
    expect(everything).not.toContain(NAME);
    for (const t of orcid.issued) expect(everything).not.toContain(t);
    expect(world.logs.join('\n')).not.toContain(IID);
  });

  it('refuses another browser, and then the check is spent (T2, T3)', async () => {
    const b = await orcidBegin();
    const code = orcid.issueCode(IID);
    const wrong = await orcidComplete(b, code, 'someone-elses-secret');
    expect(wrong.res.status).toBe(400);
    expect(wrong.body.error).toBe('binding_mismatch');
    expect(orcid.exchanges).toBe(0);
    const again = await orcidComplete(b, code);
    expect(again.body.error).toBe('state_unknown');
  });

  it('works once even when several finishes arrive at the same moment (T3)', async () => {
    const b = await orcidBegin();
    const answers = await Promise.all(Array.from({ length: 8 }, () => orcidComplete(b, orcid.issueCode(IID))));
    expect(answers.filter((a) => a.res.status === 200)).toHaveLength(1);
    expect(answers.filter((a) => a.body.error === 'state_unknown')).toHaveLength(7);
    expect(orcid.exchanges).toBe(1);
  });

  it('works once, and not after 15 minutes (T3)', async () => {
    const b = await orcidBegin();
    expect((await orcidComplete(b, orcid.issueCode(IID))).res.status).toBe(200);
    expect((await orcidComplete(b, orcid.issueCode(IID))).body.error).toBe('state_unknown');
    const late = await orcidBegin();
    world.clock.advance(15 * 60 + 1);
    expect((await orcidComplete(late, orcid.issueCode(IID))).body.error).toBe('state_unknown');
    expect((await orcidComplete({ secret: 'x', state: 'made-up-state-0000000000' }, 'code')).body.error).toBe('state_unknown');
  });

  it('never sends ORCID a code that is not shaped like one of its codes (T10)', async () => {
    const b = await orcidBegin();
    for (const code of ['has spaces in it', 'x'.repeat(65), 'a/b', 'abc']) {
      const { res, body } = await orcidComplete(b, code);
      expect([code.slice(0, 10), res.status, body.field]).toEqual([code.slice(0, 10), 400, 'code']);
    }
    expect(orcid.exchanges).toBe(0);
    expect((await orcidComplete(b, orcid.issueCode(IID))).res.status).toBe(200);
  });

  it('says what went wrong at ORCID without inventing an iD', async () => {
    const cases: [FakeOrcid['mode'] | 'used', number, string][] = [
      ['used', 400, 'orcid_refused'],
      ['down', 502, 'orcid_unavailable'],
      ['invalid_client', 502, 'orcid_broken'],
      ['no_id', 502, 'orcid_unavailable'],
      ['wide_scope', 502, 'orcid_broken'],
      ['extra_scope', 502, 'orcid_broken'],
      ['invalid_request', 502, 'orcid_broken'],
    ];
    for (const [mode, status, error] of cases) {
      orcid.mode = mode === 'used' ? 'ok' : mode;
      const b = await orcidBegin();
      const { res, body } = await orcidComplete(b, mode === 'used' ? 'never-issued' : orcid.issueCode(IID));
      expect([mode, res.status, body.error]).toEqual([mode, status, error]);
      expect(body.orcid).toBeUndefined();
      expect(body.proof).toBeUndefined();
    }
    // Every token ORCID handed out, even with an answer we could not use, was let go (T9).
    await world.ctx.flush();
    expect(orcid.issued.length).toBeGreaterThan(0);
    expect(orcid.revoked.sort()).toEqual([...orcid.issued].sort());
  });
});

describe('the proof, on the submission', () => {
  it('marks the iD as verified on the public issue and in the answer', async () => {
    const v = await verified();
    const { res, body } = await submit({ contributor: { name: 'Ada E.', orcid: IID }, orcid_proof: v.proof });
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.contributor).toEqual({ github: 'ada-example', name: 'Ada E.', orcid: IID, orcid_verified: true });
    const issue = world.github.newestIssue.body;
    expect(issue).toContain(`ORCID iD [${IID}](https://orcid.org/${IID}) (verified through ORCID)`);
    expect(issue).toContain('Stated by the contributor, not verified: name Ada E.');
    expect(issue).not.toMatch(/not verified: [^\n]*ORCID/);
  });

  it('fills an empty ORCID box with the proven iD', async () => {
    const v = await verified();
    const { body } = await submit({ contributor: {}, orcid_proof: v.proof });
    expect(body.contributor).toEqual({ github: 'ada-example', orcid: IID, orcid_verified: true });
  });

  it('refuses a proof for a different iD from the one in the box (T7)', async () => {
    const v = await verified();
    const { res, body } = await submit({ contributor: { orcid: OTHER }, orcid_proof: v.proof });
    expect(res.status).toBe(422);
    expect(body.error).toBe('orcid_mismatch');
    expect(world.github.issues).toHaveLength(0);
  });

  it('refuses a proof that is tampered with, signed elsewhere, stretched or old (T4)', async () => {
    const v = await verified();
    const [payload, sig] = v.proof.split('.');
    const forged = base64url(utf8(JSON.stringify({ v: 1, iss: ORCID.ORCID_BASE, orcid: OTHER, exp: world.clock.ms + 1000 })));
    const stretched = base64url(utf8(JSON.stringify({ v: 1, iss: ORCID.ORCID_BASE, orcid: IID, exp: world.clock.ms + 48 * 3600 * 1000 })));
    const elsewhere = base64url(utf8(JSON.stringify({ v: 1, iss: 'https://sandbox.orcid.org', orcid: IID, exp: world.clock.ms + 1000 })));
    const bad = [
      `${forged}.${sig}`,
      `${payload}.${'0'.repeat(64)}`,
      `${forged}.${await hmacHex('another-key-0123456789-abcdefghijklmnop', `openislet:orcid-proof:v1:${forged}`)}`,
      `${stretched}.${await hmacHex(SIGNING_KEY, `openislet:orcid-proof:v1:${stretched}`)}`,
      `${forged}.${await hmacHex(SIGNING_KEY, forged)}`,
      `${elsewhere}.${await hmacHex(SIGNING_KEY, `openislet:orcid-proof:v1:${elsewhere}`)}`,
      'not-a-proof',
    ];
    for (const proof of bad) {
      const { res, body } = await submit({ contributor: { orcid: IID }, orcid_proof: proof });
      expect([proof.slice(0, 12), res.status, body.error]).toEqual([proof.slice(0, 12), 422, 'orcid_proof_invalid']);
    }
    world.clock.advance(ORCID_PROOF_TTL_SECONDS + 1);
    expect((await submit({ contributor: { orcid: IID }, orcid_proof: v.proof })).body.error).toBe('orcid_proof_invalid');
    expect(world.github.issues).toHaveLength(0);
  });

  it('never takes a verified mark from what is sent, and never hands one back with saved files (T6)', async () => {
    const { body } = await submit({ contributor: { orcid: IID, orcid_verified: true } });
    expect(body.contributor).toEqual({ github: 'ada-example', orcid: IID });
    expect(world.github.newestIssue.body).toContain(`Stated by the contributor, not verified: ORCID [${IID}]`);
    expect(world.github.newestIssue.body).not.toContain('verified through ORCID');

    // A verified submission's saved files, fetched again, carry the iD but not the mark; begun again without a proof, it is stated.
    const v = await verified();
    const secret = 'browser-secret-again';
    const begun = await post('/api/begin', { draft, review, consent: true, contributor: { orcid: IID }, orcid_proof: v.proof, binding_hash: await bindingFor(secret) });
    const savedRes = await world.call(req(`/api/staged/${begun.body.staged_id}`, { origin: SITE }));
    const saved = (await savedRes.json()) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(saved.contributor).toEqual({ orcid: IID });
    const reused = await post('/api/begin', { staged_id: begun.body.staged_id, consent: true, binding_hash: await bindingFor('another') });
    expect(reused.res.status).toBe(200);
    const state = new URL(reused.body.authorize_url).searchParams.get('state')!;
    const done = await post('/api/complete', { code: world.github.issueCode({ id: 99, login: 'someone-else' }), state, binding: 'another' });
    expect(done.body.contributor).toEqual({ github: 'someone-else', orcid: IID });
  });
});

describe('the proof itself', () => {
  it('names the iD until it expires, and nothing after', async () => {
    const now = Date.UTC(2026, 10, 3, 12, 0, 0);
    const { proof, expiresAt } = await makeOrcidProof(SIGNING_KEY, IID, REAL, now);
    expect(expiresAt - now).toBe(ORCID_PROOF_TTL_SECONDS * 1000);
    expect(await readOrcidProof(SIGNING_KEY, proof, REAL, now)).toBe(IID);
    expect(await readOrcidProof(SIGNING_KEY, proof, REAL, expiresAt - 1)).toBe(IID);
    expect(await readOrcidProof(SIGNING_KEY, proof, REAL, expiresAt)).toBeNull();
    expect(await readOrcidProof('a-different-key-0123456789-abcdefghijkl', proof, REAL, now)).toBeNull();
    expect(await readOrcidProof(SIGNING_KEY, `${proof}.x`, REAL, now)).toBeNull();
    expect(await readOrcidProof(SIGNING_KEY, 'x'.repeat(600), REAL, now)).toBeNull();
  });

  it('only holds an iD that passes its check digit', async () => {
    const now = Date.UTC(2026, 10, 3, 12, 0, 0);
    const payload = base64url(utf8(JSON.stringify({ v: 1, iss: REAL, orcid: '0000-0002-1825-0098', exp: now + 1000 })));
    expect(await readOrcidProof(SIGNING_KEY, `${payload}.${await hmacHex(SIGNING_KEY, `openislet:orcid-proof:v1:${payload}`)}`, REAL, now)).toBeNull();
  });

  it('is good only where the same ORCID is used', async () => {
    const now = Date.UTC(2026, 10, 3, 12, 0, 0);
    const { proof } = await makeOrcidProof(SIGNING_KEY, IID, 'https://sandbox.orcid.org', now);
    expect(await readOrcidProof(SIGNING_KEY, proof, 'https://sandbox.orcid.org', now)).toBe(IID);
    expect(await readOrcidProof(SIGNING_KEY, proof, REAL, now)).toBeNull();
  });
});
