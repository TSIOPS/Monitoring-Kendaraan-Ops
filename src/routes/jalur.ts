import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppDeps, SessionUser } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { HttpError, okPayload } from '../utils/http';
import { jsonSnip } from './master';
import { bumpMasterRev } from '../logic/master-cache';
import { canonicalCardId } from '../logic/laporan';
import type { FlazzCardRow } from '../db/flazz';
import * as J from '../logic/jalur';
import { bolehPakai, isBersama } from '../logic/kendaraan-bersama';

// Port JalurOps.js (GAS terbaru). Spec: docs/superpowers/specs/2026-10-06-m8-jalur-pengiriman-design.md

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

const roleOf = (u: SessionUser) => String(u.role || '').toUpperCase();
const isSuper = (u: SessionUser) => roleOf(u) === 'SUPERADMIN';
const str = (v: unknown) => String(v ?? '').trim();

function assertMasterAccess(u: SessionUser): void {
  if (roleOf(u) !== 'SUPERADMIN' && roleOf(u) !== 'PIC CABANG') {
    throw new HttpError(403, 'Akses ditolak: peran tidak dikenali.', 'FORBIDDEN');
  }
}
// Kendaraan boleh dipakai cabang pemilik dan cabang 'Dipakai juga oleh' (kendaraan bersama).
function assertKendaraanCabang(cabang: string, k: { kode_cabang: string; cabang_bersama?: string }): void {
  if (!bolehPakai(cabang, k)) {
    throw new HttpError(403, 'Akses ditolak: kendaraan tidak berada di warehouse ' + cabang + '.', 'FORBIDDEN');
  }
}

function assertOwnWarehouse(u: SessionUser, cabang: string, label: string): void {
  if (isSuper(u)) return;
  const mine = str(u.cabang);
  if (!mine || str(cabang) !== mine) {
    throw new HttpError(403, 'Akses ditolak: ' + label + ' tidak berada di warehouse ' + mine + '.', 'FORBIDDEN');
  }
}
function assertFlazzAccess(u: SessionUser, branch: string): void {
  if (isSuper(u)) return;
  if (str(branch) !== str(u.cabang)) {
    throw new HttpError(403, 'Akses ditolak: Anda hanya dapat mengelola kartu warehouse ' + u.cabang + '.', 'FORBIDDEN');
  }
}

async function readJson(c: Ctx): Promise<Record<string, any>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' ? b : {};
  } catch {
    return {};
  }
}

// Cabang yang boleh dilihat: PIC = cabangnya; SUPERADMIN = ?cabang= atau semua (null).
function scopeCabang(u: SessionUser, query: string | undefined): string | null {
  if (isSuper(u)) return str(query) || null;
  return str(u.cabang);
}

async function cardLookup(deps: AppDeps) {
  const cards = await deps.flazz.listCards();
  const map = new Map<string, FlazzCardRow>(cards.map((c) => [canonicalCardId(c.id), c]));
  return (id: unknown): FlazzCardRow | null => (str(id) ? map.get(canonicalCardId(id)) ?? null : null);
}

// Hitung ulang status jalur TERBARU yang memakai kartu ini (port recomputeJalurStatus).
// Dipanggil setelah rekonsiliasi dibuat, diubah, atau dihapus.
export async function recomputeJalurForCard(deps: AppDeps, cardId: string): Promise<string | null> {
  if (!str(cardId)) return null;
  const card = await deps.flazz.findCardById(cardId);
  const ids = [...new Set([str(cardId), card?.id ?? ''].filter(Boolean))];
  const jalur = J.latestJalurForCard(await deps.jalur.listForCards(ids), cardId);
  if (!jalur) return null;
  const cards = J.cardsOf(jalur);
  const recons = [];
  for (const cid of cards) recons.push(...await deps.flazz.listReconciliations({ cardId: cid }));
  const status = J.jalurFinalStatus(jalur.laporan_id, cards, jalur.tanggal, J.reconMaxTglByCard(recons));
  if ((str(jalur.status) || J.STATUS_BELUM) !== status) {
    await deps.jalur.update(jalur.id, { status, updated_at: new Date().toISOString() });
  }
  return status;
}

