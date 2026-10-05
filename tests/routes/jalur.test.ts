import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, loginAs, makeDeps, memFlazz, memJalur, memLaporan, memMaster, VEHICLE_ROW } from '../helpers';
import type { SessionUser } from '../../src/deps';
import type { FlazzCardRow, FlazzUsageRow } from '../../src/db/flazz';
import type { JalurFull } from '../../src/logic/jalur';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic A', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

const kartu = (over: Partial<FlazzCardRow> = {}): FlazzCardRow => ({
  id: 'FLZ-A', card_number: '0145', card_name: 'Kartu A', card_type: 'FLAZZ', card_role: 'UTAMA',
  branch_id: 'CBG-A', driver_id: '', default_driver_id: '', last_balance: 500000,
  status: 'TERSEDIA', notes: '', created_at: '', updated_at: '', ...over,
});

const jalurRow = (over: Partial<JalurFull> = {}): JalurFull => ({
  id: 'J-1', tanggal: '2026-10-01', driver_id: 'S-1', nama_driver: 'Supir A', driver2_id: '', nama_driver2: '',
  vehicle_id: 'V-1', plat_nomor: 'B 1 A', nama_kendaraan: 'Corolla', jenis_kendaraan: 'Mobil', rute_tujuan: 'Gudang - Toko',
  kode_cabang: 'CBG-A', flazz_card_id: '', flazz_card_name: '', flazz_card_id_2: '', flazz_card_name_2: '',
  created_by: 'Pic A', created_at: '2026-10-01T00:00:00.000Z', updated_at: '', is_deleted: '', status: 'BELUM_DIISI', laporan_id: '',
  ...over,
});

function setup(init: { jalur?: JalurFull[]; cards?: FlazzCardRow[]; usage?: FlazzUsageRow[] } = {}) {
  const master = memMaster({
    cabang: [{ kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: '', status: 'Aktif' }],
    kendaraan: [
      { ...VEHICLE_ROW, tanggal_pajak: '2099-01-01' },
      { ...VEHICLE_ROW, vehicle_id: 'V-2', plat_nomor: 'B 2 B' },
      { ...VEHICLE_ROW, vehicle_id: 'V-9', plat_nomor: 'D 9 Z', kode_cabang: 'CBG-B' },
    ],
    supir: [
      { supir_id: 'S-1', nama_supir: 'Supir A', kode_cabang: 'CBG-A', default_vehicle_id: '', status: 'Aktif' },
      { supir_id: 'S-2', nama_supir: 'Supir B', kode_cabang: 'CBG-A', default_vehicle_id: '', status: 'Aktif' },
    ],
  });
  const lap = memLaporan({ jalur: (init.jalur ?? []) as any });
  const jalur = memJalur(lap.state.jalur);
  const flz = memFlazz({ cards: init.cards ?? [], usage: init.usage ?? [] });
  const { deps, kv, audits } = makeDeps({ master: master.repo, laporan: lap.repo, jalur: jalur.repo, flazz: flz.repo });
  const app = buildApp(fakeEnv() as any, deps);
  return { app, kv, audits, lap, flz, rows: jalur.rows as unknown as JalurFull[] };
}

