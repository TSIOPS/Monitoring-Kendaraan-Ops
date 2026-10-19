import type { KVStore, SessionUser } from '../deps';

export const SESSION_TTL_SECONDS = 12 * 60 * 60;
// Batas umur mutlak sesi (sejak login), walau terus diperpanjang (sliding).
export const SESSION_MAKS_MS = 7 * 24 * 60 * 60 * 1000;
const DAFTAR_TTL_SECONDS = SESSION_MAKS_MS / 1000;

// Daftar token aktif per pengguna (sessu:<user_id>) agar semua sesi bisa dicabut
// (ganti password, akun dinonaktifkan). Disimpan maks 20 token terbaru. TTL-nya sepanjang
// SESSION_MAKS_MS agar daftar selalu hidup lebih lama daripada sesi yang bisa diperpanjang.
const kunciDaftar = (userId: string) => `sessu:${userId}`;

export async function createSession(kv: KVStore, user: SessionUser, now: () => number = Date.now): Promise<string> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const token = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  const t = now();
  const session: SessionUser = { ...user, exp: t + SESSION_TTL_SECONDS * 1000, mulai: t };
  await kv.put(`session:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS });
  if (user.user_id) {
    const lama = (await kv.get(kunciDaftar(user.user_id), 'json')) as string[] | null;
    const daftar = [...(Array.isArray(lama) ? lama : []), token].slice(-20);
    await kv.put(kunciDaftar(user.user_id), JSON.stringify(daftar), { expirationTtl: DAFTAR_TTL_SECONDS });
  }
  return token;
}

// Sesi diperpanjang (sliding) bila sudah lewat separuh umur: PIC yang login pagi tidak
// terlempar di tengah input sore. Ditulis ulang paling banyak sekali per separuh TTL agar KV hemat.
// Pengaman: hanya diperpanjang bila token masih tercantum di daftar sessu (belum dicabut), dan
// tidak pernah melewati mulai + SESSION_MAKS_MS. KV eventually consistent: tanpa cek ini, salinan
// basi di lokasi lain bisa menghidupkan kembali sesi yang sudah dicabut. Daftar sessu tidak
// pernah ditulis di sini (menulis ulang daftar bisa menimpa token baru dari createSession).
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
  if (s.exp - t < ttlMs / 2 && s.user_id && typeof s.mulai === 'number') {
    const daftar = await kv.get(kunciDaftar(s.user_id), 'json');
    if (Array.isArray(daftar) && daftar.includes(token)) {
      const expBaru = Math.min(t + ttlMs, s.mulai + SESSION_MAKS_MS);
      if (expBaru > s.exp) {
        s.exp = expBaru;
        const ttl = Math.max(60, Math.ceil((expBaru - t) / 1000));
        await kv.put(`session:${token}`, JSON.stringify(s), { expirationTtl: ttl });
      }
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
  if (kecuali && daftar.includes(kecuali)) await kv.put(kunciDaftar(userId), JSON.stringify([kecuali]), { expirationTtl: DAFTAR_TTL_SECONDS });
  else await kv.delete(kunciDaftar(userId));
  return n;
}
