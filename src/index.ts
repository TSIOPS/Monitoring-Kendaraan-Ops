import { buildApp } from './app';
import type { Env } from './env';
import type { Hono } from 'hono';

let app: Hono<{ Bindings: Env }> | null = null;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (!app) app = buildApp(env);
    return app.fetch(request, env, ctx);
  },
};