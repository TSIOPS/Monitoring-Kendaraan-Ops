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

  // Route baca (prefill/performa) ditambahkan di Task 6; edit/hapus di Task 7.
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