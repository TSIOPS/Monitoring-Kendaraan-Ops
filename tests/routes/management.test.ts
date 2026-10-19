// tests/routes/management.test.ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, laporanRow, loginAs, makeDeps, memFlazz, memJalur, memLaporan, memMaster, VEHICLE_ROW } from '../helpers';
import { bolehTulisManagement } from '../../src/auth/middleware';
import { tugasUntuk } from '../../src/routes/push';
import type { SessionUser } from '../../src/deps';
import type { FlazzCardRow } from '../../src/db/flazz';
import type { JalurFull } from '../../src/logic/jalur';

const MGR: SessionUser = { user_id: 'U-M', username: 'mgr', nama: 'Manajer', role: 'MANAGEMENT', cabang: '', exp: 1e15 };
const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic A', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

const CABANG = [
  { kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: '', status: 'Aktif' },
  { kode_cabang: 'CBG-B', nama_cabang: 'Cabang B', lokasi: '', status: 'Aktif' },
];

const kartu = (over: Partial<FlazzCardRow> = {}): FlazzCardRow => ({
  id: 'FLZ-A', card_number: '0145', card_name: 'Kartu A', card_type: 'FLAZZ', card_role: 'UTAMA',
  branch_id: 'CBG-A', driver_id: '', default_driver_id: '', last_balance: 500000,
  status: 'TERSEDIA', notes: '', created_at: '', updated_at: '', ...over,
});

// Salin bentuk lengkap jalurRow dari tests/routes/jalur.test.ts:17-24.
const jalurRow = (over: Partial<JalurFull> = {}): JalurFull => ({
  id: 'J-1', tanggal: '2026-10-01', driver_id: 'S-1', nama_driver: 'Supir A', driver2_id: '', nama_driver2: '',
  vehicle_id: 'V-1', plat_nomor: 'B 1 A', nama_kendaraan: 'Corolla', jenis_kendaraan: 'Mobil', rute_tujuan: 'Gudang - Toko',
  kode_cabang: 'CBG-A', flazz_card_id: '', flazz_card_name: '', flazz_card_id_2: '', flazz_card_name_2: '',
  created_by: 'Pic A', created_at: '2026-10-01T00:00:00.000Z', updated_at: '', is_deleted: '', status: 'BELUM_DIISI', laporan_id: '',
  ...over,
} as JalurFull);

