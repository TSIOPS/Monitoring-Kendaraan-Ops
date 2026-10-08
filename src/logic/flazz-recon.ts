// Logika MURNI rekonsiliasi Flazz model GAS (spec M9 §3–§5). Port computeFlazzLedger,
// hasCompliantFlazzLaporan, jalurTerkaitSudahDilaporkan, saveFlazzRecon, deleteFlazzRecon.
// Perbedaan sengaja (D1): bagian kartu memakai cardGroups M7 sehingga grup-2 ikut dihitung.

import type { LaporanRow } from './laporan';
import { canonicalCardId, cardGroups, flazzBbmShare, flazzTolShare, isFlazzRowForCard, num } from './laporan';

export interface UsageLike {
  id: string;
  card_id: string;
  status: string;
  date: string;
  used_at: string;
  returned_at: string;
  opening_balance: number;
  driver_id: string;
  vehicle_id: string;
  ref_type: string;
  ref_id: string;
}
export interface LedgerItemLike { card_id: string; amount: number; date: string; created_at: string; is_deleted: string }
export interface ReconLike { id: string; card_id: string; date: string; reconciled_at: string; is_deleted: string; opening_balance: number }

export const RECON_TOLERANCE = 1;
export const STATUS_SESUAI = 'SESUAI';
export const STATUS_PERIKSA = 'PERLU_PEMERIKSAAN';

export const MSG_GATE_JALUR = 'Laporan pengiriman sudah diinput (tanpa pengeluaran kartu); rekon pengembalian diperbolehkan.';
export const MSG_GATE_OK = 'Laporan valid dengan foto KM awal & akhir terdeteksi.';
export const MSG_GATE_TIDAK = 'Belum ada laporan valid dengan foto KM awal & akhir pada periode kartu ini.';
export const MSG_RECON_DIBLOKIR = 'Rekonsiliasi diblokir: belum ada laporan valid dengan foto KM awal & akhir pada periode kartu. Harap input laporan dahulu.';

export function ms(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const t = new Date(String(v)).getTime();
  return Number.isNaN(t) ? null : t;
}

const sameCard = (a: unknown, b: unknown) => !!String(a ?? '').trim() && canonicalCardId(a) === canonicalCardId(b);
const alive = (x: { is_deleted?: string }) => String(x.is_deleted ?? '') !== '1';

// Penyerahan DIBERIKAN terbaru untuk kartu (GAS: baris DIBERIKAN terakhir).
export function latestActiveUsage<T extends UsageLike>(usages: T[], cardId: string): T | null {
  let best: T | null = null;
  for (const u of usages) {
    if (!sameCard(u.card_id, cardId) || u.status !== 'DIBERIKAN') continue;
    if (!best || (ms(u.used_at || u.date) ?? 0) >= (ms(best.used_at || best.date) ?? 0)) best = u;
  }
  return best;
}

export const usageSince = (u: UsageLike | null): number | null => (u ? ms(u.used_at || u.date) : null);

export interface Ledger { total_topup: number; total_bbm_flazz: number; total_tol: number }

// Ketat: transaksi tepat pada momen penyerahan sudah masuk opening_balance. Tanggal
// tidak terbaca dianggap di luar periode bila periode dibatasi.
export function computeLedger(
  cardId: string, since: number | null,
  topups: LedgerItemLike[], tols: LedgerItemLike[], laporan: LaporanRow[],
): Ledger {
  const after = (v: unknown) => {
    if (since === null) return true;
    const t = ms(v);
    return t !== null && t > since;
  };
  const out: Ledger = { total_topup: 0, total_bbm_flazz: 0, total_tol: 0 };
  for (const t of topups) if (sameCard(t.card_id, cardId) && alive(t) && after(t.created_at || t.date)) out.total_topup += num(t.amount);
  for (const t of tols) if (sameCard(t.card_id, cardId) && alive(t) && after(t.created_at || t.date)) out.total_tol += num(t.amount);
  for (const r of laporan) {
    if (!after(r.timestamp || r.tanggal)) continue;
    out.total_bbm_flazz += flazzBbmShare(r, cardId);
    out.total_tol += flazzTolShare(r, cardId);
  }
  return out;
}

export interface ReconNumbers extends Ledger {
  opening_balance: number;
  flazz_balance: number;
}

export function reconNumbers(usageOpening: number, currentBalance: number, l: Ledger): ReconNumbers {
  const opening = usageOpening > 0 ? usageOpening : currentBalance + l.total_bbm_flazz + l.total_tol - l.total_topup;
  return { ...l, opening_balance: opening, flazz_balance: opening + l.total_topup - l.total_bbm_flazz - l.total_tol };
}

