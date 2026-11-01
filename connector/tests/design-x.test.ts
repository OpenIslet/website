// Design X is the third design: plain English first, the proposals kept apart from the scored challenger,
// and nothing claimed that the data does not show.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, readJson } from './helpers';

type Session = Awaited<ReturnType<typeof connect>>;
let s: Session;
const release = readJson('release.json');

beforeAll(async () => {
  s = await connect();
});
afterAll(async () => {
  await s.close();
});

describe('Design X in the connector', () => {
  it('is one of three designs in the summary and the designs section', async () => {
    const summary = await s.call('get_blueprint_overview');
    expect(summary.text).toContain('three designs');
    expect(summary.text).toContain('Design X');
    const designs = await s.call('get_blueprint_overview', { section: 'designs' });
    expect(designs.text).toContain('Design X: Design A plus one small insulin-gene edit');
    expect(designs.text).toContain('Still on paper');
    expect(Object.keys((designs.structuredContent as any).designs).sort()).toEqual(['A', 'B', 'X']); // eslint-disable-line @typescript-eslint/no-explicit-any
  });

  it('gives Design X in plain English, and keeps the scored challenger apart from the proposals', async () => {
    const r = await s.call('get_blueprint_overview', { design: 'X' });
    expect(r.text).toContain('Design A plus one small insulin-gene edit');
    expect(r.text).toContain('Two things are meant by Design X');
    expect(r.text).toContain('A challenger replaces the lead design only if lab results show it is better');
    expect(r.text).not.toContain('```json'); // the machine-readable detail is in structuredContent, or on request
    expect(r.structuredContent).toMatchObject({ design: 'X', promotion_authorized: false, evaluation_scope: 'COMBINATORIAL_GRID_ONLY' });
    expect((r.structuredContent as any).still_on_paper).toHaveLength(3); // eslint-disable-line @typescript-eslint/no-explicit-any
    const full = await s.call('get_blueprint_overview', { design: 'X', detail: 'full' });
    expect(full.text).toContain('```json');
  });

  it('scores X from the release data, never as a league table', async () => {
    const x = release.designs.find((d: { id: string }) => d.id === 'X');
    expect(x).toBeTruthy();
    const r = await s.call('get_blueprint_overview', { section: 'designs' });
    const scores = (r.structuredContent as any).scores; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(scores.find((d: { id: string }) => d.id === 'X')).toMatchObject({ gene_edits: 4, base_edits: 1 });
    expect(r.text).not.toMatch(/#1|#2|ranked (first|second)|rank 1|number one/i);
  });

  it('is in the starter prompts and the draft template', async () => {
    const draft = await s.client.getPrompt({ name: 'draft_a_proposal' });
    expect(JSON.stringify(draft.messages)).toContain('Design X');
  });
});
