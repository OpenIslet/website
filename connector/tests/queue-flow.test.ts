// Finishing a sign-in: POST /api/complete, and everything that decides whether an issue is opened, once.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hmacHex } from '../src/core/queue/crypto';
import { PENDING_MS } from '../src/core/queue/limits';
import { makeDraft, makeReview, shownQuote } from './fixtures';
import { SIGNING_KEY, type World, bindingFor, installWorld, makeWorld, req, restore } from './queue-fakes';

vi.mock('agents/mcp', async () => import('agents/mcp/server'));

const SITE = 'https://openislet.org';
const f = shownQuote();
const evidence = [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`];
const draft = makeDraft({ evidence });
const review = makeReview();
const IP = '203.0.113.7';
const ADA = { id: 1234, login: 'octo-cat' };

let world: World;
async function setup(vars: Parameters<typeof makeWorld>[0] = {}) {
  restore();
  world = await makeWorld(vars);
  installWorld(world);
}
beforeEach(async () => setup());
afterEach(restore);

const post = async (path: string, json: unknown, ip = IP) => {
  const res = await world.call(req(path, { json, origin: SITE, ip }));
  return { res, body: (await res.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
};

/** What the form does: begin, with a secret it keeps. Returns what it needs for the finish step. */
async function begin(extra: Record<string, unknown> = {}) {
  const secret = `browser-secret-${Math.random().toString(36).slice(2)}`;
  const { res, body } = await post('/api/begin', { draft, review, consent: true, binding_hash: await bindingFor(secret), ...extra });
  expect(res.status, JSON.stringify(body)).toBe(200);
  return { secret, state: new URL(body.authorize_url).searchParams.get('state')!, stagedId: body.staged_id as string };
}
const finish = (b: { secret: string; state: string }, code: string) => post('/api/complete', { code, state: b.state, binding: b.secret });
const staged = (id: string) => world.call(req(`/api/staged/${id}`, { origin: SITE }));
const marker = (body: string) => JSON.parse(/<!-- openislet:submission (\{.*\}) -->\s*$/.exec(body)![1]);

describe('POST /api/complete: the good path', () => {
  it('opens a public issue that names the contributor, and says where it is', async () => {
    const b = await begin({ ai_tools: { draft: 'Model A (High)', review: 'Model B (Max)' } });
    const { res, body } = await finish(b, world.github.issueCode(ADA));
    expect(res.status).toBe(200);
    expect(body).toEqual({
      submitted: true,
      issue: { number: 1, url: 'https://github.test/openislet/openislet/issues/1' },
      record_id: 'IIP-0001',
      contributor: { github: 'octo-cat' },
    });

    const issue = world.github.newestIssue;
    expect(issue.title).toBe('[IIP] Too little CD47 at hour zero?');
    expect(issue.labels).toEqual(expect.arrayContaining(['submission', 'status:queued', 'type:problem-found', 'test:3', 'design:a']));
    expect(issue.body.startsWith('Submitted by @octo-cat (verified through GitHub)')).toBe(true);
    expect(issue.body).toContain('AI tools (self-reported): draft = Model A (High), review = Model B (Max)');
    expect(issue.body).toContain('Consent: published openly under CC BY 4.0');
    expect(issue.body).toContain('<details open>\n<summary>Draft</summary>');
    expect(issue.body).toContain('# Too little CD47 at hour zero?');

    // The first comment is the Automatic checks table, under its fixed heading.
    expect(issue.comments).toHaveLength(1);
    expect(issue.comments[0].split('\n')[0]).toBe('## Automatic checks');

    // The hidden marker is last and signed.
    const m = marker(issue.body);
    const { sig, ...rest } = m;
    expect(m).toMatchObject({ v: 1, via: 'web_form', idempotency_key: null, claim: expect.stringContaining('B2M promoter'), pmids: expect.arrayContaining([f.pmid]) });
    expect(sig).toBe(await hmacHex(SIGNING_KEY, JSON.stringify(rest)));
  });

  it('shows what the contributor chose to say, labelled as not verified, and returns it', async () => {
    const b = await begin({ contributor: { name: 'Ada Lovelace', orcid: '0000-0002-1825-0097', x: '@ada_l' } });
    const { body } = await finish(b, world.github.issueCode(ADA));
    expect(body.contributor).toEqual({ github: 'octo-cat', name: 'Ada Lovelace', orcid: '0000-0002-1825-0097', x: 'ada_l' });
    expect(world.github.newestIssue.body).toContain('Stated by the contributor, not verified: name Ada Lovelace, ORCID [0000-0002-1825-0097](https://orcid.org/0000-0002-1825-0097), X [x.com/ada_l](https://x.com/ada_l)');
  });

  it('uses the GitHub username GitHub reports, never anything the contributor typed', async () => {
    const b = await begin({ contributor: { name: '@someone-else (verified through GitHub)' } });
    await finish(b, world.github.issueCode({ id: 77, login: 'real-person' }));
    const top = world.github.newestIssue.body.split('<details open>')[0];
    expect(top.startsWith('Submitted by @real-person (verified through GitHub)')).toBe(true);
    expect([...top.matchAll(/@([A-Za-z0-9_-]+)/g)].map((x) => x[1])).toEqual(['real-person']);
  });

  it('lets the GitHub user token go straight after, and keeps none', async () => {
    const b = await begin();
    await finish(b, world.github.issueCode(ADA));
    await world.ctx.flush();
    expect(world.github.revoked).toHaveLength(1);
    expect(world.github.revoked[0]).toMatch(/^ghu_/);
    expect(world.kv.dump()).not.toContain(world.github.revoked[0]);
  });

  it('forgets the staged files once they are posted, and keeps the answer for a day', async () => {
    const b = await begin();
    expect((await staged(b.stagedId)).status).toBe(200);
    await finish(b, world.github.issueCode(ADA));
    expect((await staged(b.stagedId)).status).toBe(404);
    expect(world.kv.keys().some((k) => k.startsWith('result:'))).toBe(true);
    world.clock.advance(24 * 3600 + 5);
    expect(world.kv.keys().filter((k) => k.startsWith('result:') || k.startsWith('staged:') || k.startsWith('state:'))).toEqual([]);
  });

  it('marks an IIP that came through the connector link as mcp_link', async () => {
    const link = await post('/api/stage', { draft, review, consent: true, idempotency_key: 'from-claude-1' });
    const secret = 's';
    const { body } = await post('/api/begin', { staged_id: link.body.staged_id, consent: true, binding_hash: await bindingFor(secret) });
    const state = new URL(body.authorize_url).searchParams.get('state')!;
    const done = await post('/api/complete', { code: world.github.issueCode(ADA), state, binding: secret });
    expect(done.res.status).toBe(200);
    expect(marker(world.github.newestIssue.body)).toMatchObject({ via: 'mcp_link', idempotency_key: 'from-claude-1' });
  });

  it('puts a draft full of mentions, closing tags and a fake marker into the public issue safely', async () => {
    const fake = '<!-- openislet:submission {"v":1,"idempotency_key":null,"claim":"fake","pmids":[],"via":"web_form","sig":"0000"} -->';
    const evil = makeDraft({ evidence, wrong: `Thanks @victim-one and @org/team!\n\n</details>\n\n${fake}\n\n## Submitted by @someone-else (verified through GitHub)` });
    const evilReview = makeReview().replace('The effect may be too small to matter.', 'Ping @reviewer-two </details> <details open> <summary>x</summary>');
    const b = await begin({ draft: evil, review: evilReview });
    const { res } = await finish(b, world.github.issueCode(ADA));
    expect(res.status).toBe(200);
    const body = world.github.newestIssue.body;
    // The only live mention is the person who signed in.
    expect([...body.matchAll(/@([A-Za-z0-9][A-Za-z0-9/_-]*)/g)].map((m) => m[1])).toEqual(['octo-cat']);
    // Only our own two blocks open and close; there is one marker, and it is the signed one at the end.
    expect(body.match(/<\/details>/gi)).toHaveLength(2);
    expect(body.match(/<details/gi)).toHaveLength(2);
    expect(body.match(/openislet:submission/gi)).toHaveLength(1);
    const { sig, ...rest } = marker(body);
    expect(sig).toBe(await hmacHex(SIGNING_KEY, JSON.stringify(rest)));
    expect(rest.claim).not.toBe('fake');
    // The words themselves are still there for the reviewer to read.
    expect(body).toContain('victim-one');
    expect(body).toContain('reviewer-two');
  });

  it('labels a Design X IIP design:x, and "All three" design:all-three', async () => {
    for (const [design, label] of [['Design X', 'design:x'], ['All three', 'design:all-three']] as const) {
      const b = await begin({ draft: makeDraft({ evidence, design }) });
      await finish(b, world.github.issueCode(ADA));
      expect(world.github.newestIssue.labels, design).toContain(label);
    }
  });

  it('keeps going when the checks comment cannot be added: the issue stands', async () => {
    world.github.failNext(/comments$/, 500, {}, 3);
    const b = await begin();
    const { res, body } = await finish(b, world.github.issueCode(ADA));
    expect(res.status).toBe(200);
    expect(body.record_id).toBe('IIP-0001');
    expect(world.github.newestIssue.comments).toEqual([]);
    expect(world.logs.join('\n')).toContain('queue.comment_failed');
  });

  it('refuses an IIP whose two files cannot fit in one issue, before anyone signs in', async () => {
    // Each "@a" gains an invisible character when mentions are defanged, so these fit the 30,000-character rule but grow past one issue.
    const pad = (lines: number) => ('@a '.repeat(300) + '\n').repeat(lines);
    const big = makeDraft({ evidence, proposal: pad(31) });
    const bigReview = makeReview().replace('The effect may be too small to matter.', pad(31));
    expect(big.length).toBeLessThan(30000);
    const { res, body } = await post('/api/begin', { draft: big, review: bigReview, consent: true, binding_hash: await bindingFor('s') });
    expect(res.status).toBe(422);
    expect(body.error).toBe('basic_rules');
    expect(body.door.find((d: { id: string }) => d.id === 'size')).toMatchObject({ status: 'fail' });
    expect(world.github.requests).toHaveLength(0);
  });
});