const req = (app: ReturnType<typeof buildApp>, method: string, path: string, tok: string, body?: unknown) =>
  app.request(path, { method, headers: { ...authHeaders(tok), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const baris = (over: Record<string, unknown> = {}) => ({ driver_id: 'S-1', vehicle_id: 'V-1', rute_tujuan: 'Gudang - Toko', ...over });

describe('POST /api/jalur', () => {
  it('membuat jalur, nama dari master, status BELUM_DIISI, kartu diserahkan, audit', async () => {
    const { app, kv, rows, flz, audits } = setup({ cards: [kartu(), kartu({ id: 'FLZ-B', card_name: 'Kartu B' })] });
    const tok = await loginAs(kv, PIC);
    const res = await req(app, 'POST', '/api/jalur', tok, { tanggal: '2026-10-06', rows: [baris({ etoll_card_id: 'FLZ-A', etoll_card_id_2: 'FLZ-B', etoll_card_name: 'NAMA PALSU' })] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).msg).toBe('1 jadwal pengiriman berhasil disimpan.');
    expect(rows[0]).toMatchObject({
      tanggal: '2026-10-06', nama_driver: 'Supir A', plat_nomor: 'B 1 A', kode_cabang: 'CBG-A', status: 'BELUM_DIISI',
      flazz_card_id: 'FLZ-A', flazz_card_name: 'Kartu A', flazz_card_id_2: 'FLZ-B', flazz_card_name_2: 'Kartu B', created_by: 'Pic A',
    });
    expect(flz.state.usage.map((u) => [u.card_id, u.ref_type, u.ref_id])).toEqual([['FLZ-A', 'JALUR', rows[0]!.id], ['FLZ-B', 'JALUR', rows[0]!.id]]);
    expect(audits[0]).toMatchObject({ action: 'CREATE', modul: 'jalur' });
  });

  it('baris tidak lengkap dilewati; tanpa baris valid -> 400', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const res = await req(app, 'POST', '/api/jalur', tok, { tanggal: '2026-10-06', rows: [{ driver_id: 'S-1', vehicle_id: 'V-1', rute_tujuan: ' ' }] });
    expect(res.status).toBe(400);
  });

  it('kartu 1 dan 2 sama -> 400', async () => {
    const { app, kv } = setup({ cards: [kartu()] });
    const tok = await loginAs(kv, PIC);
    const res = await req(app, 'POST', '/api/jalur', tok, { tanggal: '2026-10-06', rows: [baris({ etoll_card_id: 'FLZ-A', etoll_card_id_2: 'FLZ-A' })] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as any).message).toBe('Kartu etoll ke-2 harus berbeda dari kartu etoll ke-1.');
  });

  it('PIC: kendaraan cabang lain -> 403', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const res = await req(app, 'POST', '/api/jalur', tok, { tanggal: '2026-10-06', rows: [baris({ vehicle_id: 'V-9' })] });
    expect(res.status).toBe(403);
    expect(((await res.json()) as any).message).toBe('Akses ditolak: kendaraan tidak berada di warehouse CBG-A.');
  });

  it('SUPERADMIN: kode_cabang diambil dari kendaraan', async () => {
    const { app, kv, rows } = setup();
    const tok = await loginAs(kv, SUPER);
    const res = await req(app, 'POST', '/api/jalur', tok, { tanggal: '2026-10-06', rows: [baris({ vehicle_id: 'V-9' })] });
    expect(res.status).toBe(200);
    expect(rows[0]!.kode_cabang).toBe('CBG-B');
  });

  it('gate: jalur sebelumnya tanpa kartu yang BELUM_DIISI memblokir dengan pesan input laporan', async () => {
    const { app, kv } = setup({ jalur: [jalurRow()] });
    const tok = await loginAs(kv, PIC);
    const res = await req(app, 'POST', '/api/jalur', tok, { tanggal: '2026-10-06', rows: [baris()] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).message).toBe('Jalur baru diblokir: Kendaraan B 1 A (jalur 2026-10-01, status BELUM_DIISI) masih belum selesai. Harap input laporan terlebih dahulu.');
  });

  it('gate: tanpa kartu cukup SUDAH_LAPORAN; dengan kartu (slot 2) harus SELESAI', async () => {
    const a = setup({ jalur: [jalurRow({ status: 'SUDAH_LAPORAN', laporan_id: 'TRX-1' })] });
    expect((await req(a.app, 'POST', '/api/jalur', await loginAs(a.kv, PIC), { tanggal: '2026-10-06', rows: [baris()] })).status).toBe(200);

    const b = setup({ jalur: [jalurRow({ status: 'SUDAH_LAPORAN', laporan_id: 'TRX-1', flazz_card_id_2: 'FLZ-B' })] });
    const res = await req(b.app, 'POST', '/api/jalur', await loginAs(b.kv, PIC), { tanggal: '2026-10-06', rows: [baris()] });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).message).toContain('Harap rekonsiliasi saldo flazz terlebih dahulu.');
  });

  it('kartu masih dipegang -> tetap tersimpan dengan warnings, usage tidak digandakan', async () => {
    const { app, kv, flz } = setup({
      cards: [kartu()],
      usage: [{ id: 'U-1', date: '', card_id: 'FLZ-A', driver_id: 'Lama', vehicle_id: 'V-2', usage_type: 'PRIMARY', primary_card_id: '', backup_card_id: '', reason: '', opening_balance: 0, used_at: '', returned_at: '', status: 'DIBERIKAN', created_by: '', created_at: '', ref_type: 'JALUR', ref_id: 'J-lama' }],
    });
    const tok = await loginAs(kv, PIC);
    const res = await req(app, 'POST', '/api/jalur', tok, { tanggal: '2026-10-06', rows: [baris({ etoll_card_id: 'FLZ-A' })] });
    expect(res.status).toBe(200);
    expect(((await res.json()) as any).warnings).toEqual(['Kartu etoll "Kartu A" masih dipakai (belum dikembalikan) untuk Supir A. Proses admin sebelumnya belum selesai.']);
    expect(flz.state.usage).toHaveLength(1);
  });
});

