import type { KVStore, SessionUser } from '../deps';

export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export async function createSession(kv: KVStore, user: SessionUser, now: () => number = Date.now): Promise<string> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const token = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  const session: SessionUser = { ...user, exp: now() + SESSION_TTL_SECONDS * 1000 };
  await kv.put(`session:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

export async function resolveSession(kv: KVStore, token: string | null, now: () => number = Date.now): Promise<SessionUser | null> {
  if (!token) return null;
  const raw = await kv.get(`session:${token}`);
  if (!raw) return null;
  const s = JSON.parse(raw) as SessionUser;
  if (now() > s.exp) {
    await kv.delete(`session:${token}`);
    return null;
  }
  return s;
}

export async function destroySession(kv: KVStore, token: string | null): Promise<void> {
  if (token) await kv.delete(`session:${token}`);
}