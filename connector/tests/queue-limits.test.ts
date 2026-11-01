// The exact posting limits on their own (src/core/queue/limits.ts), over the in-memory stand-in for the Durable Object's storage.
import { describe, expect, it } from 'vitest';
import { PENDING_MS, REMEMBER_MS, finish, reserve } from '../src/core/queue/limits';
import type { CompleteOutput } from '../src/core/queue/types';
import { MemoryStorage } from './queue-fakes';

const NOW = Date.UTC(2026, 10, 3, 10, 30);
const out = (n: number): CompleteOutput => ({ submitted: true, issue: { number: n, url: `https://github.test/issues/${n}` }, record_id: `IIP-${String(n).padStart(4, '0')}`, contributor: { github: 'octo-cat' } });
const ask = (storage: MemoryStorage, fingerprint: string, o: { account?: number; now?: number; daily?: number; hourly?: number } = {}) =>
  reserve(storage, { account: o.account ?? 1, fingerprint, now: o.now ?? NOW, dailyLimit: o.daily ?? 2, hourlyLimit: o.hourly ?? 3 });

describe('the posting limits', () => {
  it('counts each account per UTC day and everyone per hour, and waits until the right moment', async () => {
    const s = new MemoryStorage();
    expect((await ask(s, 'a')).ok).toBe(true);
    expect((await ask(s, 'b')).ok).toBe(true);
    expect(await ask(s, 'c')).toEqual({ ok: false, reason: 'account', retry_after_seconds: (Date.UTC(2026, 10, 4) - NOW) / 1000 });
    expect((await ask(s, 'd', { account: 2 })).ok).toBe(true);
    expect(await ask(s, 'e', { account: 3 })).toEqual({ ok: false, reason: 'everyone', retry_after_seconds: 30 * 60 });
    expect((await ask(s, 'e', { account: 3, now: NOW + 30 * 60_000 })).ok).toBe(true);
  });

  it('gives a place back when a post fails, and lets the same IIP be tried again', async () => {
    const s = new MemoryStorage();
    const r = await ask(s, 'a');
    if (!r.ok) throw new Error('expected a place');
    await finish(s, r.ticket, { failed: true }, NOW);
    expect(s.data.get('acct:1:2026-11-03')).toBe(0);
    expect(s.data.get(`hour:${Math.floor(NOW / 3_600_000)}`)).toBe(0);
    expect((await ask(s, 'a')).ok).toBe(true);
  });

  it('holds an IIP in progress for ten minutes at most, then remembers a posted one for a day', async () => {
    const s = new MemoryStorage();
    const r = await ask(s, 'a');
    if (!r.ok) throw new Error('expected a place');
    expect(await ask(s, 'a', { now: NOW + 1000 })).toMatchObject({ ok: false, reason: 'busy', retry_after_seconds: PENDING_MS / 1000 - 1 });
    expect((await ask(s, 'a', { now: NOW + PENDING_MS, daily: 9, hourly: 9 })).ok).toBe(true);

    const t = new MemoryStorage();
    const first = await ask(t, 'a');
    if (!first.ok) throw new Error('expected a place');
    await finish(t, first.ticket, { posted: out(1) }, NOW);
    expect(await ask(t, 'a', { now: NOW + REMEMBER_MS - 1 })).toEqual({ ok: false, reason: 'duplicate', result: out(1) });
    expect((await ask(t, 'a', { now: NOW + REMEMBER_MS })).ok).toBe(true);
  });

  it('forgets counts and memories that can no longer matter', async () => {
    const s = new MemoryStorage();
    const r = await ask(s, 'a');
    if (!r.ok) throw new Error('expected a place');
    await finish(s, r.ticket, { posted: out(1) }, NOW);
    await ask(s, 'b', { now: NOW + 2 * REMEMBER_MS });
    expect([...s.data.keys()].sort()).toEqual(['acct:1:2026-11-05', `hour:${Math.floor((NOW + 2 * REMEMBER_MS) / 3_600_000)}`, 'seen:b']);
  });
});
