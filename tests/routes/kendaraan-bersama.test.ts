import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, laporanRow, loginAs, makeDeps, memFlazz, memJalur, memLaporan, memMaster, VEHICLE_ROW } from '../helpers';
import type { SessionUser } from '../../src/deps';
import type { JalurFull } from '../../src/logic/jalur';
import { cabangPemakai, gabungKonteks, idBersamaUntuk, normalisasiCabangBersama } from '../../src/logic/kendaraan-bersama';

// Motor milik WHP (GDG) yang ikut dipakai WHO Cibaduyut (CBY).
const PIC_CBY: SessionUser = { user_id: 'U-C', username: 'cby', nama: 'Pic CBY', role: 'PIC CABANG', cabang: 'CBY', exp: 1e15 };
const PIC_GDG: SessionUser = { user_id: 'U-G', username: 'gdg', nama: 'Pic GDG', role: 'PIC CABANG', cabang: 'GDG', exp: 1e15 };
const PIC_LAIN: SessionUser = { user_id: 'U-L', username: 'lain', nama: 'Pic Lain', role: 'PIC CABANG', cabang: 'TSM', exp: 1e15 };
const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };

const jalur = (over: Partial<JalurFull> = {}): JalurFull => ({
  id: 'J-1', tanggal: '2026-10-08', driver_id: 'S-G', nama_driver: 'Supir GDG', driver2_id: '', nama_driver2: '',
  vehicle_id: 'V-M', plat_nomor: 'Z 3821 IF', nama_kendaraan: 'Yamaha Mio', jenis_kendaraan: 'Motor', rute_tujuan: 'Toko',
  kode_cabang: 'GDG', flazz_card_id: '', flazz_card_name: '', flazz_card_id_2: '', flazz_card_name_2: '',
  created_by: 'x', created_at: '2026-10-08T00:00:00.000Z', updated_at: '', is_deleted: '', status: 'BELUM_DIISI', laporan_id: '', ...over,
});

