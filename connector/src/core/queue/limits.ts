// The posting limits that must hold exactly, kept in one place that answers one request at a time (the Durable Object in
// src/queue-limits.ts). Workers KV cannot count atomically, so two quick posts could both pass a KV count.
//
//  - each GitHub account: DAILY_LIMIT_PER_ACCOUNT posts per UTC day
//  - everyone together: HOURLY_LIMIT_EVERYONE posts per clock hour, so many accounts cannot flood the queue
//  - one IIP once: the same account sending the same draft, review and wet-lab readouts again within a day gets the first answer back,
//    so a dropped connection followed by "start again" never opens a second issue
//  - used once: a single-use value (an ORCID check's state) is spent here, so two requests at the same moment cannot both use it
//
// A post first reserves its place, then settles it (posted) or releases it (GitHub said no, or the answer was lost).

import type { CompleteOutput } from './types';

/** The part of a Durable Object's storage this uses. A Map-backed copy stands in for it in the tests. */
export interface LimitsStorage {
  get<T>(key: string): Promise<T | undefined>;
  put(entries: Record<string, unknown>): Promise<void>;
  delete(keys: string[]): Promise<number>;
  list<T>(options: { prefix: string }): Promise<Map<string, T>>;
}

export interface ReserveRequest {
  account: number;
  /** sha256 of the account, the exact draft and review, and any wet-lab readouts (see QueueService.fingerprint). */
  fingerprint: string;
  now: number;
  dailyLimit: number;
  hourlyLimit: number;
}

/** Where a reservation was counted, so it can be given back exactly. */
export interface Ticket {
  account: number;
  day: string;
  hour: number;
  fingerprint: string;
}

export type Reservation =
  | { ok: true; ticket: Ticket }
  | { ok: false; reason: 'account' | 'everyone'; retry_after_seconds: number }
  /** The same IIP was posted earlier today: here is that answer. */
  | { ok: false; reason: 'duplicate'; result: CompleteOutput }
  /** The same IIP is being posted right now, from another tab or a retry. */
  | { ok: false; reason: 'busy'; retry_after_seconds: number };

/** How the post went. A failed post never uses up a place, as before: the person is told plainly what to do next. */
export type Outcome = { posted: CompleteOutput } | { failed: true };

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
/** A finished post is remembered this long, so a repeat within a day gets the same answer. */
export const REMEMBER_MS = DAY_MS;
/** A post in progress blocks the same IIP this long at most; after that a stuck attempt no longer holds anything up. */
export const PENDING_MS = 10 * 60_000;

interface Seen {
  status: 'pending' | 'done';
  at: number;
  result?: CompleteOutput;
}

const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const hourOf = (ms: number): number => Math.floor(ms / HOUR_MS);
const toNextHour = (ms: number): number => Math.max(1, Math.ceil((HOUR_MS - (ms % HOUR_MS)) / 1000));
const toNextDay = (ms: number): number => Math.max(1, Math.ceil((DAY_MS - (ms % DAY_MS)) / 1000));
const accountKey = (account: number, day: string) => `acct:${account}:${day}`;
const hourKey = (hour: number) => `hour:${hour}`;
const seenKey = (fingerprint: string) => `seen:${fingerprint}`;
const onceKey = (key: string) => `once:${key}`;

/** Drops counts and memories that can no longer matter, so the store stays small. */
async function tidy(storage: LimitsStorage, now: number): Promise<void> {
  const today = dayOf(now);
  const hour = hourOf(now);
  const old: string[] = [];
  for (const key of (await storage.list<number>({ prefix: 'acct:' })).keys()) if (key.slice(key.lastIndexOf(':') + 1) < today) old.push(key);
  for (const key of (await storage.list<number>({ prefix: 'hour:' })).keys()) if (Number(key.slice(5)) < hour) old.push(key);
  for (const [key, seen] of await storage.list<Seen>({ prefix: 'seen:' })) if (seen.at + REMEMBER_MS <= now) old.push(key);
  for (const [key, once] of await storage.list<{ until: number }>({ prefix: 'once:' })) if (!(once?.until > now)) old.push(key);
  // A Durable Object deletes at most 128 keys at once.
  for (let i = 0; i < old.length; i += 128) await storage.delete(old.slice(i, i + 128));
}

export async function reserve(storage: LimitsStorage, r: ReserveRequest): Promise<Reservation> {
  await tidy(storage, r.now);
  const seen = await storage.get<Seen>(seenKey(r.fingerprint));
  if (seen?.status === 'done' && seen.result && seen.at + REMEMBER_MS > r.now) return { ok: false, reason: 'duplicate', result: seen.result };
  if (seen?.status === 'pending' && seen.at + PENDING_MS > r.now) {
    return { ok: false, reason: 'busy', retry_after_seconds: Math.max(1, Math.ceil((seen.at + PENDING_MS - r.now) / 1000)) };
  }

  const day = dayOf(r.now);
  const hour = hourOf(r.now);
  const used = (await storage.get<number>(accountKey(r.account, day))) ?? 0;
  if (used >= r.dailyLimit) return { ok: false, reason: 'account', retry_after_seconds: toNextDay(r.now) };
  const everyone = (await storage.get<number>(hourKey(hour))) ?? 0;
  if (everyone >= r.hourlyLimit) return { ok: false, reason: 'everyone', retry_after_seconds: toNextHour(r.now) };

  await storage.put({
    [accountKey(r.account, day)]: used + 1,
    [hourKey(hour)]: everyone + 1,
    [seenKey(r.fingerprint)]: { status: 'pending', at: r.now } satisfies Seen,
  });
  return { ok: true, ticket: { account: r.account, day, hour, fingerprint: r.fingerprint } };
}

export async function finish(storage: LimitsStorage, ticket: Ticket, outcome: Outcome, now: number): Promise<void> {
  if ('posted' in outcome) {
    await storage.put({ [seenKey(ticket.fingerprint)]: { status: 'done', at: now, result: outcome.posted } satisfies Seen });
    return;
  }
  // The person may try again (after looking at the public queue, if GitHub's answer was lost), so the IIP is no longer held,
  // and the place is given back.
  await storage.delete([seenKey(ticket.fingerprint)]);
  const back: Record<string, number> = {};
  const used = await storage.get<number>(accountKey(ticket.account, ticket.day));
  if (used) back[accountKey(ticket.account, ticket.day)] = used - 1;
  const everyone = await storage.get<number>(hourKey(ticket.hour));
  if (everyone) back[hourKey(ticket.hour)] = everyone - 1;
  if (Object.keys(back).length) await storage.put(back);
}

/**
 * Spends a single-use value: true the first time `key` is claimed, false every time after, until `ttlMs` has passed (by then the
 * value has expired anyway). `key` is already a hash: nothing secret is kept here.
 */
export async function claimOnce(storage: LimitsStorage, key: string, now: number, ttlMs: number): Promise<boolean> {
  await tidy(storage, now);
  const held = await storage.get<{ until: number }>(onceKey(key));
  if (held && held.until > now) return false;
  await storage.put({ [onceKey(key)]: { until: now + ttlMs } });
  return true;
}

/** What the queue service needs: the Durable Object from the Worker, or the same functions over memory in the tests. */
export interface LimitsPort {
  reserve(r: ReserveRequest): Promise<Reservation>;
  finish(ticket: Ticket, outcome: Outcome, now: number): Promise<void>;
  claimOnce(key: string, now: number, ttlMs: number): Promise<boolean>;
}
