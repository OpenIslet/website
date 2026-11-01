// No secret, token or full IP address ever appears in a response, a log line, an issue, a comment or a storage key.
// One long session goes through every path (including the ones that fail), and then everything that was seen is searched.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hmacHex } from '../src/core/queue/crypto';
import { makeDraft, makeReview, shownQuote } from './fixtures';
import { SIGNING_KEY, type World, bindingFor, callTool, installWorld, makeWorld, req, restore, signIn } from './queue-fakes';

vi.mock('agents/mcp', async () => import('agents/mcp/server'));

const SITE = 'https://openislet.org';
const f = shownQuote();
const draft = makeDraft({ evidence: [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`] });
const review = makeReview();
const ADA = { id: 1234, login: 'octo-cat' };
const IPS = ['203.0.113.7', '198.51.100.9', '192.0.2.44', '2001:db8::1234'];

let world: World;
const seen: string[] = [];
async function setup() {
  restore();
  seen.length = 0;
  world = await makeWorld();
  installWorld(world);
}
beforeEach(setup);
afterEach(restore);

/** Calls the Worker and remembers the whole answer (status line, headers and body), as a browser or AI app would see it. */
async function call(request: Request): Promise<Response> {
  const res = await world.call(request);
  const copy = res.clone();
  seen.push([...copy.headers].map(([k, v]) => `${k}: ${v}`).join('\n') + '\n' + (await copy.text()));
  return res;
}
const post = async (path: string, json: unknown, ip = IPS[0]) => {
  const res = await call(req(path, { json, origin: SITE, ip }));
  return { res, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

async function useEverything() {
  const bindingSecret = 'browser-secret-for-the-secrets-test';
  const binding_hash = await bindingFor(bindingSecret);
  await post('/api/check', { draft, review, consent: true });
  await post('/api/check', {}, IPS[1]);
  const link = await post('/api/stage', { draft, review, consent: true, idempotency_key: 'secrets-1', contributor: { name: 'Ada' } }, IPS[1]);
  await call(req(`/api/staged/${link.body.staged_id}`, { origin: SITE, ip: IPS[2] }));
  await post('/api/stage', { draft: 'tiny', review: '', consent: true }, IPS[2]); // fails the basic rules
  const begun = await post('/api/begin', { staged_id: link.body.staged_id, consent: true, binding_hash });
  const state = new URL(begun.body.authorize_url).searchParams.get('state')!;
  await post('/api/complete', { code: 'x', state, binding: 'the wrong secret' }); // binding mismatch
  const second = await post('/api/begin', { draft, review, consent: true, binding_hash });
  const state2 = new URL(second.body.authorize_url).searchParams.get('state')!;
  world.github.failNext(/access_token/, 503, 'down');
  await post('/api/complete', { code: world.github.issueCode(ADA), state: state2, binding: bindingSecret }); // GitHub down
  const third = await post('/api/begin', { draft, review, consent: true, binding_hash });
  const state3 = new URL(third.body.authorize_url).searchParams.get('state')!;
  await post('/api/complete', { code: world.github.issueCode(ADA), state: state3, binding: bindingSecret }); // posted
  await post('/api/complete', { code: 'again', state: state3, binding: bindingSecret }); // repeated
  const fourth = await post('/api/begin', { draft, review, consent: true, binding_hash });
  await post('/api/complete', { code: 'never-issued', state: new URL(fourth.body.authorize_url).searchParams.get('state')!, binding: bindingSecret }); // refused
  for (let i = 0; i < 12; i++) await post('/api/begin', { draft, review, consent: true, binding_hash }, IPS[3]); // into the rate limit

  // The connector's sign-in and a signed-in post, and one without a token.
  const token = await signIn(world, { id: 77, login: 'signed-in' });
  await callTool(world, 'submit_proposal', { draft, review, consent: true, idempotency_key: 'signed' }, { token: token.accessToken, ip: IPS[0] });
  await callTool(world, 'submit_proposal', { draft, review, consent: true }, { ip: IPS[1] });
  await call(req('/mcp', { json: { jsonrpc: '2.0', id: 1, method: 'tools/list' }, headers: { authorization: 'Bearer nonsense', accept: 'application/json, text/event-stream' }, ip: IPS[2] }));

  // And a failure that nobody planned for.
  const kvGet = world.kv.get.bind(world.kv);
  world.kv.get = async () => { throw new Error(`boom ${SIGNING_KEY}`); };
  await post('/api/stage', { draft, review, consent: true }, IPS[2]);
  world.kv.get = kvGet;
  await world.ctx.flush();
  return { token };
}

describe('secrets stay secret', () => {
  it('keeps every server secret, token, code and address out of responses, logs, issues, comments and storage', async () => {
    const { token } = await useEverything();
    const pem = world.env.GITHUB_APP_PRIVATE_KEY as string;
    const pemBody = pem.split('\n').filter((l) => l && !l.startsWith('-----'))[3];

    const forbidden: [string, string][] = [
      ['the GitHub client secret', world.github.clientSecret],
      ['the signing key', SIGNING_KEY],
      ['the private key', pemBody],
      ['the private key header', 'BEGIN PRIVATE KEY'],
      ...world.github.everIssued.map((t): [string, string] => [`GitHub value ${t.slice(0, 6)}...`, t]),
      ...IPS.map((ip): [string, string] => [`the address ${ip}`, ip]),
      ['the browser secret', 'browser-secret-for-the-secrets-test'],
    ];
    expect(world.github.everIssued.length).toBeGreaterThan(5);

    const places: [string, string][] = [
      ['a response', seen.join('\n=====\n')],
      ['a log line', world.logs.join('\n')],
      ['an issue', world.github.issues.map((i) => `${i.title}\n${i.body}\n${i.comments.join('\n')}\n${i.labels.join(',')}`).join('\n=====\n')],
      ['the queue store', world.kv.dump()],
      ['a storage key', world.kv.keys().join('\n')],
    ];
    for (const [where, text] of places) {
      expect(text.length, where).toBeGreaterThan(0);
      for (const [what, value] of forbidden) expect(text.includes(value), `${what} must not appear in ${where}`).toBe(false);
    }

    // The sign-in store keeps its own tokens only as hashes, and none of GitHub's.
    const oauthStore = world.oauthKv.dump() + world.oauthKv.keys().join('\n');
    for (const [what, value] of forbidden) expect(oauthStore.includes(value), `${what} must not appear in the sign-in store`).toBe(false);
    expect(oauthStore.includes(token.accessToken)).toBe(false);
    expect(oauthStore.includes(token.refreshToken!)).toBe(false);
  });

  it('writes log lines that are only an event name and a few plain facts', async () => {
    await useEverything();
    const allowed = new Set(['event', 'via', 'issue', 'kind', 'step', 'missing', 'error', 'code', 'status', 'category', 'reason', 'unsure']);
    const lines = world.logs.filter((l) => l.startsWith('{'));
    expect(lines.length).toBeGreaterThan(5);
    for (const line of world.logs) {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      expect(typeof parsed.event, line).toBe('string');
      for (const key of Object.keys(parsed)) expect(allowed.has(key), `${key} in ${line}`).toBe(true);
    }
    expect(world.logs.join('\n')).toContain('queue.unexpected_error');
  });

  it('keeps addresses only as a short digest that changes each day', async () => {
    const digests = () => world.kv.keys().filter((k) => k.startsWith('rl:ip:check:')).map((k) => k.split(':').pop()!);
    await post('/api/check', {}, IPS[0]);
    const [first] = digests();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(first).toBe((await hmacHex(SIGNING_KEY, `ip:${new Date(world.clock.now()).toISOString().slice(0, 10)}:${IPS[0]}`)).slice(0, 32));
    world.clock.advance(3600); // the next hour, the same day: the same digest
    await post('/api/check', {}, IPS[0]);
    expect(new Set(digests())).toEqual(new Set([first]));
    world.clock.advance(24 * 3600); // the next day: a different one
    await post('/api/check', {}, IPS[0]);
    expect(digests().filter((d) => d !== first).length).toBeGreaterThan(0);
    expect(digests()).not.toContain(first);
  });

  it('puts nothing but hashes of the sign-in state, the staged id and the browser secret in storage keys', async () => {
    const secret = 'another-browser-secret';
    const { body } = await post('/api/begin', { draft, review, consent: true, binding_hash: await bindingFor(secret) });
    const state = new URL(body.authorize_url).searchParams.get('state')!;
    const keys = world.kv.keys();
    for (const k of keys) {
      expect(k, k).toMatch(/^(staged|state|result|idem:stage|idem:post|rl:ip:[a-z]+:\d+|rl:acct:\d+):?[0-9a-f:-]*$/);
      expect(k).not.toContain(state);
      expect(k).not.toContain(body.staged_id);
      expect(k).not.toContain(secret);
    }
    expect(world.kv.dump()).not.toContain(secret);
  });
});
