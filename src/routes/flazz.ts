import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppDeps, SessionUser } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { HttpError, okPayload, reqIp } from '../utils/http';
import { jsonSnip } from './master';
import { bumpMasterRev, invalidateDashwarn } from '../logic/master-cache';
import { CardBalanceError } from '../db/flazz';
import type { CardPatch, FlazzCardRow } from '../db/flazz';
import {
  computeReconciliation,
  isCardUsable,
  isValidFlazzDate,
  ledgerBalanceDelta,
  parseFlazzAmount,
} from '../logic/flazz';
import { canonicalCardId, formatIdNumber } from '../logic/laporan';

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

function roleOf(u: SessionUser): string {
  return String(u.role || '').toUpperCase();
}

function isSuper(u: SessionUser): boolean {
  return roleOf(u) === 'SUPERADMIN';
}

function scopeBranch(u: SessionUser, requested?: unknown): string {
  const asked = String(requested ?? '').trim();
  if (isSuper(u)) return asked;
  if (asked) assertBranch(u, asked);
  return String(u.cabang || '');
}

function assertBranch(u: SessionUser, branchId: string): void {
  if (isSuper(u)) return;
  if (String(branchId || '') !== String(u.cabang || '')) {
    throw new HttpError(403, 'Akses ditolak: Anda hanya dapat mengelola kartu warehouse ' + u.cabang + '.', 'FORBIDDEN');
  }
}

async function readJson(c: Ctx): Promise<Record<string, any>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' ? (b as Record<string, any>) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string {
  return String(v ?? '').trim();
}

