// The five layers: the Context–Evidence Graph plus DNA, proteins, tissue and patient. Each is an atlas of results.
import { type Answer, type Config, md, problem } from './answer';
import type { Bundle } from './bundle';
import { clip, tidy } from './text';

export const LAYERS = ['evidence', 'dna', 'proteins', 'tissue', 'patient'] as const;
export type Layer = (typeof LAYERS)[number];

const INTRO: Record<Layer, { name: string; plain: (c: Record<string, number | null>) => string }> = {
  evidence: {
    name: 'The evidence layer (layer 1 of 5)',
    plain: (c) =>
      `Maps ${typeof c.cegStudies === 'number' ? c.cegStudies.toLocaleString('en-GB') : '1,151'} primary empirical studies, ${typeof c.cegArms === 'number' ? c.cegArms.toLocaleString('en-GB') : '7,659'} experimental and control groups, ${typeof c.cegOutcomes === 'number' ? c.cegOutcomes.toLocaleString('en-GB') : '14,105'} structured outcomes and ${typeof c.cegLinks === 'number' ? c.cegLinks.toLocaleString('en-GB') : '2,447'} blueprint links in the Type 1 Diabetes Context–Evidence Graph (screened from ${typeof c.cegScreened === 'number' ? c.cegScreened.toLocaleString('en-GB') : '3,922'} candidate records), alongside the ${typeof c.studies === 'number' ? c.studies.toLocaleString('en-GB') : '563'}-study scoring baseline.`,
  },
  dna: {
    name: 'The DNA layer (layer 2 of 5)',
    plain: (c) =>
      `Holds ${c.constructs ?? 'unavailable'} genomic reference constructs and their sequence, translation and grammar checks. AlphaGenome variant-impact scores are neither published nor used as evidence here (its output terms restrict outputs to non-commercial use, which conflicts with this CC-BY-4.0 release), and no such score establishes insertion or splicing safety.`,
  },
  proteins: {
    name: 'The protein layer (layer 3 of 5)',
    plain: (c) =>
      `Replays reference-coordinate geometry from ${c.experimentalStructures ?? 'unavailable'} experimental structures and ${c.predictedStructures ?? 'unavailable'} AlphaFold models across ${c.proteinPairs ?? 'unavailable'} protein pairs. Reference compatibility does not establish engineered-product folding, immune protection or pan-allelic function.`,
  },
  tissue: {
    name: 'The tissue layer (layer 4 of 5)',
    plain: () => "Simulates the graft's oxygen supply over 14 days, and blood sugar and hormones over 24 hours. These are computer models and have not been tested in the lab.",
  },
  patient: {
    name: 'The patient layer (layer 5 of 5)',
    plain: (c) =>
      `Checks declared reference edit instructions and genotype inputs, and runs a simulated population of ${typeof c.virtualPatients === 'number' ? c.virtualPatients.toLocaleString('en-GB') : 'unavailable'} virtual patients. The results are scenario simulations, not predictions for any person. Exact B donor designs and clinical eligibility remain unresolved. Matching your own genotype is not offered yet.`,
  },
};

const SURVIVAL_KEYS = /survival/i;
const RANK_KEYS = /composite|rank/i;

