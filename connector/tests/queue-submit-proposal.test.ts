// submit_proposal, in the three situations the contract names (and the ones around them), through the real MCP server.
import { Client } from '@modelcontextprotocol/client';
import { InMemoryTransport } from '@modelcontextprotocol/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Config, defaultConfig } from '../src/core/answer';
import { GitHubClient } from '../src/core/queue/github';
import { QueueService } from '../src/core/queue/service';
import { readQueueSettings } from '../src/core/queue/settings';
import type { Identity, QueueForTool } from '../src/core/queue/types';
import { limitsFor } from '../src/queue-limits';
import { createConnectorServer } from '../src/server';
import { makeDraft, makeReview, shownQuote } from './fixtures';
import { store } from './helpers';
import { type World, bindingFor, installWorld, makeWorld, req, restore } from './queue-fakes';

vi.mock('agents/mcp', async () => import('agents/mcp/server'));

const f = shownQuote();
const evidence = [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`];
const draft = makeDraft({ evidence });
const review = makeReview();
const ADA: Identity = { id: 1234, login: 'octo-cat' };

let world: World;
async function setup(vars: Parameters<typeof makeWorld>[0] = {}) {
  restore();
  world = await makeWorld(vars);
  installWorld(world);
}
beforeEach(async () => setup());
afterEach(restore);

function serviceFor(config: Config) {
  const settings = readQueueSettings(world.env);
  const github = new GitHubClient(
    { webBase: settings.githubWebBase, apiBase: settings.githubApiBase, clientId: settings.clientId ?? '', clientSecret: settings.clientSecret ?? '', appId: settings.appId ?? '', installationId: settings.installationId ?? '', privateKey: settings.privateKey ?? '', owner: settings.owner, repo: settings.repo },
    {},
    world.github.fetch,
    world.clock.now,
  );
  return new QueueService({ kv: world.kv, limits: limitsFor(world.limits as unknown as DurableObjectNamespace), settings, config, github, now: world.clock.now, defer: (w) => world.ctx.waitUntil(w), log: (e, fields) => world.logs.push(JSON.stringify({ event: e, ...fields })) });
}

async function connect(o: { identity?: Identity; ip?: string; open?: boolean; queue?: QueueForTool | null } = {}) {
  const config: Config = { ...defaultConfig, submissionsOpen: o.open ?? true };
  // The signed-in account exists on GitHub under the name its token carries, unless a test renames it.
  if (o.identity && !world.github.accounts.has(o.identity.id)) world.github.accounts.set(o.identity.id, o.identity.login);
  const queue = o.queue === null ? undefined : (o.queue ?? serviceFor(config));
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  const server = createConnectorServer({ store, config, submit: { queue, identity: o.identity, caller: { ip: o.ip ?? '203.0.113.5' } } });
  await server.connect(serverSide);
  const client = new Client({ name: 'queue-tests', version: '1.0.0' });
  await client.connect(clientSide);
  return {
    client,
    async submit(args: Record<string, unknown> = {}) {
      const r = (await client.callTool({ name: 'submit_proposal', arguments: { draft, review, consent: true, ...args } })) as { content: { text: string }[]; structuredContent?: Record<string, any>; isError?: boolean }; // eslint-disable-line @typescript-eslint/no-explicit-any
      return { ...r, text: r.content.map((c) => c.text).join('\n') };
    },
    async close() {
      await client.close();
      await server.close();
    },
  };
}

describe('the rules that come first', () => {
  it('applies the basic rules before anything else, open or closed, signed in or not', async () => {
    for (const o of [{ open: false }, { open: true }, { open: true, identity: ADA }]) {
      const s = await connect(o);
      const r = await s.submit({ review: makeReview({ verdict: 'Not supported', submit: 'No' }) });
      expect(r.isError).toBe(true);
      expect(r.structuredContent).toMatchObject({ submitted: false, reason: 'basic_rules' });
      expect((await s.submit({ consent: false })).structuredContent).toMatchObject({ reason: 'basic_rules' });
      await s.close();
    }
    expect(world.kv.writeCount).toBe(0);
    expect(world.github.requests).toHaveLength(0);
  });

  it('sends or saves nothing while submissions are closed, and says the web form will take the same files', async () => {
    for (const identity of [undefined, ADA]) {
      const s = await connect({ open: false, identity });
      const r = await s.submit({ idempotency_key: 'k-1' });
      expect(r.isError).toBeFalsy();
      expect(r.structuredContent).toMatchObject({ submitted: false, reason: 'queue_not_open', idempotency_key: 'k-1' });
      expect(r.structuredContent?.would_be_labelled).toEqual(expect.arrayContaining(['submission', 'type:problem-found']));
      expect(r.text).toContain('Nothing was stored or sent');
      expect(r.text).toMatch(/web form on openislet\.org/);
      expect(r.text).toContain('names you');
      expect(r.text).not.toMatch(/ORCID|in your name|software and AI/i);
      await s.close();
    }
    expect(world.kv.writeCount).toBe(0);
    expect(world.oauthKv.writeCount).toBe(0);
    expect(world.github.requests).toHaveLength(0);
  });

  it('says it is not set up, as an error, when open without a queue, or with one that is not ready', async () => {
    const none = await connect({ queue: null });
    const r1 = await none.submit();
    expect(r1.isError).toBe(true);
    expect(r1.structuredContent).toMatchObject({ submitted: false, reason: 'queue_not_configured' });
    await none.close();

    await setup({ GITHUB_APP_PRIVATE_KEY: undefined });
    const notReady = await connect({ identity: ADA });
    const r2 = await notReady.submit();
    expect(r2.isError).toBe(true);
    expect(r2.structuredContent).toMatchObject({ reason: 'queue_not_configured' });
    expect(r2.text).not.toMatch(/GITHUB_APP|PRIVATE/);
    await notReady.close();

    // Without a signed-in caller what matters is the web form's own setup.
    await setup({ GITHUB_CLIENT_SECRET: undefined });
    const noLink = await connect();
    expect((await noLink.submit()).structuredContent).toMatchObject({ reason: 'queue_not_configured' });
    await noLink.close();
    expect(world.kv.writeCount).toBe(0);
    expect(world.github.requests).toHaveLength(0);
  });
});

describe('open, and the caller holds a valid token', () => {
  it('posts the issue now, naming the signed-in account', async () => {
    const s = await connect({ identity: ADA });
    const r = await s.submit({ ai_tools: { draft: 'Model A', review: 'Model B' }, contributor: { name: 'Ada Lovelace', orcid: '0000-0002-1825-0097', x: 'ada_l' } });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({
      submitted: true,
      issue: { number: 1, url: 'https://github.test/openislet/openislet/issues/1' },
      record_id: 'IIP-0001',
      contributor: { github: 'octo-cat', name: 'Ada Lovelace', orcid: '0000-0002-1825-0097', x: 'ada_l' },
    });
    expect(r.structuredContent?.reason).toBeUndefined();
    expect(r.structuredContent?.summary).toMatch(/^Sent\./);
    expect(r.structuredContent?.summary).toContain('Your Islet Improvement Proposal (IIP) is now public as IIP-0001');
    expect(r.text).not.toMatch(/finding/i);
    expect(r.text).toContain('https://github.test/openislet/openislet/issues/1');
    expect(r.text).toContain('@octo-cat');
    expect(r.text).toMatch(/A person looks the papers up and reviews the science in the weekend review/);
    expect(r.text).toMatch(/checked the format, the Idea Graveyard rules and the quotes straight away/);
    expect(r.text).not.toMatch(/ORCID sign-in|software and AI|spam/i);
    const issue = world.github.newestIssue;
    expect(issue.body.startsWith('Submitted by @octo-cat (verified through GitHub)')).toBe(true);
    expect(issue.body).toContain('Stated by the contributor, not verified: name Ada Lovelace');
    expect(issue.body).toMatch(/"via":"mcp_signed_in"/);
    expect(issue.comments[0].split('\n')[0]).toBe('## Automatic checks');
    expect(issue.labels).toEqual(expect.arrayContaining(['submission', 'status:queued', 'type:problem-found']));
    await s.close();
  });

  it('never posts twice for a retry with the same key and the same files', async () => {
    const s = await connect({ identity: ADA });
    const first = await s.submit({ idempotency_key: 'retry-1' });
    const again = await s.submit({ idempotency_key: 'retry-1' });
    expect(again.structuredContent).toMatchObject({ submitted: true, record_id: 'IIP-0001', replayed: true });
    expect(again.text).toMatch(/Already sent/);
    expect(again.structuredContent?.summary).toContain('this Islet Improvement Proposal (IIP) was posted earlier as IIP-0001');
    expect(world.github.issues).toHaveLength(1);
    expect(first.structuredContent?.replayed).toBeUndefined();
    // Different files under the same key are a different IIP; and another account's key is its own.
    const other = await s.submit({ idempotency_key: 'retry-1', draft: draft.replace('Too little CD47', 'Not enough CD47') });
    expect(other.structuredContent).toMatchObject({ submitted: true, record_id: 'IIP-0002' });
    const bob = await connect({ identity: { id: 99, login: 'bob' } });
    expect((await bob.submit({ idempotency_key: 'retry-1' })).structuredContent).toMatchObject({ submitted: true, record_id: 'IIP-0003' });
    expect(world.github.issues).toHaveLength(3);
    // Without a key, the same account sending the same files the same day still gets the first answer, not a second IIP.
    const noKey = await s.submit();
    expect(noKey.structuredContent).toMatchObject({ submitted: true, record_id: 'IIP-0001', replayed: true });
    const otherFiles = await s.submit({ draft: draft.replace('Too little CD47', 'Hardly any CD47') });
    expect(otherFiles.structuredContent).toMatchObject({ submitted: true, record_id: 'IIP-0004' });
    expect(world.github.issues).toHaveLength(4);
    await s.close();
    await bob.close();
  });

  it('stops at the daily limit for the account, in plain words', async () => {
    await setup({ DAILY_LIMIT_PER_ACCOUNT: '1' });
    const s = await connect({ identity: ADA });
    expect((await s.submit()).structuredContent?.submitted).toBe(true);
    const r = await s.submit({ draft: draft + '\nmore' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ submitted: false, reason: 'rate_limited' });
    expect(r.structuredContent?.retry_after_seconds).toBeGreaterThan(0);
    expect(r.text).toMatch(/daily limit/);
    expect(world.github.issues).toHaveLength(1);
    await s.close();
  });

  it('does not promise that nothing was posted when GitHub fails after the request was sent, and points to the public queue', async () => {
    const s = await connect({ identity: ADA });
    world.github.failNext(/issues$/, 500, {});
    const r = await s.submit({ idempotency_key: 'k' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ submitted: false, reason: 'github_unavailable', outcome_unknown: true });
    expect(String(r.structuredContent?.queue_url)).toMatch(/\/issues$/);
    expect(r.text).toMatch(/can.t be sure/i);
    expect(r.text).toMatch(/look at the public queue/i);
    expect(r.text).not.toMatch(/nothing was (posted|made public)/i);
    expect(world.kv.keys().some((k) => k.startsWith('idem:'))).toBe(false);
    const later = await s.submit({ idempotency_key: 'k' });
    expect(later.structuredContent).toMatchObject({ submitted: true });
    await s.close();
  });

  it('says the queue is broken on our side, not "try again in a few minutes", when GitHub refuses our own request', async () => {
    const s = await connect({ identity: ADA });
    world.github.failNext(/access_tokens/, 404, {});
    const r = await s.submit({ idempotency_key: 'k' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ submitted: false, reason: 'queue_broken' });
    expect(r.text).toMatch(/fault on our side, not yours/);
    expect(r.text).toMatch(/keep your draft and your blind review/i);
    expect(r.text).not.toMatch(/few minutes/);
    expect(r.text).not.toMatch(/saved here/); // nothing is saved on our side for this route
    expect(world.github.issues).toHaveLength(0);
    // Nothing was kept, so the same call works once it is put right.
    const later = await s.submit({ idempotency_key: 'k' });
    expect(later.structuredContent).toMatchObject({ submitted: true });
    await s.close();
  });

  it('records the answer as soon as the issue exists, before the checks comment, which may be slow', async () => {
    const s = await connect({ identity: ADA });
    const release = world.github.hold(/comments$/);
    const pending = s.submit({ idempotency_key: 'k-order' });
    await vi.waitFor(() => expect(world.github.issues).toHaveLength(1));
    await vi.waitFor(() => expect(world.kv.keys().some((k) => k.startsWith('idem:'))).toBe(true));
    expect(world.github.newestIssue.comments).toHaveLength(0);
    release();
    const r = await pending;
    expect(r.structuredContent).toMatchObject({ submitted: true });
    expect(world.github.newestIssue.comments).toHaveLength(1);
    await s.close();
  });

  it('hands the posting to the Worker, so it finishes even if the AI app stops waiting', async () => {
    const s = await connect({ identity: ADA });
    const spy = vi.spyOn(world.ctx, 'waitUntil');
    const r = await s.submit({ idempotency_key: 'k-defer' });
    expect(r.structuredContent).toMatchObject({ submitted: true });
    expect(spy).toHaveBeenCalled();
    await world.ctx.flush();
    await s.close();
  });

  it('still says nothing was posted when GitHub fails before anything was sent to open the issue', async () => {
    const s = await connect({ identity: ADA });
    world.github.failNext(/access_tokens/, 500, {});
    const r = await s.submit({ idempotency_key: 'k' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ submitted: false, reason: 'github_unavailable' });
    expect(r.structuredContent?.outcome_unknown).toBeUndefined();
    expect(r.text).toMatch(/nothing was posted/i);
    expect(world.github.issues).toHaveLength(0);
    const later = await s.submit({ idempotency_key: 'k' });
    expect(later.structuredContent).toMatchObject({ submitted: true });
    await s.close();
  });

  it('mentions the account by the name it has now, never the one its sign-in carried, which someone else may own', async () => {
    const s = await connect({ identity: ADA });
    world.github.rename(ADA.id, 'octo-cat-renamed');
    const r = await s.submit();
    expect(r.structuredContent).toMatchObject({ submitted: true, contributor: { github: 'octo-cat-renamed' } });
    expect(world.github.newestIssue.body.startsWith('Submitted by @octo-cat-renamed (verified through GitHub)')).toBe(true);
    expect(world.github.newestIssue.body).not.toContain('@octo-cat ');
    expect(world.logs.some((l) => l.includes('queue.login_changed'))).toBe(true);
    await s.close();
  });

  it('posts nothing for an account GitHub no longer has, and leaves the same files free to post later', async () => {
    const s = await connect({ identity: ADA });
    world.github.rename(ADA.id, null);
    const r = await s.submit();
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ submitted: false, reason: 'github_account_gone' });
    expect(r.text).toMatch(/nothing was posted/);
    expect(world.github.issues).toHaveLength(0);
    world.github.rename(ADA.id, ADA.login);
    expect((await s.submit()).structuredContent).toMatchObject({ submitted: true, record_id: 'IIP-0001' });
    await s.close();
  });

  it.each([
    ['once', 1],
    ['every time', Number.POSITIVE_INFINITY],
  ])('still gives the issue link when KV fails %s to keep the answer after the issue is open', async (_when, times) => {
    const s = await connect({ identity: ADA });
    const url = 'https://github.test/openislet/openislet/issues/1';
    world.kv.failPuts = { match: /./, times };
    const first = await s.submit({ idempotency_key: 'k' });
    expect(first.isError).toBeFalsy();
    expect(first.structuredContent).toMatchObject({ submitted: true, issue: { number: 1, url }, record_id: 'IIP-0001' });
    expect(first.structuredContent?.replayed).toBeUndefined();
    expect(first.text).toContain(url);
    // The retry is answered from the limits, and keeping that answer under the key can fail the same way.
    world.kv.failPuts = { match: /./, times };
    const again = await s.submit({ idempotency_key: 'k' });
    expect(again.isError).toBeFalsy();
    expect(again.structuredContent).toMatchObject({ submitted: true, issue: { number: 1, url }, replayed: true });
    const last = await s.submit({ idempotency_key: 'k' });
    expect(last.structuredContent).toMatchObject({ submitted: true, issue: { number: 1, url }, replayed: true });
    expect(world.github.issues).toHaveLength(1);
    expect(world.kv.keys().some((k) => k.startsWith('idem:'))).toBe(times === 1);
    expect(world.logs.filter((l) => l.includes('queue.idem_unrecorded'))).toHaveLength(times === 1 ? 2 : 3);
    await s.close();
  });

  it('says nothing was posted when GitHub does not answer the name lookup', async () => {
    const s = await connect({ identity: ADA });
    world.github.failNext(/GET .*\/user\/\d+$/, 503, {});
    const r = await s.submit();
    expect(r.structuredContent).toMatchObject({ submitted: false, reason: 'github_unavailable' });
    expect(r.structuredContent?.outcome_unknown).toBeUndefined();
    expect(r.text).toMatch(/nothing was posted/i);
    expect(world.github.issues).toHaveLength(0);
    await s.close();
  });
});

describe('open, and no token: the link to the form', () => {
  it('saves the checked files and returns a link that is not an error', async () => {
    const s = await connect({ ip: '203.0.113.5' });
    const r = await s.submit({ ai_tools: { draft: 'Model A' }, contributor: { name: 'Ada' } });
    expect(r.isError).toBeFalsy();
    const d = r.structuredContent!;
    expect(d).toMatchObject({ submitted: false, reason: 'sign_in_needed' });
    expect(d.form_url).toBe(`https://openislet.org/submit#staged=${d.staged_id}`);
    expect(d.staged_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(Date.parse(d.expires_at) - world.clock.now()).toBe(24 * 3600 * 1000);
    expect(r.text).toContain(d.form_url);
    expect(r.text).toContain('Continue with GitHub & Submit');
    expect(r.text).toContain('your Islet Improvement Proposal (IIP) is then posted as a public issue that names you');
    expect(r.text).not.toMatch(/finding/i);
    expect(r.text).toMatch(/check/i);
    expect(world.github.issues).toHaveLength(0);

    // The form fills itself from the same id.
    const service = serviceFor({ ...defaultConfig, submissionsOpen: true });
    const staged = await service.getStaged(d.staged_id);
    expect(staged).toMatchObject({ ok: true, body: { draft, review, ai_tools: { draft: 'Model A' }, contributor: { name: 'Ada' } } });
    await s.close();
  });

  it('gives the same link for a retry, and does not save the files twice', async () => {
    const s = await connect();
    const a = await s.submit({ idempotency_key: 'retry-1' });
    const b = await s.submit({ idempotency_key: 'retry-1' });
    expect(b.structuredContent?.form_url).toBe(a.structuredContent?.form_url);
    expect(world.kv.keys().filter((k) => k.startsWith('staged:'))).toHaveLength(1);
    const c = await s.submit({ idempotency_key: 'retry-2' });
    expect(c.structuredContent?.form_url).not.toBe(a.structuredContent?.form_url);
    await s.close();
  });

  it('does not hand one caller another caller\'s draft, even with the same key', async () => {
    const mine = await connect();
    const a = await mine.submit({ idempotency_key: 'k1' });
    const theirs = await connect({ ip: '203.0.113.77' });
    const b = await theirs.submit({ idempotency_key: 'k1', draft: draft.replace('Too little CD47', 'A different IIP entirely') });
    expect(b.structuredContent?.staged_id).not.toBe(a.structuredContent?.staged_id);
    await mine.close();
    await theirs.close();
  });

  it('allows ten drafts an hour from one address, then asks the person to wait', async () => {
    const s = await connect({ ip: '203.0.113.5' });
    for (let i = 0; i < 10; i++) expect((await s.submit({ draft: draft + '\n'.repeat(i) })).structuredContent?.reason).toBe('sign_in_needed');
    const r = await s.submit({ draft: draft + '\n'.repeat(11) });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ submitted: false, reason: 'rate_limited' });
    expect(r.text).toMatch(/wait about/);
    const other = await connect({ ip: '203.0.113.6' });
    expect((await other.submit()).structuredContent?.reason).toBe('sign_in_needed');
    await s.close();
    await other.close();
  });

  it('carries wet-lab readouts through the link to the issue', async () => {
    const readouts = { batch_id: 'B-1', obs_cd47_fold: 7.85, obs_cd47_fold_se: 0.35 };
    const s = await connect();
    const r = await s.submit({ wetlab_empirical_readouts: readouts });
    expect(r.structuredContent?.reason).toBe('sign_in_needed');
    expect(r.structuredContent?.would_be_labelled).toContain('wetlab-readout');
    const staged = r.structuredContent!.staged_id as string;

    const service = serviceFor({ ...defaultConfig, submissionsOpen: true });
    const bundle = (await import('./helpers')).bundle();
    const begun = await service.begin(bundle, { staged_id: staged, consent: true, binding_hash: 'a'.repeat(64) });
    expect(begun.ok).toBe(true);
    const state = new URL((begun as { body: { authorize_url: string } }).body.authorize_url).searchParams.get('state')!;
    // The browser's secret hashes to 'a'*64 only in this test, so finish through the service with a matching hash.
    const secret = 'wetlab-secret';
    const again = await service.begin(bundle, { staged_id: staged, consent: true, binding_hash: await (await import('./queue-fakes')).bindingFor(secret) });
    const state2 = new URL((again as { body: { authorize_url: string } }).body.authorize_url).searchParams.get('state')!;
    void state;
    const done = await service.complete({ code: world.github.issueCode(ADA), state: state2, binding: secret });
    expect(done.ok).toBe(true);
    expect(world.github.newestIssue.labels).toContain('wetlab-readout');
    expect(world.github.newestIssue.body).toContain('"obs_cd47_fold": 7.85');
    await s.close();
  });
});

