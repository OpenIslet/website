// Searching the studies and findings: by words, by gene, by test, by what happened, and by year.
import type { Bundle } from './bundle';
import { searchOptions } from './bundle';
import { clip, tidy } from './text';
import type { Direction, Finding, StudyIndexRecord, TargetGenes } from './types';

export interface SearchParams {
  source_scope?: 'empirical' | 'reviews' | 'all';
  query?: string;
  gene?: string;
  test?: string;
  direction?: Direction;
  year_from?: number;
  year_to?: number;
  human_only?: boolean;
  limit?: number;
  offset?: number;
}

export interface BriefFinding {
  id: string;
  tests: string[];
  area: string;
  what_was_changed: string;
  outcome: string;
  direction: Direction;
  genes: string[];
  quote: string | null;
  quote_withheld: boolean;
  span: string;
}

export interface StudyHit {
  pmid: string;
  cite: string;
  title: string;
  year: number;
  journal: string;
  url: string;
  kind: StudyIndexRecord['kind'];
  source_text: string;
  evidence_level: string;
  tests: string[];
  genes: string[];
  findings_total: number;
  matching_findings: BriefFinding[];
}

export interface SearchResult {
  total: number;
  offset: number;
  limit: number;
  next_offset: number | null;
  items: StudyHit[];
  interpretation: string[];
  warnings: string[];
}

export const TESTS = ['1', '2A', '2B', '3', '4', '5'] as const;

/** Best evidence first: a human study in the body counts for more than a rodent study. */
const tierRank = (tier: string): number => Number.parseInt(/^Tier_(\d)/.exec(tier)?.[1] ?? '9', 10);
export const isHumanTier = (tier: string): boolean => tierRank(tier) <= 3;

export function briefFinding(f: Finding): BriefFinding {
  return {
    id: f.id,
    tests: f.tests,
    area: tidy(f.domain),
    what_was_changed: f.factor,
    outcome: clip(f.outcome, 200),
    direction: f.direction,
    genes: f.genes,
    quote: f.quote,
    quote_withheld: f.quote === null,
    span: f.span,
  };
}

export function resolveGene(input: string, genes: TargetGenes): string | null {
  const key = input.trim().toUpperCase().replace(/\s+/g, '');
  if (!key) return null;
  const alias = Object.entries(genes.aliases).find(([a]) => a.toUpperCase() === key);
  const wanted = alias ? alias[1] : key;
  return genes.vocabulary.find((g) => g.toUpperCase() === wanted.toUpperCase()) ?? null;
}

/** "39326417", "PMID:39326417", "PMID 39326417" or a PubMed link. Anything else (a title, say) is not a PubMed ID. */
export function normalisePmid(input: string): string | null {
  const text = input.trim();
  const direct = /^(?:pmid\s*[:#]?\s*)?(\d{1,9})$/i.exec(text);
  if (direct) return direct[1];
  try {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol) || url.hostname !== 'pubmed.ncbi.nlm.nih.gov' || url.username || url.password || url.port) return null;
    return /^\/(\d{1,9})\/?$/.exec(url.pathname)?.[1] ?? null;
  } catch { return null; }

}

