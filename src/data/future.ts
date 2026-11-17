// Isolated forward-planning dataset for /future ("The Future").
// Strict architectural boundary: this module imports nothing from the starter pack,
// blueprint release data, versions.ts, roadmap.ts, or connector/ — and nothing in
// those modules may import from future.ts.

export type EvidenceClass = 'Computed' | 'Literature' | 'Assumption' | 'Idea';

export interface UnbuiltMetadata {
  readonly status: 'unbuilt proposal';
  readonly assignedVersion: null;
  readonly calendarDate: null;
  readonly regulatoryAgreement: null;
}

export interface ScenarioEndpointSummary {
  readonly id: 'sequential' | 'prepared' | 'floor';
  readonly radioLabel: string;
  readonly shortBadge: string;
  readonly headlineRange: string;
  readonly sentinelMonths: string;
  readonly review60Months: string;
  readonly readoutMonths: string;
  readonly readoutRange: string;
  readonly summary: string;
  /** Waiting/preparation units per stage (1..6). Only these compress across scenarios. */
  readonly waitUnits: readonly [number, number, number, number, number, number];
  /** Locked safety-evidence units per stage (1..6). Identical across all scenarios. */
  readonly safetyUnits: readonly [number, number, number, number, number, number];
}

export interface SetbackDistribution {
  readonly id: 'independent' | 'shared';
  readonly label: string;
  readonly caption: string;
  /** Out of 100 simulated runs: clean (0 repeats), 1–3 repeats, and 4+ bunched repeats. */
  readonly cleanCount: number;
  readonly moderateRepeatCount: number;
  readonly bunchedRepeatCount: number;
  readonly over48MonthsPct: string;
  readonly middle80Range: string;
}

export interface TimelineStageRow extends UnbuiltMetadata {
  readonly step: number;
  readonly id: string;
  readonly title: string;
  readonly scopeBadge: string;
  readonly evidenceClass: EvidenceClass;
  readonly parallelOverlap: boolean;
  readonly parallelCaption?: string;
  readonly preparedAhead: string;
  readonly safetyFloor: string;
  readonly stopRule: string;
  readonly science: readonly string[];
}

export interface HorizonItem extends UnbuiltMetadata {
  readonly id: string;
  readonly title: string;
  readonly badge: string;
  readonly evidenceClass: EvidenceClass;
  readonly summary: string;
  readonly stopRule: string;
}

export interface HorizonPadlock extends UnbuiltMetadata {
  readonly number: 1 | 2 | 3;
  readonly id: string;
  readonly title: string;
  readonly wallSummary: string;
  readonly testbedTitle: string;
  readonly testbedSummary: string;
  readonly stopRule: string;
  readonly pmid?: string;
  readonly science: readonly string[];
}

export interface FailureModeCard extends UnbuiltMetadata {
  readonly number: number;
  readonly id: string;
  readonly title: string;
  readonly evidenceClass: EvidenceClass;
  readonly shortcut: string;
  readonly finding: string;
  readonly doesNotProve: string;
  readonly instead: string;
  readonly stopThreshold: string;
  readonly visualKind?: 'wells' | 'pleat' | 'plug' | 'blood';
  readonly science: readonly string[];
}

export interface RuledOutPhysicsCard extends UnbuiltMetadata {
  readonly id: string;
  readonly title: string;
  readonly verdictNumber: string;
  readonly whyRuledOut: string;
  readonly instead: string;
  readonly receiptRef: string;
}

export interface StorySource {
  readonly pmid: string;
  readonly citation: string;
  readonly note: string;
}

const UNBUILT: UnbuiltMetadata = {
  status: 'unbuilt proposal',
  assignedVersion: null,
  calendarDate: null,
  regulatoryAgreement: null,
} as const;

/**
 * Locked safety-evidence widths across the 6 modelled stages.
 * Shared by reference across all three scenarios so tests and the UI guarantee
 * safety checks never shrink by a single unit when switching modes.
 */
export const LOCKED_SAFETY_UNITS: readonly [number, number, number, number, number, number] = [
  14, // Stage 1: >=6 batches x >=6 unseen T1D donors + >=6 clock points + 120-h oxygen check
  10, // Stage 2: Phased 2-copy long-read + >=63,000 independent duplex DNA molecules
  18, // Stage 3: ~17-wk bank QC beside unchanged 84-day post-growth safety tail + Tier 6B
  26, // Stage 4: Full 26-week (182-day) in-life mouse safety & tumour-watch study
  12, // Stage 5: Regulator sign-off + real-time stability + loaded oxygen + blood check
  16, // Stage 6: Staggered 3+3 retrievable sentinel + full 60-day independent review
] as const;

export const scenarios: readonly ScenarioEndpointSummary[] = [
  {
    id: 'sequential',
    radioLabel: 'One step at a time',
    shortBadge: 'About 48 to 50 months',
    headlineRange: '48 months if nothing repeats, about 50 with usual lab repeats',
    sentinelMonths: '~36–38 months',
    review60Months: '~40–42 months',
    readoutMonths: '~48–50 months',
    readoutRange: '47–55 months (middle 80%)',
    summary:
      'Each stage starts only after the previous stage has completely finished.',
    waitUnits: [15, 13, 12, 16, 14, 14],
    safetyUnits: LOCKED_SAFETY_UNITS,
  },
  {
    id: 'prepared',
    radioLabel: 'Prepared ahead',
    shortBadge: 'About 38 months (35 to 45)',
    headlineRange: 'Likely range: 35 to 45 months from Month 0',
    sentinelMonths: '~26 months (24–31 mo)',
    review60Months: '~31–32 months',
    readoutMonths: '~38 months',
    readoutRange: '35–45 months (middle 80%, shared-cause range)',
    summary:
      'Templates, potency tests, backup designs, and regulator questions are prepared early so total model time drops by about 12 months through shorter queues between checks — while every safety check keeps its full length.',
    waitUnits: [7, 6, 5, 8, 6, 8],
    safetyUnits: LOCKED_SAFETY_UNITS,
  },
  {
    id: 'floor',
    radioLabel: 'No-repeat planning case',
    shortBadge: 'About 33 months',
    headlineRange: 'No-repeat planning case if zero steps needed repeating',
    sentinelMonths: '~22.5 months',
    review60Months: '~26–27 months',
    readoutMonths: '~32.5–33.5 months',
    readoutRange: 'No-repeat baseline (32.4–33.4 mo)',
    summary:
      'The baseline path if every experiment passed on the first try and frontier automation removed queue delays — while every biological and safety watch keeps its full length.',
    waitUnits: [4, 3, 3, 4, 3, 5],
    safetyUnits: LOCKED_SAFETY_UNITS,
  },
] as const;

export const setbackModes: readonly SetbackDistribution[] = [
  {
    id: 'shared',
    label: 'Shared causes (realistic lab)',
    caption:
      'When setbacks share a root cause — one stubborn cell batch or one busy cleanroom — about 62 runs in 100 need at least one repeat and 10 need four or more, widening the middle range to 35–45 months.',
    cleanCount: 38,
    moderateRepeatCount: 52,
    bunchedRepeatCount: 10,
    over48MonthsPct: '4.0%',
    middle80Range: '35–45 months',
  },
  {
    id: 'independent',
    label: 'Independent coin flips',
    caption:
      'If every step failed on its own, only 3 runs in 100 would hit four or more repeats (35–43 months). Real labs share equipment and cells, so the shared-cause view is the honest test.',
    cleanCount: 22,
    moderateRepeatCount: 75,
    bunchedRepeatCount: 3,
    over48MonthsPct: '0.4%',
    middle80Range: '35–43 months',
  },
] as const;

