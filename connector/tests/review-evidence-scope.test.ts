import { describe, expect, it } from 'vitest';
import type { Bundle } from '../src/core/bundle';
import { searchStudies } from '../src/core/search';
import { getStudy } from '../src/core/studies';
import type { StudyIndexRecord } from '../src/core/types';

const record = (pmid: string, kind: StudyIndexRecord['kind']): StudyIndexRecord => ({
  pmid, kind, title: 'Contextual islet evidence', first_author: 'Author', senior_author: 'Author',
  year: 2022, journal: 'Journal', doi: null, pmcid: null, source_text: kind,
  source_text_type: kind === 'review_or_commentary' ? 'Review_or_Commentary' : 'Abstract_Only',
  tier: 'Tier_3_Human_Cells_AbioticStress_or_ImmunodeficientMouse', tier_plain: 'Human cells',
  areas: [], arms: 0, findings: 0, tests: [], genes: [],
  directions: { protective: 0, deleterious: 0, neutral: 0 }, url: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
});
const records = [record('1', 'study'), record('35482056', 'review_or_commentary'), record('3', 'project_summary'), record('4', 'superseded_preprint')];
const index = new Map(records.map(r => [r.pmid, r]));
const b = {
  studyIndex: async () => records, studyByPmid: async () => index,
  findingsByPmid: async () => new Map(), findingsById: async () => new Map(),
  targetGenes: async () => ({ vocabulary: [], aliases: {} }),
  search: async () => ({ search: () => [{ id: 'S:35482056', score: 1 }] }),
  meta: async () => ({ quote_policy: { per_paper_verbatim_ceiling_characters: 240 } }),
  study: async () => ({ arms: [], causal_mechanism_edges: [] }),
} as unknown as Bundle;

describe('review records do not become primary empirical evidence', () => {
  it('excludes reviews from default empirical searches', async () => {
    expect((await searchStudies(b, {})).items.map(r => r.pmid)).toEqual(['1']);
    expect((await searchStudies(b, { query: 'islet' })).items).toEqual([]);
  });
  it('keeps review discovery available through explicit reviews or all scopes', async () => {
    expect((await searchStudies(b, { source_scope: 'reviews' })).items.map(r => r.pmid)).toEqual(['35482056']);
    expect((await searchStudies(b, { source_scope: 'reviews', query: 'islet' })).items.map(r => r.pmid)).toEqual(['35482056']);
    expect((await searchStudies(b, { source_scope: 'all' })).total).toBe(4);
  });
  it('retrieves a review by PMID with a clear evidence exclusion note', async () => {
    const r = await getStudy(b, '35482056');
    expect(r.found).toBe(true);
    if (r.found) {
      expect(r.kind).toBe('review_or_commentary');
      expect(r.notes.join(' ')).toContain('no primary empirical evidence weight');
      expect(r.findings).toHaveLength(0);
    }
  });
});
