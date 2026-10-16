import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../../src/app';
import { fakeEnv, makeDeps } from '../helpers';
import { extractStorageKey, uploadEvidenceStorage } from '../../src/db/storage';
import { thumbUrlOf } from '../../src/logic/foto';
import { kunciAman } from '../../src/routes/foto';

// R2 palsu di memori (cukup untuk get/head/put/delete yang dipakai).
function r2Palsu() {
  const isi = new Map<string, { bytes: Uint8Array; type: string }>();
  return {
    isi,
    async get(k: string) {
      const o = isi.get(k);
      if (!o) return null;
      return { body: o.bytes, httpEtag: '"e"', writeHttpMetadata: (h: Headers) => h.set('Content-Type', o.type) };
    },
    async head(k: string) { return isi.has(k) ? {} : null; },
    async put(k: string, v: ArrayBuffer | Uint8Array, o?: { httpMetadata?: { contentType?: string } }) {
      isi.set(k, { bytes: v instanceof Uint8Array ? v : new Uint8Array(v), type: o?.httpMetadata?.contentType ?? '' });
    },
    async delete(k: string) { isi.delete(k); },
  };
}

const ctx = { waitUntil: (p: Promise<unknown>) => { void p; }, passThroughOnException: () => {} } as any;

function setup(extra: Record<string, unknown> = {}) {
  const r2 = r2Palsu();
  const env = { ...fakeEnv(), FOTO: r2, ...extra } as any;
  const { deps } = makeDeps();
  return { app: buildApp(env, deps), env, r2 };
}

describe('foto di R2', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('upload ke R2 menghasilkan URL /foto/<kunci>; kunci & thumbnail terbaca dari URL itu', async () => {
    const r2 = r2Palsu();
    const up = await uploadEvidenceStorage({ FOTO: r2 } as any, { branch: 'BDG', folder: 'Struk_BBM', bytes: new Uint8Array([1]), ext: 'jpg', contentType: 'image/jpeg' });
    expect(up.url).toMatch(/^\/foto\/BDG\/Struk_BBM\/[0-9a-f-]+\.jpg$/);
    expect(extractStorageKey(up.url)).toBe(up.key);
    expect(r2.isi.has(up.key)).toBe(true);
    expect(thumbUrlOf('/foto/BDG/KM_Awal/a.png')).toBe('/foto/thumb/BDG/KM_Awal/a.jpg');
    expect(extractStorageKey('https://x.supabase.co/storage/v1/object/public/foto/BDG/KM_Awal/a.jpg')).toBe('BDG/KM_Awal/a.jpg');
  });

  it('GET /foto dari R2; bila belum ada diambil dari Supabase lalu disalin', async () => {
    const { app, env, r2 } = setup();
    await r2.put('BDG/KM_Awal/ada.jpg', new Uint8Array([7]), { httpMetadata: { contentType: 'image/jpeg' } });
    const a = await app.request('/foto/BDG/KM_Awal/ada.jpg', {}, env, ctx);
    expect(a.status).toBe(200);
    expect(a.headers.get('Cache-Control')).toContain('immutable');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([9]), { status: 200, headers: { 'Content-Type': 'image/jpeg' } })));
    const b = await app.request('/foto/BDG/KM_Awal/lama.jpg', {}, env, ctx);
    expect(b.status).toBe(200);
    expect(r2.isi.has('BDG/KM_Awal/lama.jpg')).toBe(true);
  });

  it('kunci tidak sah & salin-foto tanpa token ditolak', async () => {
    expect(kunciAman('BDG/../rahasia')).toBe(false);
    expect(kunciAman('thumb/BDG/KM_Awal/a.jpg')).toBe(true);
    const { app, env } = setup({ MIGRASI_TOKEN: 'rahasia' });
    const res = await app.request('/api/admin/salin-foto', { method: 'POST', body: '{"keys":["a.jpg"]}', headers: { 'Content-Type': 'application/json' } }, env, ctx);
    expect(res.status).toBe(403);
  });

  it('salin-foto dengan token: salin yang belum ada, lewati yang sudah ada', async () => {
    const { app, env, r2 } = setup({ MIGRASI_TOKEN: 'rahasia' });
    await r2.put('sudah.jpg', new Uint8Array([1]));
    vi.stubGlobal('fetch', vi.fn(async () => new Response(new Uint8Array([2]), { status: 200 })));
    const res = await app.request('/api/admin/salin-foto', { method: 'POST', body: JSON.stringify({ keys: ['sudah.jpg', 'BDG/baru.jpg'] }), headers: { 'Content-Type': 'application/json', 'X-Migrasi-Token': 'rahasia' } }, env, ctx);
    expect(await res.json()).toMatchObject({ success: true, disalin: 1, sudahAda: 1 });
    expect(r2.isi.has('BDG/baru.jpg')).toBe(true);
  });
});
