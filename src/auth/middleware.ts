import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import type { AppDeps, SessionUser } from '../deps';
import { resolveSession } from './sessions';
import { errPayload } from '../utils/http';

export interface AuthVars {
  user: SessionUser;
}

export function requireUser(deps: Pick<AppDeps, 'kv' | 'now'>): MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }> {
  return async (c, next) => {
    const auth = c.req.header('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    const user = await resolveSession(deps.kv, token, deps.now);
    if (!user) {
      return c.json(errPayload('Akses ditolak: sesi tidak valid. Silakan login kembali.', 'UNAUTHORIZED'), 401);
    }
    c.set('user', user);
    await next();
  };
}