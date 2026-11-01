// Credit in words: no scores and no ranking. Each IIP's outcome is what a person decided it did, and later events are follow-ups.
import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/answer';
import type { Bundle } from '../src/core/bundle';
import { getContributions, submissionStatus } from '../src/core/contributions';
import type { LedgerFile, LedgerRecord } from '../src/core/types';
import { bundle } from './helpers';

const cfg = { ...defaultConfig, submissionsOpen: true };
const record = (n: number, handle: string, submitted: string, over: Partial<LedgerRecord>): LedgerRecord => ({
  id: `IIP-${String(n).padStart(4, '0')}`,
  issue: { number: n, url: `https://github.com/openislet/openislet/issues/${n}` },
  title: `Title ${n}`,
  type: 'Problem found',
  status: 'queued',
  submitted_at: submitted,
  decided_at: null,
  target_version: 'islet-1-draft',
  landed_in: null,
  contributor: { handle, kind: 'person', github: handle, orcid: null, verified: { github: true, orcid: false } },
  outcome: null,
  ...over,
});

async function withRecords(records: LedgerRecord[]): Promise<Bundle> {
  const real = await bundle().ledger();
  const ledger: LedgerFile = { outcomes: real.outcomes, records: [real.records[0], ...records] };
  return { ledger: async () => ledger } as unknown as Bundle;
}

const decided = [
  record(2, 'many-small', '2026-11-02', { status: 'merged', outcome: { kind: 'changed_blueprint', note: 'Fixed a citation.' } }),
  record(3, 'many-small', '2026-11-03', { status: 'merged', outcome: { kind: 'changed_blueprint', note: 'Fixed another citation.' } }),
  record(4, 'many-small', '2026-11-04', { status: 'merged', outcome: { kind: 'evidence', note: 'Added one paper.' } }),
  record(5, 'one-big', '2026-11-09', {
    status: 'merged',
    outcome: { kind: 'dead_end', note: 'Showed that idea X fails in human islets.', where: '/idea-graveyard/#gy-020' },
    follow_ups: [{ date: '2026-12-01', note: 'Built on by IIP-0009.', ref: 'IIP-0009' }],
  }),
  record(6, 'newcomer', '2026-11-10', { status: 'declined', outcome: { kind: 'already_covered', note: 'The Idea Graveyard already had it.', same_as: 'IIP-0005' } }),
  record(7, 'waiting', '2026-11-11', {}),
];

describe('get_contributions', () => {
  it('says what each IIP changed, in words, with no score or weight anywhere', async () => {
    const a = await getContributions(await withRecords(decided), cfg, {});
    expect(a.body).toContain('Ruled out a dead end: Showed that idea X fails in human islets.');
    expect(a.body).toContain('Already covered: The Idea Graveyard already had it.');
    expect(a.body).toContain('Waiting for review');
    expect(a.body).toContain('Changed the blueprint × 2, Added evidence');
    expect(JSON.stringify(a.data)).not.toMatch(/impact|weights|learning|progress|rubric/i);
    expect(a.notes?.join(' ')).toMatch(/no scores or rankings/);
  });

  it('lists people by their newest work, never by how many IIPs they sent', async () => {
    const a = await getContributions(await withRecords(decided), cfg, {});
    const people = (a.data as { contributors: { handle: string }[] }).contributors.map((p) => p.handle);
    expect(people.slice(0, 4)).toEqual(['waiting', 'newcomer', 'one-big', 'many-small']);
  });

  it('filters by an outcome, by its words or its key', async () => {
    const b = await withRecords(decided);
    for (const status of ['Ruled out a dead end', 'dead_end', 'ruled out a dead end']) {
      expect((await getContributions(b, cfg, { status })).data).toMatchObject({ total: 1 });
    }
    expect((await getContributions(b, cfg, { status: 'Waiting for review' })).data).toMatchObject({ total: 1 });
  });

  it('still answers from a bundle made before outcomes had words', async () => {
    const old = await getContributions({ ledger: async () => ({ records: [decided[3]] }) } as unknown as Bundle, cfg, {});
    expect(old.body).toContain('dead end: Showed that idea X fails');
  });
});

describe('get_submission_status', () => {
  it('gives the outcome, the reason, where it landed and what happened since', async () => {
    const a = await submissionStatus(await withRecords(decided), cfg, 'IIP-0005');
    expect(a.summary).toBe('IIP-0005: Ruled out a dead end. Showed that idea X fails in human islets.');
    expect(a.body).toContain('**Where it stands:** Ruled out a dead end');
    expect(a.body).toContain('**What it changed:** Showed that idea X fails in human islets. (/idea-graveyard/#gy-020)');
    expect(a.body).toContain('**queued** → **reviewed** → **decided**');
    expect(a.body).toMatch(/Since then[\s\S]*Built on by IIP-0009/);
  });

  it('says plainly when it is still waiting, and why not when it was not used', async () => {
    const b = await withRecords(decided);
    expect((await submissionStatus(b, cfg, '7')).summary).toBe('IIP-0007: waiting for review.');
    expect((await submissionStatus(b, cfg, '6')).body).toContain('**Where it was already:** The Idea Graveyard already had it.');
  });
});
