// The changelog starts at release (Kev, 26 October 2026): nothing done before the open draft opens is reported. While it is empty
// the connector says so plainly instead of listing old releases; from the first entry (2 November 2026) it lists them.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { connect, readJson } from './helpers';

type Session = Awaited<ReturnType<typeof connect>>;
// The dates come from the data bundle, which reads the website's version plan: they live in one place.
const longDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
let s: Session;
beforeAll(async () => {
  s = await connect();
});
afterAll(async () => {
  await s.close();
});

describe('the changelog', () => {
  const history = () => readJson('versions/versions.json').history as { date: string }[];

  it('starts at release: nothing is dated before the open draft opens', () => {
    const opens = readJson('versions/versions.json').draft.opens as string;
    for (const entry of history()) expect(entry.date >= opens, `${entry.date} is before ${opens}`).toBe(true);
  });

  it('says "nothing has changed yet" while it is empty, and lists what changed once it is not', async () => {
    const r = await s.call('list_versions');
    // The tool shows each entry's version and date (and what changed); the same entries, in the same order, as the bundle.
    const shown = (r.structuredContent?.history ?? []) as { version: string; date: string }[];
    expect(shown.map((e) => `${e.version} ${e.date}`)).toEqual((history() as { version: string; date: string }[]).map((e) => `${e.version} ${e.date}`));
    if (history().length === 0) {
      expect(r.text).toContain('Nothing has changed yet');
      expect(r.text).toContain(longDate(readJson('versions/versions.json').draft.opens));
      expect(r.text).not.toMatch(/\| Release \| Date \| What changed \|/);
    } else {
      expect(r.text).not.toContain('Nothing has changed yet');
      expect(r.text).toMatch(/\| Release \| Date \| What changed \|/);
    }
  });
});
