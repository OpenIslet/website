// One study's record, and the findings for and against a gene.
import type { Bundle } from './bundle';
import { type BriefFinding, briefFinding, isHumanTier, normalisePmid, resolveGene, searchStudies } from './search';
import { clip, tidy } from './text';
import type { Direction, Finding, Tradeoff } from './types';

export const directionWords: Record<Direction, string> = {
  protective: 'improved the outcome',
  deleterious: 'impaired the outcome',
  neutral: 'made no clear difference',
};

export interface FullFinding {
  id: string;
  tests: string[];
  what_was_changed: string;
  compared_with: string;
  outcome: string;
  area: string;
  result: string;
  direction: Direction;
  quote: string | null;
  quote_withheld: boolean;
  quote_sha256: string | null;
  location_in_paper: string;
  statistics: Record<string, string | number>;
}

function fullFinding(f: Finding): FullFinding {
  const stats: Record<string, string | number> = {};
  const s = f.stat;
  if (s.unit && s.unit !== 'qualitative_statement') stats.unit = tidy(s.unit);
  if (s.treatment_mean !== null) stats.treatment_mean = s.treatment_mean;
  if (s.control_mean !== null) stats.control_mean = s.control_mean;
  if (s.treatment_n !== null) stats.treatment_n = s.treatment_n;
  if (s.control_n !== null) stats.control_n = s.control_n;
  if (s.p !== null) stats.p_value = s.p;
  if (s.p_relation != null && s.p_bound != null) {
    stats.p_value_relation = s.p_relation;
    stats.p_value_bound = s.p_bound;
  }
  if (s.effect !== null) stats.effect_size = s.effect;
  return {
    id: f.id,
    tests: f.tests,
    what_was_changed: f.factor,
    compared_with: f.comparator,
    outcome: f.outcome,
    area: tidy(f.domain),
    result: directionWords[f.direction],
    direction: f.direction,
    quote: f.quote,
    quote_withheld: f.quote === null,
    quote_sha256: f.quote_sha256,
    location_in_paper: f.table ? `${f.table}, ${f.span}` : f.span,
    statistics: stats,
  };
}

/** Defence in depth: whatever the bundle holds, never show more than the per-paper ceiling of verbatim characters. */
export function applyQuoteCeiling(findings: FullFinding[], ceiling: number): FullFinding[] {
  const allowed = Number.isSafeInteger(ceiling) && ceiling >= 0 ? Math.min(ceiling, 240) : 0;
  let used = 0;
  return findings.map((f) => {
    if (f.quote === null) return f;
    if (used + f.quote.length <= allowed) {
      used += f.quote.length;
      return f;
    }
    return { ...f, quote: null, quote_withheld: true };
  });
}

export interface StudyAnswer {
  found: true;
  pmid: string;
  cite: string;
  title: string;
  authors: { first: string; senior: string };
  year: number;
  journal: string;
  doi: string | null;
  pmcid: string | null;
  url: string;
  kind: string;
  source_text: string;
  evidence_level: string;
  areas: string[];
  tests: string[];
  genes: string[];
  arms: {
    id: string;
    label: string;
    is_control: boolean;
    sample_size: string | null;
    cells: string;
    stage: string;
    edits: { gene: string; change: string; zygosity: string | null; purpose: string }[];
    site: string | null;
  }[];
  findings: FullFinding[];
  mechanism: { from: string; relation: string; to: string }[];
  notes: string[];
}

export interface StudyNotFound {
  found: false;
  asked: string;
  suggestions: { pmid: string; cite: string; title: string }[];
}

export async function getStudy(bundle: Bundle, input: string): Promise<StudyAnswer | StudyNotFound> {
  const pmid = normalisePmid(input);
  const [index, meta] = await Promise.all([bundle.studyByPmid(), bundle.meta()]);
  const entry = pmid ? index.get(pmid) : undefined;
  const file = pmid && entry ? await bundle.study(pmid) : null;
  if (!pmid || !entry || !file) {
    const hits = await searchStudies(bundle, { query: pmid ? '' : input, limit: 3 });
    return {
      found: false,
      asked: input,
      suggestions: pmid ? [] : hits.items.map((h) => ({ pmid: h.pmid, cite: h.cite, title: h.title })),
    };
  }
  const own = (await bundle.findingsByPmid()).get(pmid) ?? [];
  const findings = applyQuoteCeiling(own.map(fullFinding), meta.quote_policy.per_paper_verbatim_ceiling_characters);
  const arms = (file.arms ?? []).map((a: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: a.arm_id,
    label: a.arm_label,
    is_control: Boolean(a.is_reference_control),
    sample_size: a.sample_size_n ? `${a.sample_size_n}${a.sample_size_unit ? ` ${tidy(a.sample_size_unit)}` : ''}` : null,
    cells: tidy(a.gate1_substrate_and_differentiation?.cell_source_class ?? 'not stated'),
    stage: tidy(a.gate1_substrate_and_differentiation?.canonical_differentiation_stage_evaluated ?? 'not stated'),
    edits: (a.gate2_3_4_genetic_and_epitope_edits ?? []).map((e: Record<string, any>) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
      gene: e.gene_symbol_hgnc,
      change: tidy(e.edit_modality ?? ''),
      zygosity: e.zygosity_or_allelic_state ? tidy(e.zygosity_or_allelic_state) : null,
      purpose: tidy(e.functional_gate ?? ''),
    })),
    site: a.gate5_engraftment_niche?.transplant_site ? tidy(a.gate5_engraftment_niche.transplant_site) : null,
  }));
  const mechanism = (file.causal_mechanism_edges ?? []).slice(0, 12).map((e: Record<string, string>) => ({
    from: tidy(e.upstream_node),
    relation: tidy(e.causal_relation),
    to: tidy(e.downstream_node),
  }));
  const notes: string[] = [];
  if (entry.kind === 'project_summary') notes.push("This record is the project's own summary, not a published study, and it carries no weight in the evidence.");
  if (entry.kind === 'superseded_preprint') notes.push('This is a preprint that was replaced by the published paper, and it carries no weight in the evidence.');
  if (entry.kind === 'review_or_commentary') notes.push('This is a review or commentary. It is retained for context and carries no primary empirical evidence weight.');
  if (entry.source_text_type === 'Abstract_Only') notes.push('Only the abstract of this paper was read.');
  const withheld = findings.filter((f) => f.quote_withheld).length;
  if (withheld) {
    notes.push(
      `${withheld} of ${findings.length} exact sentences are not republished, to respect the publishers' copyright (at most ${meta.quote_policy.per_paper_verbatim_ceiling_characters} characters per paper are shown). Each keeps its location in the paper and a SHA-256 fingerprint of the sentence, so a quote can be checked against it. Read the paper at ${entry.url}.`,
    );
  }
  return {
    found: true,
    pmid,
    cite: `${entry.first_author} ${entry.year}`,
    title: entry.title,
    authors: { first: entry.first_author, senior: entry.senior_author },
    year: entry.year,
    journal: entry.journal,
    doi: entry.doi,
    pmcid: entry.pmcid,
    url: entry.url,
    kind: entry.kind,
    source_text: entry.source_text,
    evidence_level: entry.tier_plain,
    areas: entry.areas,
    tests: entry.tests,
    genes: entry.genes,
    arms,
    findings,
    mechanism,
    notes,
  };
}

