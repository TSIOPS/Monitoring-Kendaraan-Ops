import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppDeps } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { HttpError, okPayload } from '../utils/http';

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

export function auditRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/', requireUser(deps), async (c: Ctx) => {
    const u = c.get('user');
    if (u.role !== 'SUPERADMIN') throw new HttpError(403, 'Akses ditolak: hanya SUPERADMIN yang dapat melihat audit.', 'FORBIDDEN');
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 500);
    const rows = await deps.auditList(limit);
    return c.json(okPayload({ items: rows }));
  });

  return app;
}