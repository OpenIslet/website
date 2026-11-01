// What the review of /mcp and the reading tools found (30 October 2026), each with the fix that now holds it.
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { defaultConfig } from '../src/core/answer';
import { Bundle } from '../src/core/bundle';
import { MAX_SINCE_RECORD, submissionStatus } from '../src/core/contributions';
import { MemoryStore } from '../src/core/store';
import { md } from '../src/core/answer';
import { MAX_PAPERS_LISTED, pmidsIn } from '../src/core/draft';
import { searchStudies } from '../src/core/search';
import { CALLS_AT_ONCE, inTurn } from '../src/server';
import { makeDraft, makeReview } from './fixtures';
import { bundleId, connect, store } from './helpers';

vi.mock('agents/mcp', async () => import('agents/mcp/server'));
import worker, { type Env } from '../src/worker';

const bundle = new Bundle(store, bundleId);

describe('/mcp', () => {
  const env = { BUNDLE: { get: async () => null } } as unknown as Env;
  const post = (body: string) =>
    worker.fetch(
      new Request('http://localhost:8787/mcp', { method: 'POST', headers: { Host: 'localhost:8787', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body }),
      env,
      {} as ExecutionContext,
    );
  const initialize = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'review-test', version: '1.0.0' } } };

  it('refuses a batch of messages before running any of them, even after leading blank space', async () => {
    for (const body of [JSON.stringify([initialize, initialize]), `\n  \t${JSON.stringify([initialize])}`]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Send one message per request: batches are not accepted.' } });
    }
  });

  it('still answers a single message', async () => {
    for (const body of [JSON.stringify(initialize), `${' '.repeat(900)}${JSON.stringify(initialize)}`]) {
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('openislet');
    }
  });

  it('refuses a batch hidden behind a byte-order mark or a long run of blank space, however the body is split', async () => {
    const enc = new TextEncoder();
    const batch = enc.encode(JSON.stringify([initialize, initialize]));
    const postChunks = (chunks: Uint8Array[]) => {
      const body = new ReadableStream<Uint8Array>({ start(c) { for (const chunk of chunks) c.enqueue(chunk); c.close(); } });
      return worker.fetch(
        new Request('http://localhost:8787/mcp', { method: 'POST', headers: { Host: 'localhost:8787', 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body, duplex: 'half' } as RequestInit),
        env,
        {} as ExecutionContext,
      );
    };
    const spaces = enc.encode(' '.repeat(600));
    const cases: [Uint8Array[], RegExp][] = [
      [[spaces, spaces, batch], /too much blank space/], // what got past before: 1,200 spaces in two parts, then a batch
      [[enc.encode(' '.repeat(2000)), batch], /too much blank space/],
      [[new Uint8Array([0xef, 0xbb, 0xbf]), batch], /batches are not accepted/],
      [[new Uint8Array([0xef]), new Uint8Array([0xbb, 0xbf]), enc.encode('\n'), batch], /batches are not accepted/],
    ];
    for (const [chunks, message] of cases) {
      const res = await postChunks(chunks);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(message);
    }
  });

  it('lets at most a few tool calls work at once in one instance, and finishes them all', async () => {
    let now = 0;
    let most = 0;
    const calls = Array.from({ length: 10 }, (_, i) =>
      inTurn(async () => {
        most = Math.max(most, ++now);
        await new Promise((r) => setTimeout(r, 30));
        now--;
        return i;
      }),
    );
    expect(await Promise.all(calls)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(most).toBe(CALLS_AT_ONCE);
  });

  it('frees a place when a call fails, so the ones waiting still run', async () => {
    const failing = Array.from({ length: CALLS_AT_ONCE }, () => inTurn(async () => Promise.reject(new Error('no'))));
    const after = inTurn(async () => 'ran');
    await Promise.allSettled(failing);
    expect(await after).toBe('ran');
  });
});

