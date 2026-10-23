// Kas kecil (docs/superpowers/specs/2026-10-23-kas-kecil-design.md): fungsi murni tanpa akses DB.

export interface KasKeluarRow {
  id: string;
  kode_cabang: string;
  tanggal: string;
  jam: string;
  no_referensi: string;
  penerima: string;
  penerima_2?: string;
  admin: string;
  jenis_id: string;
  kode_akun: string;
  jenis: string;
  pecahan: Record<string, number>;
  jumlah: number;
  keterangan: string;
  bukti_url?: string; // foto bukti setor bank
  status: string; // 'Open' | 'Closed'
  no_kas_masuk: string;
  created_by?: string;
  created_at?: string;
  is_deleted: string;
}

export interface KasMasukRow {
  id: string;
  kode_cabang: string;
  tanggal: string;
  jam: string;
  no_kas_keluar: string; // '' = Tambah Saldo
  no_referensi: string;
  penerima: string;
  penerima_2?: string;
  admin: string;
  jenis_id?: string;
  kode_akun?: string;
  jenis: string;
  pecahan: Record<string, number>;
  jumlah: number;
  keterangan: string;
  created_by?: string;
  created_at?: string;
  is_deleted: string;
}

export interface SaldoAwal { tanggal: string; jumlah: number; pecahan?: Record<string, number>; dana_mingguan?: number }

const tgl10 = (v: unknown) => String(v ?? '').substring(0, 10);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const aktif = (r: { is_deleted?: string }) => String(r.is_deleted ?? '') !== '1';
// Dua nama penerima (driver + pendamping) ditampilkan 'A / B'.
export const gabungNama = (r: { penerima?: string; penerima_2?: string }) => [r.penerima, r.penerima_2].map((x) => String(x ?? '').trim()).filter(Boolean).join(' / ');

// ── Pecahan uang ────────────────────────────────────────────────────────────
// Kunci = nilai pecahan; 'K1000' = koin Rp1.000 (Excel punya 2 baris 1000: kertas & koin).
export const PECAHAN = ['100000', '50000', '20000', '10000', '5000', '2000', '1000', 'K1000', '500', '200', '100', '50'] as const;
export const PECAHAN_OPNAME = ['100000', '75000', '50000', '20000', '10000', '5000', '2000', '1000', 'K1000', '500', '200', '100', '50'] as const;
const nilaiPecahan = (k: string) => Number(k.replace('K', ''));

export function normalPecahan(input: unknown, daftar: readonly string[] = PECAHAN): Record<string, number> {
  if (input == null || input === '') return {};
  if (typeof input !== 'object' || Array.isArray(input)) throw new Error('Pecahan uang tidak valid.');
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (!daftar.includes(k)) throw new Error('Pecahan tidak dikenal: ' + k);
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 1_000_000) throw new Error('Jumlah lembar/keping pecahan ' + k + ' harus bilangan bulat 0–1.000.000.');
    if (n > 0) out[k] = n;
  }
  return out;
}

export function jumlahPecahan(p: Record<string, number>): number {
  return Object.entries(p ?? {}).reduce((n, [k, v]) => n + nilaiPecahan(k) * num(v), 0);
}

// ── Penomoran ───────────────────────────────────────────────────────────────
export type AwalanNomor = 'KK' | 'KM' | 'BO' | 'BP';

export function tipeWh(namaCabang: string): 'WHO' | 'WHP' {
  return /^\s*whp\b/i.test(namaCabang) ? 'WHP' : 'WHO';
}

export function nomorKas(awalan: AwalanNomor, tipe: 'WHO' | 'WHP', kode: string, tanggal: string, urut: number): string {
  return `${awalan}-${tipe}-${kode}-${tgl10(tanggal).replace(/-/g, '')}${String(urut).padStart(4, '0')}`;
}

// Urutan berikutnya: maksimum urutan nomor berawalan sama (cabang + bulan yang sama) + 1.
export function urutBerikut(ids: string[], awalan: AwalanNomor, tipe: 'WHO' | 'WHP', kode: string, tanggal: string): number {
  const awal = `${awalan}-${tipe}-${kode}-${tgl10(tanggal).slice(0, 7).replace('-', '')}`;
  let maks = 0;
  for (const id of ids) {
    if (!id.startsWith(awal)) continue;
    const sisa = id.slice(awal.length); // DD + NNNN
    if (!/^\d{6}$/.test(sisa)) continue;
    maks = Math.max(maks, Number(sisa.slice(2)));
  }
  return maks + 1;
}

