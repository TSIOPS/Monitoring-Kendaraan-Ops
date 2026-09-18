import type { KVStore } from '../deps';

interface RateEntry {
  count: number;
  start: number;
}

export async function checkRate(
  kv: KVStore,
  key: string,
  max: number,
  windowMs: number,
  now: () => number = Date.now,
): Promise<{ allowed: boolean; retryAfterSec: number | null }> {
  const t = now();
  const raw = await kv.get(`rl:${key}`, 'json');
  let entry: RateEntry = raw ? (raw as RateEntry) : { count: 0, start: t };

  if (t - entry.start > windowMs) {
    entry = { count: 0, start: t };
  }
  if (entry.count >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.start + windowMs - t) / 1000));
    return { allowed: false, retryAfterSec };
  }
  entry.count += 1;
  await kv.put(`rl:${key}`, JSON.stringify(entry), { expirationTtl: Math.ceil(windowMs / 1000) + 1 });
  return { allowed: true, retryAfterSec: null };
}

export async function resetRate(kv: KVStore, key: string): Promise<void> {
  await kv.delete(`rl:${key}`);
}