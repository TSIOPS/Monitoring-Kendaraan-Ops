import { Hono } from 'hono';
import type { Env } from '../env';
import { okPayload } from '../utils/http';

export function healthRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.get('/', (c) => c.json(okPayload({ status: 'ok' })));
  return app;
}