/** Removes every entry whose name matches, at any depth, and counts them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function strip(value: any, pattern: RegExp, counter: { n: number }): any {
  if (Array.isArray(value)) return value.map((v) => strip(v, pattern, counter));
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => {
          const drop = pattern.test(k);
          if (drop) counter.n++;
          return !drop;
        })
        .map(([k, v]) => [k, strip(v, pattern, counter)]),
    );
  }
  return value;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function pick(value: any, path: string): { found: boolean; value: any; at: string } {
  if (!path) return { found: true, value, at: '' };
  let current = value;
  const taken: string[] = [];
  for (const part of path.split('.').filter(Boolean)) {
    if (current && typeof current === 'object' && Object.prototype.hasOwnProperty.call(current, part)) current = current[part];
    else {
      const keys = current && typeof current === 'object' ? Object.keys(current) : [];
      const exact = keys.find((k) => k.toLowerCase() === part.toLowerCase());
      const prefixes = keys.filter((k) => k.toLowerCase().startsWith(part.toLowerCase()));
      const key = exact ?? (prefixes.length === 1 ? prefixes[0] : undefined);
      if (key === undefined) return { found: false, value: current, at: taken.join('.') };
      current = current[key];
      taken.push(key);
      continue;
    }
    taken.push(part);
  }
  return { found: true, value: current, at: taken.join('.') };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function outline(value: any): string {
  if (Array.isArray(value)) return `a list of ${value.length}`;
  if (value && typeof value === 'object') return `${Object.keys(value).length} entries`;
  return typeof value === 'string' ? clip(value, 80) : String(value);
}

export async function layerAtlas(bundle: Bundle, cfg: Config, opts: { layer: Layer; item?: string }): Promise<Answer> {
  const layer = opts.layer;
  const [atlas, release] = await Promise.all([bundle.json<Record<string, any>>(`layers/${layer}.json`), bundle.json<{ counts: Record<string, number | null> }>('release.json')]); // eslint-disable-line @typescript-eslint/no-explicit-any
  const notes: string[] = [];
  let shown = atlas;
  const survival = { n: 0 };
  const ranks = { n: 0 };
  if (!cfg.simulatedSurvival) shown = strip(shown, SURVIVAL_KEYS, survival);
  if (!cfg.scenarioScores) shown = strip(shown, RANK_KEYS, ranks);
  if (survival.n) notes.push('The simulated "5-year survival" percentages in this layer are held back by the switch SHOW_SIMULATED_SURVIVAL. They come from a scenario simulation, not from patients, and must not be read as the chance of success for anyone.');
  if (ranks.n) notes.push('Scenario scores are switched off in this connector for now, so ranking figures are left out.');
  const intro = INTRO[layer];
  const scope = layer === 'patient' ? (atlas.part_b_personalized_patient_compiler_and_10k_population_trial?.model_classification_and_scope_note_sol_v80_10 as string | undefined) : undefined;
  const evidenceClass = atlas.evidence_class as string | undefined;

  const head =
    md.h(1, intro.name) +
    `\n${intro.plain(release.counts)}\n\n` +
    (scope ? `> **Read this first.** ${scope}\n>\n> In plain English: the figures in this layer describe how the model behaves under its own assumptions. They are not the chance of success for any person, and nothing here has been tested in the lab.\n\n` : '') +
    (evidenceClass ? `*Kind of evidence:* ${tidy(evidenceClass)}.\n\n` : '');

  if (!opts.item) {
    const keys = Object.entries(shown).map(([k, v]) => `- \`${k}\`: ${outline(v)}`);
    const body =
      head +
      md.h(2, 'Summary') +
      '```json\n' + JSON.stringify(shown.summary ?? {}, null, 2).slice(0, 4000) + '\n```\n\n' +
      md.h(2, 'What is in this layer') +
      keys.join('\n') +
      '\n\nAsk again with `item` set to one of the names above (use a dot to go deeper, for example `' + (Object.keys(shown).find((k) => k.startsWith('part_a') || k.startsWith('summary')) ?? 'summary') + '`).';
    return {
      summary: `${intro.name}. ${intro.plain(release.counts)}`,
      body,
      data: { layer, status: atlas.status, evidence_class: evidenceClass ?? null, scope_note: scope ?? null, items: Object.keys(shown), layer_summary: shown.summary ?? null },
      notes: [...notes, 'These are computer analyses. None has been tested in the lab.'],
    };
  }

  const found = pick(shown, opts.item);
  if (!found.found) {
    const options = found.value && typeof found.value === 'object' ? Object.keys(found.value).slice(0, 30) : [];
    return problem(`There is no item "${opts.item}" in the ${layer} layer${found.at ? ` under "${found.at}"` : ''}.`, [options.length ? `Items here: ${options.join(', ')}.` : 'Ask without an item to see what is in the layer.']);
  }
  const MAX = 24000;
  let text = JSON.stringify(found.value, null, 2);
  let cut = false;
  if (text.length > MAX) {
    cut = true;
    if (found.value && typeof found.value === 'object' && !Array.isArray(found.value)) {
      text = JSON.stringify(Object.fromEntries(Object.entries(found.value).map(([k, v]) => [k, outline(v)])), null, 2);
      notes.push('This item is large, so only an outline is shown. Ask again with a more specific item (use a dot to go deeper).');
    } else {
      text = text.slice(0, MAX);
      notes.push('This item is large and was cut. Ask for a more specific item.');
    }
  }
  return {
    summary: `${intro.name}: ${found.at || 'the whole layer'}. ${intro.plain(release.counts)}`,
    body: head + md.h(2, found.at || opts.item) + '```json\n' + text + '\n```\n',
    data: { layer, item: found.at, value: cut ? undefined : found.value, cut, scope_note: scope ?? null },
    notes: [...notes, 'These are computer analyses. None has been tested in the lab.'],
  };
}
