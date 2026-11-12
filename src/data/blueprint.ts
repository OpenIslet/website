import assetList from './assets.json';
import { release } from './site';

// Islet-1 design content, in plain English, from the OpenIslet blueprint.
// The "helps" marks in the overview table are editorial and should be checked by a scientist.

export type Kind = 'cds' | 'reg' | 'link' | 'ins' | 'ko' | 'keep' | 'edit';

export interface Elem {
  label: string;
  sub?: string;
  kind: Kind;
  grow: number;
}

export interface Locus {
  id: string;
  label: string;
  title: string;
  gates: string;
  action: string;
  elems: Elem[];
  notes: string[];
  pmids: string[];
}

/** One mark per test in the order 1, 2A, 2B, 3, 4, 5. p = main job, s = helps, n = not involved. */
export interface Row {
  name: string;
  sub: string;
  marks: string;
}

/** An upgrade that is proposed for a design but not built, measured or scored. */
export interface Proposal {
  title: string;
  text: string;
  /** Which small picture to show (src/components/designs/ProposalArt.astro). */
  art: 'signals' | 'line' | 'gel';
}

/** Design X only: the two separate ideas that share its name, so a visitor can tell the scored one from the proposal. */
export interface TwoIdeas {
  title: string;
  scored: { title: string; text: string };
  proposal: { title: string; text: string };
}

export interface Scenario {
  id: 'A' | 'B' | 'X';
  name: string;
  summary: string;
  headline: string;
  aim: string;
  risk: string;
  rows: Row[];
  loci: Locus[];
  /** Design X only: upgrades that are still on paper. */
  proposals?: Proposal[];
  /** Design X only: what the name covers. */
  twoIdeas?: TwoIdeas;
}

export const gateColumns = [
  { code: '1', name: 'Insulin' },
  { code: '2A', name: 'Rejection' },
  { code: '2B', name: 'Autoimmune' },
  { code: '3', name: 'Early attack' },
  { code: '4', name: 'Stress' },
  { code: '5', name: 'Oxygen, safety' },
];

const aavs1: Locus = {
  id: 'aavs1',
  label: 'AAVS1',
  title: 'AAVS1 reference insertion location',
  gates: 'Test 5',
  action: 'Insert the safety switch on both copies',
  elems: [
    { label: 'cHS4-derived variant', sub: 'insulation unmeasured', kind: 'ins', grow: 1.4 },
    { label: '455 bp HNRNPA2B1-proximal candidate', sub: 'anti-silencing unmeasured', kind: 'ins', grow: 2.4 },
    { label: 'EEF1A1-core', sub: '230 bp promoter', kind: 'reg', grow: 2 },
    { label: 'iCasp9', sub: 'drug-triggered switch', kind: 'cds', grow: 2 },
  ],
  notes: [
    'Intended on both copies of AAVS1; expression and AP1903 killing in every graft lineage remain unmeasured.',
    'The proposed target is fewer than 1 escape per 100 million cells capable of regrowth, not an observed kill rate.',
    'The inserted HNRNPA2B1-proximal candidate is chr7:26200580-26201034; the legacy CBX3 label does not establish published-fragment identity or function.',
  ],
  pmids: ['23307570', '28860464', '26455413', '11242052'],
};

const ciita: Locus = {
  id: 'ciita',
  label: 'CIITA',
  title: 'CIITA gene',
  gates: 'Test 2A',
  action: 'Switch off both copies of CIITA',
  elems: [
    { label: 'CIITA copy 1', sub: 'off', kind: 'ko', grow: 1 },
    { label: 'CIITA copy 2', sub: 'off', kind: 'ko', grow: 1 },
  ],
  notes: [
    'Removes HLA class II, which helps T cells recognise foreign cells.',
    'Does not stop the patient’s own cells passing on cell debris (rule GY-010).',
  ],
  pmids: [],
};