export const timelineStages: readonly TimelineStageRow[] = [
  {
    ...UNBUILT,
    step: 1,
    id: 'stage-row-1',
    title: 'Growing & testing the cells',
    scopeBadge: 'Automated incubator care · zero new DNA cuts',
    evidenceClass: 'Idea',
    parallelOverlap: false,
    preparedAhead:
      'Share open research DNA starter kits and cloud-lab scripts early; lock the dynamic insulin-release test beside a never-frozen fresh control; test 24-hour feeding rhythms (potentially cutting 6-week batch loops toward ~3 weeks once proven); and validate non-destructive light sensors from watch-only feeding guidance toward a Day-14/Day-21 early dud-batch check.',
    safetyFloor:
      'Checks across at least 6 independent batches and 6 unseen type 1 diabetes immune donors, 6 day/night clock points confirming <=3 min insulin shut-off, mouse time-zone re-sync checks, and a 120-hour oxygen-demand test.',
    stopRule: 'Drop any optical camera check whose stressed-batch match to real insulin release falls below 0.80, or any rhythm tweak that raises oxygen appetite.',
    science: [
      'Proteome-remodelling floor (artifacts-sonnet/receipts/s8_clonogenic_and_maturation_floors.json): 95% protein turnover takes 4.32 half-lives (17.3–25.9 d for t_1/2 = 4–6 d); baseline DAG books 0 days of circadian compression on Bank 1 (22 d vs 42 d differentiation shifts P50 by +0.005 mo because 119-d compendial banking governs), whereas validated ~20–25 d maturation cuts downstream test-lot and clinical-lot turnaround.',
      'Circadian maturation & two-stage PAT gates (PMID 31839570 + IIP-0021 + biostat_results.json): non-elevated sXBP1/CHOP, >=72 h cue washout, 120-h Nec-1s x Ferrostatin-1 washed-pellet (<10 nM LC-MS) assembled-organoid OCR coupon (upper95 <= 0.80) across >=6 circadian phases over 24–48 h; in computer simulations, replacing an early Day-7/Day-14 rule with a two-stage Day-14 progenitor-Z + Day-21 logit-slope check cut mistaken stops of healthy batches from 93.12% to 1.37% (99.99% to 3.36% in slow, variable batches) while catching 99.7% of simulated dead-end runs (gated on zero false discards observed across >=59 / 72 / 80 successful runs per group).',
      'Potency ring-study & live single-islet traces: dynamic perifusion GSIS + <=3.0 min shut-off + alpha-cell glucagon + iCasp9 clearance anchor alongside a never-frozen fresh comparator arm, plus watch-only label-free single-islet secretion traces (Zitzmann et al. PMID 42054864; PMID 42197878).',
    ],
  },
  {
    ...UNBUILT,
    step: 2,
    id: 'stage-row-2',
    title: 'Building a clean starter cell bank',
    scopeBadge: 'Reusable landing-pad starter bank · zero-break installation',
    evidenceClass: 'Computed',
    parallelOverlap: false,
    preparedAhead:
      'Screen donor stem-cell lines by computer first; qualify one reusable landing-pad starter bank (saving zero time on version one, which pays the full check); then drop candidate protective cargos into matching vials in a single zero-break pass (~6–9 weeks vs 16–22 weeks for multi-step editing) using bacteria-free enzymatic DNA.',
    safetyFloor:
      'Zero off-target insertions within validated assay bounds, two-copy long-read DNA checks, clean endotoxin clearance, and sequencing at least 63,000 independent double-stranded DNA molecules per tested locus (counting raw reads instead of duplex molecules drops detection power below 3%).',
    stopRule: 'Hold the starter-to-subline shortcut if two-copy intactness drops below 99% or any off-target insertion appears.',
    science: [
      'Single-pass 0-DSB landing pads & Design Y provenance (IIP-0023 / DEC-102; Pandey et al. PMID 38858586 eePASSIGE; Pelea et al. PMID 41642947 RNA-guided bridge recombinases): 73-bp B2M Exon-1 attP-in-genome + 11.1–12.6 kb attB-minicircle is registered as a Stage-0 wildcard (Y-01..Y-04 unchanged); dossier gates FD-01..FD-04 cover founder vs parallel subline aliquot banking.',
      'Duplex sequencing floor (verify_immunology_purge_and_schedule.py): N >= 63,000 independent duplex molecules gives P(X >= 3) = 95.02% binomial power per tested locus at VAF = 10^-4 across TP53/PPM1D/BCOR under the stated Poisson-binomial model; 63,000 raw reads at 10x family size (~6,300 duplexes) gives 2.62% power.',
      'Cell-free enzymatic dbDNA/minicircle (s8): 0.63–1.25% polymerase point-error copies across 12.5 kb are filtered at clonal long-read verification; binding release specs are endotoxin, residual backbone, and ssDNA fraction.',
    ],
  },
  {
    ...UNBUILT,
    step: 3,
    id: 'stage-row-3',
    title: 'Freezing batches, smart-RNA purity & the 84-day check',
    scopeBadge: 'Two safety branches side by side · closed isolator pods',
    evidenceClass: 'Computed',
    parallelOverlap: true,
    parallelCaption: 'The ~17-week bank quality branch and the 84-day post-growth aging check run side by side on split samples, never cutting either short.',
    preparedAhead:
      'Qualify a <= -150 °C frozen pause-point so surgery dates and clinical batches are unlinked from a live incubator clock; explore closed automated isolator steps to reduce cleanroom changeover queues; test whether two-stage microRNA-sensing RNA switches can move from magnetic-sorting enrichment toward tank-scale purity; and validate rapid microbial release assays early.',
    safetyFloor:
      'Full ~17-week cell-bank testing alongside the full 84-day aging tail (60 days aging + 3 days trigger + 21 days recovery) including the exact clinical freeze-thaw cycle, plus ~750-cell competitive mixes proving thawing never favours cells whose safety switch is silenced.',
    stopRule: 'Take zero scheduling credit from frozen vials if thawing gives switch-silenced cells more than a 1.2x survival edge or shifts beta-cell share past 3 percentage points.',
    science: [
      'Freeze-thaw selection guards (artifacts-sonnet/receipts/s4_cryo_selection_bias.json, gates G-07..G-09): 1:1 (~750 cells/arm resolves R = 1.2), 1:100, and 1:10^4 competitive mixes with apoptosis-resistant and iCasp9-silenced spikes must prove R <= 1.2 (95% UCB); satellite tail lot must undergo the exact freeze-thaw (G-08); post-recovery beta-fraction TOST within +-3 percentage points (>=22 lots/arm, G-09).',
      'Two-tier transient miRNA-switch purification (Tsujisaka et al. PMID 35688152 / PMC9287667, which paired RNA switches with MACS sorting; biostat_results.json) & rapid microbial QC: Tier A negative switch cuts SLC18A1+ enterochromaffin cells <1% (q*_EC = 0.0818); proposed Tier B tandem >=2-stage miR-302/367-OFF positive tag + orthogonal miR-375-repressed clearance targets f_post = 6.57e-9 <= 10^-8 (gated on <0.01% dsRNA and >=72 h washout). Compendial rapid microbial/mycoplasma checks (USP <72>/<1071>, Ph. Eur. 2.6.27, Kang et al. PMID 41034515 one-day microbial test) aim to compress lot-release quarantine holds where product-specific suitability passes.',
      'Tier 6A / 6B clonogenic arithmetic & CLK-3 span: >=99.99% 72-h Stage-7 clearance (Tier 6A) and N_eff >= 299,573,228 zero-survivor clonogenic opportunities (8.97e8–1.11e9 physical sorted clonogenic cells at eta = 0.27–0.334 across 9.335e8 pan-lineage cells; q_max <= 6.70e-5), running 17.0 wk (119 d) compendial QC beside the 134-d (42 d + 84 d + 8 d) satellite tail.',
    ],
  },
  {
    ...UNBUILT,
    step: 4,
    id: 'stage-row-4',
    title: 'The 26-week mouse watch & parallel clinical prep',
    scopeBadge: 'Zero primates · parallel clinical batch & rolling review',
    evidenceClass: 'Computed',
    parallelOverlap: true,
    parallelCaption: 'Clinical sentinel batch freezing, early regulator dossier reading, and observational glucose tracking before anyone receives study cells can run alongside the 26-week mouse watch — while zero cells enter a person until Week-26 pathology clears.',
    preparedAhead:
      'Screen batches beforehand with sensitive stem-cell purity checks (droplet PCR down to ~3–10 stray cells per million, plus magnetic-enrichment culture assays tested to 1 in 5 million in reference cells) and 50-donor human blood chips so 9-month mouse restarts stay rare; optionally start mouse dosing ~4.4–7.0 weeks before bank paperwork finishes (budgeting ~1-in-8 restart risk); and use those 26 weeks to manufacture and deep-freeze the human clinical batch, open rolling regulator review, and pre-book digital slide pathology.',
    safetyFloor:
      'The complete 26-week (182-day) in-life mouse safety and unwanted-growth watch on the exact human clinical product — kept 100% intact in our baseline model, with zero primates used anywhere in OpenIslet.',
    stopRule: 'Zero early-start overlap if regulators decline or cleanrooms are full, and zero human dosing until the final 26-week mouse pathology report lands clean.',
    science: [
      'Same-MCB overlap identity (v4_receipts.json & s10_rederivations.json): 17.00 wk bank span minus 4.00 wk vial banking minus representative coated-lot manufacture (60 d = 8.57 wk at baseline: 42 d differentiation + 8 d washout/OCR + 10 d coating & pre-dose sterility release = 4.43 wk overlap; 42 d = 6.00 wk if the entire matching lot is ready in 42 d = 7.00 wk overlap; 50 d = 7.14 wk without coating hold = 5.86 wk).',
      'Upstream human kill-filters & nonclinical trajectory: HESI CT-TRACS multisite ddPCR (Yasuda et al. PMID 39120125: ~3 per million in shared spiked cardiomyocyte RNA, 10 per million / 1 in 100,000 in site-prepared samples) alongside MACS-enriched culture validation (Watanabe et al. PMID 32978066: 0.00002% / 1 in 5 million in spiked reference cells; islet-specific recovery must be established empirically) + 3e8-opportunity human clonogenic dishes inspect far more human cells than fit in an NSG mouse graft, cutting the ~18% r4 GLP restart risk today.',
    ],
  },
  {
    ...UNBUILT,
    step: 5,
    id: 'stage-row-5',
    title: 'Regulator sign-off, baseline readiness & Day-0 oxygen',
    scopeBadge: 'Early regulatory advice · loaded sleeve check',
    evidenceClass: 'Computed',
    parallelOverlap: false,
    preparedAhead:
      'Run early written regulator advice alongside engineering rather than at the end; reference shared master files for the cell-free outer sleeve; allow trial partners to complete observational glucose tracking before anyone receives study cells; check Day-0 sleeve oxygen under load; and run split 5–10 mL and 20–40 mL blood checks.',
    safetyFloor:
      'Full regulator sign-off, real-time batch stability, loaded Day-0 sleeve oxygen at or above 8 mmHg, and clean recipient blood checks. Because blood tubes cannot see immune memory tucked inside deep lymph nodes, a small removable patch always comes first.',
    stopRule: 'Never load living cells into any sleeve whose loaded Day-0 oxygen reading falls below 8 mmHg, and cancel any pre-work credit invalidated by regulator feedback.',
    science: [
      'Why unloaded Day-0 optodes fail (artifacts-sonnet/receipts/s1_o2_stack_gap_budget.json, gate G-03): an empty cell-free sleeve has zero O2 consumption, reading 40.0 mmHg behind both a healthy 15 µm scar and a failing 45 µm scar (0 mmHg difference unloaded, whereas under 1.15x–1.30x oxygen-sink load a thick 45 µm scar exhausts available luminal oxygen down toward zero while a 15 µm layer stays comfortably above 8 mmHg). A calibrated oxygen-sink plug + 4-electrode impedance gap gauge (dR/R = dg/g, median gap <= 10 µm, G-02) makes Day 0 discriminative.',
      'Non-overlapping 25–50 mL blood ledger (v4_receipts.json): Phase A uses 5–10 mL whole blood (GPRP thrombin-preserving PMC8428748 / PMID 34380648 vs lepirudin PMID 12176911 + compstatin PMID 35570131 across >=299 [353–658 ICC] IIP-0020 human-cuff clusters); Phase B uses 20–40 mL for 72-h direct + 7-d expanded recall calibrated by TCR spike-ins f_95(s) (1.07e-7–4.99e-7 at s = 0.50; 5.35e-7–2.50e-6 at s = 0.10; PLN memory f_blood = 0 has P_miss = 1.0).',
      'Regulatory route precision: early INTERACT / parallel scientific advice and Device/Biologics Master Files take ~75-day advice cycles off the critical path; statutory Platform Technology Designation (21 U.S.C. 356k) requires prior use in an approved product and is never assumed for Candidate 1.',
    ],
  },
  {
    ...UNBUILT,
    step: 6,
    id: 'stage-row-6',
    title: 'Small test patch, 60-day review & seamless expansion',
    scopeBadge: 'Staggered 3+3 patch · single seamless protocol',
    evidenceClass: 'Assumption',
    parallelOverlap: false,
    preparedAhead:
      'Write sentinel and adult-dose stages into one seamless Phase 1/2 protocol with pre-agreed safety gates (avoiding months of re-filing gaps); pre-stage frozen expansion vials to thaw only after Day-60 clearance; and test harmless non-coding DNA blood tags per strip.',
    safetyFloor:
      'Informed consent, staggered 3+3 implantation of a small removable test patch (only if regulators permit), and a full 60-day independent safety review after the last test patch before a single cell enters the adult expansion group.',
    stopRule: 'Pause immediately into a separate protocol review on any safety signal, and drop the DNA blood-tag layer if large-animal plasma DNA release falls below 2%.',
    science: [
      'Staggered sentinel & seamless Phase 1/2 transition (verify_immunology_purge_and_schedule.py; FDA Adaptive Design Guidance / ICH E20): T_DSMB = max_i(T_implant,i + 60 d) + T_clean (4.5-mo base span inclusive of the 60-day hold). Pre-staging <= -150 °C cryo-intermediate lots (8-d thaw recovery + rapid release after Day-60 clearance) compresses the 2.5-mo post-DSMB manufacturing wait without touching the 60-d hold. Retrieval does not reverse prior immune sensitisation.',
      'Rate-dependent barcoded cfDNA SNR physics (artifacts-sonnet/receipts/s3_cfdna_canary_snr.json, gate G-10): non-coding barcode in Design Y attB spacer (0 new peptides) cuts plasma detection floor 2.8–8.6x vs unmethylated INS (N_beta = 4.8e8, 3 L plasma, t_1/2 = 30 min, daily blood-draw assumption). Detecting 1%/d single-cartridge loss (59–229 d lead) requires a plasma DNA release fraction f >= 5.36% (vs f >= 22.3% plasma-release fraction for INS, a release parameter distinct from T-cell blood-sampling miss rates); at f = 2.0%, threshold is ~2.68%/d (at 3%/d, f >= 1.79% gives 19–76 d lead; at 10%/d, f >= 0.54% gives 5–22 d lead); quiet turnover (10^-5–3e-4/d) stays invisible.',
      'Master Timeline anchor note: in OPENISLET-2026-2030-MASTER-TIMELINE.md, illustrative Month 1 = Nov 2026 aligns with the 48.0-mo sequential reference row; /future anchors at arbitrary partner Month 0 and makes zero calendar-year predictions.',
    ],
  },
] as const;

export const horizon1Items: readonly HorizonItem[] = [
  {
    ...UNBUILT,
    id: 'h1-circadian',
    title: '24-hour day–night incubator rhythms (~3-week loop target)',
    badge: 'Zero new DNA cuts',
    evidenceClass: 'Literature',
    summary:
      'Testing whether pulsing nutrients and hormones in 24-hour cycles inside automated tanks can reduce low-sugar insulin leak, hit our <=3 min shut-off target, and compress 6-week differentiation loops toward ~3 weeks without cell stress.',
    stopRule: 'Book zero speed credit unless >=6 clock points, 120-hour oxygen demand, and mouse time-zone re-sync all pass.',
  },
  {
    ...UNBUILT,
    id: 'h1-autopilot',
    title: 'Live single-islet sensors & Day-14/21 dud catch',
    badge: 'Watch-only first',
    evidenceClass: 'Computed',
    summary:
      'Starting label-free cameras and real-time single-islet secretion sensors in watch-only mode, while validating a simulated Day-14 and Day-21 trajectory check (~3 weeks early on a 6-week run; 93.1% -> 1.4% mistaken stops, 99.7% simulated dud catch).',
    stopRule: 'Never discard a batch automatically until zero false discards are observed across 59 to 80 successful runs per group.',
  },
  {
    ...UNBUILT,
    id: 'h1-cryo-potency',
    title: 'Deep-freeze pause-point, starter bank & open DNA kits',
    badge: 'Unlinks lab timer from surgery',
    evidenceClass: 'Computed',
    summary:
      'Sharing preclinical research DNA kits early, locking potency tests beside a never-frozen control, and qualifying <= -150 °C frozen batches so clinical doses wait safely in the freezer while animal and regulator steps finish.',
    stopRule: 'Zero scheduling credit if thawing favours switch-silenced cells past 1.2x or shifts beta-cell share past 3 points.',
  },
] as const;

export const horizon2Items: readonly HorizonItem[] = [
  {
    ...UNBUILT,
    id: 'h2-sleeve-strips',
    title: 'Breathable outer pocket + keyhole micro-cup strips',
    badge: '2–3 cm flexible strips',
    evidenceClass: 'Computed',
    summary:
      'A permanent thin outer sleeve lets capillaries settle first (checked under real oxygen load on Day 0, with a tiny Day 0–7 vapour-fed oxygen bridge studied as an early backup). Slim 2–3 cm strips then glide inside with <=80 µm clusters seated in breathable silicone micro-cups and ~20% insulin windows.',
    stopRule: 'Hold geometry if a 3D oxygen model shows >=1% cell volume <5 mmHg after a meal or 90-day animal retrieval leaves cells behind.',
  },
  {
    ...UNBUILT,
    id: 'h2-modular-adults',
    title: 'Modular strip dosing across life stages (adults first)',
    badge: 'Adults first · surgical swap',
    evidenceClass: 'Assumption',
    summary:
      'Splitting a full dose across several slim strips instead of one rigid slab aims at a 50-year maintainable system — starting strictly in adults, with long-term potential to add or slide out strips across life stages such as growth or pregnancy.',
    stopRule: 'Hard sequence lock: zero younger or pregnancy groups before adult single-dose and repeat-swap safety pass.',
  },
  {
    ...UNBUILT,
    id: 'h2-canaries',
    title: 'Per-strip DNA blood tags for early single-strip swap',
    badge: 'Spots which strip to slide out',
    evidenceClass: 'Computed',
    summary:
      'Giving each strip its own harmless non-coding DNA tag makes detectable sustained single-strip cell loss 3–8x easier to spot under the modelled blood-sampling schedule before blood sugar rises, telling surgeons which single strip to replace.',
    stopRule: 'Drop the blood-tag layer if large-animal plasma DNA release falls below 2% or misses >=3%/day strip loss.',
  },
  {
    ...UNBUILT,
    id: 'h2-amyloid-safety',
    title: 'Refreshable anti-clumping shields, nerve cues & orthogonal safety',
    badge: '50-year durability toolkit',
    evidenceClass: 'Literature',
    summary:
      'Testing low-dose anti-clumping helper proteins and refreshable surface shields, gating gentle nerve-reconnection cues on crisp <=3 min low-sugar shut-off, and stacking two-stage smart-RNA purification with independent safety switches.',
    stopRule: 'Reject multi-barrier claims if escapers from barrier one survive barrier two above 1 in 10,000, or if nerve cues reduce blood flow.',
  },
] as const;

