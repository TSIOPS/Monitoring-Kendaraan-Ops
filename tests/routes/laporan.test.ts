import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, loginAs, laporanRow, makeDeps, memLaporan, memMaster, VEHICLE_ROW } from '../helpers';
import { periodKey } from '../../src/logic/laporan';
import { monthlyCacheKey, performaCacheKey } from '../../src/logic/master-cache';
import type { SessionUser } from '../../src/deps';
import type { FlazzCardRow, JalurRow, UsageRow } from '../../src/db/laporan';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

const flazzCard = (over: Partial<FlazzCardRow> = {}): FlazzCardRow => ({
  id: 'FLZ-1', card_number: '123', card_name: 'Kartu A', branch_id: 'CBG-A',
  driver_id: '', default_driver_id: 'D-1', last_balance: 500000, status: 'TERSEDIA', ...over,
});

const jalurRow = (over: Partial<JalurRow> = {}): JalurRow => ({
  id: 'J-1', tanggal: '2026-09-21', nama_driver: 'Supir A', vehicle_id: 'V-1',
  kode_cabang: 'CBG-A', status: 'BELUM_DIISI', laporan_id: '', ...over,
});

const saveBody = (over: Record<string, unknown> = {}) => ({
  vehicle_id: 'V-1', tanggal: '2026-09-21', nama_supir: 'Supir A',
  km_awal_confirmed: '1000', km_akhir_confirmed: '1100',
  km_awal_broken: false, km_akhir_broken: false, km_tanpa_estimasi: false,
  bar_awal: '8', bar_akhir: '4', liter_bbm: 10, biaya_bbm: 120000, biaya_toll: 0,
  metode_pembayaran: 'TUNAI', flazz_card_id: '', metode_toll: '', flazz_card_id_toll: '',
  serverData: { files: { odo_awal: 'https://x/storage/v1/object/public/foto/a.jpg', odo_akhir: '' }, km_awal: '1000', km_akhir: '1100' },
  ...over,
});

function setup(init: { jalur?: JalurRow[]; flazzCard?: FlazzCardRow[]; rows?: Parameters<typeof laporanRow>[0][] } = {}) {
  const master = memMaster({ cabang: [{ kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: '', status: 'Aktif' }], kendaraan: [VEHICLE_ROW] });
  const lap = memLaporan({
    jalur: init.jalur ?? [jalurRow()],
    flazzCard: init.flazzCard ?? [],
    rows: (init.rows ?? []).map((r) => laporanRow(r)),
  });
  const { deps, kv, audits, storage } = makeDeps({ master: master.repo, laporan: lap.repo });
  const app = buildApp(fakeEnv() as any, deps);
  return { app, kv, audits, master, lap, storage };
}

