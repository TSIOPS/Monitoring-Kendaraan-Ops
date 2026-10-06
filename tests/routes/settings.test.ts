import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import type { SessionUser } from '../../src/deps';
import type { MasterPenggunaWithPassword } from '../../src/db/master';
import { authHeaders, fakeEnv, makeDeps, loginAs, memMaster, VEHICLE_ROW } from '../helpers';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

const SUPER_ADMIN: MasterPenggunaWithPassword = {
  user_id: 'U-S', username: 'super', password: 'x', nama: 'Super', role: 'SUPERADMIN', kode_cabang: '', status: 'Aktif',
};
const PIC_ADMIN: MasterPenggunaWithPassword = {
  user_id: 'U-P', username: 'pic', password: 'x', nama: 'Pic', role: 'PIC CABANG', kode_cabang: 'CBG-A', status: 'Aktif',
};

function buildEnv() {
  const { kv, audits, deps, masterState, settingsValues } = makeDeps();
  const app = buildApp(fakeEnv() as any, deps);
  return { kv, audits, deps, masterState, settingsValues, app };
}

describe('settings routes', () => {
  it('GET /api/settings publik mengembalikan pengaturan default', async () => {
    const { app } = buildEnv();
    const res = await app.request('/api/settings');
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.app_name).toBe('Monitoring Kendaraan Operasional');
  });

  it('PUT /api/settings ditolak utk PIC (403)', async () => {
    const { kv, app } = buildEnv();
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_name: 'X' }),
    });
    expect(res.status).toBe(403);
  });

  it('PUT /api/settings oleh SUPERADMIN tersimpan di repo', async () => {
    const { kv, app, settingsValues } = buildEnv();
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_name: 'App Baru', company_name: 'PT X', footer_text: 'foot' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).msg).toBe('Pengaturan berhasil disimpan');
    expect(settingsValues.app_name).toBe('App Baru');
  });

  it('PUT /api/settings tanpa logo_url mempertahankan logo yang ada', async () => {
    const { kv, app, settingsValues } = buildEnv();
    settingsValues.logo_url = 'https://x.supabase.co/storage/v1/object/public/settings/logo.png?v=1';
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/settings', {
      method: 'PUT',
      headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_name: 'App Baru', company_name: 'PT X', footer_text: '' }),
    });
    expect(res.status).toBe(200);
    expect(settingsValues.logo_url).toBe('https://x.supabase.co/storage/v1/object/public/settings/logo.png?v=1');
    expect(settingsValues.footer_text).toBe('');
  });

  it('POST /api/settings/logo: base64 invalid => 400 success:false', async () => {
    const { kv, app } = buildEnv();
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/settings/logo', {
      method: 'POST',
      headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data: 'not-base64', fileName: 'logo.png' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(String(body.message)).toContain('Gagal upload logo');
  });
});

describe('kosongkan data (cutover)', () => {
  const AKTIF = { ENABLE_RESET_DATA: 'true' };
  async function siap(passwordHash: string) {
    const { hashPassword } = await import('../../src/auth/password');
    const hash = passwordHash || (await hashPassword('rahasia'));
    let dipanggil = 0;
    const { kv, deps, audits } = makeDeps({
      findByUsername: async () => ({ ...SUPER_ADMIN, password: hash }) as any,
      resetData: async () => { dipanggil++; return { penggunaan_bbm: 5 }; },
    });
    const app = buildApp(fakeEnv() as any, deps);
    return { kv, app, audits, dipanggil: () => dipanggil };
  }
  const kirim = (app: any, tok: string, body: unknown, env: Record<string, string> = {}) => app.request('/api/settings/reset-data', {
    method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, env);

  it('mati secara default (tanpa saklar) dan status melaporkannya', async () => {
    const { kv, app, dipanggil } = await siap('');
    const tok = await loginAs(kv, SUPER);
    expect((await kirim(app, tok, { konfirmasi: 'KOSONGKAN', password: 'rahasia' })).status).toBe(403);
    const st = await (await app.request('/api/settings/reset-status', { headers: authHeaders(tok) }, AKTIF)).json() as any;
    expect(st.aktif).toBe(true);
    expect(dipanggil()).toBe(0);
  });

  it('PIC ditolak; kata konfirmasi & password wajib benar', async () => {
    const { kv, app, dipanggil } = await siap('');
    const pic = await loginAs(kv, PIC);
    expect((await kirim(app, pic, { konfirmasi: 'KOSONGKAN', password: 'rahasia' }, AKTIF)).status).toBe(403);
    const tok = await loginAs(kv, SUPER);
    expect((await kirim(app, tok, { konfirmasi: 'kosong', password: 'rahasia' }, AKTIF)).status).toBe(400);
    expect((await kirim(app, tok, { konfirmasi: 'KOSONGKAN', password: 'salah' }, AKTIF)).status).toBe(403);
    expect(dipanggil()).toBe(0);
  });

  it('berhasil: menghapus, mencatat audit RESET_DATA', async () => {
    const { kv, app, audits, dipanggil } = await siap('');
    const tok = await loginAs(kv, SUPER);
    const res = await kirim(app, tok, { konfirmasi: 'KOSONGKAN', password: 'rahasia' }, AKTIF);
    expect(res.status).toBe(200);
    expect((await res.json() as any).hapus).toEqual({ penggunaan_bbm: 5 });
    expect(dipanggil()).toBe(1);
    expect(audits.some((a) => a.action === 'RESET_DATA')).toBe(true);
  });
});
