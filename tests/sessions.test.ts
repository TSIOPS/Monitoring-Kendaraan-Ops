import { describe, expect, it } from 'vitest';
import { createSession, destroySession, resolveSession, SESSION_TTL_SECONDS } from '../src/auth/sessions';
import type { KVStore, SessionUser } from '../src/deps';

function memKV(): KVStore & { _map: Map<string, string> } {
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
    expect(kv._map.has('session:' + token)).toBe(false);
  });
});

describe('sesi sliding', () => {
  const pengguna: SessionUser = { user_id: 'U-1', username: 'a', nama: 'A', role: 'PIC CABANG', cabang: 'X', exp: 0 };

  it('sesi yang dipakai setelah separuh TTL diperpanjang', async () => {
    const kv = memKV();
    let t = 1_000_000;
    const now = () => t;
    const token = await createSession(kv, pengguna, now);
    t += SESSION_TTL_SECONDS * 1000 * 0.6;
    const s1 = await resolveSession(kv, token, now);
    expect(s1!.exp).toBe(t + SESSION_TTL_SECONDS * 1000);
    t += SESSION_TTL_SECONDS * 1000 * 0.6; // total 1.2x TTL: tanpa perpanjangan sudah kedaluwarsa
    expect(await resolveSession(kv, token, now)).not.toBeNull();
  });

  it('sesi yang dipakai sebelum separuh TTL tidak ditulis ulang', async () => {
    const kv = memKV();
    let t = 1_000_000;
    const token = await createSession(kv, pengguna, () => t);
    const awal = (await resolveSession(kv, token, () => t))!.exp;
    t += 1000;
    expect((await resolveSession(kv, token, () => t))!.exp).toBe(awal);
  });
});
