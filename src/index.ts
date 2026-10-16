import { buildApp } from './app';
import type { Env } from './env';
import type { Hono } from 'hono';
import { buildDeps } from './app';
import { kirimPengingatHarian, vapidDariEnv } from './routes/push';
import { jalankanBackup } from './backup';

let app: Hono<{ Bindings: Env }> | null = null;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!app) app = buildApp(env);
    return app.fetch(request, env, ctx);
  },

  // Cron 19:00 UTC = 02:00 WIB: backup harian ke R2. Cron 09:30 UTC = 16:30 WIB: pengingat.
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '0 19 * * *') {
      ctx.waitUntil(jalankanBackup(env).then((r) => console.log('backup', JSON.stringify(r))).catch((e) => console.error('backup gagal:', (e as Error).message)));
      return;
    }
    const vapid = vapidDariEnv(env);
    if (!vapid) return;
    ctx.waitUntil(kirimPengingatHarian(buildDeps(env), env.SESSION_KV, vapid).then((r) => console.log('pengingat 16:30', JSON.stringify(r))));
  },
};