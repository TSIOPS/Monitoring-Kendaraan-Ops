// Logika MURNI jalur pengiriman. Port JalurStatus.js + bagian murni JalurOps.js (GAS).
// Tanpa I/O: tidak menyentuh env, Supabase, KV, atau Storage.

import { canonicalCardId } from './laporan';

export interface JalurFull {
  id: string;
  tanggal: string;
  driver_id: string;
  nama_driver: string;
  driver2_id: string;
  nama_driver2: string;
  vehicle_id: string;
  plat_nomor: string;
  nama_kendaraan: string;
  jenis_kendaraan: string;
  rute_tujuan: string;
  kode_cabang: string;
  flazz_card_id: string;
  flazz_card_name: string;
  flazz_card_id_2: string;
  flazz_card_name_2: string;
  created_by: string;
  created_at: string;
  updated_at: string;
  is_deleted: string;
  status: string;
  laporan_id: string;
}

export const STATUS_BELUM = 'BELUM_DIISI';
export const STATUS_LAPORAN = 'SUDAH_LAPORAN';
export const STATUS_SELESAI = 'SELESAI';

export const MSG_KARTU_SAMA = 'Kartu etoll ke-2 harus berbeda dari kartu etoll ke-1.';

const str = (v: unknown): string => String(v ?? '').trim();
export const tgl10 = (v: unknown): string => String(v ?? '').substring(0, 10);

// Kartu etoll yang ter-assign pada satu jalur; slot kosong diabaikan, tanpa duplikat.
export const MSG_DRIVER_SAMA = 'Driver 2 harus berbeda dari Driver 1.';

