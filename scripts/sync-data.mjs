// Copies data from the sibling OpenIslet repository into the website and works out the numbers the site shows.
//  - src/data/idea_graveyard_v0.5.json  (rule data behind the Idea Graveyard: severity and papers)
//  - public/downloads/<path>            (the files listed in src/data/assets.json)
//  - src/data/downloads.json            (their sizes, shown next to each download)
//  - src/data/release.json              (version, date, counts and design scores. Nothing is typed in by hand.)
//  - src/data/references.json           (full citations for the papers cited in src/content/blueprint-spec.md)
// The repository stays the source of truth. `npm run dev` and `npm run build` run this
// first with --soft, which only warns if the repository is missing.
// Override the location with OPENISLET_REPO=/path/to/OpenIslet.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifyPublicExport, readPublicArtifact } from '../connector/scripts/bundle-io.mjs';
import { readPinnedSource, assertPublicDownload, publishFiles, acquireSyncLock } from './sync-io.mjs';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const repo = process.env.OPENISLET_REPO ?? resolve(root, '..', 'OpenIslet');
const soft = process.argv.includes('--soft');
const sizesPath = join(root, 'src/data/downloads.json');

if (!existsSync(repo)) {
  const msg = `OpenIslet repository not found at ${repo}. Set OPENISLET_REPO to its path.`;
  if (!soft) {
    console.error(msg);
    process.exit(1);
  }
  console.warn(`${msg} Using the data already copied.`);
  if (!existsSync(sizesPath)) await writeFile(sizesPath, '{}\n');
  process.exit(0);
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const round = (n, places) => Math.round(n * 10 ** places) / 10 ** places;

const stagedWrites = new Map();
let manifest;
function stageWrite(target, bytes) {
  if (stagedWrites.has(target)) throw new Error(`Sync target repeated: ${target}`);
  stagedWrites.set(target, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes, 'utf8'));
}
async function copyFrom(baseDir, from, to) {
  assertPublicDownload(manifest, from);
  const bytes = from === 'manifest.json' ? await readFile(join(baseDir, from)) : readPublicArtifact(baseDir, manifest, from);
  stageWrite(to, bytes);
  return bytes.length;
}

// ---- Export rights-aware public bundle (`<= 240` chars non-OA cap) & sync downloads ----

const syncLock = await acquireSyncLock(root);
let syncWorkspace;
let publicBundleDir;
try {
  syncWorkspace = await mkdtemp(join(tmpdir(), 'openislet-website-sync-'));
  publicBundleDir = join(syncWorkspace, 'public');
  execFileSync(
    'python3',
    [join(repo, 'scripts/generate_release_manifest.py'), '--export-public-bundle', publicBundleDir],
    { stdio: 'inherit' },
  );
} catch (error) {
  // The science repository is edited all the time, and its own checks refuse to export while it is half-way through a change.
  // The dev server and the build (which run this with --soft) must not stop for that: they use the data already copied.
  if (syncWorkspace) await rm(syncWorkspace, { recursive: true, force: true });
  syncLock.release();
  if (!soft) throw error;
  console.warn(
    '\nThe science repository could not export its public files just now (see the message above), so the site is using the data it already has. ' +
      'The numbers may be out of date. Run "npm run sync-data" to see the full error and to refresh them when the repository is fixed.\n',
  );
  process.exit(0);
}

