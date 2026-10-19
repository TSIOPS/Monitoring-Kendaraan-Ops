import type { KVStore, SessionUser } from '../deps';

export const SESSION_TTL_SECONDS = 12 * 60 * 60;

// Daftar token aktif per pengguna (sessu:<user_id>) agar semua sesi bisa dicabut
// (ganti password, akun dinonaktifkan). Disimpan maks 20 token terbaru.
const kunciDaftar = (userId: string) => `sessu:${userId}`;

export async function createSession(kv: KVStore, user: SessionUser, now: () => number = Date.now): Promise<string> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const token = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  const session: SessionUser = { ...user, exp: now() + SESSION_TTL_SECONDS * 1000 };
  await kv.put(`session:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS });
  if (user.user_id) {
    const lama = (await kv.get(kunciDaftar(user.user_id), 'json')) as string[] | null;
    const daftar = [...(Array.isArray(lama) ? lama : []), token].slice(-20);
    await kv.put(kunciDaftar(user.user_id), JSON.stringify(daftar), { expirationTtl: SESSION_TTL_SECONDS });
  }
  return token;
}

// Sesi diperpanjang (sliding) bila sudah lewat separuh umur: PIC yang login pagi tidak
// terlempar di tengah input sore. Ditulis ulang paling banyak sekali per separuh TTL agar KV hemat.
export async function resolveSession(kv: KVStore, token: string | null, now: () => number = Date.now): Promise<SessionUser | null> {
  if (!token) return null;
  const raw = await kv.get(`session:${token}`);
  if (!raw) return null;
  const s = JSON.parse(raw as string) as SessionUser;
  const t = now();
  if (t > s.exp) {
    await kv.delete(`session:${token}`);
    return null;
  }
  const ttlMs = SESSION_TTL_SECONDS * 1000;
  if (s.exp - t < ttlMs / 2) {
    s.exp = t + ttlMs;
    await kv.put(`session:${token}`, JSON.stringify(s), { expirationTtl: SESSION_TTL_SECONDS });
    if (s.user_id) {
      const daftar = await kv.get(kunciDaftar(s.user_id), 'json');
      if (Array.isArray(daftar)) await kv.put(kunciDaftar(s.user_id), JSON.stringify(daftar), { expirationTtl: SESSION_TTL_SECONDS });
    }
  }
  return s;
}

export async function destroySession(kv: KVStore, token: string | null): Promise<void> {
  if (token) await kv.delete(`session:${token}`);
}

// Cabut semua sesi pengguna, kecuali `kecuali` (sesi yang sedang dipakai). Mengembalikan jumlah dicabut.
export async function cabutSesiPengguna(kv: KVStore, userId: string, kecuali = ''): Promise<number> {
  const daftar = (await kv.get(kunciDaftar(userId), 'json')) as string[] | null;
  if (!Array.isArray(daftar) || !daftar.length) return 0;
  let n = 0;
  for (const t of daftar) {
    if (t === kecuali) continue;
    await kv.delete(`session:${t}`);
    n++;
  }
  if (kecuali && daftar.includes(kecuali)) await kv.put(kunciDaftar(userId), JSON.stringify([kecuali]), { expirationTtl: SESSION_TTL_SECONDS });
  else await kv.delete(kunciDaftar(userId));
  return n;
}
