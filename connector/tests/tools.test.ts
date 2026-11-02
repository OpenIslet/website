// Golden tests: each tool is asked fixed questions through the real MCP server and must give the expected answers.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Finding } from '../src/core/types';
import { findings, shownQuote } from './fixtures';
import { connect, readJson } from './helpers';

type Session = Awaited<ReturnType<typeof connect>>;
let s: Session;
const release = readJson('release.json');
// The dates come from the data bundle, which reads the website's version plan: they live in one place.
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

beforeAll(async () => {
  s = await connect();
});
afterAll(async () => {
  await s.close();
});

describe('the server', () => {
  it('offers exactly the twelve tools, with honest annotations', async () => {
    const { tools } = await s.client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'check_against_graveyard', 'check_draft', 'get_blueprint_overview', 'get_conflicting_evidence', 'get_contributions', 'get_layer_atlas',
        'get_open_questions', 'get_study', 'get_submission_status', 'list_versions', 'search_studies', 'submit_proposal',
      ].sort(),
    );
    for (const t of tools) {
      expect(t.description?.length, t.name).toBeGreaterThan(60);
      if (t.name === 'submit_proposal') {
        expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true });
      } else expect(t.annotations, t.name).toMatchObject({ readOnlyHint: true });
    }
  });

  it('offers the three prompts and the resources', async () => {
    const prompts = await s.client.listPrompts();
    expect(prompts.prompts.map((p) => p.name).sort()).toEqual(['blind_review', 'draft_a_proposal', 'submit_my_proposal']);
    const review = await s.client.getPrompt({ name: 'blind_review', arguments: { claim: 'THE-TEST-CLAIM' } });
    const text = JSON.stringify(review.messages);
    expect(text).toContain('THE-TEST-CLAIM');
    expect(text).toContain('OPENISLET-REVIEW-v1');
    expect(text).not.toContain('[CLAIM]');
    const { resources } = await s.client.listResources();
    expect(resources.map((r) => r.uri).sort()).toEqual(['openislet://blueprint', 'openislet://graveyard', 'openislet://open-questions', 'openislet://review-template', 'openislet://versions']);
    const bp = await s.client.readResource({ uri: 'openislet://blueprint' });
    expect(JSON.stringify(bp.contents)).toContain('Islet-1');
    const study = await s.client.readResource({ uri: `openislet://study/${findings()[0].pmid}` });
    expect(JSON.stringify(study.contents)).toContain(findings()[0].pmid);
  });

  it('puts a summary, the version and a footer on every answer, and stays short enough', async () => {
    const calls: [string, Record<string, unknown>][] = [
      ['get_blueprint_overview', {}], ['list_versions', {}], ['search_studies', { query: 'CD47' }], ['get_conflicting_evidence', { gene: 'B2M' }],
      ['check_against_graveyard', { design: 'B' }], ['get_open_questions', {}], ['get_layer_atlas', { layer: 'dna' }], ['get_contributions', {}],
    ];
    for (const [name, args] of calls) {
      const r = await s.call(name, args);
      expect(r.isError, name).toBeFalsy();
      expect(r.structuredContent?.summary, name).toEqual(expect.any(String));
      expect(r.structuredContent?.version, name).toMatchObject({ id: 'islet-1-draft', frozen: false, doi: null, blueprint_release: release.version });
      expect(r.text, name).toContain('Answered from **Islet-1 open draft**');
      expect(r.text.length, name).toBeLessThan(100_000);
    }
  });
});