export function flazzRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', requireUser(deps));

  const audit = (c: Ctx, entry: Omit<Parameters<AppDeps['recordAudit']>[0], 'user_id' | 'username' | 'ip'>) =>
    deps.recordAudit({
      ...entry,
      user_id: c.get('user').user_id,
      username: c.get('user').username,
      ip: reqIp(c),
    });

  const afterWrite = async (u: SessionUser) => {
    await bumpMasterRev(deps.kv);
    await invalidateDashwarn(deps.kv, roleOf(u), u.cabang);
  };

  const requireCard = async (id: string, u: SessionUser): Promise<FlazzCardRow> => {
    const card = await deps.flazz.findCardById(id);
    if (!card) throw new HttpError(404, 'Kartu Flazz tidak ditemukan.', 'NOT_FOUND');
    assertBranch(u, card.branch_id);
    return card;
  };

  const usableCard = async (id: string, u: SessionUser): Promise<FlazzCardRow> => {
    const card = await requireCard(id, u);
    if (!isCardUsable(card.status)) {
      throw new HttpError(409, 'Kartu Flazz ' + (card.card_name || card.card_number) + ' berstatus ' + card.status + ' dan tidak dapat dipakai.', 'CONFLICT');
    }
    return card;
  };

  const insufficient = (card: FlazzCardRow, needed: number, kind: string): never => {
    throw new HttpError(409, 'Saldo kartu Flazz (' + (card.card_name || card.card_number) + ') tidak mencukupi untuk ' + kind +
      '. Saldo: Rp ' + formatIdNumber(Number(card.last_balance) || 0) + ', Total: Rp ' + formatIdNumber(needed) +
      '. Silakan top up Flazz terlebih dahulu.', 'CONFLICT');
  };

  const validateDate = (value: unknown, field: string): string => {
    const d = str(value);
    if (!isValidFlazzDate(d)) throw new HttpError(400, field + ' tidak valid. Gunakan format YYYY-MM-DD.', 'BAD_REQUEST');
    return d;
  };

  const validateAmount = (value: unknown, allowZero: boolean, field: string): number => {
    const amount = parseFlazzAmount(value, allowZero);
    if (amount === null) {
      throw new HttpError(400, field + ' harus berupa angka' + (allowZero ? '' : ' positif') + '.', 'BAD_REQUEST');
    }
    return amount;
  };

  const validateEvidence = (value: unknown): string => {
    const url = str(value);
    if (!url) return '';
    if (!/^https?:\/\/\S+$/i.test(url)) {
      throw new HttpError(400, 'evidence_url harus berupa URL http(s) yang valid.', 'BAD_REQUEST');
    }
    return url;
  };

  const validateDriver = async (driverId: unknown): Promise<string> => {
    const id = str(driverId);
    if (!id) return '';
    if (!(await deps.master.findSupirById(id))) {
      throw new HttpError(400, 'Supir dengan ID ' + id + ' tidak ditemukan.', 'BAD_REQUEST');
    }
    return id;
  };

  const validateVehicle = async (vehicleId: unknown): Promise<string> => {
    const id = str(vehicleId);
    if (!id) return '';
    if (!(await deps.master.findKendaraanById(id))) {
      throw new HttpError(400, 'Kendaraan dengan ID ' + id + ' tidak ditemukan.', 'BAD_REQUEST');
    }
    return id;
  };

  // ── Cards ────────────────────────────────────────────────────────────────

  app.get('/card', async (c: Ctx) => {
    const u = c.get('user');
    const cards = await deps.flazz.listCards({
      branchId: scopeBranch(u, c.req.query('branch_id')),
      status: str(c.req.query('status')) || undefined,
      q: str(c.req.query('q')) || undefined,
    });
    return c.json(okPayload({ cards }));
  });

  app.get('/card/:id', async (c: Ctx) => {
    const u = c.get('user');
    const card = await requireCard(c.req.param('id') as string, u);
    return c.json(okPayload({ card }));
  });

  app.post('/card', async (c: Ctx) => {
    const u = c.get('user');
    const b = await readJson(c);
    const cardNumber = str(b.card_number);
    const cardName = str(b.card_name);
    const branchId = scopeBranch(u, b.branch_id);
    if (!cardNumber) throw new HttpError(400, 'Nomor kartu wajib diisi.', 'BAD_REQUEST');
    if (!cardName) throw new HttpError(400, 'Nama kartu wajib diisi.', 'BAD_REQUEST');
    if (!branchId) throw new HttpError(400, 'Kode cabang wajib diisi.', 'BAD_REQUEST');
    assertBranch(u, branchId);
    if (!(await deps.master.findCabangByKode(branchId))) {
      throw new HttpError(400, 'Cabang ' + branchId + ' tidak ditemukan.', 'BAD_REQUEST');
    }
    if (await deps.flazz.findCardByNumber(branchId, cardNumber)) {
      throw new HttpError(409, 'Nomor kartu ' + cardNumber + ' sudah terdaftar pada cabang ' + branchId + '.', 'CONFLICT');
    }
    const defaultDriverId = await validateDriver(b.default_driver_id);
    const card = await deps.flazz.insertCard({
      card_number: cardNumber, card_name: cardName, branch_id: branchId,
      card_type: str(b.card_type), card_role: str(b.card_role),
      default_driver_id: defaultDriverId, driver_id: await validateDriver(b.driver_id),
      notes: str(b.notes),
    });
    await audit(c, { action: 'CREATE', modul: 'flazz', keterangan: 'Kartu Flazz ' + cardNumber, data_sesudah: jsonSnip(card) });
    await afterWrite(u);
    return c.json(okPayload({ card }));
  });

  const CARD_PATCH_FIELDS = ['card_number', 'card_name', 'card_type', 'card_role', 'driver_id', 'default_driver_id', 'notes', 'status'];
  const CARD_FORBIDDEN_FIELDS = ['id', 'branch_id', 'last_balance'];

  app.put('/card/:id', async (c: Ctx) => {
    const u = c.get('user');
    const card = await requireCard(c.req.param('id') as string, u);
    const b = await readJson(c);
    for (const f of CARD_FORBIDDEN_FIELDS) {
      if (b[f] !== undefined) throw new HttpError(400, 'Field ' + f + ' tidak dapat diubah.', 'BAD_REQUEST');
    }
    const patch: CardPatch = {};
    for (const f of CARD_PATCH_FIELDS) {
      if (b[f] !== undefined) (patch as Record<string, unknown>)[f] = str(b[f]);
    }
    if (patch.status === 'SEDANG_DIGUNAKAN') {
      throw new HttpError(400, 'Status kartu tidak dapat diubah langsung ke SEDANG_DIGUNAKAN.', 'BAD_REQUEST');
    }
    if (patch.card_number !== undefined) {
      if (!patch.card_number) throw new HttpError(400, 'Nomor kartu wajib diisi.', 'BAD_REQUEST');
      const other = await deps.flazz.findCardByNumber(card.branch_id, patch.card_number);
      if (other && canonicalCardId(other.id) !== canonicalCardId(card.id)) {
        throw new HttpError(409, 'Nomor kartu ' + patch.card_number + ' sudah terdaftar pada cabang ' + card.branch_id + '.', 'CONFLICT');
      }
    }
    if (patch.driver_id !== undefined) patch.driver_id = await validateDriver(String(patch.driver_id));
    if (patch.default_driver_id !== undefined) patch.default_driver_id = await validateDriver(String(patch.default_driver_id));
    await deps.flazz.updateCard(card.id, patch);
    await audit(c, { action: 'UPDATE', modul: 'flazz', keterangan: 'Kartu Flazz ' + card.card_number, data_sebelum: jsonSnip(card), data_sesudah: jsonSnip(patch) });
    await afterWrite(u);
    return c.json(okPayload({ msg: 'Kartu Flazz berhasil diperbarui.' }));
  });

  app.delete('/card/:id', async (c: Ctx) => {
    const u = c.get('user');
    const card = await requireCard(c.req.param('id') as string, u);
    if (card.status === 'NONAKTIF') return c.json(okPayload({ msg: 'Kartu Flazz sudah tidak aktif.' }));
    if (await deps.flazz.hasActiveUsage(card.id)) {
      throw new HttpError(409, 'Kartu Flazz masih dipakai pada transaksi aktif sehingga tidak dapat dinonaktifkan.', 'CONFLICT');
    }
    await deps.flazz.setCardStatus(card.id, 'NONAKTIF');
    await audit(c, { action: 'DELETE', modul: 'flazz', keterangan: 'Kartu Flazz ' + card.card_number, data_sebelum: jsonSnip(card) });
    await afterWrite(u);
    return c.json(okPayload({ msg: 'Kartu Flazz dinonaktifkan.' }));
  });

  // ── Balance adjust ───────────────────────────────────────────────────────

  app.post('/card/:id/adjust', async (c: Ctx) => {
    const u = c.get('user');
    const card = await usableCard(c.req.param('id') as string, u);
    const b = await readJson(c);
    const raw = Number(b.delta);
    if (b.delta === undefined || b.delta === null || b.delta === '' || !isFinite(raw)) {
      throw new HttpError(400, 'delta harus berupa angka dan tidak boleh nol.', 'BAD_REQUEST');
    }
    if (raw === 0) throw new HttpError(400, 'delta harus berupa angka dan tidak boleh nol.', 'BAD_REQUEST');
    const delta = raw;
    const reason = str(b.reason);
    if (!reason) throw new HttpError(400, 'Alasan penyesuaian wajib diisi.', 'BAD_REQUEST');
    let balance: number;
    try {
      balance = await deps.flazz.adjustBalance(card.id, delta);
    } catch (e) {
      if (e instanceof CardBalanceError) insufficient(card, Math.abs(delta), 'penyesuaian saldo');
      throw e;
    }
    try {
      await deps.flazz.adjustActiveUsageOpening(card.id, delta);
    } catch (e) {
      try { await deps.flazz.adjustBalance(card.id, -delta); } catch { /* rollback best-effort */ }
      throw e;
    }
    await audit(c, { action: 'ADJUST', modul: 'flazz', keterangan: 'Penyesuaian saldo kartu ' + card.card_number, data_sesudah: jsonSnip({ delta, reason, balance }) });
    await afterWrite(u);
    return c.json(okPayload({ card_id: card.id, last_balance: balance }));
  });

  // ── Top-up ───────────────────────────────────────────────────────────────

  app.get('/topup', async (c: Ctx) => {
    const u = c.get('user');
    const topups = await deps.flazz.listTopups({
      branchId: scopeBranch(u, c.req.query('branch_id')),
      cardId: str(c.req.query('card_id')) || undefined,
      date: str(c.req.query('date')) || undefined,
      isDeleted: str(c.req.query('is_deleted')) === '1',
    });
    return c.json(okPayload({ topups }));
  });

  app.post('/topup', async (c: Ctx) => {
    const u = c.get('user');
    const b = await readJson(c);
    const card = await usableCard(str(b.card_id), u);
    const date = validateDate(b.date, 'Tanggal top up');
    const amount = validateAmount(b.amount, false, 'Nominal top up');
    const evidenceUrl = validateEvidence(b.evidence_url);
    await deps.flazz.adjustBalance(card.id, amount);
    let row;
    try {
      row = await deps.flazz.insertTopup({
        date, card_id: card.id, amount, evidence_url: evidenceUrl,
        notes: str(b.notes), created_by: u.username,
      });
    } catch (e) {
      try { await deps.flazz.adjustBalance(card.id, -amount); } catch { /* rollback best-effort */ }
      throw e;
    }
    await audit(c, { action: 'CREATE', modul: 'flazz', keterangan: 'Top up kartu ' + card.card_number, data_sesudah: jsonSnip(row) });
    await afterWrite(u);
    return c.json(okPayload({ topup: row }));
  });

  app.put('/topup/:id', async (c: Ctx) => {
    const u = c.get('user');
    const row = await deps.flazz.findTopupById(c.req.param('id') as string);
    if (!row || row.is_deleted === '1') throw new HttpError(404, 'Data top up tidak ditemukan.', 'NOT_FOUND');
    const card = await usableCard(row.card_id, u);
    const b = await readJson(c);
    const date = b.date !== undefined ? validateDate(b.date, 'Tanggal top up') : undefined;
    const amount = b.amount !== undefined ? validateAmount(b.amount, false, 'Nominal top up') : undefined;
    const evidenceUrl = b.evidence_url !== undefined ? validateEvidence(b.evidence_url) : undefined;
    const delta = ledgerBalanceDelta('TOPUP', 'UPDATE', Number(row.amount) || 0, amount);
    if (delta) {
      try {
        await deps.flazz.adjustBalance(card.id, delta);
      } catch (e) {
        if (e instanceof CardBalanceError) insufficient(card, Math.abs(delta), 'koreksi top up');
        throw e;
      }
    }
    const patch = {
      ...(date !== undefined ? { date } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(evidenceUrl !== undefined ? { evidence_url: evidenceUrl } : {}),
      ...(b.notes !== undefined ? { notes: str(b.notes) } : {}),
    };
    try {
      await deps.flazz.updateTopup(row.id, patch);
    } catch (e) {
      if (delta) {
        try { await deps.flazz.adjustBalance(card.id, -delta); } catch { /* rollback best-effort */ }
      }
      throw e;
    }
    await audit(c, { action: 'UPDATE', modul: 'flazz', keterangan: 'Top up ' + row.id, data_sebelum: jsonSnip(row), data_sesudah: jsonSnip(patch) });
    await afterWrite(u);
    return c.json(okPayload({ msg: 'Top up berhasil diperbarui.' }));
  });

  app.delete('/topup/:id', async (c: Ctx) => {
    const u = c.get('user');
    const row = await deps.flazz.findTopupById(c.req.param('id') as string);
    if (!row || row.is_deleted === '1') throw new HttpError(404, 'Data top up tidak ditemukan.', 'NOT_FOUND');
    const card = await usableCard(row.card_id, u);
    const amount = Number(row.amount) || 0;
    await deps.flazz.adjustBalance(card.id, -amount);
    try {
      await deps.flazz.updateTopup(row.id, { is_deleted: '1' });
    } catch (e) {
      try { await deps.flazz.adjustBalance(card.id, amount); } catch { /* rollback best-effort */ }
      throw e;
    }
    await audit(c, { action: 'DELETE', modul: 'flazz', keterangan: 'Top up ' + row.id, data_sebelum: jsonSnip(row) });
    await afterWrite(u);
    return c.json(okPayload({ msg: 'Top up dihapus.' }));
  });

  // ── Tol ──────────────────────────────────────────────────────────────────

  app.get('/tol', async (c: Ctx) => {
    const u = c.get('user');
    const tols = await deps.flazz.listTols({
      branchId: scopeBranch(u, c.req.query('branch_id')),
      cardId: str(c.req.query('card_id')) || undefined,
      date: str(c.req.query('date')) || undefined,
      isDeleted: str(c.req.query('is_deleted')) === '1',
    });
    return c.json(okPayload({ tols }));
  });

  app.post('/tol', async (c: Ctx) => {
    const u = c.get('user');
    const b = await readJson(c);
    const card = await usableCard(str(b.card_id), u);
    const date = validateDate(b.date, 'Tanggal tol');
    const amount = validateAmount(b.amount, false, 'Nominal tol');
    const evidenceUrl = validateEvidence(b.evidence_url);
    const driverId = await validateDriver(b.driver_id);
    const vehicleId = await validateVehicle(b.vehicle_id);
    try {
      await deps.flazz.adjustBalance(card.id, -amount);
    } catch (e) {
      if (e instanceof CardBalanceError) insufficient(card, amount, 'pembayaran tol');
      throw e;
    }
    let row;
    try {
      row = await deps.flazz.insertTol({
        date, card_id: card.id, amount, driver_id: driverId, vehicle_id: vehicleId,
        evidence_url: evidenceUrl, notes: str(b.notes), created_by: u.username,
      });
    } catch (e) {
      try { await deps.flazz.adjustBalance(card.id, amount); } catch { /* rollback best-effort */ }
      throw e;
    }
    await audit(c, { action: 'CREATE', modul: 'flazz', keterangan: 'Tol kartu ' + card.card_number, data_sesudah: jsonSnip(row) });
    await afterWrite(u);
    return c.json(okPayload({ tol: row }));
  });

  app.put('/tol/:id', async (c: Ctx) => {
    const u = c.get('user');
    const row = await deps.flazz.findTolById(c.req.param('id') as string);
    if (!row || row.is_deleted === '1') throw new HttpError(404, 'Data tol tidak ditemukan.', 'NOT_FOUND');
    const card = await usableCard(row.card_id, u);
    const b = await readJson(c);
    const date = b.date !== undefined ? validateDate(b.date, 'Tanggal tol') : undefined;
    const amount = b.amount !== undefined ? validateAmount(b.amount, false, 'Nominal tol') : undefined;
    const evidenceUrl = b.evidence_url !== undefined ? validateEvidence(b.evidence_url) : undefined;
    const driverId = b.driver_id !== undefined ? await validateDriver(b.driver_id) : undefined;
    const vehicleId = b.vehicle_id !== undefined ? await validateVehicle(b.vehicle_id) : undefined;
    const delta = ledgerBalanceDelta('TOL', 'UPDATE', Number(row.amount) || 0, amount);
    if (delta) {
      try {
        await deps.flazz.adjustBalance(card.id, delta);
      } catch (e) {
        if (e instanceof CardBalanceError) insufficient(card, Math.abs(delta), 'koreksi tol');
        throw e;
      }
    }
    const patch = {
      ...(date !== undefined ? { date } : {}),
      ...(amount !== undefined ? { amount } : {}),
      ...(driverId !== undefined ? { driver_id: driverId } : {}),
      ...(vehicleId !== undefined ? { vehicle_id: vehicleId } : {}),
      ...(evidenceUrl !== undefined ? { evidence_url: evidenceUrl } : {}),
      ...(b.notes !== undefined ? { notes: str(b.notes) } : {}),
    };
    try {
      await deps.flazz.updateTol(row.id, patch);
    } catch (e) {
      if (delta) {
        try { await deps.flazz.adjustBalance(card.id, -delta); } catch { /* rollback best-effort */ }
      }
      throw e;
    }
    await audit(c, { action: 'UPDATE', modul: 'flazz', keterangan: 'Tol ' + row.id, data_sebelum: jsonSnip(row), data_sesudah: jsonSnip(patch) });
    await afterWrite(u);
    return c.json(okPayload({ msg: 'Tol berhasil diperbarui.' }));
  });

  app.delete('/tol/:id', async (c: Ctx) => {
    const u = c.get('user');
    const row = await deps.flazz.findTolById(c.req.param('id') as string);
    if (!row || row.is_deleted === '1') throw new HttpError(404, 'Data tol tidak ditemukan.', 'NOT_FOUND');
    const card = await usableCard(row.card_id, u);
    const amount = Number(row.amount) || 0;
    await deps.flazz.adjustBalance(card.id, amount);
    try {
      await deps.flazz.updateTol(row.id, { is_deleted: '1' });
    } catch (e) {
      try { await deps.flazz.adjustBalance(card.id, -amount); } catch { /* rollback best-effort */ }
      throw e;
    }
    await audit(c, { action: 'DELETE', modul: 'flazz', keterangan: 'Tol ' + row.id, data_sebelum: jsonSnip(row) });
    await afterWrite(u);
    return c.json(okPayload({ msg: 'Tol dihapus.' }));
  });

  // ── Reconciliation ───────────────────────────────────────────────────────

  const recTotals = (b: Record<string, any>) => {
    const num0 = (v: unknown, field: string): number => {
      if (v === undefined || v === null || v === '') return 0;
      const n = Number(v);
      if (!isFinite(n)) throw new HttpError(400, field + ' harus berupa angka.', 'BAD_REQUEST');
      return n;
    };
    return {
      opening_balance: num0(b.opening_balance, 'opening_balance'),
      total_topup: num0(b.total_topup, 'total_topup'),
      total_bbm_flazz: num0(b.total_bbm_flazz, 'total_bbm_flazz'),
      total_tol: num0(b.total_tol, 'total_tol'),
      flazz_balance: num0(b.flazz_balance, 'flazz_balance'),
      actual_balance: num0(b.actual_balance, 'actual_balance'),
    };
  };

  app.get('/reconciliation', async (c: Ctx) => {
    const u = c.get('user');
    const rows = await deps.flazz.listReconciliations({
      branchId: scopeBranch(u, c.req.query('branch_id')),
      cardId: str(c.req.query('card_id')) || undefined,
      date: str(c.req.query('date')) || undefined,
      isDeleted: str(c.req.query('is_deleted')) === '1',
    });
    return c.json(okPayload({ reconciliations: rows }));
  });

  app.post('/reconciliation', async (c: Ctx) => {
    const u = c.get('user');
    const b = await readJson(c);
    const card = await requireCard(str(b.card_id), u);
    const date = validateDate(b.date, 'Tanggal rekonsiliasi');
    const t = recTotals(b);
    const driverId = await validateDriver(b.driver_id);
    const vehicleId = await validateVehicle(b.vehicle_id);
    const computed = computeReconciliation({
      openingBalance: t.opening_balance, totalTopup: t.total_topup,
      totalBbmFlazz: t.total_bbm_flazz, totalTol: t.total_tol,
      actualBalance: t.actual_balance,
    });
    const row = await deps.flazz.insertReconciliation({
      date, card_id: card.id, driver_id: driverId, vehicle_id: vehicleId,
      opening_balance: t.opening_balance, total_topup: t.total_topup,
      total_bbm_flazz: t.total_bbm_flazz, total_tol: t.total_tol,
      total_expense: computed.totalExpense, flazz_balance: computed.flazzBalance,
      actual_balance: t.actual_balance, difference: computed.difference,
      reconciliation_status: 'UNRECONCILED', notes: str(b.notes), reconciled_by: u.username,
    });
    await audit(c, { action: 'CREATE', modul: 'flazz', keterangan: 'Rekonsiliasi kartu ' + card.card_number, data_sesudah: jsonSnip(row) });
    await afterWrite(u);
    return c.json(okPayload({ reconciliation: row }));
  });

  app.put('/reconciliation/:id', async (c: Ctx) => {
    const u = c.get('user');
    const row = await deps.flazz.findReconciliationById(c.req.param('id') as string);
    if (!row || row.is_deleted === '1') throw new HttpError(404, 'Data rekonsiliasi tidak ditemukan.', 'NOT_FOUND');
    const card = await requireCard(row.card_id, u);
    if (row.reconciliation_status === 'APPLIED') {
      throw new HttpError(409, 'Rekonsiliasi yang sudah diterapkan tidak dapat diubah.', 'CONFLICT');
    }
    const b = await readJson(c);
    const date = b.date !== undefined ? validateDate(b.date, 'Tanggal rekonsiliasi') : undefined;
    const t = recTotals({ ...row, ...b });
    const driverId = b.driver_id !== undefined ? await validateDriver(b.driver_id) : undefined;
    const vehicleId = b.vehicle_id !== undefined ? await validateVehicle(b.vehicle_id) : undefined;
    const computed = computeReconciliation({
      openingBalance: t.opening_balance, totalTopup: t.total_topup,
      totalBbmFlazz: t.total_bbm_flazz, totalTol: t.total_tol,
      actualBalance: t.actual_balance,
    });
    await deps.flazz.updateReconciliation(row.id, {
      ...(date !== undefined ? { date } : {}),
      ...(driverId !== undefined ? { driver_id: driverId } : {}),
      ...(vehicleId !== undefined ? { vehicle_id: vehicleId } : {}),
      opening_balance: t.opening_balance, total_topup: t.total_topup,
      total_bbm_flazz: t.total_bbm_flazz, total_tol: t.total_tol,
      total_expense: computed.totalExpense, flazz_balance: computed.flazzBalance,
      actual_balance: t.actual_balance, difference: computed.difference,
      ...(b.notes !== undefined ? { notes: str(b.notes) } : {}),
    });
    await audit(c, { action: 'UPDATE', modul: 'flazz', keterangan: 'Rekonsiliasi ' + row.id, data_sebelum: jsonSnip(row), data_sesudah: jsonSnip(computed) });
    await afterWrite(u);
    return c.json(okPayload({ msg: 'Rekonsiliasi berhasil diperbarui.' }));
  });

  app.post('/reconciliation/:id/ignore', async (c: Ctx) => {
    const u = c.get('user');
    const row = await deps.flazz.findReconciliationById(c.req.param('id') as string);
    if (!row || row.is_deleted === '1') throw new HttpError(404, 'Data rekonsiliasi tidak ditemukan.', 'NOT_FOUND');
    await requireCard(row.card_id, u);
    if (row.reconciliation_status === 'APPLIED') {
      throw new HttpError(409, 'Rekonsiliasi yang sudah diterapkan tidak dapat diabaikan.', 'CONFLICT');
    }
    await deps.flazz.updateReconciliation(row.id, { reconciliation_status: 'IGNORED', reconciled_by: u.username });
    await audit(c, { action: 'UPDATE', modul: 'flazz', keterangan: 'Rekonsiliasi diabaikan ' + row.id, data_sebelum: jsonSnip(row) });
    await afterWrite(u);
    return c.json(okPayload({ msg: 'Rekonsiliasi ditandai diabaikan.' }));
  });

  app.post('/reconciliation/:id/apply', async (c: Ctx) => {
    const u = c.get('user');
    const row = await deps.flazz.findReconciliationById(c.req.param('id') as string);
    if (!row || row.is_deleted === '1') throw new HttpError(404, 'Data rekonsiliasi tidak ditemukan.', 'NOT_FOUND');
    const card = await usableCard(row.card_id, u);
    if (row.reconciliation_status !== 'UNRECONCILED') {
      throw new HttpError(409, 'Hanya rekonsiliasi berstatus UNRECONCILED yang dapat diterapkan.', 'CONFLICT');
    }
    const current = Number(card.last_balance) || 0;
    const target = Number(row.actual_balance) || 0;
    const delta = target - current;
    let balance = current;
    if (delta) {
      try {
        balance = await deps.flazz.adjustBalance(card.id, delta);
      } catch (e) {
        if (e instanceof CardBalanceError) insufficient(card, Math.abs(delta), 'penerapan rekonsiliasi');
        throw e;
      }
      try {
        await deps.flazz.adjustActiveUsageOpening(card.id, delta);
      } catch (e) {
        try { await deps.flazz.adjustBalance(card.id, -delta); } catch { /* rollback best-effort */ }
        throw e;
      }
    }
    try {
      await deps.flazz.updateReconciliation(row.id, { reconciliation_status: 'APPLIED', reconciled_by: u.username });
    } catch (e) {
      if (delta) {
        try { await deps.flazz.adjustBalance(card.id, -delta); } catch { /* rollback best-effort */ }
      }
      throw e;
    }
    await audit(c, { action: 'UPDATE', modul: 'flazz', keterangan: 'Rekonsiliasi diterapkan ' + row.id, data_sebelum: jsonSnip(row), data_sesudah: jsonSnip({ delta, last_balance: balance }) });
    await afterWrite(u);
    return c.json(okPayload({ msg: 'Rekonsiliasi berhasil diterapkan.', last_balance: balance }));
  });

  app.delete('/reconciliation/:id', async (c: Ctx) => {
    const u = c.get('user');
    const row = await deps.flazz.findReconciliationById(c.req.param('id') as string);
    if (!row || row.is_deleted === '1') throw new HttpError(404, 'Data rekonsiliasi tidak ditemukan.', 'NOT_FOUND');
    await requireCard(row.card_id, u);
    if (row.reconciliation_status === 'APPLIED') {
      throw new HttpError(409, 'Rekonsiliasi yang sudah diterapkan tidak dapat dihapus.', 'CONFLICT');
    }
    await deps.flazz.updateReconciliation(row.id, { is_deleted: '1' });
    await audit(c, { action: 'DELETE', modul: 'flazz', keterangan: 'Rekonsiliasi ' + row.id, data_sebelum: jsonSnip(row) });
    await afterWrite(u);
    return c.json(okPayload({ msg: 'Rekonsiliasi dihapus.' }));
  });

  return app;
}
