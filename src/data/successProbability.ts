// The "realistic chance of working" estimates shown on the Blueprint page, read from success-probability.json.
// They are the blueprint team's own estimates, not measurements. To change one, edit its percentage in the JSON file and set
// lastUpdated: the combined figures work themselves out. A bad value stops the build with a message instead of reaching the page.
import data from './success-probability.json';

export type OddsKind = 'shown' | 'partial' | 'unknown';

export interface OddsGate {
  id: string;
  /** 1 to 4, the order of the hurdles. */
  number: number;
  title: string;
  /** The estimate for one design on its own, as a percentage from 0 to 100. */
  singleArmPct: number;
  /** The estimate when three designs are tested side by side. */
  threeArmPct: number;
  badge: string;
  badgeKind: OddsKind;
  plain: string;
  evidence: string;
  /** A PubMed ID, or an empty string when the evidence is the blueprint's own model. */
  pmid: string;
  /** What comes next for this hurdle. Empty when nothing more is needed. */
  next: string;
}

const KINDS: readonly string[] = ['shown', 'partial', 'unknown'];

function percent(value: unknown, where: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`success-probability.json: ${where} must be a number from 0 to 100.`);
  }
  return value;
}

function words(value: unknown, where: string, required = true): string {
  if (typeof value !== 'string' || (required && value.trim() === '')) {
    throw new Error(`success-probability.json: ${where} must be text${required ? ' and cannot be empty' : ''}.`);
  }
  return value;
}

if (typeof data.lastUpdated !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(data.lastUpdated)) {
  throw new Error('success-probability.json: lastUpdated must be a date like 2026-10-26.');
}
if (!Array.isArray(data.gates) || data.gates.length === 0) {
  throw new Error('success-probability.json: gates must be a list with at least one hurdle.');
}

export const oddsLastUpdated: string = data.lastUpdated;

export const oddsGates: OddsGate[] = data.gates.map((g, i) => {
  const where = `gates[${i}]`;
  if (!KINDS.includes(g.badgeKind)) throw new Error(`success-probability.json: ${where}.badgeKind must be one of ${KINDS.join(', ')}.`);
  return {
    id: words(g.id, `${where}.id`),
    number: i + 1,
    title: words(g.title, `${where}.title`),
    singleArmPct: percent(g.singleArmPct, `${where}.singleArmPct`),
    threeArmPct: percent(g.threeArmPct, `${where}.threeArmPct`),
    badge: words(g.badge, `${where}.badge`),
    badgeKind: g.badgeKind as OddsKind,
    plain: words(g.plain, `${where}.plain`),
    evidence: words(g.evidence, `${where}.evidence`),
    pmid: words(g.pmid, `${where}.pmid`, false),
    next: words(g.next, `${where}.next`, false),
  };
});

/** Multiplies percentages (each 0 to 100) and returns a percentage: 88 and 50 make 44. */
export const combine = (values: number[]): number => values.reduce((total, v) => (total * v) / 100, 100);

/** All the hurdles cleared by one design on its own. */
export const oddsSingle: number = combine(oddsGates.map((g) => g.singleArmPct));
/** All the hurdles cleared when three designs are tested side by side. */
export const oddsThree: number = combine(oddsGates.map((g) => g.threeArmPct));

/** The way a combined figure is shown: a whole number, never a false decimal. */
export const wholePercent = (value: number): number => Math.round(value);