const named: Scenario[] = [
  {
    id: 'A',
    name: 'Design A',
    summary: '4-locus reference family; two layouts',
    headline: 'Design A: four gene edits and a protective setting',
    aim: 'A broadly usable donor-cell hypothesis; patient protection and eligibility are unestablished.',
    risk: 'Too little HLA-E or CD47 on the cell surface in the first hours (rule GY-009), and attack through the patient’s own immune cells (GY-010).',
    rows: [
      { name: 'B2M gene', sub: 'Add CD47 and HLA-E', marks: 'xpspnn' },
      { name: 'CIITA gene', sub: 'Switch off', marks: 'npsnnn' },
      { name: 'CXCL10 gene', sub: 'Add SERPINB9 and PD-L1', marks: 'nnsnpn' },
      { name: 'AAVS1 location', sub: 'Add safety switch', marks: 'nnnnnp' },
      { name: 'Setting', sub: 'Small clusters, vessels, oxygen', marks: 'pnsnsp' },
    ],
    loci: [
      {
        id: 'b2m',
        label: 'B2M',
        title: 'B2M gene',
        gates: 'Tests 2A and 3',
        action: 'Insert CD47 and HLA-E at the B2M gene',
        elems: [
          { label: 'CD47-IgV-GPI ←', sub: 'antisense CDS', kind: 'cds', grow: 2 },
          { label: 'EEF1A1-core ←', sub: 'constitutive CD47 promoter', kind: 'reg', grow: 2.4 },
          { label: '5xISRE →', sub: 'inducible HLA-E promoter', kind: 'reg', grow: 2.4 },
          { label: 'HLA-E*01:03 →', sub: 'VMAPRTLVL SCT', kind: 'cds', grow: 2.2 },
        ],
        notes: [
          'Removes the HLA proteins T cells use to spot foreign cells.',
          'Pictured: Arm 1B, with separate opposing promoters. Arm 1A instead encodes HLA-E first, then one 22-aa GSG-P2A element and CD47.',
          'Full-length CD47 can slow insulin release, so a version without that signalling is being compared.',
          'The HLA-E peptide is a candidate immune signal. Shared-CD94 reference contacts cannot establish NKG2A-over-NKG2C selectivity.',
          'Open question: is the level high enough in every cell type? A lab test would settle it.',
        ],
        pmids: ['38508139', '37156915', '37820008', '30778232', '28504668', '37264229'],
      },
      ciita,
      {
        id: 'cxcl10',
        label: 'CXCL10',
        title: 'CXCL10 gene',
        gates: 'Tests 4 and 2B',
        action: 'Insert protective genes at the CXCL10 gene',
        elems: [
          { label: 'CXCL10 ISRE / NF-κB', sub: 'original switches', kind: 'reg', grow: 3 },
          { label: 'SERPINB9', sub: 'made inside the cell', kind: 'cds', grow: 2.4 },
          { label: 'GSG-P2A', sub: 'single 22-aa element', kind: 'link', grow: 1.3 },
          { label: 'PD-L1 (CD274)', sub: 'on the cell surface', kind: 'cds', grow: 2.4 },
        ],
        notes: [
          'The proposed inflammation-responsive protection retains STAT1; switching STAT1 off would conflict with this trigger.',
          'SERPINB9 is made first, then PD-L1.',
          'A lab test would compare this order with the reverse.',
        ],
        pmids: ['28526819', '30952982', '28813417'],
      },
      aavs1,
    ],
  },
  {
    id: 'B',
    name: 'Design B',
    summary: 'B1: 6 loci + INS edit; B2: 5 loci ± TYK2 prime edit',
    headline: 'Design B family: HLA-C-retaining hypotheses',
    aim: 'Test matched HLA-C retention; no exact B product benefit or patient eligibility is established.',
    risk: 'One HLA-C gene may not calm natural killer cells (GY-005). Editing HLA-A and HLA-B together can delete the DNA between them, so they have to be edited one after the other. More edits also make manufacturing harder.',
    rows: [
      { name: 'HLA-A and HLA-B genes', sub: 'Switch off, keep one HLA-C', marks: 'npnpnn' },
      { name: 'CIITA gene', sub: 'Switch off', marks: 'npnnnn' },
      { name: 'TYK2 gene', sub: 'Switch off', marks: 'xsssnn' },
      { name: 'CXCL10 gene', sub: 'Add SERPINB9 and PD-L1', marks: 'nnsnpn' },
      { name: 'AAVS1 location', sub: 'Add safety switch', marks: 'nnnnnp' },
      { name: 'INS gene', sub: 'One base edit', marks: 'nnpnnn' },
      { name: 'Setting', sub: 'Small clusters, vessels, oxygen', marks: 'pnsnsp' },
    ],
    loci: [
      {
        id: 'hla',
        label: 'HLA-A / HLA-B',
        title: 'HLA-A and HLA-B genes',
        gates: 'Tests 2A and 3',
        action: 'Switch off HLA-A and HLA-B, keep one HLA-C',
        elems: [
          { label: 'HLA-A', sub: 'both copies off', kind: 'ko', grow: 2 },
          { label: 'HLA-B', sub: 'both copies off', kind: 'ko', grow: 2 },
          { label: 'HLA-C', sub: 'one matched copy kept', kind: 'keep', grow: 2.4 },
        ],
        notes: [
          'Tests whether retained, matched HLA-C can engage inhibitory NK receptors; this is not established protection.',
          'Risk: one HLA-C gene may not give enough of the signal that calms natural killer cells (GY-005).',
          'Risk: cutting HLA-A and HLA-B at the same time can delete or flip the stretch of DNA between them (about 1.4 million letters), including HLA-E and the HLA-C copy that Design B keeps. The two edits have to be made one after the other, with checks in between, or with editors that do not cut both strands of the DNA.',
          'This has to be measured in the lab.',
        ],
        pmids: ['30853558', '37264229', '34407395'],
      },
      ciita,
      {
        id: 'tyk2',
        label: 'TYK2',
        title: 'TYK2 gene',
        gates: 'Tests 2A, 2B and 3 (costs Test 1)',
        action: 'B1 only: disrupt TYK2; B2 preserves it or proposes P1104A prime editing',
        elems: [
          { label: 'TYK2 copy 1', sub: 'off', kind: 'ko', grow: 1 },
          { label: 'TYK2 copy 2', sub: 'off', kind: 'ko', grow: 1 },
        ],
        notes: [
          'In the model it helps against donor-cell rejection, autoimmune attack and early immune attack.',
          'Differentiation penalties for switching off TYK2 are literature-anchored priors, not measured yields of this multi-edit product.',
        ],
        pmids: ['36289205'],
      },
      {
        id: 'cxcl10',
        label: 'CXCL10',
        title: 'Proposed 2A-free protective cassette; donor unresolved',
        gates: 'Tests 4 and 2B',
        action: 'Proposed B cassette: no complete sequence ledger or compiler support yet',
        elems: [
          { label: 'CXCL10 ISRE / NF-κB', sub: 'original switches', kind: 'reg', grow: 2.6 },
          { label: 'hPGK-min', kind: 'reg', grow: 1.4 },
          { label: 'SERPINB9', kind: 'cds', grow: 1.8 },
          { label: 'Internal promoter or eIF4G leader', kind: 'reg', grow: 2.6 },
          { label: 'PD-L1', kind: 'cds', grow: 1.8 },
        ],
        notes: [
          'A 2A-free topology is proposed to avoid that linker scar; its actual expression products and antigen presentation are unmeasured.',
          'Layer 2 retains provisional P2A B comparators only; those priors do not validate this unresolved 2A-free product.',
        ],
        pmids: ['12370285'],
      },
      aavs1,
      {
        id: 'ins',
        label: 'INS',
        title: 'B1 INS edit hypothesis',
        gates: 'Test 2B',
        action: 'B1 proposes an INS edit; it is not part of the B2 base product',
        elems: [{ label: 'INS leader sequence', sub: 'base edit', kind: 'edit', grow: 1 }],
        notes: [
          'Tests an insulin-epitope alteration; reduced autoimmune recognition and preserved insulin function are unmeasured.',
          'Editing penalties are declared model assumptions; they are not measured rearrangement rates or manufacturing yields (GY-006).',
        ],
        pmids: ['39529170'],
      },
    ],
  },
];

