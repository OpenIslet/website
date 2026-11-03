// The Idea Graveyard checker.
//
// "Exact" mode is a port of evaluate_graveyard_rules_for_stack() in the science repo's scripts/rank_islet1_stacks.py.
// It works on named design modules, not free text, and tests/graveyard.contract.test.ts proves it gives the same answer
// as the Python for every design. "Suggest" mode is retrieval: it compares an idea in words with the rules and
// says so, because words are not modules.
import MiniSearch from 'minisearch';
import type { Bundle } from './bundle';
import { resolveGene } from './search';
import { clip, normalise, tidy } from './text';
import type { GraveyardEntry, GraveyardRule, Level, ModulesFile } from './types';

export const AXES = ['allo', 'autoantigen', 'cytokine', 'er_stress', 'niche', 'safety'] as const;
export type Axis = (typeof AXES)[number];
export type Selection = Record<Axis, string>;

export interface Triggered {
  graveyard_id: string;
  severity_level: Level;
  reason: string;
  evidence_tier?: string;
  evaluator_logit_delta?: number;
  evaluator_target_gate?: string;
  evaluator_disposition_rule?: string;
}

interface RuleSpec {
  /** The full id used in idea_graveyard_v0.5.json. */
  id: string;
  /** Modules that trigger the rule if the JSON does not name any. */
  defaults: string[];
  severity: Level;
  /** For rules that also report the curation status, the default status. */
  tier?: string;
  /** For rules that report evaluator_disposition_rule, the default disposition string. */
  disposition?: string;
  /** For those rules, the default score discount (in logits) and the test it applies to. The Graveyard data can override both. */
  logitDelta?: number;
  targetGate?: string;
  /** An extra condition beyond the modules (rule 10 needs no autoantigen edit). */
  extra?: (sel: Selection) => boolean;
  /** Rules that depend on the number of base edits rather than a module. */
  baseEditsAtLeast?: number;
  reason: (totalB: number) => string;
}