describe('PUT /api/jalur/:id', () => {
  it('kartu pindah slot tidak dikembalikan; kartu yang dilepas dikembalikan; kartu baru diserahkan', async () => {
    const usage = (card: string): FlazzUsageRow => ({ id: 'U-' + card, date: '', card_id: card, driver_id: 'Supir A', vehicle_id: 'V-1', usage_type: 'PRIMARY', primary_card_id: '', backup_card_id: '', reason: '', opening_balance: 0, used_at: '', returned_at: '', status: 'DIBERIKAN', created_by: '', created_at: '', ref_type: 'JALUR', ref_id: 'J-1' });
    const { app, kv, rows, flz } = setup({
      jalur: [jalurRow({ flazz_card_id: 'FLZ-A', flazz_card_id_2: 'FLZ-B' })],
      cards: [kartu(), kartu({ id: 'FLZ-B', card_name: 'Kartu B' }), kartu({ id: 'FLZ-C', card_name: 'Kartu C' })],
      usage: [usage('FLZ-A'), usage('FLZ-B')],
    });
    const tok = await loginAs(kv, PIC);
    const res = await req(app, 'PUT', '/api/jalur/J-1', tok, { etoll_card_id: 'FLZ-B', etoll_card_id_2: 'FLZ-C' });
    expect(res.status).toBe(200);
    expect(rows[0]).toMatchObject({ flazz_card_id: 'FLZ-B', flazz_card_name: 'Kartu B', flazz_card_id_2: 'FLZ-C' });
    const st = (id: string) => flz.state.usage.filter((u) => u.card_id === id).map((u) => u.status);
    expect(st('FLZ-A')).toEqual(['DIKEMBALIKAN']);
    expect(st('FLZ-B')).toEqual(['DIBERIKAN']);
    expect(st('FLZ-C')).toEqual(['DIBERIKAN']);
  });

  it('pindah ke kendaraan yang masih terblokir -> 409', async () => {
    const { app, kv } = setup({ jalur: [jalurRow({ id: 'J-2', tanggal: '2026-10-06' }), jalurRow({ id: 'J-blok', vehicle_id: 'V-2', plat_nomor: 'B 2 B', tanggal: '2026-10-02' })] });
    const tok = await loginAs(kv, PIC);
    const res = await req(app, 'PUT', '/api/jalur/J-2', tok, { vehicle_id: 'V-2' });
    expect(res.status).toBe(409);
    expect(((await res.json()) as any).message).toContain('sebelum memindahkan jalur ini ke kendaraan tersebut.');
  });

  it('driver tidak ada -> 400; jalur tidak ada -> 404', async () => {
    const { app, kv } = setup({ jalur: [jalurRow()] });
    const tok = await loginAs(kv, PIC);
    expect((await req(app, 'PUT', '/api/jalur/J-1', tok, { driver_id: 'S-X' })).status).toBe(400);
    expect((await req(app, 'PUT', '/api/jalur/J-X', tok, {})).status).toBe(404);
  });
});

