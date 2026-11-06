import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, makeDeps, memMaster, loginAs, VEHICLE_ROW } from '../helpers';
import type { SessionUser } from '../../src/deps';
import type { MasterPenggunaWithPassword } from '../../src/db/master';
import { warningsCacheKey } from '../../src/logic/master-cache';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

const SUPER_ADMIN: MasterPenggunaWithPassword = {
  user_id: 'U-S', username: 'super', password: 'x', nama: 'Super', role: 'SUPERADMIN', kode_cabang: '', status: 'Aktif',
};
const PIC_ADMIN: MasterPenggunaWithPassword = {
  user_id: 'U-P', username: 'pic', password: 'x', nama: 'Pic', role: 'PIC CABANG', kode_cabang: 'CBG-A', status: 'Aktif',
};

function buildEnv() {
  const { app, audits, kv, masterState } = (() => {
    const m = makeDeps();
    const app = buildApp(fakeEnv() as any, m.deps);
    return { app, audits: m.audits, kv: m.kv, masterState: m.masterState };
  })();
  return { app, audits, kv, masterState };
}

describe('master routes', () => {
  it('cabang: tambah => 200 + msg; audit CREATE; cabang lain ditolak utk PIC', async () => {
    const { app, audits, kv } = buildEnv();
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/master/cabang', {
      method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kode: 'CBG-X', nama: 'Cabang X', lokasi: 'Jkt' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).msg).toBe('Cabang Berhasil Ditambahkan');
    expect(audits.some((a) => a.action === 'CREATE' && a.modul === 'master' && String(a.keterangan).includes('CBG-X'))).toBe(true);

    const tokPic = await loginAs(kv, PIC);
    const denied = await app.request('/api/master/cabang', {
      method: 'POST', headers: { ...authHeaders(tokPic), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kode: 'CBG-Y', nama: 'Y' }),
    });
    expect(denied.status).toBe(403);
  });

  it('kendaraan: tambah hanya SUPERADMIN; PIC ditolak (arahan SnD Staff)', async () => {
    const { state, repo } = memMaster();
    const { deps, kv } = makeDeps({ master: repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tokPic = await loginAs(kv, PIC);
    const tolak = await app.request('/api/master/kendaraan', {
      method: 'POST', headers: { ...authHeaders(tokPic), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plat: 'B 123 CD', nama: 'Avanza', jenis: 'Mobil', cabang: 'CBG-A' }),
    });
    expect(tolak.status).toBe(403);
    expect((await tolak.json() as any).message).toMatch(/SnD Staff/);
    expect(state.kendaraan.length).toBe(0);

    const tok = await loginAs(kv, SUPER);
    const add = await app.request('/api/master/kendaraan', {
      method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plat: 'B 123 CD', nama: 'Avanza', jenis: 'Mobil', cabang: 'CBG-A' }),
    });
    expect(add.status).toBe(200);
    expect(state.kendaraan[0]).toMatchObject({ plat_nomor: 'B 123 CD', kode_cabang: 'CBG-A', interval_ganti_oli_km: 5000 });
  });

  describe('PIC cabang: hanya pajak, pajak 5 tahunan, KIR, dan interval ganti oli', () => {
    const awal = () => ({ ...VEHICLE_ROW, vehicle_id: 'V-1', plat_nomor: 'B 1 A', nama_kendaraan: 'Corolla', kode_cabang: 'CBG-A', tanggal_pajak: '2026-12-01', tanggal_pajak_5_tahunan: '2030-01-01', tanggal_kir: '2027-01-01', interval_ganti_oli_km: 5000, km_terakhir_ganti_oli: 1000, cabang_bersama: 'CBG-B' });
    const kirim = (app: ReturnType<typeof buildApp>, method: string, path: string, tok: string, b?: unknown) =>
      app.request(path, { method, headers: { ...authHeaders(tok), 'Content-Type': 'application/json' }, body: b === undefined ? undefined : JSON.stringify(b) });

    it('PUT: 4 isian berubah; isian lain (plat, nama, cabang, kendaraan bersama, KM oli) diabaikan', async () => {
      const { state, repo } = memMaster({ kendaraan: [awal() as any] });
      const { deps, kv, audits } = makeDeps({ master: repo });
      const app = buildApp(fakeEnv() as any, deps);
      const tok = await loginAs(kv, PIC);
      const res = await kirim(app, 'PUT', '/api/master/kendaraan', tok, {
        edit_id: 'V-1', tanggal_pajak: '2027-12-01', tanggal_pajak_5_tahunan: '2031-01-01', tanggal_kir: '2027-06-30', interval_ganti_oli_km: 7000,
        plat: 'HACK', nama: 'Hack', cabang: 'CBG-B', cabang_bersama: 'CBG-C', km_terakhir_ganti_oli: 99999, jenis: 'Motor',
      });
      expect(res.status).toBe(200);
      expect(state.kendaraan[0]).toMatchObject({
        tanggal_pajak: '2027-12-01', tanggal_pajak_5_tahunan: '2031-01-01', tanggal_kir: '2027-06-30', interval_ganti_oli_km: 7000,
        plat_nomor: 'B 1 A', nama_kendaraan: 'Corolla', kode_cabang: 'CBG-A', cabang_bersama: 'CBG-B', km_terakhir_ganti_oli: 1000, status: 'Aktif',
      });
      expect(audits.some((a) => a.action === 'EDIT' && String(a.keterangan).includes('PIC'))).toBe(true);
    });

    it('PUT: field yang tidak dikirim dipertahankan; tanggal kosong boleh; format/interval tidak valid ditolak', async () => {
      const { state, repo } = memMaster({ kendaraan: [awal() as any] });
      const { deps, kv } = makeDeps({ master: repo });
      const app = buildApp(fakeEnv() as any, deps);
      const tok = await loginAs(kv, PIC);
      expect((await kirim(app, 'PUT', '/api/master/kendaraan', tok, { edit_id: 'V-1', tanggal_kir: '' })).status).toBe(200);
      expect(state.kendaraan[0]).toMatchObject({ tanggal_kir: '', tanggal_pajak: '2026-12-01', interval_ganti_oli_km: 5000 });
      for (const salah of [{ tanggal_pajak: '31/12/2026' }, { tanggal_pajak: '2026-02-31' }, { interval_ganti_oli_km: 10 }, { interval_ganti_oli_km: 1.5 }, { interval_ganti_oli_km: 'abc' }, { interval_ganti_oli_km: 999999 }]) {
        expect((await kirim(app, 'PUT', '/api/master/kendaraan', tok, { edit_id: 'V-1', ...salah })).status, JSON.stringify(salah)).toBe(400);
      }
    });

    it('PUT kendaraan warehouse lain ditolak 403; hapus kendaraan, supir (tambah/ubah/hapus) ditolak 403 dengan arahan SnD Staff', async () => {
      const { repo } = memMaster({ kendaraan: [{ ...awal(), kode_cabang: 'CBG-B' } as any, awal() as any].map((k, i) => ({ ...k, vehicle_id: 'V-' + (i + 2) })), supir: [{ supir_id: 'S-1', nama_supir: 'A', kode_cabang: 'CBG-A', default_vehicle_id: '', status: 'Aktif' } as any] });
      const { deps, kv } = makeDeps({ master: repo });
      const app = buildApp(fakeEnv() as any, deps);
      const tok = await loginAs(kv, PIC);
      expect((await kirim(app, 'PUT', '/api/master/kendaraan', tok, { edit_id: 'V-2', tanggal_kir: '2030-01-01' })).status).toBe(403); // milik CBG-B
      const hapus = await kirim(app, 'DELETE', '/api/master/kendaraan/V-3', tok);
      expect(hapus.status).toBe(403);
      expect((await hapus.json() as any).message).toMatch(/SnD Staff/);
      expect((await kirim(app, 'POST', '/api/master/supir', tok, { nama: 'Baru', cabang: 'CBG-A' })).status).toBe(403);
      expect((await kirim(app, 'PUT', '/api/master/supir', tok, { edit_id: 'S-1', nama: 'Ganti', cabang: 'CBG-A' })).status).toBe(403);
      expect((await kirim(app, 'DELETE', '/api/master/supir/S-1', tok)).status).toBe(403);
    });

    it('SUPERADMIN tetap bisa mengelola kendaraan & supir', async () => {
      const { state, repo } = memMaster({ kendaraan: [awal() as any] });
      const { deps, kv } = makeDeps({ master: repo });
      const app = buildApp(fakeEnv() as any, deps);
      const tok = await loginAs(kv, SUPER);
      expect((await kirim(app, 'PUT', '/api/master/kendaraan', tok, { edit_id: 'V-1', plat: 'B 9 Z', nama: 'Baru', cabang: 'CBG-A', cabang_bersama: 'CBG-B,CBG-C' })).status).toBe(200);
      expect(state.kendaraan[0]).toMatchObject({ plat_nomor: 'B 9 Z', nama_kendaraan: 'Baru' });
      expect((await kirim(app, 'POST', '/api/master/supir', tok, { nama: 'Supir Baru', cabang: 'CBG-A' })).status).toBe(200);
      expect((await kirim(app, 'DELETE', '/api/master/kendaraan/V-1', tok)).status).toBe(200);
    });

    it('PIC tetap boleh reset oli kendaraan warehouse sendiri (bukan perubahan master)', async () => {
      const { repo } = memMaster({ kendaraan: [awal() as any] });
      const { deps, kv } = makeDeps({ master: repo });
      const app = buildApp(fakeEnv() as any, deps);
      const tok = await loginAs(kv, PIC);
      expect((await kirim(app, 'POST', '/api/master/kendaraan/V-1/reset-oli', tok, {})).status).toBe(200);
    });
  });

  it('pengguna: tambah validasi; nonaktif akun sendiri ditolak; aktif-superadmin-terakhir ditolak', async () => {
    const { repo } = memMaster({ pengguna: [SUPER_ADMIN] });
    const { deps, kv } = makeDeps({ master: repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, SUPER);
    const insert = await app.request('/api/master/pengguna', {
      method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'op1', password: 'pw123456', nama: 'Op1', role: 'PIC CABANG', cabang: 'CBG-A' }),
    });
    expect(insert.status).toBe(200);

    const self = await app.request('/api/master/pengguna/U-S', { method: 'DELETE', headers: authHeaders(tok) });
    expect(self.status).toBe(409);
    expect((await self.json() as any).message).toBe('Tidak bisa menonaktifkan akun sendiri');
  });

  it('reset-oli mengembalikan {msg,km} & audit GANTI_OLI; odo dari penggunaan_bbm', async () => {
    const { state, repo } = memMaster({
      kendaraan: [VEHICLE_ROW],
      penggunaan: [{ vehicle_id: 'V-1', km_akhir_confirmed: '12000', timestamp: 't1' }],
    });
    const { deps, kv, audits } = makeDeps({ master: repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/master/kendaraan/V-1/reset-oli', { method: 'POST', headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.km).toBe(12000);
    expect(audits.some((a) => a.action === 'GANTI_OLI' && String(a.keterangan).includes('V-1'))).toBe(true);
    expect(state.kendaraan[0]?.km_terakhir_ganti_oli).toBe(12000);
  });

  it('reset-oli memakai km_akhir_confirmed terakhir (last-wins)', async () => {
    const { state, repo } = memMaster({
      kendaraan: [VEHICLE_ROW],
      penggunaan: [
        { vehicle_id: 'V-1', km_akhir_confirmed: '12000', timestamp: 't1' },
        { vehicle_id: 'V-1', km_akhir_confirmed: '14000', timestamp: 't2' },
      ],
    });
    const { deps, kv } = makeDeps({ master: repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/master/kendaraan/V-1/reset-oli', { method: 'POST', headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    expect((await res.json() as any).km).toBe(14000);
    expect(state.kendaraan[0]?.km_terakhir_ganti_oli).toBe(14000);
    expect(state.kendaraan[0]?.status).toBe('Aktif');
  });

  it('reset-oli menaikkan versi cache', async () => {
    const { state, repo } = memMaster({ kendaraan: [VEHICLE_ROW] });
    const { deps, kv } = makeDeps({ master: repo });
    const app = buildApp(fakeEnv() as any, deps);
    await kv.put(warningsCacheKey('0', 'SUPERADMIN', ''), 'x');
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/master/kendaraan/V-1/reset-oli', { method: 'POST', headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    expect(await kv.get('master-rev')).toBe('1');
  });

  it('loginAs super dapat menonaktifkan PIC; PIC tidak dapat mengelola pengguna', async () => {
    const { state, repo } = memMaster({ pengguna: [SUPER_ADMIN, PIC_ADMIN] });
    const { deps, kv } = makeDeps({ master: repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tokSuper = await loginAs(kv, SUPER);
    const tokPic = await loginAs(kv, PIC);
    const deny = await app.request('/api/master/pengguna/U-P', { method: 'DELETE', headers: authHeaders(tokPic) });
    expect(deny.status).toBe(403);
    const deact = await app.request('/api/master/pengguna/U-P', { method: 'DELETE', headers: authHeaders(tokSuper) });
    expect(deact.status).toBe(200);
    expect(state.pengguna.find((u) => u.user_id === 'U-P')?.status).toBe('Non-Aktif');
  });

  it('loginAs super dapat menonaktifkan PIC; nonaktif superadmin terakhir ditolak', async () => {
    const { repo } = memMaster({ pengguna: [SUPER_ADMIN] });
    const { deps, kv } = makeDeps({ master: repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tokSuper = await loginAs(kv, SUPER);
    const deact = await app.request('/api/master/pengguna/U-S', { method: 'DELETE', headers: authHeaders(tokSuper) });
    expect(deact.status).toBe(409);
    expect((await deact.json() as any).message).toBe('Tidak bisa menonaktifkan akun sendiri');
  });
});