describe('POST /api/complete: once only', () => {
  it('answers a repeated call with the first answer and never opens a second issue', async () => {
    const b = await begin();
    const first = await finish(b, world.github.issueCode(ADA));
    const tokenCalls = world.github.requests.filter((r) => r.url.endsWith('/access_token')).length;
    const again = await finish(b, world.github.issueCode(ADA)); // a fresh code, as if the page was reloaded
    expect(again.res.status).toBe(200);
    expect(again.body).toEqual(first.body);
    expect(world.github.issues).toHaveLength(1);
    expect(world.github.requests.filter((r) => r.url.endsWith('/access_token')).length).toBe(tokenCalls);
    // It still works later in the day, long after the 15 minutes of the sign-in itself.
    world.clock.advance(3 * 3600);
    expect((await finish(b, 'whatever')).body).toEqual(first.body);
    expect(world.github.issues).toHaveLength(1);
  });

  it('still gives the posted answer when saving it fails, and a repeat of the sign-in finds it', async () => {
    const b = await begin();
    world.kv.failPuts = { match: /^result:/, times: 10 }; // the result record is never saved
    const first = await finish(b, world.github.issueCode(ADA));
    expect(first.res.status).toBe(200);
    expect(first.body).toMatchObject({ submitted: true, record_id: 'IIP-0001' });
    const again = await finish(b, 'whatever');
    expect(again.res.status).toBe(200);
    expect(again.body).toEqual(first.body); // from the used sign-in record
    expect(world.github.issues).toHaveLength(1);
  });

  it('still gives the posted answer when tidying up the staged files fails', async () => {
    const b = await begin();
    world.kv.failDeletes = { match: /^staged:/, times: 10 };
    const first = await finish(b, world.github.issueCode(ADA));
    expect(first.res.status).toBe(200);
    expect((await finish(b, 'whatever')).body).toEqual(first.body);
    expect(world.github.issues).toHaveLength(1);
  });

  it('gives a repeat from another browser a binding_mismatch, not the answer', async () => {
    const b = await begin();
    await finish(b, world.github.issueCode(ADA));
    const other = await post('/api/complete', { code: 'x', state: b.state, binding: 'someone-elses-secret' });
    expect(other.res.status).toBe(400);
    expect(other.body.error).toBe('binding_mismatch');
  });

  it('does not open a second issue when the same files get two sign-ins', async () => {
    const first = await begin();
    const second = await post('/api/begin', { staged_id: first.stagedId, consent: true, binding_hash: await bindingFor(first.secret) });
    const secondState = new URL(second.body.authorize_url).searchParams.get('state')!;
    const a = await finish(first, world.github.issueCode(ADA));
    const b = await post('/api/complete', { code: world.github.issueCode(ADA), state: secondState, binding: first.secret });
    expect(b.res.status).toBe(200);
    expect(b.body).toEqual(a.body);
    expect(world.github.issues).toHaveLength(1);
  });

  it('says state_unknown for a state it never made, and for one that has run out', async () => {
    const never = await post('/api/complete', { code: 'c', state: 'N'.repeat(22), binding: 'b' });
    expect(never.res.status).toBe(400);
    expect(never.body.error).toBe('state_unknown');
    const b = await begin();
    world.clock.advance(15 * 60 + 1);
    const late = await finish(b, world.github.issueCode(ADA));
    expect(late.res.status).toBe(400);
    expect(late.body.error).toBe('state_unknown');
    expect(world.github.requests.filter((r) => r.url.endsWith('/access_token'))).toHaveLength(0);
  });

  it('still works on the last second of the 15 minutes', async () => {
    const b = await begin();
    world.clock.advance(15 * 60 - 1);
    expect((await finish(b, world.github.issueCode(ADA))).res.status).toBe(200);
  });
});

