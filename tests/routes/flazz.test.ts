import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, loginAs, makeDeps, memFlazz, memMaster, VEHICLE_ROW } from '../helpers';
import type { SessionUser } from '../../src/deps';
import type { FlazzCardRow, FlazzReconciliationRow, FlazzTolRow, FlazzTopupRow } from '../../src/db/flazz';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

const CABANG = [
  { kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: '', status: 'Aktif' },
  { kode_cabang: 'CBG-B', nama_cabang: 'Cabang B', lokasi: '', status: 'Aktif' },
];

const card = (over: Partial<FlazzCardRow> = {}): FlazzCardRow => ({
  id: 'FLZ-1', card_number: '123', card_name: 'Kartu A', card_type: 'FLAZZ', card_role: 'UTAMA',
  branch_id: 'CBG-A', driver_id: '', default_driver_id: 'S-1', last_balance: 500000,
  status: 'TERSEDIA', notes: '', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z',
  ...over,
});

const topup = (over: Partial<FlazzTopupRow> = {}): FlazzTopupRow => ({
  id: 'TOP-1', date: '2026-09-01', card_id: 'FLZ-1', amount: 100000, evidence_url: '',
  notes: '', created_by: 'pic', created_at: '2026-01-01T00:00:00.000Z', is_deleted: '0', ...over,
});

const tol = (over: Partial<FlazzTolRow> = {}): FlazzTolRow => ({
  id: 'TOL-1', date: '2026-09-01', card_id: 'FLZ-1', driver_id: '', vehicle_id: '',
  amount: 20000, evidence_url: '', notes: '', created_by: 'pic',
  created_at: '2026-01-01T00:00:00.000Z', is_deleted: '0', ...over,
});

const recon = (over: Partial<FlazzReconciliationRow> = {}): FlazzReconciliationRow => ({
  id: 'REC-1', date: '2026-09-01', card_id: 'FLZ-1', driver_id: '', vehicle_id: '',
  opening_balance: 500000, total_topup: 100000, total_bbm_flazz: 120000, total_tol: 20000,
  total_expense: 140000, flazz_balance: 460000, actual_balance: 460000, difference: 0,
  reconciliation_status: 'UNRECONCILED', notes: '', reconciled_by: 'pic',
  reconciled_at: '2026-01-01T00:00:00.000Z', is_deleted: '0', ...over,
});

function setup(init: { cards?: FlazzCardRow[]; topups?: FlazzTopupRow[]; tols?: FlazzTolRow[]; recons?: FlazzReconciliationRow[]; fail?: string } = {}) {
  const master = memMaster({
    cabang: CABANG,
    kendaraan: [VEHICLE_ROW],
    supir: [{ supir_id: 'S-1', nama_supir: 'Supir A', kode_cabang: 'CBG-A', default_vehicle_id: '', status: 'Aktif' }],
  });
  const flz = memFlazz({ cards: init.cards ?? [], topups: init.topups ?? [], tols: init.tols ?? [], reconciliations: init.recons ?? [] });
  if (init.fail) {
    const repo = flz.repo;
    const boom = () => { throw new Error('DB Injected failure: ' + init.fail); };
    if (init.fail === 'insertTopup') repo.insertTopup = boom;
    if (init.fail === 'insertTol') repo.insertTol = boom;
    if (init.fail === 'updateReconciliation') repo.updateReconciliation = boom;
  }
  const { deps, kv, audits } = makeDeps({ master: master.repo, flazz: flz.repo });
  const app = buildApp(fakeEnv() as any, deps);
  return { app, kv, audits, flz };
}

const body = (o: unknown = {}) => JSON.stringify(o);
const headers = (t: string) => ({ ...authHeaders(t), 'Content-Type': 'application/json' });

async function post(app: ReturnType<typeof buildApp>, path: string, t: string, b: unknown) {
  return app.request(path, { method: 'POST', headers: headers(t), body: body(b) });
}
async function put(app: ReturnType<typeof buildApp>, path: string, t: string, b: unknown) {
  return app.request(path, { method: 'PUT', headers: headers(t), body: body(b) });
}
async function del(app: ReturnType<typeof buildApp>, path: string, t: string) {
  return app.request(path, { method: 'DELETE', headers: headers(t) });
}