describe('get_blueprint_overview', () => {
  it('opens with the plain-English summary and the numbers the website prints', async () => {
    const r = await s.call('get_blueprint_overview');
    expect(r.text).toContain('Islet-1');
    expect(r.text).toContain(`${release.counts.studies} study records`);
    expect(r.text).toContain(release.counts.findings.toLocaleString('en-GB'));
    expect(r.text).toContain('cure the first person with type 1 diabetes by 2030');
    expect(r.text).toContain('requiring evidence and safety checks before each clinical step');
    expect(r.text).toContain('Nothing in it has been tested in the lab');
    expect(r.structuredContent?.counts).toEqual(release.counts);
  });

  it('gives all six sections, and the technical text on request', async () => {
    for (const section of ['summary', 'tests', 'designs', 'roadmap', 'versions', 'help']) expect((await s.call('get_blueprint_overview', { section })).isError, section).toBeFalsy();
    const plain = await s.call('get_blueprint_overview', { section: 'tests' });
    const full = await s.call('get_blueprint_overview', { section: 'tests', detail: 'full' });
    expect(full.text.length).toBeGreaterThan(plain.text.length);
    expect(full.text).toContain('From the concise specification');
    expect(full.text).toContain('Test 2 has two parts');
    const designs = await s.call('get_blueprint_overview', { section: 'designs', detail: 'full' });
    expect(designs.text).toMatch(/https:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/\d+\//);
    expect(designs.text).not.toContain('(#ref-');
    expect(plain.text).toContain('Insulin');
  });

  it('shows Stage 0 in full and Stages 1 to 5 as an outline for partners or open-source adopters', async () => {
    const r = await s.call('get_blueprint_overview', { section: 'roadmap' });
    expect(r.text).toContain('Stage 3 · Animal studies and safety: canine Islet-1');
    expect(r.text).toContain('Australian terrier');
    expect(r.text).toContain('partner organisations');
    expect(r.text).toContain('open blueprint');
    expect(r.text).toContain('Stage 1 lab protocol are published with the blueprint');
    // Only Stage 0 keeps the pass, stop and not-known lines.
    for (const label of ['A pass looks like:', 'We stop or change the plan if:', 'Not known yet:', 'Where it stands:']) {
      expect(r.text.split(label).length - 1, label).toBe(1);
    }
    expect(r.text.split('Why this stage:').length - 1).toBe(6);
    expect(r.text.split('Carried out by:').length - 1).toBe(5);
    // The detailed dog plan and the lab protocol numbers stay off the site.
    for (const gone of ['Give the dog the implant', '36 runs', '36-run', 'sentinel', '120 µm']) expect(r.text, gone).not.toContain(gone);
    const stages = (r.structuredContent as any).stages; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(stages).toHaveLength(6);
    expect(stages[0].points).toHaveLength(5);
    for (const later of stages.slice(1)) expect(later.points, later.name).toBeUndefined();
    const after = (r.structuredContent as any).after_the_blueprint; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(after.ways).toHaveLength(2);
    // No money anywhere in the roadmap (Kev, 28 October 2026: "remove anything to do with costs").
    expect(after.stage_zero_in_the_open).toBeUndefined();
    expect(after.path_to_first_participant).toBeUndefined();
    expect(r.text).not.toMatch(/\$\s?\d|self-fund|cost estimate/i);
    // The stage cards themselves stay free of costs and of the patch detail.
    expect(JSON.stringify((r.structuredContent as any).stages)).not.toMatch(/\$\s?\d|forearm/i); // eslint-disable-line @typescript-eslint/no-explicit-any
    const full = await s.call('get_blueprint_overview', { section: 'roadmap', detail: 'full' });
    expect(full.text).toContain('For scientists');
  });

  it('shows scores only with their caveat, and never as a league table', async () => {
    const r = await s.call('get_blueprint_overview', { section: 'designs' });
    expect(r.text).toContain('Prior-Anchored Scenario Outputs');
    expect(r.text).toContain('not predictions');
    expect(r.text).not.toMatch(/#1|#2|ranked (first|second)|rank 1|number one/i);
    const off = await (await connect({ scenarioScores: false })).call('get_blueprint_overview', { section: 'designs' });
    expect(off.text).not.toContain('Model score (child profile)');
    expect(off.text).not.toContain('Prior-Anchored');
    expect(off.structuredContent).not.toHaveProperty('scores');
  });

  it('says honestly that sending an IIP is not open yet', async () => {
    const r = await s.call('get_blueprint_overview', { section: 'help' });
    expect(r.text).toContain('Sending an Islet Improvement Proposal (IIP) opens when the public queue opens');
    expect(r.text).toContain('hello@openislet.org');
    expect(r.structuredContent?.contact).toEqual({ email: 'hello@openislet.org', x: '@OpenIslet' });
    const open = await (await connect({ submissionsOpen: true })).call('get_blueprint_overview', { section: 'help' });
    expect(open.text).toContain('Sending an Islet Improvement Proposal (IIP) is open');
  });
});

describe('versions', () => {
  it('lists the draft, the planned locks and no locked version yet', async () => {
    const r = await s.call('list_versions');
    expect(r.text).toContain(longDate(readJson('versions/versions.json').planned[0].lock_date));
    expect(r.text).toContain('Islet-1.0');
    expect(r.text).toContain('Islet-1.3');
    expect(r.structuredContent?.locked).toEqual([]);
    expect(r.structuredContent?.planned).toHaveLength(4);
  });

  it('resolves the version argument', async () => {
    const latest = await s.call('get_open_questions', { version: 'latest' });
    expect(latest.isError).toBeFalsy();
    expect(latest.text).toContain('No version is locked yet');
    const planned = await s.call('get_open_questions', { version: 'islet-1.0' });
    expect(planned.isError).toBe(true);
    expect(planned.text).toContain('not locked yet');
    const bogus = await s.call('get_open_questions', { version: 'islet-9' });
    expect(bogus.isError).toBe(true);
    expect(bogus.text).toContain('Known versions');
    expect((await s.call('get_open_questions', { version: 'draft' })).isError).toBeFalsy();
  });
});

describe('search_studies and get_study', () => {
  it('finds studies by gene, and every match really names the gene', async () => {
    const r = await s.call('search_studies', { gene: 'CD47', limit: 25 });
    expect(r.structuredContent?.total).toBeGreaterThan(5);
    for (const hit of r.structuredContent!.results) {
      expect(hit.matching_findings.length).toBeGreaterThan(0);
      for (const m of hit.matching_findings) expect(m.genes).toContain('CD47');
    }
  });

  it('understands gene aliases and warns about genes it does not track', async () => {
    const alias = await s.call('search_studies', { gene: 'PD-L1' });
    expect(alias.text).toContain('CD274');
    const odd = await s.call('search_studies', { gene: 'NOTAGENE' });
    expect(odd.structuredContent?.warnings.join(' ')).toContain('NOTAGENE');
  });

  it('filters by test, direction, year and human evidence, and pages through results', async () => {
    const t = await s.call('search_studies', { test: '5', direction: 'deleterious', limit: 25 });
    for (const hit of t.structuredContent!.results) for (const m of hit.matching_findings) expect(m.tests).toContain('5');
    const y = await s.call('search_studies', { year_from: 2024, limit: 25 });
    for (const hit of y.structuredContent!.results) expect(hit.year).toBeGreaterThanOrEqual(2024);
    const human = await s.call('search_studies', { human_only: true, limit: 25 });
    for (const hit of human.structuredContent!.results) expect(hit.evidence_level).not.toContain('Rodent');
    const p1 = await s.call('search_studies', { query: 'hypoxia', limit: 5 });
    const p2 = await s.call('search_studies', { query: 'hypoxia', limit: 5, offset: p1.structuredContent!.next_offset });
    const a = p1.structuredContent!.results.map((h: { pmid: string }) => h.pmid);
    const b = p2.structuredContent!.results.map((h: { pmid: string }) => h.pmid);
    expect(a).toHaveLength(5);
    expect(a.filter((x: string) => b.includes(x))).toEqual([]);
  });

  it('never lists the project summary or the superseded preprint as evidence', async () => {
    const seen = new Set<string>();
    for (const args of [{ gene: 'CD47', limit: 25 }, { query: 'hypoimmune islets without immunosuppression', limit: 25 }, { query: 'CD155', limit: 25 }]) {
      for (const hit of (await s.call('search_studies', args)).structuredContent!.results) seen.add(hit.pmid);
    }
    expect(seen.has('42430558')).toBe(false);
    expect(seen.has('40832357')).toBe(false);
  });

  it('shows at most the allowed quote text for a study, and links to PubMed', async () => {
    const f = shownQuote();
    const r = await s.call('get_study', { pmid: `PMID:${f.pmid}` });
    expect(r.isError).toBeFalsy();
    expect(r.text).toContain(`https://pubmed.ncbi.nlm.nih.gov/${f.pmid}/`);
    expect(r.text).toContain(f.quote!);
    const study = r.structuredContent!.study;
    expect(study.findings.length).toBe(findings().filter((x: Finding) => x.pmid === f.pmid).length);
    const shown = study.findings.filter((x: { quote: string | null }) => x.quote).reduce((n: number, x: { quote: string }) => n + x.quote.length, 0);
    expect(shown).toBeLessThanOrEqual(240);
    for (const x of study.findings) if (x.quote_withheld) expect(x.quote_sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('says what it does not have, and offers the nearest studies for a title', async () => {
    const missing = await s.call('get_study', { pmid: '99999999' });
    expect(missing.isError).toBe(true);
    expect(missing.text).toContain('99999999');
    const byTitle = await s.call('get_study', { pmid: 'CD47 mutant protects against phagocytosis without inducing cell death' });
    expect(byTitle.isError).toBe(true);
    expect(byTitle.text).toContain('38508139');
    const note = await s.call('get_study', { pmid: '42430558' });
    expect(note.text).toContain('not a published study');
  });
});

describe('get_conflicting_evidence', () => {
  it('puts the findings for and against a gene side by side', async () => {
    const r = await s.call('get_conflicting_evidence', { gene: 'CD47', per_side: 4 });
    const d = r.structuredContent!;
    expect(d.counts.improved).toBeGreaterThan(0);
    expect(d.counts.impaired).toBeGreaterThan(0);
    expect(d.disagree).toBe(true);
    expect(d.counts.improved + d.counts.impaired + d.counts.no_clear_effect).toBe(d.counts.total);
    expect(r.text).toContain('Improved the outcome');
    expect(r.text).toContain('Impaired the outcome');
    expect(r.text).toContain('The evidence points both ways');
    // Best evidence first.
    const levels = d.improved.map((x: { evidence_level: string }) => x.evidence_level);
    expect(levels[0]).toBe('Human, in the body');
    // The project summary does not count as evidence.
    expect(JSON.stringify(d)).not.toContain('42430558');
  });

  it('knows aliases, and suggests genes when asked about one it does not track', async () => {
    expect((await s.call('get_conflicting_evidence', { gene: 'PD-L1' })).structuredContent?.gene).toBe('CD274');
    const odd = await s.call('get_conflicting_evidence', { gene: 'CD4X' });
    expect(odd.isError).toBe(true);
    expect(odd.text).toContain('CD47');
  });
});

describe('check_against_graveyard', () => {
  it('gives Design A its two known risks and no dead end', async () => {
    const r = await s.call('check_against_graveyard', { design: 'A' });
    expect(r.structuredContent?.verdict).toBe('risky');
    expect(r.structuredContent?.triggered.map((t: { id: string; level: string }) => [t.id, t.level])).toEqual([['GY-009', 'WARN'], ['GY-010', 'WARN']]);
    expect(r.structuredContent?.gene_edit_cuts).toBe(release.designs.find((d: { id: string }) => d.id === 'A').edits);
  });

  it('gives Design B its known risk', async () => {
    const r = await s.call('check_against_graveyard', { design: 'B' });
    const ids = r.structuredContent?.triggered.map((t: { id: string }) => t.id);
    expect(ids).toContain('GY-005');
    expect(r.structuredContent?.triggered.every((t: { level: string }) => t.level === 'WARN')).toBe(true);
    expect(r.structuredContent?.base_edits).toBe(release.designs.find((d: { id: string }) => d.id === 'B').baseEdits);
  });

  it('calls a dead end a dead end, and counts base edits', async () => {
    const dead = await s.call('check_against_graveyard', { design: 'A', modules: ['CYTO_STAT1_OR_TYK2_CLONAL_KO_WITH_GAS_IND_PDL1'] });
    expect(dead.structuredContent?.verdict).toBe('dead_end');
    expect(dead.text).toContain('GY-001');
    expect(dead.text).toContain('gives it zero');
    const many = await s.call('check_against_graveyard', { design: 'A', base_edits: 3 });
    expect(many.structuredContent?.triggered.map((t: { id: string }) => t.id)).toContain('GY-006');
    expect(many.text).toContain('B=3');
  });

  it('says which rules it could not check when parts of the design are missing', async () => {
    const r = await s.call('check_against_graveyard', { modules: ['SAF_AAVS1_CAG_ICASP9_BIALLELIC'] });
    expect(r.structuredContent?.triggered).toEqual([]);
    expect(r.structuredContent?.verdict).toBe('nothing_found_incomplete');
    expect(r.structuredContent?.not_checked.length).toBeGreaterThan(5);
    expect(r.text).toContain('does not show the design works');
  });

  it('suggests rules for an idea in words, and labels them as suggestions', async () => {
    const r = await s.call('check_against_graveyard', { idea: 'knock out STAT1 and drive PD-L1 from an interferon inducible promoter' });
    expect(r.structuredContent?.mode).toBe('suggest');
    expect(r.structuredContent?.suggestions.map((x: { id: string }) => x.id)).toContain('GY-001');
    expect(r.text).toContain('suggestions, not a check');
  });

  it('lists the modules, and rejects a module it does not know', async () => {
    const list = await s.call('check_against_graveyard', { mode: 'list' });
    expect(list.structuredContent?.axes).toHaveLength(6);
    expect(list.structuredContent?.axes.reduce((n: number, a: { modules: unknown[] }) => n + a.modules.length, 0)).toBe(Object.keys(readJson('graveyard', 'modules.json').modules).length);
    const bad = await s.call('check_against_graveyard', { modules: ['SAF_ICASP9'] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain('SAF_AAVS1_CAG_ICASP9_BIALLELIC');
    const twice = await s.call('check_against_graveyard', { modules: ['SAF_NONE', 'SAF_G6PC2_ENDOGENOUS_ICASP9'] });
    expect(twice.isError).toBe(true);
  });
});

describe('open questions, layers and contributions', () => {
  it('lists the open questions, and filters them', async () => {
    const all = await s.call('get_open_questions');
    expect(all.structuredContent?.questions.length).toBe(15); // Includes the two explicit, pending Design-X qualification questions.
    const t3 = await s.call('get_open_questions', { test: '3' });
    expect(t3.structuredContent?.questions.length).toBeGreaterThan(2);
    for (const q of t3.structuredContent!.questions) expect(q.tests).toContain('3');
    const b = await s.call('get_open_questions', { design: 'B' });
    for (const q of b.structuredContent!.questions) expect(q.designs).toContain('B');
    expect((await s.call('get_open_questions', { query: 'safety switch' })).structuredContent?.questions[0].id).toBe('OQ-012');
    expect(all.text).toContain('How it could be settled');
  });

  it('gives an outline of each layer and the detail of an item', async () => {
    for (const layer of ['dna', 'proteins', 'tissue', 'patient']) {
      const r = await s.call('get_layer_atlas', { layer });
      if (layer === 'dna') {
        expect(release.counts.dnaChanges).toBeNull();
        expect(r.text).not.toContain('3,118 possible DNA changes');
        expect(r.text).toContain('non-commercial');
      }
      expect(r.isError, layer).toBeFalsy();
      expect(r.structuredContent?.items.length, layer).toBeGreaterThan(3);
      expect(r.text, layer).toContain('None has been tested in the lab');
    }
    const item = await s.call('get_layer_atlas', { layer: 'tissue', item: 'summary' });
    expect(item.text).toContain('lead_pouch_min_po2_14d_mmhg');
    const missing = await s.call('get_layer_atlas', { layer: 'tissue', item: 'no.such.thing' });
    expect(missing.isError).toBe(true);
    const large = await s.call('get_layer_atlas', { layer: 'dna', item: 'alphagenome_avi_saturation_mutagenesis_and_variants' });
    expect(large.text.length).toBeLessThan(40_000);
  });

  it('shows the simulated survival figures, always under the scope note', async () => {
    const part = 'part_b_personalized_patient_compiler_and_10k_population_trial';
    const outline = await s.call('get_layer_atlas', { layer: 'patient' });
    expect(outline.text).toContain('Read this first');
    expect(outline.text.indexOf('Read this first')).toBeLessThan(outline.text.indexOf('What is in this layer'));
    expect(outline.text).toContain('NOT clinical trial data');
    expect(outline.text).toContain('not the chance of success for any person');
    // Whatever part of the layer is asked for, the scope note comes before any survival figure.
    for (const item of [undefined, 'summary', part, `${part}.global_5yr_survival_personalized_dna_compiled_openislet_pct`]) {
      const r = await s.call('get_layer_atlas', item ? { layer: 'patient', item } : { layer: 'patient' });
      expect(r.isError, String(item)).toBeFalsy();
      // The figures themselves sit in the JSON block, which always comes after the scope note.
      const block = r.text.indexOf('```json');
      if (block >= 0) expect(r.text.indexOf('Read this first'), String(item)).toBeLessThan(block);
      expect(r.text.split('\n')[0], String(item)).toMatch(/not predictions for any person/);
    }
    const shown = await s.call('get_layer_atlas', { layer: 'patient', item: part });
    expect(shown.text).toContain('global_5yr_survival_standardized_openislet_plan_a_pct');
    expect(shown.text).not.toContain('held back');
    expect((await s.call('get_layer_atlas', { layer: 'patient', item: `${part}.total_virtual_patients_simulated` })).text).toContain('10000');
  });

  it('can hold the survival figures back with a switch', async () => {
    const part = 'part_b_personalized_patient_compiler_and_10k_population_trial';
    const held = await connect({ simulatedSurvival: false });
    const r = await held.call('get_layer_atlas', { layer: 'patient', item: part });
    expect(r.text).not.toContain('5yr_survival');
    expect(r.text).toContain('held back by the switch');
    expect(r.text).toContain('Read this first');
    // The design scores have their own switch and are not affected.
    expect((await held.call('get_blueprint_overview', { section: 'designs' })).text).toContain('Model score (child profile)');
    await held.close();
  });

  it('lists contributions without links while the queue is closed', async () => {
    const r = await s.call('get_contributions');
    // The founding record, and any real IIPs recorded since (the first outside one on 2 November 2026).
    expect(r.structuredContent?.total).toBeGreaterThanOrEqual(1);
    expect(r.structuredContent?.records.find((x: { id: string }) => x.id === 'IIP-0001')).toMatchObject({ id: 'IIP-0001', contributor: 'agent-kev', founding: true, public_issue: null });
    for (const rec of r.structuredContent?.records ?? []) expect(rec.public_issue, rec.id).toBeNull();
    expect(r.text).toContain('Links to the public issues appear when the public queue opens');
    const open = await (await connect({ submissionsOpen: true })).call('get_contributions');
    expect(open.structuredContent?.records.find((x: { id: string }) => x.id === 'IIP-0001').public_issue).toContain('/issues/1');
    expect((await s.call('get_contributions', { contributor: '@agent-kev' })).structuredContent?.total).toBe(1);
    expect((await s.call('get_contributions', { contributor: 'nobody' })).structuredContent?.total).toBe(0);
  });

  it('reports where a submission is', async () => {
    const found = await s.call('get_submission_status', { id: 'IIP-0001' });
    expect(found.structuredContent?.found).toBe(true);
    expect(found.text).toContain('Founding blueprint');
    const none = await s.call('get_submission_status', { id: '42' });
    expect(none.structuredContent?.found).toBe(false);
    // While the founding record is the whole record the queue "has not opened yet"; once a real IIP is in the record it is "not in the record yet"
    // (both wordings are tested in reading-review.test.ts with a record made for the purpose).
    const total = (await s.call('get_contributions')).structuredContent?.total as number;
    expect(none.text).toContain(total <= 1 ? 'has not opened yet' : "is not in OpenIslet's record yet");
  });
});

describe('long and odd input', () => {
  const words = 'cd47 hypoxia insulin secretion granzyme serpinb9 islet macrophage phagocytosis tolerance allograft immunosuppression'.split(' ');
  const long = (n: number) => Array.from({ length: n }, (_, i) => words[i % words.length] + (i % 7 === 0 ? 'x' : '')).join(' ');

  it('answers a very long search query quickly', async () => {
    const started = performance.now();
    const r = await s.call('search_studies', { query: long(40).slice(0, 300), limit: 25 });
    expect(r.isError).toBeFalsy();
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('answers a very long idea quickly', async () => {
    const started = performance.now();
    const r = await s.call('check_against_graveyard', { idea: long(300).slice(0, 2000) });
    expect(r.isError).toBeFalsy();
    expect(performance.now() - started).toBeLessThan(2000);
  });

  it('rejects arguments outside the limits with a readable message', async () => {
    const r = await s.call('search_studies', { limit: 500 });
    expect(r.isError).toBe(true);
    expect(r.text).toContain('limit');
    expect((await s.call('get_study', { pmid: 'x'.repeat(500) })).isError).toBe(true);
    expect((await s.call('check_against_graveyard', { modules: Array(20).fill('SAF_NONE') })).isError).toBe(true);
  });

  it('treats text from papers as data: nothing in an answer asks the assistant to do anything', async () => {
    const r = await s.call('get_study', { pmid: shownQuote().pmid });
    expect(r.text).not.toMatch(/ignore (all |any )?(previous|prior) instructions/i);
  });
});
