// The Idea Graveyard: ideas that the evidence argues against, or that carry a risk that needs a check. These are checks on paper, not lab results.
//
// The plain-English text lives in graveyard.json. A new entry, whether typed by hand or added by the review
// pipeline, is one more object in that file. An entry with a `source` takes its status, papers and evidence
// label from idea_graveyard_v0.5.json, which `npm run sync-data` copies from the OpenIslet repository, so they
// cannot drift. An entry without a `source` carries its own `level`, `papers` and `confidence`.
import raw from './idea_graveyard_v0.5.json';
import entries from './graveyard.json';

export type Level = 'BLOCK' | 'WARN';

export interface Rule {
  id: string;
  title: string;
  /** "1" to "5", or "manufacturing". */
  tests: string[];
  idea: string;
  why: string;
  check: string;
  instead: string;
  added: string;
  version: string;
  contribution?: string;
  level: Level;
  papers: string[];
  /** How sure we are, in plain words. */
  confidence: string;
  /** What kind of evidence it rests on, in plain words. */
  basis: string;
}

interface Source {
  graveyard_id: string;
  severity_level: Level;
  curation_status: string;
  evidence_basis_class: string;
  supporting_pmids: string[];
}

const confidence = (s: string): string => {
  if (s === 'corroborated') return 'Backed by published work';
  if (s === 'contested_single_study') return 'One study, and it is disputed';
  if (s.startsWith('precautionary')) return 'A precaution, not yet shown';
  if (s.startsWith('conservative_project_exclusion')) return 'A cautious project decision';
  return s.replace(/_/g, ' ');
};

const basis = (s: string): string => {
  if (s === 'direct_islet_empirical') return 'Shown directly in islet cells';
  if (s.startsWith('mechanistic_precaution')) return 'Reasoned from how the biology works';
  if (s === 'project_policy_exclusion') return 'A project policy';
  return s.replace(/_/g, ' ');
};

type Entry = Omit<Rule, 'level' | 'papers' | 'confidence' | 'basis'> & {
  source?: string;
  level?: Level;
  papers?: string[];
  confidence?: string;
  basis?: string;
};

const sources = raw.graveyard_entries as Source[];

export const rules: Rule[] = (entries as Entry[])
  .map((e) => {
    if (!e.source) {
      if (!e.level || !e.papers) throw new Error(`Idea Graveyard entry ${e.id} needs either a "source" or its own "level" and "papers".`);
      return { ...e, level: e.level, papers: e.papers, confidence: e.confidence ?? 'Not yet rated', basis: e.basis ?? '' } as Rule;
    }
    const matches = sources.filter((x) => x.graveyard_id.startsWith(e.source as string));
    if (matches.length !== 1) throw new Error(`graveyard.json entry ${e.id} must resolve to exactly one source rule; ${e.source} matches ${matches.length}. Re-run npm run sync-data.`);
    const s = matches[0];
    return {
      ...e,
      level: s.severity_level,
      papers: s.supporting_pmids,
      confidence: confidence(s.curation_status),
      basis: basis(s.evidence_basis_class),
    } as Rule;
  })
  .sort((a, b) => b.added.localeCompare(a.added) || b.version.localeCompare(a.version) || b.id.localeCompare(a.id));

// Every rule in the repository must have plain-English text on this site.
const covered = new Set((entries as Entry[]).map((e) => e.source).filter(Boolean) as string[]);
for (const s of sources) {
  if (![...covered].some((c) => s.graveyard_id.startsWith(c))) {
    throw new Error(`Idea Graveyard drift: ${s.graveyard_id} is in the repository but has no entry in graveyard.json.`);
  }
}

export const ruleById = (id: string): Rule => {
  const r = rules.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown Idea Graveyard entry ${id}`);
  return r;
};

export const levelLabel = (l: Level): string => (l === 'BLOCK' ? 'Dead end' : 'Risky');
export const levelClass = (l: Level): string => (l === 'BLOCK' ? 'chip chip--block' : 'chip chip--warn');
export const levelMeaning = (l: Level): string =>
  l === 'BLOCK' ? 'A design that includes this idea scores zero.' : 'A design that includes this idea needs a check before anyone relies on it.';

export const blockCount = rules.filter((r) => r.level === 'BLOCK').length;
export const warnCount = rules.filter((r) => r.level === 'WARN').length;

export const testNames: Record<string, string> = {
  '1': 'Test 1 · Insulin response',
  '2': 'Test 2 · Rejection and autoimmunity',
  '3': 'Test 3 · Early immune attack',
  '4': 'Test 4 · Cell stress',
  '5': 'Test 5 · Oxygen and safety',
  manufacturing: 'Making the cells',
};
