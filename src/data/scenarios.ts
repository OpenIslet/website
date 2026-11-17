// Model scores, read from release.json (written by `npm run sync-data` from the OpenIslet repository).
// They are estimates on a 0 to 1 scale, not clinical survival probabilities.
import { release, showScenarioIndices } from './site';
import { testShort } from './gates';

const labels: Record<string, { name: string; sub: (edits: number, baseEdits: number) => string; reference: boolean }> = {
  A: { name: 'Design A', sub: (k) => `${k} gene edits`, reference: false },
  X: { name: 'Design X', sub: (k, b) => `${k} gene edits, ${b} base edit`, reference: false },
  B: { name: 'Design B', sub: (k, b) => `${k} gene edits, ${b} base edit`, reference: false },
  UP421: { name: 'Sana UP421 design', sub: (k) => `reference · ${k} gene edits`, reference: true },
  VCTX210: { name: 'VCTX210', sub: (k) => `reference · ${k} gene edits`, reference: true },
  VX264: { name: 'VX-264', sub: () => 'reference · no edits, in a device', reference: true },
};

/** Score for children with type 1 diabetes, one row per design, best first. */
export const indices = release.designs.map((d) => ({
  id: d.id,
  name: labels[d.id].name,
  sub: labels[d.id].sub(d.edits, d.baseEdits),
  value: d.children,
  rank: d.rank,
  weakestTest: d.weakestTest,
  reference: labels[d.id].reference,
}));

export const maxIndex = Math.max(...indices.map((i) => i.value));

/** Share of the total spread in scores across all the designs. */
export const variance = [
  { label: 'starting assumptions', pct: release.variance.assumptions },
  { label: 'overlap of the two', pct: release.variance.overlap },
  { label: 'published findings', pct: release.variance.findings },
];

export const designScore = (id: 'A' | 'B' | 'X') => release.designs.find((d) => d.id === id)!;

/**
 * How Design X compares with Design A, worked out from the scores so the words cannot go stale. Right now X matches A on every test
 * and is a little lower overall, because the extra base edit carries a manufacturing penalty.
 */
export function xAgainstA(): { sameTests: boolean; lowerOverall: boolean } {
  const a = designScore('A');
  const x = designScore('X');
  const sameTests = Object.entries(a.tests).every(([test, value]) => (x.tests as Record<string, number>)[test] === value);
  return { sameTests, lowerOverall: x.composite < a.composite };
}

/** Table 3's caption, the same on the Blueprint page and in the Markdown copies. */
export const scoresCaption =
  'Model scores, 0 to 1, for comparing designs with each other. They are not the chance that a treatment will work for you or your child. Reference designs are published approaches scored the same way, with the same unproven assumptions; this says nothing about how they perform in people.';

const steppingStoneIds = new Set([
  'UP421_NAKED_REFERENCE',
  'MINIMAL_HIP_NAKED_PLUS_SWITCH',
  'MINIMAL_HIP_NICHE_NO_SWITCH',
  'MINIMAL_HIP_NICHE_PLUS_SWITCH',
  'DESIGN_A_CLOAK_ONLY_3LOCUS',
  'MINIMAL_HIP_PLUS_CXCL10_5LOCUS',
  'DESIGN_A_LEAD_4LOCUS',
]);

/** Controlled one-step-at-a-time bridge from Sana UP421 (#246) through minimal HIP in our setting (#45) to Design A (#1). */
export const steppingStones = (release.steppingStones ?? []).filter((s) => steppingStoneIds.has(s.id));

const paretoNames: Record<number, string> = {
  0: 'Unedited islet cells in oxygen/vessel setting (no safety switch)',
  1: 'Unedited allo + CXCL10(SERPINB9+PD-L1) in setting (no switch)',
  2: 'Unedited allo + CXCL10 + AAVS1 safety switch in setting',
  3: 'B2M(HLA-E+CD47) + CIITA-off + AAVS1 switch in setting (Design A without CXCL10)',
  4: 'Design A (4-locus lead)',
  5: 'Minimal HIP (B2M/CIITA-off + viral CD47) + CXCL10 + AAVS1 switch in setting',
  6: 'Design B (HLA-C-retained 6-locus + 1 INS base edit)',
  7: 'Design B + RNLS-off (7 loci + 1 INS base edit)',
};