export function reconStatus(flazzBalance: number, actual: number): { difference: number; status: string } {
  const difference = flazzBalance - actual;
  return { difference, status: Math.abs(difference) <= RECON_TOLERANCE ? STATUS_SESUAI : STATUS_PERIKSA };
}

// Laporan BBM pada periode (timestamp >= since) yang melibatkan kartu, berfoto KM awal+akhir,
// dan (kecuali ANALOG_JARUM) KM awal & akhir > 0.
export function hasCompliantLaporan(cardId: string, since: number | null, laporan: LaporanRow[], jenisIndikator: Map<string, string>): boolean {
  for (const r of laporan) {
    if (since !== null) {
      const t = ms(r.timestamp || r.tanggal);
      if (t === null || t < since) continue;
    }
    if (!isFlazzRowForCard(r, cardId)) continue;
    if (!String(r.foto_km_awal ?? '').trim() || !String(r.foto_km_akhir ?? '').trim()) continue;
    if ((jenisIndikator.get(r.vehicle_id) || 'DIGITAL_BAR') === 'ANALOG_JARUM') return true;
    if (num(r.km_awal_confirmed) > 0 && num(r.km_akhir_confirmed) > 0) return true;
  }
  return false;
}

// Kartu sedang diserahkan lewat jalur yang sudah dilaporkan (tanpa pengeluaran kartu).
export function jalurSudahDilaporkan(cardId: string, usages: UsageLike[], jalurStatus: Map<string, string>): boolean {
  return usages.some((u) => sameCard(u.card_id, cardId) && u.status === 'DIBERIKAN' && u.ref_type === 'JALUR' &&
    ['SUDAH_LAPORAN', 'SELESAI'].includes(jalurStatus.get(u.ref_id) ?? ''));
}

export function reconGate(compliant: boolean, viaJalur: boolean): { eligible: boolean; reason: string } {
  if (viaJalur) return { eligible: true, reason: MSG_GATE_JALUR };
  if (compliant) return { eligible: true, reason: MSG_GATE_OK };
  return { eligible: false, reason: MSG_GATE_TIDAK };
}

export const reconTs = (r: ReconLike): number | null => ms(r.reconciled_at) ?? ms(r.date);

// Alasan penolakan hapus rekon (null = boleh). Urutan pemeriksaan sama dengan GAS.
export function deleteRecon409(
  recon: ReconLike, recons: ReconLike[], laporan: LaporanRow[], topups: LedgerItemLike[], usages: UsageLike[],
): string | null {
  const ts = reconTs(recon);
  if (ts === null) return 'Waktu rekonsiliasi tidak valid.';
  for (const o of recons) {
    if (o.id === recon.id || !sameCard(o.card_id, recon.card_id) || !alive(o)) continue;
    const t = reconTs(o);
    if (t !== null && t > ts) return 'Hanya baris rekonsiliasi TERAKHIR untuk kartu ini yang dapat dihapus.';
  }
  for (const r of laporan) {
    const t = ms(r.timestamp);
    if (t === null || t <= ts) continue;
    for (const g of cardGroups(r)) {
      if (g.mBbm === 'FLAZZ' && sameCard(g.cBbm, recon.card_id)) return 'Ada laporan BBM ber-Flazz baru setelah rekonsiliasi ini. Batalkan aktivitas tersebut atau buat rekonsiliasi baru.';
      if (g.mTol === 'FLAZZ' && sameCard(g.cTol, recon.card_id)) return 'Ada laporan tol ber-Flazz baru setelah rekonsiliasi ini. Batalkan aktivitas tersebut atau buat rekonsiliasi baru.';
    }
  }
  for (const t of topups) {
    const d = ms(t.created_at || t.date);
    if (sameCard(t.card_id, recon.card_id) && alive(t) && d !== null && d > ts) return 'Ada Top Up baru setelah rekonsiliasi ini. Hapus/dibatalkan terlebih dahulu.';
  }
  for (const u of usages) {
    const d = ms(u.used_at);
    if (sameCard(u.card_id, recon.card_id) && u.status === 'DIBERIKAN' && d !== null && d > ts) {
      return 'Kartu sudah diserahkan lagi setelah rekonsiliasi ini (DIBERIKAN baru). Selesaikan penggunaan tersebut terlebih dahulu.';
    }
  }
  return null;
}