export function jalurCardIds(card1: unknown, card2: unknown): string[] {
  const out: string[] = [];
  for (const c of [card1, card2]) {
    const s = str(c);
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

export function cardsOf(j: Pick<JalurFull, 'flazz_card_id' | 'flazz_card_id_2'>): string[] {
  return jalurCardIds(j.flazz_card_id, j.flazz_card_id_2);
}

// Tanggal rekon terbaru per kartu (kunci canonical). Rekon terhapus tidak dihitung.
export function reconMaxTglByCard(recons: Array<{ card_id: string; date: string; is_deleted?: string | null }>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of recons) {
    if (str(r.is_deleted) === '1') continue;
    const key = canonicalCardId(r.card_id);
    const d = tgl10(r.date);
    if (!key || !d) continue;
    if (!out[key] || d > out[key]) out[key] = d;
  }
  return out;
}

// Status akhir sebuah jalur (port jalurFinalStatus):
//   belum ada laporan                                  -> BELUM_DIISI
//   ada laporan, tanpa kartu                           -> SUDAH_LAPORAN
//   ada laporan, SEMUA kartu direkon >= tanggal jalur  -> SELESAI
//   selainnya                                          -> SUDAH_LAPORAN
export function jalurFinalStatus(laporanId: unknown, cardIds: string[], tanggalJalur: unknown, reconMax: Record<string, string>): string {
  if (!str(laporanId)) return STATUS_BELUM;
  const cards = cardIds.filter((c) => str(c));
  if (!cards.length) return STATUS_LAPORAN;
  const t = tgl10(tanggalJalur);
  for (const c of cards) {
    const r = tgl10(reconMax[canonicalCardId(c)]);
    if (!r || r < t) return STATUS_LAPORAN;
  }
  return STATUS_SELESAI;
}

// Status tuntas yang dituntut gate jalur baru. Aturan pengguna (spec M8 D1):
// tanpa kartu Flazz cukup SUDAH_LAPORAN; dengan kartu (slot 1 ATAU 2) harus SELESAI.
export function statusTuntas(j: Pick<JalurFull, 'flazz_card_id' | 'flazz_card_id_2'>): string {
  return cardsOf(j).length ? STATUS_SELESAI : STATUS_LAPORAN;
}

// Jalur terakhir SEBELUM tanggal input per kendaraan yang belum tuntas.
export function findBlockers(rows: JalurFull[], vehicleIds: string[], tanggal: string): JalurFull[] {
  const input = tgl10(tanggal);
  if (!input) return [];
  const latest = new Map<string, JalurFull>();
  for (const r of rows) {
    if (str(r.is_deleted) === '1') continue;
    const vid = str(r.vehicle_id);
    if (!vehicleIds.includes(vid)) continue;
    const t = tgl10(r.tanggal);
    if (t >= input) continue;
    const prev = latest.get(vid);
    if (!prev || t > tgl10(prev.tanggal)) latest.set(vid, r);
  }
  const out: JalurFull[] = [];
  for (const vid of vehicleIds) {
    const j = latest.get(vid);
    if (j && (str(j.status) || STATUS_BELUM) !== statusTuntas(j)) out.push(j);
  }
  return out;
}

// Gate per DRIVER (Driver 1 & Driver 2), aturan tuntas sama dengan gate kendaraan:
// jalur terakhir driver di tanggal SEBELUMNYA harus tuntas, dan driver tidak boleh
// punya jalur belum tuntas di tanggal yang sama (jalur tuntas tidak memblokir). excludeId = jalur yang sedang diedit.
const punyaDriver = (r: JalurFull, id: string) => str(r.driver_id) === id || str(r.driver2_id) === id;
const namaDriverDi = (r: JalurFull, id: string) => (str(r.driver_id) === id ? str(r.nama_driver) : str(r.nama_driver2)) || id;

export function findDriverBlockers(rows: JalurFull[], driverIds: string[], tanggal: string, excludeId = ''): string[] {
  const input = tgl10(tanggal);
  const ids = [...new Set(driverIds.map(str).filter(Boolean))];
  if (!input || !ids.length) return [];
  const pesan: string[] = [];
  for (const id of ids) {
    const milik = rows.filter((r) => str(r.is_deleted) !== '1' && str(r.id) !== excludeId && punyaDriver(r, id));
    const hariSama = milik.find((r) => tgl10(r.tanggal) === input && (str(r.status) || STATUS_BELUM) !== statusTuntas(r));
    if (hariSama) {
      pesan.push('Driver ' + namaDriverDi(hariSama, id) + ' sudah terjadwal pada ' + input + ' (kendaraan ' + (hariSama.plat_nomor || hariSama.vehicle_id) + ').');
      continue;
    }
    const sebelum = milik.filter((r) => tgl10(r.tanggal) < input)
      .sort((a, b) => tgl10(b.tanggal).localeCompare(tgl10(a.tanggal)) || str(b.created_at).localeCompare(str(a.created_at)))[0];
    if (sebelum && (str(sebelum.status) || STATUS_BELUM) !== statusTuntas(sebelum)) {
      const aksi = cardsOf(sebelum).length ? 'rekonsiliasi saldo flazz' : 'input laporan';
      pesan.push('Driver ' + namaDriverDi(sebelum, id) + ' (jalur ' + tgl10(sebelum.tanggal) + ', ' + (sebelum.plat_nomor || sebelum.vehicle_id) +
        ', status ' + (sebelum.status || STATUS_BELUM) + ') masih belum selesai. Harap ' + aksi + ' terlebih dahulu.');
    }
  }
  return pesan;
}

// Driver yang muncul lebih dari sekali dalam satu kali simpan (sebagai Driver 1 atau 2).
export function driverGanda(rows: Array<{ driver_id?: unknown; driver2_id?: unknown }>): string[] {
  const hit = new Map<string, number>();
  for (const r of rows) for (const id of [str(r.driver_id), str(r.driver2_id)]) if (id) hit.set(id, (hit.get(id) ?? 0) + 1);
  return [...hit].filter(([, n]) => n > 1).map(([id]) => id);
}

export function blockerDetail(b: JalurFull): string {
  const aksi = cardsOf(b).length ? 'rekonsiliasi saldo flazz' : 'input laporan';
  return 'Kendaraan ' + (b.plat_nomor || b.id) + ' (jalur ' + tgl10(b.tanggal) + ', status ' + (b.status || STATUS_BELUM) +
    ') masih belum selesai. Harap ' + aksi + ' terlebih dahulu';
}

// Jalur TERBARU yang memakai kartu ini di slot mana pun (port findJalurByCriteria
// dengan kriteria kartu): tanggal terbesar, lalu created_at terbaru.
export function latestJalurForCard(rows: JalurFull[], cardId: string): JalurFull | null {
  const want = canonicalCardId(cardId);
  let best: JalurFull | null = null;
  for (const r of rows) {
    if (str(r.is_deleted) === '1') continue;
    if (canonicalCardId(r.flazz_card_id) !== want && canonicalCardId(r.flazz_card_id_2) !== want) continue;
    if (!best || tgl10(r.tanggal) > tgl10(best.tanggal) ||
      (tgl10(r.tanggal) === tgl10(best.tanggal) && str(r.created_at) > str(best.created_at))) best = r;
  }
  return best;
}

// Sinkron kartu per HIMPUNAN, bukan per slot: kartu yang pindah slot tidak dikembalikan.
export function cardDiff(oldCards: string[], newCards: string[]): { kembalikan: string[]; serahkan: string[] } {
  return {
    kembalikan: oldCards.filter((c) => !newCards.includes(c)),
    serahkan: newCards.filter((c) => !oldCards.includes(c)),
  };
}

export interface StatusDokumen { sisa_hari: number | null; status: string }

// Sisa hari pajak/KIR terhadap hari ini (YYYY-MM-DD, WIB). Port jalurComputePajak.
export function statusDokumen(tanggal: unknown, today: string): StatusDokumen {
  const d = tgl10(tanggal);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(today);
  if (!m || !t) return { sisa_hari: null, status: 'TIDAK_ADA' };
  const due = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!);
  const now = Date.UTC(+t[1]!, +t[2]! - 1, +t[3]!);
  const days = Math.ceil((due - now) / 86400000);
  let status = 'AMAN';
  if (days <= 0) status = 'LEWAT';
  else if (days <= 30) status = 'KRITIS';
  else if (days <= 60) status = 'WASPADA';
  return { sisa_hari: days, status };
}

