import { buildApp } from './app';
import type { Env } from './env';
import type { Hono } from 'hono';
import { buildDeps } from './app';
import { kirimPengingatHarian, vapidDariEnv } from './routes/push';

let app: Hono<{ Bindings: Env }> | null = null;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!app) app = buildApp(env);
    return app.fetch(request, env, ctx);
  },

  // Cron 09:30 UTC = 16:30 WIB: pengingat laporan/rekonsiliasi yang belum selesai hari ini.
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const vapid = vapidDariEnv(env);
    if (!vapid) return;
    ctx.waitUntil(kirimPengingatHarian(buildDeps(env), env.SESSION_KV, vapid).then((r) => console.log('pengingat 16:30', JSON.stringify(r))));
  },
};