async function post(app: ReturnType<typeof buildApp>, path: string, token: string, body: unknown) {
  return app.request(path, { method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/laporan (save)', () => {
  it('happy path: insert baris, flip jalur, audit CREATE, invalidate cache', async () => {
    const { app, kv, audits, lap } = setup();
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(String(body.transaction_id)).toMatch(/^TRX-/);
    expect(lap.state.rows).toHaveLength(1);
    expect(lap.state.rows[0]).toMatchObject({ km_tempuh: 100, km_sumber: 'AKTUAL', kode_cabang: 'CBG-A', metode_pembayaran: 'TUNAI' });
    expect(lap.state.jalur[0]).toMatchObject({ status: 'SUDAH_LAPORAN', laporan_id: body.transaction_id });
    expect(audits[0]).toMatchObject({ action: 'CREATE', modul: 'transaksi', keterangan: 'TRX ' + body.transaction_id });
  });

  it('gate jalur 409 dengan pesan verbatim', async () => {
    const { app, kv } = setup({ jalur: [] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody());
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toBe('Anda harus membuat Jalur Pengiriman terlebih dahulu (status BELUM DIISI) untuk kendaraan dan supir ini pada tanggal tersebut sebelum menginput laporan harian.');
  });

  it('duplikat 409', async () => {
    const { app, kv } = setup({ rows: [{ tanggal: '2026-09-21', km_awal_confirmed: '1000', km_akhir_confirmed: '1100', liter_bbm: 10, biaya_bbm: 120000, biaya_toll: 0 }] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody());
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toContain('Laporan sudah pernah disimpan');
  });

  it('PIC lintas cabang 403', async () => {
    const { app, kv } = setup();
    const other: SessionUser = { ...PIC, cabang: 'CBG-B' };
    const tok = await loginAs(kv, other);
    const res = await post(app, '/api/laporan', tok, saveBody());
    expect(res.status).toBe(403);
    expect((await res.json() as any).message).toBe('Akses ditolak: Anda hanya dapat mengelola data warehouse CBG-B.');
  });

  it('odo rusak tanpa standar -> 400 pesan GAS', async () => {
    const master = memMaster({ kendaraan: [{ ...VEHICLE_ROW, standar_km_l: 0 }] });
    const lap = memLaporan({ jalur: [jalurRow()] });
    const { deps, kv } = makeDeps({ master: master.repo, laporan: lap.repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({ km_awal_broken: true }));
    expect(res.status).toBe(400);
    expect((await res.json() as any).message).toContain('Standar KM/L kendaraan belum diisi');
  });

  it('Flazz: potong saldo, create usage, bump master rev', async () => {
    const { app, kv, lap } = setup({ flazzCard: [flazzCard()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 120000 }));
    expect(res.status).toBe(200);
    expect(lap.state.flazzCard[0]!.last_balance).toBe(380000);
    expect(lap.state.flazzUsage).toHaveLength(1);
    expect(await kv.get('master-rev')).toBe('1');
  });

  it('Flazz saldo kurang -> 409, tidak ada baris tersimpan', async () => {
    const { app, kv, lap } = setup({ flazzCard: [flazzCard({ last_balance: 1000 })] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 120000 }));
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toContain('tidak mencukupi');
    expect(lap.state.rows).toHaveLength(0);
  });
});

describe('POST /api/laporan/photos', () => {
  it('mengunggah 2 foto dan mengembalikan URL + echo km', async () => {
    const { app, kv, storage } = setup();
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan/photos', tok, {
      foto_odo_awal: 'data:image/jpeg;base64,AAAA',
      foto_odo_awal_name: 'a.jpg',
      foto_odo_akhir: 'data:image/png;base64,BBBB',
      foto_odo_akhir_name: 'b.png',
      km_awal_val: '1000', km_akhir_val: '1100',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.files.odo_awal).toContain('/object/public/foto/');
    expect(body.files.odo_akhir).toContain('/object/public/foto/');
    expect(body.km_awal).toBe(1000);
    expect(body.km_akhir).toBe(1100);
    expect(storage.files.size).toBe(2);
  });

  it('base64 tidak valid -> 422 pesan upload', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan/photos', tok, { foto_odo_awal: 'x', foto_odo_awal_name: 'a.jpg' });
    expect(res.status).toBe(422);
    expect((await res.json() as any).message).toContain('Upload foto KM awal gagal:');
  });
});

const PERIODE = periodKey(new Date());

function perfRows() {
  return Array.from({ length: 7 }, (_, i) => laporanRow({
    transaction_id: 'TRX-' + (i + 1),
    tanggal: `2026-09-${String(i + 1).padStart(2, '0')}`,
    timestamp: `2026-09-${String(i + 1).padStart(2, '0')}T01:00:00.000Z`,
    km_awal_confirmed: String(1000 + i * 100), km_akhir_confirmed: String(1100 + i * 100),
    km_tempuh: 100, liter_bbm: 10, bar_awal: '8', bar_akhir: '4',
  }));
}

describe('GET /api/laporan/prefill', () => {
  it('mengembalikan baris terakhir (resolusi tol & kartu)', async () => {
    const { app, kv } = setup({ rows: [
      { transaction_id: 'TRX-1', vehicle_id: 'V-1' },
      { transaction_id: 'TRX-2', vehicle_id: 'V-1', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ1', metode_toll: '', flazz_card_id_toll: '' },
    ], flazzCard: [flazzCard({ id: 'FLZ-1' })] });
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/laporan/prefill', { headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const pref = (await res.json() as any).pref;
    expect(pref.vehicle_id).toBe('V-1');
    expect(pref.metode_toll).toBe('FLAZZ');
    expect(pref.flazz_card_id).toBe('FLZ-1');
    expect(pref.flazz_card_id_toll).toBe('FLZ-1');
  });

  it('tanpa baris -> pref null', async () => {
    const { app, kv } = setup({ rows: [] });
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/laporan/prefill', { headers: authHeaders(tok) });
    expect((await res.json() as any).pref).toBeNull();
  });
});

describe('GET /api/laporan/performa', () => {
  it('window 7-trip + cache KV (state berubah tidak mengubah hasil kedua)', async () => {
    const { app, kv, lap } = setup({ rows: perfRows() });
    const tok = await loginAs(kv, PIC);
    const r1 = await app.request('/api/laporan/performa', { headers: authHeaders(tok) });
    const b1 = await r1.json() as any;
    expect(b1.items).toHaveLength(1);
    expect(b1.items[0].cabang).toBe('Cabang A');
    lap.state.rows.push(laporanRow({ transaction_id: 'TRX-X', tanggal: '2026-09-08' }));
    const r2 = await app.request('/api/laporan/performa', { headers: authHeaders(tok) });
    expect((await r2.json() as any).items).toHaveLength(1);
  });
});

describe('GET /api/dashboard', () => {
  it('transactions + monthly grouping periode berjalan', async () => {
    const rows = [
      laporanRow({ transaction_id: 'TRX-1', tanggal: PERIODE + '-05', liter_bbm: 10, biaya_bbm: 100000, biaya_toll: 5000 }),
      laporanRow({ transaction_id: 'TRX-2', tanggal: PERIODE + '-06', liter_bbm: 20, biaya_bbm: 200000, biaya_toll: 0 }),
    ];
    const { app, kv } = setup({ rows });
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/dashboard', { headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.transactions).toHaveLength(2);
    expect(body.monthly).toEqual([{
      cabang: 'CBG-A', periode: PERIODE, total_transaksi: 2,
      total_liter: 30, total_biaya_bbm: 300000, total_toll: 5000,
    }]);
  });

  it('PIC hanya melihat transaksi cabangnya', async () => {
    const { app, kv } = setup({ rows: [
      laporanRow({ transaction_id: 'TRX-A', kode_cabang: 'CBG-A', vehicle_id: 'V-1' }),
      laporanRow({ transaction_id: 'TRX-B', kode_cabang: 'CBG-B', vehicle_id: 'V-2', plat_nomor: 'B 2 B' }),
    ] });
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/dashboard', { headers: authHeaders(tok) });
    const body = await res.json() as any;
    expect(body.transactions.map((t: any) => t.transaction_id)).toEqual(['TRX-A']);
  });
});

async function put(app: ReturnType<typeof buildApp>, path: string, token: string, body: unknown) {
  return app.request(path, { method: 'PUT', headers: { ...authHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function del(app: ReturnType<typeof buildApp>, path: string, token: string) {
  return app.request(path, { method: 'DELETE', headers: authHeaders(token) });
}

describe('PUT /api/laporan/:id', () => {
  it('koreksi parsial biaya + KM, audit EDIT', async () => {
    const { app, kv, audits, lap } = setup({ rows: [{ transaction_id: 'TRX-1' }] });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { biaya_bbm: 90000, km_akhir: 1200 });
    expect(res.status).toBe(200);
    expect((await res.json() as any).msg).toBe('Transaksi BBM berhasil diperbarui.');
    expect(lap.state.rows[0]).toMatchObject({ biaya_bbm: 90000, km_akhir_confirmed: '1200', km_tempuh: 1100, km_sumber: 'AKTUAL' });
    expect(audits[0]).toMatchObject({ action: 'EDIT', modul: 'transaksi', keterangan: 'TRX-1' });
  });

  it('404 bila transaksi tidak ada', async () => {
    const { app, kv } = setup({ rows: [] });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-X', tok, { biaya_bbm: 1 });
    expect(res.status).toBe(404);
    expect((await res.json() as any).message).toBe('Transaksi tidak ditemukan.');
  });

  it('PIC lintas cabang 403 (cabang dari baris)', async () => {
    const master = memMaster({ cabang: [{ kode_cabang: 'CBG-B', nama_cabang: 'Cabang B', lokasi: '', status: 'Aktif' }], kendaraan: [{ ...VEHICLE_ROW, vehicle_id: 'V-2', kode_cabang: 'CBG-B' }] });
    const lap = memLaporan({ rows: [laporanRow({ transaction_id: 'TRX-1', vehicle_id: 'V-2', kode_cabang: 'CBG-B' })] });
    const { deps, kv } = makeDeps({ master: master.repo, laporan: lap.repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { biaya_bbm: 1 });
    expect(res.status).toBe(403);
    expect((await res.json() as any).message).toContain('transaksi warehouse');
  });

  it('TUNAI -> FLAZZ: potong saldo + create usage', async () => {
    const { app, kv, lap } = setup({ rows: [{ transaction_id: 'TRX-1', biaya_bbm: 120000 }], flazzCard: [flazzCard()] });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1' });
    expect(res.status).toBe(200);
    expect(lap.state.flazzCard[0]!.last_balance).toBe(380000);
    expect(lap.state.flazzUsage).toHaveLength(1);
  });

  it('saldo kurang -> 409 pesan koreksi', async () => {
    const { app, kv } = setup({ rows: [{ transaction_id: 'TRX-1' }], flazzCard: [flazzCard({ last_balance: 1000 })] });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1' });
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toContain('Saldo kartu tidak mencukupi untuk koreksi ini (sisa Rp 1.000).');
  });

  it('ganti foto: upload baru + hapus lama', async () => {
    const { app, kv, storage, lap } = setup({ rows: [{ transaction_id: 'TRX-1', foto_km_awal: 'http://x/storage/v1/object/public/foto/CBG-A/KM_Awal/old.jpg' }] });
    storage.files.set('CBG-A/KM_Awal/old.jpg', new Uint8Array([1]));
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { foto_odo_awal: 'data:image/jpeg;base64,AAAA', foto_odo_awal_name: 'new.jpg' });
    expect(res.status).toBe(200);
    expect(storage.files.has('CBG-A/KM_Awal/old.jpg')).toBe(false);
    expect(lap.state.rows[0]!.foto_km_awal).toContain('/object/public/foto/');
  });
});

describe('DELETE /api/laporan/:id', () => {
  const usage = (over: Partial<UsageRow> = {}): UsageRow => ({
    id: 'USE-1', date: '2026-09-01', card_id: 'FLZ-1', driver_id: 'Supir A', vehicle_id: 'V-1',
    usage_type: 'PRIMARY', primary_card_id: '', backup_card_id: '', reason: '', opening_balance: 380000,
    used_at: '2026-09-01T01:00:00.000Z', returned_at: '', status: 'DIBERIKAN', created_by: '',
    created_at: '2026-09-01T01:00:00.000Z', ref_type: 'TRX', ref_id: 'TRX-1', ...over,
  });

  it('refund saldo, return usage, release jalur, audit DELETE', async () => {
    const { app, kv, audits, lap } = setup({
      rows: [{ transaction_id: 'TRX-1', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 120000 }],
      flazzCard: [flazzCard({ last_balance: 380000, status: 'SEDANG_DIGUNAKAN', driver_id: 'Supir A' })],
      jalur: [jalurRow({ status: 'SUDAH_LAPORAN', laporan_id: 'TRX-1' })],
    });
    lap.state.flazzUsage.push(usage());
    const tok = await loginAs(kv, PIC);
    const res = await del(app, '/api/laporan/TRX-1', tok);
    expect(res.status).toBe(200);
    expect((await res.json() as any).msg).toBe('Transaksi BBM dihapus.');
    expect(lap.state.rows).toHaveLength(0);
    expect(lap.state.flazzCard[0]!.last_balance).toBe(500000);
    expect(lap.state.flazzCard[0]!.status).toBe('TERSEDIA');
    expect(lap.state.flazzUsage[0]!.status).toBe('DIKEMBALIKAN');
    expect(lap.state.jalur[0]).toMatchObject({ status: 'BELUM_DIISI', laporan_id: '' });
    expect(audits[0]).toMatchObject({ action: 'DELETE', modul: 'transaksi' });
  });

  it('404 bila tidak ada', async () => {
    const { app, kv } = setup({ rows: [] });
    const tok = await loginAs(kv, PIC);
    const res = await del(app, '/api/laporan/TRX-X', tok);
    expect(res.status).toBe(404);
  });
});

describe('lintas-cutting', () => {
  it('save menghapus cache performa & monthly (scope PIC + SUPERADMIN)', async () => {
    const { app, kv } = setup();
    const keys = [
      performaCacheKey('PIC CABANG', 'CBG-A'), monthlyCacheKey('PIC CABANG', 'CBG-A'),
      performaCacheKey('SUPERADMIN', ''), monthlyCacheKey('SUPERADMIN', ''),
    ];
    for (const k of keys) await kv.put(k, 'x');
    const tok = await loginAs(kv, PIC);
    await post(app, '/api/laporan', tok, saveBody());
    for (const k of keys) expect(await kv.get(k)).toBeNull();
  });

  it('tol Flazz terpisah (BBM tunai): hanya kartu tol terpotong', async () => {
    const { app, kv, lap } = setup({ flazzCard: [flazzCard()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({
      biaya_bbm: 0, metode_pembayaran: 'TUNAI', flazz_card_id: '',
      metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-1', biaya_toll: 20000,
    }));
    expect(res.status).toBe(200);
    expect(lap.state.flazzCard[0]!.last_balance).toBe(480000);
    expect(lap.state.rows[0]).toMatchObject({ metode_pembayaran: '', metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-1' });
  });

  it('jalur berstatus SUDAH_LAPORAN -> 409 gate', async () => {
    const { app, kv } = setup({ jalur: [jalurRow({ status: 'SUDAH_LAPORAN', laporan_id: 'TRX-LAIN' })] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody());
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toContain('Jalur Pengiriman terlebih dahulu');
  });

  it('audit save memuat data_sesudah ringkas (<= 2000 char)', async () => {
    const { app, kv, audits } = setup();
    const tok = await loginAs(kv, PIC);
    await post(app, '/api/laporan', tok, saveBody());
    expect(String(audits[0]!.data_sesudah).length).toBeLessThanOrEqual(2000);
    expect(String(audits[0]!.data_sesudah)).toContain('CBG-A');
  });

  it('edit ber-Flazz menaikkan master rev', async () => {
    const { app, kv } = setup({ rows: [{ transaction_id: 'TRX-1', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 120000 }], flazzCard: [flazzCard()] });
    const tok = await loginAs(kv, PIC);
    await put(app, '/api/laporan/TRX-1', tok, { biaya_bbm: 100000 });
    expect(await kv.get('master-rev')).toBe('1');
  });

  it('dashboard monthly memakai cache: perubahan state tidak terlihat pada panggilan kedua', async () => {
    const { app, kv, lap } = setup({ rows: [laporanRow({ transaction_id: 'TRX-1', tanggal: PERIODE + '-05' })] });
    const tok = await loginAs(kv, PIC);
    const b1 = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(b1.monthly[0].total_transaksi).toBe(1);
    lap.state.rows.push(laporanRow({ transaction_id: 'TRX-2', tanggal: PERIODE + '-06' }));
    const b2 = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(b2.monthly[0].total_transaksi).toBe(1);
    expect(b2.transactions).toHaveLength(2);
  });

  it('tanpa token -> 401 pada /api/laporan dan /api/dashboard', async () => {
    const { app } = setup();
    expect((await app.request('/api/laporan/prefill')).status).toBe(401);
    expect((await app.request('/api/dashboard')).status).toBe(401);
  });
});