export function setup() {
  const master = memMaster({
    cabang: CABANG,
    kendaraan: [VEHICLE_ROW, { ...VEHICLE_ROW, vehicle_id: 'V-9', plat_nomor: 'D 9 Z', kode_cabang: 'CBG-B' }],
    supir: [{ supir_id: 'S-1', nama_supir: 'Supir A', kode_cabang: 'CBG-A', default_vehicle_id: '', status: 'Aktif' }],
    pengguna: [{ user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', kode_cabang: '', status: 'Aktif', password: '' }],
  });
  const lap = memLaporan({
    rows: [laporanRow({ transaction_id: 'TRX-A' }), laporanRow({ transaction_id: 'TRX-B', kode_cabang: 'CBG-B', vehicle_id: 'V-9', plat_nomor: 'D 9 Z' })],
    jalur: [jalurRow(), jalurRow({ id: 'J-B', kode_cabang: 'CBG-B', vehicle_id: 'V-9' })] as any,
  });
  const jalur = memJalur(lap.state.jalur);
  const flz = memFlazz({ cards: [kartu(), kartu({ id: 'FLZ-B', card_number: '0999', branch_id: 'CBG-B' })] });
  const out = makeDeps({ master: master.repo, laporan: lap.repo, jalur: jalur.repo, flazz: flz.repo });
  const app = buildApp(fakeEnv() as any, out.deps);
  return { app, ...out, masterState: master.state };
}

const req = (app: ReturnType<typeof buildApp>, method: string, path: string, tok: string, body?: unknown) =>
  app.request(path, { method, headers: { ...authHeaders(tok), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('penjaga tulis MANAGEMENT', () => {
  const TULIS: Array<[string, string]> = [
    ['POST', '/api/master/kendaraan'],
    ['PUT', '/api/master/supir'],
    ['DELETE', '/api/jalur/J-1'],
    ['POST', '/api/laporan'],
    ['DELETE', '/api/laporan/TRX-A'],
    ['POST', '/api/flazz/topup'],
    ['PUT', '/api/settings'],
    ['POST', '/api/settings/reset-data'],
  ];
  for (const [method, path] of TULIS) {
    it(`${method} ${path} -> 403 dengan pesan read-only`, async () => {
      const { app, kv, audits } = setup();
      const res = await req(app, method, path, await loginAs(kv, MGR), {});
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ success: false, error: 'FORBIDDEN', message: 'Akses ditolak: akun MANAGEMENT hanya dapat melihat data.' });
      expect(audits).toEqual([]);
    });
  }

  it('daftar izin tidak diblokir penjaga (ganti password sendiri)', async () => {
    const { app, kv } = setup();
    // /api/password sendiri membalas 403 bila password lama salah — jadi yang dicek pesannya, bukan status.
    const res = await req(app, 'POST', '/api/password', await loginAs(kv, MGR), { lama: 'x', baru: 'y' });
    const body = await res.json() as any;
    expect(body.message ?? '').not.toContain('hanya dapat melihat data');
  });

  it('daftar izin: push/langganan dan push/berhenti tidak ditolak penjaga', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, MGR);
    for (const p of ['/api/push/langganan', '/api/push/berhenti', '/api/push/tes']) {
      const body = await (await req(app, 'POST', p, tok, {})).json() as any;
      expect(body.message ?? '').not.toContain('hanya dapat melihat data');
    }
  });

  it('GET tetap lolos', async () => {
    const { app, kv } = setup();
    const res = await req(app, 'GET', '/api/master', await loginAs(kv, MGR));
    expect(res.status).toBe(200);
  });

  it('SUPERADMIN dan PIC tidak terpengaruh penjaga', async () => {
    const { app, kv } = setup();
    for (const u of [SUPER, PIC]) {
      const body = await (await req(app, 'DELETE', '/api/laporan/TIDAK-ADA', await loginAs(kv, u))).json() as any;
      expect(body.message ?? '').not.toContain('hanya dapat melihat data');
    }
  });
});

describe('bolehTulisManagement', () => {
  it('metode baca selalu boleh (huruf kecil juga)', () => {
    expect(bolehTulisManagement('get', '/api/master')).toBe(true);
    expect(bolehTulisManagement('HEAD', '/api/x')).toBe(true);
    expect(bolehTulisManagement('OPTIONS', '/api/x')).toBe(true);
  });
  it('daftar izin tulis (termasuk garis miring akhir)', () => {
    expect(bolehTulisManagement('POST', '/api/password')).toBe(true);
    expect(bolehTulisManagement('POST', '/api/password/')).toBe(true);
    expect(bolehTulisManagement('POST', '/api/push/tes')).toBe(true);
  });
  it('selain daftar izin ditolak', () => {
    expect(bolehTulisManagement('POST', '/api/passwordX')).toBe(false);
    expect(bolehTulisManagement('POST', '/api/push/langganan/../x')).toBe(false);
    expect(bolehTulisManagement('POST', '/api/master')).toBe(false);
  });
});

describe('MANAGEMENT membaca laporan semua cabang', () => {
  it('GET /api/dashboard berisi transaksi semua cabang; ?cabang= menyaring', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, MGR);
    const semua = await (await req(app, 'GET', '/api/dashboard', tok)).json() as any;
    expect(semua.transactions.map((t: any) => t.transaction_id).sort()).toEqual(['TRX-A', 'TRX-B']);
    const b = await (await req(app, 'GET', '/api/dashboard?cabang=CBG-B', tok)).json() as any;
    expect(b.transactions.map((t: any) => t.transaction_id)).toEqual(['TRX-B']);
  });

  it('GET /api/laporan/:id cabang mana pun -> 200', async () => {
    const { app, kv } = setup();
    const res = await req(app, 'GET', '/api/laporan/TRX-B', await loginAs(kv, MGR));
    expect(res.status).toBe(200);
  });

  it('PIC tetap ditolak membaca laporan cabang lain', async () => {
    const { app, kv } = setup();
    const res = await req(app, 'GET', '/api/laporan/TRX-B', await loginAs(kv, PIC));
    expect(res.status).toBe(403);
  });

  it('rekap-pengeluaran memakai ?cabang= untuk MANAGEMENT', async () => {
    const { app, kv, deps } = setup();
    const dipanggil: string[] = [];
    const asli = deps.laporan.rowsBetween.bind(deps.laporan);
    deps.laporan.rowsBetween = async (cab, d, s) => { dipanggil.push(cab); return asli(cab, d, s); };
    const tok = await loginAs(kv, MGR);
    const res = await req(app, 'GET', '/api/laporan/rekap-pengeluaran?dari=2026-09-01&sampai=2026-09-30&cabang=CBG-B', tok);
    expect(res.status).toBe(200);
    expect(dipanggil).toEqual(['CBG-B']);
  });

  it('performa dan warnings mencakup semua cabang (rowsInScope dipanggil dengan cabang kosong)', async () => {
    const { app, kv, deps } = setup();
    const dipanggil: string[] = [];
    const asli = deps.laporan.rowsInScope.bind(deps.laporan);
    deps.laporan.rowsInScope = async (cab, lim) => { dipanggil.push(cab); return asli(cab, lim); };
    const tok = await loginAs(kv, MGR);
    expect((await req(app, 'GET', '/api/laporan/performa', tok)).status).toBe(200);
    expect((await req(app, 'GET', '/api/dashboard/warnings', tok)).status).toBe(200);
    expect(dipanggil.every((c) => c === '')).toBe(true);
    expect(dipanggil.length).toBeGreaterThan(0);
  });
});