export const horizon2ScienceDrawer: readonly string[] = [
  'Why flat-tangent hydrogel contact failed 2D FVM (artifacts-sonnet/receipts/s2_unit_cell_o2_fvm.json, F-01): an 80 µm cluster merely tangent to a breathable wall inside standard hydrogel (K_gel = 1.26e-12) leaves 28.9% (base) to 67.2% (1.30x snapback) of cluster volume <5 mmHg. Recessing >=40 µm into high-K silicone micro-wells drops <5 mmHg volume to 0.0% at 0–10 µm clean water (p_min = 8.3 mmHg at 0 µm; 5.82 mmHg at 10 µm; 1.94% <5 mmHg at 15 µm water; 14.93% <5 mmHg at 10 µm fouled fluid), while ~20% hydrophilic windows keep exponential insulin release time constant tau = 10.7 s (t50 = 7.4 s <= 20 s gate G-04, <0.1 mmHg O2 drop).',
  'Keyhole strip kinematics, gap budget & acute iEOG contingency (receipts s1 & transport_results.json, F-02/F-07): rigid 9.1 x 9.1 cm tiles (29.7 mm rolled OD) cannot pass a 12 mm port; 2–3 cm strips roll to 7.1–10.3 mm OD (7.9–11.8% bend strain, 14.6–20.8% rib occlusion across ~3.3M <=80 µm clusters at 142 µm pitch — a spec shift from Islet-1 <=120 µm). Sliding gap must stay <=10 µm in clean saline (G-02) or use continuous liquid PFC (53x saline O2 conductance, 0.105 mmHg drop at 20 µm, gated on 12-mo zero-egress at 200 mmHg cycling, G-05). Optional Day 0–7 vapour-fed PEM iEOG contingency (11.61–13.36 mA, 132–152 mL/d H2) requires a 4–11 mmHg Laplace condensation guard and >13.36 mA O2 back-diffusion margin.',
  'Illustrative mass-scaling geometry & innervation gates (not a clinical paediatric dose): 4,000–8,000 IEQ/kg at 25 kg corresponds to 83.3–166.7 cm² gross area (~1–2 modular units vs 416.67 cm² adult gross; passive 548.39 cm² rescue exceeds the 420 cm² adult omental ceiling). Paediatric anatomy, oxygen supply, and SC-islet potency per IEQ are unmeasured. Sympathetic NGF/GDNF innervation cues (Rodriguez-Diaz et al. PMID 21723503) require ADRA2A-reversible t50 <= 3.0 min shut-off with preserved pO2 >= 15 mmHg.',
  'Viral, NK & 50-year durability bounds: CMV beta-cell susceptibility (PMID 22158077), granule-localised CAR-SIV proinsulin-processing check before any CXADR edit (PMID 30074059), IIP-0022 split Track-2 B-SCT KIR (upper95 <= 8%) vs held HLA-G1 NK gates, and 50-year system framing via modular strip swaps/click-refresh (passive 90% 50-yr retention would require t_1/2 >= 328.9 yr, s10).',
] as const;

export const horizon3Padlocks: readonly HorizonPadlock[] = [
  {
    ...UNBUILT,
    number: 1,
    id: 'padlock-1',
    title: 'Lock 1 — Reaching only the pancreas safely (and reversibly)',
    wallSummary:
      'In our delivery planning model, ordinary bloodstream nanoparticles land 100–1,000x more in the liver than the pancreas, short-lived RNA washes out without leaving a permanent safety switch, and clearing stray cells inside an enzyme-rich pancreas risks acute pancreatitis.',
    testbedTitle: 'Zero-patient-risk lab test: warm-perfused declined donor organs',
    testbedSummary:
      'Keep human donor pancreata declined for transplant alive on a warm perfusion pump to test local duct delivery of AI-designed, short-lived cell-selective RNA logic gates — measuring target-versus-non-target cell expression and digestive enzymes inside the human organ (paired with liver/systemic models to check organ ratios).',
    stopRule: 'Hold unless local human-organ selectivity and paired liver-comparison studies reach >=100:1 pancreas-to-liver targeting with digestive enzymes below 3x baseline.',
    pmid: '37252614',
    science: [
      'Detargeting & AND-gate arithmetic (artifacts-sonnet/receipts/s9_horizon3_arithmetic.json, gate G-15; normothermic perfused human pancreas Parmentier et al. PMID 37252614): under the 100–1,000:1 IV liver-uptake planning assumption, keeping liver expression <=1% of pancreas needs 10^4–10^5x detargeting after IV delivery vs 10^2–10^3x via retrograde intra-ductal infusion (1–10:1; single-organ perfusion measures intra-pancreatic selectivity while pancreas-to-liver ratios require paired liver comparison). Short-half-life non-persistent ADAR/miRNA AND-gates (P_harm = 10^-3) relax combined two-gate leakage 1,000x (10^-10 -> 10^-7 at N_off = 10^10), corresponding to ~31.6x (sqrt(1,000)) relaxation per independent gate under independence (1.0e-5 -> 3.2e-4 per gate).',
    ],
  },
  {
    ...UNBUILT,
    number: 2,
    id: 'padlock-2',
    title: 'Lock 2 — Teaching autoimmunity to stand down',
    wallSummary:
      'Newly regrown native beta cells carry the person’s own tissue flags, so type 1 diabetes memory T cells will recognise and destroy them again unless paired with proven antigen-specific immune retraining.',
    testbedTitle: 'Zero-patient-risk lab test: "Lock 2 in a dish" matched T-cell challenge',
    testbedSummary:
      'Expose newly converted human pancreas cells carrying their natural tissue flags directly to matched islet-reactive T cells in a dish (alongside optional parallel tolerance work on tolerogenic nanoparticles or regulatory T cells that never holds Version 1 hostage).',
    stopRule: 'Bar any in-body native regeneration step if matched T-cell attack exceeds pre-registered bounds.',
    science: [
      'Dish challenge & optional parallel tolerance bounds (gate G-16): an immune-cloaked pouch hides autologous HLA exposure rather than testing it; optional parallel tolerance trials (tolLNP / CAR-Treg) never delay Islet-1/2 and require exact Clopper–Pearson UCB_95 flare bounds (0 flares in n = 20 -> <=13.9%; n = 50 -> <=5.82%; n = 299 -> <=1.0%).',
    ],
  },
  {
    ...UNBUILT,
    number: 3,
    id: 'padlock-3',
    title: 'Lock 3 — Growing enough wired islets in a shrunk organ',
    wallSummary:
      'In CT imaging, people with long-standing type 1 diabetes had pancreases about 40% smaller on average than people without diabetes, and scattered insulin-positive cells still need capillaries, nerves, partner cells, and <=3 min low-sugar shut-off.',
    testbedTitle: 'Zero-patient-risk lab test: removable donor-tissue cartridges & scan calibration',
    testbedSummary:
      'Place leftover non-islet human donor tissue inside removable test cartridges to measure real conversion rates alongside beta-cell PET tracer scans — testing whether future imaging could track recovery without risky pancreatic biopsies.',
    stopRule: 'Hold Lock 3 unless human tissue reaches >=5% mature working beta-like cells with zero cells left behind on removal.',
    pmid: '40650727',
    science: [
      'Quantitative substrate deficit & imaging calibration (artifacts-sonnet/receipts/s9_horizon3_arithmetic.json, gate G-14 + Missima et al. PMID 40650727: 53.2 vs 87.4 mL [~39% smaller] in 135 established T1D vs 61 controls, plus 15 pre-diagnosis = 150 T1D scans; mouse exocrine conversion Zhou et al. PMID 18754011; progenitor/alpha conversion Matsuoka et al. PMID 28223284; human donor alpha conversion Furuyama et al. PMID 30760930; exendin PET validation Jansen et al. PMID 39405026 & Sakaki et al. PMID 41814494): restoring 4.8e8 beta cells in a 50 g T1D pancreas requires converting 2.4–9.6% (central 4.8% at 2e8 cells/g) of exocrine cells — or 0.94–16.0% across the 3.0e8–8.0e8 x 50–80 g grid — vs ~0.183% naive midpoint (~26.2x short).',
    ],
  },
] as const;

