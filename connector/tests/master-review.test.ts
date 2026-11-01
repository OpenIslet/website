import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, bundle } from './helpers';
import { makeDraft, makeReview, shownQuote } from './fixtures';
import { checkExact, NAMED_DESIGNS } from '../src/core/graveyard';
import { runChecks } from '../src/core/draft';
import { defaultConfig } from '../src/core/answer';

let session: Awaited<ReturnType<typeof connect>>;
beforeAll(async () => { session = await connect(); });
afterAll(async () => { await session.close(); });

describe('independent master review regressions', () => {
  it('rejects inherited prototype paths as atlas items', async () => {
    for (const item of ['constructor', '__proto__', 'summary.toString']) {
      const r = await session.call('get_layer_atlas', { layer: 'dna', item });
      expect(r.isError, item).toBe(true);
      expect(r.text, item).toContain('no item');
    }
  });
  it('does not certify a quote containing an added fabricated sentence', async () => {
    const f = shownQuote();
    const quote = `${f.quote} The treatment was guaranteed to cure all patients.`;
    const r = await session.call('check_draft', {
      draft: makeDraft({ evidence: [`PMID ${f.pmid}, "${quote}"`] }), review: makeReview(), consent: true,
    });
    expect(r.structuredContent?.quotes.matched).toBe(0);
    expect(r.structuredContent?.checks.find((c: {id: string}) => c.id === 'quotes').status).toBe('amber');
  });
  it('rejects prefix lookalikes of supported review verdicts', async () => {
    const r = await session.call('check_draft', { draft: makeDraft(), review: makeReview({ verdict: 'Supportedness is not a verdict' }), consent: true });
    expect(r.structuredContent?.ready).toBe(false);
  });
  it('cannot understate the edit budget inherent in selected modules', async () => {
    const r = await checkExact(bundle(), { modules: Object.values(NAMED_DESIGNS.B), base_edits: 0 });
    expect(r.ok).toBe(false);
  });
  it('has material open questions for Design X', async () => {
    const r = await session.call('get_open_questions', { design: 'X' });
    expect(r.structuredContent?.shown).toBeGreaterThan(0);
  });
  it('uses the cited PMID when identical source wording appears in more than one paper', async () => {
    const b = bundle();
    const original = shownQuote();
    b.findings = async () => [original, { ...original, id: 'duplicate', pmid: '99999999' }];
    const r = await runChecks(b, defaultConfig, {draft: makeDraft({evidence: [`PMID 99999999, "${original.quote}"`]}), review: makeReview(), consent: true});
    expect(r.quotes).toMatchObject({matched: 1, wrong_paper: 0});
  });
  it('exposes X identity without claiming molecular qualification', async () => {
    const r = await session.call('get_blueprint_overview', {design: 'X'});
    expect(r.structuredContent).toMatchObject({design: 'X', promotion_authorized: false, evaluation_scope: 'COMBINATORIAL_GRID_ONLY'});
    expect(r.structuredContent?.molecular_hypothesis).toMatchObject({execution_supported: false, exact_donor_length_bp: null});
  });
});