/** Best safety-switched design at each gene-edit count K = 0..7, from pareto_frontier_by_locus_budget_K. */
export const paretoByEdits = (release.paretoByEdits ?? []).map((p) => ({
  ...p,
  summary: paretoNames[p.edits] ?? p.bestSwitchedId,
}));

export const steppingStonesNote =
  'Table 3 compares the published reference designs as originally reported (for example, Sana UP421 without our oxygen-and-vessel setting or safety switch, ranked #246). Putting minimal HIP cells into the exact same setting and safety switch as Design A moves them to #45 (0.0526), and a 3-edit version without the CXCL10 shield reaches #32 (0.0575). Whether 4-edit Design A (#1, 0.1069) truly beats those simpler 3-edit cells is an unproven model assumption that the 36-run Stage-0 dish protocol (data/protocols/hip_core_fractional_factorial_v0.6.2.json) tests head to head.';

/** Table 3 (plus intermediate stepping stones 3A and edit-count frontier 3B) as Markdown, for the starter pack and the connector. */
export function scoresTableMarkdown(): string {
  if (!showScenarioIndices) return 'Model scores are not shown in this version.';
  const totalDesigns = release.counts.designs.toLocaleString('en-US');
  const rows = indices.map((r) =>
    [
      r.name + (r.reference ? ' (another group’s design, scored as a check on the model)' : ''),
      r.rank,
      r.sub.replace('reference · ', ''),
      r.value.toFixed(4),
      testShort[r.weakestTest],
    ].join(' | '),
  );
  const stepRows = steppingStones.map((s) =>
    [
      s.label + (s.unswitchedHold ? ' *(clinical hold: no safety switch)*' : ''),
      s.rank,
      `${s.edits}${s.baseEdits ? ` + ${s.baseEdits} base` : ''}`,
      s.children.toFixed(4),
      s.composite.toFixed(4),
      testShort[s.weakestTest],
    ].join(' | '),
  );
  const paretoRows = paretoByEdits.map((p) =>
    [
      `${p.edits}${p.bestSwitchedBaseEdits ? ` (+${p.bestSwitchedBaseEdits} base)` : ''}`,
      p.summary,
      p.bestSwitchedRank,
      p.bestSwitchedChildren.toFixed(4),
      p.bestSwitchedComposite.toFixed(4),
      testShort[p.bestSwitchedWeakestTest],
    ].join(' | '),
  );
  return [
    `| Design | Rank of ${totalDesigns} (overall score) | Gene edits | Model score (child profile) | Weakest test |`,
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r} |`),
    '',
    `**Table 3.** ${scoresCaption}`,
    '',
    `| Step-by-step comparison (same scoring model) | Rank of ${totalDesigns} | Gene edits | Child score | Overall score | Weakest test |`,
    '|---|---|---|---|---|---|',
    ...stepRows.map((r) => `| ${r} |`),
    '',
    `**Table 3A.** Controlled stepping stones from Sana UP421 (#246) through minimal HIP in the Islet-1 setting (#45) to Design A (#1). ${steppingStonesNote}`,
    '',
    `| Gene-edit count (K) | Best clinically switched design at this edit count | Rank of ${totalDesigns} | Child score | Overall score | Weakest test |`,
    '|---|---|---|---|---|---|',
    ...paretoRows.map((r) => `| ${r} |`),
    '',
    '**Table 3B.** Best safety-switched design at each gene-edit count (`K = 0` to `7`; at `K = 2` and `K = 3`, higher-scoring immune-evasive stacks without a safety switch sit at #60 [`0.0453`] and #6 [`0.0839`] under clinical hold). Full 2,160-stack table: `data/extracted/islet1_combinatorial_pareto_and_ladder_v0.8.0.json`.',
  ].join('\n');
}

