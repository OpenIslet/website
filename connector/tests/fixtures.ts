// Drafts and reviews written exactly as the website's templates ask, so the checker can be tested against the real format.
import fs from 'node:fs';
import path from 'node:path';
import type { Finding } from '../src/core/types';
import { bundleDir } from './helpers';

export function findings(): Finding[] {
  return fs
    .readFileSync(path.join(bundleDir, 'findings.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Finding);
}

/** A finding whose exact sentence the bundle is allowed to show. */
export function shownQuote(): Finding {
  const f = findings().find((x) => x.quote && x.quote.length >= 80 && x.quote.length <= 230 && !/["“”]/.test(x.quote) && x.tests.length);
  if (!f) throw new Error('The bundle has no usable shown quote');
  return f;
}

export interface DraftOptions {
  title?: string;
  type?: string;
  claim?: string;
  plain?: string;
  test?: string;
  design?: string;
  evidence?: string[];
  proposal?: string;
  wrong?: string;
  cheap?: string;
  tools?: string;
  omit?: string[];
}

export function makeDraft(o: DraftOptions = {}): string {
  const omit = new Set(o.omit ?? []);
  const evidence = o.evidence ?? ['Example paper, PMID 12345678, "The exact sentence from the paper goes here, copied word for word."'];
  const lines: (string | null)[] = [
    `# ${o.title ?? 'Too little CD47 at hour zero?'}`,
    omit.has('type') ? null : `**Type:** ${o.type ?? 'Problem found'}`,
    omit.has('claim') ? null : `**Claim in one sentence:** ${o.claim ?? 'The B2M promoter may give too little CD47 on resting beta cells in the first hours after transplant.'}`,
    omit.has('plain') ? null : `**In plain English:** ${o.plain ?? 'The new cells may carry too little of the signal that tells macrophages to leave them alone. If so, the first hours are risky for them.'}`,
    omit.has('test') ? null : `**Affects test:** ${o.test ?? '3, because macrophages attack in the first hours'}`,
    omit.has('design') ? null : `**Affects design:** ${o.design ?? 'Design A'}`,
    '## Evidence',
    ...evidence.map((e) => `- ${e}`),
    '## What I propose changing',
    o.proposal ?? 'Measure CD47 at hour zero before relying on the B2M promoter, and add a steady promoter if it is too low.',
    '## How this could be wrong',
    o.wrong ?? 'Inflammation in the first hours may raise B2M enough to make up for it.',
    '## Cheapest way to check it',
    o.cheap ?? 'Count CD47 molecules on resting and inflamed edited cells with calibrated flow cytometry.',
    '## AI tools used',
    o.tools ?? 'Example model (High Effort)',
  ];
  return lines.filter((l) => l !== null).join('\n');
}

export interface ReviewOptions {
  verdict?: string;
  claimReviewed?: string;
  submit?: string;
  tools?: string;
  omit?: string[];
}

export function makeReview(o: ReviewOptions = {}): string {
  const omit = new Set(o.omit ?? []);
  const lines: (string | null)[] = [
    '# Review: Too little CD47 at hour zero?',
    omit.has('claim') ? null : `**Claim reviewed:** ${o.claimReviewed ?? 'The B2M promoter may give too little CD47 on resting beta cells in the first hours after transplant.'}`,
    `**Verdict:** ${o.verdict ?? 'Partly supported'}`,
    '**Confidence:** Medium',
    `**Submit to OpenIslet?** ${o.submit ?? 'Yes'}`,
    '**In plain English:** The idea is reasonable, but it depends on how much B2M is made in resting cells, which the paper cited does not measure directly.',
    '## What I checked',
    'I read the claim against the blueprint and the cited paper.',
    '## Evidence for',
    '- The cited paper shows B2M is low in resting cells.',
    '## Evidence against',
    '- Inflammation raises B2M quickly.',
    '## Idea Graveyard check',
    'It is close to rule GY-009 and does not contradict it.',
    '## Other ways it could fail',
    'The effect may be too small to matter.',
    '## Cheapest way to settle it',
    'Measure CD47 on resting and inflamed cells.',
    '## AI tools used',
    o.tools ?? 'Another example model (Max Effort)',
  ];
  return lines.filter((l) => l !== null).join('\n');
}
