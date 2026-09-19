import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, loginAs, makeDeps, memMaster, VEHICLE_ROW } from '../helpers';
import type { SessionUser } from '../../src/deps';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

function seedState() {
  const { repo } = memMaster({
    cabang: [{ kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: 'Jkt', status: 'Aktif' }],
    kendaraan: [VEHICLE_ROW],
    bbm: [{ bbm_id: 'BBM-P', jenis_bbm: 'Pertalite', harga_per_liter: 10000, kode_cabang: '', status: 'Aktif' }],
  });
  return repo;
}

describe('GET /api/master', () => {
  it('SUPERADMIN menerima payload lengkap bentuk GAS', async () => {
    const { deps, kv } = makeDeps({ master: seedState() } as any);
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/master', { headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.vehicles[0]).toMatchObject({
      vehicle_id: 'V-1', plat_nomor: 'B 1 A', nama: 'Corolla', cabang: 'CBG-A', interval_ganti_oli_km: 5000,
    });
    expect(body.cabangList).toEqual([{ kode: 'CBG-A', nama: 'Cabang A' }]);
    expect(body.bbmList).toEqual([{ id: 'BBM-P', jenis: 'Pertalite', harga: 10000 }]);
    expect(body.penggunaList).toEqual([]);
  });

  it('PIC hanya melihat data cabangnya sendiri', async () => {
    const { deps, kv } = makeDeps({ master: seedState() } as any);
    const app = buildApp(fakeEnv() as any, deps);
    const tokP = await loginAs(kv, PIC);
    const resP = await app.request('/api/master', { headers: authHeaders(tokP) });
    expect(resP.status).toBe(200);
    const bp = await resP.json() as any;
    expect(bp.vehicles[0].cabang).toBe('CBG-A');
    expect(bp.cabangList).toEqual([{ kode: 'CBG-A', nama: 'Cabang A' }]);
  });

  it('tanpa token => 401', async () => {
    const { deps } = makeDeps({ master: seedState() } as any);
    const app = buildApp(fakeEnv() as any, deps);
    const res = await app.request('/api/master', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('cache KV dipakai: listAll hanya 1x utk 2 GET saat rev sama; write menaikkan rev => listAll lagi', async () => {
    const repo = seedState();
    let calls = 0;
    const counted: typeof repo = {
      ...repo,
      listAll: async () => {
        calls++;
        return repo.listAll();
      },
    };
    const { deps, kv } = makeDeps({ master: counted } as any);
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, SUPER);
    await app.request('/api/master', { headers: authHeaders(tok) });
    await app.request('/api/master', { headers: authHeaders(tok) });
    expect(calls).toBe(1);
    await app.request('/api/master/kendaraan', {
      method: 'POST',
      headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plat_nomor: 'B 9 Z', nama: 'Yaris', jenis: 'Mobil', cabang: 'CBG-A' }),
    });
    await app.request('/api/master', { headers: authHeaders(tok) });
    expect(calls).toBe(2);
  });
});
