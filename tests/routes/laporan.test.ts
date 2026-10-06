import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, loginAs, laporanRow, makeDeps, memFlazz, memLaporan, memMaster, VEHICLE_ROW } from '../helpers';
import { periodKey } from '../../src/logic/laporan';
import { monthlyCacheKey, performaCacheKey, warningsCacheKey } from '../../src/logic/master-cache';
import type { SessionUser } from '../../src/deps';
import type { JalurRow } from '../../src/db/laporan';
import type { FlazzCardRow, FlazzUsageRow } from '../../src/db/flazz';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

const flazzCard = (over: Partial<FlazzCardRow> = {}): FlazzCardRow => ({
  id: 'FLZ-1', card_number: '123', card_name: 'Kartu A', card_type: 'FLAZZ', card_role: 'UTAMA',
  branch_id: 'CBG-A', driver_id: '', default_driver_id: 'D-1', last_balance: 500000,
  status: 'TERSEDIA', notes: '', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  ...over,
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
    rows: (init.rows ?? []).map((r) => laporanRow(r)),
  });
  const flz = memFlazz({ cards: init.flazzCard ?? [] });
  const { deps, kv, audits, storage } = makeDeps({ master: master.repo, laporan: lap.repo, flazz: flz.repo });
  const app = buildApp(fakeEnv() as any, deps);
  return { app, kv, audits, master, lap, flz, storage };
}

