import { Hono } from 'hono';
import type { Env } from '../env';
import { okPayload } from '../utils/http';

export function healthRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.get('/', (c) => c.json(okPayload({ status: 'ok' })));
  app.get('/versi', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(okPayload({ versi: String((c.env as Env | undefined)?.CF_VERSION_METADATA?.id ?? '') }));
  });
  return app;
}