// Urutan daftar: tanggal terbaru, Mobil sebelum jenis lain, lalu nama driver.
export function compareJalur(a: Pick<JalurFull, 'tanggal' | 'jenis_kendaraan' | 'nama_driver'>, b: Pick<JalurFull, 'tanggal' | 'jenis_kendaraan' | 'nama_driver'>): number {
  if (tgl10(a.tanggal) !== tgl10(b.tanggal)) return tgl10(b.tanggal).localeCompare(tgl10(a.tanggal));
  const ja = str(a.jenis_kendaraan || 'Mobil').toLowerCase();
  const jb = str(b.jenis_kendaraan || 'Mobil').toLowerCase();
  if (ja === 'mobil' && jb !== 'mobil') return -1;
  if (ja !== 'mobil' && jb === 'mobil') return 1;
  if (ja !== jb) return ja.localeCompare(jb);
  return str(a.nama_driver).localeCompare(str(b.nama_driver));
}

export interface JalurDriver {
  nama_driver: string;
  nama_driver2: string;
  driver_id: string;
  vehicle_id: string;
  plat_nomor: string;
  nama_kendaraan: string;
  flazz_card_id: string;
  flazz_card_name: string;
  flazz_card_id_2: string;
  flazz_card_name_2: string;
}

// Supir yang punya jalur BELUM_DIISI pada tanggal itu, unik per nama + kendaraan.
export function driversForDate(rows: JalurFull[], tanggal: string, cabang: string | null): JalurDriver[] {
  const input = tgl10(tanggal);
  if (!input) return [];
  const seen = new Set<string>();
  const out: JalurDriver[] = [];
  for (const r of rows) {
    if (str(r.is_deleted) === '1') continue;
    if ((str(r.status) || STATUS_BELUM) !== STATUS_BELUM) continue;
    if (tgl10(r.tanggal) !== input) continue;
    if (cabang && str(r.kode_cabang) !== cabang) continue;
    const nama = str(r.nama_driver);
    if (!nama) continue;
    const key = nama + '|' + str(r.vehicle_id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      nama_driver: nama, nama_driver2: str(r.nama_driver2), driver_id: str(r.driver_id), vehicle_id: str(r.vehicle_id),
      plat_nomor: str(r.plat_nomor), nama_kendaraan: str(r.nama_kendaraan),
      flazz_card_id: str(r.flazz_card_id), flazz_card_name: str(r.flazz_card_name),
      flazz_card_id_2: str(r.flazz_card_id_2), flazz_card_name_2: str(r.flazz_card_name_2),
    });
  }
  return out;
}

// Hari ini (YYYY-MM-DD) zona Asia/Jakarta.
export function todayWib(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
