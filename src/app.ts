import { Hono } from 'hono';
import type { Env } from './env';
import type { AppDeps } from './deps';
import { errPayload, HttpError } from './utils/http';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { masterRoutes } from './routes/master';
import { settingsRoutes } from './routes/settings';
import { auditRoutes } from './routes/audit';
import { findByUsernameDb } from './db/users';
import { recordAuditDb, auditListDb } from './db/audit';
import { supabaseMasterRepo } from './db/master';
import { supabaseSettingsRepo } from './db/settings';
import { supabaseLaporanRepo } from './db/laporan';
import { uploadEvidenceStorage, deleteEvidenceStorage } from './db/storage';
import { laporanRoutes, dashboardRoutes } from './routes/laporan';

export function buildApp(env: Env, overrides: Partial<AppDeps> = {}): Hono<{ Bindings: Env }> {
  const deps: AppDeps = {
    kv: env.SESSION_KV,
    findByUsername: findByUsernameDb(env),
    recordAudit: recordAuditDb(env),
    auditList: auditListDb(env),
    now: () => Date.now(),
    master: supabaseMasterRepo(env),
    settings: supabaseSettingsRepo(env),
    laporan: supabaseLaporanRepo(env),
    uploadEvidence: uploadEvidenceStorage,
    deleteEvidence: deleteEvidenceStorage,
    ...overrides,
  };

  const app = new Hono<{ Bindings: Env }>();

  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Access-Control-Allow-Origin', c.req.header('Origin') ?? '');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  });

  app.on('OPTIONS', '*', (c) => c.body(null, 204));

  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json(errPayload(err.message, err.error), err.status);
    }
    console.error('unhandled:', err);
    return c.json(errPayload('Terjadi kesalahan internal.', 'INTERNAL'), 500);
  });

  app.route('/api/health', healthRoutes());
  app.route('/api', authRoutes(deps));
  app.route('/api/master', masterRoutes(deps));
  app.route('/api/settings', settingsRoutes(deps));
  app.route('/api/audit', auditRoutes(deps));
  app.route('/api/laporan', laporanRoutes(deps));
  app.route('/api/dashboard', dashboardRoutes(deps));

  app.all('/*', (c) => env.ASSETS.fetch(c.req.raw));

  return app;
}