describe('POST /api/complete: binding', () => {
  it('stops a sign-in finished in another browser, before GitHub is even asked', async () => {
    const b = await begin();
    const code = world.github.issueCode(ADA);
    const { res, body } = await post('/api/complete', { code, state: b.state, binding: 'a-different-secret' });
    expect(res.status).toBe(400);
    expect(body.error).toBe('binding_mismatch');
    expect(body.message).toMatch(/different browser/);
    expect(world.github.requests).toHaveLength(0);
    expect(world.github.codes.get(code)!.used).toBe(false);
  });

  it('uses up the state when the binding is wrong: the right browser cannot then finish with it', async () => {
    const b = await begin();
    await post('/api/complete', { code: 'x', state: b.state, binding: 'a-different-secret' });
    const retry = await finish(b, world.github.issueCode(ADA));
    expect(retry.res.status).toBe(400);
    expect(retry.body.error).toBe('state_unknown');
    expect(world.github.issues).toHaveLength(0);
  });

  it('compares the hash of the secret, not the secret', async () => {
    const b = await begin();
    const wrong = await post('/api/complete', { code: 'x', state: b.state, binding: await bindingFor(b.secret) });
    expect(wrong.body.error).toBe('binding_mismatch');
  });
});

describe('POST /api/complete: when GitHub says no or does not answer', () => {
  it('answers github_refused (401) for a code GitHub rejects, and keeps the files', async () => {
    const b = await begin();
    const { res, body } = await finish(b, 'a-code-github-never-issued');
    expect(res.status).toBe(401);
    expect(body.error).toBe('github_refused');
    expect(body.message).toMatch(/did not accept/);
    expect(world.github.issues).toHaveLength(0);
    expect((await staged(b.stagedId)).status).toBe(200);
  });

  it('answers github_unavailable (502) when GitHub is down, keeps the files, and lets the person try again', async () => {
    const b = await begin();
    world.github.failNext(/access_token/, 503, 'down');
    const { res, body } = await finish(b, world.github.issueCode(ADA));
    expect(res.status).toBe(502);
    expect(body.error).toBe('github_unavailable');
    expect(body.message).toMatch(/still saved/);
    expect(world.github.issues).toHaveLength(0);
    expect((await staged(b.stagedId)).status).toBe(200);

    // Trying again means pressing the button again: a new sign-in for the same saved files.
    const again = await post('/api/begin', { staged_id: b.stagedId, consent: true, binding_hash: await bindingFor('second-secret') });
    const state = new URL(again.body.authorize_url).searchParams.get('state')!;
    const done = await post('/api/complete', { code: world.github.issueCode(ADA), state, binding: 'second-secret' });
    expect(done.res.status).toBe(200);
    expect(world.github.issues).toHaveLength(1);
  });

  it('answers github_unavailable when the issue itself cannot be opened, without leaving a half-made one', async () => {
    const b = await begin();
    world.github.failNext(/issues$/, 500, {}, 2);
    const { res, body } = await finish(b, world.github.issueCode(ADA));
    expect(res.status).toBe(502);
    expect(body.error).toBe('github_unavailable');
    // The request to open the issue was sent and no clear answer came back, so the answer must not claim that nothing was posted.
    expect(body.outcome_unknown).toBe(true);
    expect(body.message).toMatch(/can.t be sure/);
    expect(body.message).toMatch(/Islet Improvement Proposal \(IIP\) was posted/);
    expect(body.message).not.toMatch(/finding/i);
    expect(body.message).toMatch(/public queue/);
    expect(body.message).not.toMatch(/nothing was posted/);
    expect(body.queue_url).toMatch(/\/issues$/);
    expect(world.github.issues).toHaveLength(0);
    expect((await staged(b.stagedId)).status).toBe(200);
    // A failed post does not use up the day's allowance or the hour's, and does not hold the IIP back from a retry.
    expect([...world.limits.storage.data].filter(([k, v]) => /^(acct|hour):/.test(k) && v !== 0)).toEqual([]);
    expect([...world.limits.storage.data.keys()].some((k) => k.startsWith('seen:'))).toBe(false);
  });

  it('answers queue_broken (503) when the bot key is not accepted, says it is not the person\'s fault, and never shows why', async () => {
    await setup({ GITHUB_APP_PRIVATE_KEY: '-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----' });
    const b = await begin();
    const { res, body } = await finish(b, world.github.issueCode(ADA));
    expect(res.status).toBe(503);
    expect(body.error).toBe('queue_broken');
    expect(body.message).toMatch(/fault on our side, not yours/);
    expect(body.message).toMatch(/still saved here for 24 hours/);
    expect(JSON.stringify(body)).not.toMatch(/PKCS|key|AAAA/i);
    expect((await staged(b.stagedId)).status).toBe(200);
  });

  it.each([
    ['the app was uninstalled or made private, so the bot gets no token', /access_tokens/, 404],
    ['the app is suspended, so the bot is forbidden to open the issue', /issues$/, 403],
    ['issues are switched off on the repository', /issues$/, 410],
  ] as const)('answers queue_broken (503), not "try again in a few minutes", when %s', async (_why, match, status) => {
    const b = await begin();
    world.github.failNext(match, status, { message: 'nope' }, 3);
    const { res, body } = await finish(b, world.github.issueCode(ADA));
    expect(res.status).toBe(503);
    expect(body.error).toBe('queue_broken');
    expect(body.message).toMatch(/fault on our side, not yours/);
    expect(body.message).toMatch(/still saved here for 24 hours/);
    expect(body.message).not.toMatch(/few minutes|did not answer/);
    expect(body.outcome_unknown).toBeUndefined();
    expect(world.github.issues).toHaveLength(0);
    // The files are kept, the day's allowance is not used up, and the person can press the button again.
    expect((await staged(b.stagedId)).status).toBe(200);
    expect([...world.limits.storage.data].filter(([k, v]) => /^(acct|hour):/.test(k) && v !== 0)).toEqual([]);
    expect(world.logs.join('\n')).toContain('queue.broken');
  });

  it('answers queue_broken (503) when GitHub refuses our own client details at sign-in, without naming them', async () => {
    await setup({ GITHUB_CLIENT_SECRET: 'a-secret-github-does-not-know' });
    const b = await begin();
    const { res, body } = await finish(b, world.github.issueCode(ADA));
    expect(res.status).toBe(503);
    expect(body.error).toBe('queue_broken');
    expect(JSON.stringify(body)).not.toMatch(/secret/i);
    expect(world.logs.join('\n')).toContain('queue.broken');
  });

  it('still says "try again" when GitHub only asks us to slow down', async () => {
    const b = await begin();
    world.github.failNext(/issues$/, 403, { message: 'secondary rate limit' }, 1, { 'retry-after': '60' });
    const { res, body } = await finish(b, world.github.issueCode(ADA));
    expect(res.status).toBe(502);
    expect(body.error).toBe('github_unavailable');
    expect(world.logs.join('\n')).not.toContain('queue.broken');
  });

  it('refuses a username it cannot trust', async () => {
    const b = await begin();
    const { res, body } = await finish(b, world.github.issueCode({ id: 9, login: 'not a login' }));
    expect(res.status).toBe(502);
    expect(body.error).toBe('github_unavailable');
    expect(world.github.issues).toHaveLength(0);
  });
});