describe('MANAGEMENT membaca Flazz, jalur, tugas semua cabang', () => {
  it('GET /api/flazz/card semua cabang, ?branch_id= menyaring, /card/:id cabang lain 200', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, MGR);
    const semua = await (await req(app, 'GET', '/api/flazz/card', tok)).json() as any;
    expect(semua.cards.map((k: any) => k.id).sort()).toEqual(['FLZ-A', 'FLZ-B']);
    const b = await (await req(app, 'GET', '/api/flazz/card?branch_id=CBG-B', tok)).json() as any;
    expect(b.cards.map((k: any) => k.id)).toEqual(['FLZ-B']);
    expect((await req(app, 'GET', '/api/flazz/card/FLZ-B', tok)).status).toBe(200);
  });

  it('GET /api/flazz/dashboard memuat kartu semua cabang', async () => {
    const { app, kv, deps } = setup();
    let filter: unknown = 'belum';
    const asli = deps.flazz.listCards.bind(deps.flazz);
    deps.flazz.listCards = async (f?: any) => { if (filter === 'belum') filter = f; return asli(f); };
    expect((await req(app, 'GET', '/api/flazz/dashboard', await loginAs(kv, MGR))).status).toBe(200);
    expect(filter).toBeUndefined();
  });

  it('PIC tetap ditolak membaca kartu cabang lain', async () => {
    const { app, kv } = setup();
    expect((await req(app, 'GET', '/api/flazz/card/FLZ-B', await loginAs(kv, PIC))).status).toBe(403);
  });

  it('topup, tol, reconciliation: MANAGEMENT 200 tanpa dan dengan ?branch_id=; PIC ?branch_id= cabang lain 403', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, MGR);
    for (const p of ['/api/flazz/topup', '/api/flazz/tol', '/api/flazz/reconciliation']) {
      expect((await req(app, 'GET', p, tok)).status).toBe(200);
      expect((await req(app, 'GET', p + '?branch_id=CBG-B', tok)).status).toBe(200);
      expect((await req(app, 'GET', p + '?branch_id=CBG-B', await loginAs(kv, PIC))).status).toBe(403);
    }
  });

  it('GET /api/flazz/reconciliation/preview kartu cabang lain tidak 403 untuk MANAGEMENT, 403 untuk PIC', async () => {
    const { app, kv } = setup();
    const m = await req(app, 'GET', '/api/flazz/reconciliation/preview?card_id=FLZ-B', await loginAs(kv, MGR));
    expect(m.status).not.toBe(403);
    expect(m.status).toBeLessThan(500);
    expect((await req(app, 'GET', '/api/flazz/reconciliation/preview?card_id=FLZ-B', await loginAs(kv, PIC))).status).toBe(403);
  });

  it('GET /api/jalur semua cabang; /api/jalur/:id cabang lain 200', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, MGR);
    const body = await (await req(app, 'GET', '/api/jalur?tanggal=2026-10-01&tanggal_akhir=2026-10-31', tok)).json() as any;
    expect(body.list.map((j: any) => j.id).sort()).toEqual(['J-1', 'J-B']);
    expect((await req(app, 'GET', '/api/jalur/J-B', tok)).status).toBe(200);
  });

  it('GET /api/jalur/drivers tidak kosong karena cakupan untuk MANAGEMENT', async () => {
    const { app, kv, deps } = setup();
    let cabangArg: unknown = 'belum';
    const asli = deps.jalur.listForDate.bind(deps.jalur);
    deps.jalur.listForDate = async (t: string, cab: string | null) => { cabangArg = cab; return asli(t, cab); };
    const res = await req(app, 'GET', '/api/jalur/drivers?tanggal=2026-10-01', await loginAs(kv, MGR));
    expect(res.status).toBe(200);
    expect(cabangArg).toBeNull();
  });

  it('tugasUntuk MANAGEMENT membaca semua cabang (cabang null)', async () => {
    const { deps } = setup();
    let cabangArg: unknown = 'belum';
    const asli = deps.jalur.listRange.bind(deps.jalur);
    deps.jalur.listRange = async (a: string, b: string, cab: string | null) => { cabangArg = cab; return asli(a, b, cab); };
    await tugasUntuk(deps, { role: 'MANAGEMENT', cabang: '' }, '2026-10-01');
    expect(cabangArg).toBeNull();
  });
});

