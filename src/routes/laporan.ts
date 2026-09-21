import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppDeps, SessionUser } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { HttpError, okPayload } from '../utils/http';
import { newId, jsonSnip } from './master';
import { bumpMasterRev, invalidateLaporanCaches, performaCacheKey, monthlyCacheKey } from '../logic/master-cache';
import { CardBalanceError } from '../db/laporan';
import type { FlazzCardRow, LaporanInsert } from '../db/laporan';
import { extractStorageKey } from '../db/storage';
import * as L from '../logic/laporan';

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

const EVIDENCE_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
};

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

function roleOf(u: SessionUser): string {
  return String(u.role || '').toUpperCase();
}
function isSuper(u: SessionUser): boolean {
  return roleOf(u) === 'SUPERADMIN';
}
function deny(kind: string, cabang: string): never {
  throw new HttpError(403, 'Akses ditolak: Anda hanya dapat mengelola ' + kind + ' warehouse ' + cabang + '.', 'FORBIDDEN');
}
function assertOwnWarehouse(u: SessionUser, cabang: string): void {
  if (!isSuper(u) && String(u.cabang || '') !== String(cabang || '')) deny('data', u.cabang);
}
function assertTransactionAccess(u: SessionUser, cabang: string): void {
  if (!isSuper(u) && String(u.cabang || '') !== String(cabang || '')) deny('transaksi', u.cabang);
}
function assertFlazzAccess(u: SessionUser, cabang: string): void {
  if (!isSuper(u) && String(u.cabang || '') !== String(cabang || '')) deny('kartu', u.cabang);
}

async function readJson(c: Ctx): Promise<Record<string, any>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' ? b : {};
  } catch {
    return {};
  }
}

function decodeBase64(dataUri: unknown): Uint8Array {
  const raw = String(dataUri ?? '');
  const b64 = raw.split(',')[1] ?? raw;
  if (!b64) throw new Error('Data base64 tidak valid');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length > MAX_EVIDENCE_BYTES) throw new Error('Ukuran file melebihi 10MB');
  return bytes;
}

function extOf(fileName: unknown): { ext: string; contentType: string } {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName || ''));
  const raw = (m?.[1] ?? 'jpg').toLowerCase();
  const ext = EVIDENCE_EXT[raw] ? raw : 'jpg';
  return { ext, contentType: EVIDENCE_EXT[ext] ?? 'image/jpeg' };
}

async function loadCards(deps: AppDeps): Promise<{ cards: FlazzCardRow[]; cardMap: Map<string, FlazzCardRow> }> {
  const cards = await deps.laporan.findAllCards();
  const cardMap = new Map(cards.map((c) => [L.canonicalCardId(c.id), c]));
  return { cards, cardMap };
}

async function loadCardIdMap(deps: AppDeps): Promise<Map<string, string>> {
  const cards = await deps.laporan.findAllCards();
  return new Map(cards.map((c) => [L.canonicalCardId(c.id), c.id]));
}

function kendaraanInfoMap(all: { kendaraan: Array<{ vehicle_id: string; kapasitas_tangki: number; jumlah_bar: number; standar_km_l: number }> }): L.KendaraanMap {
  return new Map(all.kendaraan.map((k) => [k.vehicle_id, {
    kapasitas: L.num(k.kapasitas_tangki),
    jumlah_bar: L.num(k.jumlah_bar),
    standar: L.num(k.standar_km_l),
  }]));
}

function cabangNamaMapOf(all: { cabang: Array<{ kode_cabang: string; nama_cabang: string }> }): L.CabangNamaMap {
  return new Map(all.cabang.map((c) => [c.kode_cabang, c.nama_cabang]));
}

