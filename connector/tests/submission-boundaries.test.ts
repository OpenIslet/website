import { afterEach, describe, expect, it, vi } from 'vitest';
import { bindingFor, installWorld, makeWorld, req, restore } from './queue-fakes';
import { makeDraft, makeReview, shownQuote } from './fixtures';

vi.mock('agents/mcp', async () => import('agents/mcp/server'));
afterEach(restore);

const quote = shownQuote();
const draft = makeDraft({ evidence: [`${quote.cite}, PMID ${quote.pmid}, "${quote.quote}"`] });
const review = makeReview();

// No real external services: every request goes through the Worker and in-memory GitHub/KV adapters.
describe('OAuth submission content binding', () => {
  it.each(['draft', 'review', 'contributor', 'ai_tools'] as const)('preserves approved content when another flow changes %s', async field => {
    const world = await makeWorld();
    installWorld(world);
    const post = async (path: string, json: unknown) => {
      const response = await world.call(req(path, { json, origin: 'https://openislet.org', ip: '203.0.113.11' }));
      return { status: response.status, body: await response.json() as Record<string, any> };
    };
    const original = await post('/api/begin', { draft, review, consent: true, binding_hash: await bindingFor('first-browser') });
    expect(original.status).toBe(200);
    const state = new URL(original.body.authorize_url).searchParams.get('state')!;
    const changes = {
      draft: { draft: draft + '\n\nChanged by another flow.' },
      review: { review: review + '\n\nChanged by another flow.' },
      contributor: { contributor: { name: 'Changed by another flow' } },
      ai_tools: { ai_tools: { draft: 'Changed by another flow' } },
    };
    const changed = await post('/api/begin', {
      staged_id: original.body.staged_id, consent: true, binding_hash: await bindingFor('second-browser'), ...changes[field],
    });
    expect(changed.status).toBe(200);
    expect(changed.body.staged_id).not.toBe(original.body.staged_id);
    const saved = await world.call(req(`/api/staged/${original.body.staged_id}`, { origin: 'https://openislet.org' }));
    expect(await saved.json()).toMatchObject({ draft, review, contributor: {} });
    const first = await post('/api/complete', { state, binding: 'first-browser', code: world.github.issueCode({ id: 10, login: 'first-signer' }) });
    expect(first.status).toBe(200);
    expect(world.github.newestIssue.body).not.toContain('Changed by another flow');
    const second = await post('/api/complete', {
      state: new URL(changed.body.authorize_url).searchParams.get('state'), binding: 'second-browser', code: world.github.issueCode({ id: 20, login: 'second-signer' }),
    });
    expect(second.status).toBe(200);
    expect(second.body.issue.number).not.toBe(first.body.issue.number);
    expect(world.github.newestIssue.body).toContain('Changed by another flow');
    expect(world.github.newestIssue.body).toContain('@second-signer');
  });
});

describe('Public metadata uses the same secret boundary', () => {
  const fakeSecret = 'ghp_' + 'a'.repeat(36);
  it.each(['idempotency_key', 'contributor'] as const)('rejects a credential-shaped value in %s before staging', async field => {
    const world = await makeWorld();
    installWorld(world);
    const response = await world.call(req('/api/stage', {
      origin: 'https://openislet.org', ip: '203.0.113.12',
      json: { draft, review, consent: true, [field]: field === 'contributor' ? { name: fakeSecret } : fakeSecret },
    }));
    expect(response.status).toBe(422);
    expect(world.kv.keys().filter(k => k.startsWith('staged:'))).toEqual([]);
    expect(world.github.issues).toHaveLength(0);
  });
});

describe('Sign-in pins attachments and provenance', () => {
  it.each(['wetlab', 'written_against', 'report'] as const)('refuses modified %s before using the sign-in code', async field => {
    const world = await makeWorld();
    installWorld(world);
    const begun = await world.call(req('/api/begin', {
      origin: 'https://openislet.org', ip: '203.0.113.13',
      json: { draft, review, consent: true, binding_hash: await bindingFor('bound-browser') },
    }));
    const b = await begun.json() as Record<string, string>;
    const key = world.kv.keys().find(k => k.startsWith('staged:'))!;
    const entry = world.kv.data.get(key)!;
    const content = JSON.parse(entry.value);
    if (field === 'wetlab') content.wetlab = { batch_id: 'different-attachment', GSIS_SI: 99 };
    if (field === 'written_against') content.written_against = 'changed source release';
    if (field === 'report') content.report.labels = ['changed-report'];
    entry.value = JSON.stringify(content);
    const response = await world.call(req('/api/complete', {
      origin: 'https://openislet.org',
      json: { state: new URL(b.authorize_url).searchParams.get('state'), binding: 'bound-browser', code: world.github.issueCode({ id: 12, login: 'signer' }) },
    }));
    expect(response.status).toBe(400);
    expect(world.github.requests).toHaveLength(0);
    expect(world.github.issues).toHaveLength(0);
  });
});

describe('Browser API response shapes', () => {
  it.each(['null', 'false', '[]', '"text"', '{'])('fails safely for a non-object response %s', async body => {
    const { callApi, explain } = await import('../../src/scripts/submit');
    vi.stubGlobal('fetch', async () => new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }));
    const result = await callApi('https://local.invalid', '/api/check', {});
    expect(result.ok).toBe(false);
    expect(() => explain(result)).not.toThrow();
    expect(result.data).toEqual({ error: 'bad_response' });
  });
});

describe('Valid browser responses remain usable', () => {
  it.each([
    [200, { ready: true, summary: 'Ready' }],
    [422, { error: 'basic_rules', what_to_fix: ['Correct the draft'], message: 'Try again with corrected files' }],
    [503, { error: 'queue_not_open', retry_after_seconds: 60, message: 'Keep your files and retry' }],
  ] as const)('preserves the response body and status %s for retry/back handling', async (status, body) => {
    const { callApi, explain } = await import('../../src/scripts/submit');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status }));
    const result = await callApi('https://local.invalid', '/api/check', {});
    expect(result).toEqual({ ok: status === 200, status, data: body });
    if (status !== 200) expect(explain(result)).toBe(body.message);
  });
});

describe('Completion response nested types', () => {
  it.each([
    null, [], { url: { toString: null } }, { url: ['https://github.com/owner/repo/issues/7'] },
    { url: 'https://github.com/owner/repo/issues/7', number: { toString: null } },
    { url: 'https://github.com/owner/repo/issues/7', number: 1.5 },
  ])('rejects malformed success issue metadata %j', async issue => {
    const { callApi, explain } = await import('../../src/scripts/submit');
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ submitted: true, issue }), { status: 200 }));
    const result = await callApi('https://local.invalid', '/api/complete', {});
    expect(result).toEqual({ ok: false, status: 200, data: { error: 'bad_response' } });
    expect(() => explain(result)).not.toThrow();
  });

  it('preserves valid completion fields without coercion', async () => {
    const { callApi } = await import('../../src/scripts/submit');
    const body = { submitted: true, issue: { url: 'https://github.com/owner/repo/issues/7', number: 7 }, record_id: 'record-7' };
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify(body), { status: 200 }));
    expect(await callApi('https://local.invalid', '/api/complete', {})).toEqual({ ok: true, status: 200, data: body });
  });
});