describe('GET/POST /api/flazz/card', () => {
  it('tanpa token -> 401', async () => {
    const { app } = setup();
    expect((await app.request('/api/flazz/card')).status).toBe(401);
  });

  it('SUPERADMIN buat kartu di CBG-A -> FLZ-, saldo 0, TERSEDIA, audit CREATE', async () => {
    const { app, kv, audits, flz } = setup();
    const tok = await loginAs(kv, SUPER);
    const res = await post(app, '/api/flazz/card', tok, { branch_id: 'CBG-A', card_number: '555', card_name: 'Kartu Baru' });
    expect(res.status).toBe(200);
    const created = (await res.json() as any).card;
    expect(created.id).toMatch(/^FLZ-/);
    expect(created.last_balance).toBe(0);
    expect(created.status).toBe('TERSEDIA');
    expect(flz.state.cards).toHaveLength(1);
    expect(audits[0]).toMatchObject({ action: 'CREATE', modul: 'flazz' });
  });

  it('PIC buat di cabang sendiri -> 200', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/flazz/card', tok, { card_number: '556', card_name: 'Kartu PIC' });
    expect(res.status).toBe(200);
  });

  it('PIC buat di cabang lain -> 403', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/flazz/card', tok, { branch_id: 'CBG-B', card_number: '557', card_name: 'Kartu X' });
    expect(res.status).toBe(403);
  });

  it('nomor kartu duplikat dalam cabang -> 409', async () => {
    const { app, kv } = setup({ cards: [card()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/flazz/card', tok, { card_number: '123', card_name: 'Duplikat' });
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toContain('sudah terdaftar');
  });

  it('update last_balance atau branch_id -> 400', async () => {
    const { app, kv } = setup({ cards: [card()] });
    const tok = await loginAs(kv, PIC);
    expect((await put(app, '/api/flazz/card/FLZ-1', tok, { last_balance: 9_000_000 })).status).toBe(400);
    expect((await put(app, '/api/flazz/card/FLZ-1', tok, { branch_id: 'CBG-B' })).status).toBe(400);
  });

  it('delete kartu dengan usage aktif -> 409', async () => {
    const { app, kv, flz } = setup({ cards: [card()] });
    await flz.repo.createUsage({ cardId: 'FLZ-1', driverName: 'Supir A', vehicleId: 'V-1', refType: 'TRX', refId: 'TRX-1', usedAt: '2026-09-01T00:00:00.000Z' });
    const tok = await loginAs(kv, PIC);
    expect((await del(app, '/api/flazz/card/FLZ-1', tok)).status).toBe(409);
  });

  it('delete kartu nonaktif dua kali -> keduanya 200', async () => {
    const { app, kv, flz } = setup({ cards: [card()] });
    const tok = await loginAs(kv, PIC);
    expect((await del(app, '/api/flazz/card/FLZ-1', tok)).status).toBe(200);
    expect((await del(app, '/api/flazz/card/FLZ-1', tok)).status).toBe(200);
    expect(flz.state.cards[0]!.status).toBe('NONAKTIF');
  });

  it('list terfilter cabang dan q tanpa kebocoran lintas cabang', async () => {
    const { app, kv } = setup({ cards: [
      card({ id: 'FLZ-1' }),
      card({ id: 'FLZ-2', card_number: '777', card_name: 'Kartu B', branch_id: 'CBG-B' }),
    ] });
    const tok = await loginAs(kv, PIC);
    const own = (await (await app.request('/api/flazz/card', { headers: authHeaders(tok) })).json() as any).cards;
    expect(own.map((c: any) => c.id)).toEqual(['FLZ-1']);
    const search = (await (await app.request('/api/flazz/card?q=kartu%20b', { headers: authHeaders(tok) })).json() as any).cards;
    expect(search).toHaveLength(0);
  });

  it('SUPERADMIN bisa list semua cabang', async () => {
    const { app, kv } = setup({ cards: [card({ id: 'FLZ-1' }), card({ id: 'FLZ-2', branch_id: 'CBG-B' })] });
    const tok = await loginAs(kv, SUPER);
    const all = (await (await app.request('/api/flazz/card', { headers: authHeaders(tok) })).json() as any).cards;
    expect(all).toHaveLength(2);
  });
});

describe('/api/flazz/topup', () => {
  it('create menaikkan saldo, mencatat created_by dan audit', async () => {
    const { app, kv, audits, flz } = setup({ cards: [card()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/flazz/topup', tok, { card_id: 'FLZ-1', date: '2026-09-01', amount: 250000 });
    expect(res.status).toBe(200);
    expect(flz.state.cards[0]!.last_balance).toBe(750000);
    expect(flz.state.topups[0]).toMatchObject({ amount: 250000, created_by: 'pic' });
    expect(audits[0]).toMatchObject({ action: 'CREATE', modul: 'flazz' });
  });

  it('update hanya menyesuaikan delta', async () => {
    const { app, kv, flz } = setup({ cards: [card()], topups: [topup()] });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/flazz/topup/TOP-1', tok, { amount: 300000 });
    expect(res.status).toBe(200);
    expect(flz.state.cards[0]!.last_balance).toBe(700000);
    expect(flz.state.topups[0]!.amount).toBe(300000);
  });

  it('delete soft-delete dan mengurangi saldo', async () => {
    const { app, kv, flz } = setup({ cards: [card()], topups: [topup()] });
    const tok = await loginAs(kv, PIC);
    expect((await del(app, '/api/flazz/topup/TOP-1', tok)).status).toBe(200);
    expect(flz.state.topups[0]!.is_deleted).toBe('1');
    expect(flz.state.cards[0]!.last_balance).toBe(400000);
  });

  it('tanggal tidak valid atau nominal nol -> 400', async () => {
    const { app, kv, flz } = setup({ cards: [card()] });
    const tok = await loginAs(kv, PIC);
    expect((await post(app, '/api/flazz/topup', tok, { card_id: 'FLZ-1', date: '01-09-2026', amount: 1000 })).status).toBe(400);
    expect((await post(app, '/api/flazz/topup', tok, { card_id: 'FLZ-1', date: '2026-09-01', amount: 0 })).status).toBe(400);
    expect(flz.state.topups).toHaveLength(0);
  });

  it('insert topup gagal -> saldo dikembalikan', async () => {
    const { app, kv, flz } = setup({ cards: [card()], fail: 'insertTopup' });
    const tok = await loginAs(kv, PIC);
    expect((await post(app, '/api/flazz/topup', tok, { card_id: 'FLZ-1', date: '2026-09-01', amount: 100000 })).status).toBe(500);
    expect(flz.state.cards[0]!.last_balance).toBe(500000);
  });

  it('PIC tidak bisa top up kartu cabang lain -> 403', async () => {
    const { app, kv } = setup({ cards: [card({ branch_id: 'CBG-B' })] });
    const tok = await loginAs(kv, PIC);
    expect((await post(app, '/api/flazz/topup', tok, { card_id: 'FLZ-1', date: '2026-09-01', amount: 1000 })).status).toBe(403);
  });
});

describe('/api/flazz/tol', () => {
  it('create mengurangi saldo', async () => {
    const { app, kv, flz } = setup({ cards: [card()] });
    const tok = await loginAs(kv, PIC);
    expect((await post(app, '/api/flazz/tol', tok, { card_id: 'FLZ-1', date: '2026-09-01', amount: 50000 })).status).toBe(200);
    expect(flz.state.cards[0]!.last_balance).toBe(450000);
    expect(flz.state.tols[0]!.amount).toBe(50000);
  });

  it('saldo tidak cukup -> 409 dan tidak ada baris tol', async () => {
    const { app, kv, flz } = setup({ cards: [card({ last_balance: 10000 })] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/flazz/tol', tok, { card_id: 'FLZ-1', date: '2026-09-01', amount: 50000 });
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toContain('tidak mencukupi');
    expect(flz.state.tols).toHaveLength(0);
    expect(flz.state.cards[0]!.last_balance).toBe(10000);
  });

  it('update dan delete memakai delta bertanda benar', async () => {
    const { app, kv, flz } = setup({ cards: [card()], tols: [tol()] });
    const tok = await loginAs(kv, PIC);
    expect((await put(app, '/api/flazz/tol/TOL-1', tok, { amount: 30000 })).status).toBe(200);
    expect(flz.state.cards[0]!.last_balance).toBe(490000);
    expect((await del(app, '/api/flazz/tol/TOL-1', tok)).status).toBe(200);
    expect(flz.state.tols[0]!.is_deleted).toBe('1');
    expect(flz.state.cards[0]!.last_balance).toBe(520000);
  });

  it('insert tol gagal -> saldo dikembalikan', async () => {
    const { app, kv, flz } = setup({ cards: [card()], fail: 'insertTol' });
    const tok = await loginAs(kv, PIC);
    expect((await post(app, '/api/flazz/tol', tok, { card_id: 'FLZ-1', date: '2026-09-01', amount: 50000 })).status).toBe(500);
    expect(flz.state.cards[0]!.last_balance).toBe(500000);
  });
});

describe('/api/flazz/card/:id/adjust', () => {
  it('delta nol atau alasan kosong -> 400', async () => {
    const { app, kv, flz } = setup({ cards: [card()] });
    const tok = await loginAs(kv, PIC);
    expect((await post(app, '/api/flazz/card/FLZ-1/adjust', tok, { delta: 0, reason: 'x' })).status).toBe(400);
    expect((await post(app, '/api/flazz/card/FLZ-1/adjust', tok, { delta: 1000 })).status).toBe(400);
    expect(flz.state.cards[0]!.last_balance).toBe(500000);
  });

  it('saldo negatif -> 409 dan saldo tetap', async () => {
    const { app, kv, flz } = setup({ cards: [card({ last_balance: 10000 })] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/flazz/card/FLZ-1/adjust', tok, { delta: -50000, reason: 'koreksi' });
    expect(res.status).toBe(409);
    expect(flz.state.cards[0]!.last_balance).toBe(10000);
  });

  it('adjust positifraises saldo dan usage opening Adjust', async () => {
    const { app, kv, flz } = setup({ cards: [card()] });
    await flz.repo.createUsage({ cardId: 'FLZ-1', driverName: 'Supir A', vehicleId: 'V-1', refType: 'TRX', refId: 'TRX-1', usedAt: '2026-09-01T00:00:00.000Z' });
    const opening = flz.state.usage[0]!.opening_balance;
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/flazz/card/FLZ-1/adjust', tok, { delta: 25000, reason: 'selisih，顶' });
    expect(res.status).toBe(200);
    expect(flz.state.cards[0]!.last_balance).toBe(525000);
    expect(flz.state.usage[0]!.opening_balance).toBe(opening + 25000);
  });
});

describe('/api/flazz/reconciliation', () => {
  it('create menyimpan total yang dihitung server dan status UNRECONCILED', async () => {
    const { app, kv, flz } = setup({ cards: [card()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/flazz/reconciliation', tok, {
      card_id: 'FLZ-1', date: '2026-09-01', opening_balance: 500000,
      total_topup: 100000, total_bbm_flazz: 120000, total_tol: 20000, actual_balance: 460000,
    });
    expect(res.status).toBe(200);
    expect(flz.state.reconciliations[0]).toMatchObject({
      total_expense: 140000, flazz_balance: 460000, difference: 0, reconciliation_status: 'UNRECONCILED',
    });
    expect(flz.state.cards[0]!.last_balance).toBe(500000);
  });

  it('total tidak valid -> 400', async () => {
    const { app, kv, flz } = setup({ cards: [card()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/flazz/reconciliation', tok, {
      card_id: 'FLZ-1', date: '2026-09-01', total_topup: 'abc', actual_balance: 1,
    });
    expect(res.status).toBe(400);
    expect(flz.state.reconciliations).toHaveLength(0);
  });

  it('update ditolak untuk baris APPLIED, diterima untuk UNRECONCILED', async () => {
    const { app, kv, flz } = setup({ cards: [card()], recons: [
      recon({ id: 'REC-APPLIED', reconciliation_status: 'APPLIED' }),
      recon({ id: 'REC-1' }),
    ] });
    const tok = await loginAs(kv, PIC);
    expect((await put(app, '/api/flazz/reconciliation/REC-APPLIED', tok, { total_topup: 1, actual_balance: 1 })).status).toBe(409);
    expect((await put(app, '/api/flazz/reconciliation/REC-1', tok, { total_topup: 200000, actual_balance: 560000 })).status).toBe(200);
    expect(flz.state.reconciliations[1]).toMatchObject({ total_topup: 200000, flazz_balance: 560000 });
  });

  it('ignore hanya mengubah status, saldo kartu tidak berubah', async () => {
    const { app, kv, flz } = setup({ cards: [card()], recons: [recon()] });
    const tok = await loginAs(kv, PIC);
    expect((await post(app, '/api/flazz/reconciliation/REC-1/ignore', tok, {})).status).toBe(200);
    expect(flz.state.reconciliations[0]!.reconciliation_status).toBe('IGNORED');
    expect(flz.state.cards[0]!.last_balance).toBe(500000);
  });

  it('apply men-set saldo ke actual_balance dan menandai APPLIED', async () => {
    const { app, kv, flz } = setup({ cards: [card({ last_balance: 300000 })], recons: [recon({ actual_balance: 460000 })] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/flazz/reconciliation/REC-1/apply', tok, {});
    expect(res.status).toBe(200);
    expect(flz.state.cards[0]!.last_balance).toBe(460000);
    expect(flz.state.reconciliations[0]!.reconciliation_status).toBe('APPLIED');
    expect((await post(app, '/api/flazz/reconciliation/REC-1/apply', tok, {})).status).toBe(409);
  });

  it('apply baris IGNORED -> 409', async () => {
    const { app, kv } = setup({ cards: [card()], recons: [recon({ reconciliation_status: 'IGNORED' })] });
    const tok = await loginAs(kv, PIC);
    expect((await post(app, '/api/flazz/reconciliation/REC-1/apply', tok, {})).status).toBe(409);
  });

  it('delete baris APPLIED -> 409; baris lain soft-delete', async () => {
    const { app, kv, flz } = setup({ cards: [card()], recons: [
      recon({ id: 'REC-1', reconciliation_status: 'APPLIED' }),
      recon({ id: 'REC-2' }),
    ] });
    const tok = await loginAs(kv, PIC);
    expect((await del(app, '/api/flazz/reconciliation/REC-1', tok)).status).toBe(409);
    expect((await del(app, '/api/flazz/reconciliation/REC-2', tok)).status).toBe(200);
    expect(flz.state.reconciliations[1]!.is_deleted).toBe('1');
    expect(flz.state.cards[0]!.last_balance).toBe(500000);
  });

  it('apply gagal update status -> saldo dikembalikan', async () => {
    const { app, kv, flz } = setup({
      cards: [card({ last_balance: 300000 })],
      recons: [recon({ actual_balance: 460000 })],
      fail: 'updateReconciliation',
    });
    const tok = await loginAs(kv, PIC);
    expect((await post(app, '/api/flazz/reconciliation/REC-1/apply', tok, {})).status).toBe(500);
    expect(flz.state.cards[0]!.last_balance).toBe(300000);
  });

  it('PIC tidak bisa akses rekonsiliasi cabang lain -> 403', async () => {
    const { app, kv } = setup({ cards: [card({ branch_id: 'CBG-B' })], recons: [recon()] });
    const tok = await loginAs(kv, PIC);
    expect((await del(app, '/api/flazz/reconciliation/REC-1', tok)).status).toBe(403);
  });
});