try {
manifest = verifyPublicExport(publicBundleDir);
const rankings = JSON.parse((await readPinnedSource(repo, manifest, 'data/extracted/islet1_candidate_stack_rankings.json')).toString('utf8'));
const blueprint = await readFile(join(publicBundleDir, 'ISLET-1-BLUEPRINT.md'), 'utf8');
await copyFrom(publicBundleDir, 'data/graveyard/idea_graveyard_v0.5.json', join(root, 'src/data/idea_graveyard_v0.5.json'));
console.log('staged the Idea Graveyard rules');

const assets = await readJson(join(root, 'src/data/assets.json'));
const extraLayerDownloads = [
  'data/constructs/islet1_scenario_a_constructs_v0.7.0.fasta',
  'data/extracted/layer1_context_evidence_graph_atlas.json',
  'data/extracted/layer2_regulatory_and_perturbation_atlas.json',
  'data/extracted/layer3_structural_verification_atlas.json',
  'data/extracted/layer4_tissue_and_metabolic_twin_atlas.json',
  'data/extracted/layer5_personalized_patient_and_crispr_atlas.json',
];
const allDownloadPaths = [...new Set([...assets.map((a) => a.path), ...extraLayerDownloads])];
const sizes = {};
for (const relPath of allDownloadPaths) {
  if (!existsSync(join(publicBundleDir, relPath))) {
    throw new Error(
      `Public bundle export at ${publicBundleDir} is missing required download asset ${relPath} (a fallback to the raw repository is not allowed).`,
    );
  }
  sizes[relPath] = await copyFrom(publicBundleDir, relPath, join(root, 'public/downloads', relPath));
}
await copyFrom(publicBundleDir, 'data/protocols/wetlab_endpoint_contract_v0.8.0.json', join(root, 'connector/src/core/wetlab-endpoint-contract.json'));
stageWrite(sizesPath, JSON.stringify(sizes, null, 2) + '\n');
console.log(`staged ${allDownloadPaths.length} downloads (public-bundle redacted)`);


// ---- Release numbers: version, counts, design scores ----

// Use the verified export and its pinned ranking bytes throughout this transaction.

const version = manifest.schema_version.match(/v\d+\.\d+\.\d+/)?.[0];
const date = blueprint.match(/\*\*Date:\*\*\s*(\d{4}-\d{2}-\d{2})/)?.[1];
if (!version || !date) throw new Error('Could not read the release version or date from the OpenIslet repository.');

// The blueprint calls the five tests "gates", and splits test 2 into 2A and 2B.
const testOf = (gate) => gate.split('_')[0].replace('Gate', '');
const designIds = {
  ISLET1_CHASSIS_A_UNIVERSAL_LEAN_4LOCUS: 'A',
  ISLET1_CHASSIS_B_HLA_C_RETAINED_6LOCUS_HYPOTHESIS: 'B',
  BENCHMARK_1_SANA_UP421_HU2024_HIP: 'UP421',
  BENCHMARK_2_CRISPR_VIACYTE_VCTX210: 'VCTX210',
  BENCHMARK_3_UNEDITED_MACROENCAPSULATED_VX264: 'VX264',
};

const designs = rankings.ranked_candidate_architectures
  .filter((a) => designIds[a.architecture_id])
  .map((a) => {
    const children = a.utility_pediatric_early_onset_t1d;
    const adults = a.utility_adult_onset_lada;
    return {
      id: designIds[a.architecture_id],
      rank: a.global_rank_among_all_combinations,
      edits: a.genomic_locus_edit_count_K,
      baseEdits: a.base_edit_count_B,
      composite: a.composite_series_system_utility,
      children: children.series_system_joint_survival_probability,
      adults: adults.series_system_joint_survival_probability,
      weakestTest: testOf(children.limiting_bottleneck_gate),
      tests: Object.fromEntries(Object.entries(children.gate_scores).map(([g, v]) => [testOf(g), v])),
    };
  });

// Design X is the grid challenger beside the two named architectures. It has no architecture entry of its own,
// so it is read from the champion-challenger portfolio and its matching entry in the evaluated stacks, and shown in rank order.
const xSlot = rankings.champion_challenger_portfolio?.slots?.X;
const xStack = xSlot && rankings.all_evaluated_combinatorial_stacks?.find((s) => s.combination_id === xSlot.matched_combinatorial_search_id);
if (xStack) {
  const children = xStack.utility_pediatric_early_onset_t1d;
  const adults = xStack.utility_adult_onset_lada;
  designs.push({
    id: 'X',
    rank: xStack.global_rank_among_all_combinations,
    edits: xStack.total_genomic_cuts_K,
    baseEdits: xStack.total_base_edits_B,
    composite: xStack.composite_series_system_utility,
    children: children.series_system_joint_survival_probability,
    adults: adults.series_system_joint_survival_probability,
    weakestTest: testOf(children.limiting_bottleneck_gate),
    tests: Object.fromEntries(Object.entries(children.gate_scores).map(([g, v]) => [testOf(g), v])),
  });
  designs.sort((x, y) => x.rank - y.rank);
}

const spread = rankings.direct_output_logit_sensitivity_and_variance_decomposition
  .uniform_grid_pooled_pediatric_gate_logit_variance_decomposition;
const total = round(spread.structural_share_of_total_variance * 100, 2);
const findings = round(spread.empirical_gene_signal_share_of_total_variance * 100, 2);

// The Stage-0 molecular spec carries tags from the review rounds that shaped it: a round tag at the end of a key name (for example
// `_xyz_r2`), and in text a decision or finding id (`[DEC-123]`, `R9-S1-L3A-01`) or a round tag on a status word. None means anything
// to a reader and nothing reads them by name, so the copy leaves them off. Two keys that become the same stop the sync.
const tidyText = (s) =>
  s
    .replace(/;\s*R\d+-S\d+-[A-Z0-9-]+(?:\s*\[DEC-\d+\])?/g, '') // "; R9-S1-L3A-01 [DEC-077]"
    .replace(/;\s*DEC-\d+(?=\))/g, '') // "; DEC-078)"
    .replace(/\s*\[DEC-\d+\]/g, '') // " [DEC-077]"
    .replace(/(?<=[A-Z])_[A-Z]+\d*_R\d+\b/g, ''); // "LIVE_EVALUATOR_DERIVED_XYZ31_R3"
