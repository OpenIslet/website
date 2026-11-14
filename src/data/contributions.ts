// The contributions record. Every IIP the weekly review has looked at is one record in contributions.json, which the
// review adds to. The Contributions page groups the records by contributor.
//
// There are no scores. A person decides what each IIP did (its outcome) and says it in one sentence. Credit then grows in
// two ways: the IIPs that improved the blueprint are named in the version they helped shape, and later events (a later IIP
// built on it, a lab tested it) are added as follow-ups.
import raw from './contributions.json';
import { fillTokens } from './specTokens';

/** Where an IIP is in the public process. */
export type Status = 'queued' | 'reviewed' | 'needs-work' | 'merged' | 'declined' | 'withdrawn' | 'closed-triage';

export type OutcomeKind = 'changed_blueprint' | 'dead_end' | 'evidence' | 'open_question' | 'later' | 'not_taken_up' | 'already_covered';

/**
 * What an IIP can do, in the order the page lists them. The credited ones are named in the next locked version: everyone whose
 * IIP had one of them while that version was the open draft, even if a later IIP changed the same thing again.
 */
export const outcomes: Record<OutcomeKind, { label: string; meaning: string; credited: boolean; why: string }> = {
  changed_blueprint: { label: 'Changed the blueprint', meaning: 'A design, test, number or sentence changed because of it.', credited: true, why: 'What it changed' },
  dead_end: { label: 'Ruled out a dead end', meaning: 'Showed that part of the blueprint will not work. Now in the Idea Graveyard.', credited: true, why: 'What it changed' },
  evidence: { label: 'Added evidence', meaning: 'New papers or data that the blueprint now rests on.', credited: true, why: 'What it changed' },
  open_question: { label: 'Raised an open question', meaning: 'A gap that only a lab test can settle, now on the list.', credited: true, why: 'What it changed' },
  later: { label: 'Kept for later', meaning: 'Sound, but it needs something first. Looked at again every three months.', credited: false, why: 'What it needs first' },
  not_taken_up: { label: 'Not taken up', meaning: 'Reviewed and not used, with the reason.', credited: false, why: 'Why not' },
  already_covered: { label: 'Already covered', meaning: 'The blueprint or an earlier IIP already had it.', credited: false, why: 'Where it was already' },
};
export const outcomeKinds = Object.keys(outcomes) as OutcomeKind[];
/**
 * Outcomes that are not listed beside a contributor's name on the closed row, and are not offered in the Outcome filter.
 * Each one still shows, with its reason, on the IIP itself once the row is opened, and on GitHub.
 */
export const quietOutcomes: OutcomeKind[] = ['not_taken_up', 'already_covered'];

export interface Outcome {
  kind: OutcomeKind;
  /** One plain sentence by the person who decided: what it changed, or why not. */
  note: string;
  /** A link to where it landed on this site: a blueprint section, an Idea Graveyard entry or an open question. */
  where?: string | null;
  /** Other IIPs credited for the same change (sent in the same week). */
  with?: string[];
  /** For "Already covered": the IIP that had it first, when there is one. */
  same_as?: string | null;
  /** Set when a version is locked: one of the changes that mattered most in it. */
  key_change?: boolean;
}

/** Something that happened later: a later IIP built on it, a lab tested it, or its outcome was changed (with the reason). */
export interface FollowUp {
  date: string | null;
  note: string;
  ref?: string | null;
}

export interface Contribution {
  id: string;
  /** When it was sent. */
  date: string | null;
  /** When a person decided its outcome, if not the same day. */
  decided?: string | null;
  title: string;
  summary: string;
  type: string;
  status: Status;
  /** The blueprint release the founding record is. */
  version?: string;
  /** The locked version that names it, once that version is locked. */
  landed_in?: string | null;
  founding?: boolean;
  /** Layout example, shown only when PUBLIC_SHOW_SAMPLE_LEADERBOARDS is "true". Never real. */
  example?: boolean;
  contributor: {
    handle: string;
    kind: 'person' | 'lab';
    github?: string;
    /** Typed in by the contributor on the submission form. Shown as stated, except an ORCID iD with `verified.orcid` (verified through ORCID since 4 Nov 2026). */
    name?: string | null;
    orcid?: string | null;
    x?: string | null;
    verified: { github: boolean; orcid: boolean };
  };
  /** Model names are what the contributor reported. They are never shown as verified. */
  models: string[];
  /** Null until a person has decided. */
  outcome: Outcome | null;
  follow_ups?: FollowUp[];
}

// Off unless asked for, so a launch build can never show them by mistake.
export const showExamples = import.meta.env.PUBLIC_SHOW_SAMPLE_LEADERBOARDS === 'true';