export const failureModes: readonly FailureModeCard[] = [
  {
    ...UNBUILT,
    number: 1,
    id: 'fm-wells',
    title: 'Flat gel sheets or clusters just touching a silicone wall',
    evidenceClass: 'Computed',
    visualKind: 'wells',
    shortcut: 'Place 80–100 µm islet clusters inside a flat gel sheet, or press them lightly against a flat breathable silicone wall.',
    finding:
      '2D oxygen transport models show centred passive sheets leave 83%–98% of cluster volume starved below 5 mmHg. Even clusters touching a flat breathable wall at one point still starve across 29%–67% of their volume inside ordinary gel, while pure silicone blocks sugar and insulin.',
    doesNotProve: 'A 2D unit-cell screen does not prove uniform 3D manufacturing across ~3.3 million micro-cups.',
    instead:
      'Seat <=80 µm clusters halfway (>=40 µm deep) inside breathable silicone micro-cups paired with ~20% water-loving insulin windows, then check in a full 3D oxygen model.',
    stopThreshold: 'Hold if >=1% of cell volume drops below 5 mmHg after a meal in a full 3D model.',
    science: [
      'Receipts s2 & v4_receipts.json (gates G-01, G-04): 40 µm silicone-well recess drops snapback <5 mmHg cluster volume from 67.2% to 0.0% (p_min = 8.3 mmHg at 0 µm gap); ~20% hydrophilic window area gives exponential release time constant tau = 10.7 s (t50 = 7.4 s <= 20 s) with <0.1 mmHg O2 drop.',
    ],
  },
  {
    ...UNBUILT,
    number: 2,
    id: 'fm-pleat-gap',
    title: 'Accordion-folded sheets or a loose watery sliding gap',
    evidenceClass: 'Computed',
    visualKind: 'pleat',
    shortcut: 'Fold a wide sheet like an accordion to save space, or leave a loose 15–50 µm fluid gap so strips slide easily.',
    finding:
      'Accordion folds trap >50 µm fluid pockets that block blood vessels and starve 43% of slab volume. Inside the recessed-cup geometry, a clean watery gap already crosses the 1% starvation line at 15 µm (and protein-clouded fluid crosses it at 10 µm) — exhausting even an optimistic immersed-sphere margin by 29 µm / 14.5 µm.',
    doesNotProve: 'Clean benchtop saline films do not capture 90-day protein buildup inside living tissue.',
    instead:
      'Keep 2–3 cm keyhole strips flat and hold the clean watery gap <=10 µm, or cushion the gap with a thin oxygen-carrying liquid-PFC film.',
    stopThreshold: 'Hold if median watery gap exceeds 10 µm or any oxygen-carrying liquid film leaks over 12 months.',
    science: [
      'Receipts s1 & s2 (gates G-02, G-05): at 1.30x snapback, a 20 µm gap loses 5.58 mmHg in clean saline and 11.16 mmHg in protein-fouled fluid (14.93% <5 mmHg at 10 µm fouled; 1.94% <5 mmHg at 15 µm clean saline in 40 µm wells) vs 0.105 mmHg for continuous liquid PFC retained behind <=1 µm pores (80 kPa Laplace barrier vs 26.7 kPa cough spike).',
    ],
  },
  {
    ...UNBUILT,
    number: 3,
    id: 'fm-day0-plug',
    title: 'Trusting an empty sleeve’s Day-0 oxygen sensor reading',
    evidenceClass: 'Computed',
    visualKind: 'plug',
    shortcut: 'Read oxygen inside an empty outer sleeve before sliding cells in, and place cells right under structural frame ribs.',
    finding:
      'With zero cells inside an empty sleeve, nothing consumes oxygen — so a sensor reads 40 mmHg behind both a healthy 15 µm healing layer and a suffocating 45 µm scar. Meanwhile, a 2 mm solid frame rib creates a 204x steeper sideways oxygen drop underneath.',
    doesNotProve: 'Benchtop frame strength does not prove gentle strip removal after 90 days in vivo.',
    instead:
      'Slide in a calibrated oxygen-consuming test plug + electrical gap gauge on Day 0 to test under real load, leave rib edges cell-free, and test 90-day animal retrieval.',
    stopThreshold: 'Never load living cells if loaded Day-0 sleeve oxygen falls below 8 mmHg.',
    science: [
      'Receipts s1 & transport_results.json (gate G-03): unloaded sensor difference (15 vs 45 µm scar) = 0.0 mmHg; under 1.15x–1.30x oxygen-sink load, a thick 45 µm scar exhausts available luminal oxygen down toward zero while a 15 µm layer stays comfortably above 8 mmHg; 4-electrode gap conductance G = sigma*A/g gives 5% signal per 1 µm at 20 µm.',
    ],
  },
  {
    ...UNBUILT,
    number: 4,
    id: 'fm-blood-pln',
    title: 'Relying on a 5 mL blood tube to spot lymph-node immune memory',
    evidenceClass: 'Computed',
    visualKind: 'blood',
    shortcut: 'Check recipient immune memory with one 5 mL blood tube and skip the small test patch if the dish stays quiet.',
    finding:
      'Sampling math shows 5 mL misses 1-in-a-million circulating reactive T cells ~22%–47% of the time across realistic assay sensitivities — and immune memory sitting inside deep pancreatic lymph nodes has a 100% miss rate in any arm-vein blood draw.',
    doesNotProve: 'Even a larger 40 mL blood draw cannot see tissue-resident memory cells.',
    instead:
      'Use a split 25–50 mL spike-calibrated blood check AND always start with a small removable test patch.',
    stopThreshold: 'Drop rare-clone blood claims if spike-in assay sensitivity falls below 0.25.',
    science: [
      'v4_receipts.json & s10_rederivations.json: f_95(s) = 2.9957/(N*s); at 5 mL conservative yield (6.0e5 T/mL), blood-sampling miss probability is 22.3% at s = 0.50, 30.1% at s = 0.40, and ~47.2% at the s = 0.25 stop floor (a T-cell sampling probability distinct from the INS cfDNA plasma-release parameter in Step 6); PLN f_blood = 0 -> P_miss = 1.0.',
    ],
  },
  {
    ...UNBUILT,
    number: 5,
    id: 'fm-rna-escape',
    title: 'Using a single-step negative RNA switch instead of two-stage logic',
    evidenceClass: 'Computed',
    shortcut: 'Add one negative-only clearance RNA droplet to remove stray immature cells and skip physical sorting.',
    finding:
      'If 1–5% of cells miss a single RNA droplet, at least 1–5% of unwanted cells survive — missing the 1-in-100-million purity bar by >1,000x. Two caspase-based switches also fail together if one clone blocks the shared caspase pathway.',
    doesNotProve: 'Multiplying two paper probabilities does not prove biological independence inside 3D clusters.',
    instead:
      'Keep physical sorting primary until tandem two-stage microRNA logic switches (positive tag + orthogonal mature-islet-protected clearance) prove <1-in-100-million purity with independent safety pathways.',
    stopThreshold: 'Reject multi-barrier multiplication if escapers from barrier one survive barrier two above 1 in 10,000.',
    science: [
      'biostat_results.json & s8 (gate G-12; Tsujisaka et al. PMID 35688152): q_neg(u, eps) = u + (1-u)*eps >= u; tandem >=2-stage miR-302/367-OFF positive selection (eps_sel <= 10^-4) + orthogonal miR-375-repressed clearance reaches f_post = 6.57e-9 <= 10^-8; certification requires >=3e4 first-barrier escapers challenged (beta <= 10^-4).',
    ],
  },
  {
    ...UNBUILT,
    number: 6,
    id: 'fm-amyloid',
    title: 'Treating anti-clumping gel like sticky 1-to-1 flypaper',
    evidenceClass: 'Computed',
    shortcut: 'Coat clusters with a static 1-to-1 binding layer and assume it traps co-released islet amyloid (hIAPP) proteins forever.',
    finding:
      'At normal adult insulin output, co-released amyloid fills every static binding spot on a 1-to-1 coating within 0.4–2.2 days.',
    doesNotProve: 'Fast washout in a microfluidic chip does not rule out clumping inside quiet micro-cups over years.',
    instead:
      'Test substoichiometric BRICHOS helper proteins and refreshable coatings head-to-head against internal ITM2B expression alongside replaceable strips.',
    stopThreshold: 'Drop if coating fails to beat uncoated gel on fibril seeding, >=95% monomer washout, and inflammation over 60 days.',
    science: [
      'transport_results.json (PMIDs 29507232, 40035576): 5.30 nmol monolayer vs 2.39–11.95 nmol/d co-secreted hIAPP -> 0.44–2.22 d 1:1 saturation if the coating captures every secreted molecule; 50-yr 90% passive retention requires t_1/2 >= 328.9 yr, framing 50-yr durability as a modular strip-refresh target.',
    ],
  },
  {
    ...UNBUILT,
    number: 7,
    id: 'fm-pat-thaw',
    title: 'Naive early batch cut-offs or ignoring freeze-thaw selection',
    evidenceClass: 'Computed',
    shortcut: 'Discard any batch below 10% maturity on Days 7–14, and assume freezing and thawing treat all cells equally.',
    finding:
      'In simulated trajectories, an early Day-7/Day-14 cut-off mistakenly discards 93.1% of healthy batches (whereas a two-stage Day-14 + Day-21 slope check cuts mistaken stops to 1.4%, or 3.4% in slow, variable batches, while catching 99.7% of simulated dead ends). Meanwhile, if switch-silenced cells survive thawing 2x better, two thaws enrich their odds 4x (reaching 8x after a week of recovery growth).',
    doesNotProve: 'Computer batch curves do not prove optical sensors are gentle on living islets.',
    instead:
      'Start sensors in watch-only mode until 59–80 runs per group show zero false discards observed, include the exact freeze-thaw inside the 84-day check, and run ~750-cell competitive mixes.',
    stopThreshold: 'Zero scheduling credit if thawing gives switch-silenced cells more than a 1.2x survival edge.',
    science: [
      'Receipts biostat_results.json & s4 (gates G-07..G-09): replacing an early Day-7/14 rule with two-stage Day-14 Z + Day-21 logit-slope cuts false prunes 93.12% -> 1.37% in ordinary batches and 99.99% -> 3.36% in slow/variable healthy batches (gated on zero false discards observed across >=59 / 72 / 80 successful runs per group); two thaws at 2x survival edge give 4x odds enrichment (8x with one week of selective post-thaw growth); 1:1 mix (~750 cells/arm) resolves R = 1.2.',
    ],
  },
  {
    ...UNBUILT,
    number: 8,
    id: 'fm-overlap',
    title: 'Claiming 18 full weeks of cell-bank and mouse-study overlap',
    evidenceClass: 'Computed',
    shortcut: 'Subtract the entire 17–18 week cell-bank testing phase from the 26-week mouse study on paper.',
    finding:
      'Freezing bank vials (4 weeks) and growing, washing, coating, and releasing a matching test lot (8.6 weeks at baseline 60 days, or 6.0 weeks if the entire matching lot finishes in 42 days) take 10–12.6 weeks before Day-0 mouse dosing — leaving ~4.4–7.0 weeks of true overlap (while bigger savings come from running clinical lot freezing and rolling review alongside the 26-week watch).',
    doesNotProve: 'Paper calendar overlap does not erase cleanroom queues if a late bank check fails.',
    instead:
      'Book only 4.4–7.0 weeks of at-risk start overlap, parallelize downstream human batch freezing alongside the 26-week watch, and keep restart room.',
    stopThreshold: 'Zero early-start weeks credited without regulator agreement and backup cleanroom capacity.',
    science: [
      'v4_receipts.json & s10: 17.00 - 4.00 - 8.57 = 4.43 wk at baseline 60-d lot (42 d diff + 8 d washout/OCR + 10 d coating & pre-dose release); 7.00 wk assumes the entire matching coated lot is ready in 42 d (6.00 wk).',
    ],
  },
] as const;

export const ruledOutByPhysics: readonly RuledOutPhysicsCard[] = [
  {
    ...UNBUILT,
    id: 'ro-magnets',
    title: 'Magnetic keyhole docking latches',
    verdictNumber: '0.6–1.2 N·m peak torque in MRI',
    whyRuledOut:
      'Even a tiny 0.4 cm³ neodymium magnet hits 0.6–1.2 N·m of peak wrenching torque (20–41x gravity) inside a standard 1.5–3 T clinical MRI scanner.',
    instead: 'Use non-magnetic PEEK polymer or nitinol mechanical clips.',
    receiptRef: 'artifacts-sonnet/receipts/s7_abort_switch_physics.json',
  },
  {
    ...UNBUILT,
    id: 'ro-ire',
    title: 'Electrical pulses to clear one tired strip in place',
    verdictNumber: '0.75–2.25 kA · up to 73 K no-cooling jump',
    whyRuledOut:
      'High-voltage pulses across a 100 cm², 200 µm-gap strip exceed safe electrode limits by 2–45x (with up to a 73 K no-cooling upper-bound heat jump) and leave dead cell debris trapped inside.',
    instead: 'Spot the stressed strip via its DNA blood tag and slide it out coolly.',
    receiptRef: 'artifacts-sonnet/receipts/s7_abort_switch_physics.json',
  },
  {
    ...UNBUILT,
    id: 'ro-rf-heat',
    title: 'Wireless radio-frequency heating of a single strip',
    verdictNumber: '~36 W · 1.3–2.8 mm heat halo',
    whyRuledOut:
      'Holding 50 °C for two minutes sends a millimetre-wide heat wave into the outer sleeve, injuring the very capillaries the sleeve was built to protect.',
    instead: 'Keep the blood-vessel sleeve cool and slide out only the inner strip.',
    receiptRef: 'artifacts-sonnet/receipts/s7_abort_switch_physics.json',
  },
  {
    ...UNBUILT,
    id: 'ro-wicking',
    title: 'Capillary suction to pull the sliding gap shut',
    verdictNumber: '2.5–25 kPa suction · 267–1,013 N straight-up lift',
    whyRuledOut:
      'Capillary suction pressure (2.5–25 kPa) across a 5–50 µm gap exceeds soft islet stiffness by up to 50x, while lifting straight off would fight 267–1,013 N of pull.',
    instead: 'Rest mechanical load on silicone cup rims and slide sideways on a thin liquid film.',
    receiptRef: 'artifacts-sonnet/receipts/s1_o2_stack_gap_budget.json',
  },
  {
    ...UNBUILT,
    id: 'ro-998-prob',
    title: '"99.8% finished within 48 months" schedule claim',
    verdictNumber: '~9x jump in >48-month runs',
    whyRuledOut:
      'Treating lab steps like independent coin flips hid shared cell-line and cleanroom delays, which lift >48-month runs from 0.44% to 3.98%.',
    instead: 'Retire completion-probability claims; show shared-cause ranges and explore closed isolator steps to decouple room queues.',
    receiptRef: 'artifacts-sonnet/receipts/s5_schedule_tail_probe.json',
  },
] as const;

export const clinicalContextSidebar: readonly string[] = [
  'Since 2025, independent research groups have reported encouraging early human milestones: stem-cell-derived islets restoring insulin production under full anti-rejection drugs (zimislecel phase 1–2 in 14 participants, PMID 40544428; phase 3 NCT04786262 ongoing) and a low safety dose of genetically cloaked donor islets surviving over a year in one participant without anti-rejection drugs (UP421 12-week report PMID 40757665 and 14-month follow-up PMID 42430558; pilot study NCT06239636). Meanwhile, development of an unedited macro-encapsulation device (VX-264, NCT05791201) stopped in 2025 after falling short on insulin output while participant follow-up continued — underscoring why implant transport cannot be left to guesswork even when the exact trial bottleneck remains open.',
  'Those studies belong to independent teams and do not test OpenIslet’s designs. OpenIslet remains at Stage 0 on paper and in computer models, uses zero primates, and requires dedicated wet-lab, nonclinical, and regulatory proof for every proposal on this page.',
] as const;

// ---------------------------------------------------------------------------
// Page wording for /future — structured as a plain-English, evidence-sourced story
// across two clear parts:
//   Part 1 (Prologue + Chapters 1–3): Compressing the clock to Version 1 as AI & robotic labs compound
//   Part 2 (Chapters 4–5): Preparing Generations 2 & 3 in parallel today rather than waiting a decade
//
// Inline markup used inside `pageCopy` strings:
//   **bold**            strong text (may contain *italic* or {mono|...} tokens)
//   *italic*            emphasis
//   [[label|href]]      link; href token "{startHref}" means the site start link, "{contactHref}" the contact link
//   {nobr|text}         text that must not wrap (non-breaking span)
//   {mono|text}         text shown in the monospace face
// ---------------------------------------------------------------------------

