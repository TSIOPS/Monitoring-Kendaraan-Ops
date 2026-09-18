import { describe, expect, it } from 'vitest';
import { checkRate, resetRate } from '../src/auth/rateLimit';
import type { KVStore } from '../src/deps';

function memKV(): KVStore {
  const map = new Map<string, string>();
  return {
    get: async (k, type) => {
      const v = map.get(k);
      if (v == null) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (k, v) => {
      map.set(k, v);
    },
    delete: async (k) => {
      map.delete(k);
    },
  };
}

describe('rate limit', () => {
  it('mengizinkan hingga max, memblokir setelahnya', async () => {
    const kv = memKV();
    for (let i = 0; i < 5; i++) {
      expect((await checkRate(kv, 'login:picjkt', 5, 5 * 60 * 1000, () => 1_000)).allowed).toBe(true);
    }
    const blocked = await checkRate(kv, 'login:picjkt', 5, 5 * 60 * 1000, () => 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('resetRate mengizinkan lagi', async () => {
    const kv = memKV();
    for (let i = 0; i < 5; i++) await checkRate(kv, 'login:picjkt', 5, 60_000, () => 1_000);
    await resetRate(kv, 'login:picjkt');
    expect((await checkRate(kv, 'login:picjkt', 5, 60_000, () => 1_000)).allowed).toBe(true);
  });

  it('jendela waktu berlalu => diizinkan lagi', async () => {
    const kv = memKV();
    for (let i = 0; i < 5; i++) await checkRate(kv, 'login:picjkt', 5, 60_000, () => 1_000);
    const after = await checkRate(kv, 'login:picjkt', 5, 60_000, () => 1_000 + 61_000);
    expect(after.allowed).toBe(true);
  });
});