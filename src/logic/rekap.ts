// Rekap pengeluaran: BBM & tol per metode bayar (ETOLL = kartu Flazz/etoll, TUNAI).
// Sumber: laporan harian (grup-1 + grup-2 kartu ke-2) dan tol manual modul Flazz.
import { canonicalCardId, num } from './laporan';
import { rincianDariRow } from './rincian';
import type { LaporanRow } from './laporan';

export const KET_TANPA_RINCIAN = '(total, tanpa rincian)';

export type JenisPengeluaran = 'BBM' | 'TOL';
export type MetodePengeluaran = 'ETOLL' | 'TUNAI';

export interface RekapLine {
  tanggal: string;
  sumber: 'LAPORAN' | 'TOL_MANUAL';
  ref: string;
  kode_cabang: string;
  vehicle_id: string;
  plat_nomor: string;
  supir: string;
  jenis: JenisPengeluaran;
  metode: MetodePengeluaran;
  card_id: string;
  kartu: string;
  amount: number;
  keterangan: string;
}

export interface RekapCard { id: string; card_name?: string; card_number?: string; branch_id?: string }
export interface RekapTol { id: string; date: string; card_id: string; driver_id: string; vehicle_id: string; amount: number; notes?: string }

export interface RekapInput {
  rows: LaporanRow[];
  tols: RekapTol[];
  cards: RekapCard[];
  platByVehicle: Map<string, string>;
  dari: string;
  sampai: string;
  cabang: string; // '' = semua warehouse
}

const tgl10 = (v: unknown) => String(v ?? '').substring(0, 10);

export function rekapPengeluaran(input: RekapInput): RekapLine[] {
  const kartuById = new Map(input.cards.map((c) => [canonicalCardId(c.id), c]));
  const labelKartu = (id: string) => {
    const c = kartuById.get(canonicalCardId(id));
    return c ? String(c.card_name || c.card_number || c.id) : id;
  };
  const dalamRentang = (t: string) => (!input.dari || t >= input.dari) && (!input.sampai || t <= input.sampai);
  const out: RekapLine[] = [];

  for (const r of input.rows) {
    const tanggal = tgl10(r.tanggal);
    if (!dalamRentang(tanggal)) continue;
    if (input.cabang && String(r.kode_cabang) !== input.cabang) continue;
    const base = {
      tanggal, sumber: 'LAPORAN' as const, ref: String(r.transaction_id), kode_cabang: String(r.kode_cabang ?? ''),
      vehicle_id: String(r.vehicle_id ?? ''), plat_nomor: String(r.plat_nomor ?? ''), supir: [r.nama_supir, r.nama_supir_2].map((x) => String(x ?? '').trim()).filter(Boolean).join(' & '),
    };
    const { items, lama } = rincianDariRow(r);
    for (const it of items) {
      if (!(num(it.nominal) > 0)) continue;
      const cid = String(it.kartu || '');
      out.push({
        ...base, jenis: it.jenis, metode: cid ? 'ETOLL' : 'TUNAI',
        card_id: cid ? (kartuById.get(canonicalCardId(cid))?.id ?? cid) : '', kartu: cid ? labelKartu(cid) : '',
        amount: num(it.nominal), keterangan: lama ? KET_TANPA_RINCIAN : String(it.keterangan ?? ''),
      });
    }
  }

  // Tol manual (modul Flazz) selalu dibayar dengan kartu; warehouse dari kartu.
  for (const t of input.tols) {
    const tanggal = tgl10(t.date);
    if (!dalamRentang(tanggal) || !(num(t.amount) > 0)) continue;
    const kartu = kartuById.get(canonicalCardId(t.card_id));
    const cabang = String(kartu?.branch_id ?? '');
    if (input.cabang && cabang !== input.cabang) continue;
    out.push({
      tanggal, sumber: 'TOL_MANUAL', ref: String(t.id), kode_cabang: cabang,
      vehicle_id: String(t.vehicle_id ?? ''), plat_nomor: input.platByVehicle.get(String(t.vehicle_id ?? '')) ?? '',
      supir: String(t.driver_id ?? ''), jenis: 'TOL', metode: 'ETOLL',
      card_id: kartu?.id ?? String(t.card_id), kartu: labelKartu(String(t.card_id)), amount: num(t.amount),
      keterangan: String(t.notes ?? ''),
    });
  }

  return out.sort((a, b) => b.tanggal.localeCompare(a.tanggal) || a.plat_nomor.localeCompare(b.plat_nomor));
}

// Rekap top up Flazz: satu baris per top up (tidak terhapus), urut tanggal terlama.
export interface RekapTopupInput {
  topups: { id: string; date: string; card_id: string; amount: number; evidence_url?: string; notes?: string; created_by?: string }[];
  cards: RekapCard[];
  namaPengguna: Map<string, string>;
  dari: string;
  sampai: string;
  cabang: string; // '' = semua warehouse
}

export interface RekapTopupLine {
  id: string;
  tanggal: string;
  kode_cabang: string;
  card_id: string;
  kartu: string;
  nominal: number;
  keterangan: string;
  dicatat_oleh: string;
  ada_bukti: boolean;
}

export function rekapTopup(input: RekapTopupInput): RekapTopupLine[] {
  const kartuById = new Map(input.cards.map((c) => [canonicalCardId(c.id), c]));
  const out: RekapTopupLine[] = [];
  for (const t of input.topups) {
    const tanggal = tgl10(t.date);
    if ((input.dari && tanggal < input.dari) || (input.sampai && tanggal > input.sampai)) continue;
    const kartu = kartuById.get(canonicalCardId(t.card_id));
    const kode = String(kartu?.branch_id ?? '');
    if (input.cabang && kode !== input.cabang) continue;
    const oleh = String(t.created_by ?? '');
    out.push({
      id: t.id,
      tanggal,
      kode_cabang: kode,
      card_id: t.card_id,
      kartu: kartu ? String(kartu.card_name || kartu.card_number || kartu.id) : t.card_id,
      nominal: num(t.amount),
      keterangan: String(t.notes ?? ''),
      dicatat_oleh: input.namaPengguna.get(oleh) ?? oleh,
      ada_bukti: Boolean(t.evidence_url),
    });
  }
  return out.sort((a, b) => a.tanggal.localeCompare(b.tanggal));
}
