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

  it('tanpa CORS untuk origin lain; header keamanan terpasang', async () => {
    const app = buildApp(fakeEnv(), makeDeps().deps);
    const res = await app.request(
      '/api/health',
      { method: 'GET', headers: { Origin: 'http://localhost:8787' } },
      fakeEnv(),
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('OPTIONS preflight 204 tanpa izin CORS', async () => {
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
    expect(res.headers.get('Access-Control-Allow-Methods')).toBeNull();
  });
});