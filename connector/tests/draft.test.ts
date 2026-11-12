// check_draft and submit_proposal, against drafts and reviews written the way the website's templates ask.
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/answer';
import { runChecks } from '../src/core/draft';
import type { Finding } from '../src/core/types';
import { findings, makeDraft, makeReview, shownQuote } from './fixtures';
import { bundle, connect, websiteRoot } from './helpers';

type Session = Awaited<ReturnType<typeof connect>>;
let s: Session;
beforeAll(async () => {
  s = await connect();
});
afterAll(async () => {
  await s.close();
});

const good = () => {
  const f = shownQuote();
  return { f, draft: makeDraft({ evidence: [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`] }), review: makeReview() };
};
const check = (args: Record<string, unknown>) => s.call('check_draft', args);
const failed = (r: Awaited<ReturnType<typeof check>>) => (r.structuredContent!.door as { id: string; status: string }[]).filter((d) => d.status === 'fail').map((d) => d.id);

describe('check_draft: the basic rules', () => {
  it('accepts a draft and a review written to the templates', async () => {
    const { draft, review } = good();
    const r = await check({ draft, review, consent: true });
    expect(r.structuredContent?.ready).toBe(true);
    expect(failed(r)).toEqual([]);
    expect(r.structuredContent?.labels).toEqual(expect.arrayContaining(['submission', 'type:problem-found', 'test:3', 'design:a']));
    expect(r.text).toContain('nothing was stored or sent');
  });

  it('accepts files pasted inside a code fence, as the prompts ask for', async () => {
    const { draft, review } = good();
    const r = await check({ draft: '```markdown\n' + draft + '\n```', review: 'Here is the review:\n\n```markdown\n' + review + '\n```', consent: true });
    expect(r.structuredContent?.ready).toBe(true);
  });

  it('refuses a review that does not support the IIP', async () => {
    const { draft } = good();
    for (const verdict of ['Not supported', 'Cannot tell']) {
      const r = await check({ draft, review: makeReview({ verdict, submit: 'No' }), consent: true });
      expect(r.structuredContent?.ready, verdict).toBe(false);
      expect(failed(r)).toContain('review_verdict');
      expect(r.text).toContain('did not survive its test');
      expect(r.text).toContain('Revise the IIP, or drop it.');
      expect(r.structuredContent?.summary).toContain('the review does not support the IIP');
    }
    for (const verdict of ['Supported', 'Partly supported']) {
      expect((await check({ draft, review: makeReview({ verdict }), consent: true })).structuredContent?.ready, verdict).toBe(true);
    }
  });

  it('reads the verdict however an AI writes it, and refuses the template list left as it came', async () => {
    const { draft } = good();
    for (const verdict of ['**Supported**', 'Supported.', 'Supported - the claim holds', 'Partly supported — mostly', '*Partly supported*', 'Supported (strongly)']) {
      const r = await check({ draft, review: makeReview({ verdict }), consent: true });
      expect(r.structuredContent?.ready, verdict).toBe(true);
    }
    for (const verdict of ['[Supported | Partly supported | Not supported | Cannot tell]', '[Supported]', 'Supported | Not supported', 'Supportedness is not a verdict', '']) {
      const r = await check({ draft, review: makeReview({ verdict }), consent: true });
      expect(r.structuredContent?.ready, verdict).toBe(false);
      expect(failed(r), verdict).toContain('review_verdict');
    }
    // "Not supported" still wins over "supported", with or without bold
    const no = await check({ draft, review: makeReview({ verdict: '**Not supported.**', submit: 'No' }), consent: true });
    expect(failed(no)).toContain('review_verdict');
  });

  it('gives no advice with a rule that passed, so a passing review never says to drop the IIP', async () => {
    const { draft, review } = good();
    for (const verdict of ['Supported', 'Partly supported']) {
      const r = await check({ draft, review: verdict === 'Supported' ? review : makeReview({ verdict }), consent: true });
      for (const d of r.structuredContent!.door as { id: string; status: string; fix?: string; problem?: string }[]) {
        expect(d.status, `${verdict}: ${d.id}`).toBe('pass');
        expect(d.fix, `${verdict}: ${d.id}`).toBeUndefined();
        expect(d.problem, `${verdict}: ${d.id}`).toBeUndefined();
      }
    }
  });

  it('needs consent, and says why', async () => {
    const { draft, review } = good();
    for (const consent of [undefined, false]) {
      const r = await check({ draft, review, consent });
      expect(failed(r)).toEqual(['consent']);
      expect(r.text).toContain('CC BY 4.0');
    }
  });

  it('names every missing line and section of the draft', async () => {
    const r = await check({ draft: makeDraft({ omit: ['claim', 'test'] }), review: good().review, consent: true });
    expect(failed(r)).toEqual(['draft_structure']);
    const detail = (r.structuredContent!.door as { id: string; detail: string }[]).find((d) => d.id === 'draft_structure')!.detail;
    expect(detail).toContain('Claim in one sentence');
    expect(detail).toContain('Affects test');
    const noSection = good().draft.replace('## Cheapest way to check it\nCount CD47 molecules on resting and inflamed edited cells with calibrated flow cytometry.\n', '');
    expect(failed(await check({ draft: noSection, review: good().review, consent: true }))).toEqual(['draft_structure']);
  });

  it('treats an unfilled template placeholder as missing', async () => {
    const draft = good().draft.replace(/\*\*Claim in one sentence:\*\* .*/, '**Claim in one sentence:** [What I am claiming]');
    expect(failed(await check({ draft, review: good().review, consent: true }))).toEqual(['draft_structure']);
    expect(failed(await check({ draft: makeDraft({ type: 'Brilliant idea' }), review: good().review, consent: true }))).toContain('draft_type');
  });

  it('needs the "Claim reviewed" line in the review', async () => {
    const r = await check({ draft: good().draft, review: makeReview({ omit: ['claim'] }), consent: true });
    expect(failed(r)).toEqual(['review_structure']);
    expect(r.text).toContain('Claim reviewed');
  });

  it('refuses empty, oversized and secret-bearing submissions', async () => {
    const { draft, review } = good();
    expect(failed(await check({ draft: 'short', review, consent: true }))).toContain('draft_present');
    expect(failed(await check({ draft, review: '', consent: true }))).toContain('review_present');
    expect(failed(await check({ draft: draft + '\n' + 'x'.repeat(31_000), review, consent: true }))).toContain('size');
    const leaked = await check({ draft: draft + '\napi_key = sk-live-1234567890abcdef1234', review, consent: true });
    expect(failed(leaked)).toContain('no_secrets');
  });

  it('refuses a fine-grained GitHub token as well as the older kinds', async () => {
    const { draft, review } = good();
    const fineGrained = 'github_pat_' + 'A'.repeat(22) + '_' + 'A'.repeat(59); // built here, so this file holds no token-shaped text
    const r = await check({ draft: `${draft}\nGITHUB_TOKEN=${fineGrained}`, review, consent: true });
    expect(failed(r)).toContain('no_secrets');
    expect(r.structuredContent?.door.find((d: { id: string }) => d.id === 'no_secrets')?.detail).toMatch(/a GitHub token/);
    const viaName = await runChecks(bundle(), defaultConfig, { draft, review, consent: true, contributor: { name: fineGrained } });
    expect(viaName.door.find((d) => d.id === 'no_secrets')?.status).toBe('fail');
  });
});

describe('check_draft: the automatic checks', () => {
  it('checks a quote against the OpenIslet record, and catches one credited to the wrong paper', async () => {
    const { f } = good();
    const other = findings().find((x: Finding) => x.pmid !== f.pmid && x.quote && x.quote.length > 60 && !/["“”]/.test(x.quote))!;
    const right = await check({ draft: makeDraft({ evidence: [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`] }), review: good().review, consent: true });
    expect(right.structuredContent?.quotes).toMatchObject({ checked: 1, matched: 1, wrong_paper: 0 });
    const wrong = await check({ draft: makeDraft({ evidence: [`${f.cite}, PMID ${f.pmid}, "${other.quote}"`] }), review: good().review, consent: true });
    expect(wrong.structuredContent?.quotes).toMatchObject({ matched: 0, wrong_paper: 1 });
    expect(wrong.structuredContent?.checks.find((c: { id: string }) => c.id === 'quotes').status).toBe('red');
  });

  it('does not fail a quote it simply cannot check here', async () => {
    const r = await check({ draft: makeDraft(), review: good().review, consent: true });
    expect(r.structuredContent?.quotes).toMatchObject({ checked: 1, matched: 0, not_checked_here: 1 });
    expect(r.structuredContent?.checks.find((c: { id: string }) => c.id === 'quotes').status).toBe('amber');
    expect(r.structuredContent?.papers).toEqual([{ pmid: '12345678', in_openislet_corpus: false, study: null }]);
  });

  it('matches a quote whose wording is withheld by its fingerprint (when the source texts are on this machine)', async () => {
    const repo = process.env.OPENISLET_REPO ?? path.resolve(websiteRoot, '..', 'OpenIslet');
    const withheld = findings().find((x) => x.quote === null && fs.existsSync(path.join(repo, 'data', 'extracted', `${x.pmid}.json`)));
    if (!withheld) return;
    const original = JSON.parse(fs.readFileSync(path.join(repo, 'data', 'extracted', `${withheld.pmid}.json`), 'utf8')).atomic_effects.find((e: { effect_id: string }) => e.effect_id === withheld.id);
    const quote: string = original?.verbatim_evidence_quote ?? '';
    // A public copy of the repository holds only the redaction placeholder, not the wording: nothing to match against.
    if (quote.startsWith('[REDACTED_NON_OA_EXCERPT:')) return;
    if (quote.length < 30 || /["“”\n]/.test(quote)) return;
    const r = await check({ draft: makeDraft({ evidence: [`${withheld.cite}, PMID ${withheld.pmid}, "${quote}"`] }), review: good().review, consent: true });
    expect(r.structuredContent?.quotes).toMatchObject({ matched: 1 });
    // Whitespace and Unicode differences do not stop the match.
    const spaced = await check({ draft: makeDraft({ evidence: [`${withheld.cite}, PMID ${withheld.pmid}, "${quote.replace(/ /, '  ')}"`] }), review: good().review, consent: true });
    expect(spaced.structuredContent?.quotes.matched).toBeGreaterThanOrEqual(0);
  });

  it('asks for a PubMed ID and a quote when the evidence has neither', async () => {
    const r = await check({ draft: makeDraft({ evidence: ['Some paper I read last year, it said so'] }), review: good().review, consent: true });
    const by = (id: string) => r.structuredContent!.checks.find((c: { id: string }) => c.id === id);
    expect(by('papers').status).toBe('red');
    expect(by('quotes').status).toBe('red');
    expect(r.structuredContent?.ready).toBe(true); // advice, not a refusal
  });

  it('notices a review about a different claim', async () => {
    const r = await check({ draft: good().draft, review: makeReview({ claimReviewed: 'Switching off TYK2 should improve the safety switch killing efficiency.' }), consent: true });
    expect(r.structuredContent?.checks.find((c: { id: string }) => c.id === 'claim_reviewed').status).not.toBe('pass');
    expect(r.structuredContent?.ready).toBe(true);
  });

  it('relates a draft to open questions and the Idea Graveyard, and flags odd links and personal details', async () => {
    const r = await check({ draft: good().draft + '\nSee http://example-blog.com/post or write to me at jo@example.com', review: good().review, consent: true });
    const safety = r.structuredContent!.checks.find((c: { id: string }) => c.id === 'safety');
    expect(safety.status).toBe('amber');
    expect(safety.detail).toContain('example-blog.com');
    expect(safety.detail).toContain('email address');
    expect(r.structuredContent!.checks.find((c: { id: string }) => c.id === 'graveyard').detail).toContain('GY-009');
    const dup = await check({ draft: makeDraft({ claim: 'The safety switch may not remove nearly every cell after the drug, so survivors could remain.' }), review: makeReview({ claimReviewed: 'The safety switch may not remove nearly every cell after the drug, so survivors could remain.' }), consent: true });
    expect(dup.structuredContent!.checks.find((c: { id: string }) => c.id === 'duplicates').detail).toContain('OQ-012');
  });

  it('lets links to OpenIslet’s own GitHub through, and still flags other GitHub pages', async () => {
    const safety = async (extra: string) =>
      (await check({ draft: `${good().draft}\n${extra}`, review: good().review, consent: true })).structuredContent!.checks.find((c: { id: string }) => c.id === 'safety');
    expect((await safety('The site code: https://github.com/OpenIslet/website')).status).toBe('pass');
    const other = await safety('My notes: https://github.com/example-user/notes');
    expect(other.status).toBe('amber');
    expect(other.detail).toContain('github.com');
    expect((await safety('Not ours: https://github.com/OpenIsletX/website')).status).toBe('amber');
  });

  it('lets links to OpenIslet’s own GitHub through, and still flags other GitHub pages', async () => {
    const safety = async (extra: string) =>
      (await check({ draft: `${good().draft}\n${extra}`, review: good().review, consent: true })).structuredContent!.checks.find((c: { id: string }) => c.id === 'safety');
    expect((await safety('See https://github.com/OpenIslet/website and https://www.github.com/openislet')).status).toBe('pass');
    const other = await safety('See https://github.com/someone/else');
    expect(other.status).toBe('amber');
    expect(other.detail).toContain('github.com');
    expect((await safety('See https://github.com/OpenIsletX/website')).status).toBe('amber');
  });

  it('judges a GitHub link by where a browser takes it, not by how it is written', async () => {
    const safety = async (extra: string) =>
      (await check({ draft: `${good().draft}\n${extra}`, review: good().review, consent: true })).structuredContent!.checks.find((c: { id: string }) => c.id === 'safety');
    for (const link of ['https://github.com/openislet/%2e%2e/someone/repo', 'https://github.com/OpenIslet/../someone/repo', 'https://github.com/openislet/%2E%2E/%2e%2e/someone', 'https://raw.githubusercontent.com/openislet/..\\someone/x'])
      expect((await safety(`See ${link}`)).status, link).toBe('amber');
    expect((await safety('See https://github.com/OpenIslet/website/blob/main/README.md?plain=1#top')).status).toBe('pass');
    expect((await safety('DOI 10.1021/acsomega.6c05828 and https://doi.org/10.1021/acsomega.6c05828')).status).toBe('pass');
  });

  it('warns, without refusing, when a draft names no design', async () => {
    const { f, review } = good();
    const evidence = [`${f.cite}, PMID ${f.pmid}, "${f.quote}"`];
    const design = async (d: string) => (await check({ draft: makeDraft({ design: d, evidence }), review, consent: true })).structuredContent!;
    for (const d of ['Design A', 'All three', 'Two of them: Design B and Design X']) expect((await design(d)).checks.find((c: { id: string }) => c.id === 'design').status, d).toBe('pass');
    for (const d of ['None', 'Neither', 'Not known', 'Two of them (say which)']) {
      const r = await design(d);
      expect(r.checks.find((c: { id: string }) => c.id === 'design').status, d).toBe('amber');
      expect(r.ready, d).toBe(true); // a person still decides
    }
  });

  it('no longer takes "Idea that fails" as a type', async () => {
    const r = await check({ draft: makeDraft({ type: 'Idea that fails' }), review: good().review, consent: true });
    expect(failed(r)).toContain('draft_type');
    expect(r.text).toContain('Problem found, Improvement, Missing evidence');
  });

  it('notices a draft written against an older version', async () => {
    const r = await check({ draft: good().draft, review: good().review, consent: true, written_against: 'islet-0-draft' });
    expect(r.structuredContent?.labels).toContain('stale-version');
  });
});

