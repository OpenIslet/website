// Site-wide constants. The version, counts and scores come from release.json, which
// `npm run sync-data` writes from the OpenIslet repository, so nothing here goes out of date.
import releaseData from './release.json';

export const release = releaseData;

export const navItems = [
  { href: '/#problem', label: 'The problem', id: 'problem' },
  { href: '/blueprint', label: 'Blueprint', id: 'blueprint' },
  { href: '/idea-graveyard', label: 'Idea Graveyard', id: 'graveyard' },
  { href: '/roadmap', label: 'Roadmap', id: 'roadmap' },
  { href: '/contributions', label: 'Contributions', id: 'contributions' },
  { href: '/about', label: 'About', id: 'about' },
];

/** The hand-held guide: give your AI the blueprint, explore, draft, review, submit. */
export const startHref = '/start';

/** The connector's address, shown on Start here and in the starter pack. PUBLIC_MCP_ENDPOINT changes it for the staging build
 *  (https://mcp-staging.openislet.org/mcp); the queue's address below follows it unless PUBLIC_QUEUE_API is set. */
export const mcpEndpoint: string = import.meta.env.PUBLIC_MCP_ENDPOINT ?? 'https://mcp.openislet.org/mcp';

/**
 * Where the web submission form (/submit) talks to the queue: the connector's Worker (docs/connector/QUEUE-API.md).
 * Set PUBLIC_QUEUE_API in .env to point it somewhere else, for example http://127.0.0.1:8787 when testing with a local Worker.
 */
export const queueApi: string = (import.meta.env.PUBLIC_QUEUE_API ?? new URL(mcpEndpoint).origin).replace(/\/$/, '');

/**
 * Where IIPs, reviews and the blueprint itself are published in the open.
 */
export const repo = {
  owner: 'openislet',
  name: 'openislet',
  url: 'https://github.com/openislet/openislet',
};
export const issuesUrl = `${repo.url}/issues`;

/** A file in the repository, as a direct link (the latest version on the main branch). */
export const repoFile = (path: string): string => `${repo.url}/blob/main/${path}`;
export const fullBlueprintUrl = repoFile('ISLET-1-BLUEPRINT.md');

/**
 * The technical files behind each part of the blueprint: the data file, the code that makes it, and the section of the full
 * blueprint that explains it. The starter pack and the Start here guide both list these, so an AI that cannot search for a
 * file, or a person who has to hand it over, is never left guessing the name or where it lives.
 */
export const technicalSources = [
  { part: 'The Context–Evidence Graph', section: '9.0', data: 'data/extracted/context_evidence_graph_v1.json', code: 'scripts/build_context_evidence_graph.py' },
  { part: 'The DNA edits', section: '9.1', data: 'data/extracted/layer2_regulatory_and_perturbation_atlas.json', code: 'scripts/run_layer2_perturbation_and_regulatory_plane.py' },
  { part: 'The proteins', section: '9.2', data: 'data/extracted/layer3_structural_verification_atlas.json', code: 'scripts/run_layer3_structural_binder_plane.py' },
  { part: 'Oxygen and tissue', section: '9.3', data: 'data/extracted/layer4_tissue_and_metabolic_twin_atlas.json', code: 'scripts/run_layer4_tissue_and_metabolic_twin.py' },
  { part: 'The simulated patients', section: '9.4', data: 'data/extracted/layer5_personalized_patient_and_crispr_atlas.json', code: 'scripts/run_layer5_personalized_patient_compiler.py' },
] as const;

/** How to reach a person. The address forwards to the project owner. The Contact page, footer and 404 page use it. */
export const contact = {
  email: 'hello@openislet.org',
  href: '/contact',
};

/** Where the project posts updates. */
export const social = {
  x: { handle: '@OpenIslet', url: 'https://x.com/OpenIslet' },
};

/** The project's headline goal, used on the home page, the roadmap and in page descriptions. */
const goalYear = 2030;
export const goal = {
  year: goalYear,
  /** Reads after "Our goal:", for example "Our goal: cure the first person by 2030." */
  short: `cure the first person by ${goalYear}`,
};

/**
 * Whether the MCP connector is open to the public. Set PUBLIC_CONNECTOR_STATUS=live in .env when it opens.
 * The submission form talks to the Worker whenever this or `submissionsOpen` is on.
 */