describe('POST /api/complete: a try that is cut off', () => {
  it('does not resume a try that signed in but never posted: the same page says the sign-in was used, and nothing is posted twice', async () => {
    const b = await begin();
    const code = world.github.issueCode(ADA);
    world.limits.down = true; // the first try gets as far as signing in, then cannot take a place under the limits
    const first = await finish(b, code);
    expect(first.res.status).toBe(503);
    world.limits.down = false;
    // The same page again: the code was used and nothing was posted, so this sign-in is finished. It says so; it never posts.
    const again = await finish(b, code);
    expect(again.res.status).toBe(400);
    expect(again.body.error).toBe('state_unknown');
    expect(world.github.issues).toHaveLength(0);
    // Pressing the button again from the form starts a new sign-in for the same saved files, and that works.
    const next = await post('/api/begin', { staged_id: b.stagedId, consent: true, binding_hash: await bindingFor('second-secret') });
    const state = new URL(next.body.authorize_url).searchParams.get('state')!;
    const done = await post('/api/complete', { code: world.github.issueCode(ADA), state, binding: 'second-secret' });
    expect(done.res.status).toBe(200);
    expect(world.github.issues).toHaveLength(1);
  });

  it('does not post a second issue when GitHub made the first but its answer was lost and the page is reloaded', async () => {
    const b = await begin();
    const code = world.github.issueCode(ADA);
    world.github.loseAnswerNext(/issues$/);
    const first = await finish(b, code);
    // GitHub made the issue, but we could not be sure: the answer says to look at the public queue before trying again.
    expect(first.res.status).toBe(502);
    expect(first.body.outcome_unknown).toBe(true);
    expect(world.github.issues).toHaveLength(1);
    // Reloading the page must not post again: the sign-in was used.
    const reload = await finish(b, code);
    expect(reload.res.status).toBe(400);
    expect(reload.body.error).toBe('state_unknown');
    expect(world.github.issues).toHaveLength(1);
  });

  it('does not let another browser read or finish a cut-off try', async () => {
    const b = await begin();
    const code = world.github.issueCode(ADA);
    world.limits.down = true;
    await finish(b, code);
    world.limits.down = false;
    const stranger = await post('/api/complete', { code, state: b.state, binding: 'someone-elses-secret' });
    expect(stranger.res.status).toBe(400);
    expect(stranger.body.error).toBe('binding_mismatch');
    expect(world.github.issues).toHaveLength(0);
  });

  it('records the answer as soon as the issue exists, before the checks comment, which may be slow', async () => {
    const b = await begin();
    const spy = vi.spyOn(world.ctx, 'waitUntil');
    const release = world.github.hold(/comments$/);
    const pending = finish(b, world.github.issueCode(ADA));
    // The issue is there and the answer is recorded while the comment is still held back.
    await vi.waitFor(() => expect(world.github.issues).toHaveLength(1));
    await vi.waitFor(() => expect(world.kv.keys().some((k) => k.startsWith('result:'))).toBe(true));
    expect(world.github.newestIssue.comments).toHaveLength(0);
    // And the posting itself is what the Worker has been asked to keep alive: its promise is still unfinished while the comment is held.
    const stillGoing = async (p: Promise<unknown>) => (await Promise.race([p.then(() => 'done', () => 'done'), new Promise((r) => setTimeout(() => r('going'), 30))])) === 'going';
    const kept = spy.mock.calls.map((c) => c[0] as Promise<unknown>);
    expect((await Promise.all(kept.map(stillGoing))).some(Boolean)).toBe(true);
    // The limits know too: pressing the button again with the same files, while the comment is still held back, gets this issue.
    const b2 = await begin();
    const second = await finish(b2, world.github.issueCode(ADA));
    expect(second.res.status).toBe(200);
    expect(second.body.issue.number).toBe(1);
    expect(world.github.issues).toHaveLength(1);
    release();
    const { res, body } = await pending;
    expect(res.status).toBe(200);
    expect(body.issue.number).toBe(1);
    expect(world.github.newestIssue.comments).toHaveLength(1);
    await world.ctx.flush();
    expect((await Promise.all(kept.map(stillGoing))).some(Boolean)).toBe(false);
  });

  it('gives the same answer again to the same browser when the first try finished while it was away', async () => {
    const b = await begin();
    const code = world.github.issueCode(ADA);
    const first = await finish(b, code);
    expect(first.res.status).toBe(200);
    // The page is loaded again with the same code, sign-in and secret (the first answer was never seen): the first answer, no second issue.
    const again = await finish(b, code);
    expect(again.res.status).toBe(200);
    expect(again.body.issue).toEqual(first.body.issue);
    expect(world.github.issues).toHaveLength(1);
  });

  it('hands the posting to the Worker, so it finishes even if the browser has gone', async () => {
    const b = await begin();
    const spy = vi.spyOn(world.ctx, 'waitUntil');
    const { res } = await finish(b, world.github.issueCode(ADA));
    expect(res.status).toBe(200);
    // One for letting go of the GitHub token, and one for the posting itself.
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
    await world.ctx.flush();
    expect(world.github.issues).toHaveLength(1);
  });
});

