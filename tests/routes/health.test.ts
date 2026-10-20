import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { fakeEnv, makeDeps } from '../helpers';

describe('GET /api/health/versi', () => {
  it('mengembalikan id versi deploy tanpa cache', async () => {
    const env = { ...fakeEnv(), CF_VERSION_METADATA: { id: 'v-123' } };
    const app = buildApp(env, makeDeps().deps);
    const res = await app.request('/api/health/versi', {}, env);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(((await res.json()) as any).versi).toBe('v-123');
  });
  it('tanpa binding -> versi kosong', async () => {
    const app = buildApp(fakeEnv(), makeDeps().deps);
    const res = await app.request('/api/health/versi', {}, fakeEnv());
    expect(((await res.json()) as any).versi).toBe('');
  });
});