// ── Laporan harian ──────────────────────────────────────────────────────────
export interface BarisLaporan {
  nomor: string;
  tanggal: string;
  jam: string;
  jenis: 'KELUAR' | 'MASUK';
  nomorKK: string;
  nomorKM: string;
  referensi: string;
  nama: string;
  admin: string;
  kodeAkun: string;
  namaJenis: string;
  debit: number;
  kredit: number;
  saldo: number;
  status: string;
}

export interface LaporanHarian {
  tanggal: string;
  saldoAwal: number;
  baris: BarisLaporan[];
  ringkasan: { saldoAwal: number; keluar: number; masuk: number; belumSelesai: number; saldoAkhir: number };
}

export function laporanHarian(i: { awal: SaldoAwal | null; keluar: KasKeluarRow[]; masuk: KasMasukRow[]; tanggal: string }): LaporanHarian {
  const hari = tgl10(i.tanggal);
  const mulai = i.awal ? tgl10(i.awal.tanggal) : '';
  const keluar = i.keluar.filter(aktif).filter((r) => !mulai || tgl10(r.tanggal) >= mulai);
  const masuk = i.masuk.filter(aktif).filter((r) => !mulai || tgl10(r.tanggal) >= mulai);
  let saldo = (i.awal ? num(i.awal.jumlah) : 0)
    + masuk.filter((r) => tgl10(r.tanggal) < hari).reduce((n, r) => n + num(r.jumlah), 0)
    - keluar.filter((r) => tgl10(r.tanggal) < hari).reduce((n, r) => n + num(r.jumlah), 0);
  const saldoAwal = saldo;

  const kkById = new Map(i.keluar.map((r) => [r.id, r]));
  // Status KK pada tanggal laporan: baru Closed bila KM-nya bertanggal ≤ hari itu (laporan lama tidak berubah saat KK diselesaikan kemudian).
  const tglKM = new Map(i.masuk.filter(aktif).map((m) => [m.id, tgl10(m.tanggal)]));
  const statusPada = (r: KasKeluarRow) => (r.status === 'Closed' && (!r.no_kas_masuk || (tglKM.get(r.no_kas_masuk) ?? '') <= hari) ? 'Closed' : 'Open');
  type Ev = { waktu: string; baris: Omit<BarisLaporan, 'saldo'> };
  const ev: Ev[] = [];
  for (const r of keluar.filter((x) => tgl10(x.tanggal) === hari)) {
    ev.push({ waktu: r.jam, baris: { nomor: r.id, tanggal: hari, jam: r.jam, jenis: 'KELUAR', nomorKK: r.id, nomorKM: statusPada(r) === 'Closed' ? r.no_kas_masuk : '', referensi: r.no_referensi, nama: gabungNama(r), admin: r.admin, kodeAkun: r.kode_akun, namaJenis: r.jenis, debit: 0, kredit: num(r.jumlah), status: statusPada(r) } });
  }
  for (const r of masuk.filter((x) => tgl10(x.tanggal) === hari)) {
    const asal = kkById.get(r.no_kas_keluar);
    ev.push({ waktu: r.jam, baris: { nomor: r.id, tanggal: hari, jam: r.jam, jenis: 'MASUK', nomorKK: r.no_kas_keluar, nomorKM: r.id, referensi: r.no_referensi || asal?.no_referensi || '', nama: gabungNama(r) || (asal ? gabungNama(asal) : ''), admin: r.admin, kodeAkun: r.kode_akun || asal?.kode_akun || '', namaJenis: r.jenis || asal?.jenis || '', debit: num(r.jumlah), kredit: 0, status: r.no_kas_keluar ? 'Closed' : '' } });
  }
  ev.sort((a, b) => a.waktu.localeCompare(b.waktu));
  const baris = ev.map((e) => { saldo += e.baris.debit - e.baris.kredit; return { ...e.baris, saldo }; });

  const hariIni = keluar.filter((x) => tgl10(x.tanggal) === hari);
  return {
    tanggal: hari,
    saldoAwal,
    baris,
    ringkasan: {
      saldoAwal,
      keluar: hariIni.reduce((n, r) => n + num(r.jumlah), 0),
      masuk: masuk.filter((x) => tgl10(x.tanggal) === hari).reduce((n, r) => n + num(r.jumlah), 0),
      belumSelesai: keluar.filter((x) => tgl10(x.tanggal) <= hari && statusPada(x) !== 'Closed').reduce((n, r) => n + num(r.jumlah), 0),
      saldoAkhir: saldo,
    },
  };
}

