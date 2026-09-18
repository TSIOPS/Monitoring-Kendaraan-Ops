import { Hono } from 'hono';
import type { Env } from './env';
import type { AppDeps } from './deps';
import { errPayload } from './utils/http';
import { healthRoutes } from './routes/health';

export function buildApp(env: Env, _overrides: Partial<AppDeps> = {}): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Access-Control-Allow-Origin', c.req.header('Origin') ?? '');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  });

  app.on('OPTIONS', '*', (c) => c.body(null, 204));

  app.onError((err, c) => {
    console.error('unhandled:', err);
    return c.json(errPayload('Terjadi kesalahan internal.', 'INTERNAL'), 500);
  });

  app.route('/api/health', healthRoutes());

  app.all('/*', (c) => env.ASSETS.fetch(c.req.raw));

  return app;
}