describe('wet-lab readouts are part of what makes two IIPs the same', () => {
  const first = { batch_id: 'B-1', obs_stage7_yield_ratio: 0.9, obs_stage7_yield_se: 0.1 };
  const reordered = { obs_stage7_yield_se: 0.1, obs_stage7_yield_ratio: 0.9, batch_id: 'B-1' };
  // Same prose, a changed yield and a new endpoint.
  const changed = { batch_id: 'B-1', obs_stage7_yield_ratio: 0.7, obs_stage7_yield_se: 0.1, obs_cd47_fold: 7.85, obs_cd47_fold_se: 0.35 };

  it('signed in: the same readouts replay the first issue, and changed readouts open a new one', async () => {
    const s = await connect({ identity: ADA });
    const a = await s.submit({ idempotency_key: 'lab-1', wetlab_empirical_readouts: first });
    expect(a.structuredContent).toMatchObject({ submitted: true, record_id: 'IIP-0001' });
    expect(a.structuredContent?.replayed).toBeUndefined();
    for (const [key, readouts] of [['lab-1', first], ['lab-1', reordered], [undefined, reordered]] as const) {
      const again = await s.submit({ idempotency_key: key, wetlab_empirical_readouts: readouts });
      expect(again.structuredContent).toMatchObject({ submitted: true, record_id: 'IIP-0001', replayed: true });
    }
    expect(world.github.issues).toHaveLength(1);

    // The same key and the same files with new lab values: a new IIP, never the first answer with the new batch dropped.
    const b = await s.submit({ idempotency_key: 'lab-1', wetlab_empirical_readouts: changed });
    expect(b.isError).toBeFalsy();
    expect(b.structuredContent).toMatchObject({ submitted: true, record_id: 'IIP-0002' });
    expect(b.structuredContent?.replayed).toBeUndefined();
    expect(world.github.issues).toHaveLength(2);
    expect(world.github.issues[0].body).toContain('"obs_stage7_yield_ratio": 0.9');
    expect(world.github.issues[0].body).not.toContain('"obs_cd47_fold": 7.85');
    expect(world.github.issues[1].body).toContain('"obs_stage7_yield_ratio": 0.7');
    expect(world.github.issues[1].body).toContain('"obs_cd47_fold": 7.85');
    // Without a key each set of readouts still finds its own issue.
    expect((await s.submit({ wetlab_empirical_readouts: changed })).structuredContent).toMatchObject({ record_id: 'IIP-0002', replayed: true });
    expect((await s.submit({ wetlab_empirical_readouts: first })).structuredContent).toMatchObject({ record_id: 'IIP-0001', replayed: true });
    expect(world.github.issues).toHaveLength(2);
    await s.close();
  });

  it('through the form (/api/begin, /api/complete): the same readouts get the first issue, and changed readouts open a new one', async () => {
    const SITE = 'https://openislet.org';
    const IP = '203.0.113.7';
    const throughForm = async (readouts: Record<string, unknown>) => {
      const s = await connect();
      const link = await s.submit({ wetlab_empirical_readouts: readouts });
      await s.close();
      expect(link.structuredContent?.reason).toBe('sign_in_needed');
      const secret = `browser-secret-${Math.random().toString(36).slice(2)}`;
      const begun = await world.call(req('/api/begin', { json: { staged_id: link.structuredContent!.staged_id, consent: true, binding_hash: await bindingFor(secret) }, origin: SITE, ip: IP }));
      expect(begun.status).toBe(200);
      const state = new URL(((await begun.json()) as { authorize_url: string }).authorize_url).searchParams.get('state')!;
      const done = await world.call(req('/api/complete', { json: { code: world.github.issueCode(ADA), state, binding: secret }, origin: SITE, ip: IP }));
      return { status: done.status, body: (await done.json()) as Record<string, any> }; // eslint-disable-line @typescript-eslint/no-explicit-any
    };

    expect(await throughForm(first)).toMatchObject({ status: 200, body: { submitted: true, record_id: 'IIP-0001' } });
    expect(await throughForm(reordered)).toMatchObject({ status: 200, body: { submitted: true, record_id: 'IIP-0001' } });
    expect(world.github.issues).toHaveLength(1);
    expect(await throughForm(changed)).toMatchObject({ status: 200, body: { submitted: true, record_id: 'IIP-0002' } });
    expect(world.github.issues).toHaveLength(2);
    expect(world.github.newestIssue.body).toContain('"obs_stage7_yield_ratio": 0.7');
    expect(world.github.newestIssue.body).toContain('"obs_cd47_fold": 7.85');
  });
});

