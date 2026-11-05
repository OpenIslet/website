// An IIP sent since the last weekly update is not in OpenIslet's record yet. Asking about it must say so and point to its public page,
// not answer "not found" to someone who has just sent it.
import { describe, expect, it } from 'vitest';
import { submissionStatus } from '../src/core/contributions';
import { configFromEnv, defaultConfig } from '../src/core/answer';
import { bundle } from './helpers';

describe('asking about an IIP sent since the last weekly update', () => {
  it('says it is not in the record yet, and links its public page', async () => {
    const cfg = configFromEnv({ SUBMISSIONS_OPEN: 'true', QUEUE_REPO: 'openislet/openislet' });
    const a = await submissionStatus(bundle(), cfg, 'IIP-0042');
    expect(a.isError).toBeFalsy();
    expect(a.summary).toContain('IIP-0042 is not in OpenIslet');
    expect(a.summary).toContain('https://github.com/openislet/openislet/issues/42');
    expect(a.data).toMatchObject({ found: false, queue_open: true, id: 'IIP-0042' });
  });
  it('still answers without a link when the queue is not set up', async () => {
    const a = await submissionStatus(bundle(), { ...defaultConfig, submissionsOpen: true }, '42');
    expect(a.summary).toContain('IIP-0042 is not in OpenIslet');
    expect(a.data).toMatchObject({ issue_url: null });
  });
  it('says the queue is closed when it is, for a recent IIP after the queue has been open', async () => {
    const b = bundle();
    const real = await b.ledger();
    // At least two records, so the queue has been open; then ask about the number after the newest one.
    const records = real.records.length > 1 ? real.records : [...real.records, { ...real.records[0], id: 'IIP-0002', issue: { ...real.records[0].issue, number: 2 } }];
    const later = Object.create(b, { ledger: { value: async () => ({ ...real, records }) } });
    const next = `IIP-${String(Math.max(...records.map((r) => r.issue.number)) + 1).padStart(4, '0')}`;
    const a = await submissionStatus(later, { ...defaultConfig, submissionsOpen: false }, next);
    expect(a.data).toMatchObject({ found: false, queue_open: false, id: next });
  });
  it('ignores a QUEUE_REPO that is not owner/name', () => {
    expect(configFromEnv({ QUEUE_REPO: 'not a repo' }).queueIssues).toBeUndefined();
  });
});
