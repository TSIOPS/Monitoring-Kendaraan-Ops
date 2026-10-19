import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import type { AppDeps, SessionUser } from '../deps';
import { resolveSession } from './sessions';
import { errPayload } from '../utils/http';
import { isManagement } from './peran';

export interface AuthVars {
  user: SessionUser;
}

const METODE_BACA = new Set(['GET', 'HEAD', 'OPTIONS']);
// Tulis yang tetap boleh untuk MANAGEMENT: hanya milik akunnya sendiri.
const IZIN_TULIS_MANAGEMENT = new Set(['/api/password', '/api/push/langganan', '/api/push/berhenti', '/api/push/tes']);
export const MSG_MANAGEMENT_READONLY = 'Akses ditolak: akun MANAGEMENT hanya dapat melihat data.';

export function bolehTulisManagement(method: string, path: string): boolean {
  return METODE_BACA.has(method.toUpperCase()) || IZIN_TULIS_MANAGEMENT.has(path.replace(/\/+$/, ''));
}

export function requireUser(deps: Pick<AppDeps, 'kv' | 'now'>): MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }> {
  return async (c, next) => {
    const auth = c.req.header('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    const user = await resolveSession(deps.kv, token, deps.now);
    if (!user) {
      return c.json(errPayload('Akses ditolak: sesi tidak valid. Silakan login kembali.', 'UNAUTHORIZED'), 401);
    }
    // Lapis 1: MANAGEMENT read-only untuk SEMUA route ber-sesi, termasuk route baru di masa depan.
    if (isManagement(user) && !bolehTulisManagement(c.req.method, c.req.path)) {
      return c.json(errPayload(MSG_MANAGEMENT_READONLY, 'FORBIDDEN'), 403);
    }
    c.set('user', user);
    await next();
  };
}
