import { describe, expect, it } from 'vitest';
import { createSession, destroySession, resolveSession } from '../src/auth/sessions';
import type { KVStore, SessionUser } from '../src/deps';

function memKV(): KVStore & Record<string, unknown> {
  const map = new Map<string, string>();
  return {
    get: async (k) => map.get(k) ?? null,
    put: async (k, v) => {
      map.set(k, v);
    },
    delete: async (k) => {
      map.delete(k);
    },
    _map: map,
  };
}

const user: SessionUser = {
  user_id: 'U-1',
  username: 'picjkt',
  nama: 'PIC Jakarta',
  role: 'PIC CABANG',
  cabang: 'CBG-JKT',
  exp: 1_000_000 + 12 * 3600 * 1000,
};

describe('sessions', () => {
  it('create+resolve mengembalikan user yang sama', async () => {
    const kv = memKV();
    const token = await createSession(kv, user);
    const got = await resolveSession(kv, token);
    expect(got).toMatchObject({ user_id: 'U-1', username: 'picjkt', role: 'PIC CABANG' });
  });

  it('resolve token null/kosong => null', async () => {
    const kv = memKV();
    expect(await resolveSession(kv, null)).toBeNull();
    expect(await resolveSession(kv, '')).toBeNull();
  });

  it('destroy membuat session tidak valid', async () => {
    const kv = memKV();
    const token = await createSession(kv, user);
    await destroySession(kv, token);
    expect(await resolveSession(kv, token)).toBeNull();
  });

  it('session kedaluwarsa ditolak dan dihapus', async () => {
    const kv = memKV();
    const token = await createSession(kv, user, () => 1_000_000);
    const expired = await resolveSession(kv, token, () => 1_000_000 + 13 * 3600 * 1000);
    expect(expired).toBeNull();
    expect((kv as KVStore & { _map: Map<string, string> })._map.has('session:' + token)).toBe(false);
  });
});