describe('POST /api/complete: the daily limit per GitHub account', () => {
  beforeEach(async () => setup({ DAILY_LIMIT_PER_ACCOUNT: '2' }));

  it('lets an account post its daily number, then says to come back tomorrow', async () => {
    for (let i = 0; i < 2; i++) {
      const b = await begin({ draft: draft + ` v${i}` });
      expect((await finish(b, world.github.issueCode(ADA))).res.status).toBe(200);
    }
    const b = await begin({ draft: draft + ' v3' });
    const { res, body } = await finish(b, world.github.issueCode(ADA));
    expect(res.status).toBe(429);
    expect(body.error).toBe('rate_limited');
    expect(body.message).toMatch(/daily limit/);
    expect(body.message).toMatch(/Islet Improvement Proposals \(IIPs\)/);
    expect(body.message).not.toMatch(/finding/i);
    const untilMidnight = Math.ceil((Date.UTC(2026, 10, 4) - world.clock.now()) / 1000);
    expect(body.retry_after_seconds).toBe(untilMidnight);
    expect(res.headers.get('retry-after')).toBe(String(untilMidnight));
    expect(world.github.issues).toHaveLength(2);
    expect((await staged(b.stagedId)).status).toBe(200);

    // Another account is not held up, and after midnight UTC the first one is free again.
    const other = await begin({ draft: draft + ' v4' });
    expect((await finish(other, world.github.issueCode({ id: 99, login: 'someone-else' }))).res.status).toBe(200);
    world.clock.ms = Date.UTC(2026, 10, 4, 0, 0, 5);
    vi.setSystemTime(world.clock.ms);
    const next = await begin({ draft: draft + ' v5' });
    expect((await finish(next, world.github.issueCode(ADA))).res.status).toBe(200);
  });

  it('counts by the numeric GitHub ID, so a changed username is the same account', async () => {
    for (const login of ['first-name', 'second-name']) {
      const b = await begin({ draft: draft + login });
      expect((await finish(b, world.github.issueCode({ id: 5, login }))).res.status).toBe(200);
    }
    const b = await begin({ draft: draft + 'third' });
    expect((await finish(b, world.github.issueCode({ id: 5, login: 'third-name' }))).res.status).toBe(429);
    expect(world.limits.storage.data.get('acct:5:2026-11-03')).toBe(2);
    expect([...world.limits.storage.data.keys()].filter((k) => k.startsWith('acct:'))).toEqual(['acct:5:2026-11-03']);
  });
});