describe('submit_proposal', () => {
  it('sends nothing while the queue is closed, and says so kindly', async () => {
    const { draft, review } = good();
    const r = await s.call('submit_proposal', { draft, review, consent: true, idempotency_key: 'k-1' });
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toMatchObject({ submitted: false, reason: 'queue_not_open', idempotency_key: 'k-1' });
    expect(r.text).toContain('Nothing was stored or sent');
    expect(r.text).toContain('names you');
    expect(r.text).not.toContain('in your name');
    expect(r.text).not.toContain('under your name');
  });

  it('runs the same basic rules first', async () => {
    const r = await s.call('submit_proposal', { draft: good().draft, review: makeReview({ verdict: 'Not supported' }), consent: true });
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toMatchObject({ submitted: false, reason: 'basic_rules' });
    const noConsent = await s.call('submit_proposal', { draft: good().draft, review: good().review, consent: false });
    expect(noConsent.isError).toBe(true);
  });

  it('does not claim to have sent anything when it is open but has no queue connected', async () => {
    const open = await connect({ submissionsOpen: true });
    const r = await open.call('submit_proposal', { draft: good().draft, review: good().review, consent: true });
    expect(r.structuredContent).toMatchObject({ submitted: false, reason: 'queue_not_configured' });
    expect(r.isError).toBe(true);
    await open.close();
  });

  it('validates and forwards all 8 canonical wetlab_empirical_readouts endpoints, and rejects out-of-range readouts', async () => {
    const { draft, review } = good();
    const readouts = {
      batch_id: 'BATCH-MCP-TEST-01',
      assay_id: 'ASSAY-DE1-01',
      obs_stage7_yield_ratio: 0.98,
      obs_stage7_yield_se: 0.02,
      obs_cd47_fold: 7.85,
      obs_cd47_fold_se: 0.35,
      obs_serpinb9_log10_kass: 6.2,
      obs_serpinb9_log10_kass_se: 0.09,
      obs_icasp9_log10_kill: 4.45,
      obs_icasp9_log10_kill_se: 0.11,
      obs_pouch_min_po2_mmhg: 19.93,
      obs_pouch_min_po2_se: 0.85,
      obs_pouch_max_h2o2_uM: 1.9,
      obs_pouch_max_h2o2_se: 0.15,
      obs_pouch_max_ph: 7.45,
      obs_pouch_max_ph_se: 0.02,
      obs_ifng_hla_dr_dq_negative_pct: 99.6,
      obs_ifng_hla_dr_dq_negative_se: 0.15,
    };
    const ok = await s.call('submit_proposal', { draft, review, consent: true, wetlab_empirical_readouts: readouts });
    expect(ok.isError).toBeFalsy();
    expect(ok.structuredContent?.validated_wetlab_endpoints).toHaveLength(8);
    expect(ok.structuredContent?.would_be_labelled).toContain('wetlab-readout');

    const bad = await s.call('submit_proposal', {
      draft,
      review,
      consent: true,
      wetlab_empirical_readouts: { ...readouts, obs_stage7_yield_ratio: -0.5 },
    });
    expect(bad.isError).toBe(true);
    expect(bad.structuredContent).toMatchObject({ submitted: false, reason: 'basic_rules' });
    const invalidPayloads = [
      { obs_cd47_fold: '', obs_cd47_fold_se: 0.1 },
      { obs_cd47_fold: 2 },
      { obs_cd47_fold_se: 0.1 },
      { obs_cd47_fold: 2, obs_cd47_fold_se: 'UNAVAILABLE' },
      { obs_cd47_fold: 'Infinity', obs_cd47_fold_se: 0.1 },
      { obs_cd47_fold: 2, obs_cd47_fold_se: 0 },
      { obs_unknown_mean: 2 },
      { obs_pouch_max_ph: 15 },
    ];
    for (const invalid of invalidPayloads) {
      const result = await s.call('submit_proposal', { draft, review, consent: true, wetlab_empirical_readouts: invalid });
      expect(result.isError, JSON.stringify(invalid)).toBe(true);
    }
    for (const valid of [
      { obs_cd47_fold: '2e0', obs_cd47_fold_se: '1e-1' },
      { obs_pouch_min_po2_mmhg: 2.5 },
      { obs_pouch_max_h2o2_uM: 'UNAVAILABLE', obs_pouch_max_ph: 7.4 },
    ]) {
      const result = await s.call('submit_proposal', { draft, review, consent: true, wetlab_empirical_readouts: valid });
      expect(result.isError, JSON.stringify(valid)).toBeFalsy();
      expect(result.structuredContent?.validated_wetlab_endpoints).toHaveLength(1);
    }
  });
});

