// The shapes of the files in a data bundle (see scripts/build-bundle.mjs, which writes them).

export interface BundleFile {
  path: string;
  bytes: number;
  sha256: string;
}

export interface Meta {
  schema: string;
  id: string;
  name: string;
  family: string;
  frozen: boolean;
  doi: string | null;
  blueprint_release: string;
  release_date: string;
  fingerprint: string;
  counts: {
    studies: number;
    arms: number;
    findings: number;
    designs: number;
    feasible: number;
    blocked: number;
    graveyard_rules: number;
    open_questions: number;
    genes: number;
  };
  licence: { summary: string; credit: string };
  quote_policy: {
    per_paper_verbatim_ceiling_characters: number;
    withheld_quotes: number;
    shown_quotes: number;
    note: string;
    guard: {
      description: string;
      withheld: { outcome_wording: number; modifier_conditions: number; variant_descriptions: number; residual_wording: number };
      verified_against_source_texts: boolean;
      source_texts_checked: number;
    };
  };
  mapping: { tests_from_outcome_domain: Record<string, string[]>; tiers: Record<string, string>; note: string };
  source: Record<string, unknown>;
  optional_missing: string[];
  files: BundleFile[];
}

export type Direction = 'protective' | 'deleterious' | 'neutral';

export interface StudyIndexRecord {
  pmid: string;
  title: string;
  first_author: string;
  senior_author: string;
  year: number;
  journal: string;
  doi: string | null;
  pmcid: string | null;
  kind: 'study' | 'superseded_preprint' | 'project_summary' | 'review_or_commentary';
  source_text: string;
  source_text_type: string;
  tier: string;
  tier_plain: string;
  areas: string[];
  arms: number;
  findings: number;
  tests: string[];
  genes: string[];
  directions: Record<Direction, number>;
  url: string;
}

export interface Finding {
  id: string;
  pmid: string;
  cite: string;
  factor: string;
  comparator: string;
  outcome: string;
  domain: string;
  tests: string[];
  direction: Direction;
  penalty: boolean;
  /** The exact sentence, only where the bundle may show it. Otherwise null. */
  quote: string | null;
  /** SHA-256 of the original sentence, kept where the quote is withheld. */
  quote_sha256: string | null;
  span: string;
  table: string | null;
  stat: {
    type: string;
    unit: string | null;
    p: number | null;
    p_relation?: string | null;
    p_bound?: number | null;
    effect: number | null;
    treatment_mean: number | null;
    control_mean: number | null;
    treatment_n: number | null;
    control_n: number | null;
  };
  tier: string;
  genes: string[];
}

export interface TargetGenes {
  genes: Record<string, { studies_count: number; gates: string[]; studies: { pmid: string | null; cite: string | null }[] }>;
  vocabulary: string[];
  aliases: Record<string, string>;
}

export interface Tradeoff {
  pmid: string | null;
  cite: string | null;
  primary: string;
  secondary: string;
  kind: 'trade-off' | 'synergy';
  observation: string | null;
  observation_sha256: string | null;
}

export type Level = 'BLOCK' | 'WARN';

export interface GraveyardRule {
  id: string;
  graveyard_id: string | null;
  title: string;
  level: Level;
  level_plain: string;
  tests: string[];
  idea: string;
  why: string;
  check: string;
  instead: string;
  confidence: string;
  basis: string;
  papers: string[];
  added: string;
  version: string;
  contribution: string | null;
  trigger_modules: string[];
  trigger_condition: string | null;
  cheapest_falsification_assay: string | null;
}

export interface GraveyardEntry {
  graveyard_id: string;
  severity_level: Level;
  curation_status: string;
  trigger_pattern?: { requires_any_module?: string[]; condition?: string };
  [key: string]: unknown;
}

export interface ModuleSpec {
  axis: string;
  label: string;
  cuts: number;
  base_edits: number;
  genes: string[];
  description: string;
}

export interface ModulesFile {
  axes: Record<string, { name: string; modules: string[] }>;
  modules: Record<string, ModuleSpec>;
}

export interface OpenQuestion {
  id: string;
  title: string;
  plain: string;
  detail: string;
  tests: string[];
  designs: string[];
  rules: string[];
  pmids: string[];
  settle: string;
  source: string;
  status: string;
  added: string;
  since: string;
}

export interface LedgerRecord {
  id: string;
  issue: { number: number; url: string };
  title: string;
  summary?: string;
  type: string;
  status: string;
  submitted_at: string;
  decided_at: string | null;
  target_version: string;
  landed_in: string | null;
  founding?: boolean;
  contributor: {
    handle: string;
    kind: 'person' | 'lab';
    github: string | null;
    orcid: string | null;
    verified: { github: boolean; orcid: boolean };
  };
  ai_tools?: { draft?: string; review?: string };
  models?: string[];
  /** What a person decided the IIP did, in words. Null until then. There are no scores. */
  outcome?: {
    kind: string;
    note: string;
    where?: string | null;
    with?: string[];
    same_as?: string | null;
    key_change?: boolean;
  } | null;
  follow_ups?: { date: string | null; note: string; ref?: string | null }[];
}

export interface LedgerFile {
  /** The outcomes in plain words, from the website (src/data/contributions.ts). Older bundles do not have it. */
  outcomes?: Record<string, { label: string; meaning: string; credited: boolean; why: string }>;
  records: LedgerRecord[];
}

export interface VersionsFile {
  family: string;
  explainer: Record<'family' | 'draft' | 'lock' | 'patch' | 'next', string>;
  /** Why a new version every three months: the plan is not set in stone. */
  cadence: string;
  draft: {
    id: string;
    name: string;
    status: string;
    frozen: boolean;
    doi: string | null;
    opens: string;
    release_when_it_opens: string;
    blueprint_release_in_this_bundle: string;
  };
  locked: { id: string; name: string; lock_date: string; frozen: true; doi: string | null; summary?: string }[];
  planned: { id: string; name: string; status: string; freeze_from: string; lock_date: string; frozen: false; doi: null }[];
  history: { version: string; date: string; title: string; summary: string; contribution: string | null; changes: { kind: string; text: string }[] }[];
}

export interface PromptStructure {
  draft: { title: string; fields: { name: string; options: string[] | null }[]; headings: string[] };
  review: { title: string; fields: { name: string; options: string[] | null }[]; headings: string[] };
  consent: string;
  accepted_review_verdicts: string[];
}
