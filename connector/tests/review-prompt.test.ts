// The prompt for the fresh chat, built from the draft instead of asking the first AI to copy the reviewer template word for word.
// The reviewer gets the claim, the evidence and the proposed change exactly as the draft has them, and nothing else from it.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LINE_TOO_LONG, claimToTest, reviewPromptFor } from '../src/core/template';
import { reviewTemplate } from '../../src/data/prompts';
import { bundle, connect } from './helpers';

const draftWith = (o: { claim?: string; evidence?: string; proposal?: string } = {}) =>
  [
    '# Example title',
    '**Type:** Improvement',
    `**Claim in one sentence:** ${o.claim ?? 'Step two should come before step one.'}`,
    '**In plain English:** Doing the steps the other way round saves a day.',
    '**Affects test:** 1, because it changes the order',
    '**Affects design:** Design A',
    '## Evidence',
    o.evidence ?? '- Example paper, PubMed ID 12345678, "An example quote."\n- A second paper, PubMed ID 23456789, "Another quote."',
    '## What I propose changing',
    o.proposal ?? 'Swap steps one and two.',
    '## How this could be wrong',
    'The author reasoning that the reviewer must not see.',
    '## Cheapest way to check it',
    'Time both orders once.',
    '## AI tools used',
    'Example model, default effort',
  ].join('\n');

const [before, after] = reviewTemplate.split('[CLAIM]');

describe('the claim to test', () => {
  it('is the claim, the evidence and the proposed change, word for word and in that order', () => {
    const c = claimToTest(draftWith());
    expect(c).toEqual({
      ok: true,
      text: 'Step two should come before step one.\n\nEvidence:\n- Example paper, PubMed ID 12345678, "An example quote."\n- A second paper, PubMed ID 23456789, "Another quote."\n\nWhat I propose changing:\nSwap steps one and two.',
    });
  });

  it('leaves out the rest of the draft', () => {
    const c = claimToTest(draftWith());
    expect(c.ok && c.text).not.toMatch(/plain English|saves a day|author reasoning|Time both orders|Example model|Example title/);
  });

  it('names each missing or unfilled part', () => {
    expect(claimToTest('')).toEqual({ ok: false, missing: ['Claim in one sentence', 'Evidence', 'What I propose changing'] });
    expect(claimToTest(draftWith({ claim: '[What I am claiming]', proposal: '[The specific change to the blueprint, or the new Idea Graveyard entry]' }))).toEqual({
      ok: false,
      missing: ['Claim in one sentence', 'What I propose changing'],
    });
    expect(claimToTest(draftWith({ evidence: '' }))).toEqual({ ok: false, missing: ['Evidence'] });
  });

  it('refuses a line too long to be read whole, rather than sending part of it as if it were all', () => {
    const long = `- Example paper, PMID 12345678, "${'a long quote '.repeat(170)}"`;
    expect(long.length).toBeGreaterThan(2000);
    expect(claimToTest(draftWith({ evidence: long }))).toEqual({ ok: false, missing: [LINE_TOO_LONG] });
  });

  it('keeps brackets and "Not known" inside a filled-in part as they came', () => {
    const c = claimToTest(draftWith({ evidence: '- Not known', proposal: 'Swap the steps [and maybe a third one].' }));
    expect(c.ok && c.text).toContain('Evidence:\n- Not known');
    expect(c.ok && c.text).toContain('Swap the steps [and maybe a third one].');
  });

  it('is the same when the draft comes in a code block with chat around it, or with Windows line ends', () => {
    const plain = claimToTest(draftWith());
    const reply = `Here is your draft:\n\n\`\`\`markdown\n${draftWith()}\n\`\`\`\n\nWould you like me to change anything?`;
    expect(claimToTest(reply)).toEqual(plain);
    expect(claimToTest(draftWith().replace(/\n/g, '\r\n'))).toEqual(plain);
  });
});

describe('the prompt for the fresh chat', () => {
  it('is the public reviewer template with the claim in its slot, and nothing else changed', () => {
    const c = claimToTest(draftWith());
    const p = reviewPromptFor(reviewTemplate, draftWith());
    expect(p).toEqual({ ok: true, text: `${before}${c.ok && c.text}${after}` });
    expect(p.ok && p.text).toContain('[OPENISLET-REVIEW-v1]');
    expect(p.ok && p.text).not.toContain('[CLAIM]');
  });

  it('copies $ patterns in the draft literally', () => {
    const proposal = 'Use $& and $1 and $$ and $` and $\' exactly as written.';
    const p = reviewPromptFor(reviewTemplate, draftWith({ proposal }));
    expect(p.ok && p.text).toContain(`What I propose changing:\n${proposal}\n`);
  });

  it('fills only the template slot, even when the draft itself says [CLAIM]', () => {
    const p = reviewPromptFor(reviewTemplate, draftWith({ proposal: 'Leave the [CLAIM] marker alone.' }));
    expect(p.ok && p.text.startsWith(before)).toBe(true);
    expect(p.ok && p.text.endsWith(after)).toBe(true);
    expect(p.ok && p.text.split('[CLAIM]').length).toBe(2);
  });

  it('passes the missing parts on instead of a prompt', () => {
    expect(reviewPromptFor(reviewTemplate, '# Only a title')).toEqual({ ok: false, missing: ['Claim in one sentence', 'Evidence', 'What I propose changing'] });
  });

  it('refuses a template with no slot for the claim', () => {
    expect(() => reviewPromptFor('A template with no slot.', draftWith())).toThrow();
  });
});

describe('get_review_prompt', () => {
  let s: Awaited<ReturnType<typeof connect>>;
  beforeAll(async () => {
    s = await connect();
  });
  afterAll(async () => {
    await s.close();
  });

  it('gives the prompt built from the bundled reviewer template, in a code block', async () => {
    const r = await s.call('get_review_prompt', { draft: draftWith() });
    const p = reviewPromptFor(await bundle().text('prompts/review-template.md'), draftWith());
    expect(r.isError).toBeFalsy();
    expect(p.ok).toBe(true);
    expect(r.structuredContent!.prompt).toBe(p.ok && p.text);
    expect(r.text).toContain(`\n\`\`\`\n${p.ok && p.text}\n\`\`\`\n`);
  });

  it('fences the prompt with more backticks than any run inside it', async () => {
    const r = await s.call('get_review_prompt', { draft: draftWith({ proposal: 'Swap them:\n\n````\nstep two\nstep one\n````' }) });
    expect(r.text).toContain('\n`````\n');
    expect(r.structuredContent!.prompt).toContain('````\nstep two');
  });

  it('says plainly when a line is too long, and gives no prompt', async () => {
    const r = await s.call('get_review_prompt', { draft: draftWith({ evidence: `- ${'x'.repeat(2100)}` }) });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('longer than 2,000 characters');
    expect(r.structuredContent!.prompt).toBeUndefined();
  });

  it('says which parts are missing, and gives no prompt', async () => {
    const r = await s.call('get_review_prompt', { draft: '# Only a title' });
    expect(r.isError).toBe(true);
    expect(r.structuredContent!.missing).toEqual(['Claim in one sentence', 'Evidence', 'What I propose changing']);
    expect(r.structuredContent!.prompt).toBeUndefined();
  });
});