// Design X is the challenger: Design A plus one INS base edit (the scored grid challenger), with three
// upgrades that are only proposals. Its loci are Design A's, so a change to Design A shows up here too.
const designA = named.find((d) => d.id === 'A')!;

const insX: Locus = {
  id: 'ins',
  label: 'INS',
  title: 'INS gene: one base edit',
  gates: 'Test 2B',
  action: 'Make one base edit in the insulin gene',
  elems: [
    { label: 'INS signal sequence', sub: 'base edit', kind: 'edit', grow: 2 },
    { label: 'Hidden start signal', sub: 'removed, insulin unchanged', kind: 'edit', grow: 2 },
  ],
  notes: [
    'Designed to make the graft’s own insulin a harder target for the autoimmune attack. A base edit changes DNA letters without cutting both strands.',
    'It also removes a hidden start signal in the insulin gene. That signal can make a faulty insulin-like fragment, which T cells in people with type 1 diabetes have been reported to attack.',
    'It cannot hide the other proteins the attack is known to target (GAD65, IA-2 and ZnT8), or stop the patient’s own immune cells passing on cell debris (rule GY-010), so that warning stays on.',
    'Whether it helps, and whether insulin works normally afterwards, is unmeasured. It is one more edit to manufacture, and the model charges a small penalty for it.',
  ],
  pmids: ['28263308'],
};

