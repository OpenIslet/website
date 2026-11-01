// The changelog starts at release (Kev, 26 October 2026): nothing done before the open draft opens is reported, so until then
// the connector says so plainly instead of listing old releases.
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

describe('the changelog before release', () => {
  it('is empty in the data bundle', () => {
    expect(readJson('versions/versions.json').history).toEqual([]);
  });

  it('is described as "nothing has changed yet", with the date it starts', async () => {
    const r = await s.call('list_versions');
    expect(r.text).toContain('Nothing has changed yet');
    expect(r.text).toContain(longDate(readJson('versions/versions.json').draft.opens));
    expect(r.structuredContent?.history).toEqual([]);
    expect(r.text).not.toMatch(/\| Release \| Date \| What changed \|/);
  });
});