describe('DELETE /api/jalur/:id', () => {
  it('menghapus baris dan mengembalikan semua kartu', async () => {
    const { app, kv, rows, flz } = setup({
      jalur: [jalurRow({ flazz_card_id: 'FLZ-A' })], cards: [kartu({ status: 'SEDANG_DIGUNAKAN' })],
      usage: [{ id: 'U-1', date: '', card_id: 'FLZ-A', driver_id: 'Supir A', vehicle_id: 'V-1', usage_type: 'PRIMARY', primary_card_id: '', backup_card_id: '', reason: '', opening_balance: 0, used_at: '', returned_at: '', status: 'DIBERIKAN', created_by: '', created_at: '', ref_type: 'JALUR', ref_id: 'J-1' }],
    });
    const tok = await loginAs(kv, PIC);
    const res = await req(app, 'DELETE', '/api/jalur/J-1', tok);
    expect(res.status).toBe(200);
    expect(rows).toHaveLength(0);
    expect(flz.state.usage[0]!.status).toBe('DIKEMBALIKAN');
  });
});

describe('GET /api/jalur dan /api/jalur/drivers', () => {
  it('daftar per rentang dengan status pajak, dibatasi cabang PIC', async () => {
    const { app, kv } = setup({ jalur: [jalurRow(), jalurRow({ id: 'J-B', kode_cabang: 'CBG-B' }), jalurRow({ id: 'J-luar', tanggal: '2026-09-01' })] });
    const tok = await loginAs(kv, PIC);
    const body = (await (await req(app, 'GET', '/api/jalur?tanggal=2026-10-01&tanggal_akhir=2026-10-31', tok)).json()) as any;
    expect(body.list.map((j: any) => j.id)).toEqual(['J-1']);
    expect(body.list[0]).toMatchObject({ status_pajak: 'AMAN', status_kir: 'TIDAK_ADA' });
  });

  it('drivers hanya jalur BELUM_DIISI pada tanggal itu', async () => {
    const { app, kv } = setup({ jalur: [jalurRow({ flazz_card_id_2: 'FLZ-B' }), jalurRow({ id: 'J-2', nama_driver: 'Supir B', status: 'SUDAH_LAPORAN' })] });
    const tok = await loginAs(kv, PIC);
    const body = (await (await req(app, 'GET', '/api/jalur/drivers?tanggal=2026-10-01', tok)).json()) as any;
    expect(body.list).toEqual([expect.objectContaining({ nama_driver: 'Supir A', vehicle_id: 'V-1', flazz_card_id_2: 'FLZ-B' })]);
  });

  it('tanpa token -> 401', async () => {
    const { app } = setup();
    expect((await app.request('/api/jalur?tanggal=2026-10-01')).status).toBe(401);
  });
});

describe('alur penuh: jalur -> laporan -> rekon dua kartu', () => {
  it('status naik BELUM_DIISI -> SUDAH_LAPORAN -> (rekon kartu 1) tetap -> (rekon kartu 2) SELESAI -> (hapus rekon) turun', async () => {
    const { app, kv, rows } = setup({ cards: [kartu(), kartu({ id: 'FLZ-B', card_name: 'Kartu B' })] });
    const tok = await loginAs(kv, PIC);
    await req(app, 'POST', '/api/jalur', tok, { tanggal: '2026-10-06', rows: [baris({ etoll_card_id: 'FLZ-A', etoll_card_id_2: 'FLZ-B' })] });

    const lap = await req(app, 'POST', '/api/laporan', tok, {
      vehicle_id: 'V-1', tanggal: '2026-10-06', nama_supir: 'Supir A', km_awal_confirmed: '1000', km_akhir_confirmed: '1100',
      bar_awal: '8', bar_akhir: '4', liter_bbm: 10, biaya_bbm: 100000, biaya_toll: 0, metode_pembayaran: 'TUNAI', serverData: { files: {} },
    });
    expect(lap.status).toBe(200);
    expect(rows[0]!.status).toBe('SUDAH_LAPORAN');

    const rekon = (card: string) => req(app, 'POST', '/api/flazz/reconciliation', tok, {
      card_id: card, date: '2026-10-06', opening_balance: 500000, total_topup: 0, total_bbm_flazz: 0, total_tol: 0, actual_balance: 500000,
    });
    expect((await rekon('FLZ-A')).status).toBe(200);
    expect(rows[0]!.status).toBe('SUDAH_LAPORAN');
    const r2 = (await (await rekon('FLZ-B')).json()) as any;
    expect(rows[0]!.status).toBe('SELESAI');

    expect((await req(app, 'DELETE', '/api/flazz/reconciliation/' + r2.reconciliation.id, tok)).status).toBe(200);
    expect(rows[0]!.status).toBe('SUDAH_LAPORAN');
  });
});
