import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Env } from '../src/env';
import type { AppDeps } from '../src/deps';

function fakeEnv(): Env {
  return {
    ASSETS: { fetch: async () => new Response('static:not-found', { status: 404 }) } as unknown as Env['ASSETS'],
    SESSION_KV: {} as Env['SESSION_KV'],
    SUPABASE_URL: 'http://localhost',
    SUPABASE_SERVICE_ROLE_KEY: 'test',
  };
}

const defaultDeps: AppDeps = {
  kv: {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
  },
  findByUsername: async () => null,
  recordAudit: async () => {},
  now: () => 1_000_000,
};

describe('buildApp', () => {
  it('GET /api/health => success ok', async () => {
    const app = buildApp(fakeEnv(), { ...defaultDeps });
    const res = await app.request('/api/health', { method: 'GET' }, fakeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: 'ok' });
  });

  it('path non-api dilayani ASSETS (fallback)', async () => {
    const app = buildApp(fakeEnv(), { ...defaultDeps });
    const res = await app.request('/', { method: 'GET' }, fakeEnv());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('static:not-found');
  });

  it('route tak dikenal di /api/* mengembalikan JSON error 404', async () => {
    const app = buildApp(fakeEnv(), { ...defaultDeps });
    const res = await app.request('/api/tidak-ada', { method: 'GET' }, fakeEnv());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('static:not-found');
  });
});