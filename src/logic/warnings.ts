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
// ── Peringatan Dini dashboard (port warningsSummary + WarningsCore GAS) ──────

export interface DokumenAlert { tipe: 'PAJAK' | 'PAJAK5' | 'KIR'; status: string; sisa_hari: number | null; tanggal: string }
export interface PajakKirItem { vehicle_id: string; plat_nomor: string; nama_kendaraan: string; jenis: string; cabang: string; alerts: DokumenAlert[]; worst: string }
export interface SaldoItem { id: string; card_number: string; card_name: string; card_type: string; cabang: string; last_balance: number; status: string }
export interface OliItem { vehicle_id: string; plat_nomor: string; nama_kendaraan: string; cabang: string; baseline_km: number; interval_km: number; tempuh_km: number; sisa_km: number; status: 'WASPADA' | 'GANTI_OLI' }
export interface OdoEstimasiItem { vehicle_id: string; plat_nomor: string; nama_kendaraan: string; cabang: string }
export interface RingkasanPeringatan { pajakKIR: PajakKirItem[]; saldo: SaldoItem[]; oli: OliItem[]; odoEstimasi: OdoEstimasiItem[] }

type Rec = Record<string, unknown>;
export interface RingkasanInput {
  kendaraan: Rec[];
  kartu: Rec[];
  rows: Rec[];
  user: { role: string; cabang: string };
  today: string; // YYYY-MM-DD (WIB)
}

const WARN_LEVEL: Record<string, number> = { WASPADA: 1, KRITIS: 2, LEWAT: 3 };
const OIL_WASPADA_BEFORE_KM = 500;
const SALDO_RENDAH = 100000;
const s = (v: unknown): string => (v == null ? '' : String(v));

function statusTanggal(tanggal: string, today: string): { status: string; sisa_hari: number | null } {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(tanggal);
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m || !t) return { status: 'TIDAK_ADA', sisa_hari: null };
  const days = Math.ceil((Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!) - Date.UTC(+t[1]!, +t[2]! - 1, +t[3]!)) / DAY_MS);
  if (days <= 0) return { status: 'LEWAT', sisa_hari: days };
  if (days <= 30) return { status: 'KRITIS', sisa_hari: days };
  if (days <= 60) return { status: 'WASPADA', sisa_hari: days };
  return { status: 'AMAN', sisa_hari: days };
}

export function statusOli(v: Rec, currentKm: number | undefined): OliItem | null {
  const baseline = toNum(v.km_terakhir_ganti_oli);
  if (!baseline || baseline < 0) return null;
  const interval = toNum(v.interval_ganti_oli_km) > 0 ? toNum(v.interval_ganti_oli_km) : defaultOilIntervalKm(s(v.jenis_kendaraan));
  const km = currentKm === undefined || !Number.isFinite(currentKm) ? baseline : currentKm;
  const tempuh = Math.max(0, km - baseline);
  const sisa = interval - tempuh;
  let status: OliItem['status'];
  if (tempuh >= interval) status = 'GANTI_OLI';
  else if (sisa <= OIL_WASPADA_BEFORE_KM) status = 'WASPADA';
  else return null;
  return {
    vehicle_id: s(v.vehicle_id), plat_nomor: s(v.plat_nomor), nama_kendaraan: s(v.nama_kendaraan), cabang: s(v.kode_cabang),
    baseline_km: baseline, interval_km: interval, tempuh_km: tempuh, sisa_km: sisa, status,
  };
}

export function ringkasanPeringatan(input: RingkasanInput): RingkasanPeringatan {
  const isSuper = String(input.user.role || '').toUpperCase() === 'SUPERADMIN';
  const dalamScope = (cabang: unknown) => isSuper || s(cabang) === s(input.user.cabang);
  const vehs = input.kendaraan.filter((v) => s(v.status) === 'Aktif' && dalamScope(v.kode_cabang));

  // KM akhir & sumber KM dari trip terakhir per kendaraan (urutan seq).
  const terakhir = new Map<string, Rec>();
  input.rows.forEach((r, i) => {
    const vid = s(r.vehicle_id);
    if (!vid) return;
    const seq = typeof r.seq === 'number' ? r.seq : i;
    const prev = terakhir.get(vid);
    if (!prev || (prev.__seq as number) <= seq) terakhir.set(vid, { ...r, __seq: seq });
  });

  const pajakKIR: PajakKirItem[] = [];
  const oli: OliItem[] = [];
  const odoEstimasi: OdoEstimasiItem[] = [];
  for (const v of vehs) {
    const alerts: DokumenAlert[] = [];
    for (const [tipe, field] of [['PAJAK', 'tanggal_pajak'], ['PAJAK5', 'tanggal_pajak_5_tahunan'], ['KIR', 'tanggal_kir']] as const) {
      const tanggal = s(v[field]).substring(0, 10);
      const st = statusTanggal(tanggal, input.today);
      if (WARN_LEVEL[st.status]) alerts.push({ tipe, status: st.status, sisa_hari: st.sisa_hari, tanggal });
    }
    if (alerts.length) {
      const worst = alerts.reduce((w, a) => ((WARN_LEVEL[a.status] ?? 0) > (WARN_LEVEL[w] ?? 0) ? a.status : w), '');
      pajakKIR.push({
        vehicle_id: s(v.vehicle_id), plat_nomor: s(v.plat_nomor), nama_kendaraan: s(v.nama_kendaraan),
        jenis: s(v.jenis_kendaraan), cabang: s(v.kode_cabang), alerts, worst,
      });
    }
    const last = terakhir.get(s(v.vehicle_id));
    const km = last ? parseFloat(s(last.km_akhir_confirmed)) : NaN;
    const o = statusOli(v, Number.isFinite(km) ? km : undefined);
    if (o) oli.push(o);
    if (s(v.jenis_indikator) === 'ANALOG_JARUM' && last && s(last.km_sumber) === 'ESTIMASI') {
      odoEstimasi.push({ vehicle_id: s(v.vehicle_id), plat_nomor: s(v.plat_nomor), nama_kendaraan: s(v.nama_kendaraan), cabang: s(v.kode_cabang) });
    }
  }

  const minSisa = (p: PajakKirItem) => Math.min(...p.alerts.map((a) => (a.sisa_hari == null ? Infinity : a.sisa_hari)));
  pajakKIR.sort((a, b) => (WARN_LEVEL[b.worst] ?? 0) - (WARN_LEVEL[a.worst] ?? 0) || minSisa(a) - minSisa(b));
  const oliLevel = { GANTI_OLI: 2, WASPADA: 1 };
  oli.sort((a, b) => oliLevel[b.status] - oliLevel[a.status] || a.sisa_km - b.sisa_km);

  const saldo = input.kartu
    .filter((c) => dalamScope(c.branch_id) && s(c.status).toUpperCase() !== 'NONAKTIF' && toNum(c.last_balance) < SALDO_RENDAH)
    .map((c) => ({
      id: s(c.id), card_number: s(c.card_number), card_name: s(c.card_name), card_type: s(c.card_type),
      cabang: s(c.branch_id), last_balance: toNum(c.last_balance), status: s(c.status),
    }))
    .sort((x, y) => x.last_balance - y.last_balance);

  return { pajakKIR, saldo, oli, odoEstimasi };
}
