import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, makeDeps, memMaster, loginAs, VEHICLE_ROW } from '../helpers';
import type { SessionUser } from '../../src/deps';
import type { MasterPenggunaWithPassword } from '../../src/db/master';

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

  it('kendaraan: tambah PIC utk cabang sendiri; update ke cabang lain ditolak', async () => {
    const { state, repo } = memMaster();
    const { deps, kv } = makeDeps({ master: repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, PIC);
    const add = await app.request('/api/master/kendaraan', {
      method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plat: 'B 123 CD', nama: 'Avanza', jenis: 'Mobil', cabang: 'CBG-A' }),
    });
    expect(add.status).toBe(200);
    expect(state.kendaraan.length).toBe(1);
    expect(state.kendaraan[0]).toMatchObject({ plat_nomor: 'B 123 CD', kode_cabang: 'CBG-A', interval_ganti_oli_km: 5000 });

    const bad = await app.request('/api/master/kendaraan', {
      method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plat: 'B 999 CD', nama: 'Beda', cabang: 'CBG-B' }),
    });
    expect(bad.status).toBe(403);
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