function warnSetup(init: { kendaraan?: typeof VEHICLE_ROW[]; rows?: Parameters<typeof laporanRow>[0][] } = {}) {
  const master = memMaster({
    cabang: [
      { kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: '', status: 'Aktif' },
      { kode_cabang: 'CBG-B', nama_cabang: 'Cabang B', lokasi: '', status: 'Aktif' },
    ],
    kendaraan: init.kendaraan ?? [VEHICLE_ROW],
  });
  const lap = memLaporan({ rows: (init.rows ?? []).map((r) => laporanRow(r)) });
  const { deps, kv } = makeDeps({ master: master.repo, laporan: lap.repo });
  const app = buildApp(fakeEnv() as any, deps);
  return { app, kv, master, lap };
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
    const { app, kv, flz } = setup({ flazzCard: [flazzCard()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 120000 }));
    expect(res.status).toBe(200);
    expect(flz.state.cards[0]!.last_balance).toBe(380000);
    expect(flz.state.usage).toHaveLength(1);
    expect(await kv.get('master-rev')).toBe('1');
  });

  it('Flazz saldo kurang -> 409, tidak ada baris tersimpan', async () => {
    const { app, kv, lap, flz } = setup({ flazzCard: [flazzCard({ last_balance: 1000 })] });
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

  it('warnings: OLI PERHATIAN dari odo terakhir (sisa <= 50 km)', async () => {
    const { app, kv } = warnSetup({ rows: [{ transaction_id: 'TRX-1', km_akhir_confirmed: '14980' }] });
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/dashboard', { headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.warnings).toEqual([
      {
        kategori: 'OLI', severity: 'PERHATIAN', vehicle_id: 'V-1', plat_nomor: 'B 1 A',
        kode_cabang: 'CBG-A', nama_cabang: 'Cabang A',
        pesan: 'Sebentar lagi ganti oli - sisa 20 km',
        km_sekarang: 14980, km_target: 15000, sisa_km: 20,
      },
    ]);
  });

  it('warnings: OLI KRITIS saat odo melewati target', async () => {
    const { app, kv } = warnSetup({ rows: [{ transaction_id: 'TRX-1', km_akhir_confirmed: '15020' }] });
    const tok = await loginAs(kv, PIC);
    const body = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toMatchObject({ severity: 'KRITIS', pesan: 'Wajib ganti oli - sudah lewat 20 km', sisa_km: -20 });
  });

  it('warnings: kendaraan Non-Aktif & cabang lain tidak muncul (PIC scope)', async () => {
    const { app, kv } = warnSetup({
      kendaraan: [
        VEHICLE_ROW,
        { ...VEHICLE_ROW, vehicle_id: 'V-2', plat_nomor: 'B 2 B', kode_cabang: 'CBG-B', status: 'Aktif' },
        { ...VEHICLE_ROW, vehicle_id: 'V-3', plat_nomor: 'B 3 C', kode_cabang: 'CBG-A', status: 'Non-Aktif' },
      ],
      rows: [{ transaction_id: 'TRX-1', km_akhir_confirmed: '14980' }],
    });
    const tok = await loginAs(kv, PIC);
    const body = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(body.warnings.map((w: any) => w.vehicle_id)).toEqual(['V-1']);
  });

  it('warnings: SUPERADMIN melihat semua cabang (urut kode_cabang)', async () => {
    const { app, kv } = warnSetup({
      kendaraan: [
        VEHICLE_ROW,
        { ...VEHICLE_ROW, vehicle_id: 'V-2', plat_nomor: 'B 2 B', kode_cabang: 'CBG-B', status: 'Aktif' },
      ],
      rows: [
        { transaction_id: 'TRX-1', km_akhir_confirmed: '14980' },
        { transaction_id: 'TRX-2', kode_cabang: 'CBG-B', vehicle_id: 'V-2', km_akhir_confirmed: '14980' },
      ],
    });
    const tok = await loginAs(kv, SUPER);
    const body = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(body.warnings.map((w: any) => w.vehicle_id)).toEqual(['V-1', 'V-2']);
    expect(body.warnings[1]).toMatchObject({ kode_cabang: 'CBG-B', nama_cabang: 'Cabang B' });
  });

  it('warnings memakai cache: perubahan state tidak terlihat pada panggilan kedua', async () => {
    const { app, kv, lap } = warnSetup({ rows: [{ transaction_id: 'TRX-1', km_akhir_confirmed: '14980' }] });
    const tok = await loginAs(kv, PIC);
    const b1 = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(b1.warnings).toHaveLength(1);
    expect(b1.warnings[0].severity).toBe('PERHATIAN');
    expect(await kv.get(warningsCacheKey('PIC CABANG', 'CBG-A'), 'json')).not.toBeNull();
    lap.state.rows.push(laporanRow({ transaction_id: 'TRX-2', km_akhir_confirmed: '15020' }));
    const b2 = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(b2.warnings).toHaveLength(1);
    expect(b2.warnings[0].severity).toBe('PERHATIAN');
    expect(b2.transactions).toHaveLength(2);
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
    const { app, kv, flz } = setup({ rows: [{ transaction_id: 'TRX-1', biaya_bbm: 120000 }], flazzCard: [flazzCard()] });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1' });
    expect(res.status).toBe(200);
    expect(flz.state.cards[0]!.last_balance).toBe(380000);
    expect(flz.state.usage).toHaveLength(1);
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
  const usage = (over: Partial<FlazzUsageRow> = {}): FlazzUsageRow => ({
    id: 'USE-1', date: '2026-09-01', card_id: 'FLZ-1', driver_id: 'Supir A', vehicle_id: 'V-1',
    usage_type: 'PRIMARY', primary_card_id: '', backup_card_id: '', reason: '', opening_balance: 380000,
    used_at: '2026-09-01T01:00:00.000Z', returned_at: '', status: 'DIBERIKAN', created_by: '',
    created_at: '2026-09-01T01:00:00.000Z', ref_type: 'TRX', ref_id: 'TRX-1', ...over,
  });

  it('refund saldo, return usage, release jalur, audit DELETE', async () => {
    const { app, kv, audits, lap, flz } = setup({
      rows: [{ transaction_id: 'TRX-1', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 120000 }],
      flazzCard: [flazzCard({ last_balance: 380000, status: 'SEDANG_DIGUNAKAN', driver_id: 'Supir A' })],
      jalur: [jalurRow({ status: 'SUDAH_LAPORAN', laporan_id: 'TRX-1' })],
    });
    flz.state.usage.push(usage());
    const tok = await loginAs(kv, PIC);
    const res = await del(app, '/api/laporan/TRX-1', tok);
    expect(res.status).toBe(200);
    expect((await res.json() as any).msg).toBe('Transaksi BBM dihapus.');
    expect(lap.state.rows).toHaveLength(0);
    expect(flz.state.cards[0]!.last_balance).toBe(500000);
    expect(flz.state.cards[0]!.status).toBe('TERSEDIA');
    expect(flz.state.usage[0]!.status).toBe('DIKEMBALIKAN');
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

describe('DELETE /api/laporan/:id/flazz (detach)', () => {
  const usage = (over: Partial<FlazzUsageRow> = {}): FlazzUsageRow => ({
    id: 'USE-1', date: '2026-09-21', card_id: 'FLZ-1', driver_id: 'Supir A', vehicle_id: 'V-1',
    usage_type: 'PRIMARY', primary_card_id: '', backup_card_id: '', reason: '', opening_balance: 380000,
    used_at: '2026-09-21T01:00:00.000Z', returned_at: '', status: 'DIBERIKAN', created_by: '',
    created_at: '2026-09-21T01:00:00.000Z', ref_type: 'TRX', ref_id: 'TRX-1', ...over,
  });

  const flazzRow = (over: Record<string, unknown> = {}) => laporanRow({
    transaction_id: 'TRX-1', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 120000, ...over,
  });

  it('refund biaya_bbm, metode jadi TUNAI, kartu dikosongkan, field tol utuh', async () => {
    const { app, kv, audits, lap, flz } = setup({
      rows: [flazzRow({ metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-2', biaya_toll: 20000 })],
      flazzCard: [flazzCard({ last_balance: 380000 }), flazzCard({ id: 'FLZ-2', last_balance: 480000 })],
    });
    const tok = await loginAs(kv, PIC);
    const res = await del(app, '/api/laporan/TRX-1/flazz', tok);
    expect(res.status).toBe(200);
    expect(flz.state.cards[0]!.last_balance).toBe(500000);
    expect(lap.state.rows[0]).toMatchObject({ metode_pembayaran: 'TUNAI', flazz_card_id: '', metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-2' });
    expect(audits[0]).toMatchObject({ action: 'DETACH', modul: 'transaksi' });
    expect(await kv.get('master-rev')).toBe('1');
  });

  it('biaya nol -&gt; metode dikosongkan, bukan TUNAI', async () => {
    const { app, kv, lap, flz } = setup({ rows: [flazzRow({ biaya_bbm: 0 })], flazzCard: [flazzCard({ last_balance: 380000 })] });
    const tok = await loginAs(kv, PIC);
    expect((await del(app, '/api/laporan/TRX-1/flazz', tok)).status).toBe(200);
    expect(lap.state.rows[0]!.metode_pembayaran).toBe('');
    expect(flz.state.cards[0]!.last_balance).toBe(380000);
  });

  it('kartu sama untuk BBM dan tol -&gt; usage tetap DIBERIKAN', async () => {
    const { app, kv, flz } = setup({
      rows: [flazzRow({ metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-1', biaya_toll: 20000 })],
      flazzCard: [flazzCard({ last_balance: 260000, status: 'SEDANG_DIGUNAKAN', driver_id: 'Supir A' })],
    });
    flz.state.usage.push(usage({ opening_balance: 260000 }));
    const tok = await loginAs(kv, PIC);
    expect((await del(app, '/api/laporan/TRX-1/flazz', tok)).status).toBe(200);
    expect(flz.state.usage[0]!.status).toBe('DIBERIKAN');
    expect(flz.state.cards[0]!.status).toBe('SEDANG_DIGUNAKAN');
  });

  it('kartu tol berbeda -&gt; hanya usage kartu BBM yang dikembalikan', async () => {
    const { app, kv, flz } = setup({
      rows: [flazzRow({ metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-2', biaya_toll: 20000 })],
      flazzCard: [flazzCard({ last_balance: 380000, status: 'SEDANG_DIGUNAKAN' }), flazzCard({ id: 'FLZ-2', status: 'SEDANG_DIGUNAKAN' })],
    });
    flz.state.usage.push(usage());
    flz.state.usage.push(usage({ id: 'USE-2', card_id: 'FLZ-2' }));
    const tok = await loginAs(kv, PIC);
    expect((await del(app, '/api/laporan/TRX-1/flazz', tok)).status).toBe(200);
    expect(flz.state.usage[0]!.status).toBe('DIKEMBALIKAN');
    expect(flz.state.usage[1]!.status).toBe('DIBERIKAN');
    expect(flz.state.cards[1]!.status).toBe('SEDANG_DIGUNAKAN');
  });

  it('bukan Flazz -&gt; 409; laporan hilang -&gt; 404', async () => {
    const { app, kv } = setup({ rows: [laporanRow({ transaction_id: 'TRX-T', metode_pembayaran: 'TUNAI' })] });
    const tok = await loginAs(kv, PIC);
    expect((await del(app, '/api/laporan/TRX-T/flazz', tok)).status).toBe(409);
    expect((await del(app, '/api/laporan/TRX-X/flazz', tok)).status).toBe(404);
  });

  it('PIC cabang lain -&gt; 403', async () => {
    const { app, kv } = setup({
      rows: [flazzRow()],
      flazzCard: [flazzCard({ branch_id: 'CBG-B' })],
    });
    const tok = await loginAs(kv, PIC);
    expect((await del(app, '/api/laporan/TRX-1/flazz', tok)).status).toBe(403);
  });

  it('refund gagal -&gt; patch laporan dikembalikan', async () => {
    const { app, kv, lap, flz } = setup({ rows: [flazzRow()], flazzCard: [flazzCard({ last_balance: 380000 })] });
    flz.repo.adjustBalance = async () => { throw new Error('DB Injected refund failure'); };
    const tok = await loginAs(kv, PIC);
    expect((await del(app, '/api/laporan/TRX-1/flazz', tok)).status).toBe(500);
    expect(lap.state.rows[0]).toMatchObject({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1' });
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
    const { app, kv, lap, flz } = setup({ flazzCard: [flazzCard()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({
      biaya_bbm: 0, metode_pembayaran: 'TUNAI', flazz_card_id: '',
      metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-1', biaya_toll: 20000,
    }));
    expect(res.status).toBe(200);
    expect(flz.state.cards[0]!.last_balance).toBe(480000);
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

  it('save menghapus cache dashwarn (scope PIC + SUPERADMIN)', async () => {
    const { app, kv } = setup();
    const keys = [
      warningsCacheKey('PIC CABANG', 'CBG-A'),
      warningsCacheKey('SUPERADMIN', ''),
    ];
    for (const k of keys) await kv.put(k, 'x');
    const tok = await loginAs(kv, PIC);
    await post(app, '/api/laporan', tok, saveBody());
    for (const k of keys) expect(await kv.get(k)).toBeNull();
  });

  it('edit menghapus cache dashwarn', async () => {
    const { app, kv } = setup({ rows: [{ transaction_id: 'TRX-1' }] });
    const key = warningsCacheKey('PIC CABANG', 'CBG-A');
    await kv.put(key, 'x');
    const tok = await loginAs(kv, PIC);
    await put(app, '/api/laporan/TRX-1', tok, { biaya_bbm: 90000 });
    expect(await kv.get(key)).toBeNull();
  });

  it('delete menghapus cache dashwarn', async () => {
    const { app, kv } = setup({ rows: [{ transaction_id: 'TRX-1' }] });
    const key = warningsCacheKey('PIC CABANG', 'CBG-A');
    await kv.put(key, 'x');
    const tok = await loginAs(kv, PIC);
    await del(app, '/api/laporan/TRX-1', tok);
    expect(await kv.get(key)).toBeNull();
  });

  it('tanpa token -> 401 pada /api/laporan dan /api/dashboard', async () => {
    const { app } = setup();
    expect((await app.request('/api/laporan/prefill')).status).toBe(401);
    expect((await app.request('/api/dashboard')).status).toBe(401);
  });
});

describe('grup-2 (kartu kedua)', () => {
  const A = () => flazzCard({ id: 'FLZ-A', card_name: 'Kartu A', last_balance: 500000 });
  const B = () => flazzCard({ id: 'FLZ-B', card_name: 'Kartu B', last_balance: 600000 });
  const saldo = (flz: ReturnType<typeof setup>['flz'], id: string) => flz.state.cards.find((c) => c.id === id)!.last_balance;
  const getJson = async (app: ReturnType<typeof buildApp>, path: string, tok: string) =>
    (await app.request(path, { headers: authHeaders(tok) })).json() as Promise<any>;

  it('simpan: dua kartu terpotong, kolom grup-2 tersimpan, usage untuk kedua kartu', async () => {
    const { app, kv, lap, flz } = setup({ flazzCard: [A(), B()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({
      metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-A', biaya_bbm: 150000,
      flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000,
    }));
    expect(res.status).toBe(200);
    expect(saldo(flz, 'FLZ-A')).toBe(350000);
    expect(saldo(flz, 'FLZ-B')).toBe(100000);
    expect(lap.state.rows[0]).toMatchObject({ flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000, flazz_card_id_toll_2: '', biaya_toll_2: 0 });
    expect(flz.state.usage.map((u) => u.card_id).sort()).toEqual(['FLZ-A', 'FLZ-B']);
  });

  it('simpan: saldo kartu 2 kurang -> 409, tidak ada yang terpotong atau tersimpan', async () => {
    const { app, kv, lap, flz } = setup({ flazzCard: [A(), flazzCard({ id: 'FLZ-B', card_name: 'Kartu B', last_balance: 1000 })] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({
      metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-A', biaya_bbm: 150000,
      flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000,
    }));
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toContain('tidak mencukupi');
    expect(saldo(flz, 'FLZ-A')).toBe(500000);
    expect(lap.state.rows).toHaveLength(0);
  });

  it('simpan: kartu 2 tidak ada -> 409 dengan label kartu 2', async () => {
    const { app, kv } = setup({ flazzCard: [A()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({ flazz_card_id_toll_2: 'FLZ-X', biaya_toll_2: 5000 }));
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toContain('tol kartu 2');
  });

  it('simpan: nominal grup-2 tanpa kartu dicatat tunai, saldo tidak tersentuh', async () => {
    const { app, kv, lap, flz } = setup({ flazzCard: [A()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({ biaya_toll_2: 7000 }));
    expect(res.status).toBe(200);
    expect(lap.state.rows[0]).toMatchObject({ biaya_toll_2: 7000, flazz_card_id_toll_2: '' });
    expect(saldo(flz, 'FLZ-A')).toBe(500000);
  });

  it('simpan: nominal grup-2 berbeda bukan duplikat', async () => {
    const { app, kv } = setup({ rows: [{ tanggal: '2026-09-21', km_awal_confirmed: '1000', km_akhir_confirmed: '1100', liter_bbm: 10, biaya_bbm: 120000, biaya_toll: 0 }] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({ biaya_bbm_2: 1000 }));
    expect(res.status).toBe(200);
  });

  it('edit: field grup-2 dipertahankan bila tidak dikirim', async () => {
    const { app, kv, lap, flz } = setup({
      rows: [{ transaction_id: 'TRX-1', flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 40000 }],
      flazzCard: [B()],
    });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { biaya_bbm: 90000 });
    expect(res.status).toBe(200);
    expect(lap.state.rows[0]).toMatchObject({ flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 40000 });
    expect(saldo(flz, 'FLZ-B')).toBe(600000);
  });

  it('edit: pindah kartu grup-2 -> kartu lama dikembalikan, kartu baru dipotong', async () => {
    const { app, kv, lap, flz } = setup({
      rows: [{ transaction_id: 'TRX-1', flazz_card_id_2: 'FLZ-A', biaya_bbm_2: 40000 }],
      flazzCard: [A(), B()],
    });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { flazz_card_id_2: 'FLZ-B' });
    expect(res.status).toBe(200);
    expect(saldo(flz, 'FLZ-A')).toBe(540000);
    expect(saldo(flz, 'FLZ-B')).toBe(560000);
    expect(lap.state.rows[0]!.flazz_card_id_2).toBe('FLZ-B');
  });

  it('edit: kartu grup-2 tujuan tidak ada -> 400', async () => {
    const { app, kv } = setup({ rows: [{ transaction_id: 'TRX-1' }], flazzCard: [A()] });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { flazz_card_id_2: 'FLZ-X', biaya_bbm_2: 1000 });
    expect(res.status).toBe(400);
    expect((await res.json() as any).message).toBe('Kartu tujuan grup-2 tidak ditemukan.');
  });

  it('edit: KM/bar/liter diubah -> perubahan_bar dan km_per_liter dihitung ulang', async () => {
    const { app, kv, lap } = setup({ rows: [{ transaction_id: 'TRX-1', perubahan_bar: 4, km_per_liter: 99 }] });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { km_awal: 100, km_akhir: 300, bar_awal: 8, bar_akhir: 8, liter_bbm: 20 });
    expect(res.status).toBe(200);
    // Bar tidak berubah -> liter konsumsi = liter beli = 20; 200 km / 20 L = 10.
    expect(lap.state.rows[0]).toMatchObject({ perubahan_bar: 0, km_per_liter: 10, km_tempuh: 200 });
  });

  it('hapus: saldo kedua kartu kembali', async () => {
    const { app, kv, flz } = setup({
      rows: [{ transaction_id: 'TRX-1', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-A', biaya_bbm: 150000, flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000 }],
      flazzCard: [flazzCard({ id: 'FLZ-A', last_balance: 350000 }), flazzCard({ id: 'FLZ-B', last_balance: 100000 })],
    });
    const tok = await loginAs(kv, PIC);
    const res = await del(app, '/api/laporan/TRX-1', tok);
    expect(res.status).toBe(200);
    expect(saldo(flz, 'FLZ-A')).toBe(500000);
    expect(saldo(flz, 'FLZ-B')).toBe(600000);
  });

  it('lepas Flazz hanya grup-2: kartu 2 kosong, nominal tetap, saldo kembali, tol utuh', async () => {
    const { app, kv, lap, flz } = setup({
      rows: [{ transaction_id: 'TRX-1', biaya_bbm: 0, metode_pembayaran: '', flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000, biaya_toll_2: 3000 }],
      flazzCard: [flazzCard({ id: 'FLZ-B', last_balance: 100000 })],
    });
    const tok = await loginAs(kv, PIC);
    const res = await del(app, '/api/laporan/TRX-1/flazz', tok);
    expect(res.status).toBe(200);
    expect(lap.state.rows[0]).toMatchObject({ flazz_card_id_2: '', biaya_bbm_2: 500000, biaya_toll_2: 3000 });
    expect(saldo(flz, 'FLZ-B')).toBe(600000);
  });

  it('lepas Flazz kedua grup sekaligus', async () => {
    const { app, kv, lap, flz } = setup({
      rows: [{ transaction_id: 'TRX-1', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-A', biaya_bbm: 150000, flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000 }],
      flazzCard: [flazzCard({ id: 'FLZ-A', last_balance: 350000 }), flazzCard({ id: 'FLZ-B', last_balance: 100000 })],
    });
    const tok = await loginAs(kv, PIC);
    const res = await del(app, '/api/laporan/TRX-1/flazz', tok);
    expect(res.status).toBe(200);
    expect(lap.state.rows[0]).toMatchObject({ metode_pembayaran: 'TUNAI', flazz_card_id: '', flazz_card_id_2: '', biaya_bbm: 150000, biaya_bbm_2: 500000 });
    expect(saldo(flz, 'FLZ-A')).toBe(500000);
    expect(saldo(flz, 'FLZ-B')).toBe(600000);
  });

  it('dashboard dan prefill membawa grup-2; ringkasan bulanan memakai total', async () => {
    const tgl = new Date().toISOString().slice(0, 10);
    const { app, kv } = setup({
      rows: [{ transaction_id: 'TRX-1', tanggal: tgl, biaya_bbm: 150000, flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000, biaya_toll: 1000, biaya_toll_2: 2000 }],
      flazzCard: [B()],
    });
    const tok = await loginAs(kv, PIC);
    const dash = await getJson(app, '/api/dashboard', tok);
    expect(dash.transactions[0]).toMatchObject({ flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000, total_bbm: 650000, total_toll: 3000 });
    expect(dash.monthly[0]).toMatchObject({ total_biaya_bbm: 650000, total_toll: 3000 });
    const pre = await getJson(app, '/api/laporan/prefill', tok);
    expect(pre.pref).toMatchObject({ flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000 });
  });
});

describe('GET /api/laporan/:id', () => {
  it('mengembalikan satu transaksi bentuk daftar; cabang lain 403; tidak ada 404', async () => {
    const { app, kv } = setup({ rows: [{ transaction_id: 'TRX-LAMA', tanggal: '2026-01-02', km_awal_confirmed: '500', km_akhir_confirmed: '600' }, { transaction_id: 'TRX-B', kode_cabang: 'CBG-B' }] });
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/laporan/TRX-LAMA', { headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).transaksi).toMatchObject({ transaction_id: 'TRX-LAMA', tanggal: '02/01/2026', km_awal: 500, km_akhir: 600, supir: 'Supir A' });
    expect((await app.request('/api/laporan/TRX-B', { headers: authHeaders(tok) })).status).toBe(403);
    expect((await app.request('/api/laporan/TRX-X', { headers: authHeaders(tok) })).status).toBe(404);
  });
});

describe('GET /api/dashboard/warnings', () => {
  it('pajak/KIR, saldo kartu rendah, oli, odometer estimasi; PIC hanya cabangnya', async () => {
    const master = memMaster({
      cabang: [{ kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: '', status: 'Aktif' }],
      kendaraan: [
        { ...VEHICLE_ROW, tanggal_pajak: '2000-01-01', jenis_indikator: 'ANALOG_JARUM' },
        { ...VEHICLE_ROW, vehicle_id: 'V-9', plat_nomor: 'B 9 Z', kode_cabang: 'CBG-B', tanggal_pajak: '2000-01-01' },
      ],
    });
    const lap = memLaporan({ rows: [laporanRow({ transaction_id: 'TRX-1', km_akhir_confirmed: '14800', km_sumber: 'ESTIMASI' } as any)] });
    const flz = memFlazz({ cards: [flazzCard({ id: 'FLZ-1', last_balance: 20000 }), flazzCard({ id: 'FLZ-2', last_balance: 20000, branch_id: 'CBG-B' })] });
    const { deps, kv } = makeDeps({ master: master.repo, laporan: lap.repo, flazz: flz.repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/dashboard/warnings', { headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.pajakKIR.map((p: any) => p.vehicle_id)).toEqual(['V-1']);
    expect(body.saldo.map((c: any) => c.id)).toEqual(['FLZ-1']);
    expect(body.oli).toMatchObject([{ vehicle_id: 'V-1', status: 'WASPADA', sisa_km: 200 }]);
    expect(body.odoEstimasi.map((o: any) => o.vehicle_id)).toEqual(['V-1']);
  });
});

describe('GET /api/dashboard (filter History Laporan)', () => {
  const rows = [
    { transaction_id: 'TRX-A1', kode_cabang: 'CBG-A', vehicle_id: 'V-1', tanggal: '2026-09-01', seq: 1 },
    { transaction_id: 'TRX-A2', kode_cabang: 'CBG-A', vehicle_id: 'V-1', tanggal: '2026-09-15', seq: 2 },
    { transaction_id: 'TRX-A3', kode_cabang: 'CBG-A', vehicle_id: 'V-3', plat_nomor: 'B 3 C', tanggal: '2026-09-20', seq: 3 },
    { transaction_id: 'TRX-B1', kode_cabang: 'CBG-B', vehicle_id: 'V-2', plat_nomor: 'B 2 B', tanggal: '2026-09-10', seq: 4 },
  ];
  const ids = async (app: ReturnType<typeof buildApp>, tok: string, q: string) =>
    ((await (await app.request('/api/dashboard' + q, { headers: authHeaders(tok) })).json()) as any).transactions.map((t: any) => t.transaction_id);

  it('SUPERADMIN: warehouse, kendaraan, rentang tanggal', async () => {
    const { app, kv } = setup({ rows });
    const tok = await loginAs(kv, SUPER);
    expect(await ids(app, tok, '?cabang=CBG-B')).toEqual(['TRX-B1']);
    expect(await ids(app, tok, '?vehicle_id=V-1')).toEqual(['TRX-A2', 'TRX-A1']);
    expect(await ids(app, tok, '?dari=2026-09-10&sampai=2026-09-15')).toEqual(['TRX-A2', 'TRX-B1']);
  });

  it('PIC tidak bisa membuka warehouse lain lewat ?cabang=', async () => {
    const { app, kv } = setup({ rows });
    const tok = await loginAs(kv, PIC);
    expect(await ids(app, tok, '?cabang=CBG-B')).toEqual(['TRX-A3', 'TRX-A2', 'TRX-A1']);
    expect(await ids(app, tok, '?cabang=CBG-B&vehicle_id=V-2')).toEqual([]);
  });
});

describe('GET /api/laporan/rekap-pengeluaran', () => {
  const rows = [
    { transaction_id: 'TRX-A', kode_cabang: 'CBG-A', tanggal: '2026-10-02', metode_pembayaran: 'TUNAI', biaya_bbm: 100000, biaya_toll: 0 },
    { transaction_id: 'TRX-B', kode_cabang: 'CBG-B', vehicle_id: 'V-2', plat_nomor: 'B 2 B', tanggal: '2026-10-03', metode_pembayaran: 'TUNAI', biaya_bbm: 50000, biaya_toll: 0 },
  ];
  const rekap = async (app: ReturnType<typeof buildApp>, tok: string, q: string) =>
    app.request('/api/laporan/rekap-pengeluaran' + q, { headers: authHeaders(tok) });

  it('SUPERADMIN semua warehouse atau satu warehouse; PIC terkunci ke cabangnya', async () => {
    const { app, kv } = setup({ rows });
    const sup = await loginAs(kv, SUPER);
    const semua = await (await rekap(app, sup, '?dari=2026-10-01&sampai=2026-10-31')).json() as any;
    expect(semua.lines.map((l: any) => l.ref).sort()).toEqual(['TRX-A', 'TRX-B']);
    const b = await (await rekap(app, sup, '?dari=2026-10-01&sampai=2026-10-31&cabang=CBG-B')).json() as any;
    expect(b.lines.map((l: any) => l.ref)).toEqual(['TRX-B']);
    const pic = await loginAs(kv, PIC);
    const p = await (await rekap(app, pic, '?dari=2026-10-01&sampai=2026-10-31&cabang=CBG-B')).json() as any;
    expect(p.lines.map((l: any) => [l.ref, l.jenis, l.metode, l.amount])).toEqual([['TRX-A', 'BBM', 'TUNAI', 100000]]);
  });

  it('tanggal wajib dan berurutan', async () => {
    const { app, kv } = setup({ rows });
    const tok = await loginAs(kv, SUPER);
    expect((await rekap(app, tok, '')).status).toBe(400);
    expect((await rekap(app, tok, '?dari=2026-10-31&sampai=2026-10-01')).status).toBe(400);
  });
});

describe('driver kedua dari jalur', () => {
  it('POST menyimpan nama_supir_2 dari jalur yang tertaut, bukan dari klien', async () => {
    const { app, kv, lap } = setup({ jalur: [jalurRow({ nama_driver2: 'Supir B' } as any)] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({ nama_supir_2: 'Palsu' }));
    expect(res.status).toBe(200);
    expect(lap.state.rows.at(-1)!.nama_supir_2).toBe('Supir B');
    const dash = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(dash.transactions[0].supir_2).toBe('Supir B');
  });
});
