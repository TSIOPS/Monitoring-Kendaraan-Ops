import { formatDateId, formatIdNumber } from './laporan';
import type { LaporanRow } from './laporan';
import { defaultOilIntervalKm } from './master';

export type WarningCategory = 'OLI' | 'PAJAK' | 'PAJAK_5_TAHUNAN' | 'KIR';
export type WarningSeverity = 'KRITIS' | 'PERHATIAN';

export interface WarningItem {
  kategori: WarningCategory;
  severity: WarningSeverity;
  vehicle_id: string;
  plat_nomor: string;
  kode_cabang: string;
  nama_cabang: string;
  pesan: string;
  km_sekarang?: number;
  km_target?: number;
  sisa_km?: number;
  tanggal_jatuh_tempo?: string;
  sisa_hari?: number;
}

export interface WarningVehicle {
  vehicle_id: string;
  plat_nomor: string;
  kode_cabang: string;
  status: string;
  jenis_kendaraan: string;
  tanggal_pajak: string;
  tanggal_pajak_5_tahunan: string;
  tanggal_kir: string;
  km_terakhir_ganti_oli: number;
  interval_ganti_oli_km: number;
}

export interface WarningInput {
  kendaraan: WarningVehicle[];
  user: { role: string; cabang: string };
  odoMap: Record<string, number>;
  cabangNama?: Map<string, string>;
  today: Date;
}

export const OLI_SISA_AMBANG = 50;
export const TANGGAL_SISA_AMBANG = 30;
const DAY_MS = 86400000;

const CATEGORY_LABEL: Record<Exclude<WarningCategory, 'OLI'>, string> = {
  PAJAK: 'Pajak tahunan',
  PAJAK_5_TAHUNAN: 'Pajak 5 tahunan',
  KIR: 'KIR',
};
const SEV_RANK: Record<WarningSeverity, number> = { KRITIS: 0, PERHATIAN: 1 };
const CAT_RANK: Record<WarningCategory, number> = { OLI: 0, PAJAK: 1, PAJAK_5_TAHUNAN: 2, KIR: 3 };

const toNum = (v: unknown): number => {
  const n = parseFloat(String(v ?? ''));
  return isNaN(n) ? 0 : n;
};

export function buildOdoMap(rows: LaporanRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  const maxSeq: Record<string, number> = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const vehicleId = String(r.vehicle_id ?? '');
    if (!vehicleId) continue;
    const km = toNum(r.km_akhir_confirmed);
    if (km <= 0) continue;
    const seq = typeof r.seq === 'number' ? r.seq : i;
    if ((maxSeq[vehicleId] ?? -1) <= seq) {
      maxSeq[vehicleId] = seq;
      out[vehicleId] = km;
    }
  }
  return out;
}

export function daysUntil(dateStr: string | null | undefined, today: Date): number | null {
  const s = String(dateStr ?? '').trim();
  if (!s) return null;
  const d = new Date(s.length <= 10 ? s + 'T00:00:00Z' : s);
  if (isNaN(d.getTime())) return null;
  const todayMid = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((d.getTime() - todayMid) / DAY_MS);
}

export function buildOliPesan(sisaKm: number): string {
  if (sisaKm < 0) return 'Wajib ganti oli - sudah lewat ' + formatIdNumber(-sisaKm) + ' km';
  return 'Sebentar lagi ganti oli - sisa ' + formatIdNumber(sisaKm) + ' km';
}

export function buildTanggalPesan(kategori: Exclude<WarningCategory, 'OLI'>, due: string, sisaHari: number): string {
  const label = CATEGORY_LABEL[kategori];
  const tgl = formatDateId(due);
  if (sisaHari < 0) return label + ' sudah lewat jatuh tempo ' + tgl;
  return label + ' jatuh tempo ' + tgl + ' (sisa ' + formatIdNumber(sisaHari) + ' hari)';
}

export function computeWarnings(input: WarningInput): WarningItem[] {
  const role = String(input.user.role || '').toUpperCase();
  const isSuper = role === 'SUPERADMIN';
  const cabangUser = String(input.user.cabang ?? '');
  const cabangNama = input.cabangNama ?? new Map<string, string>();
  const items: WarningItem[] = [];

  for (const v of input.kendaraan) {
    if (String(v.status || '') !== 'Aktif') continue;
    if (!isSuper && String(v.kode_cabang ?? '') !== cabangUser) continue;

    const odo = toNum(input.odoMap[v.vehicle_id]);
    if (odo > 0 && toNum(v.km_terakhir_ganti_oli) > 0) {
      const interval = toNum(v.interval_ganti_oli_km) > 0
        ? toNum(v.interval_ganti_oli_km)
        : defaultOilIntervalKm(v.jenis_kendaraan);
      const base = toNum(v.km_terakhir_ganti_oli);
      const target = base + interval;
      const sisa = target - odo;
      if (sisa <= OLI_SISA_AMBANG) {
        items.push({
          kategori: 'OLI',
          severity: sisa < 0 ? 'KRITIS' : 'PERHATIAN',
          vehicle_id: v.vehicle_id,
          plat_nomor: v.plat_nomor,
          kode_cabang: v.kode_cabang,
          nama_cabang: cabangNama.get(v.kode_cabang) ?? v.kode_cabang,
          pesan: buildOliPesan(sisa),
          km_sekarang: odo,
          km_target: target,
          sisa_km: sisa,
        });
      }
    }

    const dateSources: Array<{ kategori: Exclude<WarningCategory, 'OLI'>; field: string }> = [
      { kategori: 'PAJAK', field: v.tanggal_pajak },
      { kategori: 'PAJAK_5_TAHUNAN', field: v.tanggal_pajak_5_tahunan },
      { kategori: 'KIR', field: v.tanggal_kir },
    ];
    for (const src of dateSources) {
      const sisaHari = daysUntil(src.field, input.today);
      if (sisaHari === null || sisaHari > TANGGAL_SISA_AMBANG) continue;
      items.push({
        kategori: src.kategori,
        severity: sisaHari < 0 ? 'KRITIS' : 'PERHATIAN',
        vehicle_id: v.vehicle_id,
        plat_nomor: v.plat_nomor,
        kode_cabang: v.kode_cabang,
        nama_cabang: cabangNama.get(v.kode_cabang) ?? v.kode_cabang,
        pesan: buildTanggalPesan(src.kategori, src.field, sisaHari),
        tanggal_jatuh_tempo: src.field,
        sisa_hari: sisaHari,
      });
    }
  }

  const remOf = (i: WarningItem): number => i.sisa_km ?? i.sisa_hari ?? 0;
  items.sort((a, b) =>
    SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
    remOf(a) - remOf(b) ||
    CAT_RANK[a.kategori] - CAT_RANK[b.kategori] ||
    String(a.kode_cabang).localeCompare(String(b.kode_cabang)) ||
    String(a.plat_nomor).localeCompare(String(b.plat_nomor)),
  );
  return items;
}