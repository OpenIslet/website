// The numbers and words filled into src/content/blueprint-spec.md. The Blueprint page and the connector's data bundle
// both use this, so the specification reads the same in both places and no number is typed twice.
import { release, longDate } from './site';
import { designScore, xAgainstA } from './scenarios';
import { rules } from './graveyard';

const n = (v: number | null | undefined) => typeof v === 'number' && Number.isFinite(v) ? v.toLocaleString('en-US') : 'unavailable';
const c = release.counts;
const a = designScore('A');
const b = designScore('B');
const x = designScore('X');
const xa = xAgainstA();

export const specTokens: Record<string, string> = {
  version: release.version,
  date: longDate(release.date),
  studies: n(c.studies),
  arms: n(c.arms),
  findings: n(c.findings),
  cegScreened: n(c.cegScreened),
  cegStudies: n(c.cegStudies),
  cegArms: n(c.cegArms),
  cegOutcomes: n(c.cegOutcomes),
  cegLinks: n(c.cegLinks),
  designs: n(c.designs),
  feasible: n(c.feasible),
  blocked: n(c.blocked),
  rules: String(c.graveyardRules),
  rulesBlock: String(rules.filter((r) => r.level === 'BLOCK').length),
  rulesWarn: String(rules.filter((r) => r.level === 'WARN').length),
  dnaChanges: n(c.dnaChanges),
  constructs: String(c.constructs),
  structures: String(c.experimentalStructures + c.predictedStructures),
  proteinPairs: String(c.proteinPairs),
  virtualPatients: n(c.virtualPatients),
  assumptions: release.variance.assumptions.toFixed(2),
  overlap: release.variance.overlap.toFixed(2),
  findingsShare: release.variance.findings.toFixed(2),
  editsA: String(a.edits),
  editsB: String(b.edits),
  baseB: String(b.baseEdits),
  weakestA: a.weakestTest,
  weakestB: b.weakestTest,
  rankB: String(b.rank),
  editsX: String(x.edits),
  baseX: String(x.baseEdits),
  weakestX: x.weakestTest,
  rankX: String(x.rank),
  scoreA: a.composite.toFixed(4),
  scoreB: b.composite.toFixed(4),
  scoreX: x.composite.toFixed(4),
  xCompare: xa.sameTests && xa.lowerOverall
    ? 'It matches Design A on every test and sits a little lower overall, because the model charges a small manufacturing penalty for the extra base edit.'
    : 'Its test scores differ from Design A’s (see Table 3), and the model also charges a small manufacturing penalty for the extra base edit.',
};

/** Replaces every {{token}} in the specification. An unknown token is an error, so a typo cannot reach the site. */
export function fillTokens(text: string): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, key: string) => {
    if (!Object.hasOwn(specTokens, key)) throw new Error(`The specification uses ${m}, which is not in specTokens (src/data/specTokens.ts). Add it there.`);
    return specTokens[key];
  });
}