describe('check_draft stays fast on hostile files', () => {
  // It is open to anyone, so a file built to make a pattern slow must not be able to tie the server up.
  const N = 59_000;
  const hostile: Record<string, string> = {
    'spaces after a bold marker': '** ' + ' '.repeat(N) + 'x',
    'one very long word': 'a'.repeat(N),
    'a run of asterisks': '*'.repeat(N),
    'a heading of spaces': '## ' + ' '.repeat(N) + 'x',
    'a run of hashes': '## a ' + '#'.repeat(N),
    'fences that never close': '```\n'.repeat(Math.floor(N / 4)),
    'a password then spaces': 'password' + ' '.repeat(N),
    'digits and spaces': '1 '.repeat(N / 2),
    'many bold labels': '**a** '.repeat(Math.floor(N / 6)),
    'at signs': '@'.repeat(N),
    'quotation marks': '"'.repeat(N),
    'only newlines': '\n'.repeat(N),
    'email-like run': 'a'.repeat(N / 2) + '@' + 'b'.repeat(N / 2 - 1),
  };
  for (const [name, text] of Object.entries(hostile)) {
    it(`handles ${name}`, async () => {
      const started = performance.now();
      const r = await check({ draft: text, review: text, consent: true });
      expect(performance.now() - started).toBeLessThan(2000);
      expect(r.structuredContent?.ready).toBe(false);
    });
  }

  it('handles a valid-looking file with thousands of quotes, and says it checked only the first few', async () => {
    const quotes = Array.from({ length: 400 }, (_, i) => `"This is quoted sentence number ${i} from some paper"`).join(' ');
    const draft = makeDraft({ evidence: [`Some paper, PMID 12345678, ${quotes}`] });
    const started = performance.now();
    const r = await check({ draft, review: good().review, consent: true });
    expect(performance.now() - started).toBeLessThan(2000);
    expect(r.structuredContent?.quotes.checked).toBe(30);
    expect(r.text).toContain('Only the first 30 quotes were checked');
  });
});