describe('the contributor details', () => {
  it('stop the call, naming the field, when an ORCID iD fails its check digit or an X handle is wrong, and save nothing', async () => {
    for (const identity of [undefined, ADA]) {
      const s = await connect({ identity });
      const bad = await s.submit({ contributor: { orcid: '0000-0002-1825-0098' } });
      expect(bad.isError).toBe(true);
      expect(bad.structuredContent).toMatchObject({ submitted: false, reason: 'bad_contributor', field: 'orcid' });
      expect(bad.text).toMatch(/check-digit/);
      const x = await s.submit({ contributor: { x: 'not a handle' } });
      expect(x.structuredContent).toMatchObject({ reason: 'bad_contributor', field: 'x' });
      const long = await s.submit({ contributor: { name: 'n'.repeat(81) } });
      expect(long.structuredContent).toMatchObject({ reason: 'bad_contributor', field: 'name' });
      await s.close();
    }
    expect(world.github.issues).toHaveLength(0);
    expect(world.kv.keys().filter((k) => k.startsWith('staged:'))).toHaveLength(0);
  });
});

describe('what the tool tells the AI', () => {
  it('describes itself without the old claims, and offers the contributor details', async () => {
    const s = await connect();
    const { tools } = await s.client.listTools();
    expect(tools.map((t) => t.name)).not.toContain('submit_finding');
    const tool = tools.find((t) => t.name === 'submit_proposal')!;
    expect(tool.title).toBe('Submit an improvement proposal');
    expect(tool.description).toMatch(/Islet Improvement Proposal \(IIP\)/);
    expect(tool.description).not.toMatch(/finding/i);
    expect(tool.description).toMatch(/Software checks it straight away/);
    expect(tool.description).toMatch(/format, the Idea Graveyard rules, and its quotes against the studies OpenIslet already holds/);
    expect(tool.description).toMatch(/does not look papers up on PubMed|looks the papers up on PubMed/);
    expect(tool.description).toMatch(/weekend review/);
    expect(tool.description).not.toMatch(/software and AI|checked by software and AI/i);
    expect(tool.description).not.toMatch(/ORCID/);
    expect(tool.description).toMatch(/link to the web form/);
    expect(JSON.stringify(tool.inputSchema)).toContain('contributor');
    const instructions = s.client.getInstructions() ?? '';
    // The name for what a contributor submits is defined once, near the start, and used from then on.
    expect(instructions).toMatch(/A contribution is an Islet Improvement Proposal \(IIP\): an idea to improve the blueprint or its roadmap, written up in a standard draft and checked by a blind review/);
    expect(instructions.indexOf('Islet Improvement Proposal (IIP)')).toBeLessThan(instructions.indexOf('submit_proposal'));
    expect(instructions).toContain('submit_proposal');
    expect(instructions).not.toMatch(/finding/i);
    expect(instructions).toMatch(/Software checks a submission straight away/);
    expect(instructions).toMatch(/link to the web form/);
    expect(instructions).not.toMatch(/software and AI|ORCID/i);
    await s.close();
  });
});
