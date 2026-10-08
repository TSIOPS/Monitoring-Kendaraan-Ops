import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppDeps } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { HttpError, okPayload } from '../utils/http';
import { AUDIT_LIMIT_DEFAULT, AUDIT_LIMIT_MAKS, filterDariQuery } from '../logic/audit';

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

export function auditRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/', requireUser(deps), async (c: Ctx) => {
    const u = c.get('user');
    if (u.role !== 'SUPERADMIN') throw new HttpError(403, 'Akses ditolak: hanya SUPERADMIN yang dapat melihat audit.', 'FORBIDDEN');
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? AUDIT_LIMIT_DEFAULT) || AUDIT_LIMIT_DEFAULT, 1), AUDIT_LIMIT_MAKS);
    const rows = await deps.auditList(limit, filterDariQuery(c.req.query()));
    // terpotong = mungkin masih ada baris lebih lama di luar batas.
    return c.json(okPayload({ items: rows, limit, terpotong: rows.length >= limit }));
  });

  return app;
}