// Laporan yang sudah tercakup rekonsiliasi (rekon kartunya dibuat pada/setelah laporan) dikunci:
// pembayaran Flazz-nya tidak boleh diubah, dilepas, atau dihapus agar saldo tidak bergeser
// dari saldo fisik yang sudah dicocokkan. Hapus rekonsiliasinya dulu bila perlu dikoreksi.
export function laporanTerkunciRekon(cardIds: string[], waktuLaporan: number | null, recons: ReconLike[]): string | null {
  if (waktuLaporan === null || !cardIds.length) return null;
  for (const o of recons) {
    if (!alive(o) || !cardIds.some((c) => sameCard(c, o.card_id))) continue;
    const t = reconTs(o);
    if (t !== null && t >= waktuLaporan) {
      return 'Laporan ini sudah tercakup rekonsiliasi kartu Flazz tanggal ' + String(o.date || o.reconciled_at).slice(0, 10) +
        '. Pembayaran Flazz tidak dapat diubah, dilepas, atau dihapus. Hapus rekonsiliasi tersebut terlebih dahulu bila memang perlu dikoreksi.';
    }
  }
  return null;
}

// Tandai item History yang terkunci rekonsiliasi (aturan sama dengan server: Lepas Flazz = kartu BBM,
// hapus = semua kartu laporan).
export function tandaiKunciRekon<T extends {
  timestamp: number; sub_timestamp: number; metode_pembayaran: string; flazz_card_id: string; metode_toll: string;
  flazz_card_id_toll: string; flazz_card_id_2: string; flazz_card_id_toll_2: string; kunci_lepas?: boolean; kunci_hapus?: boolean;
}>(items: T[], recons: ReconLike[]): T[] {
  for (const t of items) {
    const waktu = t.sub_timestamp || t.timestamp || null;
    const bbm = [t.metode_pembayaran === 'FLAZZ' ? t.flazz_card_id : '', t.flazz_card_id_2].filter(Boolean);
    const semua = [...bbm, t.metode_toll === 'FLAZZ' ? t.flazz_card_id_toll : '', t.flazz_card_id_toll_2].filter(Boolean);
    t.kunci_lepas = !!laporanTerkunciRekon(bbm, waktu, recons);
    t.kunci_hapus = !!laporanTerkunciRekon(semua, waktu, recons);
  }
  return items;
}

// Penyerahan yang ditutup rekon ini: DIKEMBALIKAN terakhir dengan returned_at <= waktu rekon.
export function usageClosedBy<T extends UsageLike>(recon: ReconLike, usages: T[]): T | null {
  const ts = reconTs(recon) ?? 0;
  let best: T | null = null;
  for (const u of usages) {
    if (!sameCard(u.card_id, recon.card_id) || u.status !== 'DIKEMBALIKAN') continue;
    const r = ms(u.returned_at);
    if (r === null || r <= ts) {
      if (!best || (ms(u.returned_at) ?? 0) >= (ms(best.returned_at) ?? 0)) best = u;
    }
  }
  return best;
}

export interface BbmFlazzItem {
  transaction_id: string;
  tanggal: string;
  timestamp: string;
  evidence: string;
  toll_evidence: string;
  driver: string;
  vehicle: string;
  card_id: string;
  amount: number;
  toll_amount: number;
}

// Pengeluaran BBM/tol per kartu dari laporan (port bagian bbmFlazz getFlazzDashboardData).
export function buildBbmFlazz(rows: LaporanRow[], resolve: (raw: unknown) => string | null): BbmFlazzItem[] {
  const out: BbmFlazzItem[] = [];
  for (const r of rows) {
    const base = {
      transaction_id: r.transaction_id, tanggal: r.tanggal, timestamp: r.timestamp,
      evidence: r.foto_struk_bbm, toll_evidence: r.foto_struk_toll, driver: r.nama_supir, vehicle: r.plat_nomor,
    };
    for (const g of cardGroups(r)) {
      const bbmCard = g.cBbm ? resolve(g.cBbm) : null;
      const tolCard = g.cTol ? resolve(g.cTol) : null;
      const same = !!bbmCard && bbmCard === tolCard;
      if (g.mBbm === 'FLAZZ' && bbmCard && g.bBbm > 0) {
        out.push({ ...base, card_id: bbmCard, amount: g.bBbm, toll_amount: g.mTol === 'FLAZZ' && same ? g.bTol : 0 });
      }
      if (g.mTol === 'FLAZZ' && tolCard && g.bTol > 0 && !(same && g.mBbm === 'FLAZZ' && g.bBbm > 0)) {
        out.push({ ...base, card_id: tolCard, amount: 0, toll_amount: g.bTol });
      }
    }
  }
  return out;
}