export function jalurRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', requireUser(deps));

  // ── GET /api/jalur (port getJalurByTanggal) ───────────────────────────────
  app.get('/', async (c: Ctx) => {
    const u = c.get('user');
    const tanggal = J.tgl10(c.req.query('tanggal'));
    const akhir = J.tgl10(c.req.query('tanggal_akhir')) || tanggal;
    if (!tanggal) throw new HttpError(400, 'Tanggal wajib diisi.', 'BAD_REQUEST');
    const cabang = scopeCabang(u, c.req.query('cabang'));
    if (!isSuper(u) && !cabang) return c.json(okPayload({ list: [], created_by: '' }));

    const [rows, all] = await Promise.all([deps.jalur.listRange(tanggal, akhir, cabang), deps.master.listAll()]);
    const kendaraan = new Map(all.kendaraan.map((k) => [k.vehicle_id, k]));
    const today = J.todayWib();
    const list = rows.map((r) => {
      const k = kendaraan.get(r.vehicle_id);
      const pajak = J.statusDokumen(k?.tanggal_pajak, today);
      const pajak5 = J.statusDokumen(k?.tanggal_pajak_5_tahunan, today);
      const kir = J.statusDokumen(k?.tanggal_kir, today);
      return {
        id: r.id, tanggal: J.tgl10(r.tanggal), driver_id: r.driver_id, nama_driver: r.nama_driver,
        driver2_id: r.driver2_id || '', nama_driver2: r.nama_driver2 || '', vehicle_id: r.vehicle_id,
        plat_nomor: r.plat_nomor, nama_kendaraan: r.nama_kendaraan, jenis_kendaraan: r.jenis_kendaraan,
        rute_tujuan: r.rute_tujuan, kode_cabang: r.kode_cabang,
        flazz_card_id: r.flazz_card_id || '', flazz_card_name: r.flazz_card_name || '',
        flazz_card_id_2: r.flazz_card_id_2 || '', flazz_card_name_2: r.flazz_card_name_2 || '',
        status: r.status || J.STATUS_BELUM, laporan_id: r.laporan_id || '', created_by: r.created_by,
        sisa_hari_pajak: pajak.sisa_hari, status_pajak: pajak.status,
        sisa_hari_pajak_5: pajak5.sisa_hari, status_pajak_5: pajak5.status,
        sisa_hari_kir: kir.sisa_hari, status_kir: kir.status,
      };
    }).sort(J.compareJalur);
    return c.json(okPayload({ list, created_by: list[0]?.created_by ?? '' }));
  });

  // ── GET /api/jalur/drivers (port getJalurDriversForDate) ──────────────────
  app.get('/drivers', async (c: Ctx) => {
    const u = c.get('user');
    const tanggal = J.tgl10(c.req.query('tanggal'));
    if (!tanggal) return c.json(okPayload({ list: [] }));
    const cabang = scopeCabang(u, c.req.query('cabang'));
    if (!isSuper(u) && !cabang) return c.json(okPayload({ list: [] }));
    const rows = await deps.jalur.listForDate(tanggal, cabang);
    return c.json(okPayload({ list: J.driversForDate(rows, tanggal, cabang) }));
  });

  // ── GET /api/jalur/:id (untuk halaman edit) ───────────────────────────────
  app.get('/:id', async (c: Ctx) => {
    const u = c.get('user');
    const j = await deps.jalur.findById(c.req.param('id') ?? '');
    if (!j || str(j.is_deleted) === '1') throw new HttpError(404, 'Jadwal tidak ditemukan.', 'NOT_FOUND');
    assertOwnWarehouse(u, j.kode_cabang, 'Jadwal pengiriman');
    return c.json(okPayload({ jalur: { ...j, tanggal: J.tgl10(j.tanggal), status: j.status || J.STATUS_BELUM } }));
  });

  // ── POST /api/jalur (port saveJalur) ──────────────────────────────────────
  app.post('/', async (c: Ctx) => {
    const u = c.get('user');
    assertMasterAccess(u);
    if (!isSuper(u) && !str(u.cabang)) {
      throw new HttpError(403, 'Akses ditolak: akun PIC CABANG tanpa warehouse tidak dapat menyimpan jadwal.', 'FORBIDDEN');
    }
    const p = await readJson(c);
    const tanggal = J.tgl10(p.tanggal);
    const input = (Array.isArray(p.rows) ? p.rows : []).filter((r: any) => r && str(r.driver_id) && str(r.vehicle_id) && str(r.rute_tujuan));
    if (!tanggal || !input.length) throw new HttpError(400, 'Tanggal dan minimal satu baris wajib diisi.', 'BAD_REQUEST');

    const vehicleIds = [...new Set<string>(input.map((r: any) => str(r.vehicle_id)))];
    const blockers = J.findBlockers(await deps.jalur.listForVehicles(vehicleIds), vehicleIds, tanggal);
    if (blockers.length) {
      throw new HttpError(409, 'Jalur baru diblokir: ' + blockers.map((b) => J.blockerDetail(b) + '.').join(' '), 'CONFLICT');
    }
    // Gate per driver (Driver 1 & 2): satu driver satu jalur aktif, tidak ganda di hari yang sama.
    const ganda = J.driverGanda(input);
    if (ganda.length) {
      const nama = new Map((await Promise.all(ganda.map((id) => deps.master.findSupirById(id)))).filter(Boolean).map((s) => [s!.supir_id, s!.nama_supir]));
      throw new HttpError(409, 'Jalur baru diblokir: driver ' + ganda.map((id) => nama.get(id) || id).join(', ') + ' dipilih lebih dari sekali.', 'CONFLICT');
    }
    const driverIds = input.flatMap((r: any) => [str(r.driver_id), str(r.driver2_id)]).filter(Boolean);
    const blokDriver = J.findDriverBlockers(await deps.jalur.listForDrivers(driverIds), driverIds, tanggal);
    if (blokDriver.length) throw new HttpError(409, 'Jalur baru diblokir: ' + blokDriver.join(' '), 'CONFLICT');

    const card = await cardLookup(deps);
    const createdBy = u.nama || u.username;
    const nowIso = new Date().toISOString();
    const stamp = Date.now();
    const baru: J.JalurFull[] = [];
    for (const r of input) {
      const kendaraan = await deps.master.findKendaraanById(str(r.vehicle_id));
      if (!kendaraan) throw new HttpError(400, 'Kendaraan tidak ditemukan.', 'BAD_REQUEST');
      const supir = await deps.master.findSupirById(str(r.driver_id));
      if (!supir) throw new HttpError(400, 'Driver utama tidak ditemukan.', 'BAD_REQUEST');
      const supir2 = str(r.driver2_id) ? await deps.master.findSupirById(str(r.driver2_id)) : null;
      if (str(r.driver2_id) && !supir2) throw new HttpError(400, 'Driver kedua tidak ditemukan.', 'BAD_REQUEST');
      if (supir2 && supir2.supir_id === supir.supir_id) throw new HttpError(400, J.MSG_DRIVER_SAMA, 'BAD_REQUEST');
      // Cabang jalur: PIC = cabangnya; SUPERADMIN = cabang driver untuk kendaraan bersama, selain itu cabang kendaraan.
      const cabangJalur = isSuper(u) ? (isBersama(kendaraan) ? supir.kode_cabang : kendaraan.kode_cabang) : str(u.cabang);
      assertKendaraanCabang(cabangJalur, kendaraan);
      const dipakai = J.kendaraanDipakaiCabangLain(await deps.jalur.listForVehicles([kendaraan.vehicle_id]), kendaraan.vehicle_id, tanggal, cabangJalur);
      if (dipakai) throw new HttpError(409, 'Jalur baru diblokir: ' + J.pesanDipakaiCabangLain(dipakai), 'CONFLICT');
      assertOwnWarehouse(u, supir.kode_cabang, 'driver utama');
      if (supir2) assertOwnWarehouse(u, supir2.kode_cabang, 'driver kedua');

      const id1 = str(r.etoll_card_id);
      const id2 = str(r.etoll_card_id_2);
      if (id1 && id2 && canonicalCardId(id1) === canonicalCardId(id2)) throw new HttpError(400, J.MSG_KARTU_SAMA, 'BAD_REQUEST');
      const k1 = id1 ? card(id1) : null;
      const k2 = id2 ? card(id2) : null;
      if (id1 && !k1) throw new HttpError(400, 'Kartu etoll "' + id1 + '" tidak ditemukan.', 'BAD_REQUEST');
      if (id2 && !k2) throw new HttpError(400, 'Kartu etoll "' + id2 + '" tidak ditemukan.', 'BAD_REQUEST');
      if (k1) assertFlazzAccess(u, k1.branch_id);
      if (k2) assertFlazzAccess(u, k2.branch_id);

      baru.push({
        id: 'JLR-' + stamp + '-' + baru.length, tanggal,
        driver_id: supir.supir_id, nama_driver: supir.nama_supir,
        driver2_id: supir2?.supir_id ?? '', nama_driver2: supir2?.nama_supir ?? '',
        vehicle_id: kendaraan.vehicle_id, plat_nomor: kendaraan.plat_nomor,
        nama_kendaraan: kendaraan.nama_kendaraan, jenis_kendaraan: kendaraan.jenis_kendaraan,
        rute_tujuan: str(r.rute_tujuan),
        // Jalur buatan SUPERADMIN distempel cabang kendaraan (bersama: cabang driver) agar gate laporan cocok.
        kode_cabang: cabangJalur,
        flazz_card_id: k1?.id ?? '', flazz_card_name: k1?.card_name ?? '',
        flazz_card_id_2: k2?.id ?? '', flazz_card_name_2: k2?.card_name ?? '',
        created_by: createdBy, created_at: nowIso, updated_at: nowIso, is_deleted: '',
        status: J.STATUS_BELUM, laporan_id: '',
      });
    }
    await deps.jalur.insertMany(baru);

    // Serahkan kartu etoll ke driver setelah baris tertulis (port autoCreateFlazzUsage).
    const warnings: string[] = [];
    for (const j of baru) {
      for (const [cid, nama] of [[j.flazz_card_id, j.flazz_card_name], [j.flazz_card_id_2, j.flazz_card_name_2]]) {
        if (!cid) continue;
        if (await deps.flazz.hasActiveUsage(cid)) {
          warnings.push('Kartu etoll "' + (nama || cid) + '" masih dipakai (belum dikembalikan) untuk ' + (j.nama_driver || j.driver_id) + '. Proses admin sebelumnya belum selesai.');
          continue;
        }
        await deps.flazz.createUsage({ cardId: cid!, driverName: j.nama_driver, vehicleId: j.vehicle_id, refType: 'JALUR', refId: j.id, usedAt: nowIso });
      }
    }
    if (baru.some((j) => J.cardsOf(j).length)) await bumpMasterRev(deps.kv);

    await deps.recordAudit({
      user_id: u.user_id, username: u.username, action: 'CREATE', modul: 'jalur',
      keterangan: tanggal + ' (' + baru.length + ' baris)',
      data_sesudah: jsonSnip({ tanggal, kode_cabang: baru[0]?.kode_cabang ?? '', jumlah: baru.length }),
    });
    return c.json(okPayload({
      msg: baru.length + ' jadwal pengiriman berhasil disimpan.', saved: baru.length,
      ...(warnings.length ? { warnings } : {}),
    }));
  });

  // ── PUT /api/jalur/:id (port updateJalur) ─────────────────────────────────
  app.put('/:id', async (c: Ctx) => {
    const u = c.get('user');
    assertMasterAccess(u);
    const id = c.req.param('id') ?? '';
    const p = await readJson(c);
    const old = await deps.jalur.findById(id);
    if (!old) throw new HttpError(404, 'Jadwal tidak ditemukan.', 'NOT_FOUND');
    assertOwnWarehouse(u, old.kode_cabang, 'Jadwal pengiriman');

    const card = await cardLookup(deps);
    const patch: Partial<J.JalurFull> = {};

    // Validasi referensi SEBELUM menulis apa pun.
    if (p.driver_id !== undefined && str(p.driver_id)) {
      const s = await deps.master.findSupirById(str(p.driver_id));
      if (!s) throw new HttpError(400, 'Driver utama tidak ditemukan.', 'BAD_REQUEST');
      assertOwnWarehouse(u, s.kode_cabang, 'driver utama');
      patch.driver_id = s.supir_id;
      patch.nama_driver = s.nama_supir;
    }
    if (p.driver2_id !== undefined) {
      if (str(p.driver2_id)) {
        const s = await deps.master.findSupirById(str(p.driver2_id));
        if (!s) throw new HttpError(400, 'Driver kedua tidak ditemukan.', 'BAD_REQUEST');
        assertOwnWarehouse(u, s.kode_cabang, 'driver kedua');
        patch.driver2_id = s.supir_id;
        patch.nama_driver2 = s.nama_supir;
      } else {
        patch.driver2_id = '';
        patch.nama_driver2 = '';
      }
    }
    if (p.vehicle_id !== undefined) {
      const k = await deps.master.findKendaraanById(str(p.vehicle_id));
      if (!k) throw new HttpError(400, 'Kendaraan tidak ditemukan.', 'BAD_REQUEST');
      assertKendaraanCabang(str(old.kode_cabang), k);
      patch.vehicle_id = k.vehicle_id;
      patch.plat_nomor = k.plat_nomor;
      patch.nama_kendaraan = k.nama_kendaraan;
      patch.jenis_kendaraan = k.jenis_kendaraan;
    }

    const drv1 = patch.driver_id ?? old.driver_id;
    const drv2 = patch.driver2_id ?? old.driver2_id;
    if (str(drv2) && str(drv1) === str(drv2)) throw new HttpError(400, J.MSG_DRIVER_SAMA, 'BAD_REQUEST');

    const oldCards = J.cardsOf(old);
    const id1 = p.etoll_card_id !== undefined ? str(p.etoll_card_id) : old.flazz_card_id;
    const id2 = p.etoll_card_id_2 !== undefined ? str(p.etoll_card_id_2) : old.flazz_card_id_2;
    if (id1 && id2 && canonicalCardId(id1) === canonicalCardId(id2)) throw new HttpError(400, J.MSG_KARTU_SAMA, 'BAD_REQUEST');
    for (const cid of [id1, id2]) {
      if (cid && !card(cid)) throw new HttpError(400, 'Kartu etoll "' + cid + '" tidak ditemukan.', 'BAD_REQUEST');
    }
    const k1 = card(id1);
    const k2 = card(id2);
    if (p.etoll_card_id !== undefined) {
      if (k1) assertFlazzAccess(u, k1.branch_id);
      patch.flazz_card_id = k1?.id ?? '';
      patch.flazz_card_name = k1?.card_name ?? '';
    }
    if (p.etoll_card_id_2 !== undefined) {
      if (k2) assertFlazzAccess(u, k2.branch_id);
      patch.flazz_card_id_2 = k2?.id ?? '';
      patch.flazz_card_name_2 = k2?.card_name ?? '';
    }
    const newCards = J.jalurCardIds(patch.flazz_card_id ?? old.flazz_card_id, patch.flazz_card_id_2 ?? old.flazz_card_id_2);
    const { kembalikan, serahkan } = J.cardDiff(oldCards, newCards);
    // Kartu lama yang dikembalikan juga wajib cabang PIC (kaskade mengubah status kartu).
    for (const cid of kembalikan) assertFlazzAccess(u, card(cid)?.branch_id ?? '');

    // Gate: kendaraan BARU harus lolos gate yang sama seperti saat membuat jalur.
    const tanggalBaru = p.tanggal !== undefined ? J.tgl10(p.tanggal) : J.tgl10(old.tanggal);
    if (patch.vehicle_id && patch.vehicle_id !== old.vehicle_id) {
      const blockers = J.findBlockers(await deps.jalur.listForVehicles([patch.vehicle_id]), [patch.vehicle_id], tanggalBaru);
      if (blockers.length) {
        throw new HttpError(409, J.blockerDetail(blockers[0]!) + ' sebelum memindahkan jalur ini ke kendaraan tersebut.', 'CONFLICT');
      }
    }
    const vidCek = patch.vehicle_id ?? old.vehicle_id;
    if (vidCek && (patch.vehicle_id !== undefined || p.tanggal !== undefined)) {
      const dipakai = J.kendaraanDipakaiCabangLain(await deps.jalur.listForVehicles([vidCek]), vidCek, tanggalBaru, str(old.kode_cabang), old.id);
      if (dipakai) throw new HttpError(409, J.pesanDipakaiCabangLain(dipakai), 'CONFLICT');
    }
    // Gate per driver saat driver/tanggal berubah (jalur ini sendiri dikecualikan).
    const d1 = str(patch.driver_id ?? old.driver_id);
    const d2 = str(patch.driver2_id ?? old.driver2_id);
    const driverBerubah = (patch.driver_id !== undefined && patch.driver_id !== old.driver_id)
      || (patch.driver2_id !== undefined && patch.driver2_id !== old.driver2_id)
      || tanggalBaru !== J.tgl10(old.tanggal);
    if (driverBerubah) {
      const cek = [d1, d2].filter(Boolean);
      const blok = J.findDriverBlockers(await deps.jalur.listForDrivers(cek), cek, tanggalBaru, old.id);
      if (blok.length) throw new HttpError(409, blok.join(' '), 'CONFLICT');
    }
    if (p.tanggal !== undefined) patch.tanggal = tanggalBaru;
    if (p.rute_tujuan !== undefined) patch.rute_tujuan = str(p.rute_tujuan);
    const updatedAt = new Date().toISOString();
    patch.updated_at = updatedAt;
    await deps.jalur.update(id, patch);

    const namaDriver = patch.nama_driver ?? old.nama_driver;
    const vid = patch.vehicle_id ?? old.vehicle_id;
    for (const cid of kembalikan) await deps.flazz.returnActiveUsageForCard(cid);
    for (const cid of serahkan) {
      if (await deps.flazz.hasActiveUsage(cid)) continue;
      await deps.flazz.createUsage({ cardId: cid, driverName: namaDriver, vehicleId: vid, refType: 'JALUR', refId: id, usedAt: updatedAt });
    }
    if (kembalikan.length || serahkan.length) await bumpMasterRev(deps.kv);

    await deps.recordAudit({
      user_id: u.user_id, username: u.username, action: 'EDIT', modul: 'jalur', keterangan: id,
      data_sesudah: jsonSnip({
        tanggal: patch.tanggal ?? old.tanggal, driver_id: patch.driver_id ?? old.driver_id, vehicle_id: vid,
        rute_tujuan: patch.rute_tujuan ?? old.rute_tujuan, flazz_card_id: newCards[0] ?? '', flazz_card_id_2: newCards[1] ?? '',
      }),
    });
    return c.json(okPayload({ msg: 'Jadwal berhasil diperbarui.' }));
  });

  // ── DELETE /api/jalur/:id (port deleteJalur) ──────────────────────────────
  app.delete('/:id', async (c: Ctx) => {
    const u = c.get('user');
    assertMasterAccess(u);
    const id = c.req.param('id') ?? '';
    const old = await deps.jalur.findById(id);
    if (!old) throw new HttpError(404, 'Jadwal tidak ditemukan.', 'NOT_FOUND');
    assertOwnWarehouse(u, old.kode_cabang, 'Jadwal pengiriman');
    const cards = J.cardsOf(old);
    const card = await cardLookup(deps);
    for (const cid of cards) assertFlazzAccess(u, card(cid)?.branch_id ?? '');

    for (const cid of cards) await deps.flazz.returnActiveUsageForCard(cid);
    await deps.jalur.delete(id);
    if (cards.length) await bumpMasterRev(deps.kv);
    await deps.recordAudit({
      user_id: u.user_id, username: u.username, action: 'DELETE', modul: 'jalur', keterangan: id,
      data_sebelum: jsonSnip({ tanggal: old.tanggal, driver_id: old.driver_id, vehicle_id: old.vehicle_id, rute_tujuan: old.rute_tujuan, flazz_card_id: cards.join(', ') }),
    });
    return c.json(okPayload({ msg: 'Jadwal berhasil dihapus.' }));
  });

  return app;
}
