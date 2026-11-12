#!/usr/bin/env node
// Builds a versioned, immutable data bundle for the connector.
//
//   npm run export    science repo  -> connector/export   (the public files only; read-only on the science repo)
//   npm run bundle    export + website content -> connector/bundle/<id>/
//
// The bundle is what the connector serves. Everything in it is already public: the export drops the source texts and
// caps verbatim quotes, and this script adds the website's plain-English content (read from the website's own source
// files, so the connector and the site never disagree). A bundle is described by meta.json, which lists every file
// with its SHA-256, and by one fingerprint over the whole set. A locked version is never rebuilt.
//
// Options: --id islet-1-draft  --name "Islet-1 open draft"  --export <dir>  --out <dir>  --frozen  --doi <doi>
import { validateDestination, verifyPublicExport, readPublicArtifact, writeBundleAtomically } from './bundle-io.mjs';
import { build } from 'esbuild';
import { acquireSyncLock } from '../../scripts/sync-io.mjs';
import { isDeepStrictEqual } from 'node:util';
import { readRegularFile } from './regular-files.mjs';
import MiniSearch from 'minisearch';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const connector = path.resolve(here, '..');
const website = path.resolve(connector, '..');

// ---------------------------------------------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------------------------------------------
const opts = { id: 'islet-1-draft', name: null, export: path.join(connector, 'export'), out: null, frozen: false, doi: null };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--frozen') opts.frozen = true;
  else if (a === '--id') opts.id = process.argv[++i];
  else if (a === '--name') opts.name = process.argv[++i];
  else if (a === '--export') opts.export = path.resolve(process.argv[++i]);
  else if (a === '--out') opts.out = path.resolve(process.argv[++i]);
  else if (a === '--doi') opts.doi = process.argv[++i];
  else throw new Error(`Unknown option ${a}`);
}
const outDir = opts.out ?? path.join(connector, 'bundle', opts.id);
const buildLock = await acquireSyncLock(website);
try {
validateDestination(outDir, opts.id, [website, opts.export]);
const verifiedManifest = verifyPublicExport(opts.export);
const verifiedManifestBytes = readRegularFile(opts.export, 'manifest.json');
await import('./sync-tool-schemas.mjs');

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const readExport = rel => rel === 'manifest.json' ? verifiedManifestBytes : readPublicArtifact(opts.export, verifiedManifest, rel);
const readJson = rel => JSON.parse(readExport(rel).toString('utf8'));
const exists = (rel) => fs.existsSync(path.join(opts.export, rel));

/** Every file in the bundle: path -> Buffer. Written in one go at the end. */
const files = new Map();
function put(rel, data, { pretty = true } = {}) {
  let buf;
  if (Buffer.isBuffer(data)) buf = data;
  else if (typeof data === 'string') buf = Buffer.from(data, 'utf8');
  else buf = Buffer.from((pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data)) + '\n', 'utf8');
  if (files.has(rel)) throw new Error(`Bundle file written twice: ${rel}`);
  files.set(rel, buf);
}

if (!fs.existsSync(path.join(opts.export, 'manifest.json'))) {
  throw new Error(`No public export at ${opts.export}. Run "npm run export" first.`);
}