function setup(init: { jalur?: JalurFull[] } = {}) {
  const master = memMaster({
    cabang: ['GDG', 'CBY', 'TSM'].map((k) => ({ kode_cabang: k, nama_cabang: 'WH ' + k, lokasi: '', status: 'Aktif' })),
    kendaraan: [{ ...VEHICLE_ROW, vehicle_id: 'V-M', plat_nomor: 'Z 3821 IF', jenis_kendaraan: 'Motor', kode_cabang: 'GDG', cabang_bersama: 'CBY' }],
    supir: [
      { supir_id: 'S-G', nama_supir: 'Supir GDG', kode_cabang: 'GDG', default_vehicle_id: '', status: 'Aktif' },
      { supir_id: 'S-C', nama_supir: 'Supir CBY', kode_cabang: 'CBY', default_vehicle_id: '', status: 'Aktif' },
      { supir_id: 'S-T', nama_supir: 'Supir TSM', kode_cabang: 'TSM', default_vehicle_id: '', status: 'Aktif' },
    ],
  });
  const lap = memLaporan({ jalur: (init.jalur ?? []) as any });
  const jl = memJalur(lap.state.jalur);
  const { deps, kv } = makeDeps({ master: master.repo, laporan: lap.repo, jalur: jl.repo, flazz: memFlazz({}).repo });
  return { app: buildApp(fakeEnv() as any, deps), kv, master, rows: jl.rows as unknown as JalurFull[] };
}
const req = (app: ReturnType<typeof buildApp>, method: string, path: string, tok: string, body?: unknown) =>
  app.request(path, { method, headers: { ...authHeaders(tok), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('logika kendaraan bersama', () => {
  it('cabang pemakai, normalisasi, id bersama, gabung konteks', () => {
    expect(cabangPemakai({ kode_cabang: 'GDG', cabang_bersama: 'CBY, TSM,CBY' })).toEqual(['GDG', 'CBY', 'TSM']);
    expect(normalisasiCabangBersama(['CBY', 'GDG', 'XXX', 'CBY'], 'GDG', new Set(['GDG', 'CBY']))).toBe('CBY');
    const k = [{ vehicle_id: 'A', kode_cabang: 'GDG', cabang_bersama: 'CBY' }, { vehicle_id: 'B', kode_cabang: 'CBY', cabang_bersama: '' }];
    expect(idBersamaUntuk(k, 'CBY')).toEqual(['A']);
    expect(idBersamaUntuk(k, 'GDG')).toEqual(['A']);
    expect(gabungKonteks([{ transaction_id: 'T2', seq: 2 }], [{ transaction_id: 'T1', seq: 1 }, { transaction_id: 'T2', seq: 2 }]).map((r) => r.transaction_id)).toEqual(['T1', 'T2']);
  });
});

describe('kendaraan bersama di API', () => {
  it('master: PIC pemakai melihat kendaraan bersama, cabang lain tidak', async () => {
    const { app, kv } = setup();
    const v = async (u: SessionUser) => ((await (await req(app, 'GET', '/api/master', await loginAs(kv, u))).json()) as any).vehicles;
    expect((await v(PIC_CBY)).map((x: any) => [x.vehicle_id, x.cabang_bersama])).toEqual([['V-M', ['CBY']]]);
    expect(await v(PIC_LAIN)).toEqual([]);
  });

  it('jalur: PIC pemakai boleh, jalur distempel cabangnya; cabang lain ditolak', async () => {
    const { app, kv, rows } = setup();
    const res = await req(app, 'POST', '/api/jalur', await loginAs(kv, PIC_CBY), { tanggal: '2026-10-08', rows: [{ driver_id: 'S-C', vehicle_id: 'V-M', rute_tujuan: 'Toko' }] });
    expect(res.status).toBe(200);
    expect(rows[0]).toMatchObject({ vehicle_id: 'V-M', kode_cabang: 'CBY' });
    const lain = setup();
    const tolak = await req(lain.app, 'POST', '/api/jalur', await loginAs(lain.kv, PIC_LAIN), { tanggal: '2026-10-09', rows: [{ driver_id: 'S-T', vehicle_id: 'V-M', rute_tujuan: 'Toko' }] });
    expect(tolak.status).toBe(403);
  });

  it('jalur: kendaraan sedang dipakai cabang lain di tanggal sama -> 409', async () => {
    const { app, kv } = setup({ jalur: [jalur()] });
    const res = await req(app, 'POST', '/api/jalur', await loginAs(kv, PIC_CBY), { tanggal: '2026-10-08', rows: [{ driver_id: 'S-C', vehicle_id: 'V-M', rute_tujuan: 'Toko' }] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).message).toContain('sudah dijadwalkan warehouse GDG');
  });

  it('jalur SUPERADMIN untuk kendaraan bersama memakai cabang driver', async () => {
    const { app, kv, rows } = setup();
    expect((await req(app, 'POST', '/api/jalur', await loginAs(kv, SUPER), { tanggal: '2026-10-08', rows: [{ driver_id: 'S-C', vehicle_id: 'V-M', rute_tujuan: 'Toko' }] })).status).toBe(200);
    expect(rows[0]!.kode_cabang).toBe('CBY');
  });

  it('master PUT: cabang_bersama dinormalisasi; PIC pemakai ditolak; klien tanpa isian tidak menghapus', async () => {
    const { app, kv, master } = setup();
    const body = { edit_id: 'V-M', plat: 'Z 3821 IF', nama: 'Yamaha Mio', jenis: 'Motor', cabang: 'GDG' };
    expect((await req(app, 'PUT', '/api/master/kendaraan', await loginAs(kv, PIC_CBY), { ...body, cabang_bersama: [] })).status).toBe(403);
    expect((await req(app, 'PUT', '/api/master/kendaraan', await loginAs(kv, SUPER), { ...body, cabang_bersama: ['CBY', 'TSM', 'GDG', 'ZZZ'] })).status).toBe(200);
    expect(master.state.kendaraan[0]!.cabang_bersama).toBe('CBY,TSM');
    expect((await req(app, 'PUT', '/api/master/kendaraan', await loginAs(kv, PIC_GDG), body)).status).toBe(200);
    expect(master.state.kendaraan[0]!.cabang_bersama).toBe('CBY,TSM');
  });
});

describe('History kendaraan bersama', () => {
  it('PIC hanya melihat laporannya sendiri, selisih ODO dihitung dari laporan cabang lain', async () => {
    const master = memMaster({
      cabang: ['GDG', 'CBY'].map((k) => ({ kode_cabang: k, nama_cabang: 'WH ' + k, lokasi: '', status: 'Aktif' })),
      kendaraan: [{ ...VEHICLE_ROW, vehicle_id: 'V-M', plat_nomor: 'Z 3821 IF', kode_cabang: 'GDG', cabang_bersama: 'CBY' }],
    });
    const r = (id: string, cab: string, tgl: string, awal: string, akhir: string) => laporanRow({
      transaction_id: id, kode_cabang: cab, vehicle_id: 'V-M', plat_nomor: 'Z 3821 IF', tanggal: tgl, timestamp: tgl + 'T08:00:00.000Z',
      km_awal_confirmed: awal, km_akhir_confirmed: akhir,
    });
    // CBY 100-200, lalu GDG 200-300, lalu CBY 300-350: tanpa konteks GDG, CBY-2 terlihat "selisih 100 KM".
    const lap = memLaporan({ rows: [r('CBY-1', 'CBY', '2026-10-01', '100', '200'), r('GDG-1', 'GDG', '2026-10-02', '200', '300'), r('CBY-2', 'CBY', '2026-10-03', '300', '350')] });
    const { deps, kv } = makeDeps({ master: master.repo, laporan: lap.repo, flazz: memFlazz({}).repo });
    const app = buildApp(fakeEnv() as any, deps);
    const body = (await (await req(app, 'GET', '/api/dashboard', await loginAs(kv, PIC_CBY))).json()) as any;
    expect(body.transactions.map((t: any) => t.transaction_id)).toEqual(['CBY-2', 'CBY-1']);
    expect(body.transactions.every((t: any) => !t.warning)).toBe(true);
  });
});