// Order, wording and defaults are copied from the Python. Do not tidy the sentences: the contract test compares them.
const RULES: RuleSpec[] = [
  {
    id: 'GRAVEYARD_001_STAT1_JAK1_KO_WITH_GAS_IND_PROMOTER',
    defaults: ['CYTO_STAT1_OR_TYK2_CLONAL_KO_WITH_GAS_IND_PDL1'],
    severity: 'BLOCK',
    reason: () => 'Clonal STAT1-/- blocks GAS/ISRE promoter induction of PD-L1/SERPINB9 (Sintov 2022 PMID:36055241; Parent 2021 PMID:34407395).',
  },
  {
    id: 'GRAVEYARD_002_LINEAGE_RESTRICTED_G6PC2_OR_INS_ICASP9_SUICIDE_SWITCH',
    defaults: ['SAF_G6PC2_ENDOGENOUS_ICASP9'],
    severity: 'BLOCK',
    reason: () =>
      'Lineage-restricted (G6PC2::iCasp9) suicide switch fails to ablate dedifferentiated, teratoma, or SLC18A1+ off-target cells (PMID:27626039, PMID:35795779).',
  },
  {
    id: 'GRAVEYARD_003_G6PC2_NULL_FASTING_HYPOGLYCEMIA_RISK',
    defaults: ['AUTO_FULL_KO_G6PC2_SLC30A8_PLUS_BASE_INS_GAD2_IAPP_CXADR'],
    severity: 'WARN',
    tier: 'precautionary_mechanistic_hazard',
    reason: () =>
      'Precautionary mechanistic hazard: Biallelic G6PC2-/- shifts the beta-cell glucose dose-response curve leftward and lowers fasting blood glucose (Bosma 2020 PMID:32569842; Overway 2022 PMID:34954144).',
  },
  {
    id: 'GRAVEYARD_004_RNLS_KO_HUMAN_IPSC_BETA_GSIS_AND_OCR_TRADEOFF',
    defaults: ['ER_RNLS_KO', 'ER_RNLS_KO_PLUS_IAPP_PRAMLINTIDE'],
    severity: 'WARN',
    reason: () =>
      'Human RNLS-/- iPSC-beta aggregates show elevated basal OCR while poor dynamic GSIS persisted in both WT and RNLS KO in MacDonald et al. 2025 Fig. 6 (PMID:39988068 vs mouse NIT-1 screen Cai et al. 2020 PMID:32719542).',
  },
  {
    id: 'GRAVEYARD_005_HLA_C_MINUS21T_LEADER_PEPTIDE_NKG2A_BLINDSPOT',
    defaults: ['ALLO_HLA_C_RETAINED_SUPERDONOR_PLUS_TYK2_KO'],
    severity: 'WARN',
    reason: () =>
      'Requires HLA-C haplotype selection (Xu 2019 PMID:30853558) and empirical verification that a single retained HLA-C allele supplies sufficient leader peptide to stabilize surface HLA-E after HLA-A/HLA-B deletion (Ramsuran 2018 PMID:29302013; Parent 2021 PMID:34407395; Lin 2023 PMID:37264229).',
  },
  {
    id: 'GRAVEYARD_006_MULTIPLEX_BASE_PRIME_EDIT_NICKASE_TRANSLOCATIONS',
    defaults: ['AUTO_FULL_KO_G6PC2_SLC30A8_PLUS_BASE_INS_GAD2_IAPP_CXADR', 'ER_RNLS_KO_PLUS_IAPP_PRAMLINTIDE'],
    severity: 'WARN',
    baseEditsAtLeast: 2,
    reason: (b) =>
      `Multiplex base/prime editing (B=${b}) carries precautionary nickase single-strand nick / DSB and deaminase bystander structural-variant risk (extrapolated from Wu 2024 PMID:39529170).`,
  },
  {
    id: 'GRAVEYARD_007_HIGH_PLI_KNOCKOUTS_PTPN2_TNFAIP3_GAD2',
    defaults: ['AUTO_FULL_KO_G6PC2_SLC30A8_PLUS_BASE_INS_GAD2_IAPP_CXADR'],
    severity: 'BLOCK',
    reason: () =>
      'Gross knockout or coding/splice disruption of high-pLI beta-cell brake or paracrine gene (PTPN2-/- [K=3 KO], TNFAIP3-/-, or multiplex GAD2 coding disruption [B=4]) is prohibited (PMID:19336676, PMID:10523611, PMID:31581152, PMID:2550826, PMID:32432213).',
  },
  {
    id: 'GRAVEYARD_008_CONSTITUTIVE_IL10_VIRAL_OVEREXPRESSION',
    defaults: ['CYTO_CONSTITUTIVE_IL10_VIRAL_OE'],
    severity: 'BLOCK',
    tier: 'conservative_project_exclusion_policy_under_mechanistic_uncertainty',
    reason: () =>
      'Conservative project exclusion policy under mechanistic uncertainty: unbuffered constitutive viral IL-10 overexpression alone is excluded in favor of contact-dependent checkpoints (PD-L1) and intracellular SERPINB9 (Polukort 2016 PMID:27183617 is retained strictly as non-islet mucosal mast-cell context).',
  },
  {
    id: 'GRAVEYARD_009_RESTING_B2M_PROMOTER_HOUR0_INNATE_DENSITY_DEFICIT',
    defaults: ['ALLO_B2M_HLAE_CD47_SWAP_CIITA_KO'],
    severity: 'WARN',
    disposition: 'Applies -0.20 logit discount in Gate 3 + requires Decision Experiment #1 QuantiBRITE gate',
    logitDelta: -0.2,
    targetGate: 'Gate3_Innate_NK_Macrophage_and_IBMIR_Shield',
    reason: () =>
      'Requires QuantiBRITE Hour-0 verification that resting endogenous B2M promoter achieves inhibitory HLA-E and CD47 surface density on Stage 7 beta-cells and iECs (Han 2019 PMID:31040209; Hu 2023 PMID:37156915; Xu 2024 PMID:38508139; Lin 2023 PMID:37264229).',
  },
  {
    id: 'GRAVEYARD_010_MHC_NULL_INDIRECT_APC_BYSTANDER_BLINDSPOT',
    defaults: ['ALLO_B2M_HLAE_CD47_SWAP_CIITA_KO', 'ALLO_B2M_CIITA_KO_CD47_LENTI'],
    severity: 'WARN',
    disposition: 'Applies -0.25 logit discount in Gate 2B + requires Decision Experiment #2 indirect APC / SA-FasL gate',
    logitDelta: -0.25,
    targetGate: 'Gate2B_Autoimmune_T1D_Memory_and_Indirect_APC_Stealth',
    reason: () =>
      'Donor MHC loss does not block host APC presentation of shed autoantigens and alloantigens. An INS leader/DRiP edit does not remove other epitopes or establish indirect immune protection; the warning remains until exact-product assays qualify the residual hazard (PMID:28263308, PMID:36055241, PMID:35559682).',
  },
];

