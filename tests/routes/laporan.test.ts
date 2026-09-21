import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, loginAs, laporanRow, makeDeps, memLaporan, memMaster, VEHICLE_ROW } from '../helpers';
import type { SessionUser } from '../../src/deps';
import type { FlazzCardRow, JalurRow } from '../../src/db/laporan';

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