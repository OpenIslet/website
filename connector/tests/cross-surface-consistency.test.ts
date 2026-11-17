// Checks that new wet-lab metadata keys, newly triaged genes and four-hurdle computational odds propagate into the MCP bundle and tools.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { bundleDir, connect, readJson } from './helpers';
import contract from '../src/core/wetlab-endpoint-contract.json';
import oddsFile from '../../src/data/success-probability.json';
import changelogFile from '../../src/data/changelog.json';
import refsBase from '../../src/data/references.json';

type Session = Awaited<ReturnType<typeof connect>>;
let s: Session;

beforeAll(async () => {
  s = await connect();
});
afterAll(async () => {
  await s.close();
});

describe('cross-surface propagation in the connector', () => {
  it('exposes the four-hurdle computational odds in get_blueprint_overview and agrees with success-probability.json', async () => {
    const res = await s.call('get_blueprint_overview');
    const odds = (res.structuredContent as any).odds; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(odds).toBeTruthy();
    expect(odds.last_updated).toBe(oddsFile.lastUpdated);
    expect(odds.hurdles).toHaveLength(oddsFile.gates.length);
    expect(res.text).toContain(`about ${odds.three_designs_pct}%`);

    const x = await s.call('get_blueprint_overview', { design: 'X' });
    expect(x.text).not.toMatch(/HLA-E (?:itself )?stays unchanged/i);
    expect(x.text).toContain('Multi-miR(IL1R1 + FAS)');

    const designsOverview = await s.call('get_blueprint_overview', { section: 'designs' });
    expect(designsOverview.text).toContain('0.0526');
    expect(designsOverview.text).toContain('K = 4');

    const gySuggest = await s.call('check_against_graveyard', {
      idea: 'use bovine catalase in the oxygen layer and unhydrolysed maleimide FasL linkers',
    });
    expect((gySuggest.structuredContent as any).suggestions.map((r: { id: string }) => r.id)).toContain('GY-013'); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('indexes core edit, receptor and triaged T1D trap genes so get_conflicting_evidence never rejects them as unknown', async () => {
    const tg = readJson('graph/target-genes.json');
    const vocab = new Set<string>(tg.vocabulary ?? []);
    for (const g of ['B2M', 'CIITA', 'CD47', 'HLA-E', 'HLA-C', 'TYK2', 'CXCL10', 'SERPINB9', 'CD274', 'CASP9', 'INS', 'FAS', 'IL1R1', 'CD55', 'CLEC16A', 'DEXI', 'PTPN2', 'TNFAIP3', 'BACH2', 'CTSH']) {
      expect(vocab.has(g), `expected ${g} in graph/target-genes.json vocabulary`).toBe(true);
    }
    for (const gene of ['FAS', 'IL1R1', 'CD55', 'CLEC16A']) {
      const r = await s.call('get_conflicting_evidence', { gene });
      expect(r.isError, `expected get_conflicting_evidence(${gene}) not to error`).toBeFalsy();
    }
  });

  it('accepts every metadata_key from wetlab-endpoint-contract.json on check_draft input validation', async () => {
    expect(contract.metadata_keys.length).toBeGreaterThanOrEqual(30);
    const firstEndpoint = contract.endpoints[0];
    const readouts: Record<string, string | number> = {
      [firstEndpoint.meanKey]: firstEndpoint.min,
      [firstEndpoint.seKey]: Math.max(firstEndpoint.default_se ?? 0, contract.minimum_se),
    };
    for (const key of contract.metadata_keys) {
      readouts[key] = 'test-stratum';
    }
    const r = await s.call('check_draft', {
      draft: '# Draft\n',
      review: '# Review\n',
      wetlab_empirical_readouts: readouts,
    });
    // The mock draft is intentionally incomplete so draft checks report missing sections,
    // but Zod schema validation must NOT reject any contract metadata_key before checkDraft runs.
    expect(r.text).not.toMatch(/Unrecognized key|Invalid input/i);
  });

  it('keeps open-questions and graveyard bundle records aligned with every merged IIP and rule ID', () => {
    const oqs = readJson('questions/open-questions.json') as Array<{ id: string; plain: string; detail: string; source: string; pmids: string[] }>;
    const gys = readJson('graveyard/entries.json') as Array<{ graveyard_id: string; why_it_fails: string }>;
    const publicRules = readJson('graveyard/rules.json') as Array<{ id: string; graveyard_id: string | null; grid_rule?: boolean }>;
    const scores = readJson('blueprint/scores.json') as { stepping_stones?: Array<{ id: string; rank: number; children: number }>; pareto_by_edits?: unknown[] };
    const ledger = readJson('contributions/ledger.json') as { records: Array<{ id: string }> };

    expect(gys).toHaveLength(10);
    expect(publicRules.length).toBeGreaterThanOrEqual(17);
    expect(publicRules.map((r) => r.id)).toEqual(expect.arrayContaining(['GY-011', 'GY-012', 'GY-013', 'GY-014', 'GY-015', 'GY-016', 'GY-017']));
    expect(scores.pareto_by_edits).toHaveLength(8);
    expect(scores.stepping_stones?.find((st) => st.id === 'MINIMAL_HIP_NICHE_PLUS_SWITCH')).toMatchObject({ rank: 45, children: 0.0526 });

    const knownIips = new Set<string>([
      'IIP-0001',
      ...changelogFile.flatMap((c) => (c.contribution ? [c.contribution] : [])),
      ...ledger.records.map((r) => r.id),
    ]);
    const knownGys = new Set(publicRules.map((r) => r.id));
    const bibliography = refsBase as Record<string, { title?: string }>;
    const specMd = fs.readFileSync(path.join(bundleDir, 'blueprint/spec.md'), 'utf8');
    for (const m of specMd.matchAll(/#ref-(\d{5,9})/g)) {
      expect(bibliography[m[1]]?.title, `blueprint/spec.md cites #ref-${m[1]} without bibliography metadata`).toBeTruthy();
    }

    for (const oq of oqs) {
      const combined = `${oq.plain} ${oq.detail} ${oq.source}`;
      expect(combined, `${oq.id} has stale prose`).not.toMatch(/HLA-E (?:itself )?stays unchanged|unchanged at (?:about )?31%/i);
      for (const m of oq.source.matchAll(/\bIIP-\d{4}\b/g)) {
        expect(knownIips.has(m[0]), `${oq.id}.source cites unknown ${m[0]}`).toBe(true);
      }
      for (const m of oq.source.matchAll(/\bGY-\d{3}\b/g)) {
        expect(knownGys.has(m[0]), `${oq.id}.source cites unknown ${m[0]}`).toBe(true);
      }
      for (const pmid of oq.pmids) {
        expect(pmid, `${oq.id} has invalid PMID ${pmid}`).toMatch(/^\d{7,9}$/);
      }
    }

    const gy007 = gys.find((g) => g.graveyard_id.startsWith('GRAVEYARD_007'));
    expect(gy007?.why_it_fails).toContain('IIP-0018');
  });
});