// ---------------------------------------------------------------------------------------------------------------

export interface EvidenceItem extends BriefFinding {
  pmid: string;
  cite: string;
  year: number;
  evidence_level: string;
}

export interface ConflictAnswer {
  found: boolean;
  asked: string;
  gene: string | null;
  suggestions: string[];
  studies_in_graph: number;
  gates: string[];
  counts: { improved: number; impaired: number; no_clear_effect: number; total: number; studies: number };
  improved: EvidenceItem[];
  impaired: EvidenceItem[];
  disagree: boolean;
  tradeoffs: Tradeoff[];
  shown_per_side: number;
}

const tierOf = (tier: string): number => Number.parseInt(/^Tier_(\d)/.exec(tier)?.[1] ?? '9', 10);

export async function conflictingEvidence(bundle: Bundle, geneInput: string, perSide = 6): Promise<ConflictAnswer> {
  const [genes, findings, byPmid, tradeoffs] = await Promise.all([bundle.targetGenes(), bundle.findings(), bundle.studyByPmid(), bundle.tradeoffs()]);
  const gene = resolveGene(geneInput, genes);
  if (!gene) {
    const key = geneInput.trim().toUpperCase();
    const suggestions = genes.vocabulary.filter((g) => g.startsWith(key.slice(0, 2)) || g.includes(key)).slice(0, 8);
    return {
      found: false,
      asked: geneInput,
      gene: null,
      suggestions: suggestions.length ? suggestions : genes.vocabulary.slice(0, 12),
      studies_in_graph: 0,
      gates: [],
      counts: { improved: 0, impaired: 0, no_clear_effect: 0, total: 0, studies: 0 },
      improved: [],
      impaired: [],
      disagree: false,
      tradeoffs: [],
      shown_per_side: perSide,
    };
  }
  // Project summaries and superseded preprints carry no weight in the evidence, so they are left out.
  const named = findings.filter((f) => f.genes.includes(gene) && byPmid.get(f.pmid)?.kind === 'study');
  const order = (a: Finding, b: Finding) => tierOf(a.tier) - tierOf(b.tier) || (byPmid.get(b.pmid)?.year ?? 0) - (byPmid.get(a.pmid)?.year ?? 0) || a.id.localeCompare(b.id);
  const item = (f: Finding): EvidenceItem => ({
    ...briefFinding(f),
    pmid: f.pmid,
    cite: f.cite,
    year: byPmid.get(f.pmid)?.year ?? 0,
    evidence_level: byPmid.get(f.pmid)?.tier_plain ?? '',
  });
  const improved = named.filter((f) => f.direction === 'protective').sort(order);
  const impaired = named.filter((f) => f.direction === 'deleterious').sort(order);
  const pmids = new Set(named.map((f) => f.pmid));
  const atlas = genes.genes[gene];
  const studyIds = new Set([...pmids, ...(atlas?.studies.map((s) => s.pmid).filter((p): p is string => Boolean(p)) ?? [])]);
  return {
    found: true,
    asked: geneInput,
    gene,
    suggestions: [],
    studies_in_graph: atlas?.studies_count ?? 0,
    gates: atlas?.gates ?? [],
    counts: {
      improved: improved.length,
      impaired: impaired.length,
      no_clear_effect: named.length - improved.length - impaired.length,
      total: named.length,
      studies: pmids.size,
    },
    improved: improved.slice(0, perSide).map(item),
    impaired: impaired.slice(0, perSide).map(item),
    disagree: improved.length > 0 && impaired.length > 0,
    tradeoffs: tradeoffs.filter((t) => t.pmid && studyIds.has(t.pmid)),
    shown_per_side: perSide,
  };
}

export function oneLineStudy(s: { cite: string; title: string; pmid: string }): string {
  return `${s.cite}: ${clip(s.title, 110)} (PMID ${s.pmid})`;
}

export { isHumanTier };
