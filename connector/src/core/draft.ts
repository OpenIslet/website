// check_draft: a dry run of the automatic checks on a draft and its blind review. Nothing is stored or sent.
//
// There are two groups. The "door" is structure only (the reasons a submission can be refused before it is posted).
// The other checks are advice for the person and for the maintainer who will decide: they never refuse anything.
// The checks run straight away look at the format, the Idea Graveyard rules, and whether quotes match the studies OpenIslet
// already holds. Checks that need the outside world (does the paper exist on PubMed, is it retracted, does the quote appear in
// the full text) are made by a person in the weekend review, and this tool says so.
import { type Answer, type Config, md } from './answer';
import type { Bundle } from './bundle';
import { CONTACT_EMAIL } from './contact';
import { suggestFromIdea } from './graveyard';
import type { ApiError, StageOutput, SubmitContext, ToolPosted, ToolSubmission } from './queue/types';
import { clip, normalise, similarity } from './text';
import { cleanPaste, keyOf, looksLike, parseDoc, placeholder, templateGaps, unfence, verdictOf, type Parsed } from './template';
import type { Finding } from './types';

import { normalizeWetlabReadouts, type WetlabEmpiricalReadouts } from './wetlab-readouts';
export { WETLAB_CANONICAL_ENDPOINTS, type WetlabEmpiricalReadouts, type WetlabReadoutValue } from './wetlab-readouts';

export interface DraftInput {
  draft: string;
  review: string;
  ai_tools?: { draft?: string; review?: string };
  consent?: boolean;
  /** The version the draft was written against. */
  written_against?: string;
  contributor?: unknown;
  idempotency_key?: string;
  wetlab_empirical_readouts?: WetlabEmpiricalReadouts;
}

export interface DoorCheck {
  id: string;
  name: string;
  status: 'pass' | 'fail';
  detail: string;
  fix?: string;
  /** When it fails: what is wrong, in a few words ("the review does not support the IIP"). */
  problem?: string;
}
export interface Check {
  id: string;
  name: string;
  status: 'pass' | 'amber' | 'red';
  detail: string;
  /** The label the public queue would add if the checks ran on a submission. */
  label?: string;
}

export const LIMITS = { min: 200, max: 30000 };

// ---------------------------------------------------------------------------------------------------------------
// Reading the Markdown
// ---------------------------------------------------------------------------------------------------------------

export { unfence, parseDoc } from './template';
export type { Parsed } from './template';

