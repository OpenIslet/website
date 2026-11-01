// The small slice of Workers KV the queue uses. A Cloudflare KVNamespace fits it as it is; the tests use an in-memory copy.
//
// KV is eventually consistent and has no atomic counters. That is fine here: the counters only slow abuse down, and
// every important step (posting once, using a sign-in once) is also guarded by what is stored, not only by timing.

export interface QueueKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** KV will not accept an expiry shorter than a minute. */
export const KV_MIN_TTL = 60;

export async function getJson<T>(kv: QueueKV, key: string): Promise<T | null> {
  const text = await kv.get(key);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

export async function putJson(kv: QueueKV, key: string, value: unknown, ttlSeconds: number): Promise<void> {
  await kv.put(key, JSON.stringify(value), { expirationTtl: Math.max(KV_MIN_TTL, Math.ceil(ttlSeconds)) });
}