// ── Summary bulanan ─────────────────────────────────────────────────────────
export interface SummaryBulanan {
  jenis: string[];
  baris: { tanggal: string; nilai: Record<string, number>; total: number }[];
  total: Record<string, number>;
}

// Pengeluaran bersih per jenis per tanggal KK = nominal KK − uang kembali (KM tertaut).
export function summaryBulanan(i: { keluar: KasKeluarRow[]; masuk: KasMasukRow[]; bulan: string }): SummaryBulanan {
  const bulan = i.bulan.slice(0, 7);
  const kembali = new Map<string, number>();
  for (const m of i.masuk.filter(aktif)) if (m.no_kas_keluar) kembali.set(m.no_kas_keluar, (kembali.get(m.no_kas_keluar) ?? 0) + num(m.jumlah));
  const jenis: string[] = [];
  const perTanggal = new Map<string, Record<string, number>>();
  for (const k of i.keluar.filter(aktif)) {
    if (tgl10(k.tanggal).slice(0, 7) !== bulan) continue;
    if (!jenis.includes(k.jenis)) jenis.push(k.jenis);
    const t = tgl10(k.tanggal);
    const nilai = perTanggal.get(t) ?? {};
    nilai[k.jenis] = (nilai[k.jenis] ?? 0) + num(k.jumlah) - (kembali.get(k.id) ?? 0);
    perTanggal.set(t, nilai);
  }
  const baris = [...perTanggal.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([tanggal, nilai]) => ({ tanggal, nilai, total: Object.values(nilai).reduce((n, v) => n + v, 0) }));
  const total: Record<string, number> = {};
  let semua = 0;
  for (const j of jenis) { total[j] = baris.reduce((n, b) => n + (b.nilai[j] ?? 0), 0); semua += total[j]!; }
  total.semua = semua;
  return { jenis, baris, total };
}

// ── Pembanding aplikasi vs kas kecil ────────────────────────────────────────
export interface AppHarian { bbmTunai: number; topup: number; tolTunai: number }
export interface PasanganBanding { app: number; kas: number; selisih: number }
export interface BarisBanding { tanggal: string; bbm: PasanganBanding; topup: PasanganBanding; tol: PasanganBanding; cocok: boolean; topupFinance: boolean }

// Warehouse yang top up Flazz-nya dibayar langsung oleh divisi Finance (bukan dari kas kecil): WHP Bandung, WHO Bandung, WHO Cibaduyut.
export const CABANG_TOPUP_VIA_FINANCE: readonly string[] = ['GDGBDG', 'BDG', 'CBY'];

const POLA_BBM = /bensin delivery/i;
const POLA_TOPUP = /pengisian etoll/i;
const POLA_TOL = /uang muka delivery/i;

export function pembandingHarian(i: { summary: SummaryBulanan; app: Map<string, AppHarian>; topupFinance?: boolean }): BarisBanding[] {
  const finance = Boolean(i.topupFinance);
  const kasPer = (nilai: Record<string, number>, pola: RegExp) => Object.entries(nilai).filter(([j]) => pola.test(j)).reduce((n, [, v]) => n + v, 0);
  const tanggal = new Set<string>([...i.app.keys(), ...i.summary.baris.map((b) => b.tanggal)]);
  const kasHari = new Map(i.summary.baris.map((b) => [b.tanggal, b.nilai]));
  const pasang = (app: number, kas: number): PasanganBanding => ({ app, kas, selisih: app - kas });
  return [...tanggal].sort().map((t) => {
    const a = i.app.get(t) ?? { bbmTunai: 0, topup: 0, tolTunai: 0 };
    const nilai = kasHari.get(t) ?? {};
    const bbm = pasang(a.bbmTunai, kasPer(nilai, POLA_BBM));
    const topup = pasang(a.topup, finance ? a.topup : kasPer(nilai, POLA_TOPUP)); // via Finance: tidak ada padanan di kas kecil, selisih 0
    const tol = pasang(a.tolTunai, kasPer(nilai, POLA_TOL));
    return { tanggal: t, bbm, topup, tol, cocok: bbm.selisih === 0 && topup.selisih === 0 && tol.selisih === 0, topupFinance: finance };
  });
}