const withoutReviewTags = (value, path = 'molecular spec') => {
  if (typeof value === 'string') return tidyText(value);
  if (Array.isArray(value)) return value.map((v, i) => withoutReviewTags(v, `${path}[${i}]`));
  if (!value || typeof value !== 'object') return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    const clean = key.replace(/_[a-z]+\d*_r\d+$/, '');
    if (Object.hasOwn(out, clean)) throw new Error(`Two keys in ${path} become "${clean}" once the review-round tag is dropped.`);
    out[clean] = withoutReviewTags(v, `${path}.${clean}`);
  }
  return out;
};

const artifacts = manifest.artifacts;
const release = {
  source_manifest_sha256: createHash('sha256').update(await readFile(join(publicBundleDir, 'manifest.json'))).digest('hex'),
  source_ranking_sha256: manifest.artifacts['data/extracted/islet1_candidate_stack_rankings.json'].sha256,
  // Only the grid slots and the Stage-0 molecular spec are read (by this script and the connector). The rest of the portfolio, an
  // internal review registry, is not copied into the public repository.
  champion_challenger_portfolio: rankings.champion_challenger_portfolio
    ? {
        slots: withoutReviewTags(rankings.champion_challenger_portfolio.slots, 'slots'),
        blueprint_x_stage0_molecular_challenger_spec: withoutReviewTags(rankings.champion_challenger_portfolio.blueprint_x_stage0_molecular_challenger_spec),
      }
    : null,
  version,
  date,
  counts: {
    studies: manifest.counts.extracted_studies_total,
    arms: manifest.counts.extracted_arms_total,
    findings: manifest.counts.extracted_atomic_effects_total,
    cegScreened: manifest.counts.ceg_screened_records_total,
    cegStudies: manifest.counts.ceg_studies_total,
    cegArms: manifest.counts.ceg_arms_total,
    cegOutcomes: manifest.counts.ceg_outcomes_total,
    cegLinks: manifest.counts.ceg_blueprint_links_total,
    designs: rankings.total_valid_combinatorial_stacks_evaluated,
    feasible: rankings.total_feasible_unblocked_stacks,
    blocked: rankings.total_graveyard_blocked_stacks,
    graveyardRules: manifest.counts.graveyard_entries_total,
    pinnedFiles: Array.isArray(artifacts) ? artifacts.length : Object.keys(artifacts).length,
    // Layers 2 to 5 of the blueprint.
    constructs: manifest.counts.layer2_construct_cassettes_total,
    dnaChanges: manifest.counts.layer2_alphagenome_avi_snvs_archived,
    experimentalStructures: manifest.counts.layer3_pdb_experimental_structures_verified,
    predictedStructures: manifest.counts.layer3_alphafold_structures_verified,
    proteinPairs: manifest.counts.layer3_immune_synapse_complexes_verified,
    guides: manifest.counts.layer5_crispr_guides_compiled,
    virtualPatients: manifest.counts.layer5_virtual_patients_simulated,
  },
  designs,
  // Share of the total spread in design scores, as percentages that add up to 100.
  variance: { assumptions: total, overlap: round(100 - total - findings, 2), findings },
};
stageWrite(join(root, 'src/data/release.json'), JSON.stringify(release, null, 2) + '\n');
console.log(`staged release.json (${version}, ${release.counts.studies} studies, ${release.counts.designs} designs)`);

