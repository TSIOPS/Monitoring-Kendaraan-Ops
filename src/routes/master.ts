import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { SessionUser } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { hashPassword } from '../auth/password';
import { errPayload, HttpError, okPayload, reqIp } from '../utils/http';
import { bumpMasterRev, getMasterRev, masterCacheKey } from '../logic/master-cache';
import { defaultOilIntervalKm, getMasterPayload } from '../logic/master';
import type { AppDeps } from '../deps';

const MASTER_CACHE_TTL = 30;

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

function isSuper(u: SessionUser): boolean {
  return u.role === 'SUPERADMIN';
}
function needSuper(u: SessionUser, action: string): void {
  if (!isSuper(u)) throw new HttpError(403, 'Akses ditolak: hanya SUPERADMIN yang dapat ' + action + '.', 'FORBIDDEN');
}
function needOwn(u: SessionUser, cabang: string | undefined | null): void {
  const cabangUser = String(u.cabang || '');
  if (!cabangUser || String(cabang ?? '') !== cabangUser) {
    throw new HttpError(403, 'Akses ditolak: Anda hanya dapat mengelola data warehouse ' + cabangUser + '.', 'FORBIDDEN');
  }
}

export function newId(prefix: string): string {
  return `${prefix}${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
}
export function jsonSnip(v: unknown): string {
  if (v == null) return '';
  try {
    return JSON.stringify(v).substring(0, 2000);
  } catch {
    return '';
  }
}

export function masterRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', requireUser(deps));

  const audit = (c: Ctx, entry: Omit<Parameters<AppDeps['recordAudit']>[0], 'user_id' | 'username' | 'ip'>) =>
    deps.recordAudit({
      ...entry,
      user_id: c.get('user').user_id,
      username: c.get('user').username,
      ip: reqIp(c),
    });

  // ── CABANG (SUPERADMIN only) ─────────────────────────────────────────────
  app.post('/cabang', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'mengelola master cabang');
    const body = await c.req.json().catch(() => null);
    const kode = String((body as any)?.kode ?? '').trim();
    const nama = String((body as any)?.nama ?? '').trim();
    const lokasi = String((body as any)?.lokasi ?? '').trim();
    if (!kode || !nama) return c.json(errPayload('Kode dan nama cabang wajib diisi.', 'BAD_REQUEST'), 400);
    if (await deps.master.findCabangByKode(kode)) {
      return c.json(errPayload(`Kode cabang "${kode}" sudah terpakai.`, 'CONFLICT'), 409);
    }
    await deps.master.insertCabang({ kode_cabang: kode, nama_cabang: nama, lokasi });
    await audit(c, { action: 'CREATE', modul: 'master', keterangan: 'Cabang ' + kode, data_sesudah: jsonSnip({ kode, nama, lokasi }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Cabang Berhasil Ditambahkan' }));
  });

  app.put('/cabang', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'memperbarui master cabang');
    const body = await c.req.json().catch(() => null);
    const editId = String((body as any)?.edit_id ?? '');
    const kode = String((body as any)?.kode ?? '').trim();
    const nama = String((body as any)?.nama ?? '').trim();
    const lokasi = String((body as any)?.lokasi ?? '').trim();
    if (String(kode) !== String(editId)) {
      return c.json(errPayload('Kode cabang tidak dapat diubah. Hanya nama/lokasi yang boleh diedit.', 'BAD_REQUEST'), 400);
    }
    if (!nama) return c.json(errPayload('Nama cabang wajib diisi.', 'BAD_REQUEST'), 400);
    const target = await deps.master.findCabangByKode(editId);
    if (!target) throw new HttpError(404, 'Cabang tidak ditemukan', 'NOT_FOUND');
    const dup = await deps.master.findCabangByKode(kode);
    if (dup && dup.kode_cabang !== editId) {
      return c.json(errPayload(`Kode cabang "${kode}" sudah terpakai oleh baris lain.`, 'CONFLICT'), 409);
    }
    await deps.master.updateCabang(editId, { nama_cabang: nama, lokasi });
    await audit(c, {
      action: 'EDIT', modul: 'master', keterangan: 'Cabang ' + editId,
      data_sebelum: jsonSnip({ kode: target.kode_cabang, nama: target.nama_cabang, lokasi: target.lokasi }),
      data_sesudah: jsonSnip({ kode, nama, lokasi }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Cabang Berhasil Diupdate' }));
  });

  app.delete('/cabang/:kode', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'menghapus master cabang');
    const kode = c.req.param('kode') ?? '';
    const target = await deps.master.findCabangByKode(kode);
    if (!target) throw new HttpError(404, 'Cabang tidak ditemukan', 'NOT_FOUND');
    const refs = await deps.master.listCabangRefs(kode);
    if (refs.length > 0) {
      throw new HttpError(409, 'Cabang masih memiliki data terkait (' + refs.join(', ') + '). Hapus atau timpa data terkait terlebih dahulu.', 'CONFLICT');
    }
    await deps.master.setCabangStatus(kode, 'Non-Aktif');
    await audit(c, {
      action: 'DELETE', modul: 'master', keterangan: 'Cabang ' + kode,
      data_sebelum: jsonSnip({ kode: target.kode_cabang, nama: target.nama_cabang }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Cabang Berhasil Dihapus' }));
  });

  // ── KENDARAAN ────────────────────────────────────────────────────────────
  app.post('/kendaraan', async (c: Ctx) => {
    const u = c.get('user');
    const body = await json(c);
    if (!isSuper(u)) needOwn(u, (body as any)?.cabang);
    const id = newId('V-');
    const row = buildVehicleInsert(body, id);
    await deps.master.insertKendaraan(row);
    await audit(c, { action: 'CREATE', modul: 'master', keterangan: 'Kendaraan ' + id, data_sesudah: jsonSnip({ vehicle_id: id, plat: body?.plat, nama: body?.nama, cabang: body?.cabang }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Kendaraan Berhasil Ditambahkan' }));
  });

  app.put('/kendaraan', async (c: Ctx) => {
    const u = c.get('user');
    const body = await json(c);
    const editId = String((body as any)?.edit_id ?? '');
    const target = await deps.master.findKendaraanById(editId);
    if (!target) throw new HttpError(404, 'Kendaraan tidak ditemukan', 'NOT_FOUND');
    if (!isSuper(u)) {
      needOwn(u, target.kode_cabang);
      needOwn(u, (body as any)?.cabang);
    }
    const row = buildVehicleInsert(body, editId);
    await deps.master.updateKendaraan({ ...row, status: target.status });
    await audit(c, {
      action: 'EDIT', modul: 'master', keterangan: 'Kendaraan ' + editId,
      data_sebelum: jsonSnip({ plat: target.plat_nomor, nama: target.nama_kendaraan }),
      data_sesudah: jsonSnip({ plat: (body as any)?.plat, nama: (body as any)?.nama, cabang: (body as any)?.cabang }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Kendaraan Berhasil Diupdate' }));
  });

  app.delete('/kendaraan/:vehicleId', async (c: Ctx) => {
    const u = c.get('user');
    const vehicleId = c.req.param('vehicleId') ?? '';
    const target = await deps.master.findKendaraanById(vehicleId);
    if (!target) return c.json(okPayload({ msg: 'Kendaraan tidak ditemukan' }));
    if (!isSuper(u)) needOwn(u, target.kode_cabang);
    await deps.master.setKendaraanStatus(vehicleId, 'Non-Aktif');
    await audit(c, {
      action: 'DELETE', modul: 'master', keterangan: 'Kendaraan ' + vehicleId,
      data_sebelum: jsonSnip({ plat: target.plat_nomor, nama: target.nama_kendaraan }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Kendaraan Berhasil Dihapus' }));
  });

  app.post('/kendaraan/:vehicleId/reset-oli', async (c: Ctx) => {
    const u = c.get('user');
    const vehicleId = c.req.param('vehicleId') ?? '';
    const target = await deps.master.findKendaraanById(vehicleId);
    if (!target) throw new HttpError(404, 'Kendaraan tidak ditemukan', 'NOT_FOUND');
    if (!isSuper(u)) needOwn(u, target.kode_cabang);
    const odo = await deps.master.currentOdoPerVehicle();
    const km = odo[String(vehicleId)] ?? 0;
    const interval = target.interval_ganti_oli_km != null && String(target.interval_ganti_oli_km) !== ''
      ? target.interval_ganti_oli_km : 5000;
    const sebelum = { km_terakhir_ganti_oli: target.km_terakhir_ganti_oli, interval_ganti_oli_km: target.interval_ganti_oli_km != null && String(target.interval_ganti_oli_km) !== '' ? target.interval_ganti_oli_km : null };
    await deps.master.updateKendaraan({ ...target, km_terakhir_ganti_oli: km, interval_ganti_oli_km: interval });
    await audit(c, {
      action: 'GANTI_OLI', modul: 'kendaraan', keterangan: 'Kendaraan ' + vehicleId,
      data_sebelum: jsonSnip(sebelum), data_sesudah: jsonSnip({ km_terakhir_ganti_oli: km }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Baseline ganti oli diperbarui ke KM ' + km + '.', km }));
  });

  // ── SUPIR ────────────────────────────────────────────────────────────────
  app.post('/supir', async (c: Ctx) => {
    const u = c.get('user');
    const body = await json(c);
    if (!isSuper(u)) needOwn(u, (body as any)?.cabang);
    const id = newId('DRV-');
    await deps.master.insertSupir({ supir_id: id, nama_supir: String((body as any)?.nama ?? ''), kode_cabang: String((body as any)?.cabang ?? ''), default_vehicle_id: String((body as any)?.default_vehicle_id ?? ''), status: 'Aktif' });
    await audit(c, { action: 'CREATE', modul: 'master', keterangan: 'Supir ' + id, data_sesudah: jsonSnip({ id, nama: (body as any)?.nama, cabang: (body as any)?.cabang }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Supir Berhasil Ditambahkan' }));
  });

  app.put('/supir', async (c: Ctx) => {
    const u = c.get('user');
    const body = await json(c);
    const editId = String((body as any)?.edit_id ?? '');
    const target = await deps.master.findSupirById(editId);
    if (!target) throw new HttpError(404, 'Supir tidak ditemukan', 'NOT_FOUND');
    if (!isSuper(u)) {
      needOwn(u, target.kode_cabang);
      needOwn(u, (body as any)?.cabang);
    }
    await deps.master.updateSupir({ supir_id: editId, nama_supir: String((body as any)?.nama ?? ''), kode_cabang: String((body as any)?.cabang ?? ''), default_vehicle_id: String((body as any)?.default_vehicle_id ?? ''), status: target.status });
    await audit(c, {
      action: 'EDIT', modul: 'master', keterangan: 'Supir ' + editId,
      data_sebelum: jsonSnip({ nama: target.nama_supir, cabang: target.kode_cabang }),
      data_sesudah: jsonSnip({ nama: (body as any)?.nama, cabang: (body as any)?.cabang }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Supir Berhasil Diupdate' }));
  });

  app.delete('/supir/:id', async (c: Ctx) => {
    const u = c.get('user');
    const id = c.req.param('id') ?? '';
    const target = await deps.master.findSupirById(id);
    if (!target) throw new HttpError(404, 'Supir tidak ditemukan', 'NOT_FOUND');
    if (!isSuper(u)) needOwn(u, target.kode_cabang);
    await deps.master.setSupirStatus(id, 'Non-Aktif');
    await audit(c, { action: 'DELETE', modul: 'master', keterangan: 'Supir ' + id, data_sebelum: jsonSnip({ nama: target.nama_supir, cabang: target.kode_cabang }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Supir Berhasil Dihapus' }));
  });

  // ── BBM (SUPERADMIN only) ────────────────────────────────────────────────
  app.post('/bbm', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'menambah master BBM');
    const body = await json(c);
    const id = newId('BBM-');
    await deps.master.insertBbm({ bbm_id: id, jenis_bbm: String((body as any)?.jenis ?? ''), harga_per_liter: Number((body as any)?.harga) || 0, kode_cabang: String((body as any)?.kode_cabang ?? ''), status: 'Aktif' });
    await audit(c, { action: 'CREATE', modul: 'master', keterangan: 'BBM ' + id, data_sesudah: jsonSnip({ id, jenis: (body as any)?.jenis, harga: (body as any)?.harga }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'BBM Berhasil Ditambahkan' }));
  });

  app.put('/bbm', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'memperbarui master BBM');
    const body = await json(c);
    const editId = String((body as any)?.edit_id ?? '');
    const target = await deps.master.findBbmById(editId);
    if (!target) throw new HttpError(404, 'BBM tidak ditemukan', 'NOT_FOUND');
    await deps.master.updateBbm({ bbm_id: editId, jenis_bbm: String((body as any)?.jenis ?? ''), harga_per_liter: Number((body as any)?.harga) || 0, kode_cabang: String((body as any)?.kode_cabang ?? ''), status: 'Aktif' });
    await audit(c, {
      action: 'EDIT', modul: 'master', keterangan: 'BBM ' + editId,
      data_sebelum: jsonSnip({ jenis: target.jenis_bbm, harga: target.harga_per_liter }),
      data_sesudah: jsonSnip({ jenis: (body as any)?.jenis, harga: (body as any)?.harga }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'BBM Berhasil Diupdate' }));
  });

  app.delete('/bbm/:id', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'menghapus master BBM');
    const id = c.req.param('id') ?? '';
    const target = await deps.master.findBbmById(id);
    if (!target) throw new HttpError(404, 'BBM tidak ditemukan', 'NOT_FOUND');
    await deps.master.setBbmStatus(id, 'Non-Aktif');
    await audit(c, { action: 'DELETE', modul: 'master', keterangan: 'BBM ' + id, data_sebelum: jsonSnip({ jenis: target.jenis_bbm, harga: target.harga_per_liter }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'BBM Berhasil Dihapus' }));
  });

  // ── PENGGUNA (SUPERADMIN only) ───────────────────────────────────────────
  app.post('/pengguna', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'mengelola akun pengguna');
    const body = await json(c);
    const uname = String((body as any)?.username ?? '').trim();
    const nama = String((body as any)?.nama ?? '').trim();
    const password = String((body as any)?.password ?? '');
    const role = String((body as any)?.role ?? '');
    const cabang = String((body as any)?.cabang ?? '').trim();
    if (!uname) return c.json(errPayload('Username wajib diisi', 'BAD_REQUEST'), 400);
    if (!nama) return c.json(errPayload('Nama wajib diisi', 'BAD_REQUEST'), 400);
    if (!password) return c.json(errPayload('Password wajib diisi', 'BAD_REQUEST'), 400);
    if (role !== 'SUPERADMIN' && role !== 'PIC CABANG') return c.json(errPayload('Role tidak valid', 'BAD_REQUEST'), 400);
    if (role === 'PIC CABANG' && !cabang) return c.json(errPayload('Warehouse wajib diisi untuk PIC CABANG', 'BAD_REQUEST'), 400);
    if (await deps.master.findPenggunaByUsername(uname)) return c.json(errPayload('Username sudah terpakai', 'CONFLICT'), 409);
    const id = newId('U-');
    await deps.master.insertPengguna({ user_id: id, username: uname, password: await hashPassword(password), nama, role, kode_cabang: cabang, status: 'Aktif' });
    await audit(c, { action: 'CREATE', modul: 'pengguna', keterangan: 'Pengguna ' + uname, data_sesudah: jsonSnip({ user_id: id, username: uname, nama, role, cabang }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Pengguna Berhasil Ditambahkan' }));
  });

  app.put('/pengguna', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'mengelola akun pengguna');
    const body = await json(c);
    const userId = String((body as any)?.user_id ?? '');
    const uname = String((body as any)?.username ?? '').trim();
    const nama = String((body as any)?.nama ?? '').trim();
    const role = String((body as any)?.role ?? '');
    const cabang = String((body as any)?.cabang ?? '').trim();
    const current = await deps.master.findPenggunaById(userId);
    if (!current) throw new HttpError(404, 'Pengguna tidak ditemukan', 'NOT_FOUND');
    if (!uname) return c.json(errPayload('Username wajib diisi', 'BAD_REQUEST'), 400);
    if (!nama) return c.json(errPayload('Nama wajib diisi', 'BAD_REQUEST'), 400);
    if (role !== 'SUPERADMIN' && role !== 'PIC CABANG') return c.json(errPayload('Role tidak valid', 'BAD_REQUEST'), 400);
    if (role === 'PIC CABANG' && !cabang) return c.json(errPayload('Warehouse wajib diisi untuk PIC CABANG', 'BAD_REQUEST'), 400);
    const dup = await deps.master.findPenggunaByUsername(uname);
    if (dup && dup.user_id !== userId) return c.json(errPayload('Username sudah terpakai', 'CONFLICT'), 409);
    if (String(u.username) === String(current.username) && current.role === 'SUPERADMIN' && role !== 'SUPERADMIN') {
      const active = await deps.master.countActiveSuperadmin();
      if (active <= 1) return c.json(errPayload('Tidak bisa menghapus peran SUPERADMIN terakhir', 'CONFLICT'), 409);
    }
    const password = String((body as any)?.password ?? '');
    const newPassword = password ? await hashPassword(password) : current.password;
    await deps.master.updatePengguna({ ...current, username: uname, password: newPassword, nama, role, kode_cabang: cabang });
    await audit(c, { action: 'EDIT', modul: 'pengguna', keterangan: 'Update user ' + userId });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Pengguna Berhasil Diupdate' }));
  });

  app.delete('/pengguna/:userId', async (c: Ctx) => {
    return setStatus(c, deps, 'Non-Aktif', audit);
  });
  app.post('/pengguna/:userId/activate', async (c: Ctx) => {
    return setStatus(c, deps, 'Aktif', audit);
  });

  // ── GET / (payload lengkap sesuai role; cache KV rev-based, TTL 30 dtk) ──
  app.get('/', async (c: Ctx) => {
    const u = c.get('user');
    const rev = await getMasterRev(deps.kv);
    const ck = masterCacheKey(rev, u.role, u.cabang ?? '');
    const hit = await deps.kv.get(ck, 'json');
    if (hit) return c.json(okPayload(hit as Record<string, unknown>));

    const [raw, lastSumber] = await Promise.all([
      deps.master.listAll(),
      deps.master.currentOdoPerVehicle(),
    ]);
    const payload = getMasterPayload(
      raw,
      { role: u.role, cabang: u.cabang ?? '' },
      lastSumber as unknown as Record<string, string>,
    ) as unknown as Record<string, unknown>;
    await deps.kv.put(ck, JSON.stringify(payload), { expirationTtl: MASTER_CACHE_TTL });
    return c.json(okPayload(payload));
  });
  return app;
}

async function json(c: Context<any>): Promise<any> {
  return c.req.json().catch(() => null);
}

function buildVehicleInsert(body: any, vehicleId: string) {
  return {
    vehicle_id: vehicleId,
    plat_nomor: String(body?.plat ?? ''),
    nama_kendaraan: String(body?.nama ?? ''),
    jenis_kendaraan: String(body?.jenis ?? 'Mobil'),
    merk: String(body?.merk ?? ''),
    model: String(body?.model ?? ''),
    kapasitas_tangki: Number(body?.kapasitas_tangki) || 0,
    jumlah_bar: Number(body?.jumlah_bar) || 0,
    standar_km_l: Number(body?.standar_km_l) || 0,
    kode_cabang: String(body?.cabang ?? ''),
    status: 'Aktif',
    jenis_indikator: String(body?.jenis_indikator || 'DIGITAL_BAR'),
    tanggal_pajak: String(body?.tanggal_pajak ?? ''),
    tanggal_pajak_5_tahunan: String(body?.tanggal_pajak_5_tahunan ?? ''),
    tanggal_kir: String(body?.tanggal_kir ?? ''),
    km_terakhir_ganti_oli: Number(body?.km_terakhir_ganti_oli) || 0,
    interval_ganti_oli_km: Number(body?.interval_ganti_oli_km) || defaultOilIntervalKm(body?.jenis),
  };
}

async function setStatus(c: Ctx, deps: AppDeps, status: string, audit: (c: Ctx, entry: Omit<Parameters<AppDeps['recordAudit']>[0], 'user_id' | 'username' | 'ip'>) => void): Promise<Response> {
  const u = c.get('user');
  needSuper(u, 'mengelola status akun pengguna');
  const userId = c.req.param('userId') ?? '';
  const current = await deps.master.findPenggunaById(userId);
  if (!current) throw new HttpError(404, 'Pengguna tidak ditemukan', 'NOT_FOUND');
  if (status === 'Non-Aktif' && String(u.username) === String(current.username)) {
    throw new HttpError(409, 'Tidak bisa menonaktifkan akun sendiri', 'CONFLICT');
  }
  if (status === 'Non-Aktif' && current.role === 'SUPERADMIN') {
    const active = await deps.master.countActiveSuperadmin();
    if (active <= 1) throw new HttpError(409, 'Tidak bisa menonaktifkan SUPERADMIN aktif terakhir', 'CONFLICT');
  }
  await deps.master.setPenggunaStatus(userId, status);
  await audit(c, { action: 'DELETE', modul: 'pengguna', keterangan: (status === 'Aktif' ? 'Aktifkan ' : 'Nonaktifkan ') + userId });
  await bumpMasterRev(deps.kv);
  const msg = status === 'Aktif' ? 'Pengguna Berhasil Diaktifkan Kembali' : 'Pengguna Berhasil Dinonaktifkan';
  return c.json(okPayload({ msg }));
}