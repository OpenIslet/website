// The seven stages from blueprint to patients. Plain English first; the detail for scientists sits underneath.
// The numbers come from release.json and the dates from versions.ts, so this file only holds the words.
//
// Decided on 25 October 2026: OpenIslet's own work is Stage 0, the blueprint, and it is shown in full.
// Stages 1 to 6 are a simple outline only. They are meant to be carried out in partnership with a research institute,
// an AI lab or a biotech company, or by any organisation that takes the open blueprint and runs with it. Do not add
// protocols, step lists, sizes, schedules or pass/stop numbers for those stages here: the Stage 0 plan and the Stage 1 lab protocol are published with the blueprint, and the later stages are left to whoever carries them out.
//
// To change a stage, edit its words here. The roadmap page and the connector's roadmap section both read this file,
// so they stay the same. Keep the page current as the plan evolves.
import { release, goal } from './site';
import { draft, planned } from './versions';

export interface Stage {
  id: string;
  short: string;
  state: 'Now' | 'Later';
  name: string;
  summary: string;
  /** Why the stage exists, in a sentence or two. */
  why: string;
  /** Who carries the stage out. Stage 0 is the project; the rest are partners or open-source adopters. */
  who: 'project' | 'partners';
  /** Stage 0 only. What happens, in order. */
  points?: string[];
  /** Stage 0 only. What a pass looks like. */
  pass?: string;
  /** Stage 0 only. What makes us stop or change the plan. */
  stop?: string;
  /** Stage 0 only. What is still not known. */
  unknown?: string;
  /** Stage 0 only. Where it stands. */
  gate?: string;
  /** Stage 0 only. Detail for scientists. */
  science?: string[];
  /** When, only if a date is set. */
  timing?: string;
}

const n = (v: number) => v.toLocaleString('en-US');
const c = release.counts;
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** What comes after the blueprint, and who is expected to do it. The roadmap page and the connector both show this. */
export const afterBlueprint = {
  heading: 'After the blueprint: how it moves forward',
  lead: 'OpenIslet’s own work is Stage 0, the open blueprint. Stages 1 to 6 are the steps after it, and the blueprint can move forward in two ways.',
  ways: [
    {
      id: 'partner',
      title: 'Partner labs',
      text: 'A university lab, a research institute, an AI lab or a biotech company works with OpenIslet to test and progress one stage at a time.',
    },
    {
      id: 'adopt',
      title: 'Open adoption (CC BY 4.0)',
      text: 'Any team in the world can take the open blueprint and run with it on its own. We ask only that it credits the OpenIslet community.',
    },
  ],
  note: 'The later stages below are an outline. The Stage 0 plan and the Stage 1 lab protocol are published with the blueprint; whoever carries out the later stages writes their own plans with their regulators.',
  /** The same idea in a few sentences, for the connector. */
  oneLine:
    'Stages 1 to 6 are an outline only. They are meant to be carried out in partnership with a university lab, a research institute, an AI lab or a biotech company, or by any organisation that takes the open blueprint (CC BY 4.0) and runs with it. The Stage 0 plan and the Stage 1 lab protocol are published with the blueprint.',
};

/** The optional dog project beside stage 3: Canine Islet-1, a dog version of Islet-1, with the aim of curing an Australian terrier with insulin-dependent diabetes.
 *  It runs in parallel and never holds up the human trial: the mouse tests of the exact human product are the bridge to that trial.
 *  The picture on the roadmap page has six numbered labels. They are a picture legend, in the order of the picture, not a plan. */
export const canine = {
  breed: 'Australian terrier',
  aim: 'Cure an Australian terrier with insulin-dependent diabetes, so that it no longer needs insulin injections.',
  why: 'The project prefers a primate-free programme.',
  /** The six labels in the picture, in order. */
  legend: [
    { n: 1, text: 'Dog islet cells' },
    { n: 2, text: 'Mouse tests' },
    { n: 3, text: 'Cell implant' },
    { n: 4, text: 'Glucose sensor' },
    { n: 5, text: 'Safety switch' },
    { n: 6, text: 'No more insulin injections' },
  ],
};