export const pageCopy = {
  meta: {
    title: 'The Future',
    description:
      'A plain-English story of how compounding AI, robotic wet-labs, and parallel engineering could compress the wait toward a type 1 diabetes cure — without cutting a single safety check.',
  },

  hero: {
    eyebrow: 'The Future',
    heading: 'How do we go faster, without cutting a single safety check?',
    lead:
      'Trying to cure type 1 diabetes without anti-rejection drugs looks, at first glance, nearly impossible. This is the plain-English story of why we are pushing anyway — how **compounding AI and self-driving wet-labs can compress the wait as we hit each stage**, how we **prepare today for capabilities before they arrive**, and how we **work on next-generation therapies in parallel** while every safety check keeps its full length.',
    modelPill: 'Plain-English story & model',
    modelNote: 'Illustrative planning model — not OpenIslet’s plan for any partner.',
  },

  benchShelf: {
    svgTitle:
      'Two-level diagram: today’s blueprint sits protected on the bench above with full-length safety checks, separated by a lab-proof gate from future ideas explored on the shelf below.',
    benchHeading: 'ON THE BENCH TODAY',
    blueprintLabel: 'Blueprint',
    shieldTitle: 'Full safety checks',
    shieldSub: 'Never shortened',
    quarantineLabel: 'Lab proof required first',
    shelfHeading: 'EXPLORED ON THE SHELF',
    shelfItems: ['Lab loops', 'Flaws caught', 'Shut padlocks'],
    captionBench:
      '**On the bench today (our main focus):** Today’s open [[Islet-1 blueprint|/blueprint]] and [[Roadmap|/roadmap]], protected from distraction while contributors stress-test every assumption at Stage 0.',
    captionShelf:
      '**Explored on the shelf:** Closed-loop robot benches, stage-by-stage time compression, physics checks that catch bad shortcuts early, and next-generation therapies prepared in parallel behind clear lab gates.',
  },

  statusNote: {
    ariaLabel: 'Upfront research status and patient note',
    label: 'Before you read on',
    body:
      'Everything here is an unbuilt forward-planning story on paper, kept separate from today’s [[Blueprint|/blueprint]]. OpenIslet is not recruiting participants, nothing here is medical advice, and wherever a frontier idea sits on the edge of what is possible today, we state what must hold true in a real lab — and what result would rule it out.',
  },

  terms: [
    {
      term: 'Beta cells & islets',
      meaning: 'Tiny clusters of cells in the pancreas that sense blood sugar and release insulin; type 1 diabetes destroys the beta cells inside them.',
    },
    {
      term: 'Anti-rejection drugs',
      meaning: 'Strong daily medicines that calm the whole immune system so it leaves transplanted cells alone, at the trade-off of wider infection and organ risks.',
    },
    {
      term: 'Stage 0',
      meaning: 'Where OpenIslet stands today: testing designs, equations, and literature openly on computers before any physical wet-lab work begins.',
    },
    {
      term: 'Robotic & cloud labs',
      meaning: 'Automated wet-labs where machines tend dishes round the clock, adjust feeding from live sensors, or run digital experiment instructions sent over the internet.',
    },
    {
      term: 'Human organ-chips',
      meaning: 'Thumb-sized living micro-channels lined with real human cells and blood that test human immunity and toxicity without relying on primates.',
    },
    {
      term: 'Smart RNA switches',
      meaning: 'Short-lived messenger RNA molecules that sense a cell’s internal microRNA fingerprint to tag or clear stray immature cells without cutting DNA.',
    },
    {
      term: 'Safety switch',
      meaning: 'A built-in genetic off-switch designed to clear transplanted cells if a doctor ever gives a specific trigger medicine.',
    },
    {
      term: 'Stop rule',
      meaning: 'A clear number written down in advance that forces us to drop or redesign an idea if a lab test falls short.',
    },
  ],

  jump: {
    ariaLabel: 'Chapters on The Future',
    links: [
      { label: 'Why push', href: '#why-push' },
      { label: '1 · AI & robot labs', href: '#ai-and-labs' },
      { label: '2 · Compressing each stage', href: '#time-explorer' },
      { label: '3 · Version-1 lab upgrades', href: '#automated-nursery' },
      { label: '4 · 50-year strip system', href: '#strip-implant' },
      { label: '5 · Pancreas repair', href: '#pancreas-repair' },
    ],
  },

  story: {
    prelude: {
      eyebrow: 'Part 1 · Compressing the clock to Version 1',
      heading: 'What a static table of odds — and a static roadmap — cannot see',
      paragraphs: [
        'Anyone who looks honestly at medical science starts in the same place: most ideas fail. Even on our own [[Blueprint|/blueprint]] page, our starting model puts the chance that at least one of our first three cell designs clears all of its early hurdles at roughly coin-flip odds — before a single dish has been touched. If you read this and think the odds are stacked against us, you are right. Effort and willpower never bend biology, and wishing never makes an unsafe cell safe.',
        'But what a static table of odds cannot see is two things at once. First, relentless open engineering changes how many paths get tested in parallel, how early hidden flaws get killed on paper, and how ready the backup already is before the clock starts. Second, **almost every medical timeline assumes labs in three years will still use today’s tools and technologies, and therefore be bounded by today’s limits**. In reality, the rate of progress is increasing exponentially. AI intelligence, biological foundation models, and robotic wet-labs are compounding every few months. By building OpenIslet in the open with machine-readable recipes and modular cell banks *now* — preparing for capabilities before they even arrive — each jump in AI and lab automation can plug straight into whichever stage we hit next.',
      ],
    },

    ch1: {
      eyebrow: 'Chapter 1 · Self-driving discovery',
      heading: 'Can we use AI, robot benches, cloud labs, and open DNA starter kits to accelerate progress?',
      paragraphs: [
        'For decades, developing a living cell therapy meant moving at the speed of human hands. One team read a few dozen papers, pipetted liquids into plastic flasks day after day, waited months for stem cells to mature, and often discovered only at the very end that oxygen could not reach the middle of the graft or a human immune receptor behaved differently than in mice. Every surprise burned another year.',
        '**First, rapidly strengthening AI lets us kill weak ideas in silicon — and prepare sockets for stronger models ahead.** Frontier AI already helps organize over a thousand primary studies in our open [[Context–Evidence Graph|/ceg]], predicts how proteins and receptors might fit together in 3D ([[Abramson et al., Nature 2024|https://pubmed.ncbi.nlm.nih.gov/38718835/]]), and teams specialist AI agents with human researchers to design biologics whose target binding holds up in wet-lab tests ([[Swanson et al., Nature 2025|https://pubmed.ncbi.nlm.nih.gov/40730228/]]). As biological foundation models get smarter over the next 12 to 36 months, keeping every OpenIslet protocol, endpoint, and immune score machine-readable means tomorrow’s stronger models can audit and sharpen our designs the day they come online — while living cells always keep the final vote.',
        '**Second, wet-labs themselves are becoming closed-loop and automated.** Robotic stem-cell platforms already maintain up to 90 human cell lines with machine consistency and automate multi-lineage differentiation ([[Tristan et al., Stem Cell Reports 2021|https://pubmed.ncbi.nlm.nih.gov/34861164/]]; [[Brandenberg et al., Nat. Biomed. Eng. 2020|https://pubmed.ncbi.nlm.nih.gov/32514094/]]). Pairing a two-armed laboratory robot with an AI search engine across 216 automated culture runs improved a retinal-cell pigmentation score by **88%**, alongside scheduled human steps and occasional troubleshooting ([[Kanda et al., eLife 2022|https://pubmed.ncbi.nlm.nih.gov/35762203/]]). Instead of waiting six weeks to learn a dish drifted, gentle cameras and broth sensors can spot trouble early and iterate right at the bench.',
        '**Third, cloud labs, open DNA starter kits, and automated cell-manufacturing pods point toward biology as runnable code** ([[Arnold, Nature 2022|https://pubmed.ncbi.nlm.nih.gov/35697877/]]; [[Boiko et al., Nature 2023|https://pubmed.ncbi.nlm.nih.gov/38123806/]]; [[Tom et al., Chem. Rev. 2024|https://pubmed.ncbi.nlm.nih.gov/39137296/]]). Autonomous AI systems have already run remote chemical reactions ([[Boiko et al., 2023|https://pubmed.ncbi.nlm.nih.gov/38123806/]]) and executed a self-driving enzyme-engineering loop on a cloud laboratory without human hands in the cycle ([[Rapp et al., Nat. Chem. Eng. 2024|https://pubmed.ncbi.nlm.nih.gov/38468718/]]), while closed systems have automated steps of therapeutic natural-killer-cell manufacturing ([[Kok et al., 2025|https://pubmed.ncbi.nlm.nih.gov/40635691/]]). Pairing runnable cloud-lab scripts with **open research DNA starter kits** lets dozens of benches test Stage-0 and Stage-1 pieces simultaneously — and *if* closed isolator pods extend to six-week islet runs, regional cleanroom hubs could eventually run the exact locked digital recipe locally.',
      ],
      edgeCallout:
        '**Where the edge of possibility sits today:** Cloud labs and open research DNA starter kits can already parallelize construct building, immune-receptor binding screens, and potency assay checks **ahead of Month 0**. Full six-week clinical islet batches still need dedicated cleanrooms and human oversight — *if* we write clean, machine-runnable specs today, an improvement proven on one automated bench can be reproduced across partner labs in days rather than years.',
      sourcesLabel: 'Sources and further reading in Chapter 1 (10)',
      sources: [
        { pmid: '38718835', citation: 'Abramson et al., Nature (2024)', note: 'AlphaFold 3 3D structure prediction of protein, nucleic-acid, and ligand interactions.' },
        { pmid: '40730228', citation: 'Swanson et al., Nature (2025)', note: 'Virtual Lab pairing specialist AI agents and human researchers to design biologics with wet-lab-confirmed binding.' },
        { pmid: '35762203', citation: 'Kanda et al., eLife (2022)', note: 'Robotic stem-cell platform + Bayesian AI search across 216 runs improving an RPE pigmentation score by 88% (0.43 to 0.81, alongside scheduled human operations and intervention on 22/365 jobs).' },
        { pmid: '34861164', citation: 'Tristan et al., Stem Cell Reports (2021)', note: 'Robotic maintenance of up to 90 human pluripotent stem-cell lines and automated multi-lineage differentiation.' },
        { pmid: '32514094', citation: 'Brandenberg et al., Nat. Biomed. Eng. (2020)', note: 'Automated high-throughput organoid culture and live imaging in microcavity arrays.' },
        { pmid: '35697877', citation: 'Arnold, Nature (2022) [Technology feature]', note: 'Overview of cloud laboratories executing remote, software-defined wet-lab protocols.' },
        { pmid: '38123806', citation: 'Boiko et al., Nature (2023)', note: 'Autonomous AI agent planning and executing chemical synthesis experiments on remote laboratory hardware.' },
        { pmid: '38468718', citation: 'Rapp, Bremer & Romero, Nat. Chem. Eng. (2024)', note: 'Self-driving enzyme engineering loop running autonomously on a remote cloud laboratory.' },
        { pmid: '39137296', citation: 'Tom et al., Chem. Rev. (2024) [Review]', note: 'Comprehensive review of self-driving laboratories across chemistry and biology.' },
        { pmid: '40635691', citation: 'Kok et al., Front. Bioeng. Biotechnol. (2025)', note: 'Closed-system automation of two key enrichment/concentration steps in therapeutic NK-cell manufacturing.' },
      ] as readonly StorySource[],
    },

    ch2: {
      eyebrow: 'Chapter 2 · Compressing every stage on the clock',
      heading: 'Can we cut a year of idle waiting around lab and animal tests while keeping every safety check in full?',
      paragraphsBeforeFigure: [
        'Even if AI and laboratory robots work through every night, two clocks are never rushed. The first is a cell’s internal **biological clock**: turning a stem cell into a steady, adult-like beta cell means replacing nearly its entire working set of proteins, which physically takes weeks. The second is the **safety clock**: we watch the cells for 84 days after growth to see whether any survive the safety switch, follow mice for a full 26 weeks against unwanted growth, and hold for 60 full days after a small removable test patch in the first volunteers so an independent board can check every reading.',
        'Where years vanish in traditional medicine is in the **idle waiting queued up around those checks** — building DNA templates one after another instead of concurrently in cloud labs **ahead of Month 0**, waiting to grow human clinical vials until animal tests end, or re-writing trial paperwork from scratch between cohorts. In our six-stage model below (counted from **Month 0**, the day a partner lab starts), preparing early already cuts the model’s total time from **about 48–50 months down to about 38 months (likely 35 to 45)** by shrinking the grey waiting between checks — while every green safety bar stays 100% locked.',
      ],
      paragraphsAfterFigure: [
        '**Why the middle option shows a 35-to-45-month range — and how frontier tools push closer to the ~33-month no-repeat case:** Real steps share donor cell lines and cleanrooms, so setbacks arrive in bunches rather than polite coin flips (our own math threw out an early "99.8% under 48 months" claim once shared bottlenecks were counted). Exploring **closed, automated isolator pods** aims to stop one delayed batch from blocking the next room slot. Beyond that, new discoveries are opening two concrete ways to squeeze remaining dead air as we reach each stage:',
        '**1. Single-pass zero-break gene installation & smart-RNA purification (Steps 1–3):** Instead of editing genes one cut at a time over four to five months, pairing prime editing with evolved or RNA-guided recombinases ([[Pandey et al., Nat. Biomed. Eng. 2025|https://pubmed.ncbi.nlm.nih.gov/38858586/]]; [[Pelea et al., Science 2026|https://pubmed.ncbi.nlm.nih.gov/41642947/]]) aims to drop an entire protective cloak into a pre-checked landing pad in **one gentle ~6–9 week pass** without snapping both DNA strands. At harvest, building on microRNA-sensing RNA switches paired with magnetic sorting to enrich pancreatic precursors ([[Tsujisaka et al., Stem Cell Reports 2022|https://pubmed.ncbi.nlm.nih.gov/35688152/]]), we propose testing two-stage smart-RNA logic for whole-tank clearance without cell-by-cell sorting, while one-day rapid microbial checks ([[Kang et al., Nat. Biomed. Eng. 2026|https://pubmed.ncbi.nlm.nih.gov/41034515/]]) aim to shrink two-week release holds where regulators accept product suitability.',
        '**2. Surrounding the 26-week mouse study from before and alongside (Steps 4–6, zero primates):** OpenIslet **never uses primates**. *Before* Day 0 of the mouse study, sensitive purity screens — multisite droplet PCR detecting ~3 to 10 stray stem cells per million in spiked heart-cell samples ([[Yasuda et al., 2024|https://pubmed.ncbi.nlm.nih.gov/39120125/]]) alongside magnetic-enrichment culture assays validated down to **1 in 5 million** in reference cells ([[Watanabe et al., 2021|https://pubmed.ncbi.nlm.nih.gov/32978066/]]) — plus 50-donor human blood chips aim to filter out flawed batches before animal dosing starts (once islet-specific sensitivity is verified). *Alongside* the 26-week mouse watch, frozen pause-points let labs manufacture, test, and deep-freeze the human clinical batch, open early rolling regulator review (with the strict lock that **zero cells enter a volunteer until full 26-week mouse pathology lands clean**), pre-book digital slide pathology, and run **observational glucose tracking before anyone receives study cells** so baseline data is ready on Day 1. After the 60-day human patch review, a **single seamless Phase 1/2 protocol** with pre-frozen vials trims another six to eight weeks of post-review waiting.',
      ],
      edgeCallout:
        '**Predicting the next shift in animal testing (without cutting safety):** Our baseline chart locks the complete 26-week mouse watch because no responsible first-in-human stem-cell team assumes regulators will waive it today. Yet a single mouse physically holds **less than 1% of an adult human dose**. As regulators adopt 2025–2026 human-relevant nonclinical rules, the *only* way an animal step ever shrinks in future cycles is when testing **hundreds of millions of human cells directly** — via single-molecule DNA sensors, 300-million-cell dish tests, AI pathology, and human organ-chips alongside shorter targeted animal confirmation — proves **strictly sharper** at catching rare rogue cells than a 26-week mouse.',
      sourcesLabel: 'Peer-reviewed studies cited in Chapter 2 (6)',
      sources: [
        { pmid: '38858586', citation: 'Pandey et al., Nat. Biomed. Eng. (2025)', note: 'eePASSIGE: prime editing + evolved Bxb1 recombinase for large single-pass gene integration without double-strand DNA breaks.' },
        { pmid: '41642947', citation: 'Pelea et al., Science (2026)', note: 'Programmable genome integration in human cells using RNA-guided bridge recombinases.' },
        { pmid: '35688152', citation: 'Tsujisaka et al., Stem Cell Reports (2022)', note: 'Purification of human iPSC-derived pancreatic endocrine precursors combining microRNA-sensing mRNA switches with magnetic-activated cell sorting (PMC9287667).' },
        { pmid: '41034515', citation: 'Kang et al., Nat. Biomed. Eng. (2026)', note: 'One-day rapid microbial sterility test for human-derived biopharmaceuticals (alongside compendial USP <72>/<1071> and Ph. Eur. 2.6.27).' },
        { pmid: '39120125', citation: 'Yasuda et al. / HESI CT-TRACS, Stem Cells Transl. Med. (2024)', note: 'Multisite droplet digital PCR detecting ~3 stray stem cells per million in shared spiked cardiomyocyte RNA (~10 per million / 1 in 100,000 in site-prepared samples).' },
        { pmid: '32978066', citation: 'Watanabe et al., Cytotherapy (2021)', note: 'Multisite validation of magnetic-enrichment + colony-culture assay detecting 1 residual pluripotent stem cell in 5 million (0.00002%) in spiked reference cells.' },
      ] as readonly StorySource[],
      appendixSummary: 'For scientists & engineers: open the 100-run setback model, all 6 stage stop rules & schedule math',
    },

    ch3: {
      eyebrow: 'Chapter 3 · Practical upgrades we aim to test on Version 1',
      heading: 'Can automated incubators grow healthier cells faster — and freeze finished batches ready for when they are needed?',
      paragraphs: [
        'Before changing a single letter of DNA in today’s [[Islet-1 blueprint|/blueprint]], three practical incubator and banking upgrades are candidates we actively want partner and robotic labs to test on Version 1. Their goal is simple: waste fewer batches, sharpen how cleanly the cells behave, and untie a person’s surgery date from a live six-week incubator timer.',
        'Inside a healthy body, islets never sit in unchanging soup; they ride 24-hour waves of meals, fasting, and sleep hormones. Daily feeding and fasting cues in lab bioreactors helped lab-grown islets respond more like adult islets and release less insulin when blood sugar is low ([[Alvarez-Dominguez et al., Cell Stem Cell 2020|https://pubmed.ncbi.nlm.nih.gov/31839570/]]), building on maturation benchmarks in [[Balboa et al., Nat. Biotechnol. 2022|https://pubmed.ncbi.nlm.nih.gov/35241836/]]. We want to see whether an automated tank can do the same, hit our 3-minute shut-off target, and eventually trim six-week batch loops toward ~20–25 days without cell stress (while booking zero days of shortcut on Bank 1). Beside the tank, gentle label-free cameras and real-time single-islet secretion sensors ([[Zitzmann et al., 2026|https://pubmed.ncbi.nlm.nih.gov/42054864/]]; [[Sensors 2026|https://pubmed.ncbi.nlm.nih.gov/42197878/]]) start in "watch-only" mode so future AI can learn early signs of drift — and once validated across 59 to 80 runs per group with zero false discards observed, our simulated **two-stage Day-14 and Day-21 slope check** cuts mistaken stops of healthy runs from **93.1% down to 1.4%** while catching **99.7%** of simulated dead-end runs roughly three weeks early.',
        'Right beside the incubator sit two banking upgrades. Qualifying a **deep-freeze pause point (−150 °C or colder)** means clinical batches can be grown, tested, and stored safely in the freezer *while* mouse and regulator reviews finish — provided lab mixes prove thawing never gives rare safety-switch-silenced cells an unfair survival edge. And qualifying one **reusable starter cell bank** lets robot benches load and compare updated protective designs in matching vials side by side, while still running every single deep DNA check and the full 84-day safety watch.',
      ],
      sourcesLabel: 'Peer-reviewed studies cited in Chapter 3 (4)',
      sources: [
        { pmid: '31839570', citation: 'Alvarez-Dominguez et al., Cell Stem Cell (2020)', note: 'Circadian 24-hour nutrient/hormone entrainment improving functional maturation and lowering low-glucose insulin leak in stem-cell islets.' },
        { pmid: '35241836', citation: 'Balboa et al., Nat. Biotechnol. (2022)', note: 'Functional, metabolic, and dynamic insulin-secretion maturation benchmarks in human stem-cell-derived islets.' },
        { pmid: '42054864', citation: 'Zitzmann et al., Biosens. Bioelectron. (2026)', note: 'Real-time, label-free impedimetric tracking of insulin secretion from individual 3D human stem-cell-derived islets.' },
        { pmid: '42197878', citation: 'Sensors (2026)', note: 'Label-free optical monitoring of insulin-granule dynamics paired with secretion in single living human islets.' },
      ] as readonly StorySource[],
      appendixSummary: 'For scientists & engineers: open the 3 Version-1 nursery & banking cards and stop rules',
    },

    part2Bridge: {
      eyebrow: 'Part 2 · Preparing future generations of the cure in parallel',
      heading: 'Why we do not wait ten years to start Generation 2 and Generation 3',
      body:
        'Chapters 1 to 3 are about reaching a safe first human proof of Version 1 faster. Old-school medicine works strictly nose-to-tail: spend a decade testing Version 1, discover its long-term limits, and only then start designing a maintainable 50-year implant or dreaming about a no-surgery cure. With AI physics simulation, automated organoid benches, and donated-organ test rigs, researchers can prepare the next two horizons on the shelf **right now in parallel** — while Version 1 stays protected at the front of the queue.',
    },

    ch4: {
      eyebrow: 'Chapter 4 · Generation 2 (prepared in parallel)',
      heading: 'Can we replace a one-off cell transplant with a slim, maintainable "pocket and strip" system built to last fifty years?',
      paragraphsBeforeFigure: [
        'Since 2025, two human milestones from independent teams have shown that cell replacement is moving out of textbooks. Stem-cell-derived islets infused into the liver restored natural insulin in adults taking full anti-rejection drugs ([[Reichman et al., NEJM 2025|https://pubmed.ncbi.nlm.nih.gov/40544428/]]), and in Sweden a small safety dose of genetically cloaked donor islets survived in one person’s forearm muscle for over a year with **zero anti-rejection drugs** ([[Carlsson et al., NEJM 2025|https://pubmed.ncbi.nlm.nih.gov/40757665/]]; [[14-month follow-up, NEJM 2026|https://pubmed.ncbi.nlm.nih.gov/42430558/]]). Meanwhile, development of an unedited macro-encapsulation device stopped after falling short on insulin output — a sharp reminder that **implant oxygen and transport cannot be left to guesswork**, even while the exact trial cause remains open.',
        'Version 1 aims to prove immune-cloaked stem-cell islets work safely. Generation 2 asks a longer question: **how do you live comfortably with an implant for 40 or 50 years?** Over decades, even healthy grafts eventually tire out or build up protein clumps. When our physics scripts tested obvious shortcuts — flat gel sheets, accordion folds, MRI-unsafe magnets, heat pulses, or reading oxygen inside an empty pouch — every one of them failed on paper.',
        'What survived those equations is a gentle two-part **"pocket and strip"** architecture. First, a thin, cell-free **breathable outer pocket (sleeve)** goes in ahead of time so tiny blood vessels settle calmly around it — checked *under real oxygen load* on Day 0 before any cells go near it (with an optional tiny **Day 0–7 vapour-fed electronic oxygen bridge** modelled as an early backup while vessels mature). Second, slim flexible **2–3 cm keyhole strips** roll through a keyhole port and glide inside that pocket, seating tiny islet clusters halfway inside breathable silicone micro-cups with microscopic windows so insulin steps out in seconds.',
        'Designed as a **50-year maintainable system**, each strip carries its own harmless non-coding DNA tag so scheduled blood checks could flag sustained cell loss in one tired strip before blood sugar rises — letting a surgeon slide out just that strip while leaving the blood-vessel pocket untouched. Alongside that, we model anti-clumping helper proteins ([[Oskarsson et al., PNAS 2018|https://pubmed.ncbi.nlm.nih.gov/29507232/]]; [[Zhang et al., 2025|https://pubmed.ncbi.nlm.nih.gov/40035576/]]), refreshable surface shields, and — guided by nerve maps alongside human islet blood vessels ([[Rodriguez-Diaz et al., Cell Metabolism 2011|https://pubmed.ncbi.nlm.nih.gov/21723503/]]) — test whether gentle nerve-guiding cues help meet our 3-minute low-sugar shut-off target. Strictly **after** adult single-dose and repeat-swap safety pass, modular strips could eventually let doctors tailor strip counts across life stages — adding a strip during growth or pregnancy, and sliding one out afterward.',
        'Try changing the cup design and the tiny sliding gap below to see how they affect oxygen reaching the deepest cells after a meal. **If the full 3D oxygen check holds up, we can build a physical strip prototype, track oxygen inside the healing pocket over time (as demonstrated in mouse implants with fluorine MRI and optical sensors, [[Liang et al., PNAS 2019|https://pubmed.ncbi.nlm.nih.gov/30808810/]]; [[Najdahmadi et al., 2020|https://pubmed.ncbi.nlm.nih.gov/32024377/]]), and see whether it still slides out cleanly after 90 days.**',
      ],
      sourcesLabel: 'Peer-reviewed studies cited in Chapter 4 (8)',
      sources: [
        { pmid: '40544428', citation: 'Reichman et al., N. Engl. J. Med. (2025)', note: 'Zimislecel stem-cell-derived islets restoring insulin production in 14 adults with T1D under full immunosuppression.' },
        { pmid: '40757665', citation: 'Carlsson et al., N. Engl. J. Med. (2025)', note: 'Initial 12-week human survival and meal-responsive C-peptide in one participant receiving hypoimmune-edited donor islets (UP421) without immunosuppression.' },
        { pmid: '42430558', citation: 'Carlsson et al., N. Engl. J. Med. (2026)', note: '14-month follow-up in that participant confirming over-one-year survival and function without immunosuppression.' },
        { pmid: '29507232', citation: 'Oskarsson et al., Proc. Natl. Acad. Sci. USA (2018)', note: 'Bri2-BRICHOS molecular chaperone suppressing hIAPP amyloid fibril toxicity in human beta cells.' },
        { pmid: '40035576', citation: 'Zhang et al., ACS Chem. Neurosci. (2025)', note: 'Substoichiometric molecular dynamics mechanism of Bri2-BRICHOS amyloid-seed inhibition.' },
        { pmid: '21723503', citation: 'Rodriguez-Diaz et al., Cell Metabolism (2011)', note: 'Mapping autonomic nerve anatomy alongside human islet blood vessels, motivating tests of nerve-guiding cues.' },
        { pmid: '30808810', citation: 'Liang et al., Proc. Natl. Acad. Sci. USA (2019)', note: 'Fluorine-19 MRI + machine learning tracking implant oxygen in diabetic mice over 90 days.' },
        { pmid: '32024377', citation: 'Najdahmadi et al., Cell Transplant. (2020)', note: 'Repeated non-invasive optical tracking of oxygen inside implanted subcutaneous devices in mice.' },
      ] as readonly StorySource[],
      appendixSummary: 'For scientists & engineers: open all 13 pre-lab calculations, Generation-2 strip specs & ideas ruled out by physics',
    },

    ch5: {
      eyebrow: 'Chapter 5 · Generation 3 (the outpatient North Star, locked at Stage 0)',
      heading: 'Can we one day wake up your own pancreas without surgery — and start tackling all three roadblocks today?',
      paragraphsBeforeFigure: [
        'Look far enough ahead and everyone arrives at the same ultimate dream: a gentle outpatient infusion that coaxes cells already inside your own pancreas to become working, insulin-making islets again — no pocket, no strips, no surgery at all. Animal studies showed years ago that neighbouring pancreatic cells can switch roles when given the right signals ([[Zhou et al., Nature 2008|https://pubmed.ncbi.nlm.nih.gov/18754011/]]; [[Matsuoka et al., Diabetes 2017|https://pubmed.ncbi.nlm.nih.gov/28223284/]]), and cells from donated **human** islets have already been coaxed into releasing insulin when glucose rises and reversing diabetes when grafted into mice ([[Furuyama et al., Nature 2019|https://pubmed.ncbi.nlm.nih.gov/30760930/]]).',
        'Inside a person living with long-standing type 1 diabetes, however, that dream currently hits **three hard biological walls at once**. First, in our delivery planning model, ordinary bloodstream nanoparticles flood the liver 100 to 1,000 times more than the pancreas — and unlike a strip you can slide out, stray edited cells inside a digestive-enzyme-packed pancreas cannot be lifted out safely. Second, newly regrown native beta cells carry your own natural tissue flags, so autoimmune memory T cells will attack them all over again unless paired with **antigen-specific immune retraining** (such as tolerogenic nanoparticles or regulatory T cells, explored on an optional parallel track that never delays Version 1). Third, in one CT study, people with long-standing type 1 diabetes had pancreases **about 40% smaller on average** than people without diabetes ([[Missima et al., Endocrine 2025|https://pubmed.ncbi.nlm.nih.gov/40650727/]]), and scattered insulin-positive cells still need blood vessels, nerves, and partner cells to shut off insulin within 3 minutes when blood sugar drops.',
        'We draw all three walls below as **shut padlocks of equal weight** — zero progress bars and zero timeline promises. Yet preparing for AI breakthroughs means starting on the testbeds *before* the locks open: pairing **AI-designed, short-lived cell-selective RNA logic gates** (which switch on only inside target pancreatic cells and fade without cutting DNA) with **declined human donor pancreata kept alive on warm perfusion pumps** ([[Parmentier et al., Transpl. Int. 2023|https://pubmed.ncbi.nlm.nih.gov/37252614/]]), matched T-cell dishes, and removable donor-tissue cartridges alongside non-invasive beta-cell imaging tracers ([[Jansen et al., 2024|https://pubmed.ncbi.nlm.nih.gov/39405026/]]; [[Sakaki et al., Diabetes 2026|https://pubmed.ncbi.nlm.nih.gov/41814494/]]) lets labs work on all three locks today at **zero risk to anyone living with type 1 diabetes**.',
      ],
      sourcesLabel: 'Peer-reviewed studies cited in Chapter 5 (7)',
      sources: [
        { pmid: '18754011', citation: 'Zhou et al., Nature (2008)', note: 'Classic mouse demonstration reprogramming adult pancreatic exocrine cells into beta-like cells in vivo.' },
        { pmid: '28223284', citation: 'Matsuoka et al., Diabetes (2017)', note: 'Conversion of pancreatic islet progenitors and committed alpha cells into insulin-producing beta cells.' },
        { pmid: '30760930', citation: 'Furuyama et al., Nature (2019)', note: 'Reprogrammed human donor islet alpha cells secreting insulin in response to glucose and reversing diabetes in mice.' },
        { pmid: '40650727', citation: 'Missima et al., Endocrine (2025)', note: 'CT imaging study showing pancreases ~40% smaller on average in established T1D (53.2 vs 87.4 mL across 135 established T1D vs 61 controls; 150 total scans including 15 pre-diagnosis).' },
        { pmid: '37252614', citation: 'Parmentier et al., Transpl. Int. (2023)', note: 'Normothermic ex vivo machine perfusion keeping declined human donor pancreata viable for zero-patient-risk intra-organ testing.' },
        { pmid: '39405026', citation: 'Jansen et al., EJNMMI Res. (2024)', note: 'Ex vivo validation of radiolabelled exendin aligning with insulin-positive regions in human pancreas tissue.' },
        { pmid: '41814494', citation: 'Sakaki et al., Diabetes (2026)', note: 'Quantitative beta-cell mass PET imaging showing lower pancreatic uptake in people with type 1 diabetes.' },
      ] as readonly StorySource[],
    },
  },

  explorer: {
    eyebrow: 'Figure 2 · Interactive timeline',
    heading: 'See what shrinks when labs prepare ahead — and what never shrinks',
    intro:
      'Each row below is one stage on the road to a first human study, starting the day a partner lab begins (**Month 0**). Switch between the three buttons below to compare working **one step at a time** versus **preparing steps in parallel**: the **grey bars** are idle waiting and setup queues that can shrink, while the **green bars** are safety checks that keep their exact full length every time. *(Striped green bars simply run at the same time as another stage on the calendar instead of waiting in line.)*',
    notShown: {
      badge: 'Ahead of Month 0 · What can start before Day 1',
      text:
        'Finding a partner lab, readying cleanrooms, ethics approval, and running **cloud-lab DNA kits, receptor checks, and test rehearsals in parallel** before Day 1. **This setup phase varies by partner and is often the longest wait of all.**',
    },
    scenarioLegend: 'Compare three ways of working',
    highlight: {
      label: 'Spotlight the locked safety checks',
      help: 'Every green safety bar keeps the exact same width in all three options',
    },
    liveAnnouncement: [
      null,
      ': sentinel patch ',
      null,
      ', conditional readout ',
      null,
      '. All safety checks remain unchanged.',
    ],
    liveAnnouncementFields: ['radioLabel', 'sentinelMonths', 'readoutMonths'],
    endpoints: {
      sentinel: {
        label: 'First small test patch',
        footnote: 'Removable small patch, and only if regulators allow it',
      },
      review60: {
        label: 'Independent safety review',
        footnote: 'Full 60-day review after the last small test patch',
      },
      readout: {
        label: 'First later-stage results',
      },
    },
    board: {
      legendWait: 'Grey: idle waiting & queues (can shrink)',
      legendSafe: 'Solid green: full safety checks (never shortened)',
      legendHatch: 'Striped green: full safety checks running alongside another stage',
      lockedFloor: 'Locked',
    },
    science: {
      summary: 'For scientists: unified Round-3 DAG parameters, Gaussian copula & Master Timeline reconciliation',
      items: [
        '**Causal DAG provenance ({mono|verify_immunology_purge_and_schedule.py}, seed {mono|2026111602}, & {mono|artifacts-v4/verify_future_roadmap_v4.py}):** Full dependency-graph Monte Carlo uses a staggered {mono|3+3} sentinel base case ({mono|4.5 mo} total sentinel span *including* the {mono|60-day} DSMB hold after the last required sentinel -> no-repeat planning baseline {mono|33.42 mo}, or {mono|32.42 mo} at {mono|3.5 mo} stagger; individual stochastic draws can land slightly earlier when steps finish ahead of nominal duration) and unbooked {mono|42-day} differentiation on Bank 1 (comparing {mono|22 d} vs {mono|42 d} shifts Bank-1 P50 by {mono|+0.005 mo} in {mono|s5_schedule_tail_probe.json} because {mono|119-d} compendial banking governs, before counting {mono|8-d} washout/OCR or downstream test/clinical-lot loops).',
        '**Reconciling {mono|Month 0} with the Master Timeline:** In {mono|OPENISLET-2026-2030-MASTER-TIMELINE.md}, illustrative {mono|Month 1 = Nov 2026} corresponds to the {mono|48.0-month} deterministic sequential reference row ({mono|50.35 mo} PERT P50, {mono|47.45–54.47 mo} P10–P90); {mono|/future} anchors strictly at partner {mono|Month 0} and makes zero calendar-year predictions.',
        '**Shared-cause Gaussian copula tail probe ({mono|artifacts-sonnet/receipts/s5_schedule_tail_probe.json}):** Modelling shared donor/cleanroom shocks with a one-factor Gaussian copula ({mono|rho = 0.35}, {mono|n = 40,000}) gives median sentinel patch {mono|26.13 mo} ({mono|24.0–31.1 mo} P10–P90) and shifts staggered prepared-ahead readout P10–P90 from {mono|35.00–42.83 mo} (independent, P50 {mono|38.41 mo}, {mono|78.0%} >=1 repeat, {mono|2.8%} >=4 repeats) to {mono|34.55–44.75 mo} (shared-cause, P50 {mono|37.57 mo} on a 42-d representative lot; {mono|38.16 mo} P50 with {mono|35.14–45.51 mo} P10–P90 on the 60-d coated lot + 134-d satellite branch — both rounding to ~38 mo and 35–45 mo) and lifts {mono|>48 mo} tail mass ~9x ({mono|0.44% -> 3.98%}; {mono|7.49%} at {mono|rho = 0.60}).',
      ],
    },
    table: {
      heading: 'Compare all three modes as a table',
      caption:
        'The three ways of working compared from Month 0. Every safety check keeps its full length in all three.',
      columns: [
        'Way of working',
        'First small test patch',
        'Independent safety review',
        'First later-stage results',
        'Modelled range',
      ],
    },
  },

  setbacks: {
    heading: 'Why setbacks arrive in bunches (100-dot view of 40,000 simulated runs)',
    intro:
      'These 100 dots are a rounded view of 40,000 simulated lab schedules from Month 0. Because real steps share donor cells and cleanrooms, repeats cluster together unless closed isolator steps decouple room queues.',
    legend: 'How setbacks are modelled',
    cleanLabel: 'runs need zero repeats',
    moderateLabel: 'runs need 1 to 3 repeats',
    bunchedLabel: 'runs need 4 or more repeats',
    tailLabel: 'of runs take longer than 48 months',
    outOf: ' / 100',
  },

  stageLabels: {
    heading: 'The six stages from Month 0 — and how each compresses safely',
    step: ['Step ', null],
    stepFields: ['step'],
    unbuiltBadge: 'Unbuilt model',
    preparedAhead: 'How AI, parallel prep & automation compress the wait',
    safetyFloor: 'What always keeps its full length',
    stopRule: 'Stop rule',
    scientists: 'For scientists',
  },

  horizons: {
    eyebrow: 'Future horizons',
    heading: 'Ordered by distance from today’s bench',
    intro:
      'Version-1 nursery upgrades add zero DNA edits; Generation-2 keyhole strips require 3D oxygen and surgical proof; and Generation-3 pancreas repair remains behind three shut padlocks at Stage 0.',
    stopRule: 'Stop rule',
    h1: {
      kicker: 'Nearer term · Version 1',
      heading: 'Automated nursery, banking & early-catch upgrades ({nobr|Islet-1}, zero new DNA cuts)',
    },
    h2: {
      kicker: 'Generation 2 · Parallel hardware track',
      heading: '50-year modular keyhole strip specifications ({nobr|Islet-2} research proposals)',
      note:
        '**Why flat gel failed screening:** Clusters merely touching a flat breathable wall inside ordinary gel still starve across 29%–67% of their volume, pure silicone blocks sugar and insulin, and rigid 9 × 9 cm tiles cannot pass a 12 mm keyhole port.',
      scienceSummary:
        'For scientists: Generation-2 2D FVM cup+gap receipts, keyhole kinematics, iEOG & mass-scaling arithmetic',
    },
    h3: {
      kicker: 'Generation 3 · Stage-0 hold',
      heading: 'Three shut padlocks between today and no-surgery pancreas repair',
      intro:
        'Each padlock carries equal weight — zero progress bars, zero half-turned keys — and opens below to show how laboratories can test it right now using donated human organs and tissue outside the body.',
    },
  },

  ladder: {
    eyebrow: 'Figure 3 · Interactive cross-section (unified 2D cup-and-gap oxygen screen)',
    heading: 'How oxygen reaches the centre of a strip’s islet cluster',
    intro:
      'Pick a cup design and slide the gap width to see whether oxygen reaches the deepest cells after a meal ({mono|Comfortable} / {mono|Tight} / {mono|Starved}) under the same 1% low-oxygen stop rule. Exact pressures await a full 3D model.',
    verdictLabel: 'Deepest cell status',
    mediumLegend: 'Cup design & liquid in the sliding gap',
    options: {
      pfc: 'Silicone cup + oxygen-carrying liquid',
      water: 'Silicone cup + clean saline film',
      fouled: 'Silicone cup + protein-clouded fluid',
      tangent: 'Flat gel (no silicone cup)',
    },
    sliderLabel: 'Sliding gap between outer pocket and inner strip',
    ticks: ['5 µm (snug)', '10 µm (saline limit)', '30 µm', '50 µm (loose pocket)'],
    gapValue: [null, ' µm'],
    gapValueFields: ['gap'],
    valueText: [null, ' micrometres — ', null],
    valueTextFields: ['gap', 'verdict'],
    statusWords: {
      comfortable: 'Comfortable',
      tight: 'Tight',
      starved: 'Starved',
    },
    verdicts: {
      comfortable: 'Comfortable oxygen margin in 2D cup screen',
      tight: 'Tight margin — right on the edge of the stop rule',
      starved: 'Starved core (>=1% volume low-oxygen) — ruled out by stop rule',
    },
    rows: {
      capillary: {
        title: 'Nearby blood vessels',
        desc: 'Tiny host capillaries settled peacefully outside the pocket before any cell strip slides in.',
      },
      scar: {
        title: 'Thin healing tissue layer',
        desc: 'Kept within <=50 µm and checked under real oxygen load on Day 0 (never an empty sleeve).',
      },
      sleeve: {
        title: 'Breathable outer pocket wall',
        desc: 'Stays in place so future strip swaps leave the surrounding blood vessels undisturbed.',
      },
      gap: {
        titleParts: ['Tiny sliding gap (', null, ')'],
        titlePartsFields: ['gapValue'],
        initialDesc:
          'Thin oxygen-carrying liquid film conducts oxygen ~53x faster than water across micro-scale clearance.',
      },
      well: {
        title: 'Silicone micro-cup & insulin windows',
        initialDesc:
          'Breathable cup (>=40 µm deep) feeds oxygen from the sides while tiny water-loving windows let insulin step out in seconds.',
      },
      core: {
        title: 'Centre of the islet cluster (after a meal)',
        initialDesc:
          'Stays comfortably above the survival floor in 2D screening; still requires a full 3D check.',
      },
    },
    descriptions: {
      gap: {
        tangent:
          'Even with a snug 5 µm gap, flat gel without a breathable cup chokes oxygen around the sides of the cluster.',
        pfcNarrow:
          'Thin oxygen-carrying liquid film conducts oxygen ~53x faster than water (requires 12-month zero-leak proof).',
        pfcWide:
          'Oxygen still crosses easily, but a loose 40–50 µm gap invites mechanical shear and fluid pockets; keep the slide gap snug.',
        waterSnug:
          'At a snug 5 µm clearance, clean saline stays thin enough for a comfortable post-meal oxygen margin.',
        waterLimit:
          'Right at the 10 µm clean-saline ceiling: zero cells breach the floor yet, but spare margin is thin if proteins build up.',
        waterWide:
          'At 15 µm and wider, stagnant saline resistance pushes >=1.9% of cluster volume below the 2D oxygen stop rule.',
        fouledSnug:
          'Proteins clouding the fluid cut oxygen flow in half — leaving only a razor-thin margin even at a snug 5 µm gap.',
        fouledWide:
          'At 10 µm and wider, protein-clouded fluid starves >=14.9% of cluster volume after a meal — ruled out by the 2D stop rule.',
      },
      well: {
        default:
          'Breathable cup (>=40 µm deep) feeds oxygen from the sides while ~20% water-loving windows release insulin in seconds.',
        tangent:
          'No silicone cup: touching a flat wall at one point inside ordinary gel starves at least two-thirds of the cluster after a meal.',
      },
      core: {
        tangent:
          'Starved core (at least two-thirds low-oxygen, ~67%–95% across the slider) — why flat gel was replaced by >=40 µm micro-cups.',
        pfcNarrow:
          'Zero low-oxygen volume (<5 mmHg) in 2D cup screening; still requires a full 3D twin across millions of cups.',
        pfcWide:
          'Core stays Comfortable (0% below 5 mmHg in 2D), though the loose 40–50 µm sliding gap above carries a mechanical tolerance warning.',
        waterSnug:
          'Core stays comfortably above the 5 mmHg survival floor at a snug 5 µm clean-saline gap.',
        waterLimit:
          'Core barely clears the floor at 10 µm — vulnerable if healing tissue thickens or proteins cloud the fluid.',
        waterWide:
          'Core breaches the >=1% low-oxygen stop rule during post-meal insulin demand — blocked on paper.',
        fouledSnug:
          'Tight core margin at 5 µm — shows why 90-day animal protein-fouling checks are mandatory.',
        fouledWide:
          'Core starves after a meal (>=14.9% below 5 mmHg at 10 µm) — breaches the 2D cluster stop rule (separate from the Day-0 sleeve check).',
      },
    },
  },

  padlocks: {
    bannerStatus: 'ALL THREE SHUT AT STAGE 0',
    bannerLabels: [
      'LOCK 1 · SAFE PANCREAS DELIVERY',
      'LOCK 2 · IMMUNE RETRAINING',
      'LOCK 3 · ENOUGH WIRED ISLETS',
    ],
    badge: ['Shut padlock ', null, ' of 3'],
    badgeFields: ['number'],
    holdBadge: 'Figure 4 · Stage-0 hold',
    pmid: ['PMID ', null],
    pmidFields: ['pmid'],
    stopRule: 'Stop rule',
    scientists: 'For scientists',
  },

  failureModes: {
    eyebrow: 'Pre-lab falsifier calculations',
    heading: 'Eight tempting shortcuts our equations flagged before touching a dish',
    intro:
      'Computer math cannot prove a biological cure works — only wet-lab and human evidence can. What math does remarkably well is catch shortcuts that break oxygen transport, sampling statistics, or calendar arithmetic before years are lost.',
    unbuiltBadge: 'Unbuilt check',
    shortcutLabel: 'Tempting shortcut',
    findingLabel: 'What the calculation showed',
    doesNotProveLabel: 'What the model does not prove',
    insteadLabel: 'Safeguard instead',
    scientists: 'For scientists',
    svg: {
      wells: {
        title:
          'Comparison: cluster centred in flat gel starves in the core, whereas a cluster seated halfway inside a breathable silicone micro-cup with insulin windows stays oxygenated.',
        leftLabel: 'Flat gel: starved core',
        rightLabel: '>=40 µm cup + window',
      },
      pleat: {
        title:
          'Comparison: accordion pleats trap fluid pockets over 50 micrometres wide that block blood vessels, whereas flat keyhole strips keep a sub-10 micrometre or liquid-cushioned sliding gap.',
        leftLabel: 'Accordion fold / >=15 µm water',
        rightLabel: 'Flat <=10 µm / liquid film',
      },
      plug: {
        title:
          'Comparison: an empty sleeve reads 40 mmHg even behind a thick 45 micrometre scar because zero oxygen is consumed, whereas a Day-0 oxygen-consuming plug exposes the scar drop under load.',
        leftLabel: 'Empty sleeve: false 40 mmHg',
        leftNote: '0 load = blind',
        rightLabel: 'Loaded Day-0 test plug',
        rightNote: '>=8 mmHg gate',
      },
      blood: {
        title:
          'Comparison: a 5 mL blood tube misses rare circulating clones and is blind to deep lymph nodes, so 25 to 50 mL split draws are paired with a small removable test patch.',
        leftLabel: '5 mL tube + lymph blind spot',
        leftNote: 'Lymph hidden',
        rightLabel: '25–50 mL + test patch',
        rightNote: '3+3 sentinel',
      },
    },
  },

  ruledOut: {
    eyebrow: 'Idea Graveyard sister list',
    heading: 'Five more ideas ruled out by physics during forward planning',
    link: { label: 'Browse the main Idea Graveyard', href: '/idea-graveyard' },
    badge: 'Ruled out on paper',
    insteadLabel: 'Instead:',
  },

  closing: {
    eyebrow: 'Where today meets the future',
    heading: 'Every future breakthrough starts at Stage 0 today — come push with us',
    body:
      'Steep odds only beat you for good when you stop at a single roll of the dice. Today, our primary job stays right on the bench: stress-testing and sharpening the open [[Islet-1 blueprint|/blueprint]] while building machine-ready specs so compounding AI and robotic wet-labs can plug straight in as we reach each stage. Whether you have ten minutes with an AI chat ([[Start here|{startHref}]]), spot a flaw in any equation or paper on this page ([[Submit an IIP|/submit]]), or run an automated or academic bench that wants to test one of these gates in the open — you do not need permission to help.',
    links: [
      { label: 'Help test Stage 0 today', href: '{startHref}#step-1' },
      { label: 'Submit an IIP', href: '/submit' },
      { label: 'Research & robot labs: say hello →', href: '{contactHref}' },
    ],
  },

  evidence: {
    asideAriaLabel: 'External field context and page provenance',
    scienceSummary: 'For scientists: external clinical context & Stage-0 boundary',
    pmid: { label: 'PMID 40544428', id: '40544428' },
    boundaryNote:
      '**Boundary note:** OpenIslet does not provide medical treatment or medical advice, uses zero primates, and is not recruiting trial participants.',
    provenance:
      'Forward-planning model {mono|v4.2} · Illustrative planning model — not OpenIslet’s plan for any partner · Checked against open script receipts ({mono|CC BY 4.0}) in *For scientists* folds.',
    classes: {
      Computed: 'From an open physics or statistical script on this project (still unbuilt in a wet lab).',
      Literature: 'Backed by peer-reviewed published studies, cited by PubMed ID.',
      Assumption: 'A working planning estimate written down openly so anyone can challenge it.',
      Idea: 'An early engineering or incubator proposal that still needs its first dish check.',
    },
  },
} as const;

