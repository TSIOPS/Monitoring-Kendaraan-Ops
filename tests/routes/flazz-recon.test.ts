import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, laporanRow, loginAs, makeDeps, memFlazz, memJalur, memLaporan, memMaster, VEHICLE_ROW } from '../helpers';
import type { SessionUser } from '../../src/deps';
import type { FlazzCardRow, FlazzReconciliationRow, FlazzTopupRow, FlazzUsageRow } from '../../src/db/flazz';
import type { LaporanRow } from '../../src/logic/laporan';

// Rekonsiliasi model GAS (spec M9). Skenario dasar: kartu A diserahkan 1 Okt dengan
// saldo awal 500.000, lalu top up 100.000 dan laporan BBM 150.000 + tol 20.000.

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic A', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

const kartu = (over: Partial<FlazzCardRow> = {}): FlazzCardRow => ({
  id: 'FLZ-A', card_number: '0145', card_name: 'Kartu A', card_type: 'FLAZZ', card_role: 'UTAMA', branch_id: 'CBG-A',
  driver_id: 'Supir A', default_driver_id: 'S-DEF', last_balance: 430000, status: 'SEDANG_DIGUNAKAN', notes: '',
  created_at: '', updated_at: '', ...over,
});
const usage = (over: Partial<FlazzUsageRow> = {}): FlazzUsageRow => ({
  id: 'USE-1', date: '2026-10-01T00:00:00.000Z', card_id: 'FLZ-A', driver_id: 'Supir A', vehicle_id: 'V-1', usage_type: 'PRIMARY',
  primary_card_id: '', backup_card_id: '', reason: '', opening_balance: 500000, used_at: '2026-10-01T00:00:00.000Z',
  returned_at: '', status: 'DIBERIKAN', created_by: '', created_at: '', ref_type: 'TRX', ref_id: 'TRX-1', ...over,
});
const topup = (over: Partial<FlazzTopupRow> = {}): FlazzTopupRow => ({
  id: 'TOP-1', date: '2026-10-02', card_id: 'FLZ-A', amount: 100000, evidence_url: '', notes: '', created_by: 'pic',
  created_at: '2026-10-02T01:00:00.000Z', is_deleted: '', ...over,
});
const lapFlazz = (over: Partial<LaporanRow> = {}) => ({
  transaction_id: 'TRX-1', timestamp: '2026-10-02T02:00:00.000Z', tanggal: '2026-10-02',
  metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-A', biaya_bbm: 150000, metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-A', biaya_toll: 20000,
  foto_km_awal: 'https://x/a.jpg', foto_km_akhir: 'https://x/b.jpg', km_awal_confirmed: '100', km_akhir_confirmed: '200', ...over,
});