// ---------------------------------------------------------------------------------------------------------------
// Pieces the checks share
// ---------------------------------------------------------------------------------------------------------------

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Looks at each word on its own, so a very long line cannot slow the check down. */
function hasEmail(text: string): boolean {
  return text.split(/\s+/).some((word) => {
    if (word.length > 254 || !word.includes('@')) return false;
    const w = word.replace(/^[("'<[]+/, '').replace(/[)"'>\].,;:]+$/, '');
    const at = w.indexOf('@');
    return at > 0 && at === w.lastIndexOf('@') && /^[^\s@]+\.[A-Za-z]{2,}$/.test(w.slice(at + 1)) && !w.slice(0, at).includes(' ');
  });
}

/** At most this many papers are looked up and listed for one draft and its review. */
export const MAX_PAPERS_LISTED = 100;

export function pmidsIn(text: string): string[] {
  const found = new Set<string>();
  // A few spaces at most between the label and the number: an unbounded \s* here took seconds on a draft of blank space.
  for (const m of text.matchAll(/(?:\bPMID\b|\bPubMed(?:[ \t ]{1,3}ID)?\b)[ \t ]{0,3}[:#]?[ \t ]{0,3}(\d{5,9})\b/gi)) found.add(m[1]);
  for (const m of text.matchAll(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{5,9})/gi)) found.add(m[1]);
  return [...found];
}

const ALLOWED_HOSTS = [
  'doi.org', 'pubmed.ncbi.nlm.nih.gov', 'ncbi.nlm.nih.gov', 'europepmc.org', 'biorxiv.org', 'medrxiv.org', 'arxiv.org', 'openislet.org', 'clinicaltrials.gov', 'rcsb.org', 'alphafold.ebi.ac.uk',
];
const SECRET_PATTERNS: [RegExp, string][] = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'an AWS access key'],
  [/\bgh[pousr]_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{30,}/, 'a GitHub token'],
  [/\bsk-[A-Za-z0-9_-]{20,}\b/, 'an API key'],
  [/\b(?:api[_-]?key|secret|access[_-]?token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-./+]{12,}/i, 'something that looks like a password or key'],
];

function variantsOf(quote: string): string[] {
  const nfc = quote.normalize('NFC');
  return [...new Set([quote, quote.trim(), nfc.trim(), nfc.replace(/\s+/g, ' ').trim()])];
}

interface QuoteResult {
  quote: string;
  line: string;
  state: 'matches' | 'wrong_paper' | 'not_checked_here';
  finding?: string;
  pmid?: string;
  cited?: string[];
}

const MAX_QUOTES = 30;
const shownIndex = new WeakMap<Bundle, Promise<{ finding: Finding; text: string }[]>>();

/** The sentences the bundle may show, normalised once, so checking a draft does not repeat that work for every quote. */
function shownQuotes(bundle: Bundle): Promise<{ finding: Finding; text: string }[]> {
  let p = shownIndex.get(bundle);
  if (!p) {
    p = bundle.findings().then((all) => all.filter((f) => f.quote).map((f) => ({ finding: f, text: normalise(f.quote as string) })));
    shownIndex.set(bundle, p);
  }
  return p;
}

async function checkQuotes(bundle: Bundle, evidence: string): Promise<{ results: QuoteResult[]; skipped: number }> {
  const results: QuoteResult[] = [];
  const byPmid = await bundle.findingsByPmid();
  const prints = await bundle.quoteFingerprints();
  const shown = await shownQuotes(bundle);
  let skipped = 0;
  for (const rawLine of evidence.split('\n')) {
    const line = rawLine.slice(0, 4000);
    const quotes = [...line.matchAll(/[“"]([^”"\n]{20,500})[”"]/g)].map((m) => m[1]);
    if (/^\s*>/.test(line)) quotes.push(line.replace(/^\s*>\s*/, '').slice(0, 500));
    if (!quotes.length) continue;
    const cited = pmidsIn(line);
    for (const quote of quotes) {
      if (results.length >= MAX_QUOTES) {
        skipped++;
        continue;
      }
      const norm = normalise(quote);
      const candidates: Finding[] = [];
      for (const s of shown) {
        if (norm.length >= 20 && s.text.includes(norm)) {
          candidates.push(s.finding);
        }
      }
      if (!candidates.length || !candidates.some((f) => cited.includes(f.pmid))) {
        for (const v of variantsOf(quote)) {
          const f = prints.get(await sha256Hex(v));
          if (f) {
            candidates.push(...f);
          }
        }
      }
      const hit = candidates.find((f) => cited.includes(f.pmid)) ?? candidates[0];
      if (hit) {
        const right = cited.length === 0 || cited.includes(hit.pmid);
        results.push({ quote: clip(quote, 120), line: clip(line, 160), state: right ? 'matches' : 'wrong_paper', finding: hit.id, pmid: hit.pmid, cited });
      } else {
        results.push({ quote: clip(quote, 120), line: clip(line, 160), state: 'not_checked_here', cited: cited.filter((p) => byPmid.has(p)) });
      }
    }
  }
  return { results, skipped };
}

// ---------------------------------------------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------------------------------------------

export interface DraftReport {
  ready: boolean;
  door: DoorCheck[];
  checks: Check[];
  labels: string[];
  fix: string[];
  /** The draft's first # heading, which becomes the title of the public issue. */
  title: string | null;
  claim: string | null;
  type: string | null;
  tests: string[];
  design: string | null;
  /** The AI tools named for the draft and the review, from the tool input or the files; empty when not stated. */
  ai_tools: { draft: string; review: string };
  pmids: { pmid: string; in_openislet_corpus: boolean; study: string | null }[];
  quotes: { checked: number; matched: number; wrong_paper: number; not_checked_here: number };
  review_verdict: string | null;
  wetlab_empirical_readouts?: WetlabEmpiricalReadouts | null;
  validated_wetlab_endpoints?: string[];
  defaulted_wetlab_standard_errors?: string[];
}

const optionMatch = (value: string | undefined, options: string[] | null | undefined): string | null => {
  if (!value || !options) return null;
  const v = normalise(value);
  return options.find((o) => v === normalise(o) || v.startsWith(`${normalise(o)} `) || v.startsWith(`${normalise(o)},`) || v.startsWith(`${normalise(o)}.`)) ?? null;
};

export { verdictOf } from './template';

type DesignLetter = 'a' | 'b' | 'x';

/**
 * Which designs a draft says it affects. The template offers "Design A", "Design B", "Design X", "Two of them (say which)" and "All three"
 * (older drafts say "Both", "Neither" and "None"), and people (and AIs) also write lists such as "Design A and Design B" or "Designs A, B and X".
 */
export function designsNamed(value: string | undefined): { letters: DesignLetter[]; neither: boolean } {
  const raw = (value ?? '').normalize('NFKC');
  const v = normalise(raw);
  const found = new Set<DesignLetter>();
  if (/\ball three\b/.test(v)) for (const l of ['a', 'b', 'x'] as const) found.add(l);
  if (/\bboth\b/.test(v)) {
    found.add('a');
    found.add('b');
  }
  // "Design A", "Designs A, B and X", "Design A / Design B". After the first one, a bare letter must be a capital, so an
  // ordinary "a" (as in "Design B and a new promoter") is not taken for Design A.
  const word = '(?:design|Design|DESIGN)s?';
  const list = new RegExp(`\\b${word}\\s+([ABXabx])\\b((?:\\s*(?:,|and|And|AND|&|\\/|\\+|or|Or|OR)\\s*(?:${word}\\s+[ABXabx]|[ABX])\\b)*)`, 'g');
  for (const m of raw.matchAll(list)) {
    found.add(m[1].toLowerCase() as DesignLetter);
    for (const more of m[2].matchAll(new RegExp(`${word}\\s+([ABXabx])\\b|\\b([ABX])\\b`, 'g'))) found.add((more[1] ?? more[2]).toLowerCase() as DesignLetter);
  }
  if (/\b(?:islet-x|blueprint x)\b/.test(v)) found.add('x');
  const letters = (['a', 'b', 'x'] as const).filter((l) => found.has(l));
  return { letters, neither: letters.length === 0 && /\b(?:neither|none)\b/.test(v) };
}

/** The label and the plain wording for the designs a draft names, or nothing if it names none. */
export function designLabels(value: string | undefined): { labels: string[]; text: string | null } {
  const { letters, neither } = designsNamed(value);
  const key = letters.join('');
  if (neither) return { labels: ['design:neither'], text: 'Neither' };
  if (key === 'abx') return { labels: ['design:all-three'], text: 'All three' };
  if (key === 'ab') return { labels: ['design:both'], text: 'Both' };
  if (letters.length === 1) return { labels: [`design:${key}`], text: `Design ${key.toUpperCase()}` };
  if (letters.length === 2) return { labels: letters.map((l) => `design:${l}`), text: `Design ${letters[0].toUpperCase()} and Design ${letters[1].toUpperCase()}` };
  return { labels: [], text: null };
}

export async function runChecks(bundle: Bundle, cfg: Config, input: DraftInput): Promise<DraftReport> {
  const structure = await bundle.structure();
  // People paste what their AI gave them (a whole reply, or the file copied as formatted text). Read the file inside it, but look for
  // keys and passwords in everything they pasted.
  const pasted = input;
  input = { ...input, draft: cleanPaste(input.draft ?? '', 'draft').text, review: cleanPaste(input.review ?? '', 'review').text };
  const draftText = unfence(input.draft ?? '');
  const reviewText = unfence(input.review ?? '');
  const draft = parseDoc(input.draft ?? '');
  const review = parseDoc(input.review ?? '');
  const door: DoorCheck[] = [];
  const checks: Check[] = [];
  const fix: string[] = [];

  // ---- The door: structure only ----
  const missing = (parsed: Parsed, spec: typeof structure.draft, what: 'draft' | 'review'): string[] => templateGaps(parsed, spec, what);
  const tooShort = (t: string) => t.length < LIMITS.min;
  const tooLong = (t: string) => t.length > LIMITS.max;

  door.push({
    id: 'draft_present',
    name: 'A draft is attached',
    status: tooShort(draftText) ? 'fail' : 'pass',
    detail: tooShort(draftText) ? 'The draft is empty or too short to be an IIP.' : 'Found.',
    fix: 'Paste the whole draft file your AI wrote in step 3.',
    problem: 'no draft is attached',
  });
  door.push({
    id: 'review_present',
    name: 'A blind review is attached',
    status: tooShort(reviewText) ? 'fail' : 'pass',
    detail: tooShort(reviewText) ? 'The review is empty or too short.' : 'Found.',
    fix: 'Get a blind review from a fresh chat (step 4) and paste the whole file.',
    problem: 'no blind review is attached',
  });
  // The usual mix-ups, named for what they are: the reviewer prompt pasted instead of the review, or the two files the wrong way round.
  const draftIs = looksLike(pasted.draft ?? '');
  const reviewIs = looksLike(pasted.review ?? '');
  const mixUp = (is: string, want: 'draft' | 'review'): { detail: string; fix: string } | null =>
    is === 'review-prompt'
      ? { detail: 'This is the reviewer prompt (the text to paste into a fresh chat), not the review it produces.', fix: 'Paste the prompt into a brand-new chat, and send the answer that chat gives back: that answer is the review.' }
      : is !== 'unknown' && is !== want
        ? { detail: `This looks like the ${is === 'review' ? 'blind review' : 'draft'}, not the ${want === 'review' ? 'blind review' : 'draft'}.`, fix: 'Send the draft as the draft and the review as the review.' }
        : null;
  if (!tooShort(draftText)) {
    const gaps = missing(draft, structure.draft, 'draft');
    const wrong = gaps.length ? mixUp(draftIs, 'draft') : null;
    door.push({
      id: 'draft_structure',
      name: 'The draft follows the template',
      status: gaps.length ? 'fail' : 'pass',
      detail: wrong ? wrong.detail : gaps.length ? `Missing or left as a placeholder: ${gaps.join(', ')}.` : 'Every required line and section is there.',
      fix: wrong ? wrong.fix : 'Ask your AI to fill the missing parts using the exact template. If something is unknown, write "Not known".',
      problem: 'the draft does not follow the template',
    });
    const type = optionMatch(draft.fields.get('type'), structure.draft.fields.find((f) => keyOf(f.name) === 'type')?.options);
    if (!placeholder(draft.fields.get('type')) && !type) {
      door.push({
        id: 'draft_type',
        name: 'The type is one of the allowed values',
        status: 'fail',
        detail: `"${clip(draft.fields.get('type') ?? '', 60)}" is not one of: ${structure.draft.fields.find((f) => keyOf(f.name) === 'type')?.options?.join(', ')}.`,
        fix: 'Choose one of the allowed types.',
        problem: 'the type is not one of the allowed values',
      });
    }
  }
  if (!tooShort(reviewText)) {
    const gaps = missing(review, structure.review, 'review');
    const wrong = gaps.length ? mixUp(reviewIs, 'review') : null;
    door.push({
      id: 'review_structure',
      name: 'The review follows the template',
      status: gaps.length ? 'fail' : 'pass',
      detail: wrong ? wrong.detail : gaps.length ? `Missing or left as a placeholder: ${gaps.join(', ')}.` : 'Every required line and section is there.',
      fix: wrong ? wrong.fix : 'Run the reviewer prompt again in a fresh chat, using the current template (it now includes a "Claim reviewed" line).',
      problem: 'the review does not follow the template',
    });
  }
  const verdict = verdictOf(review.fields.get('verdict'));
  const accepted = structure.accepted_review_verdicts.map(normalise);
  door.push({
    id: 'review_verdict',
    name: 'The review supports the IIP',
    status: verdict && accepted.includes(normalise(verdict)) ? 'pass' : 'fail',
    detail: verdict ? `The reviewer's verdict is "${verdict}".` : 'The review has no readable verdict.',
    fix: verdict
      ? `Only IIPs whose blind review says ${structure.accepted_review_verdicts.join(' or ')} can be submitted. A review that says "${verdict}" means the IIP did not survive its test. Revise the IIP, or drop it.`
      : 'The review must say Supported, Partly supported, Not supported or Cannot tell on its Verdict line.',
    problem: 'the review does not support the IIP',
  });
  door.push({
    id: 'consent',
    name: 'Consent to publish openly under CC BY 4.0',
    status: input.consent === true ? 'pass' : 'fail',
    detail: input.consent === true ? 'Given.' : 'Not given.',
    fix: 'IIPs and reviews are published openly under CC BY 4.0, credited to your account. Say yes only if you agree.',
    problem: 'consent to publish under CC BY 4.0 was not given',
  });
  door.push({
    id: 'size',
    name: 'Not too large',
    status: tooLong(input.draft ?? '') || tooLong(input.review ?? '') ? 'fail' : 'pass',
    detail: `Draft ${draftText.length.toLocaleString('en-GB')} characters, review ${reviewText.length.toLocaleString('en-GB')} (each may be up to ${LIMITS.max.toLocaleString('en-GB')}).`,
    fix: 'Shorten it. One IIP should be one claim.',
    problem: 'the draft or the review is too large',
  });
  const rawSafetyText = [pasted.draft, pasted.review, input.ai_tools?.draft, input.ai_tools?.review,
    input.written_against, input.idempotency_key, ...Object.values(input.wetlab_empirical_readouts ?? {}),
    ...Object.values(input.contributor && typeof input.contributor === 'object' ? input.contributor : {})]
    .filter((value): value is string => typeof value === 'string').join('\n').normalize('NFKC').replace(/\p{Cf}/gu, '');
  const secrets = SECRET_PATTERNS.filter(([re]) => re.test(rawSafetyText)).map(([, what]) => what);
  door.push({
    id: 'no_secrets',
    name: 'No keys or passwords',
    status: secrets.length ? 'fail' : 'pass',
    detail: secrets.length ? `The text seems to contain ${secrets.join(' and ')}. Everything submitted is published.` : 'None found.',
    fix: 'Remove it before doing anything else, and change that key or password.',
    problem: 'the text contains a key or password',
  });

  const validatedWetlabEndpoints: string[] = [];
  const defaultedWetlabErrors: string[] = [];
  let normalizedWetlabReadouts: WetlabEmpiricalReadouts | null = null;
  if (input.wetlab_empirical_readouts !== undefined) {
    const checked = normalizeWetlabReadouts(input.wetlab_empirical_readouts);
    validatedWetlabEndpoints.push(...checked.validated);
    defaultedWetlabErrors.push(...checked.defaulted);
    normalizedWetlabReadouts = checked.payload;
    door.push({
      id: 'wetlab_readouts', name: 'Wet-lab empirical readouts match the 8-endpoint contract',
      status: checked.errors.length ? 'fail' : 'pass',
      detail: checked.errors.length ? `Invalid wet-lab readout payload: ${checked.errors.join('; ')}.` : `${checked.validated.length} canonical endpoint(s) validated. ${checked.defaulted.length ? "Declared, unmeasured standard-error defaults used for: " + checked.defaulted.join(", ") : "No standard-error defaults used."}`,
      fix: 'Supply finite decimal means, paired SE >= 0.001 for core endpoints, declared SE defaults for extended endpoints, or UNAVAILABLE.',
      problem: 'the wet-lab empirical readouts are out of range or incomplete',
    });
  }

  // ---- Advice for the person and the maintainer ----
  const claim = draft.fields.get('claim in one sentence');
  const claimReviewed = review.fields.get('claim reviewed');
  const typeValue = optionMatch(draft.fields.get('type'), structure.draft.fields.find((f) => keyOf(f.name) === 'type')?.options);
  const testCodes = [...new Set((draft.fields.get('affects test') ?? '').toUpperCase().match(/\b(?:2A|2B|[1-5])\b/g) ?? [])];
  const designValue = optionMatch(draft.fields.get('affects design'), structure.draft.fields.find((f) => keyOf(f.name) === 'affects design')?.options);
  const designRaw = draft.fields.get('affects design');
  const named = placeholder(designRaw) ? { labels: [], text: null } : designLabels(designRaw);

  // The design it changes. An IIP is a problem with the blueprint or a way to improve it, so it names Design A, B or X. A person
  // still decides, so this is a warning, not a rule.
  const namesDesign = named.labels.some((l) => l !== 'design:neither');
  checks.push({
    id: 'design',
    name: 'Says which design it changes',
    status: namesDesign ? 'pass' : 'amber',
    detail: namesDesign ? `It says it affects ${named.text}.` : 'It does not name Design A, B or X. An IIP should be a problem with a design or a way to improve one: say which on the "Affects design" line.',
  });

  // AI tools named
  const toolsDraft = input.ai_tools?.draft || (placeholder(draft.sections.get('ai tools used')) ? '' : (draft.sections.get('ai tools used') ?? ''));
  const toolsReview = input.ai_tools?.review || (placeholder(review.sections.get('ai tools used')) ? '' : (review.sections.get('ai tools used') ?? ''));
  checks.push({
    id: 'ai_tools',
    name: 'AI tools named',
    status: toolsDraft && toolsReview ? 'pass' : 'amber',
    detail: toolsDraft && toolsReview ? 'Both the draft and the review say which AI tools were used (shown as reported by you, never as verified).' : 'Name the AI tool and effort setting for both the draft and the review. "Unreleased model" is fine.',
  });

  // Papers and quotes
  const evidence = draft.sections.get('evidence') ?? '';
  const evidencePmids = pmidsIn(evidence);
  // An honest draft names a handful of papers; the cap keeps a file full of PubMed IDs from making a huge answer.
  const allPmids = [...new Set([...pmidsIn(draftText), ...pmidsIn(reviewText)])].slice(0, MAX_PAPERS_LISTED);
  const known = await bundle.studyByPmid();
  const pmids = allPmids.map((pmid) => ({ pmid, in_openislet_corpus: known.has(pmid), study: known.has(pmid) ? `${known.get(pmid)!.first_author} ${known.get(pmid)!.year}` : null }));
  checks.push({
    id: 'papers',
    name: 'Papers are cited by PubMed ID',
    status: evidencePmids.length ? 'pass' : 'red',
    detail: evidencePmids.length
      ? `${evidencePmids.length} ${evidencePmids.length === 1 ? 'paper' : 'papers'} cited in the evidence (${pmids.filter((p) => evidencePmids.includes(p.pmid) && p.in_openislet_corpus).length} already in the OpenIslet studies). This check does not look the papers up. In the weekend review a person checks on PubMed that each one exists and has not been retracted.`
      : 'The evidence section cites no PubMed ID. Every paper needs its PubMed ID, so a reader can check it.',
  });
  const { results: quotes, skipped: quotesSkipped } = await checkQuotes(bundle, evidence);
  const count = (s: QuoteResult['state']) => quotes.filter((q) => q.state === s).length;
  checks.push({
    id: 'quotes',
    name: 'Quotes match their papers',
    status: !quotes.length || count('wrong_paper') ? 'red' : count('not_checked_here') || quotesSkipped ? 'amber' : 'pass',
    detail: !quotes.length
      ? 'No quoted sentence was found in the evidence. Copy the exact sentence from the paper, word for word, between quotation marks.'
      : `${quotes.length} quoted ${quotes.length === 1 ? 'sentence' : 'sentences'}: ${count('matches')} matched the OpenIslet record, ${count('wrong_paper')} matched a different paper than the one cited, and ${count('not_checked_here')} cannot be checked here. Unmatched quotes require checking against the original source; this tool has not verified them.${quotesSkipped ? ` Only the first ${MAX_QUOTES} quotes were checked; ${quotesSkipped} more were left out.` : ''}`,
  });

  // Claim reviewed
  if (claim && claimReviewed && !placeholder(claim) && !placeholder(claimReviewed)) {
    const s = similarity(claim, claimReviewed);
    checks.push({
      id: 'claim_reviewed',
      name: 'The review is about the same claim',
      status: s >= 0.5 ? 'pass' : s >= 0.3 ? 'amber' : 'red',
      detail: s >= 0.5 ? 'The reviewer restated the same claim.' : `The reviewer's restatement is not close to your claim (similarity ${s.toFixed(2)}). A reviewer who tested a different claim has not tested yours.`,
    });
  }

  // Idea Graveyard
  const proposal = draft.sections.get('what i propose changing') ?? '';
  const related = claim ? await suggestFromIdea(bundle, `${claim} ${proposal}`.slice(0, 2000)) : null;
  const ruleIds = [...new Set(`${draftText}`.match(/\bGY-0\d\d\b/g) ?? [])];
  if (related?.suggestions.length) {
    checks.push({
      id: 'graveyard',
      name: 'Idea Graveyard',
      status: 'amber',
      detail: `This may touch ${related.suggestions.map((s) => `${s.id} (${clip(s.title, 60)})`).join('; ')}. These are word-matches, not a verdict. Say in your draft how your IIP relates to each.`,
      label: 'idea-graveyard-check',
    });
  } else {
    checks.push({ id: 'graveyard', name: 'Idea Graveyard', status: 'pass', detail: `No Idea Graveyard rule looks related by its words.${ruleIds.length ? ` You named ${ruleIds.join(', ')}.` : ''}` });
  }

  // Duplicates
  const [questions, ledger] = await Promise.all([bundle.openQuestions(), bundle.ledger()]);
  const text = `${claim ?? ''} ${proposal}`.slice(0, 4000).trim();
  const dupQ = text ? questions.map((q) => ({ q, s: similarity(text, `${q.title} ${q.plain}`) })).filter((x) => x.s >= 0.3).sort((a, b) => b.s - a.s)[0] : undefined;
  const dupL = claim ? ledger.records.map((r) => ({ r, s: similarity(claim, r.title) })).filter((x) => x.s >= 0.6).sort((a, b) => b.s - a.s)[0] : undefined;
  checks.push({
    id: 'duplicates',
    name: 'Not already known',
    status: dupL ? 'amber' : 'pass',
    detail: dupL
      ? `Similar to the earlier contribution ${dupL.r.id} ("${clip(dupL.r.title, 80)}").`
      : dupQ
        ? `This looks related to the open question ${dupQ.q.id} ("${clip(dupQ.q.title, 80)}"). That is welcome if your IIP helps answer it: say so.`
        : 'Nothing similar found in the open questions or earlier contributions.',
    label: dupL ? 'possible-duplicate' : undefined,
  });

  // Version
  const active = (await bundle.meta()).id;
  const stale = input.written_against !== undefined && input.written_against !== 'draft' && input.written_against !== active;
  checks.push({
    id: 'version',
    name: 'Written against the current version',
    status: stale ? 'amber' : 'pass',
    detail: stale ? `It says it was written against ${input.written_against}, but the current version is ${active}. Check it still holds.` : `Checked against ${active}.`,
    label: stale ? 'stale-version' : undefined,
  });

  // Links and personal data
  const hosts = [...new Set([...`${draftText}\n${reviewText}`.matchAll(/https?:\/\/([a-z0-9.-]{1,253})/gi)].map((m) => m[1].toLowerCase().replace(/^www\./, '')))];
  const odd = hosts.filter((h) => !ALLOWED_HOSTS.some((a) => h === a || h.endsWith(`.${a}`)));
  const personal = [
    hasEmail(`${draftText}\n${reviewText}`) ? 'an email address' : null,
    /(?<!\d)(?:\+?\d[\s().-]?){9,14}\d(?!\d)/.test(`${draftText}\n${reviewText}`.replace(/\b\d{5,9}\b/g, '')) ? 'what may be a phone number' : null,
  ].filter(Boolean);
  checks.push({
    id: 'safety',
    name: 'Links and personal details',
    status: odd.length || personal.length ? 'amber' : 'pass',
    detail:
      odd.length || personal.length
        ? `${odd.length ? `Links to ${odd.slice(0, 4).join(', ')} are not DOIs, PubMed or preprint servers and will be flagged for a person to look at. ` : ''}${personal.length ? `The text seems to contain ${personal.join(' and ')}. Everything submitted is public, so remove personal details.` : ''}`.trim()
        : 'Links go only to DOIs, PubMed, preprint servers and OpenIslet. No personal details found.',
  });

  // Does the review itself say to submit?
  const submitLine = review.fields.get('submit to openislet');
  if (submitLine && !placeholder(submitLine) && /^no\b/i.test(submitLine.trim())) {
    checks.push({ id: 'review_says_no', name: 'The review recommends submitting', status: 'red', detail: 'The review answers "Submit to OpenIslet?" with No.' });
  }

  // What to fix, in order: the door first, then the red checks, then the amber ones.
  for (const d of door) if (d.status === 'fail' && d.fix) fix.push(`${d.name}: ${d.detail} ${d.fix}`.replace(/\s+/g, ' '));
  for (const c of checks) if (c.status === 'red') fix.push(`${c.name}: ${c.detail}`);
  for (const c of checks) if (c.status === 'amber') fix.push(`${c.name}: ${c.detail}`);

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  // The designs it names: one label each for A, B and X; "Both" and "All three" (also written as lists) get their own label.
  const designLabelList = named.labels.length ? named.labels : designValue ? [`design:${slug(designValue.replace(/^design\s+/i, ''))}`] : [];
  const labels = [
    'submission',
    ...(typeValue ? [`type:${slug(typeValue)}`] : []),
    ...testCodes.map((t) => `test:${t.toLowerCase()}`),
    ...designLabelList,
    ...(validatedWetlabEndpoints.length ? ['wetlab-readout'] : []),
    ...checks.flatMap((c) => (c.status !== 'pass' && c.label ? [c.label] : [])),
  ];

  return {
    ready: door.every((d) => d.status === 'pass'),
    // A rule that passed needs no advice, and its "what is wrong" would contradict the pass.
    door: door.map((d) => (d.status === 'pass' ? { id: d.id, name: d.name, status: d.status, detail: d.detail } : d)),
    checks,
    labels,
    fix,
    title: draft.title,
    claim: claim && !placeholder(claim) ? claim : null,
    type: typeValue,
    tests: testCodes,
    design: named.text ?? designValue,
    ai_tools: { draft: toolsDraft, review: toolsReview },
    pmids,
    quotes: { checked: quotes.length, matched: count('matches'), wrong_paper: count('wrong_paper'), not_checked_here: count('not_checked_here') },
    review_verdict: verdict,
    wetlab_empirical_readouts: normalizedWetlabReadouts,
    validated_wetlab_endpoints: validatedWetlabEndpoints,
    defaulted_wetlab_standard_errors: defaultedWetlabErrors,
  };
}

const mark = (s: string) => (s === 'pass' ? '✅' : s === 'fail' || s === 'red' ? '❌' : '🟡');

/**
 * The two tables of results: the basic rules, then the other checks. `cell` can clean each piece of text before it is
 * written (the public queue uses it, because some of these sentences quote the contributor's own words).
 */
export function checkTables(r: Pick<DraftReport, 'door' | 'checks'>, cell: (text: string) => string = (text) => text): { door: string; checks: string } {
  return {
    door: md.table(['', 'Rule', 'Result'], r.door.map((d) => [mark(d.status), cell(d.name), cell(d.detail)])),
    checks: md.table(['', 'Check', 'Result'], r.checks.map((c) => [mark(c.status), cell(c.name), cell(c.detail)])),
  };
}

export async function checkDraft(bundle: Bundle, cfg: Config, input: DraftInput): Promise<Answer> {
  const r = await runChecks(bundle, cfg, input);
  const fails = r.door.filter((d) => d.status === 'fail');
  const reds = r.checks.filter((c) => c.status === 'red');
  const ambers = r.checks.filter((c) => c.status === 'amber');
  const summary = !r.ready
    ? `Not ready to submit. ${fails.length} ${fails.length === 1 ? 'thing needs' : 'things need'} fixing first: ${fails.slice(0, 3).map((f) => f.problem ?? f.name).join('; ')}.`
    : reds.length
      ? `The draft meets the basic rules, but ${reds.length} ${reds.length === 1 ? 'check needs' : 'checks need'} attention before a person reviews it: ${reds.map((c) => c.name.toLowerCase()).join('; ')}.`
      : ambers.length
        ? `The draft meets the basic rules, with ${ambers.length} ${ambers.length === 1 ? 'point' : 'points'} worth a look. A person still decides.`
        : 'The draft meets the basic rules and the automatic checks found nothing to fix. A person still decides whether it is accepted.';
  const tables = checkTables(r);
  const body =
    md.h(1, 'Draft check (a dry run: nothing was stored or sent)') +
    '\n' +
    md.h(2, 'The basic rules (these can stop a submission)') +
    tables.door +
    '\n' +
    md.h(2, 'Automatic checks (advice for you and for the person who will decide)') +
    tables.checks +
    (r.fix.length ? `\n${md.h(2, 'What to fix, in order')}${md.numbered(r.fix)}` : '') +
    `\n*Labels the public queue would add:* ${r.labels.join(', ')}\n`;
  return {
    summary,
    body,
    data: {
      ready: r.ready,
      door: r.door,
      checks: r.checks,
      labels: r.labels,
      what_to_fix: r.fix,
      claim: r.claim,
      type: r.type,
      tests: r.tests,
      design: r.design,
      papers: r.pmids,
      quotes: r.quotes,
      review_verdict: r.review_verdict,
      ...(r.wetlab_empirical_readouts ? { wetlab_empirical_readouts: r.wetlab_empirical_readouts, validated_wetlab_endpoints: r.validated_wetlab_endpoints, defaulted_wetlab_standard_errors: r.defaulted_wetlab_standard_errors } : {}),
    },
    notes: [
      'This is a dry run of the instant checks: the format, the Idea Graveyard rules, and whether quotes match the studies OpenIslet already holds. It does not look papers up on PubMed or judge the science. That happens in the weekend review.',
      cfg.submissionsOpen ? 'Submissions are open.' : 'Sending an Islet Improvement Proposal (IIP) opens when the public queue opens. Keep your files: nothing here was saved.',
    ],
  };
}

const wetlabData = (r: DraftReport) =>
  r.wetlab_empirical_readouts
    ? { wetlab_empirical_readouts: r.wetlab_empirical_readouts, validated_wetlab_endpoints: r.validated_wetlab_endpoints, defaulted_wetlab_standard_errors: r.defaulted_wetlab_standard_errors }
    : {};

/** A refusal from the queue itself (a rate limit, a bad ORCID iD, GitHub not answering ...), in plain English. */
function queueProblem(error: ApiError, r: DraftReport): Answer {
  const data: Record<string, unknown> = { submitted: false, reason: error.error, ...wetlabData(r) };
  if (typeof error.field === 'string') data.field = error.field;
  if (typeof error.retry_after_seconds === 'number') data.retry_after_seconds = error.retry_after_seconds;
  const fixes = error.error === 'basic_rules' && Array.isArray(error.what_to_fix) ? (error.what_to_fix as string[]) : [];
  if (error.error === 'basic_rules') {
    data.what_to_fix = error.what_to_fix;
    data.door = error.door;
  }
  // GitHub did not answer after the request to open the issue was sent: it may have been made, so never say that nothing was.
  const unsure = error.outcome_unknown === true;
  if (unsure) {
    data.outcome_unknown = true;
    if (typeof error.queue_url === 'string') data.queue_url = error.queue_url;
  }
  return {
    summary: unsure ? `Not confirmed. ${error.message}` : `Not sent. ${error.message}`,
    body:
      md.h(1, unsure ? 'Not confirmed' : 'Not sent') +
      `\n${error.message}\n\n` +
      (unsure ? 'Keep your draft and your blind review until you have looked at the queue.' : 'Nothing was made public. Keep your draft and your blind review.') +
      (fixes.length ? `\n\n${md.numbered(fixes)}` : ''),
    data,
    isError: true,
  };
}

/** Signed in, and the issue is open. */
function postedAnswer(out: ToolPosted): Answer {
  const who = `@${out.contributor.github}`;
  return {
    summary: out.replayed
      ? `Already sent: this Islet Improvement Proposal (IIP) was posted earlier as ${out.record_id}, so nothing new was posted. It is public at ${out.issue.url} and names you as ${who}.`
      : `Sent. Your Islet Improvement Proposal (IIP) is now public as ${out.record_id} (${out.issue.url}) and names you as ${who}, verified through GitHub. Software has checked its format, the Idea Graveyard rules and its quotes. A person looks the papers up and reviews the science in the weekend review, and posts the decision on the issue.`,
    body:
      md.h(1, `${out.replayed ? 'Already sent' : 'Sent'}: ${out.record_id}`) +
      `\nYour IIP is public at ${md.link(out.issue.url, out.issue.url)}. It names you as ${who}, verified through GitHub.\n\n` +
      md.h(2, 'What happens next') +
      md.numbered([
        'Software checked the format, the Idea Graveyard rules and the quotes straight away. The results are in the first comment on the issue.',
        "In the weekend review a person looks the papers up on PubMed, reviews the science with the week's other IIPs, and posts the decision, with reasons, on the issue.",
        'If it is accepted, it is folded into the blueprint and you are credited as a contributor.',
      ]),
    data: { submitted: true, issue: out.issue, record_id: out.record_id, contributor: out.contributor, ...(out.replayed ? { replayed: true } : {}) },
    notes: ['Everything in the issue is public by design: the draft, the blind review, the checks and the decision.'],
  };
}

/** Not signed in: the draft is saved for a day and the person is given the link to the form, already filled in. */
function linkAnswer(out: StageOutput, r: DraftReport): Answer {
  return {
    summary: `Your draft meets the basic rules, but nothing is public yet because no one is signed in. Open this link, check that your two files are filled in, and press "Continue with GitHub & Submit": ${out.form_url}`,
    body:
      md.h(1, 'One more step: open the link') +
      `\n${md.link('Open the OpenIslet submission form', out.form_url)}\n\n` +
      'Your draft and your blind review are already filled in. Check them, tick the box that agrees to publish them openly under CC BY 4.0, and press **Continue with GitHub & Submit**. You sign in with GitHub (if you have no account yet you can make one there in a minute, for example with your Google or Apple account), and your Islet Improvement Proposal (IIP) is then posted as a public issue that names you.\n\n' +
      "The link works for 24 hours, and nothing is public until you press the button. Software then checks the format, the Idea Graveyard rules and the quotes straight away, and a person looks the papers up and reviews the science in the weekend review.",
    data: { submitted: false, reason: 'sign_in_needed', form_url: out.form_url, staged_id: out.staged_id, expires_at: out.expires_at, would_be_labelled: r.labels, ...wetlabData(r) },
    notes: ['Give the person the link exactly as it is written. Do not open it for them or press the button for them: the person signs in themselves.'],
  };
}

export async function submitProposal(
  bundle: Bundle,
  cfg: Config,
  input: DraftInput & { idempotency_key?: string; contributor?: unknown },
  ctx: SubmitContext = {},
): Promise<Answer> {
  const r = await runChecks(bundle, cfg, input);
  if (!r.ready) {
    const fails = r.door.filter((d) => d.status === 'fail');
    return {
      summary: `Not submitted. ${fails.length} ${fails.length === 1 ? 'thing needs' : 'things need'} fixing first: ${fails.slice(0, 3).map((f) => f.problem ?? f.name).join('; ')}.`,
      body: md.h(1, 'Not submitted') + '\n' + md.numbered(r.fix),
      data: { submitted: false, reason: 'basic_rules', what_to_fix: r.fix, door: r.door },
      isError: true,
    };
  }
  if (!cfg.submissionsOpen) {
    return {
      summary: 'Your draft meets the basic rules, but the public queue has not opened yet, so nothing was sent or saved. It opens soon, and then the web form on openislet.org will take the same two files (paste or upload them, then sign in with GitHub).',
      body:
        md.h(1, 'Submissions open soon') +
        '\nNothing was stored or sent. Keep your draft and your blind review. When the public queue opens, ask your AI to submit again, or use the web form on openislet.org: either way the public issue names you, verified through GitHub, and software checks its format, the Idea Graveyard rules and its quotes straight away. A person looks the papers up and reviews the science in the weekend review.\n\nWhile you wait you can use check_draft to improve it, and read the open questions to see whether it is already on the list.',
      data: {
        submitted: false,
        reason: 'queue_not_open',
        would_be_labelled: r.labels,
        idempotency_key: input.idempotency_key ?? null,
        ...wetlabData(r),
      },
      notes: ['Every submission is public by design: the draft, the blind review, the checks and the decision.'],
    };
  }
  const queue = ctx.queue;
  if (!queue || !queue.ready(ctx.identity ? 'post' : 'link')) {
    return {
      summary: 'Submissions are marked open, but the queue is not fully set up on this deployment, so nothing was sent or saved.',
      body: `The queue connection (GitHub) is not fully configured on this deployment. Nothing was stored or sent. Please tell the OpenIslet team at ${CONTACT_EMAIL}.`,
      data: { submitted: false, reason: 'queue_not_configured', ...wetlabData(r) },
      isError: true,
    };
  }
  const submission: ToolSubmission = {
    bundle,
    report: r,
    // The file inside what was pasted, so the saved copy and the public issue hold the tidy file the checks read.
    draft: cleanPaste(input.draft ?? '', 'draft').text,
    review: cleanPaste(input.review ?? '', 'review').text,
    ai_tools: input.ai_tools,
    contributor: input.contributor,
    idempotency_key: input.idempotency_key,
    wetlab_empirical_readouts: r.wetlab_empirical_readouts ?? null,
    caller: ctx.caller,
  };
  if (ctx.identity) {
    const posted = await queue.postSignedIn({ ...submission, identity: ctx.identity });
    return posted.ok ? postedAnswer(posted.body) : queueProblem(posted.body, r);
  }
  const staged = await queue.stageForLink(submission);
  return staged.ok ? linkAnswer(staged.body, r) : queueProblem(staged.body, r);
}
