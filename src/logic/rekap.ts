// Rekap pengeluaran: BBM & tol per metode bayar (ETOLL = kartu Flazz/etoll, TUNAI).
// Sumber: laporan harian (grup-1 + grup-2 kartu ke-2) dan tol manual modul Flazz.
import { canonicalCardId, cardGroups, num } from './laporan';
import type { LaporanRow } from './laporan';

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
}

export interface RekapCard { id: string; card_name?: string; card_number?: string; branch_id?: string }
export interface RekapTol { id: string; date: string; card_id: string; driver_id: string; vehicle_id: string; amount: number }

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
      vehicle_id: String(r.vehicle_id ?? ''), plat_nomor: String(r.plat_nomor ?? ''), supir: String(r.nama_supir ?? ''),
    };
    for (const g of cardGroups(r)) {
      const tambah = (jenis: JenisPengeluaran, metode: string, card: string, amount: number) => {
        if (!(amount > 0)) return;
        // Metode kosong dengan nominal > 0 = tunai (data lama sebelum metode dicatat).
        const etoll = metode === 'FLAZZ';
        const cid = etoll ? String(card || '') : '';
        out.push({ ...base, jenis, metode: etoll ? 'ETOLL' : 'TUNAI', card_id: cid ? (kartuById.get(canonicalCardId(cid))?.id ?? cid) : '', kartu: cid ? labelKartu(cid) : '', amount });
      };
      tambah('BBM', g.mBbm, g.cBbm, num(g.bBbm));
      tambah('TOL', g.mTol, g.cTol, num(g.bTol));
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
    });
  }

  return out.sort((a, b) => b.tanggal.localeCompare(a.tanggal) || a.plat_nomor.localeCompare(b.plat_nomor));
}