describe('POST /api/complete: limits that hold exactly, and one issue per IIP', () => {
  it('keeps the daily limit when several sign-ins finish at the same moment', async () => {
    await setup({ DAILY_LIMIT_PER_ACCOUNT: '2' });
    const started = [];
    for (let i = 0; i < 4; i++) started.push(await begin({ draft: draft + ` at once ${i}` }));
    const results = await Promise.all(started.map((b) => finish(b, world.github.issueCode(ADA))));
    expect(results.map((r) => r.res.status).sort()).toEqual([200, 200, 429, 429]);
    expect(world.github.issues).toHaveLength(2);
  });

  it('pauses new IIPs from everyone when the hour is full, says so plainly, and opens again the next hour', async () => {
    await setup({ HOURLY_LIMIT_EVERYONE: '2' });
    for (let id = 1; id <= 2; id++) {
      const b = await begin({ draft: draft + ` account ${id}` });
      expect((await finish(b, world.github.issueCode({ id, login: `person-${id}` }))).res.status).toBe(200);
    }
    const b = await begin({ draft: draft + ' account 3' });
    const { res, body } = await finish(b, world.github.issueCode({ id: 3, login: 'person-3' }));
    expect(res.status).toBe(429);
    expect(body.error).toBe('rate_limited');
    expect(body.message).toMatch(/A lot of Islet Improvement Proposals \(IIPs\) have arrived in the last hour/);
    expect(body.message).toMatch(/Nothing was posted/);
    expect(body.message).toMatch(/Your files are still saved here for 24 hours/);
    expect(res.headers.get('retry-after')).toBe(String(body.retry_after_seconds));
    expect(world.github.issues).toHaveLength(2);
    expect((await staged(b.stagedId)).status).toBe(200);
    world.clock.ms += 3_600_000;
    vi.setSystemTime(world.clock.ms);
    const again = await begin({ draft: draft + ' account 3' });
    expect((await finish(again, world.github.issueCode({ id: 3, login: 'person-3' }))).res.status).toBe(200);
  });

  it('gives the first answer, not a second issue, when the same person sends the same IIP again after a lost answer', async () => {
    const first = await begin();
    const one = await finish(first, world.github.issueCode(ADA));
    expect(one.res.status).toBe(200);
    // The answer never reached the browser, so the person starts again from the form with the same files.
    const second = await begin();
    const two = await finish(second, world.github.issueCode(ADA));
    expect(two.res.status).toBe(200);
    expect(two.body).toEqual(one.body);
    expect(world.github.issues).toHaveLength(1);
    // That sign-in is finished too: repeating it gives the same answer, and its saved files are gone.
    expect((await finish(second, world.github.issueCode(ADA))).body).toEqual(one.body);
    expect((await staged(second.stagedId)).status).toBe(404);
    // Another account sending the same text is its own IIP.
    const other = await begin();
    expect((await finish(other, world.github.issueCode({ id: 99, login: 'someone-else' }))).body.record_id).toBe('IIP-0002');
  });

  it('opens one issue when the same IIP is finished twice at once', async () => {
    const a = await begin();
    const b = await begin();
    const results = await Promise.all([finish(a, world.github.issueCode(ADA)), finish(b, world.github.issueCode(ADA))]);
    expect(world.github.issues).toHaveLength(1);
    for (const r of results) {
      if (r.res.status === 409) {
        expect(r.body.error).toBe('in_progress');
        expect(r.body.message).toMatch(/being posted right now/);
        expect(r.body.message).toMatch(/public queue/);
      } else {
        expect(r.res.status).toBe(200);
        expect(r.body.record_id).toBe('IIP-0001');
      }
    }
  });

  it('still gives the first answer, not a second issue, when the limits could not record the post and its hold has run out', async () => {
    world.limits.failFinishes = 3; // every try to record the post fails
    const one = await finish(await begin(), world.github.issueCode(ADA));
    expect(one.res.status).toBe(200);
    expect(world.logs.join('\n')).toMatch(/queue\.limits_unavailable/);
    world.clock.ms += PENDING_MS + 1;
    vi.setSystemTime(world.clock.ms);
    const two = await finish(await begin(), world.github.issueCode(ADA));
    expect(two.res.status).toBe(200);
    expect(two.body).toEqual(one.body);
    expect(world.github.issues).toHaveLength(1);
  });

  it('tries again to record a post when the limits miss a beat, and needs no copy elsewhere when that works', async () => {
    world.limits.failFinishes = 2;
    const one = await finish(await begin(), world.github.issueCode(ADA));
    expect(one.res.status).toBe(200);
    expect(world.kv.keys().some((k) => k.startsWith('posted:'))).toBe(false);
    world.clock.ms += PENDING_MS + 1;
    vi.setSystemTime(world.clock.ms);
    expect((await finish(await begin(), world.github.issueCode(ADA))).body).toEqual(one.body);
    expect(world.github.issues).toHaveLength(1);
  });

  it('posts nothing, and says so, when the limits cannot be checked', async () => {
    world.limits.down = true;
    const b = await begin();
    const { res, body } = await finish(b, world.github.issueCode(ADA));
    expect(res.status).toBe(503);
    expect(body.error).toBe('queue_unavailable');
    expect(body.message).toMatch(/nothing was posted/);
    expect(body.message).toMatch(/still saved here for 24 hours/);
    expect(world.github.issues).toHaveLength(0);
    expect((await staged(b.stagedId)).status).toBe(200);
  });

  it('will not start a sign-in when the limits store is not bound', async () => {
    await setup({ QUEUE_LIMITS: undefined });
    const { res, body } = await post('/api/begin', { draft, review, consent: true, binding_hash: await bindingFor('x') });
    expect(res.status).toBe(503);
    expect(body.error).toBe('queue_not_configured');
    expect(world.logs.join('\n')).toMatch(/QUEUE_LIMITS/);
  });
});
