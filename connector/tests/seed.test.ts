import { describe, expect, it } from 'vitest';
// @ts-expect-error The executable seeding boundary is exercised directly.
import { seedVerifiedBundle } from '../scripts/seed-io.mjs';
const id = 'islet-1.0';
const metadata = (frozen: unknown, extra = {}) => Buffer.from(JSON.stringify({ schema: 'openislet-bundle/1', id, frozen, ...extra }));
const payloads = (frozen: boolean, payload = 'original') => new Map([['meta.json', metadata(frozen)], ['payload', Buffer.from(payload)]]);
function fixture(prior: Map<string, Buffer> = new Map()) {
  const files = new Map([...prior].map(([relative, body]) => [`${id}/${relative}`, Buffer.from(body)]));
  const writes: string[] = [];
  return { files, writes, bucket: {
    async get(key: string) { const value = files.get(key); return value ? { async arrayBuffer() { return Uint8Array.from(value).buffer; } } : null; },
    async put(key: string, body: Uint8Array) { writes.push(key); files.set(key, Buffer.from(body)); },
  } };
}
describe('Frozen local R2 seed invariants', () => {
  it('makes an identical frozen retry read-only', async () => {
    const f = fixture(payloads(true)); const r = await seedVerifiedBundle(f.bucket, id, payloads(true));
    expect(r.unchangedFrozen).toBe(true); expect(f.writes).toEqual([]);
  });
  it.each(['payload', 'metadata', 'downgrade', 'missing'])('refuses frozen %s changes before any put', async change => {
    const f = fixture(payloads(true)); const next = payloads(true);
    if (change === 'payload') next.set('payload', Buffer.from('changed'));
    if (change === 'metadata') next.set('meta.json', metadata(true, { doi: '10.1234/changed' }));
    if (change === 'downgrade') next.set('meta.json', metadata(false));
    if (change === 'missing') f.files.delete(`${id}/payload`);
    const before = new Map(f.files);
    await expect(seedVerifiedBundle(f.bucket, id, next)).rejects.toThrow(/locked/);
    expect(f.writes).toEqual([]); expect(f.files).toEqual(before);
  });
  it.each(['wrong-id', 'frozen-string', 'invalid-json'])('refuses ambiguous stored authority %s', async change => {
    const prior = payloads(false);
    prior.set('meta.json', change === 'wrong-id' ? metadata(false, { id: 'other' }) : change === 'frozen-string' ? metadata('false') : Buffer.from('{'));
    const f = fixture(prior);
    await expect(seedVerifiedBundle(f.bucket, id, payloads(false))).rejects.toThrow(/Invalid existing/);
    expect(f.writes).toEqual([]);
  });
  it('allows draft refresh and publishes metadata last with a reordered input map', async () => {
    const f = fixture(payloads(false)); const next = payloads(false, 'new');
    expect([...next.keys()][0]).toBe('meta.json');
    const r = await seedVerifiedBundle(f.bucket, id, next);
    expect(r.files).toBe(2); expect(f.files.get(`${id}/payload`)?.toString()).toBe('new');
    expect(f.writes).toEqual([`${id}/payload`, `${id}/meta.json`]);
  });
  it('never marks a partially failed draft upload with new metadata', async () => {
    const f = fixture(payloads(false)); const before = f.files.get(`${id}/meta.json`);
    const bucket = { ...f.bucket, put: async () => { throw new Error('injected put failure'); } };
    await expect(seedVerifiedBundle(bucket, id, payloads(false, 'new'))).rejects.toThrow(/injected/);
    expect(f.files.get(`${id}/meta.json`)).toEqual(before);
  });
  it('stops further R2 puts when the local publisher loses ownership', async () => {
    const f = fixture(payloads(false)); let owned = true;
    const before = f.files.get(`${id}/meta.json`);
    const bucket = { ...f.bucket, async put(key: string, body: Uint8Array) { await f.bucket.put(key, body); owned = false; } };
    await expect(seedVerifiedBundle(bucket, id, payloads(false, 'new'), { assertOwned: () => { if (!owned) throw new Error('ownership revoked'); } })).rejects.toThrow(/ownership revoked/);
    expect(f.writes).toEqual([`${id}/payload`]);
    expect(f.files.get(`${id}/meta.json`)).toEqual(before);
  });
});