describe('master untuk MANAGEMENT', () => {
  it('GET /api/master: semua cabang, kendaraan semua cabang, tanpa daftar pengguna', async () => {
    const { app, kv } = setup();
    const body = await (await req(app, 'GET', '/api/master', await loginAs(kv, MGR))).json() as any;
    expect(body.cabangList.map((c: any) => c.kode).sort()).toEqual(['CBG-A', 'CBG-B']);
    expect(body.vehicles.map((v: any) => v.vehicle_id).sort()).toEqual(['V-1', 'V-9']);
    expect(body.penggunaList).toEqual([]);
  });

  it('GET /api/audit dan /api/settings/reset-status tetap 403', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, MGR);
    expect((await req(app, 'GET', '/api/audit', tok)).status).toBe(403);
    expect((await req(app, 'GET', '/api/settings/reset-status', tok)).status).toBe(403);
  });

  it('SUPERADMIN membuat akun MANAGEMENT; cabang dikosongkan', async () => {
    const { app, kv, masterState } = setup();
    const tok = await loginAs(kv, SUPER);
    const res = await req(app, 'POST', '/api/master/pengguna', tok, { username: 'mgr', nama: 'Manajer', password: 'Rahasia#2026', role: 'MANAGEMENT', cabang: 'CBG-A' });
    expect(res.status).toBe(200);
    expect(masterState.pengguna.find((p) => p.username === 'mgr')).toMatchObject({ role: 'MANAGEMENT', kode_cabang: '' });
  });

  it('PUT pengguna ke MANAGEMENT tanpa cabang diterima', async () => {
    const { app, kv, masterState } = setup();
    const tok = await loginAs(kv, SUPER);
    await req(app, 'POST', '/api/master/pengguna', tok, { username: 'pic2', nama: 'Pic 2', password: 'Rahasia#2026', role: 'PIC CABANG', cabang: 'CBG-A' });
    const id = masterState.pengguna.find((p) => p.username === 'pic2')!.user_id;
    const res = await req(app, 'PUT', '/api/master/pengguna', tok, { user_id: id, username: 'pic2', nama: 'Pic 2', role: 'MANAGEMENT', cabang: '' });
    expect(res.status).toBe(200);
    expect(masterState.pengguna.find((p) => p.user_id === id)).toMatchObject({ role: 'MANAGEMENT', kode_cabang: '' });
  });

  it('role lain tetap ditolak', async () => {
    const { app, kv } = setup();
    const res = await req(app, 'POST', '/api/master/pengguna', await loginAs(kv, SUPER), { username: 'x', nama: 'X', password: 'Rahasia#2026', role: 'DIREKTUR', cabang: '' });
    expect(res.status).toBe(400);
  });

  it('SUPERADMIN aktif terakhir tidak bisa diturunkan ke MANAGEMENT (409)', async () => {
    const { app, kv } = setup();
    const res = await req(app, 'PUT', '/api/master/pengguna', await loginAs(kv, SUPER), { user_id: 'U-S', username: 'super', nama: 'Super', role: 'MANAGEMENT', cabang: '' });
    expect(res.status).toBe(409);
  });

  it('MANAGEMENT tidak boleh mengelola pengguna (403)', async () => {
    const { app, kv } = setup();
    const res = await req(app, 'POST', '/api/master/pengguna', await loginAs(kv, MGR), { username: 'y', nama: 'Y', password: 'Rahasia#2026', role: 'MANAGEMENT', cabang: '' });
    expect(res.status).toBe(403);
  });
});