export const connectorStatus: 'planned' | 'live' =
  import.meta.env.PUBLIC_CONNECTOR_STATUS === 'live' ? 'live' : 'planned';

/**
 * Whether sending an IIP is open. The connector can be live for reading (PUBLIC_CONNECTOR_STATUS=live) while the
 * public queue is still closed. Set PUBLIC_SUBMISSIONS_OPEN=true in .env when the public queue opens.
 */
export const submissionsOpen = import.meta.env.PUBLIC_SUBMISSIONS_OPEN === 'true';

/** Whether the form offers "Verify my ORCID iD". Set PUBLIC_ORCID_VERIFY=true once the connector has its ORCID client id and secret. */
export const orcidVerify = submissionsOpen && import.meta.env.PUBLIC_ORCID_VERIFY === 'true';

/**
 * Photo behind the home page hero: the nuclei of an islet of Langerhans in a confocal micrograph by Masur
 * (CC BY 2.5), cropped to the nuclei panel and brightened. The footer shows the credit.
 * To go back to the drawn field of cells, set PUBLIC_HERO_BACKGROUND=cells in .env, or set `heroPhoto` to null.
 */
const heroPhotoFile = {
  src: '/hero/pancreatic-islet-nuclei.jpg',
  credit: 'Masur, CC BY 2.5 (cropped and brightened)',
  href: 'https://commons.wikimedia.org/wiki/File:PancreaticisletsDAPI.jpg',
};
export const heroPhoto: { src: string; credit: string; href: string } | null =
  import.meta.env.PUBLIC_HERO_BACKGROUND === 'cells' ? null : heroPhotoFile;

/**
 * Scenario indices are prior-anchored model outputs unfrozen in v0.8.0 with mandatory
 * prior-dominance disclosure. Set PUBLIC_SHOW_SCENARIO_INDICES=false in .env to hide them everywhere.
 */
export const showScenarioIndices = import.meta.env.PUBLIC_SHOW_SCENARIO_INDICES !== 'false';

/**
 * Whether search engines may list the site. It stays off until the site is public: the pages say "noindex" and
 * robots.txt turns every crawler away. Set PUBLIC_INDEXABLE=true in .env when the site goes live.
 */
export const indexable = import.meta.env.PUBLIC_INDEXABLE === 'true';

/**
 * The picture shown when a link to the site is shared (built by social/x-profile-pack/tools/render.sh). A new look gets a new file
 * name, because apps keep a shared picture by its address; /og.png holds the same picture for older shares.
 */
export const shareImage = {
  src: '/og-islet.png',
  width: 1200,
  height: 630,
  alt: 'OpenIslet: help develop an open blueprint to accelerate a cure for type 1 diabetes.',
};

/**
 * Share pictures for single pages, the same size as the one above (built by social/x-profile-pack/tools/page-cards.mjs, which
 * holds the words on each picture). A page asks for its own with the layout's `share` setting; every other page uses shareImage.
 */
export const pageShareImages = {
  ceg: { src: '/og/ceg.jpg', alt: 'OpenIslet, open method. Context–Evidence Graph (CEG): an open method to read studies with AI without losing the experimental context.' },
  blueprint: { src: '/og/blueprint.jpg', alt: 'OpenIslet, Blueprint. The Islet-1 blueprint: three designs for a personalised type 1 diabetes cure, as a drawing, a specification and open data.' },
  'idea-graveyard': { src: '/og/idea-graveyard.jpg', alt: 'OpenIslet, Idea Graveyard. Ideas ruled out on paper, or flagged as risky: a public list, so nobody repeats a dead end.' },
  roadmap: { src: '/og/roadmap-v2.jpg', alt: 'OpenIslet, Roadmap. The path to patients: seven stages, from the open blueprint to the first person cured. The goal: 2030.' },
  contributions: { src: '/og/contributions.jpg', alt: 'OpenIslet, Contributions. Who has helped, and what they did: every Islet Improvement Proposal, what it changed, and who sent it.' },
  start: { src: '/og/start.jpg', alt: 'OpenIslet, Start here. Help in six steps: give any AI chat the blueprint, and it leads, one question at a time.' },
} as const;

export function pubmed(pmid: string): string {
  return `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
}

const dateFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
/** "2026-10-24" becomes "24 October 2026". */
export function longDate(iso: string): string {
  return dateFormat.format(new Date(`${iso}T00:00:00Z`));
}