// ---------------------------------------------------------------------------------------------------------------
// The website's own content, compiled in memory
// ---------------------------------------------------------------------------------------------------------------
async function loadSite() {
  const result = await build({
    entryPoints: [path.join(here, 'site-entry.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    loader: { '.json': 'json' },
    define: {
      // The bundle describes the project as it will be on launch day: real contributions only, scores visible.
      // Any other import.meta.env value the site reads is simply undefined here.
      'import.meta.env': '{}',
      'import.meta.env.PUBLIC_SHOW_SAMPLE_LEADERBOARDS': '"false"',
      'import.meta.env.PUBLIC_CONNECTOR_STATUS': '"planned"',
      'import.meta.env.PUBLIC_HERO_BACKGROUND': '"photo"',
      'import.meta.env.PUBLIC_SHOW_SCENARIO_INDICES': '"true"',
      'import.meta.env.PUBLIC_SUBMISSIONS_OPEN': '"false"',
    },
    logLevel: 'silent',
  });
  const code = result.outputFiles[0].text;
  try {
    return await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  } catch (error) {
    const message = String(error?.stack ?? error).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<website content>');
    throw new Error(`Could not load the website's content (src/data). ${message.split('\n').slice(0, 6).join('\n')}`);
  }
}
const site = await loadSite();
const { release, fillTokens, specTokens } = site;
if (release.source_manifest_sha256 !== sha256(verifiedManifestBytes)
  || release.source_ranking_sha256 !== verifiedManifest.artifacts['data/extracted/islet1_candidate_stack_rankings.json']?.sha256) {
  throw new Error("Website numbers do not belong to this public export: this website copy and the blueprint repository are from different releases. Use the blueprint release this website was built from (src/data/release.json names its version and date). If you maintain both, run npm run sync-data and export again.");
}

// ---------------------------------------------------------------------------------------------------------------
// Plain-English words for the codes in the data
// ---------------------------------------------------------------------------------------------------------------
const TIERS = {
  Tier_1_Human_InVivo: 'Human, in the body',
  Tier_2A_Human_Cells_InVivo_NHP_or_HumanizedMouse: 'Human cells in animals (monkey or humanised mouse)',
  Tier_2B_Human_Cells_InVitro_HumanImmune_or_AutoAb_CoCulture: 'Human cells in a dish with human immune cells or autoantibodies',
  Tier_3_Human_Cells_AbioticStress_or_ImmunodeficientMouse: 'Human cells under stress, or in immunodeficient mice',
  Tier_4_Rodent_or_Xenogeneic_Only: 'Rodent or other-species cells only',
};
const SOURCES = {
  Abstract_Only: 'Abstract only',
  FullText_XML_or_PDF: 'Full text',
  FullText_Plus_Supplement_or_GEO: 'Full text and supplement',
  Preprint_Superseded_By_Peer_Reviewed: 'Preprint, replaced by the published paper',
  Project_Summary: 'Project summary, not a published study',
  Review_or_Commentary: 'Review or commentary, not primary empirical evidence',
};
const DIRECTIONS = { Protective_or_Improved: 'protective', Deleterious_or_Impaired: 'deleterious', Neutral_or_NonInferior: 'neutral' };
const PILLARS = {
  Pillar1_Differentiation_Maturation_Cytoarchitecture: 'Making the cells',
  Pillar2_Immune_Cloaking_Autoantigen_Neoantigen_Stealth: 'Hiding from the immune system',
  Pillar3_Intrinsic_BetaCell_Genetic_Resilience_Amyloid_Viral: 'Cell resilience',
  Pillar4_Engraftment_Vascularization_Oxygenation_Devices: 'Engraftment, blood supply and oxygen',
};
// Which of the five tests a finding bears on. Our grouping, for browsing: it is not a claim made by the paper.
const DOMAIN_TESTS = {
  Differentiation_Yield_and_Lineage_Purity: ['1'],
  Metabolic_and_Biphasic_GSIS_Maturation: ['1'],
  Alpha_Delta_Paracrine_CounterRegulation: ['1'],
  Allo_T_Cell_or_DSA_Survival: ['2A'],
  Surface_HLA_or_Transgene_Expression_Level: ['2A', '3'],
  Autoimmune_TCR_or_AutoAb_Evasion: ['2B'],
  NK_or_Macrophage_Innate_Survival: ['3'],
  Complement_or_IBMIR_Coagulation_Block: ['3'],
  Cytokine_IFN_NFkB_or_ER_Stress_Survival: ['4'],
  Granzyme_or_Fas_Apoptosis_Resistance: ['4'],
  Amyloid_hIAPP_or_Enterovirus_Protection: ['4'],
  Hypoxia_72h_or_Vascular_Inosculation: ['5'],
  InVivo_Glycemic_Cure_and_Graft_Longevity: [],
};
const AXIS_NAMES = {
  allo: 'Immune cloak (hiding from donor-cell rejection)',
  autoantigen: 'Autoimmune targets',
  cytokine: 'Protection from inflammation and killer-cell toxins',
  er_stress: 'Cell stress and amyloid',
  niche: 'Graft environment (blood supply and oxygen)',
  safety: 'Safety switch',
};
const tidy = (s) => String(s ?? '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
// The data calls the five tests "gates"; the blueprint and the website call them tests.
const plainTests = (s) => String(s ?? '').replace(/\bGate\s?(\d)/g, 'Test $1');
const REDACTED = /^\[REDACTED_NON_OA_EXCERPT: see PMID:(\d+) (.*?)(?: genes=([A-Za-z0-9_,-]+))?(?: pert=(?:GOF_OE|KO_LOF|BOTH|NONE))? quote_sha256=([0-9a-f]{64})\]$/;
const isRedacted = (s) => typeof s === 'string' && s.startsWith('[REDACTED_NON_OA_EXCERPT:');

// ---------------------------------------------------------------------------------------------------------------
// Read the public export
// ---------------------------------------------------------------------------------------------------------------
const extractedDir = path.join(opts.export, 'data', 'extracted');
const studyNames = fs
  .readdirSync(extractedDir)
  .filter((f) => /^\d+\.json$/.test(f))
  .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));
const studies = studyNames.map(f => {
  const study = readJson(`data/extracted/${f}`);
  if (String(study.study_metadata?.pmid) !== f.slice(0, -5)) throw new Error('Study filename and PMID differ.');
  return study;
});
const findingsExport = readExport('data/extracted/ring1_atomic_effects_v0.5.jsonl').toString('utf8')
  .split('\n')
  .filter(Boolean)
  .map((l) => JSON.parse(l));
const graph = readJson('data/extracted/cross_study_discovery_graph.json');
const graveyardRaw = readJson('data/graveyard/idea_graveyard_v0.5.json');
const exportManifest = readJson('manifest.json');

// Python reads the design modules, because that is where the science repo keeps them.
const modulesDump = JSON.parse(
  execFileSync('python3', ['-B', path.join(here, 'golden-graveyard.py'), '--repo', opts.export, '--modules-only'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  }),
);

// ---------------------------------------------------------------------------------------------------------------
// Genes: one vocabulary, used to tag studies and findings so they can be searched and filtered by gene
// ---------------------------------------------------------------------------------------------------------------
const GENE_ALIASES = { 'PD-L1': 'CD274', PDL1: 'CD274', ICASP9: 'CASP9', 'ICASP-9': 'CASP9', 'HLA-E*01:03': 'HLA-E' };
const DESIGN_GENES = [
  'B2M', 'CIITA', 'CD47', 'HLA-E', 'HLA-A', 'HLA-B', 'HLA-C', 'TYK2', 'CXCL10', 'SERPINB9', 'CD274', 'CASP9', 'INS', 'IAPP', 'CXADR',
  'GAD2', 'G6PC2', 'SLC30A8', 'PTPN2', 'TNFAIP3', 'STAT1', 'JAK1', 'JAK2', 'RNLS', 'TXNIP', 'FASLG', 'NLRC5', 'PDX1', 'NKX6-1', 'MAFA',
  'CTLA4', 'SLC18A1', 'GCG', 'SST',
];
const vocab = new Set(DESIGN_GENES);
const splitSymbols = (s) => String(s).split('_').filter((p) => /^[A-Z][A-Z0-9-]+$/.test(p) && !/^[A-Z]\d+[A-Z]$/.test(p));
for (const key of Object.keys(graph.target_gene_atlas)) splitSymbols(key).forEach((g) => vocab.add(g));
for (const m of Object.values(modulesDump.modules)) m.genes.forEach((g) => vocab.add(g));
for (const s of studies) for (const arm of s.arms) for (const ed of arm.gate2_3_4_genetic_and_epitope_edits ?? []) if (ed.gene_symbol_hgnc) splitSymbols(ed.gene_symbol_hgnc).forEach((g) => vocab.add(g));
const geneList = [...vocab].sort();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const geneMatchers = [
  ...geneList.map((g) => ({ gene: g, re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(g)}(?![A-Za-z0-9-])`, g.length >= 4 ? 'i' : '') })),
  ...Object.entries(GENE_ALIASES).map(([alias, g]) => ({ gene: g, re: new RegExp(`(?<![A-Za-z0-9])${escapeRe(alias)}(?![A-Za-z0-9-])`, 'i') })),
];
function genesIn(...texts) {
  const found = new Set();
  const joined = texts.filter((t) => t && !isRedacted(t)).join(' | ');
  if (joined) for (const { gene, re } of geneMatchers) if (re.test(joined)) found.add(gene);
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// The rights guard.
//
// The public export caps verbatim quotes at 240 characters per paper, but several other fields in it still hold
// sentences copied from the papers (above all outcome_variable_Y, the first 140 characters of each source sentence).
// The connector must never serve more of a paper than that cap, so this step withholds those fields. Where the source
// texts are on this machine, the checks at the end of the build prove none remain.
// ---------------------------------------------------------------------------------------------------------------
const WITHHELD = (what) => `[WITHHELD: the paper's own wording (${what})]`;
const outcomeLabel = (domain) => `Outcome area: ${tidy(domain)} (the study's own wording is withheld)`;
const guardStats = { outcome_wording: 0, modifier_conditions: 0, variant_descriptions: 0, residual_wording: 0 };
const longPlain = (v) => typeof v === 'string' && v.length >= 40 && !isRedacted(v) && !v.startsWith('[WITHHELD');

function guardOutcome(effect, count = false) {
  const quote = effect.verbatim_evidence_quote ?? '';
  const y = String(effect.outcome_variable_Y ?? '').trim();
  const covered = y && !isRedacted(quote) && quote.includes(y);
  if (y && !covered) {
    if (count) guardStats.outcome_wording++;
    return outcomeLabel(effect.outcome_domain);
  }
  return y;
}

function guardStudy(study) {
  const s = structuredClone(study);
  for (const e of s.atomic_effects) e.outcome_variable_Y = guardOutcome(e, true);
  for (const m of s.effect_modifier_interactions ?? []) {
    for (const [k, v] of Object.entries(m)) {
      if ((/condition_and_effect$/.test(k) || k === 'mechanistic_explanation') && longPlain(v)) {
        m[k] = WITHHELD(k);
        guardStats.modifier_conditions++;
      }
    }
  }
  for (const arm of s.arms ?? []) {
    for (const ed of arm.gate2_3_4_genetic_and_epitope_edits ?? []) {
      const c = ed.sub_molecular_coordinate;
      if (c && longPlain(c.exact_variant_or_swap_description)) {
        c.exact_variant_or_swap_description = WITHHELD('exact_variant_or_swap_description');
        guardStats.variant_descriptions++;
      }
    }
  }
  for (const r of s.cross_study_discovery_bridges?.residual_failure_and_escape_vectors ?? []) {
    for (const k of ['residual_loss_or_limitation', 'escape_mechanism_identified']) {
      if (longPlain(r[k])) {
        r[k] = WITHHELD(k);
        guardStats.residual_wording++;
      }
    }
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------------
// Studies and findings
// ---------------------------------------------------------------------------------------------------------------
const studyByPmid = new Map(studies.map((s) => [String(s.study_metadata.pmid), s]));
const kindOf = (t) => (t === 'Project_Summary' ? 'project_summary' : t === 'Preprint_Superseded_By_Peer_Reviewed' ? 'superseded_preprint' : t === 'Review_or_Commentary' ? 'review_or_commentary' : 'study');
const pubmedUrl = (pmid) => `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;

const findings = [];
const exportFindingIds = new Set();
for (const f of findingsExport) {
  const study = studyByPmid.get(String(f.pmid));
  if (!study) throw new Error(`Finding ${f.effect_id} points at PMID ${f.pmid}, which has no study file.`);
  const meta = study.study_metadata;
  const inStudy = study.atomic_effects.find((e) => e.effect_id === f.effect_id);
  if (!inStudy) throw new Error(`Finding ${f.effect_id} is missing from the study file for PMID ${f.pmid}.`);
  if (inStudy.verbatim_evidence_quote !== f.verbatim_evidence_quote) {
    throw new Error(`The quote for ${f.effect_id} differs between the findings list and the study file.`);
  }
  if (exportFindingIds.has(f.effect_id)) throw new Error(`Duplicate finding: ${f.effect_id}`);
  for (const [key, value] of Object.entries(inStudy)) {
    if (!isDeepStrictEqual(value, f[key])) throw new Error(`Finding ${f.effect_id} differs from its study in ${key}.`);
  }
  if (f.source_text_type !== meta.source_text_type || (f.superseded_by_pmid ?? null) !== (meta.superseded_by_pmid ?? null)) throw new Error(`Finding ${f.effect_id} source classification differs from its study.`);
  exportFindingIds.add(f.effect_id);
  const quote = f.verbatim_evidence_quote ?? '';
  const red = REDACTED.exec(quote);
  const tagGenes = red?.[3] ? red[3].split(',').filter((g) => g && g !== 'NONE') : [];
  const genes = new Set([...tagGenes, ...genesIn(f.focal_factor_X, f.comparator_X0, f.outcome_variable_Y, quote)]);
  findings.push({
    id: f.effect_id,
    pmid: String(f.pmid),
    cite: `${meta.first_author} ${meta.pub_year}`,
    factor: plainTests(tidy(f.focal_factor_X)),
    comparator: tidy(f.comparator_X0),
    outcome: tidy(guardOutcome(f)),
    domain: f.outcome_domain,
    tests: DOMAIN_TESTS[f.outcome_domain] ?? [],
    direction: DIRECTIONS[f.effect_direction] ?? 'neutral',
    penalty: Boolean(f.secretome_or_differentiation_penalty_observed),
    quote: red ? null : quote,
    quote_sha256: red ? red[4] : null,
    span: f.source_span,
    table: f.source_figure_or_table || null,
    stat: {
      type: f.statistic_type,
      unit: f.measurement_unit,
      p: f.p_value,
      p_relation: f.p_value_relation ?? null,
      p_bound: f.p_value_bound ?? null,
      effect: f.log_response_ratio_or_smd,
      treatment_mean: f.treatment_mean,
      control_mean: f.control_mean,
      treatment_n: f.treatment_n,
      control_n: f.control_n,
    },
    tier: meta.max_biological_fidelity_tier,
    genes: [...genes].sort(),
  });
}
for (const s of studies) for (const e of s.atomic_effects) {
  if (!exportFindingIds.has(e.effect_id)) throw new Error(`Study ${s.study_metadata.pmid} has a finding (${e.effect_id}) that is not in the findings list.`);
}
findings.sort((a, b) => Number(a.pmid) - Number(b.pmid) || a.id.localeCompare(b.id, 'en', { numeric: true }));

const findingsByPmid = new Map();
for (const f of findings) (findingsByPmid.get(f.pmid) ?? findingsByPmid.set(f.pmid, []).get(f.pmid)).push(f);

const studyIndex = studies.map((s) => {
  const m = s.study_metadata;
  const pmid = String(m.pmid);
  const own = findingsByPmid.get(pmid) ?? [];
  const genes = new Set(own.flatMap((f) => f.genes));
  for (const arm of s.arms) for (const ed of arm.gate2_3_4_genetic_and_epitope_edits ?? []) if (ed.gene_symbol_hgnc) splitSymbols(ed.gene_symbol_hgnc).forEach((g) => genes.add(g));
  genesIn(m.title).forEach((g) => genes.add(g));
  return {
    pmid,
    title: m.title,
    first_author: m.first_author,
    senior_author: m.senior_author,
    year: m.pub_year,
    journal: m.journal,
    doi: m.doi,
    pmcid: m.pmcid,
    kind: kindOf(m.source_text_type),
    source_text: SOURCES[m.source_text_type] ?? tidy(m.source_text_type),
    source_text_type: m.source_text_type,
    tier: m.max_biological_fidelity_tier,
    tier_plain: TIERS[m.max_biological_fidelity_tier] ?? tidy(m.max_biological_fidelity_tier),
    areas: m.pillars_covered.map((p) => PILLARS[p] ?? tidy(p)),
    arms: s.arms.length,
    findings: own.length,
    tests: [...new Set(own.flatMap((f) => f.tests))].sort(),
    genes: [...genes].sort(),
    directions: Object.fromEntries(['protective', 'deleterious', 'neutral'].map((d) => [d, own.filter((f) => f.direction === d).length])),
    url: pubmedUrl(pmid),
  };
});
for (const s of studies) put(`studies/${s.study_metadata.pmid}.json`, guardStudy(s), { pretty: false });
put('studies/index.json', studyIndex, { pretty: false });
put('findings.jsonl', findings.map((f) => JSON.stringify(f)).join('\n') + '\n');

// ---------------------------------------------------------------------------------------------------------------
// Search index (MiniSearch). The options are the same ones the connector loads it with (src/core/search-config.json).
// ---------------------------------------------------------------------------------------------------------------
const searchConfig = JSON.parse(fs.readFileSync(path.join(connector, 'src', 'core', 'search-config.json'), 'utf8'));
const mini = new MiniSearch({ fields: searchConfig.fields, idField: searchConfig.idField });
mini.addAll([
  ...studyIndex.map((s) => ({
    id: `S:${s.pmid}`,
    title: s.title,
    authors: `${s.first_author} ${s.senior_author}`,
    journal: s.journal,
    genes: s.genes.join(' '),
    tests: s.tests.join(' '),
  })),
  ...findings.map((f) => ({
    id: `F:${f.id}`,
    factor: f.factor,
    comparator: f.comparator,
    outcome: f.outcome,
    quote: f.quote ?? '',
    genes: f.genes.join(' '),
    tests: f.tests.join(' '),
    domain: tidy(f.domain),
  })),
]);
put('search/index.json', JSON.stringify(mini) + '\n');

// ---------------------------------------------------------------------------------------------------------------
// The evidence graph, trimmed to what the tools answer from
// ---------------------------------------------------------------------------------------------------------------
const parseStudyRef = (s) => {
  const m = /^PMID:(\d+)(?: \((.*)\))?$/.exec(s);
  return m ? { pmid: m[1], cite: m[2] ?? null } : { pmid: null, cite: s };
};
const targetGenes = {};
for (const [key, v] of Object.entries(graph.target_gene_atlas)) {
  targetGenes[key] = {
    studies_count: v.studies_count,
    gates: v.functional_gates.map((g) => plainTests(tidy(g))),
    studies: v.studies.map(parseStudyRef),
  };
}
put('graph/target-genes.json', { genes: targetGenes, vocabulary: geneList, aliases: GENE_ALIASES });
const tradeoffs = graph.cross_gate_pleiotropic_discoveries.map((d) => {
  const ref = parseStudyRef(d.study);
  const red = REDACTED.exec(d.observation ?? '');
  return {
    pmid: ref.pmid,
    cite: ref.cite,
    primary: plainTests(tidy(d.primary_gate_perturbed)),
    secondary: plainTests(tidy(d.secondary_gate_affected)),
    kind: /Deleterious/.test(d.is_beneficial_synergy_or_deleterious_tradeoff) ? 'trade-off' : 'synergy',
    observation: red || !d.observation ? null : d.observation,
    observation_sha256: red ? red[4] : null,
  };
});
put('graph/tradeoffs.json', tradeoffs);
put('graph/summary.json', {
  studies: graph.validated_studies_count,
  arms: graph.total_arms_extracted,
  findings: graph.total_atomic_effects_extracted,
  modifier_interactions: graph.total_effect_modifier_interactions_extracted,
  causal_edges: graph.total_causal_mechanism_edges_extracted,
  chains: graph.multi_hop_cross_study_causal_chains_count,
  excluded_from_graph: {
    superseded_preprints: graph.superseded_preprint_records_excluded_from_graph,
    project_summaries: graph.project_summary_records_excluded_from_graph,
  },
  diagnostics: graph.corpus_epistemic_and_fidelity_diagnostics,
  thresholds: graph.regime_thresholds.map((t) => ({
    pmid: parseStudyRef(t.study).pmid,
    cite: parseStudyRef(t.study).cite,
    parameter: t.parameter_name,
    value: t.critical_threshold_value,
    unit: t.unit,
    below: isRedacted(t.below_threshold_behavior) ? null : t.below_threshold_behavior,
    above: isRedacted(t.above_threshold_behavior) ? null : t.above_threshold_behavior,
  })),
});

// ---------------------------------------------------------------------------------------------------------------
// The Idea Graveyard: the public rules, the design modules and the raw entries the linter reads
// ---------------------------------------------------------------------------------------------------------------
const sourceEntries = graveyardRaw.graveyard_entries;
const publicRules = site.rules.map((r) => {
  const src = r.source ? sourceEntries.find((e) => e.graveyard_id.startsWith(r.source)) : null;
  return {
    id: r.id,
    graveyard_id: src?.graveyard_id ?? null,
    title: r.title,
    level: r.level,
    level_plain: r.level === 'BLOCK' ? 'Dead end: a design that includes this idea scores zero' : 'Risky: a design that includes this idea needs a check before anyone relies on it',
    tests: r.tests,
    idea: r.idea,
    why: r.why,
    check: r.check,
    instead: r.instead,
    confidence: r.confidence,
    basis: r.basis,
    papers: r.papers,
    added: r.added,
    version: r.version,
    contribution: r.contribution ?? null,
    trigger_modules: src?.trigger_pattern?.requires_any_module ?? [],
    trigger_condition: src?.trigger_pattern?.condition ?? null,
    cheapest_falsification_assay: src?.cheapest_falsification_assay ?? null,
  };
});
put('graveyard/rules.json', publicRules);
put('graveyard/entries.json', sourceEntries);
put('graveyard/modules.json', {
  axes: Object.fromEntries(Object.entries(modulesDump.axes).map(([axis, ids]) => [axis, { name: AXIS_NAMES[axis], modules: ids }])),
  modules: modulesDump.modules,
});

// ---------------------------------------------------------------------------------------------------------------
// The five layers (atlases) and the construct sequences
// ---------------------------------------------------------------------------------------------------------------
const layerFiles = {
  evidence: 'layer1_context_evidence_graph_atlas.json',
  dna: 'layer2_regulatory_and_perturbation_atlas.json',
  proteins: 'layer3_structural_verification_atlas.json',
  tissue: 'layer4_tissue_and_metabolic_twin_atlas.json',
  patient: 'layer5_personalized_patient_and_crispr_atlas.json',
};
for (const [layer, file] of Object.entries(layerFiles)) put(`layers/${layer}.json`, readJson(`data/extracted/${file}`), { pretty: false });
const fastaName = fs.readdirSync(path.join(opts.export, 'data', 'constructs')).find((f) => f.endsWith('.fasta'));
if (fastaName) put('constructs/constructs.fasta', readExport(`data/constructs/${fastaName}`));

// ---------------------------------------------------------------------------------------------------------------
// The blueprint in plain English
// ---------------------------------------------------------------------------------------------------------------
const specRaw = fs.readFileSync(path.join(website, 'src', 'content', 'blueprint-spec.md'), 'utf8').replace(/^---\n[\s\S]*?\n---\n/, '');
const specTitle = /^title:\s*'(.*)'/m.exec(fs.readFileSync(path.join(website, 'src', 'content', 'blueprint-spec.md'), 'utf8'))?.[1] ?? 'Islet-1';
const publicLinks = (md) =>
  md
    .replace(/<!--figure:scores-->/, () => site.scoresTableMarkdown())
    .replace(/<!--figure:\w+-->\n?/g, '')
    .replace(/<a id="[^"]*"><\/a>\n*/g, '')
    .replace(/\]\(#ref-(\d+)\)/g, (_, id) => `](${pubmedUrl(id)})`)
    .replace(/\]\(\/(\w*)\)/g, (_, p) => `](https://openislet.org/${p})`);
const specFilled = publicLinks(fillTokens(specRaw)).replace(/\n{3,}/g, '\n\n').trim() + '\n';
const sections = [];
{
  const parts = specFilled.split(/^## /m);
  const lead = parts.shift();
  for (const part of parts) {
    const title = part.split('\n', 1)[0].trim();
    sections.push({ id: slug(title), title, markdown: `## ${part}`.trim() + '\n' });
  }
  if (lead.trim()) sections.unshift({ id: 'intro', title: 'Introduction', markdown: lead.trim() + '\n' });
}
function slug(s) {
  return s.toLowerCase().replace(/^\d+\.\s*/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
put('blueprint/spec.md', specFilled);
put('blueprint/sections.json', { title: specTitle, sections });

const MARK = { p: 'main job', s: 'helps', n: null, x: 'costs' };
const gateCodes = site.gateColumns.map((g) => g.code);
const marksToTests = (marks) => {
  const out = { main_job: [], helps: [], costs: [] };
  [...marks].forEach((c, i) => {
    if (c === 'p') out.main_job.push(gateCodes[i]);
    else if (c === 's') out.helps.push(gateCodes[i]);
    else if (c === 'x') out.costs.push(gateCodes[i]);
  });
  return out;
};
const scoreCaveat =
  `These scores are model estimates on a 0 to 1 scale, not predictions and not chances of success. ${specTokens.assumptions}% of the spread comes from the team's starting assumptions and only ${specTokens.findingsShare}% from published findings. ` +
  'They are Prior-Anchored Scenario Outputs: a structured way to compare designs and to see where the weak points are. Nothing in the blueprint has been tested in the lab yet.';
const designs = {};
for (const sc of site.scenarios) {
  const score = site.designScore(sc.id);
  designs[sc.id] = {
    id: sc.id,
    name: sc.name,
    headline: sc.headline,
    summary: sc.summary,
    for_whom: sc.aim,
    main_risk: sc.risk,
    ...(sc.proposals ? { still_on_paper: sc.proposals.map((p) => ({ title: p.title, text: p.text })) } : {}),
    gene_edits: score.edits,
    base_edits: score.baseEdits,
    edits: sc.rows.map((r) => ({ what: r.name, how: r.sub, ...marksToTests(r.marks) })),
    loci: sc.loci.map((l) => ({ id: l.id, title: l.title, action: l.action, tests: l.gates, notes: l.notes, pmids: l.pmids })),
  };
}
put('blueprint/scores.json', {
  caveat: scoreCaveat,
  scale: '0 to 1; a higher number is a better modelled outcome',
  designs: release.designs.map((d) => ({
    id: d.id,
    gene_edits: d.edits,
    base_edits: d.baseEdits,
    rank_in_model: d.rank,
    of: release.counts.designs,
    score_children: d.children,
    score_adults: d.adults,
    score_overall: d.composite,
    weakest_test: d.weakestTest,
    test_scores: d.tests,
  })),
  spread: { starting_assumptions_pct: release.variance.assumptions, overlap_pct: release.variance.overlap, published_findings_pct: release.variance.findings },
});
put('blueprint/overview.json', {
  title: 'Islet-1: an open blueprint for a personalised, drug-free cell therapy for type 1 diabetes',
  in_one_sentence:
    'Islet-1 is an open research blueprint for stem-cell-derived islets, with gene edits intended to reduce immune attack, proposed oxygen support and a safety switch requiring qualification. Nothing in it has been tested in the lab yet.',
  goal: {
    year: site.goal.year,
    text: `Our goal is to cure the first person with type 1 diabetes by ${site.goal.year}, by combining AI, robotics and a co-ordinated global effort. The project is open: anyone can take the blueprint up, test it or adapt it, and we ask only that the OpenIslet community is credited. The aim is to accelerate development while requiring evidence and safety checks before each clinical step.`,
  },
  release: { version: release.version, date: release.date },
  counts: release.counts,
  tests: site.gates.map((g) => ({ id: g.id, number: g.n, short: g.short, name: g.name, question: g.ask, explanation: g.explain, parts: g.parts ?? null })),
  designs,
  champion_challenger_portfolio: release.champion_challenger_portfolio ?? null,
  environment: site.niche.map((n) => ({ what: n.k, detail: n.v })),
  // Stage 0 is shown in full. Stages 1 to 5 are an outline only: no steps, numbers or pass/stop lines.
  roadmap: site.stages.map((s) => ({
    id: s.id,
    name: s.name,
    state: s.state,
    summary: s.summary,
    why: s.why,
    carried_out_by: s.who === 'project' ? 'The OpenIslet project, in the open, with its contributors' : 'A partner organisation, or any organisation that takes the open blueprint',
    ...(s.who === 'project'
      ? {
          points: s.points,
          a_pass_looks_like: s.pass,
          we_stop_or_change_the_plan_if: s.stop,
          not_known_yet: s.unknown,
          where_it_stands: s.gate,
          for_scientists: s.science,
        }
      : {}),
    when: s.timing ?? null,
  })),
  after_the_blueprint: {
    heading: site.afterBlueprint.heading,
    summary: site.afterBlueprint.oneLine,
    ways: site.afterBlueprint.ways.map((w) => ({ title: w.title, text: w.text })),
    note: site.afterBlueprint.note,
  },
  how_to_help: {
    steps: site.helpPaths.find((p) => p.id === 'ai').steps,
    guide: 'https://openislet.org/start',
    contact: { email: site.contact.email, x: site.social.x.handle },
    note: 'IIPs are published openly under CC BY 4.0. Software checks each one straight away (format, Idea Graveyard rules, quotes against the studies OpenIslet holds). In the weekend review a person looks the papers up on PubMed, reviews the science and decides. Everything is public, including the reasons.',
  },
});

// ---------------------------------------------------------------------------------------------------------------
// Versions, open questions, contributions
// ---------------------------------------------------------------------------------------------------------------
const changelog = JSON.parse(fs.readFileSync(path.join(website, 'src', 'data', 'changelog.json'), 'utf8'));
const V = site.versions;
put('versions/versions.json', {
  family: V.family,
  explainer: V.explainer,
  cadence: V.cadence.long,
  draft: {
    id: V.draft.id,
    name: V.draft.name,
    status: 'open draft',
    frozen: false,
    doi: null,
    opens: V.draft.opens,
    release_when_it_opens: V.draft.release,
    blueprint_release_in_this_bundle: release.version,
  },
  locked: [],
  planned: V.planned.map((p) => ({ id: p.id, name: p.name, status: 'planned', freeze_from: p.freezeFrom, lock_date: p.lock, frozen: false, doi: null })),
  history: changelog.map((c) => ({ version: c.version, date: c.date, title: c.title, summary: c.summary, contribution: c.contribution ?? null, changes: c.changes })),
});
const openQuestions = JSON.parse(fs.readFileSync(path.join(connector, 'data', 'open-questions.json'), 'utf8')).map((q) => ({
  ...q,
  plain: fillTokens(q.plain),
  detail: fillTokens(q.detail),
}));
put('questions/open-questions.json', openQuestions);

const siteLedger = JSON.parse(fs.readFileSync(path.join(website, 'src', 'data', 'contributions.json'), 'utf8'));
const issueNumber = (id) => Number.parseInt(id.replace(/^IIP-/, ''), 10);
const ledger = siteLedger.map((c) => ({
  id: c.id,
  issue: { number: issueNumber(c.id), url: `${site.repo.url}/issues/${issueNumber(c.id)}` },
  title: c.title,
  summary: fillTokens(c.summary),
  type: c.type,
  status: c.status,
  submitted_at: c.date,
  decided_at: c.decided ?? (c.outcome || c.status === 'merged' || c.status === 'declined' ? c.date : null),
  target_version: V.draft.id,
  landed_in: c.landed_in ?? null,
  founding: Boolean(c.founding),
  contributor: {
    handle: c.contributor.handle,
    kind: c.contributor.kind,
    github: c.contributor.github ?? null,
    orcid: null,
    verified: c.contributor.verified,
  },
  models: c.models,
  outcome: c.outcome ?? null,
  ...(c.follow_ups?.length ? { follow_ups: c.follow_ups } : {}),
}));
{
  const { default: Ajv } = await import('ajv/dist/2020.js');
  const { default: addFormats } = await import('ajv-formats');
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(JSON.parse(fs.readFileSync(path.join(website, 'docs', 'connector', 'contribution-ledger.schema.json'), 'utf8')));
  for (const rec of ledger) if (!validate(rec)) throw new Error(`Ledger record ${rec.id} does not match contribution-ledger.schema.json: ${ajv.errorsText(validate.errors)}`);
}
// No scores: each record's outcome is in words, and the words are the website's (src/data/contributions.ts).
put('contributions/ledger.json', {
  outcomes: site.outcomes,
  records: ledger,
});

// ---------------------------------------------------------------------------------------------------------------
// The prompts, and the structure check_draft holds drafts and reviews to (read from the same text the site shows)
// ---------------------------------------------------------------------------------------------------------------
function between(text, startMarker, endMarker) {
  const a = text.indexOf(startMarker);
  const b = text.indexOf(endMarker, a + startMarker.length);
  if (a < 0 || b < 0) throw new Error(`Cannot find "${startMarker}" … "${endMarker}" in the prompt text.`);
  return text.slice(a, b);
}
function parseStructure(block) {
  const out = { title: null, fields: [], headings: [] };
  for (const line of block.split('\n')) {
    let m;
    if ((m = /^# (.+)$/.exec(line))) out.title = m[1].replace(/\[.*?\]/g, '').trim().replace(/:$/, '');
    else if ((m = /^## (.+)$/.exec(line))) out.headings.push(m[1].trim());
    else if ((m = /^\*\*(.+?)([:?])\*\*\s*(.*)$/.exec(line))) {
      const bracket = /^\[(.*)\]$/.exec(m[3].trim())?.[1] ?? '';
      let options = null;
      if (bracket.includes(' | ')) options = bracket.split(' | ').map((o) => o.split(',')[0].trim());
      out.fields.push({ name: m[1].trim() + (m[2] === '?' ? '?' : ''), options });
    }
  }
  return out;
}
// The draft prompt ends with its template.
const draftStructure = parseStructure(between(`${site.draftPrompt}\n`, '# [Short title]', '\n[Your model name'));
const reviewStructure = parseStructure(between(site.reviewTemplate, '# Review: [short title]', '\n\nBe strict'));
if (!draftStructure.fields.length || !reviewStructure.fields.length) throw new Error('The prompt structure could not be read. Has the template in src/data/prompts.ts changed shape?');
put('prompts/structure.json', {
  draft: { ...draftStructure, title: 'Short title' },
  review: { ...reviewStructure, title: 'Review' },
  consent: 'CC BY 4.0',
  accepted_review_verdicts: ['Supported', 'Partly supported'],
});
put('prompts/draft.md', site.draftPrompt + '\n');
put('prompts/review-template.md', site.reviewTemplate + '\n');
put('prompts/submit.md', site.submitPrompt + '\n');
put('prompts/explore.json', site.explorePrompts);
put('roadmap/stages.json', site.stages);
put('release.json', release);

// ---------------------------------------------------------------------------------------------------------------
// Optional files the public export may gain later
// ---------------------------------------------------------------------------------------------------------------
const optionalMissing = [];
if (exists('ISLET-1-BLUEPRINT.md')) put('blueprint/full.md', readExport('ISLET-1-BLUEPRINT.md'));
else optionalMissing.push('ISLET-1-BLUEPRINT.md');

// ---------------------------------------------------------------------------------------------------------------
// The rights check. Where the source texts are on this machine (the science repo's local dossiers), prove that no
// sentence from a paper is in the bundle except the capped quotes and bibliographic details. Otherwise say so.
// ---------------------------------------------------------------------------------------------------------------
const CEILING = exportManifest.public_redistribution_allowlist_spec?.non_oa_per_article_aggregate_verbatim_ceiling_characters ?? 240;
function verifyRights() {
  const repo = process.env.OPENISLET_REPO ?? path.resolve(website, '..', 'OpenIslet');
  const dossierDir = path.join(repo, 'data', 'dossiers');
  const problems = [];
  // The ceiling holds with or without the source texts.
  const shownBy = new Map();
  for (const f of findings) if (f.quote !== null) shownBy.set(f.pmid, (shownBy.get(f.pmid) ?? 0) + f.quote.length);
  for (const [pmid, n] of shownBy) if (n > CEILING) problems.push(`PMID ${pmid}: ${n} quoted characters, over the ${CEILING} ceiling`);
  if (!fs.existsSync(dossierDir)) return { checked: false, problems };

  const norm = (s) => s.replace(/\s+/g, ' ').trim();
  const leaves = (o, acc = []) => {
    if (typeof o === 'string') acc.push(o);
    else if (Array.isArray(o)) o.forEach((x) => leaves(x, acc));
    else if (o && typeof o === 'object') Object.values(o).forEach((x) => leaves(x, acc));
    return acc;
  };
  const paths = (o, at = '', acc = []) => {
    if (typeof o === 'string') acc.push([at, o]);
    else if (Array.isArray(o)) o.forEach((x, i) => paths(x, `${at}[${i}]`, acc));
    else if (o && typeof o === 'object') Object.entries(o).forEach(([k, x]) => paths(x, `${at}.${k}`, acc));
    return acc;
  };
  const hay = new Map();
  for (const f of fs.readdirSync(dossierDir).filter(n => n.endsWith('.json'))) {
    const rel = `data/dossiers/${f}`, pin = verifiedManifest.artifacts[rel];
    const bytes = readRegularFile(repo, rel);
    if (!pin || sha256(bytes) !== pin.sha256 || bytes.length !== pin.bytes) throw new Error(`Private source changed since export: ${rel}`);
    hay.set(f.slice(0, -5), norm(leaves(JSON.parse(bytes.toString('utf8'))).join(' ')));
  }
  const all = [...hay.values()].join('\n');
  const inSource = (text, haystack) => text.length >= 40 && !isRedacted(text) && haystack.includes(norm(text));

  for (const s of studies) {
    const pmid = String(s.study_metadata.pmid);
    const h = hay.get(pmid);
    if (!h) continue;
    const g = JSON.parse(files.get(`studies/${pmid}.json`).toString('utf8'));
    const m = g.study_metadata;
    const allowed = new Set([m.title, m.journal, m.first_author, m.senior_author]);
    for (const e of g.atomic_effects) {
      allowed.add(e.verbatim_evidence_quote);
      // The outcome wording is allowed where the shown quote already contains it: it adds nothing beyond the quote.
      if (!isRedacted(e.verbatim_evidence_quote) && e.verbatim_evidence_quote.includes(e.outcome_variable_Y)) allowed.add(e.outcome_variable_Y);
    }
    for (const [at, text] of paths(g)) if (!allowed.has(text) && inSource(text, h)) problems.push(`PMID ${pmid} ${at.replace(/\[\d+\]/g, '[]')}: source wording in the study file: "${text.slice(0, 60)}…"`);
  }
  for (const f of findings) {
    const h = hay.get(f.pmid);
    for (const [field, text] of [['outcome', f.outcome], ['factor', f.factor], ['comparator', f.comparator]]) {
      if (h && inSource(text, h) && !(f.quote && norm(f.quote).includes(norm(text)))) problems.push(`${f.id}: source wording in findings.jsonl (${field}): "${text.slice(0, 70)}…"`);
    }
  }
  for (const [rel, buf] of files) {
    if (/^(studies\/|findings\.jsonl|search\/|meta\.json)/.test(rel)) continue;
    const pieces = rel.endsWith('.json') ? leaves(JSON.parse(buf.toString('utf8'))) : buf.toString('utf8').split(/\n+|(?<=[.!?])\s+/);
    for (const text of pieces) {
      if (inSource(text, all)) problems.push(`${rel}: source wording: "${text.slice(0, 70)}…"`);
    }
  }
  return { checked: true, problems, sources: hay.size };
}
const rights = verifyRights();
if (rights.problems.length) {
  throw new Error(`The rights check failed (${rights.problems.length} problems). The first ones:\n  ${rights.problems.slice(0, 12).join('\n  ')}`);
}

// ---------------------------------------------------------------------------------------------------------------
// meta.json: what this bundle is, where it came from, and every file with its SHA-256
// ---------------------------------------------------------------------------------------------------------------
function git(args) {
  const repo = process.env.OPENISLET_REPO ?? path.resolve(website, '..', 'OpenIslet');
  try {
    return execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}
const exportFiles = [...verifiedManifest.public_export_file_inventory].sort()
  .map(rel => `${rel}:${verifiedManifest.artifacts[rel].sha256}`);
exportFiles.push(`manifest.json:${sha256(verifiedManifestBytes)}`);

const list = [...files.entries()]
  .sort(([a], [b]) => (a < b ? -1 : 1))
  .map(([p, buf]) => ({ path: p, bytes: buf.length, sha256: sha256(buf) }));
const fingerprint = sha256(list.map((f) => `${f.path}\t${f.sha256}`).join('\n'));
const dirtyLines = git(['status', '--porcelain']);

const meta = {
  schema: 'openislet-bundle/1',
  id: opts.id,
  name: opts.name ?? (opts.id === V.draft.id ? V.draft.name : opts.id),
  family: V.family,
  frozen: opts.frozen,
  doi: opts.doi,
  blueprint_release: release.version,
  release_date: release.date,
  fingerprint,
  counts: {
    studies: studies.length,
    arms: studies.reduce((n, s) => n + s.arms.length, 0),
    findings: findings.length,
    designs: release.counts.designs,
    feasible: release.counts.feasible,
    blocked: release.counts.blocked,
    graveyard_rules: publicRules.length,
    open_questions: openQuestions.length,
    genes: geneList.length,
  },
  licence: {
    summary: 'Project-authored data and text: CC BY 4.0. Code: Apache-2.0. Third-party verbatim excerpts remain the copyright of their authors and publishers and are capped at 240 characters per paper.',
    credit: 'Credit the OpenIslet community (https://openislet.org).',
  },
  quote_policy: {
    per_paper_verbatim_ceiling_characters: exportManifest.public_redistribution_allowlist_spec?.non_oa_per_article_aggregate_verbatim_ceiling_characters ?? 240,
    withheld_quotes: findings.filter((f) => f.quote === null).length,
    shown_quotes: findings.filter((f) => f.quote !== null).length,
    note: 'Where a quote is withheld the bundle keeps the SHA-256 fingerprint of the original sentence, its location in the paper (source_span) and the PubMed link.',
    guard: {
      description:
        "The public export applies an article-wide cap across source-derived wording. This connector additionally withholds outcome wording where the quote is withheld, effect-modifier conditions, variant descriptions and residual-limitation text.",
      withheld: guardStats,
      verified_against_source_texts: rights.checked,
      source_texts_checked: rights.sources ?? 0,
    },
  },
  mapping: {
    tests_from_outcome_domain: DOMAIN_TESTS,
    tiers: TIERS,
    note: 'The test tags group findings by what they measured, for browsing. They are the project\'s grouping, not a claim made by the paper.',
  },
  source: {
    export_files: exportFiles.length,
    export_fingerprint: sha256(exportFiles.join('\n')),
    export_release: exportManifest.release_stage ?? null,
    science_repo_commit: git(['rev-parse', 'HEAD']),
    science_repo_uncommitted_changes: dirtyLines === null ? null : dirtyLines.split('\n').filter(Boolean).length,
    website_release: release.version,
  },
  optional_missing: optionalMissing,
  files: list,
};
put('meta.json', meta);

// ---------------------------------------------------------------------------------------------------------------
// Write it out. A locked bundle that already exists is never overwritten with different content.
// ---------------------------------------------------------------------------------------------------------------
if (!readRegularFile(opts.export, 'manifest.json').equals(verifiedManifestBytes)) throw new Error('Public manifest changed during connector build.');
verifyPublicExport(opts.export);
writeBundleAtomically(outDir, opts.id, files, [website, opts.export]);
const total = [...files.values()].reduce((n, b) => n + b.length, 0);
console.log(`Bundle ${opts.id}: ${files.size} files, ${(total / 1048576).toFixed(1)} MB, fingerprint ${fingerprint.slice(0, 16)}…`);
console.log(`  ${meta.counts.studies} studies, ${meta.counts.findings} findings (${meta.quote_policy.shown_quotes} quotes shown, ${meta.quote_policy.withheld_quotes} withheld), ${meta.counts.genes} genes`);
console.log(`  ${meta.counts.graveyard_rules} Idea Graveyard rules, ${meta.counts.open_questions} open questions, written to ${path.relative(process.cwd(), outDir) || '.'}`);
if (optionalMissing.length) console.log(`  not in the public export yet: ${optionalMissing.join(', ')}`);

} finally { buildLock.release(); }