export const stages: Stage[] = [
  {
    id: '0',
    short: 'Blueprint',
    state: 'Now',
    name: 'The blueprint',
    summary: 'A public design, checked on paper and in software, and open to challenge.',
    why: 'Lab work is slow, so we find as many weak spots as we can on paper and in software before it starts. Every flaw found here saves months later.',
    who: 'project',
    points: [
      `Read the evidence: ${n(c.studies)} studies and ${n(c.findings)} findings for the scoring model, plus ${n(c.cegStudies)} primary studies and ${n(c.cegOutcomes)} structured outcomes in the Type 1 Diabetes Context–Evidence Graph, each linked to its source.`,
      `Rule out what the evidence argues against: ${c.graveyardRules} Idea Graveyard rules applied to ${n(c.designs)} designs.`,
      'Check the design at five layers: the studies, the DNA, the proteins, the graft and body, and patient matching.',
      'Score honestly: the scores show how much is still assumption.',
      'Open it to challenge: anyone with an AI assistant can look for weak spots, and fixes are credited by name.',
    ],
    pass: 'The blueprint is settled enough to test: the riskiest assumptions are written down, each with an experiment and a result that counts as a pass or a stop.',
    stop: 'We find a serious flaw, such as a safety problem or evidence that contradicts a core part of the design. The blueprint changes in public, with the reason.',
    unknown: 'Nothing in the blueprint has been tested in a lab yet. The scores are model estimates on a 0 to 1 scale, not survival chances.',
    gate: `Version ${release.version} is an open computational blueprint; lab qualifications remain pending and accepted evidence can revise it.`,
    science: [
      `Corpus: ${n(c.studies)} study records and ${n(c.findings)} extracted findings in the scoring set, alongside ${n(c.cegStudies)} primary empirical studies (${n(c.cegArms)} groups, ${n(c.cegOutcomes)} structured outcomes and ${n(c.cegLinks)} blueprint links, screened from ${n(c.cegScreened)} candidate records) in the Context–Evidence Graph. ${n(c.designs)} designs are scored under ${c.graveyardRules} Idea Graveyard rules.`,
      'Five layers: the literature, the DNA (sequence, two-strand splicing and grammar checks), the proteins (AlphaFold models and experimental structures), tissue and body simulations, and a patient compiler run on synthetic patients.',
      'Direction and penalty labels in the corpus are rule-based heuristics. They have not been independently adjudicated.',
      'The first construct, cluster-density, differentiation and immune and insulin-secretion acceptance experiments are pre-registered and still pending.',
    ],
    timing: `The open draft starts on ${day(draft.opens)}. Islet-1.0 locks on ${day(planned[0].lock)}.`,
  },
  {
    id: '1',
    short: 'Lab testing',
    state: 'Later',
    name: 'Lab testing',
    summary: 'Lab teams test the key gene edits in a dish, so that only the edits that work are kept.',
    why: 'A design that works on paper can still fail in a dish. This stage finds that out early, on the edits that matter most.',
    who: 'partners',
  },
  {
    id: '2',
    short: 'Blood supply and oxygen',
    state: 'Later',
    name: 'Blood supply and oxygen',
    summary: 'Build small clusters of cells that come with their own blood vessels and a short-term oxygen supply, so the cells in the middle do not starve.',
    why: 'A new graft has no blood supply at first. Until vessels grow in, the cells in the middle of a cluster can run out of oxygen and die.',
    who: 'partners',
  },
  {
    id: '3',
    short: 'Animals and safety',
    state: 'Later',
    name: 'Animal studies and safety',
    summary: 'Before any person is treated, the exact human product is tested in diabetic mice that carry a human immune system. Canine Islet-1, a dog version, is an optional companion project that runs alongside.',
    why: `The first person should never be the first living body to meet the whole treatment. Regulators need evidence on the exact human product, so the mouse tests are the bridge to the human trial. ${canine.why}`,
    who: 'partners',
  },
  {
    id: '4',
    short: 'Clinical-grade cells',
    state: 'Later',
    name: 'Clinical-grade cells and regulator checks',
    summary: 'Make the cells to the standard needed for use in people. That means frozen master and working cell banks that every batch is grown from, one locked recipe for turning stem cells into islet cells, and an agreed test of how well each batch works.',
    why: 'A regulator will not allow a first trial until formal safety studies show that each batch matches the last, that the cells keep their DNA stable and do not form tumours, and where the cells go in the body.',
    who: 'partners',
  },
  {
    id: '5',
    short: 'First human trial',
    state: 'Later',
    name: 'First human trial',
    summary: 'Try the clinical-grade cells first in a very small, removable patch, once a regulator agrees.',
    why: 'Only a trial in people can show whether it works in people.',
    who: 'partners',
    timing: `Our goal: ${goal.short}.`,
  },
  {
    id: '6',
    short: 'Tailored treatment',
    state: 'Later',
    name: 'Tailored treatment',
    summary: 'Match the treatment to each person’s genes, where the evidence supports it and a regulator agrees.',
    why: 'People differ in the immune genes that decide whether foreign cells are tolerated, so one design may not suit everyone.',
    who: 'partners',
  },
];

/** "Stages 1 to 6": the stages after the blueprint, numbered as the roadmap numbers them. */
export const laterStages = `Stages ${stages[1].id} to ${stages[stages.length - 1].id}`;