// The scores come from the same data as the rest of the site, so these words cannot go stale. If the data has no Design X row the numbers are left out.
const xRow = release.designs.find((d) => d.id === 'X');
const xScoreWords = xRow
  ? `The computer model scores it ${xRow.children.toFixed(4)} for children (${xRow.composite.toFixed(4)} overall), ranked ${xRow.rank} of ${release.counts.designs.toLocaleString('en-US')}, tied with another design. `
  : '';

const designX: Scenario = {
  id: 'X',
  name: 'Design X',
  summary: 'Design A plus one INS base edit (scored); a separate unscored proposal with upgrades, none built',
  headline: 'Design X: Design A plus one small insulin-gene edit',
  aim: 'A challenger that tests whether making the graft’s own insulin harder to target helps against the autoimmune attack. A hypothesis for the lab, not an established benefit.',
  risk: 'An insulin-only edit cannot hide the other targets of the attack, or stop the patient’s own immune cells passing on debris (GY-010). It adds one more edit to manufacture. The proposed upgrades are not built or measured.',
  rows: [
    ...designA.rows.filter((r) => r.name !== 'Setting'),
    { name: 'INS gene', sub: 'One base edit', marks: 'nnpnnn' },
    ...designA.rows.filter((r) => r.name === 'Setting'),
  ],
  loci: [...designA.loci, insX],
  twoIdeas: {
    title: 'Two separate ideas share the name Design X',
    scored: {
      title: 'The scored comparison',
      text: `Design A plus one small insulin-gene edit, evaluated on the shared baseline 119 µm oxygen layer. ${xScoreWords}The edit is meant to make the graft’s own insulin a harder target for the immune system. It cannot hide the other targets of the attack, and its effects are unmeasured.`,
    },
    proposal: {
      title: 'The molecular proposal',
      text: 'A separate Stage-0 version with proposed upgrades: a new switch for the HLA-E and CD47 “don’t attack me” signals, a protective starting cell line, a dedicated outer-ring arrangement for the Fas-ligand gel, and a thinner 100 µm central oxygen layer. It does not include the insulin-gene edit. It is a written proposal: its DNA is not built yet, it has no score, and nobody knows yet how well it would work.',
    },
  },
  proposals: [
    {
      art: 'signals',
      title: 'Redesigned “don’t attack me” signals',
      text: 'A new DNA switch and a slightly changed CD47 protein, to be tested for more protective signal in the first hours. HLA-E stays unchanged unless an optional side test shows that a small change stops killer T cells’ helper protein (CD8) gripping it. A written proposal: its DNA is not built yet. Not scored or tested.',
    },
    {
      art: 'line',
      title: 'A protective stem-cell line',
      text: 'Start from a stem-cell line that already carries a natural variant of the insulin gene linked to a lower risk of type 1 diabetes. This is a choice of starting cells, not an edit, and any protection is unproven.',
    },
    {
      art: 'gel',
      title: 'A layered gel around the graft',
      text: 'While all three designs include clotting-control and Fas-ligand gel signals, the Stage-0 Design X proposal places the Fas-ligand particles strictly in an outer boundary ring around a thinner 100 µm central oxygen layer so they stay away from the beta cells. Each signal must pass its own safety test first.',
    },
  ],
};

export const scenarios: Scenario[] = [...named, designX];

export const niche = [
  { k: 'Cell mix', v: '60% beta, 30% alpha, 10% delta' },
  { k: 'Cluster size', v: '120 µm or less' },
  { k: 'Blood vessels', v: 'Proposed isogenic vascular support; perfusion and integration unmeasured' },
  { k: 'Early oxygen support', v: 'Proposed oxygen-releasing silicone-peroxide layer with catalase; release half-life and kinetic law must be measured for each recipe' },
  { k: 'Layer thickness', v: '350 µm is a declared model input; a safe dose, area and oxygen margin remain unvalidated' },
  { k: 'Gel particles', v: 'Temporary clotting-control and Fas-ligand gel particles to block complement and turn away attacking T cells (placed in a separate outer ring in the Stage-0 Design X proposal); each signal must pass a safety test first' },
];

export const assets = assetList;

export const reproduce = `# in a clone of https://github.com/openislet/openislet (needs Python 3.10 or newer)
python3 -m venv ../openislet-venv
../openislet-venv/bin/pip install -r requirements.txt

# check every public file against its checksum
../openislet-venv/bin/python -B scripts/generate_release_manifest.py --verify-public-bundle

# run the tests and the acceptance suite
../openislet-venv/bin/python -B -m pytest -p no:cacheprovider
../openislet-venv/bin/python -B tests/test_adversarial_acceptance.py`;
