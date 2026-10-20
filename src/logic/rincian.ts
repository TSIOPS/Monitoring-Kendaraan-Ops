// Logika MURNI rincian pengeluaran per nota (spec 2026-10-21-rincian-pengeluaran-design.md).
// Rincian dijumlahkan ke kolom slot lama (grup-1 + grup-2) sehingga rekon, saldo kartu, dan
// rekap tetap memakai logika yang sudah ada. Maks 2 cara bayar per jenis (batas slot).
import { canonicalCardId, cardGroups, num } from './laporan';
import type { LaporanRow, RincianItem } from './laporan';

export type { RincianItem };
export const MAKS_BARIS = 30;
export const MAKS_KETERANGAN = 100;
export const MAKS_NOMINAL = 100_000_000;
export const MAKS_KARTU = 64;
export const MSG_RINCIAN_TIDAK_VALID = 'Rincian pengeluaran tidak valid.';
export const MSG_RINCIAN_MAKS_BARIS = `Rincian pengeluaran maksimal ${MAKS_BARIS} baris.`;

export interface SlotPembayaran {
  metode_pembayaran: string; flazz_card_id: string; biaya_bbm: number;
  metode_toll: string; flazz_card_id_toll: string; biaya_toll: number;
  flazz_card_id_2: string; biaya_bbm_2: number; flazz_card_id_toll_2: string; biaya_toll_2: number;
}

export function normalRincian(raw: unknown): { items: RincianItem[]; galat: string[] } {
  if (!Array.isArray(raw)) return { items: [], galat: [MSG_RINCIAN_TIDAK_VALID] };
  if (raw.length > MAKS_BARIS) return { items: [], galat: [MSG_RINCIAN_MAKS_BARIS] };
  const items: RincianItem[] = [];
  const galat: string[] = [];
  raw.forEach((x, i) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const jenis = String(o.jenis ?? '').trim().toUpperCase();
    const nominal = Math.round(num(o.nominal));
    const keterangan = String(o.keterangan ?? '').trim();
    const kartu = String(o.kartu ?? '').trim();
    const n = i + 1;
    if (jenis !== 'BBM' && jenis !== 'TOL') galat.push(`Baris ${n}: jenis harus BBM atau Tol.`);
    if (!Number.isFinite(nominal) || !(nominal > 0)) galat.push(`Baris ${n}: nominal harus lebih dari 0.`);
    else if (nominal > MAKS_NOMINAL) galat.push(`Baris ${n}: nominal maksimal Rp 100.000.000.`);
    if (kartu.length > MAKS_KARTU) galat.push(`Baris ${n}: kartu tidak valid.`);
    if (keterangan.length > MAKS_KETERANGAN) galat.push(`Baris ${n}: keterangan maksimal ${MAKS_KETERANGAN} karakter.`);
    items.push({ jenis: jenis as RincianItem['jenis'], nominal, kartu, keterangan });
  });
  return { items, galat };
}

// Sumber bayar per jenis, urut kemunculan pertama; kartu dibandingkan kanonis.
function sumberPer(items: RincianItem[], jenis: RincianItem['jenis']) {
  const map = new Map<string, { kartu: string; total: number }>();
  for (const it of items) {
    if (it.jenis !== jenis) continue;
    const key = it.kartu ? canonicalCardId(it.kartu) : 'TUNAI';
    const s = map.get(key) ?? { kartu: it.kartu, total: 0 };
    s.total += it.nominal;
    map.set(key, s);
  }
  return [...map.values()];
}

export function rincianKeSlot(items: RincianItem[], labelKartu: (id: string) => string = (id) => id): { slot: SlotPembayaran; galat: string[] } {
  const bbm = sumberPer(items, 'BBM');
  const tol = sumberPer(items, 'TOL');
  const galat: string[] = [];
  for (const [label, daftar] of [['BBM', bbm], ['Tol', tol]] as const) {
    if (daftar.length > 2) {
      const nama = daftar.map((s) => (s.kartu ? labelKartu(s.kartu) : 'Tunai')).join(', ');
      galat.push(`${label} dibayar dengan ${daftar.length} cara (${nama}). Maksimal 2 cara per jenis — gabungkan atau pindahkan salah satu.`);
    }
  }
  const [b1, b2] = bbm;
  const [t1, t2] = tol;
  return {
    galat,
    slot: {
      metode_pembayaran: b1?.kartu ? 'FLAZZ' : 'TUNAI', flazz_card_id: b1?.kartu ?? '', biaya_bbm: b1?.total ?? 0,
      metode_toll: t1?.kartu ? 'FLAZZ' : 'TUNAI', flazz_card_id_toll: t1?.kartu ?? '', biaya_toll: t1?.total ?? 0,
      flazz_card_id_2: b2?.kartu ?? '', biaya_bbm_2: b2?.total ?? 0,
      flazz_card_id_toll_2: t2?.kartu ?? '', biaya_toll_2: t2?.total ?? 0,
    },
  };
}

// Laporan lama (tanpa rincian): satu baris per slot bernominal, keterangan kosong.
export function slotKeRincian(row: LaporanRow): RincianItem[] {
  const out: RincianItem[] = [];
  for (const g of cardGroups(row)) {
    if (num(g.bBbm) > 0) out.push({ jenis: 'BBM', nominal: num(g.bBbm), kartu: g.mBbm === 'FLAZZ' ? g.cBbm : '', keterangan: '' });
    if (num(g.bTol) > 0) out.push({ jenis: 'TOL', nominal: num(g.bTol), kartu: g.mTol === 'FLAZZ' ? g.cTol : '', keterangan: '' });
  }
  return out;
}

export function rincianDariRow(row: LaporanRow): { items: RincianItem[]; lama: boolean } {
  const r = Array.isArray(row.rincian) ? row.rincian : [];
  return r.length ? { items: r, lama: false } : { items: slotKeRincian(row), lama: true };
}