// ── Rincian saldo per pecahan (seperti tabel Pecahan Uang | Uang Keluar | Saldo di Excel) ──
// Pecahan terbesar dulu; dipakai untuk memecah nominal bulat menjadi lembar/keping (data demo, tes).
const URUTAN_URAI = ['100000', '50000', '20000', '10000', '5000', '2000', '1000', '500', '200', '100', '50'];
export function uraiPecahan(n: number): Record<string, number> {
  const out: Record<string, number> = {};
  let sisa = Math.floor(num(n));
  for (const k of URUTAN_URAI) {
    const c = Math.floor(sisa / Number(k));
    if (c > 0) { out[k] = c; sisa -= c * Number(k); }
  }
  return out;
}

const tambahPecahan = (akum: Record<string, number>, p: Record<string, number> | undefined, tanda: 1 | -1) => {
  for (const [k, v] of Object.entries(p ?? {})) akum[k] = (akum[k] ?? 0) + tanda * num(v);
};

// Jumlah lembar/keping per pecahan = saldo awal + KM − KK, dari tanggal saldo awal sampai `tanggal`
// (inklusif; `sebelum` = tanpa hari itu). Hasil bisa negatif bila catatan pecahan tidak lengkap.
export function saldoPecahan(i: { awal: SaldoAwal | null; keluar: KasKeluarRow[]; masuk: KasMasukRow[]; tanggal?: string; sebelum?: boolean }): Record<string, number> {
  const batas = i.tanggal ? tgl10(i.tanggal) : '';
  const mulai = i.awal ? tgl10(i.awal.tanggal) : '';
  const dalam = (t: string) => (!mulai || t >= mulai) && (!batas || (i.sebelum ? t < batas : t <= batas));
  const akum: Record<string, number> = {};
  tambahPecahan(akum, i.awal?.pecahan, 1);
  for (const m of i.masuk.filter(aktif)) if (dalam(tgl10(m.tanggal))) tambahPecahan(akum, m.pecahan, 1);
  for (const k of i.keluar.filter(aktif)) if (dalam(tgl10(k.tanggal))) tambahPecahan(akum, k.pecahan, -1);
  const out: Record<string, number> = {};
  for (const k of PECAHAN) out[k] = akum[k] ?? 0;
  return out;
}

export interface BarisPecahan { kunci: string; awal: number; masuk: number; keluar: number; akhir: number; nilaiAkhir: number }
export interface RincianPecahan {
  baris: BarisPecahan[];
  nilaiAwal: number;
  nilaiAkhir: number;
  saldoUang: number; // saldo uang menurut transaksi (laporan harian)
  selisih: number; // nilaiAkhir − saldoUang; ≠ 0 berarti catatan pecahan belum lengkap
  sinkron: boolean;
  negatif: string[]; // pecahan yang saldonya minus
}

export function rincianPecahanHarian(i: { awal: SaldoAwal | null; keluar: KasKeluarRow[]; masuk: KasMasukRow[]; tanggal: string }): RincianPecahan {
  const hari = tgl10(i.tanggal);
  const awal = saldoPecahan({ ...i, tanggal: hari, sebelum: true });
  const akhir = saldoPecahan({ ...i, tanggal: hari });
  const mHari: Record<string, number> = {};
  const kHari: Record<string, number> = {};
  for (const m of i.masuk.filter(aktif)) if (tgl10(m.tanggal) === hari) tambahPecahan(mHari, m.pecahan, 1);
  for (const k of i.keluar.filter(aktif)) if (tgl10(k.tanggal) === hari) tambahPecahan(kHari, k.pecahan, 1);
  const baris: BarisPecahan[] = PECAHAN.map((k) => ({ kunci: k, awal: awal[k] ?? 0, masuk: mHari[k] ?? 0, keluar: kHari[k] ?? 0, akhir: akhir[k] ?? 0, nilaiAkhir: (akhir[k] ?? 0) * nilaiPecahan(k) }));
  const nilaiAkhir = jumlahPecahan(akhir);
  const saldoUang = laporanHarian(i).ringkasan.saldoAkhir;
  return {
    baris,
    nilaiAwal: jumlahPecahan(awal),
    nilaiAkhir,
    saldoUang,
    selisih: nilaiAkhir - saldoUang,
    sinkron: nilaiAkhir === saldoUang && baris.every((b) => b.akhir >= 0),
    negatif: baris.filter((b) => b.akhir < 0).map((b) => b.kunci),
  };
}