// ---------------------------------------------------------------------------
// Oxygen Margin Ladder model — derived directly from the unified 2D axisymmetric FVM
// solver (`s2_unit_cell_o2_fvm.py`: 80 µm cluster seated 40 µm deep in high-K silicone
// micro-well, 20 µm breathable silicone sleeve wall, standard hydrogel interior, 1.30x
// post-meal snapback load, stop rule >=1.0% cluster volume <5 mmHg):
//   - pfc:     5..50 µm -> 0.00% <5 mmHg (p_min 8.27 -> 8.06 mmHg, core Comfortable); >35 µm marks gap Tight on mechanical shear/pocket tolerance
//   - water:   5 µm -> 0.00% <5 mmHg (p_min 7.06, Comfortable); 10 µm -> 0.00% <5 mmHg (p_min 5.82, Tight); >=15 µm -> >=1.94% <5 mmHg (Starved)
//   - fouled:  5 µm -> 0.00% <5 mmHg (p_min 5.82, Tight); >=10 µm -> >=14.93% <5 mmHg (Starved)
//   - tangent: 5..50 µm -> >=67.24% <5 mmHg (Starved across all gaps)
// ---------------------------------------------------------------------------

export const ladderModel = {
  slider: { min: 5, max: 50, step: 5, value: 10, fallbackValue: 10 },
  optionIds: ['pfc', 'water', 'fouled', 'tangent'],
  selectedOptionId: 'pfc',
  statusIds: ['comfortable', 'tight', 'starved'],
  rowIds: ['capillary', 'scar', 'sleeve', 'gap', 'well', 'core'],
  rules: {
    tangent: [
      {
        upTo: 5,
        rowStatuses: ['comfortable', 'comfortable', 'comfortable', 'comfortable', 'starved', 'starved'],
        verdictKey: 'starved',
        descKeys: { gap: 'tangent', well: 'tangent', core: 'tangent' },
      },
      {
        upTo: 10,
        rowStatuses: ['comfortable', 'comfortable', 'comfortable', 'tight', 'starved', 'starved'],
        verdictKey: 'starved',
        descKeys: { gap: 'tangent', well: 'tangent', core: 'tangent' },
      },
      {
        upTo: null,
        rowStatuses: ['comfortable', 'comfortable', 'comfortable', 'starved', 'starved', 'starved'],
        verdictKey: 'starved',
        descKeys: { gap: 'tangent', well: 'tangent', core: 'tangent' },
      },
    ],
    pfc: [
      {
        upTo: 35,
        rowStatuses: ['comfortable', 'comfortable', 'comfortable', 'comfortable', 'comfortable', 'comfortable'],
        verdictKey: 'comfortable',
        descKeys: { gap: 'pfcNarrow', well: 'default', core: 'pfcNarrow' },
      },
      {
        upTo: null,
        rowStatuses: ['comfortable', 'comfortable', 'comfortable', 'tight', 'comfortable', 'comfortable'],
        verdictKey: 'comfortable',
        descKeys: { gap: 'pfcWide', well: 'default', core: 'pfcWide' },
      },
    ],
    water: [
      {
        upTo: 5,
        rowStatuses: ['comfortable', 'comfortable', 'comfortable', 'comfortable', 'comfortable', 'comfortable'],
        verdictKey: 'comfortable',
        descKeys: { gap: 'waterSnug', well: 'default', core: 'waterSnug' },
      },
      {
        upTo: 10,
        rowStatuses: ['comfortable', 'comfortable', 'comfortable', 'tight', 'comfortable', 'tight'],
        verdictKey: 'tight',
        descKeys: { gap: 'waterLimit', well: 'default', core: 'waterLimit' },
      },
      {
        upTo: null,
        rowStatuses: ['comfortable', 'comfortable', 'comfortable', 'starved', 'comfortable', 'starved'],
        verdictKey: 'starved',
        descKeys: { gap: 'waterWide', well: 'default', core: 'waterWide' },
      },
    ],
    fouled: [
      {
        upTo: 5,
        rowStatuses: ['comfortable', 'comfortable', 'comfortable', 'tight', 'comfortable', 'tight'],
        verdictKey: 'tight',
        descKeys: { gap: 'fouledSnug', well: 'default', core: 'fouledSnug' },
      },
      {
        upTo: null,
        rowStatuses: ['comfortable', 'comfortable', 'comfortable', 'starved', 'comfortable', 'starved'],
        verdictKey: 'starved',
        descKeys: { gap: 'fouledWide', well: 'default', core: 'fouledWide' },
      },
    ],
  },
} as const;

// ---------------------------------------------------------------------------
// Timeline explorer and 100-dot picture numbers/ids.
// ---------------------------------------------------------------------------

export const explorerModel = {
  maxTrackUnits: 44,
  widthDecimals: 2,
  defaultScenarioId: 'prepared',
  fallbackScenarioIndex: 1,
  defaultSetbackId: 'shared',
  fallbackSetbackIndex: 0,
  dotCount: 100,
  dotOrder: ['clean', 'moderate', 'bunched'],
} as const;
