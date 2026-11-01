// The TypeScript Idea Graveyard checker must give the same answer as the science repo's Python engine for every design.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AXES, type Selection, evaluateRules, NAMED_DESIGNS } from '../src/core/graveyard';
import type { GraveyardEntry, ModulesFile } from '../src/core/types';
import { bundleDir, connectorRoot, readJson } from './helpers';

const golden = JSON.parse(fs.readFileSync(path.join(connectorRoot, 'tests', 'golden', 'graveyard-grid.json'), 'utf8')) as {
  axes: Record<string, string[]>;
  modules: ModulesFile['modules'];
  combos: { ids: string[]; total_b: number; total_k: number; triggered: unknown[] }[];
};
const entries = readJson<GraveyardEntry[]>('graveyard', 'entries.json');
const modules = readJson<ModulesFile>('graveyard', 'modules.json');
const release = readJson('release.json');
// The grid is every pick on every axis, so a new module on any axis changes it: nobody types the number in here.
const designCount = Object.values(golden.axes).reduce((n, ids) => n * ids.length, 1);

describe('Idea Graveyard checker versus the Python engine', () => {
  it('has the same modules as the Python', () => {
    expect(modules.modules).toEqual(golden.modules);
    expect(Object.fromEntries(Object.entries(modules.axes).map(([a, v]) => [a, v.modules]))).toEqual(golden.axes);
  });

  it('gives identical rules, severities and reasons for every design', () => {
    expect(golden.combos).toHaveLength(designCount);
    expect(designCount).toBe(release.counts.designs);
    let blocked = 0;
    for (const combo of golden.combos) {
      const sel = Object.fromEntries(AXES.map((axis, i) => [axis, combo.ids[i]])) as Selection;
      const totalB = combo.ids.reduce((n, id) => n + golden.modules[id].base_edits, 0);
      const totalK = combo.ids.reduce((n, id) => n + golden.modules[id].cuts, 0);
      expect(totalB).toBe(combo.total_b);
      expect(totalK).toBe(combo.total_k);
      const mine = evaluateRules(sel, totalB, entries, modules.modules);
      expect(mine).toEqual(combo.triggered);
      if (mine.some((t) => t.severity_level === 'BLOCK')) blocked++;
    }
    // The numbers the website prints.
    expect(blocked).toBe(release.counts.blocked);
    expect(designCount - blocked).toBe(release.counts.feasible);
  });

  it('describes Design A and Design B with the edit counts in the release', () => {
    const count = (sel: Selection, key: 'cuts' | 'base_edits') => Object.values(sel).reduce((n, id) => n + modules.modules[id][key], 0);
    for (const id of ['A', 'B'] as const) {
      const published = release.designs.find((d: { id: string }) => d.id === id);
      expect(count(NAMED_DESIGNS[id], 'cuts')).toBe(published.edits);
      expect(count(NAMED_DESIGNS[id], 'base_edits')).toBe(published.baseEdits);
    }
  });

  it('reads severity and trigger modules from the Graveyard data, as the Python does', () => {
    // Make rule 8 only trigger on a different module, and lower rule 1 to a warning: the answer must follow the data.
    const changed = JSON.parse(JSON.stringify(entries)) as GraveyardEntry[];
    const r8 = changed.find((e) => e.graveyard_id.startsWith('GRAVEYARD_008_'))!;
    r8.trigger_pattern = { requires_any_module: ['CYTO_NONE'] };
    const r1 = changed.find((e) => e.graveyard_id.startsWith('GRAVEYARD_001_'))!;
    r1.severity_level = 'WARN';
    const sel: Selection = { ...NAMED_DESIGNS.A, cytokine: 'CYTO_CONSTITUTIVE_IL10_VIRAL_OE' };
    expect(evaluateRules(sel, 0, changed, modules.modules).map((t) => t.graveyard_id.slice(0, 14))).not.toContain('GRAVEYARD_008');
    expect(evaluateRules({ ...NAMED_DESIGNS.A, cytokine: 'CYTO_STAT1_OR_TYK2_CLONAL_KO_WITH_GAS_IND_PDL1' }, 0, changed, modules.modules).find((t) => t.graveyard_id.startsWith('GRAVEYARD_001_'))?.severity_level).toBe('WARN');
    expect(bundleDir).toBeTruthy();
  });
});