const examples: Contribution[] = [
  {
    id: 'IIP-EXAMPLE-1',
    date: null,
    title: 'Example: a paper on how common the HLA-E peptide variants are',
    summary: 'An example of an IIP that fills a gap in the evidence and changes one design choice.',
    type: 'Missing evidence',
    status: 'merged',
    example: true,
    contributor: { handle: 'example-researcher', kind: 'person', name: 'Example Researcher', orcid: '0000-0002-1825-0097', verified: { github: true, orcid: false } },
    models: ['Example model (High Effort)'],
    outcome: { kind: 'changed_blueprint', note: 'Example: Design A now uses the more common HLA-E variant.' },
    follow_ups: [{ date: null, note: 'Example: a later IIP built on it.' }],
  },
  {
    id: 'IIP-EXAMPLE-2',
    date: null,
    title: 'Example: a dead end added to the Idea Graveyard',
    summary: 'An example of an IIP that shows part of the blueprint will not work.',
    type: 'Problem found',
    status: 'merged',
    example: true,
    contributor: { handle: 'example-ai-lab', kind: 'lab', x: 'example_lab', verified: { github: true, orcid: false } },
    models: ['Unreleased model'],
    outcome: { kind: 'dead_end', note: 'Example: the designs no longer use it, and it is in the Idea Graveyard so nobody tries it again.' },
  },
  {
    id: 'IIP-EXAMPLE-3',
    date: null,
    title: 'Example: a stress-test of the oxygen model',
    summary: 'An example of an IIP that is still being reviewed.',
    type: 'Problem found',
    status: 'queued',
    example: true,
    contributor: { handle: 'example-researcher', kind: 'person', name: 'Example Researcher', orcid: '0000-0002-1825-0097', verified: { github: true, orcid: false } },
    models: ['Example model (Max Effort)'],
    outcome: null,
  },
  {
    id: 'IIP-EXAMPLE-4',
    date: null,
    title: 'Example: an IIP that repeated an earlier one',
    summary: 'An example of an IIP that made a point the blueprint already had. It stays public, with the reason.',
    type: 'Problem found',
    status: 'declined',
    example: true,
    contributor: { handle: 'example-newcomer', kind: 'person', verified: { github: true, orcid: false } },
    models: ['Example model'],
    outcome: { kind: 'already_covered', note: 'Example: the Idea Graveyard already had this idea.', same_as: 'IIP-EXAMPLE-2' },
  },
];

// The numbers in a summary are written as {{tokens}} and filled from the release data, so they never go stale.
// An IIP set aside in the review with no outcome (spam, or off topic) stays on GitHub with its reason, but is not shown here.
const ledger = [...(raw as Contribution[]).map((c) => ({ ...c, summary: fillTokens(c.summary) })), ...(showExamples ? examples : [])].filter(
  (c) => !(c.status === 'closed-triage' && !c.outcome),
);

/** What the page shows for an IIP: its outcome once a person has decided, otherwise where it stands. */
export interface Standing {
  key: OutcomeKind | 'founding' | 'waiting' | 'needs-work' | 'withdrawn';
  label: string;
  chip: string;
}
export function standingOf(c: Contribution): Standing {
  if (c.founding) return { key: 'founding', label: 'Founding blueprint', chip: 'chip chip--ink' };
  if (c.outcome) {
    const o = outcomes[c.outcome.kind];
    return { key: c.outcome.kind, label: o.label, chip: o.credited ? 'chip chip--pass' : c.outcome.kind === 'later' ? 'chip' : 'chip chip--quiet' };
  }
  if (c.status === 'needs-work') return { key: 'needs-work', label: 'Needs work', chip: 'chip' };
  if (c.status === 'withdrawn') return { key: 'withdrawn', label: 'Withdrawn', chip: 'chip chip--quiet' };
  return { key: 'waiting', label: 'Waiting for review', chip: 'chip' };
}
/** The order standings are listed in: the founding record, the credited outcomes, then the rest. */
export const standingOrder: Standing['key'][] = ['founding', ...outcomeKinds, 'waiting', 'needs-work', 'withdrawn'];

export interface Contributor {
  handle: string;
  kind: 'person' | 'lab';
  /** Display name, ORCID iD and X handle exactly as the contributor typed them. None of them is checked. */
  stated: { name: string | null; orcid: string | null; x: string | null };
  verified: { github: boolean; orcid: boolean };
  example: boolean;
  founding: boolean;
  contributions: Contribution[];
  /** What their IIPs did, in words, with how many of each: no score and no rank. */
  did: { key: Standing['key']; label: string; n: number }[];
  last: string | null;
  models: string[];
}

export const contributors: Contributor[] = Object.values(
  ledger.reduce<Record<string, Contribution[]>>((by, c) => {
    (by[c.contributor.handle] ??= []).push(c);
    return by;
  }, Object.create(null)),
).map((list) => {
  const sorted = [...list].sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));
  const did = new Map<Standing['key'], { key: Standing['key']; label: string; n: number }>();
  for (const c of list) {
    const s = standingOf(c);
    const seen = did.get(s.key);
    if (seen) seen.n++;
    else did.set(s.key, { key: s.key, label: s.label, n: 1 });
  }
  return {
    handle: list[0].contributor.handle,
    kind: list[0].contributor.kind,
    stated: {
      name: list.find((c) => c.contributor.name)?.contributor.name ?? null,
      orcid: list.find((c) => c.contributor.orcid)?.contributor.orcid ?? null,
      x: list.find((c) => c.contributor.x)?.contributor.x ?? null,
    },
    verified: list[0].contributor.verified,
    example: list.every((c) => c.example),
    founding: list.some((c) => c.founding),
    contributions: sorted,
    did: [...did.values()].sort((a, b) => standingOrder.indexOf(a.key) - standingOrder.indexOf(b.key)),
    last: sorted.find((c) => c.date)?.date ?? null,
    models: [...new Set(list.flatMap((c) => c.models))],
  };
});

/** The standings that occur on the page, in order, for the filter. */
export const standingsShown = standingOrder.filter((key) => key !== 'founding' && ledger.some((c) => standingOf(c).key === key));

export const realCount = ledger.filter((c) => !c.example).length;
