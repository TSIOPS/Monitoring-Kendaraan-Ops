import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { fakeEnv, makeDeps } from './helpers';

describe('buildApp', () => {
  it('GET /api/health => success ok', async () => {
    const app = buildApp(fakeEnv(), makeDeps().deps);
    const res = await app.request('/api/health', { method: 'GET' }, fakeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: 'ok' });
  });

  it('path non-api dilayani ASSETS (fallback)', async () => {
    const app = buildApp(fakeEnv(), makeDeps().deps);
    const res = await app.request('/', { method: 'GET' }, fakeEnv());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('static:not-found');
  });

  it('route tak dikenal di /api/* mengembalikan JSON error 404', async () => {
    const app = buildApp(fakeEnv(), makeDeps().deps);
    const res = await app.request('/api/tidak-ada', { method: 'GET' }, fakeEnv());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('static:not-found');
  });

  it('menambahkan header CORS pada respon api', async () => {
    const app = buildApp(fakeEnv(), makeDeps().deps);
    const res = await app.request(
      '/api/health',
      { method: 'GET', headers: { Origin: 'http://localhost:8787' } },
      fakeEnv(),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8787');
  });

  it('OPTIONS preflight dikembalikan 204 + header CORS', async () => {
    const app = buildApp(fakeEnv(), makeDeps().deps);
    const res = await app.request(
      '/api/login',
      {
        method: 'OPTIONS',
        headers: { Origin: 'http://localhost:8787', 'Access-Control-Request-Method': 'POST' },
      },
      fakeEnv(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
  });
});