describe('the reading tools', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    s = await connect();
  });
  afterAll(async () => {
    await s.close();
  });

  it('reads PubMed IDs in linear time, so a draft of blank space cannot tie the server up', () => {
    const started = performance.now();
    expect(pmidsIn(`PMID${' '.repeat(60_000)}x`)).toEqual([]);
    expect(pmidsIn(`PubMed${' '.repeat(60_000)}x`)).toEqual([]);
    expect(performance.now() - started).toBeLessThan(250);
    expect(pmidsIn('PMID: 12345678, PMID 23456789, PMID#34567890, PubMed ID: 45678901, pubmed.ncbi.nlm.nih.gov/56789012').sort()).toEqual(
      ['12345678', '23456789', '34567890', '45678901', '56789012'],
    );
  });

  it('lists at most a hundred papers for one draft and review', async () => {
    const many = Array.from({ length: 300 }, (_, i) => `PMID ${10000000 + i}`).join('\n');
    const r = await s.call('check_draft', { draft: `${makeDraft()}\n${many}`, review: makeReview() });
    expect(r.structuredContent?.papers.length).toBe(MAX_PAPERS_LISTED);
  });

  it('finds findings whose ids do not start with their PubMed ID', async () => {
    const odd = (await bundle.findings()).filter((f) => !/^pmid\d+_/.test(f.id));
    expect(odd.length).toBeGreaterThan(0);
    for (const f of odd.slice(0, 5)) {
      const word = (f.factor ?? '').split(/[^A-Za-z0-9-]+/).filter((w) => w.length > 6).sort((a, b) => b.length - a.length)[0];
      if (!word) continue;
      const r = await searchStudies(bundle, { query: word, source_scope: 'all', limit: 25 });
      const pages = [r];
      for (let offset = r.limit; offset < r.total; offset += r.limit) pages.push(await searchStudies(bundle, { query: word, source_scope: 'all', limit: 25, offset }));
      expect(pages.flatMap((p) => p.items.map((i) => i.pmid)), `${f.id} by "${word}"`).toContain(f.pmid);
    }
  });

  it('counts every match, so paging through reaches the number it reports', async () => {
    const first = await searchStudies(bundle, { query: 'beta', limit: 25 });
    const seen = new Set(first.items.map((i) => i.pmid));
    for (let offset = first.limit; offset < first.total; offset += first.limit) for (const i of (await searchStudies(bundle, { query: 'beta', limit: 25, offset })).items) seen.add(i.pmid);
    expect(first.total).toBeGreaterThan(300); // it stopped at 231 when only the first 600 hits were counted
    expect(seen.size).toBe(first.total);
  });

  it('says plainly when a page is past the end', async () => {
    const r = await s.call('search_studies', { query: 'macrophage', offset: 5000 });
    expect(r.structuredContent?.summary).toMatch(/but there are none after number 5,000\. Ask for an earlier page\./);
  });

  it('keeps a claim exactly as written in the reviewer prompt, $ signs and all', async () => {
    const claim = 'Costs $& and $$5 and $` stay as typed';
    const p = await s.client.getPrompt({ name: 'blind_review', arguments: { claim } });
    expect((p.messages[0].content as { text: string }).text).toContain(claim);
  });

  it('refuses a wet-lab value longer than a number needs', async () => {
    const r = await s.call('check_draft', { draft: makeDraft(), review: makeReview(), wetlab_empirical_readouts: { obs_stage7_yield_ratio: '1'.repeat(41) } });
    expect(r.isError).toBe(true);
  });

  it('keeps every heading on one line', () => {
    expect(md.h(1, 'IIP-0042 · A title\n# with its own heading')).toBe('# IIP-0042 · A title # with its own heading\n');
  });

  it('says the queue has not opened only while the founding blueprint is the whole record', async () => {
    const founding = (await bundle.ledger()).records[0];
    const later = { ...founding, issue: { ...founding.issue, number: 2 }, id: 'IIP-0002' };
    const withTwo = { ledger: async () => ({ records: [founding, later] }) } as unknown as Bundle;
    const closed = { ...defaultConfig, submissionsOpen: false };
    expect((await submissionStatus(bundle, closed, '7')).summary).toMatch(/has not opened/);
    expect((await submissionStatus(withTwo, closed, '7')).summary).toMatch(/IIP-0007 is not in OpenIslet's record yet/);
  });

  it('says plainly that there is no such IIP for a number far past any given out', async () => {
    const open = { ...defaultConfig, submissionsOpen: true };
    const newest = Math.max(...(await bundle.ledger()).records.map((r) => r.issue.number));
    expect((await submissionStatus(bundle, open, String(newest + 1))).summary).toMatch(/not in OpenIslet's record yet/);
    expect((await submissionStatus(bundle, open, String(newest + MAX_SINCE_RECORD))).summary).toMatch(/not in OpenIslet's record yet/);
    const far = await submissionStatus(bundle, open, String(newest + MAX_SINCE_RECORD + 1));
    expect(far.summary).toMatch(/^There is no IIP-\d+: numbers that high have not been given out\. The newest IIP in OpenIslet's record is IIP-\d{4}\.$/);
    expect(far.data).toMatchObject({ found: false });
  });

  it('keeps every tool to the per-paper ceiling of exact wording, whatever the bundle holds', async () => {
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    const quote = (n: number, c: string) => c.repeat(n);
    const findings = [
      { id: 'a1', pmid: '111', quote: quote(150, 'a'), quote_sha256: null },
      { id: 'a2', pmid: '111', quote: quote(100, 'b'), quote_sha256: null },
      { id: 'a3', pmid: '111', quote: quote(80, 'c'), quote_sha256: null },
      { id: 'b1', pmid: '222', quote: quote(240, 'd'), quote_sha256: null },
      { id: 'b2', pmid: '222', quote: null, quote_sha256: sha('withheld') },
    ];
    const id = 'ceiling-test';
    const payloads: Record<string, string> = { 'findings.jsonl': findings.map((f) => JSON.stringify(f)).join('\n') };
    const pins = Object.entries(payloads).map(([path, text]) => ({ path, bytes: Buffer.byteLength(text), sha256: sha(text) }));
    const meta = { schema: 'openislet-bundle/1', id, name: 'Test', family: 'Islet-1', frozen: false, doi: null, blueprint_release: '0.8.0', files: pins,
      fingerprint: sha(pins.map((f) => `${f.path}\t${f.sha256}`).join('\n')), quote_policy: { per_paper_verbatim_ceiling_characters: 240 } };
    const files: Record<string, string> = { [`${id}/meta.json`]: JSON.stringify(meta) };
    for (const [path, text] of Object.entries(payloads)) files[`${id}/${path}`] = text;
    const got = new Map((await new Bundle(new MemoryStore(files), id).findings()).map((f) => [f.id, f]));
    expect(got.get('a1')?.quote).toBe(quote(150, 'a'));
    expect(got.get('a2')).toMatchObject({ quote: null, quote_sha256: sha(quote(100, 'b')) }); // past the ceiling: withheld, still checkable
    expect(got.get('a3')?.quote).toBe(quote(80, 'c')); // 150 + 80 fits
    expect(got.get('b1')?.quote).toBe(quote(240, 'd'));
    expect(got.get('b2')).toMatchObject({ quote: null, quote_sha256: sha('withheld') });
    const real = new Map<string, number>();
    for (const f of await bundle.findings()) if (f.quote) real.set(f.pmid, (real.get(f.pmid) ?? 0) + f.quote.length);
    expect(Math.max(...real.values())).toBeLessThanOrEqual(240);
  });
});