/** The rules a set of modules triggers, in the engine's order. The rule data (severity, trigger modules) comes from the Graveyard JSON. */
export function evaluateRules(sel: Selection, totalB: number, entries: GraveyardEntry[], moduleTable: ModulesFile['modules']): Triggered[] {
  const byId = new Map(entries.map((e) => [e.graveyard_id, e] as const));
  if (entries.length !== RULES.length || byId.size !== RULES.length || RULES.some((r) => !byId.has(r.id))) throw new Error('Incomplete or duplicated Graveyard policy.');
  if (!Number.isSafeInteger(totalB) || totalB < 0) throw new Error('Base edits must be a nonnegative safe integer.');
  for (const e of entries) {
    if (!['BLOCK', 'PENALIZE', 'WARN', 'INFO'].includes(e.severity_level)) throw new Error('Invalid Graveyard severity.');
    const modules = e.trigger_pattern?.requires_any_module;
    if (!Array.isArray(modules) || !modules.length || modules.some((m) => typeof m !== 'string' || !m.length || !Object.hasOwn(moduleTable, m))) throw new Error('Missing or unknown Graveyard trigger modules.');
  }
  const active = new Set(Object.values(sel));
  const out: Triggered[] = [];
  for (const rule of RULES) {
    const entry = byId.get(rule.id);
    if (rule.baseEditsAtLeast !== undefined) {
      if (totalB < rule.baseEditsAtLeast) continue;
    } else {
      if (rule.extra && !rule.extra(sel)) continue;
      const named = entry?.trigger_pattern?.requires_any_module;
      const required = entry && named && named.length ? named : rule.defaults;
      const hit = required.some((m) => active.has(m));
      if (!hit) continue;
    }
    const triggered: Triggered = {
      graveyard_id: rule.id,
      severity_level: (entry?.severity_level ?? rule.severity) as Level,
      reason: rule.reason(totalB),
    };
    if (rule.tier) {
      // Same key order as the engine: id, severity, evidence tier, reason.
      out.push({ graveyard_id: triggered.graveyard_id, severity_level: triggered.severity_level, evidence_tier: String(entry?.curation_status ?? rule.tier), reason: triggered.reason });
    } else if (rule.disposition) {
      const extra = entry as Record<string, unknown> | undefined;
      // Same key order as the engine: id, severity, the discount and the test it applies to, the disposition, reason.
      out.push({
        graveyard_id: triggered.graveyard_id,
        severity_level: triggered.severity_level,
        evaluator_logit_delta: Number(extra?.evaluator_logit_delta ?? rule.logitDelta),
        evaluator_target_gate: String(extra?.evaluator_target_gate ?? rule.targetGate),
        evaluator_disposition_rule: String(extra?.evaluator_disposition_rule ?? rule.disposition),
        reason: triggered.reason,
      });
    } else out.push(triggered);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Named designs, and the tool's three modes
// ---------------------------------------------------------------------------------------------------------------

/** The named designs in the blueprint (A, B, and emergent challenger X), as modules. Their edit counts are checked against the release numbers in the tests. */
export const NAMED_DESIGNS: Record<'A' | 'B' | 'X', Selection> = {
  A: {
    allo: 'ALLO_B2M_HLAE_CD47_SWAP_CIITA_KO',
    autoantigen: 'AUTO_NONE',
    cytokine: 'CYTO_CXCL10_SWAP_PDL1_SERPINB9',
    er_stress: 'ER_NONE',
    niche: 'NICHE_TRIHORMONAL_120UM_MVF_CAO2',
    safety: 'SAF_AAVS1_CAG_ICASP9_BIALLELIC',
  },
  B: {
    allo: 'ALLO_HLA_C_RETAINED_SUPERDONOR_PLUS_TYK2_KO',
    autoantigen: 'AUTO_DUAL_INS_LEADER_AND_DRIP_EDIT',
    cytokine: 'CYTO_CXCL10_SWAP_PDL1_SERPINB9',
    er_stress: 'ER_NONE',
    niche: 'NICHE_TRIHORMONAL_120UM_MVF_CAO2',
    safety: 'SAF_AAVS1_CAG_ICASP9_BIALLELIC',
  },
  X: {
    allo: 'ALLO_B2M_HLAE_CD47_SWAP_CIITA_KO',
    autoantigen: 'AUTO_DUAL_INS_LEADER_AND_DRIP_EDIT',
    cytokine: 'CYTO_CXCL10_SWAP_PDL1_SERPINB9',
    er_stress: 'ER_NONE',
    niche: 'NICHE_TRIHORMONAL_120UM_MVF_CAO2',
    safety: 'SAF_AAVS1_CAG_ICASP9_BIALLELIC',
  },
};

export interface RuleView {
  id: string;
  graveyard_id: string;
  title: string;
  level: Level;
  level_plain: string;
  reason: string | null;
  evidence_tier?: string;
  why: string;
  check: string;
  instead: string;
  papers: string[];
}

function ruleView(rules: GraveyardRule[], graveyardId: string, trig?: Triggered): RuleView {
  const r = rules.find((x) => x.graveyard_id === graveyardId);
  return {
    id: r?.id ?? graveyardId,
    graveyard_id: graveyardId,
    title: r?.title ?? graveyardId,
    level: (trig?.severity_level ?? r?.level ?? 'WARN') as Level,
    level_plain: r?.level_plain ?? '',
    reason: trig?.reason ?? null,
    evidence_tier: trig?.evidence_tier,
    why: r?.why ?? '',
    check: r?.check ?? '',
    instead: r?.instead ?? '',
    papers: r?.papers ?? [],
  };
}

export interface ExactInput {
  design?: 'A' | 'B' | 'X';
  modules?: string[];
  base_edits?: number;
}

export type Verdict = 'dead_end' | 'risky' | 'nothing_found' | 'nothing_found_incomplete';

export interface ExactResult {
  ok: true;
  mode: 'exact';
  design: 'A' | 'B' | 'X' | null;
  modules: Partial<Selection>;
  axis_names: Record<string, string>;
  not_named: Axis[];
  gene_edit_cuts: number;
  base_edits: number;
  base_edits_given: boolean;
  triggered: RuleView[];
  not_checked: { id: string; title: string; needs: string }[];
  verdict: Verdict;
}

export interface InputProblem {
  ok: false;
  problem: string;
  help: string[];
}

export async function checkExact(bundle: Bundle, input: ExactInput): Promise<ExactResult | InputProblem> {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || (input.design !== undefined && (typeof input.design !== 'string' || !Object.hasOwn(NAMED_DESIGNS, input.design)))
    || (input.modules !== undefined && (!Array.isArray(input.modules) || input.modules.length > AXES.length || Array.from(input.modules).some(m => typeof m !== 'string' || m.length > 80)))
    || (input.base_edits !== undefined && (!Number.isSafeInteger(input.base_edits) || input.base_edits < 0))) {
    return { ok: false, problem: 'Invalid design input; base edits must be a nonnegative safe integer.', help: ['Use a named design and/or an array of up to six module names.'] };
  }
  const [modulesFile, entries, rules] = await Promise.all([bundle.modules(), bundle.entries(), bundle.rules()]);
  const chosen: Partial<Selection> = input.design ? { ...NAMED_DESIGNS[input.design] } : {};
  const overrides: Partial<Selection> = {};
  for (const raw of input.modules ?? []) {
    const id = resolveModule(modulesFile, raw);
    if (!id) {
      const near = nearModules(modulesFile, raw);
      return { ok: false, problem: `"${raw}" is not one of the design modules.`, help: near.length ? [`Did you mean ${near.join(', ')}?`] : ['Ask for mode "list" to see every module.'] };
    }
    const axis = modulesFile.modules[id].axis as Axis;
    if (overrides[axis] && overrides[axis] !== id) {
      return { ok: false, problem: `Two modules were given for the same part of the design (${modulesFile.axes[axis].name}): ${overrides[axis]} and ${id}.`, help: ['Give one module for each part.'] };
    }
    overrides[axis] = id;
    chosen[axis] = id;
  }
  if (!Object.keys(chosen).length) return { ok: false, problem: 'No design was given.', help: ['Give design "A", "B" or "X", or a list of modules.', 'Ask for mode "list" to see every module.'] };

  const notNamed = AXES.filter((a) => !chosen[a]);
  const sel = Object.fromEntries(AXES.map((a) => [a, chosen[a] ?? ''])) as Selection;
  const spec = (id: string) => modulesFile.modules[id];
  const sum = (key: 'cuts' | 'base_edits') => Object.values(chosen).reduce((n, id) => n + spec(id as string)[key], 0);
  const baseEditsGiven = input.base_edits !== undefined;
  const totalB = input.base_edits ?? sum('base_edits');
  if (!Number.isSafeInteger(totalB) || totalB < sum('base_edits')) {
    return { ok: false, problem: 'The base-edit count must be an integer at least as large as the edits required by the selected modules.', help: ['Omit base_edits to use the module total, or include any additional edited loci.'] };
  }
  const triggered = evaluateRules(sel, totalB, entries, modulesFile.modules);

  // A rule that did not trigger may still be undecided, because a part of the design it depends on was not named.
  const triggeredIds = new Set(triggered.map((t) => t.graveyard_id));
  const notChecked: { id: string; title: string; needs: string }[] = [];
  for (const rule of RULES) {
    if (triggeredIds.has(rule.id)) continue;
    const missing = new Set<Axis>();
    let possible = true;
    if (rule.baseEditsAtLeast !== undefined) {
      if (baseEditsGiven || !notNamed.length) possible = false;
      else notNamed.forEach((a) => missing.add(a));
    } else {
      const entry = entries.find((e) => e.graveyard_id === rule.id);
      const named = entry?.trigger_pattern?.requires_any_module;
      const required = named && named.length ? named : rule.defaults;
      const open = required.filter((m) => {
        const axis = modulesFile.modules[m]?.axis as Axis | undefined;
        return axis !== undefined && !chosen[axis];
      });
      if (!open.length) possible = false;
      else open.forEach((m) => missing.add(modulesFile.modules[m].axis as Axis));
      if (rule.extra) {
        if (chosen.autoantigen) possible = possible && rule.extra(sel);
        else if (possible) missing.add('autoantigen');
      }
    }
    if (!possible || !missing.size) continue;
    const view = rules.find((x) => x.graveyard_id === rule.id);
    notChecked.push({
      id: view?.id ?? rule.id,
      title: view?.title ?? rule.id,
      needs: [...missing].map((a) => modulesFile.axes[a].name).join(', '),
    });
  }

  const views = triggered.map((t) => ruleView(rules, t.graveyard_id, t));
  const verdict: Verdict = views.some((v) => v.level === 'BLOCK') ? 'dead_end' : views.length ? 'risky' : notChecked.length ? 'nothing_found_incomplete' : 'nothing_found';
  return {
    ok: true,
    mode: 'exact',
    design: input.design ?? null,
    modules: chosen,
    axis_names: Object.fromEntries(AXES.map((a) => [a, modulesFile.axes[a].name])),
    not_named: notNamed,
    gene_edit_cuts: sum('cuts'),
    base_edits: totalB,
    base_edits_given: baseEditsGiven,
    triggered: views,
    not_checked: notChecked,
    verdict,
  };
}

function resolveModule(file: ModulesFile, raw: string): string | null {
  const key = raw.trim().toUpperCase().replace(/[\s-]+/g, '_');
  return Object.keys(file.modules).find((id) => id === key) ?? null;
}

function nearModules(file: ModulesFile, raw: string): string[] {
  const parts = raw.toUpperCase().split(/[^A-Z0-9]+/).filter((p) => p.length > 2);
  return Object.keys(file.modules)
    .map((id) => ({ id, hits: parts.filter((p) => id.includes(p)).length }))
    .filter((m) => m.hits > 0)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 4)
    .map((m) => m.id);
}