// After the open draft opens (1 November 2026), a new release needs a line in the changelog. Until then the changelog is empty on purpose:
// nothing done before release is reported (Kev, 26 October 2026), so there is no entry to compare with and no warning.
const changelogPath = join(root, 'src/data/changelog.json');
if (existsSync(changelogPath)) {
  const latest = (await readJson(changelogPath))[0]?.version;
  if (latest && latest !== version && !latest.includes(version)) {
    console.warn(
      `The changelog stops at ${latest}, but the repository is at ${version}. ` +
        `Add a line with: npm run changelog -- --version ${version} --title "..." --summary "..." --added "..."`,
    );
  }
}

// ---- Full citations for the blueprint specification ----
// Every paper cited in the specification is linked as [Author 2024](#ref-PMID). The details come from the
// repository's study records. Papers outside the 563 studies go in src/data/references.extra.json.

const specPath = join(root, 'src/content/blueprint-spec.md');
if (existsSync(specPath)) {
  const spec = await readFile(specPath, 'utf8');
  const cited = [...new Set([...spec.matchAll(/#ref-(\d{5,9})/g)].map((m) => m[1]))];
  const extraPath = join(root, 'src/data/references.extra.json');
  const extra = existsSync(extraPath) ? await readJson(extraPath) : {};
  const references = {};
  for (const pmid of cited) {
    const record = join(repo, 'data/dossiers', `${pmid}.json`);
    if (existsSync(record)) {
      const d = JSON.parse((await readPinnedSource(repo, manifest, `data/dossiers/${pmid}.json`)).toString('utf8'));
      references[pmid] = {
        pmid,
        title: d.title,
        authors: d.authors ?? [],
        journal: d.journal,
        year: d.pub_year,
        doi: d.doi,
      };
    } else if (extra[pmid]) {
      references[pmid] = { pmid, ...extra[pmid] };
    } else {
      console.warn(`No citation details for PMID ${pmid}. Add it to src/data/references.extra.json.`);
      references[pmid] = { pmid };
    }
  }
  stageWrite(join(root, 'src/data/references.json'), JSON.stringify(references, null, 2) + '\n');
  console.log(`staged references.json (${cited.length} papers)`);
}

// Retire only files that the previous generated download index owned.
if (existsSync(sizesPath)) {
  const priorDownloads = await readJson(sizesPath);
  for (const rel of Object.keys(priorDownloads)) {
    if (!Object.hasOwn(sizes, rel)) {
      assertPublicDownload({ public_export_file_inventory: [rel] }, rel);
      stagedWrites.set(join(root, 'public/downloads', rel), null);
    }
  }
}
await publishFiles(root, stagedWrites, { lock: syncLock });
console.log(`published ${stagedWrites.size} files from one verified science export`);
} finally {
  if (syncWorkspace) await rm(syncWorkspace, { recursive: true, force: true });
  syncLock.release();
}
