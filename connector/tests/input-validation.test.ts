import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { checkExact, evaluateRules, NAMED_DESIGNS } from '../src/core/graveyard';
import { normalizeWetlabReadouts } from '../src/core/wetlab-readouts';
import { runChecks, submitProposal } from '../src/core/draft';
import { defaultConfig } from '../src/core/answer';
import { bundle, connect } from './helpers';
import { makeDraft, makeReview } from './fixtures';
import { applyQuoteCeiling, type FullFinding } from '../src/core/studies';

let session: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => { session = await connect(); });
afterAll(async () => { await session.close(); });
const risky = 'CYTO_STAT1_OR_TYK2_CLONAL_KO_WITH_GAS_IND_PDL1';
const replacement = 'CYTO_CXCL10_SWAP_PDL1_SERPINB9';

describe('Unambiguous Graveyard inputs', () => {
  it.each([[risky, replacement], [replacement, risky]])('rejects two same-axis overrides of a named design: %s then %s', async (first, second) => {
    const r = await session.call('check_against_graveyard', { design: 'A', modules: [first, second] });
    expect(r.isError).toBe(true);
    expect(r.structuredContent?.verdict).toBeUndefined();
    expect(r.text).toMatch(/same part/);
  });
  it('retains an individual overriding module and its blocking rule', async () => {
    const r = await session.call('check_against_graveyard', { design: 'A', modules: [risky] });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent?.verdict).toBe('dead_end');
    expect(r.structuredContent?.triggered.some((t: { graveyard_id: string }) => t.graveyard_id.startsWith('GRAVEYARD_001'))).toBe(true);
  });
  it('treats repeated aliases of the same module as one unambiguous choice', async () => {
    const a = await checkExact(bundle(), { design: 'A', modules: [risky] });
    const b = await checkExact(bundle(), { design: 'A', modules: [risky, risky.toLowerCase().replaceAll('_', '-')] });
    expect(b).toEqual(a);
  });
  it.each([Number.MAX_SAFE_INTEGER + 1, 1e100, NaN, Infinity, -1, 0.1])('rejects invalid direct base-edit count %s', async n => {
    const b = bundle();
    const [entries, modules] = await Promise.all([b.entries(), b.modules()]);
    expect(() => evaluateRules(NAMED_DESIGNS.A, n, entries, modules.modules)).toThrow(/integer/);
    expect((await checkExact(b, { design: 'A', base_edits: n })).ok).toBe(false);
  });
  it.each([null, [], true, { design: 'A', modules: 'CYTO_NONE' }, { design: 'A', modules: [null] }, { design: 'bogus' }])('rejects a malformed direct design input without crashing: %j', async input => {
    expect((await checkExact(bundle(), input as never)).ok).toBe(false);
  });
});

describe('Complete submission safety boundary', () => {
  const secret = 'sk-synthetic123456789012345678901234567890';
  it.each(['ai_draft', 'ai_review', 'written_against', 'batch_id', 'assay_id', 'idempotency_key'])('checks keys in auxiliary submitted field %s', async field => {
    const input = { draft: makeDraft(), review: makeReview(), consent: true, ...(field.startsWith('ai_')
      ? { ai_tools: { [field.slice(3)]: secret } }
      : ['written_against', 'idempotency_key'].includes(field) ? { [field]: secret }
      : { wetlab_empirical_readouts: { [field]: secret, obs_stage7_yield_ratio: 0.9, obs_stage7_yield_se: 0.1 } }) };
    const r = await runChecks(bundle(), defaultConfig, input);
    expect(r.door.find(d => d.id === 'no_secrets')?.status).toBe('fail');
    expect(r.ready).toBe(false);
    const sent = await submitProposal(bundle(), { ...defaultConfig, submissionsOpen: true }, input);
    expect(sent.data).toMatchObject({ submitted: false, reason: 'basic_rules' });
  });
  it('retains a complete ordinary template with auxiliary model labels', async () => {
    const r = await runChecks(bundle(), defaultConfig, { draft: makeDraft(), review: makeReview(), consent: true,
      ai_tools: { draft: 'Synthetic model (Max Effort)', review: 'Synthetic reviewer (Max Effort)' },
      wetlab_empirical_readouts: { batch_id: 'clone1-batch1', assay_id: 'assay1', obs_stage7_yield_ratio: 0.9, obs_stage7_yield_se: 0.1 } });
    expect(r.ready).toBe(true);
  });
  it.each([null, [], true, 1, 'not a record'])('rejects malformed direct readout record %j without throwing', input => {
    const r = normalizeWetlabReadouts(input as never);
    expect(r.payload).toBeNull();
    expect(r.errors.length).toBeGreaterThan(0);
  });
});

describe('Per-paper public quote ceiling', () => {
  const finding = (quote: string) => ({ quote, quote_withheld: false }) as FullFinding;
  it.each([Infinity, NaN, -1, 1.5])('fails closed for malformed ceiling %s', ceiling => {
    expect(applyQuoteCeiling([finding('public quote')], ceiling)[0].quote).toBeNull();
  });
  it('cannot raise the 240-character project ceiling through bundle metadata', () => {
    expect(applyQuoteCeiling([finding('x'.repeat(241))], 1000)[0].quote).toBeNull();
  });
  it('retains a bounded aggregate and any stricter ceiling', () => {
    expect(applyQuoteCeiling([finding('x'.repeat(120)), finding('y'.repeat(120))], 240).every(f => f.quote !== null)).toBe(true);
    const strict = applyQuoteCeiling([finding('x'.repeat(120)), finding('y'.repeat(120))], 239);
    expect(strict[0].quote).not.toBeNull(); expect(strict[1].quote).toBeNull();
  });
});