function setup(init: { cards?: FlazzCardRow[]; usage?: FlazzUsageRow[]; topups?: FlazzTopupRow[]; rows?: Partial<LaporanRow>[]; recons?: FlazzReconciliationRow[]; jalur?: any[] } = {}) {
  const master = memMaster({ cabang: [{ kode_cabang: 'CBG-A', nama_cabang: 'A', lokasi: '', status: 'Aktif' }], kendaraan: [VEHICLE_ROW] });
  const lap = memLaporan({ rows: (init.rows ?? [lapFlazz()]).map((r) => laporanRow(r)), jalur: init.jalur ?? [] });
  const jalur = memJalur(lap.state.jalur);
  const flz = memFlazz({ cards: init.cards ?? [kartu()], usage: init.usage ?? [usage()], topups: init.topups ?? [topup()], reconciliations: init.recons ?? [] });
  const { deps, kv, audits } = makeDeps({ master: master.repo, laporan: lap.repo, jalur: jalur.repo, flazz: flz.repo });
  return { app: buildApp(fakeEnv() as any, deps), kv, audits, flz, lap };
}
const req = (app: ReturnType<typeof buildApp>, method: string, path: string, tok: string, body?: unknown) =>
  app.request(path, { method, headers: { ...authHeaders(tok), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const json = async (r: Response) => (await r.json()) as any;

describe('GET /api/flazz/reconciliation/preview', () => {
  it('saldo sistem dihitung server dari periode penyerahan + syarat terpenuhi', async () => {
    const { app, kv } = setup();
    const body = await json(await req(app, 'GET', '/api/flazz/reconciliation/preview?card_id=FLZ-A', await loginAs(kv, PIC)));
    expect(body).toMatchObject({
      eligible: true, reason: 'Laporan valid dengan foto KM awal & akhir terdeteksi.',
      opening_balance: 500000, total_topup: 100000, total_bbm_flazz: 150000, total_tol: 20000, flazz_balance: 430000,
      usage: { driver_id: 'Supir A', vehicle_id: 'V-1' },
    });
  });

  it('tanpa laporan berfoto -> tidak memenuhi syarat', async () => {
    const { app, kv } = setup({ rows: [lapFlazz({ foto_km_akhir: '' })] });
    const body = await json(await req(app, 'GET', '/api/flazz/reconciliation/preview?card_id=FLZ-A', await loginAs(kv, PIC)));
    expect(body).toMatchObject({ eligible: false, reason: 'Belum ada laporan valid dengan foto KM awal & akhir pada periode kartu ini.' });
  });

  it('kartu cabang lain -> 403', async () => {
    const { app, kv } = setup({ cards: [kartu({ branch_id: 'CBG-B' })] });
    expect((await req(app, 'GET', '/api/flazz/reconciliation/preview?card_id=FLZ-A', await loginAs(kv, PIC))).status).toBe(403);
  });
});

describe('POST /api/flazz/reconciliation (model GAS)', () => {
  it('SESUAI: saldo = fisik, kartu TERSEDIA ke supir default, penyerahan DIKEMBALIKAN', async () => {
    const { app, kv, flz } = setup();
    const res = await req(app, 'POST', '/api/flazz/reconciliation', await loginAs(kv, PIC), { card_id: 'FLZ-A', actual_balance: 430000 });
    expect(res.status).toBe(200);
    expect((await json(res)).msg).toBe('Rekonsiliasi disimpan. Status: SESUAI. Kartu tersedia kembali.');
    expect(flz.state.reconciliations[0]).toMatchObject({ reconciliation_status: 'SESUAI', flazz_balance: 430000, actual_balance: 430000, difference: 0, driver_id: 'Supir A', reconciled_by: 'Pic A' });
    expect(flz.state.cards[0]).toMatchObject({ last_balance: 430000, status: 'TERSEDIA', driver_id: 'S-DEF' });
    expect(flz.state.usage[0]).toMatchObject({ status: 'DIKEMBALIKAN' });
  });

  it('PERLU_PEMERIKSAAN + IGNORE (default): saldo kartu = saldo sistem', async () => {
    const { app, kv, flz } = setup();
    await req(app, 'POST', '/api/flazz/reconciliation', await loginAs(kv, PIC), { card_id: 'FLZ-A', actual_balance: 420000 });
    expect(flz.state.reconciliations[0]).toMatchObject({ reconciliation_status: 'PERLU_PEMERIKSAAN', difference: 10000 });
    expect(flz.state.cards[0]!.last_balance).toBe(430000);
  });

  it('PERLU_PEMERIKSAAN + ADJUST: saldo kartu = saldo fisik', async () => {
    const { app, kv, flz } = setup();
    await req(app, 'POST', '/api/flazz/reconciliation', await loginAs(kv, PIC), { card_id: 'FLZ-A', actual_balance: 420000, action: 'ADJUST' });
    expect(flz.state.cards[0]!.last_balance).toBe(420000);
  });

  it('syarat tidak terpenuhi -> 409, tidak ada yang berubah', async () => {
    const { app, kv, flz } = setup({ rows: [lapFlazz({ foto_km_awal: '' })] });
    const res = await req(app, 'POST', '/api/flazz/reconciliation', await loginAs(kv, PIC), { card_id: 'FLZ-A', actual_balance: 430000 });
    expect(res.status).toBe(409);
    expect((await json(res)).message).toBe('Rekonsiliasi diblokir: belum ada laporan valid dengan foto KM awal & akhir pada periode kartu. Harap input laporan dahulu.');
    expect(flz.state.reconciliations).toHaveLength(0);
    expect(flz.state.cards[0]!.status).toBe('SEDANG_DIGUNAKAN');
  });

  it('jalur kartu sudah dilaporkan meloloskan tanpa laporan berkartu', async () => {
    const { app, kv, flz } = setup({
      rows: [], usage: [usage({ ref_type: 'JALUR', ref_id: 'J-1' })],
      jalur: [{ id: 'J-1', tanggal: '2026-10-01', nama_driver: 'Supir A', vehicle_id: 'V-1', kode_cabang: 'CBG-A', status: 'SUDAH_LAPORAN', laporan_id: 'TRX-9', flazz_card_id: 'FLZ-A' }],
    });
    const res = await req(app, 'POST', '/api/flazz/reconciliation', await loginAs(kv, PIC), { card_id: 'FLZ-A', actual_balance: 600000 });
    expect(res.status).toBe(200);
    expect(flz.state.reconciliations[0]).toMatchObject({ opening_balance: 500000, flazz_balance: 600000, reconciliation_status: 'SESUAI' });
  });

  it('saldo fisik tidak valid -> 400', async () => {
    const { app, kv } = setup();
    expect((await req(app, 'POST', '/api/flazz/reconciliation', await loginAs(kv, PIC), { card_id: 'FLZ-A', actual_balance: -1 })).status).toBe(400);
  });

  it('endpoint M5 (PUT, apply, ignore) sudah tidak ada', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, SUPER);
    expect((await req(app, 'POST', '/api/flazz/reconciliation/REC-1/apply', tok, {})).status).toBe(404);
    expect((await req(app, 'PUT', '/api/flazz/reconciliation/REC-1', tok, {})).status).toBe(404);
  });
});

describe('DELETE /api/flazz/reconciliation/:id (model GAS)', () => {
  const rec = (over: Partial<FlazzReconciliationRow> = {}): FlazzReconciliationRow => ({
    id: 'REC-1', date: '2026-10-05', card_id: 'FLZ-A', driver_id: 'Supir A', vehicle_id: 'V-1', opening_balance: 500000,
    total_topup: 100000, total_bbm_flazz: 150000, total_tol: 20000, total_expense: 170000, flazz_balance: 430000,
    actual_balance: 430000, difference: 0, reconciliation_status: 'SESUAI', notes: '', reconciled_by: 'Pic A',
    reconciled_at: '2026-10-05T10:00:00.000Z', is_deleted: '', ...over,
  });
  const closed = usage({ status: 'DIKEMBALIKAN', returned_at: '2026-10-05T10:00:00.000Z' });

  it('PIC ditolak; SUPERADMIN membalik semua efek', async () => {
    const { app, kv, flz } = setup({ cards: [kartu({ status: 'TERSEDIA', last_balance: 430000, driver_id: 'S-DEF' })], usage: [closed], recons: [rec()] });
    expect((await req(app, 'DELETE', '/api/flazz/reconciliation/REC-1', await loginAs(kv, PIC))).status).toBe(403);
    const res = await req(app, 'DELETE', '/api/flazz/reconciliation/REC-1', await loginAs(kv, SUPER));
    expect(res.status).toBe(200);
    expect(flz.state.reconciliations[0]!.is_deleted).toBe('1');
    expect(flz.state.cards[0]).toMatchObject({ last_balance: 500000, status: 'SEDANG_DIGUNAKAN', driver_id: 'Supir A' });
    expect(flz.state.usage[0]).toMatchObject({ status: 'DIBERIKAN', returned_at: '' });
  });

  it('bukan rekon terakhir atau ada top up sesudahnya -> 409', async () => {
    const a = setup({ usage: [closed], recons: [rec(), rec({ id: 'REC-2', reconciled_at: '2026-10-06T00:00:00.000Z' })] });
    expect((await json(await req(a.app, 'DELETE', '/api/flazz/reconciliation/REC-1', await loginAs(a.kv, SUPER)))).message).toContain('TERAKHIR');
    const b = setup({ usage: [closed], recons: [rec()], topups: [topup({ created_at: '2026-10-05T11:00:00.000Z' })] });
    expect((await json(await req(b.app, 'DELETE', '/api/flazz/reconciliation/REC-1', await loginAs(b.kv, SUPER)))).message).toContain('Top Up baru');
  });
});

describe('GET /api/flazz/dashboard', () => {
  it('kartu cabang PIC + riwayat; BBM Flazz termasuk kartu ke-2; tol harian masuk tolHistory', async () => {
    const { app, kv } = setup({
      cards: [kartu(), kartu({ id: 'FLZ-B', card_name: 'Kartu B' }), kartu({ id: 'FLZ-X', branch_id: 'CBG-B' })],
      rows: [lapFlazz({ flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000 })],
    });
    const body = await json(await req(app, 'GET', '/api/flazz/dashboard', await loginAs(kv, PIC)));
    expect(body.cards.map((c: any) => c.id)).toEqual(['FLZ-A', 'FLZ-B']);
    expect(body.topups).toHaveLength(1);
    expect(body.usages).toHaveLength(1);
    expect(body.bbmFlazz.map((b: any) => [b.card_id, b.amount, b.toll_amount])).toEqual([['FLZ-A', 150000, 20000], ['FLZ-B', 500000, 0]]);
    expect(body.tolHistory).toEqual([expect.objectContaining({ card_id: 'FLZ-A', amount: 20000, source: 'DAILY' })]);
  });
});