// ---------------------------------------------------------------------------------------------------------------

export interface SuggestResult {
  mode: 'suggest';
  idea: string;
  suggestions: (RuleView & { why_suggested: string })[];
  genes_in_idea: { gene: string; modules: string[] }[];
  note: string;
}

const GENERIC = new Set(['cell', 'cells', 'gene', 'genes', 'islet', 'islets', 'beta', 'design', 'designs', 'edit', 'edits', 'editing', 'with', 'that', 'this', 'from', 'into', 'idea', 'new', 'use', 'using', 'make', 'add', 'adding']);
// Words in an idea that say nothing about any rule. Searching with them made "a" match every rule word starting with a ("attack",
// "allo"), and bare numbers ("180", "000") match the numbers in a rule's text, so an oxygen analysis was flagged against immune rules.
const FILLER = new Set(['a', 'an', 'the', 'and', 'or', 'but', 'nor', 'not', 'no', 'of', 'to', 'in', 'on', 'at', 'by', 'for', 'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'if', 'so', 'than', 'then', 'there', 'these', 'those', 'they', 'them', 'their', 'we', 'our', 'you', 'your', 'he', 'she', 'his', 'her', 'i', 'my', 'me', 'do', 'does', 'did', 'done', 'has', 'have', 'had', 'can', 'could', 'should', 'would', 'will', 'may', 'might', 'must', 'shall', 'about', 'above', 'after', 'again', 'against', 'all', 'also', 'always', 'any', 'assume', 'assumes', 'before', 'below', 'between', 'both', 'each', 'either', 'every', 'few', 'how', 'just', 'least', 'less', 'like', 'many', 'more', 'most', 'much', 'neither', 'never', 'now', 'often', 'once', 'only', 'other', 'over', 'own', 'per', 'same', 'some', 'such', 'still', 'through', 'under', 'until', 'up', 'upon', 'very', 'via', 'what', 'when', 'where', 'whether', 'which', 'while', 'who', 'whom', 'why', 'within', 'without', 'yet', 'e.g', 'eg', 'ie', 'etc', 'vs']);
const queryTerm = (t: string): string | null => {
  const term = t.toLowerCase();
  return GENERIC.has(term) || FILLER.has(term) || /^\d[\d.,]*$/.test(term) ? null : term;
};
// A word in the idea also finds rule words that start with it ("oxygen" finds "oxygenation"), but only from four letters on.
const prefixFrom = (term: string): boolean => term.length >= 4;
const caches = new WeakMap<Bundle, Promise<MiniSearch>>();

function ruleIndex(bundle: Bundle): Promise<MiniSearch> {
  let p = caches.get(bundle);
  if (!p) {
    p = (async () => {
      const [rules, modules] = await Promise.all([bundle.rules(), bundle.modules()]);
      const ms = new MiniSearch({
        fields: ['title', 'idea', 'why', 'check', 'instead', 'modules', 'condition'],
        idField: 'id',
        processTerm: (t) => (GENERIC.has(t.toLowerCase()) ? null : t.toLowerCase()),
      });
      ms.addAll(
        rules.map((r) => ({
          id: r.id,
          title: r.title,
          idea: r.idea,
          why: r.why,
          check: r.check,
          instead: r.instead,
          modules: r.trigger_modules.map((m) => `${tidy(m)} ${modules.modules[m]?.genes.join(' ') ?? ''}`).join(' '),
          condition: tidy(r.trigger_condition ?? ''),
        })),
      );
      return ms;
    })();
    caches.set(bundle, p);
  }
  return p;
}

export async function suggestFromIdea(bundle: Bundle, rawIdea: string): Promise<SuggestResult> {
  const idea = rawIdea.slice(0, 2000);
  const [rules, ms, modules, genes] = await Promise.all([bundle.rules(), ruleIndex(bundle), bundle.modules(), bundle.targetGenes()]);
  const hits = ms.search(idea, { prefix: prefixFrom, fuzzy: 0.15, combineWith: 'OR', processTerm: queryTerm });
  const best = hits[0]?.score ?? 0;
  const suggestions = hits
    .filter((h) => h.score >= best * 0.45 && h.score >= 4)
    .slice(0, 4)
    .map((h) => {
      const r = rules.find((x) => x.id === h.id)!;
      const view = ruleView(rules, r.graveyard_id ?? r.id);
      return { ...view, why_suggested: `Shares the words ${h.terms.slice(0, 5).map((t) => `"${t}"`).join(', ')} with this rule.` };
    });
  const mentioned = new Map<string, string[]>();
  for (const token of normalise(idea).match(/[a-z0-9][a-z0-9-]*/g) ?? []) {
    const gene = resolveGene(token, genes);
    if (!gene || mentioned.has(gene)) continue;
    const involved = Object.entries(modules.modules)
      .filter(([, m]) => m.genes.includes(gene))
      .map(([id]) => id);
    if (involved.length) mentioned.set(gene, involved);
  }
  return {
    mode: 'suggest',
    idea: clip(idea, 400),
    suggestions,
    genes_in_idea: [...mentioned].map(([gene, ms_]) => ({ gene, modules: ms_ })),
    note: 'These are suggestions found by comparing words. They are not a check. The Idea Graveyard works on named design modules, so to check a design properly, name its modules (mode "exact").',
  };
}

export interface ListResult {
  mode: 'list';
  axes: { axis: Axis; name: string; modules: { id: string; label: string; gene_edit_cuts: number; base_edits: number; genes: string[] }[] }[];
  designs: Record<'A' | 'B' | 'X', Selection>;
  rules: { id: string; title: string; level: Level }[];
}

export async function listModules(bundle: Bundle): Promise<ListResult> {
  const [modules, rules] = await Promise.all([bundle.modules(), bundle.rules()]);
  return {
    mode: 'list',
    axes: AXES.map((axis) => ({
      axis,
      name: modules.axes[axis].name,
      modules: modules.axes[axis].modules.map((id) => ({
        id,
        label: modules.modules[id].label,
        gene_edit_cuts: modules.modules[id].cuts,
        base_edits: modules.modules[id].base_edits,
        genes: modules.modules[id].genes,
      })),
    })),
    designs: NAMED_DESIGNS,
    rules: rules.map((r) => ({ id: r.id, title: r.title, level: r.level })),
  };
}