export async function searchStudies(bundle: Bundle, p: SearchParams): Promise<SearchResult> {
  const [index, byPmid, genes, search] = await Promise.all([bundle.studyIndex(), bundle.findingsByPmid(), bundle.targetGenes(), bundle.search()]);
  const limit = Math.min(Math.max(p.limit ?? 10, 1), 25);
  const offset = Math.max(p.offset ?? 0, 0);
  const warnings: string[] = [];
  const interpretation: string[] = [];

  let text = (p.query ?? '').trim();
  let gene: string | null = null;
  if (p.gene?.trim()) {
    gene = resolveGene(p.gene, genes);
    if (gene) interpretation.push(`Only findings that name ${gene}.`);
    else {
      text = `${text} ${p.gene}`.trim();
      warnings.push(`"${p.gene}" is not one of the ${genes.vocabulary.length} genes the project tags, so it was searched for as ordinary text.`);
    }
  }
  if (p.test) interpretation.push(`Only findings that bear on Test ${p.test}.`);
  if (p.direction) interpretation.push(`Only findings where the change ${p.direction === 'protective' ? 'improved' : p.direction === 'deleterious' ? 'impaired' : 'made no clear difference to'} the outcome.`);
  if (p.human_only) interpretation.push('Only studies using human cells or people.');
  if (p.year_from || p.year_to) interpretation.push(`Published ${p.year_from ?? 'any year'} to ${p.year_to ?? 'now'}.`);

  const findingFilters = Boolean(gene || p.test || p.direction);
  const findingOk = (f: Finding) =>
    (!gene || f.genes.includes(gene)) && (!p.test || f.tests.includes(p.test)) && (!p.direction || f.direction === p.direction);
  const scope = p.source_scope ?? 'empirical';
  interpretation.push(scope === 'empirical' ? 'Primary empirical studies only; reviews, project summaries and superseded preprints are excluded.' : scope === 'reviews' ? 'Reviews and commentaries only, for context rather than primary empirical evidence.' : 'All bibliographic source classes; reviews, summaries and superseded preprints carry no primary empirical evidence weight.');
  const studyOk = (s: StudyIndexRecord) =>
    (scope === 'all' || (scope === 'reviews' ? s.kind === 'review_or_commentary' : s.kind === 'study')) &&
    (p.year_from === undefined || s.year >= p.year_from) && (p.year_to === undefined || s.year <= p.year_to) && (!p.human_only || isHumanTier(s.tier));

  const studyMap = await bundle.studyByPmid();
  const findingById = await bundle.findingsById();
  const scores = new Map<string, { study: number; findings: { id: string; score: number }[] }>();
  const slot = (pmid: string) => scores.get(pmid) ?? scores.set(pmid, { study: 0, findings: [] }).get(pmid)!;

  if (text) {
    interpretation.unshift(`Matched the words "${text}".`);
    let hits = search.search(text, { ...searchOptions, combineWith: 'AND' });
    if (hits.length < 5) {
      const loose = search.search(text, { ...searchOptions, combineWith: 'OR' });
      if (loose.length > hits.length) {
        hits = loose;
        interpretation.push('Few studies matched every word, so studies matching some of the words are included, best matches first.');
      }
    }
    // Every hit counts (there are at most a few thousand), so the total and the later pages are right.
    for (const h of hits) {
      const id = String(h.id);
      if (id.startsWith('S:')) slot(id.slice(2)).study = h.score;
      else {
        // The study comes from the finding itself: not every finding id starts with its PubMed ID.
        const pmid = findingById.get(id.slice(2))?.pmid;
        if (pmid) slot(pmid).findings.push({ id: id.slice(2), score: h.score });
      }
    }
  } else {
    for (const s of index) slot(s.pmid);
  }
  const ranked: { pmid: string; score: number; matches: Finding[] }[] = [];
  for (const [pmid, s] of scores) {
    const study = studyMap.get(pmid);
    if (!study || !studyOk(study)) continue;
    const own = byPmid.get(pmid) ?? [];
    let matches: Finding[];
    if (text) {
      const hitFindings = s.findings
        .sort((a, b) => b.score - a.score)
        .map((h) => findingById.get(h.id))
        .filter((f): f is Finding => Boolean(f) && findingOk(f as Finding));
      matches = hitFindings;
      if (!matches.length && s.study > 0) matches = own.filter(findingOk);
      if (findingFilters && !matches.length) continue;
      if (!matches.length && s.study === 0) continue;
    } else {
      matches = own.filter(findingOk);
      if (findingFilters && !matches.length) continue;
    }
    const top = s.findings.length ? Math.max(...s.findings.map((f) => f.score)) : 0;
    const extra = s.findings
      .map((f) => f.score)
      .sort((a, b) => b - a)
      .slice(1, 3)
      .reduce((n, v) => n + v, 0);
    const score = text ? Math.max(s.study, top) + 0.3 * extra : matches.length;
    ranked.push({ pmid, score, matches });
  }
  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ta = tierRank(studyMap.get(a.pmid)!.tier);
    const tb = tierRank(studyMap.get(b.pmid)!.tier);
    return ta - tb || studyMap.get(b.pmid)!.year - studyMap.get(a.pmid)!.year || Number(a.pmid) - Number(b.pmid);
  });

  const page = ranked.slice(offset, offset + limit);
  const items: StudyHit[] = page.map(({ pmid, matches }) => {
    const s = studyMap.get(pmid)!;
    const informative = [...matches].sort((a, b) => Number(b.direction !== 'neutral') - Number(a.direction !== 'neutral'));
    return {
      pmid,
      cite: `${s.first_author} ${s.year}`,
      title: s.title,
      year: s.year,
      journal: s.journal,
      url: s.url,
      kind: s.kind,
      source_text: s.source_text,
      evidence_level: s.tier_plain,
      tests: s.tests,
      genes: s.genes,
      findings_total: s.findings,
      matching_findings: informative.slice(0, 3).map(briefFinding),
    };
  });
  const next = offset + limit < ranked.length ? offset + limit : null;
  return { total: ranked.length, offset, limit, next_offset: next, items, interpretation, warnings };
}