export function laporanRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // ── POST /api/laporan/photos (port processDailyImages) ────────────────────
  app.post('/photos', requireUser(deps), async (c) => {
    const u = c.get('user');
    const body = await readJson(c);
    const files: Record<string, string> = { odo_awal: '', odo_akhir: '' };
    if (body.foto_odo_awal) {
      try {
        const bytes = decodeBase64(body.foto_odo_awal);
        const { ext, contentType } = extOf(body.foto_odo_awal_name);
        const up = await deps.uploadEvidence(c.env as Env, { branch: u.cabang, folder: 'KM_Awal', bytes, ext, contentType });
        files.odo_awal = up.url;
      } catch (e) {
        throw new HttpError(422, 'Upload foto KM awal gagal: ' + (e as Error).message, 'UNPROCESSABLE');
      }
    }
    if (body.foto_odo_akhir) {
      try {
        const bytes = decodeBase64(body.foto_odo_akhir);
        const { ext, contentType } = extOf(body.foto_odo_akhir_name);
        const up = await deps.uploadEvidence(c.env as Env, { branch: u.cabang, folder: 'KM_Akhir', bytes, ext, contentType });
        files.odo_akhir = up.url;
      } catch (e) {
        throw new HttpError(422, 'Upload foto KM akhir gagal: ' + (e as Error).message, 'UNPROCESSABLE');
      }
    }
    return c.json(okPayload({
      files,
      km_awal: L.num(body.km_awal_val),
      km_akhir: L.num(body.km_akhir_val),
    }));
  });

  // ── POST /api/laporan (port saveTransactionEndOfDayUnlocked) ─────────────
  app.post('/', requireUser(deps), async (c) => {
    const u = c.get('user');
    const p = await readJson(c);

    const vehicleId = String(p.vehicle_id ?? '').trim();
    const kendaraan = await deps.master.findKendaraanById(vehicleId);
    if (!kendaraan) throw new HttpError(404, 'Kendaraan tidak ditemukan', 'NOT_FOUND');
    const trxCabang = kendaraan.kode_cabang || u.cabang;
    assertOwnWarehouse(u, trxCabang);

    const isJarum = String(kendaraan.jenis_indikator) === 'ANALOG_JARUM';
    const jumlahBar = isJarum ? 100 : L.num(kendaraan.jumlah_bar);
    const standarKmL = L.num(kendaraan.standar_km_l);
    const literPerBar = L.literPerBarFor(L.num(kendaraan.kapasitas_tangki), jumlahBar);

    const barAwal = L.num(p.bar_awal);
    const barAkhir = L.num(p.bar_akhir);
    const liter = L.num(p.liter_bbm);
    const literKonsumsi = L.computeLiterKonsumsi(liter, barAwal, barAkhir, literPerBar);

    const matchedJalur = await deps.laporan.findJalurByCriteria({
      tanggal: String(p.tanggal ?? ''),
      vehicle_id: vehicleId,
      nama_driver: String(p.nama_supir ?? ''),
      kode_cabang: trxCabang,
    });
    if (!matchedJalur || matchedJalur.status !== 'BELUM_DIISI') {
      throw new HttpError(409, L.MSG_JALUR_GATE, 'CONFLICT');
    }

    const prevTrx = await deps.laporan.lastForVehicle(vehicleId);
    let odo;
    try {
      odo = L.estimateOdo({
        kmAwal: L.num(p.km_awal_confirmed),
        kmAkhir: L.num(p.km_akhir_confirmed),
        kmAwalBroken: !!p.km_awal_broken,
        kmAkhirBroken: !!p.km_akhir_broken,
        kmTanpaEstimasi: !!p.km_tanpa_estimasi,
        standarKmL,
        literKonsumsi,
        prevKmAkhir: prevTrx ? prevTrx.km_akhir : null,
      });
    } catch (e) {
      if (e instanceof L.OdoEstimateError) throw new HttpError(400, e.message, 'BAD_REQUEST');
      throw e;
    }

    const efisiensi = L.computeEfisiensi(odo.kmTempuh, literKonsumsi);
    let warning = '';
    if (prevTrx && prevTrx.km_akhir !== null && odo.kmAwal !== prevTrx.km_akhir) {
      warning = L.buildOdoWarning(odo.kmAwal, prevTrx.km_akhir, prevTrx.tanggal);
    }

    const metodeBbm = String(p.metode_pembayaran ?? '');
    const cardBbm = String(p.flazz_card_id ?? '');
    const biayaBbm = L.num(p.biaya_bbm);
    const biayaTol = L.num(p.biaya_toll);
    const effMetodeToll = L.resolveTollMethod(p.metode_toll, metodeBbm, p.flazz_card_id_toll);
    const effCardToll = L.resolveTollCard(p.flazz_card_id_toll, effMetodeToll, metodeBbm, cardBbm);

    const { cardMap } = await loadCards(deps);
    const checks = L.buildFlazzChecks(metodeBbm, cardBbm, biayaBbm, effMetodeToll, effCardToll, biayaTol)
      .map((chk) => ({ ...chk, cardId: cardMap.get(L.canonicalCardId(chk.cardId))?.id ?? chk.cardId }));
    for (const chk of checks) {
      const info = cardMap.get(L.canonicalCardId(chk.cardId));
      if (!info) throw new HttpError(409, L.msgCardNotFound(chk.label, chk.cardId), 'CONFLICT');
      if (L.num(info.last_balance) < chk.total) {
        throw new HttpError(409, L.msgInsufficient(info.card_name || chk.cardId, chk.label, L.num(info.last_balance), chk.total), 'CONFLICT');
      }
    }

    const storeMetodeBbm = L.storeMetodeBbm(biayaBbm, metodeBbm);
    const serverData = p.serverData && typeof p.serverData === 'object' ? p.serverData : {};
    const sfiles = serverData.files && typeof serverData.files === 'object' ? serverData.files : {};

    const dupKey: L.DuplicateKey = {
      vehicle_id: vehicleId,
      tanggal: String(p.tanggal ?? ''),
      km_awal: String(odo.kmAwal),
      km_akhir: String(odo.kmAkhir),
      liter: String(liter),
      biaya_bbm: String(biayaBbm),
      biaya_toll: String(biayaTol),
    };
    const candidates = await deps.laporan.duplicateCandidates(trxCabang, 200);
    if (candidates.some((r) => L.isDuplicateRow(r, dupKey))) {
      throw new HttpError(409, L.MSG_DUPLICATE, 'CONFLICT');
    }

    const trxTs = new Date();
    const transaction_id = newId('TRX-');
    const row: LaporanInsert = {
      transaction_id,
      timestamp: trxTs.toISOString(),
      tanggal: String(p.tanggal ?? ''),
      user_id: u.user_id,
      nama_pengguna: u.nama || u.username,
      kode_cabang: trxCabang,
      vehicle_id: vehicleId,
      plat_nomor: kendaraan.plat_nomor,
      foto_km_awal: String(sfiles.odo_awal ?? ''),
      ocr_km_awal: String(serverData.km_awal ?? p.km_awal_val ?? ''),
      km_awal_confirmed: String(odo.kmAwal),
      bar_awal: String(barAwal),
      foto_km_akhir: String(sfiles.odo_akhir ?? ''),
      ocr_km_akhir: String(serverData.km_akhir ?? p.km_akhir_val ?? ''),
      km_akhir_confirmed: String(odo.kmAkhir),
      bar_akhir: String(barAkhir),
      km_tempuh: odo.kmTempuh,
      perubahan_bar: barAwal - barAkhir,
      liter_bbm: liter,
      biaya_bbm: biayaBbm,
      foto_struk_bbm: String(sfiles.struk_bbm ?? ''),
      biaya_toll: biayaTol,
      foto_struk_toll: String(sfiles.struk_toll ?? ''),
      km_per_liter: L.num(efisiensi),
      status: 'COMPLETED',
      warning,
      nama_supir: String(p.nama_supir ?? ''),
      metode_pembayaran: storeMetodeBbm,
      flazz_card_id: cardBbm,
      km_sumber: odo.kmSumber,
      metode_toll: effMetodeToll,
      flazz_card_id_toll: effCardToll,
    };
    await deps.laporan.insert(row);

    const usedFlazz = storeMetodeBbm === 'FLAZZ' || effMetodeToll === 'FLAZZ';
    if (checks.length) {
      const charged: Array<{ cardId: string; amount: number }> = [];
      try {
        for (const chk of checks) {
          await deps.laporan.adjustBalance(chk.cardId, -chk.total);
          charged.push({ cardId: chk.cardId, amount: chk.total });
        }
      } catch (e) {
        for (const cc of charged) {
          try { await deps.laporan.adjustBalance(cc.cardId, cc.amount); } catch { /* refund best-effort */ }
        }
        try { await deps.laporan.delete(transaction_id); } catch { /* rollback best-effort */ }
        if (e instanceof CardBalanceError) {
          const chk = checks.find((x) => L.canonicalCardId(x.cardId) === L.canonicalCardId(e.cardId));
          const info = cardMap.get(L.canonicalCardId(e.cardId));
          throw new HttpError(409, L.msgInsufficient(info?.card_name || e.cardId, chk?.label ?? [], e.balance, chk?.total ?? 0), 'CONFLICT');
        }
        throw new HttpError(409, (e as Error).message, 'CONFLICT');
      }
      for (const chk of checks) {
        const info = cardMap.get(L.canonicalCardId(chk.cardId));
        if (info && String(info.status) === 'NONAKTIF') continue;
        if (await deps.laporan.hasActiveUsage(chk.cardId)) continue;
        await deps.laporan.createUsage({
          cardId: chk.cardId, driverName: String(p.nama_supir ?? ''), vehicleId,
          refType: 'TRX', refId: transaction_id, usedAt: trxTs.toISOString(),
        });
      }
    }

    await deps.laporan.setJalurStatus(matchedJalur.id, 'SUDAH_LAPORAN', transaction_id);
    await deps.recordAudit({
      user_id: u.user_id, username: u.username, action: 'CREATE', modul: 'transaksi',
      keterangan: 'TRX ' + transaction_id,
      data_sesudah: jsonSnip({ cabang: trxCabang, vehicle: kendaraan.plat_nomor, km_tempuh: odo.kmTempuh, liter, biaya: biayaBbm }),
    });
    await invalidateLaporanCaches(deps.kv, roleOf(u), u.cabang);
    if (usedFlazz) await bumpMasterRev(deps.kv);

    return c.json(okPayload({ transaction_id }));
  });

  // ── GET /api/laporan/prefill (port getLastLaporanPrefill) ─────────────────
  app.get('/prefill', requireUser(deps), async (c) => {
    const u = c.get('user');
    const cabang = isSuper(u) ? '' : u.cabang;
    const rows = await deps.laporan.recentRows(cabang, 2000);
    const cardIdMap = await loadCardIdMap(deps);
    let pref: L.Prefill | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (!row || !row.vehicle_id) continue;
      pref = L.mapPrefillRow(row, cardIdMap);
      break;
    }
    return c.json(okPayload({ pref }));
  });

  // ── GET /api/laporan/performa (port getPerformaSummary) ──────────────────
  app.get('/performa', requireUser(deps), async (c) => {
    const u = c.get('user');
    const cabang = isSuper(u) ? '' : u.cabang;
    const key = performaCacheKey(roleOf(u), cabang);
    const cached = await deps.kv.get(key, 'json');
    if (cached) return c.json(okPayload({ items: cached }));
    const rows = await deps.laporan.rowsInScope(cabang, 5000);
    const all = await deps.master.listAll();
    const items = L.buildPerformaList(rows, kendaraanInfoMap(all), cabangNamaMapOf(all));
    await deps.kv.put(key, JSON.stringify(items), { expirationTtl: 300 });
    return c.json(okPayload({ items }));
  });

  // ── PUT /api/laporan/:id (port editDailyTransactionUnlocked) ─────────────
  app.put('/:id', requireUser(deps), async (c) => {
    const u = c.get('user');
    const id = c.req.param('id');
    const p = await readJson(c);

    const old = await deps.laporan.findById(id);
    if (!old) throw new HttpError(404, L.MSG_TRX_NOT_FOUND, 'NOT_FOUND');

    const f = L.cardFields(old);
    const oldMetode = String(f.mBbm ?? '');
    const oldCard = String(f.cBbm ?? '');
    const oldBiaya = L.num(f.bBbm);
    const oldToll = L.num(f.bTol);
    const oldLiter = L.num(old.liter_bbm);
    const oldNama = String(old.nama_supir ?? '');
    const oldMetodeToll = String(old.metode_toll ?? '') !== '' ? String(old.metode_toll) : (oldMetode === 'FLAZZ' ? 'FLAZZ' : 'TUNAI');
    const oldCardToll = (oldMetodeToll === 'FLAZZ' && !String(old.flazz_card_id_toll ?? '')) ? oldCard : String(old.flazz_card_id_toll ?? '');

    const { cardMap } = await loadCards(deps);
    const vehicleBranch = (await deps.master.findKendaraanById(old.vehicle_id))?.kode_cabang ?? old.kode_cabang;
    let branch = vehicleBranch;
    if (oldMetode === 'FLAZZ') branch = cardMap.get(L.canonicalCardId(oldCard))?.branch_id ?? vehicleBranch;
    else if (oldMetodeToll === 'FLAZZ' && oldCardToll) branch = cardMap.get(L.canonicalCardId(oldCardToll))?.branch_id ?? vehicleBranch;
    assertTransactionAccess(u, branch);

    const newMetode = L.parseEditMethod(p.metode_pembayaran, oldMetode);
    const newBiaya = L.parseEditAmount(p.biaya_bbm, oldBiaya);
    const newToll = L.parseEditAmount(p.biaya_toll, oldToll);

    const rawCard = (p.flazz_card_id !== undefined && p.flazz_card_id !== null) ? String(p.flazz_card_id).trim() : '';
    let newCard = '';
    if (newMetode === 'FLAZZ') {
      newCard = rawCard || (oldMetode === 'FLAZZ' ? oldCard : '');
      if (!newCard) throw new HttpError(400, L.MSG_PICK_FLAZZ, 'BAD_REQUEST');
      if (newCard !== oldCard) {
        const target = cardMap.get(L.canonicalCardId(newCard));
        if (!target) throw new HttpError(400, L.MSG_CARD_TARGET_NOT_FOUND, 'BAD_REQUEST');
        assertFlazzAccess(u, target.branch_id);
      }
    }

    const newMetodeToll = L.resolveTollMethod(p.metode_toll, newMetode, p.flazz_card_id_toll);
    const rawCardToll = (p.flazz_card_id_toll !== undefined && p.flazz_card_id_toll !== null) ? String(p.flazz_card_id_toll).trim() : '';
    let newCardToll = '';
    if (newMetodeToll === 'FLAZZ') {
      newCardToll = rawCardToll || (oldMetodeToll === 'FLAZZ' ? oldCardToll : '') || (newMetode === 'FLAZZ' ? newCard : '');
      if (!newCardToll) throw new HttpError(400, L.MSG_PICK_FLAZZ_TOLL, 'BAD_REQUEST');
      if (newCardToll !== oldCardToll) {
        const target = cardMap.get(L.canonicalCardId(newCardToll));
        if (!target) throw new HttpError(400, L.MSG_CARD_TARGET_NOT_FOUND, 'BAD_REQUEST');
        assertFlazzAccess(u, target.branch_id);
      }
    }

    const oldPayState = { metodeBbm: oldMetode, cardBbm: oldCard, biayaBbm: oldBiaya, metodeTol: oldMetodeToll, cardTol: oldCardToll, biayaTol: oldToll };
    const newPayState = { metodeBbm: newMetode, cardBbm: newCard, biayaBbm: newBiaya, metodeTol: newMetodeToll, cardTol: newCardToll, biayaTol: newToll };
    const involved = L.distinctFlazzCards(oldPayState.metodeBbm, oldPayState.cardBbm, oldPayState.metodeTol, oldPayState.cardTol)
      .concat(L.distinctFlazzCards(newPayState.metodeBbm, newPayState.cardBbm, newPayState.metodeTol, newPayState.cardTol))
      .filter((x, i, a) => a.indexOf(x) === i);

    for (const cardId of involved) {
      const delta = L.flazzEditDelta(oldPayState, newPayState, cardId);
      if (delta < 0) {
        const info = cardMap.get(L.canonicalCardId(cardId));
        const bal = info ? L.num(info.last_balance) : 0;
        if (bal + delta < 0) throw new HttpError(409, L.msgEditInsufficient(bal), 'CONFLICT');
      }
    }

    const newTgl = (p.tanggal !== undefined && p.tanggal !== '') ? String(p.tanggal) : String(old.tanggal);
    const newNama = (p.nama_supir !== undefined && p.nama_supir !== null && String(p.nama_supir) !== '') ? String(p.nama_supir) : oldNama;
    const newLiter = (p.liter_bbm !== undefined && p.liter_bbm !== null) ? L.num(p.liter_bbm) : oldLiter;
    const newBarAwal = p.bar_awal !== undefined ? L.num(p.bar_awal) : L.num(old.bar_awal);
    const newBarAkhir = p.bar_akhir !== undefined ? L.num(p.bar_akhir) : L.num(old.bar_akhir);
    const newKmAwal = p.km_awal !== undefined ? L.num(p.km_awal) : L.num(old.km_awal_confirmed);
    const newKmAkhir = p.km_akhir !== undefined ? L.num(p.km_akhir) : L.num(old.km_akhir_confirmed);

    const patch: Partial<LaporanInsert> = {
      metode_pembayaran: (newBiaya > 0 || newMetode === 'FLAZZ') ? newMetode : '',
      flazz_card_id: newCard,
      biaya_bbm: newBiaya,
      biaya_toll: newToll,
      metode_toll: newMetodeToll,
      flazz_card_id_toll: newCardToll,
      liter_bbm: newLiter,
      nama_supir: newNama,
      km_awal_confirmed: String(newKmAwal),
      km_akhir_confirmed: String(newKmAkhir),
      km_tempuh: newKmAkhir - newKmAwal,
      bar_awal: String(newBarAwal),
      bar_akhir: String(newBarAkhir),
      tanggal: newTgl,
    };
    if (p.km_awal !== undefined || p.km_akhir !== undefined) patch.km_sumber = 'AKTUAL';

    if (p.foto_odo_awal) {
      try {
        const bytes = decodeBase64(p.foto_odo_awal);
        const { ext, contentType } = extOf(p.foto_odo_awal_name ?? 'odo_awal.jpg');
        const up = await deps.uploadEvidence(c.env as Env, { branch: u.cabang, folder: 'KM_Awal', bytes, ext, contentType });
        const oldKey = extractStorageKey(String(old.foto_km_awal ?? ''));
        if (oldKey) await deps.deleteEvidence(c.env as Env, oldKey);
        patch.foto_km_awal = up.url;
      } catch (e) {
        throw new HttpError(422, 'Upload foto odometer awal gagal: ' + (e as Error).message, 'UNPROCESSABLE');
      }
    }
    if (p.foto_odo_akhir) {
      try {
        const bytes = decodeBase64(p.foto_odo_akhir);
        const { ext, contentType } = extOf(p.foto_odo_akhir_name ?? 'odo_akhir.jpg');
        const up = await deps.uploadEvidence(c.env as Env, { branch: u.cabang, folder: 'KM_Akhir', bytes, ext, contentType });
        const oldKey = extractStorageKey(String(old.foto_km_akhir ?? ''));
        if (oldKey) await deps.deleteEvidence(c.env as Env, oldKey);
        patch.foto_km_akhir = up.url;
      } catch (e) {
        throw new HttpError(422, 'Upload foto odometer akhir gagal: ' + (e as Error).message, 'UNPROCESSABLE');
      }
    }

    await deps.laporan.update(id, patch);

    const txStampMs = L.parseTimestampMs(old.timestamp) ?? L.parseTanggalMs(old.tanggal);
    for (const cardId of involved) {
      const delta = L.flazzEditDelta(oldPayState, newPayState, cardId);
      if (delta === 0) continue;
      const info = cardMap.get(L.canonicalCardId(cardId));
      const masterId = info?.id ?? cardId;
      try {
        await deps.laporan.adjustBalance(masterId, delta);
      } catch (e) {
        if (e instanceof CardBalanceError) {
          const bal = L.num((await deps.laporan.findFlazzCardById(masterId))?.last_balance ?? e.balance);
          throw new HttpError(409, L.msgEditInsufficient(bal), 'CONFLICT');
        }
        throw e;
      }
      if (L.shouldAdjustUsageOpeningAt(txStampMs, await deps.laporan.latestGivenAt(masterId))) {
        await deps.laporan.adjustActiveUsageOpening(masterId, delta);
      }
    }

    const wasBbmFlazz = oldMetode === 'FLAZZ' && !!oldCard;
    const isBbmFlazz = newMetode === 'FLAZZ' && !!newCard;
    const wasTolFlazz = oldMetodeToll === 'FLAZZ' && !!oldCardToll;
    const isTolFlazz = newMetodeToll === 'FLAZZ' && !!newCardToll;
    const newly: string[] = [];
    if (isBbmFlazz && L.shouldAutoCreateUsageOnEdit(wasBbmFlazz, isBbmFlazz)) newly.push(newCard);
    if (isTolFlazz && L.shouldAutoCreateUsageOnEdit(wasTolFlazz, isTolFlazz)) newly.push(newCardToll);
    for (const cardId of newly.filter((x, i, a) => a.indexOf(x) === i)) {
      const info = cardMap.get(L.canonicalCardId(cardId));
      const masterId = info?.id ?? cardId;
      if (await deps.laporan.hasActiveUsage(masterId)) continue;
      await deps.laporan.createUsage({ cardId: masterId, driverName: newNama, vehicleId: old.vehicle_id, refType: 'TRX', refId: id, usedAt: old.timestamp });
    }

    const linkChanged = String(newTgl) !== String(old.tanggal) || String(newNama) !== String(oldNama);
    if (linkChanged) await deps.laporan.releaseJalurReport(id);
    const matched = await deps.laporan.findJalurByCriteria({ tanggal: newTgl, vehicle_id: old.vehicle_id, nama_driver: newNama, kode_cabang: old.kode_cabang });
    if (matched && matched.status !== 'SELESAI') await deps.laporan.setJalurStatus(matched.id, 'SUDAH_LAPORAN', id);

    await deps.recordAudit({
      user_id: u.user_id, username: u.username, action: 'EDIT', modul: 'transaksi', keterangan: id,
      data_sebelum: jsonSnip({ metode_pembayaran: oldMetode, flazz_card_id: oldCard, biaya_bbm: oldBiaya, biaya_toll: oldToll, metode_toll: oldMetodeToll, flazz_card_id_toll: oldCardToll }),
      data_sesudah: jsonSnip({ metode_pembayaran: newMetode, flazz_card_id: newCard, biaya_bbm: newBiaya, biaya_toll: newToll, metode_toll: newMetodeToll, flazz_card_id_toll: newCardToll }),
    });
    await invalidateLaporanCaches(deps.kv, roleOf(u), u.cabang);
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: L.MSG_EDIT_SUCCESS }));
  });

  // ── DELETE /api/laporan/:id (port deleteDailyTransactionUnlocked) ───────
  app.delete('/:id', requireUser(deps), async (c) => {
    const u = c.get('user');
    const id = c.req.param('id');
    const old = await deps.laporan.findById(id);
    if (!old) throw new HttpError(404, L.MSG_TRX_NOT_FOUND, 'NOT_FOUND');

    const f = L.cardFields(old);
    const metodeBbm = String(f.mBbm ?? '');
    const cardBbm = String(f.cBbm ?? '');
    const biaya = L.num(f.bBbm);
    const toll = L.num(f.bTol);
    const metodeToll = String(old.metode_toll ?? '') !== '' ? String(old.metode_toll) : (metodeBbm === 'FLAZZ' ? 'FLAZZ' : 'TUNAI');
    const cardToll = (metodeToll === 'FLAZZ' && !String(old.flazz_card_id_toll ?? '')) ? cardBbm : String(old.flazz_card_id_toll ?? '');

    const { cardMap } = await loadCards(deps);
    const vehicleBranch = (await deps.master.findKendaraanById(old.vehicle_id))?.kode_cabang ?? old.kode_cabang;
    let branch = vehicleBranch;
    if (metodeBbm === 'FLAZZ') branch = cardMap.get(L.canonicalCardId(cardBbm))?.branch_id ?? vehicleBranch;
    else if (metodeToll === 'FLAZZ' && cardToll) branch = cardMap.get(L.canonicalCardId(cardToll))?.branch_id ?? vehicleBranch;
    assertTransactionAccess(u, branch);

    const payState = { metodeBbm, cardBbm, biayaBbm: biaya, metodeTol: metodeToll, cardTol: cardToll, biayaTol: toll };
    const cards = L.distinctFlazzCards(payState.metodeBbm, payState.cardBbm, payState.metodeTol, payState.cardTol);
    const txStampMs = L.parseTimestampMs(old.timestamp) ?? L.parseTanggalMs(old.tanggal);

    await deps.laporan.delete(id);

    for (const cardId of cards) {
      const info = cardMap.get(L.canonicalCardId(cardId));
      const masterId = info?.id ?? cardId;
      const delta = L.flazzCardCharge(payState, cardId);
      if (delta > 0) {
        await deps.laporan.adjustBalance(masterId, delta);
        if (L.shouldAdjustUsageOpeningAt(txStampMs, await deps.laporan.latestGivenAt(masterId))) {
          await deps.laporan.adjustActiveUsageOpening(masterId, delta);
        }
      }
      await deps.laporan.returnUsageForRef('TRX', id);
    }

    await deps.laporan.releaseJalurReport(id);
    await deps.recordAudit({
      user_id: u.user_id, username: u.username, action: 'DELETE', modul: 'transaksi', keterangan: id,
      data_sebelum: jsonSnip({ metode_pembayaran: metodeBbm, flazz_card_id: cardBbm, biaya_bbm: biaya, biaya_toll: toll, metode_toll: metodeToll, flazz_card_id_toll: cardToll, vehicle_id: old.vehicle_id, kode_cabang: old.kode_cabang, tanggal: old.tanggal }),
    });
    await invalidateLaporanCaches(deps.kv, roleOf(u), u.cabang);
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: L.MSG_DELETE_SUCCESS }));
  });

  return app;
}

export function dashboardRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // ── GET /api/dashboard (port getDashboardData) ───────────────────────────
  app.get('/', requireUser(deps), async (c) => {
    const u = c.get('user');
    const cabang = isSuper(u) ? '' : u.cabang;
    const all = await deps.master.listAll();
    const cardIdMap = await loadCardIdMap(deps);
    const rows = await deps.laporan.recentRows(cabang, 2000);
    const transactions = L.buildRecentList(rows, kendaraanInfoMap(all), cabangNamaMapOf(all), cardIdMap);

    const periode = L.periodKey(new Date());
    const mkey = monthlyCacheKey(roleOf(u), cabang);
    let monthly = await deps.kv.get(mkey, 'json') as L.MonthlyItem[] | null;
    if (!monthly) {
      const monthRows = await deps.laporan.rowsInMonth(cabang, periode);
      monthly = L.groupMonthly(monthRows, periode);
      await deps.kv.put(mkey, JSON.stringify(monthly), { expirationTtl: 300 });
    }
    return c.json(okPayload({ transactions, monthly }));
  });

  return app;
}