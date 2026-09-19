import type { MasterAllRaw } from '../db/master';

export interface MasterUserCtx {
  role: string;
  cabang: string;
}

export class MasterPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MasterPayloadError';
  }
}

// WarningsCore.js:61 — Motor lebih sering ganti oli daripada mobil.
export function defaultOilIntervalKm(jenis: string | undefined | null): number {
  return String(jenis || '').toLowerCase().indexOf('motor') !== -1 ? 3000 : 5000;
}

export interface MasterPayload {
  vehicles: Array<Record<string, unknown>>;
  drivers: Array<Record<string, unknown>>;
  cabangList: Array<Record<string, unknown>>;
  bbmList: Array<Record<string, unknown>>;
  flazzCards: Array<Record<string, unknown>>;
  penggunaList: Array<Record<string, unknown>>;
}

// Replika getMasterData (Code.js:200). TIDAK membaca DB — murni transformasi.
export function getMasterPayload(
  raw: MasterAllRaw,
  user: MasterUserCtx,
  lastKmSumber?: Record<string, string>,
): MasterPayload {
  const isSuper = user.role === 'SUPERADMIN';
  const lastSumber = lastKmSumber || {};

  const cabangList = isSuper
    ? raw.cabang
        .filter((c) => c.status === 'Aktif')
        .map((c) => ({ kode: c.kode_cabang, nama: c.nama_cabang }))
    : (() => {
        const mine = String(user.cabang || '');
        const own = raw.cabang.find((c) => String(c.kode_cabang) === mine && c.status === 'Aktif');
        return own ? [{ kode: own.kode_cabang, nama: own.nama_cabang }] : [{ kode: mine, nama: mine }];
      })();

  const vehicles = raw.kendaraan
    .filter((v) => v.status === 'Aktif')
    .filter((v) => isSuper || v.kode_cabang === user.cabang)
    .map((v) => {
      const jenis = v.jenis_kendaraan || 'Mobil';
      const indikator = v.jenis_indikator || 'DIGITAL_BAR';
      return {
        vehicle_id: v.vehicle_id,
        plat_nomor: v.plat_nomor,
        nama: v.nama_kendaraan,
        jenis,
        merk: v.merk,
        model: v.model,
        kapasitas_tangki: v.kapasitas_tangki,
        jumlah_bar: v.jumlah_bar,
        standar_km_l: v.standar_km_l,
        cabang: v.kode_cabang,
        jenis_indikator: indikator,
        tanggal_pajak: v.tanggal_pajak,
        tanggal_pajak_5_tahunan: v.tanggal_pajak_5_tahunan,
        tanggal_kir: v.tanggal_kir,
        km_terakhir_ganti_oli: v.km_terakhir_ganti_oli,
        interval_ganti_oli_km:
          v.interval_ganti_oli_km > 0 ? v.interval_ganti_oli_km : defaultOilIntervalKm(jenis),
        odo_estimasi_terakhir: indikator === 'ANALOG_JARUM' && lastSumber[String(v.vehicle_id)] === 'ESTIMASI',
      };
    });

  const drivers = raw.supir
    .filter((s) => s.status === 'Aktif')
    .filter((s) => isSuper || s.kode_cabang === user.cabang)
    .map((s) => ({ id: s.supir_id, nama: s.nama_supir, cabang: s.kode_cabang, default_vehicle_id: s.default_vehicle_id || '' }));

  const bbmList = isSuper
    ? raw.bbm
        .filter((b) => b.status === 'Aktif')
        .map((b) => ({ id: b.bbm_id, jenis: b.jenis_bbm, harga: b.harga_per_liter }))
    : (() => {
        const globals: Record<string, Record<string, unknown>> = {};
        const overrides: Record<string, Record<string, unknown>> = {};
        for (const b of raw.bbm) {
          if (String(b.status || '') !== 'Aktif') continue;
          const item = { bbm_id: b.bbm_id, jenis_bbm: b.jenis_bbm, harga_per_liter: b.harga_per_liter, kode_cabang: b.kode_cabang || '' };
          const key = String(b.bbm_id);
          if (b.kode_cabang) {
            if (String(b.kode_cabang) === String(user.cabang)) overrides[key] = item;
          } else {
            globals[key] = item;
          }
        }
        const merged: Record<string, Record<string, unknown>> = {};
        Object.keys(globals).forEach((k) => {
          const v = globals[k];
          if (v) merged[k] = v;
        });
        Object.keys(overrides).forEach((k) => {
          const v = overrides[k];
          if (v) merged[k] = v;
        });
        return Object.keys(merged).map((k) => merged[k]!);
      })();

  const flazzCards = (() => {
    const hasCabang = Boolean(user.cabang);
    const list = isSuper || hasCabang ? raw.flazzCard : [];
    return list
      .filter((card) => isSuper || String(card.branch_id) === String(user.cabang))
      .map((c) => ({ ...c }));
  })();

  const penggunaList = isSuper
    ? raw.pengguna.map((u) => ({
        user_id: u.user_id,
        username: u.username,
        nama: u.nama,
        role: u.role,
        cabang: u.kode_cabang,
        status: u.status,
      }))
    : [];

  return { vehicles, drivers, cabangList, bbmList, flazzCards, penggunaList };
}