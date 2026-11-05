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

/** Table 3 as Markdown, for the starter pack and the connector, which cannot draw the page's table. */
export function scoresTableMarkdown(): string {
  if (!showScenarioIndices) return 'Model scores are not shown in this version.';
  const rows = indices.map((r) =>
    [
      r.name + (r.reference ? ' (another group’s design, scored as a check on the model)' : ''),
      r.rank,
      r.sub.replace('reference · ', ''),
      r.value.toFixed(4),
      testShort[r.weakestTest],
    ].join(' | '),
  );
  return [
    `| Design | Rank of ${release.counts.designs.toLocaleString('en-US')} (overall score) | Gene edits | Model score (child profile) | Weakest test |`,
    '|---|---|---|---|---|',
    ...rows.map((r) => `| ${r} |`),
    '',
    `**Table 3.** ${scoresCaption}`,
  ].join('\n');
}

