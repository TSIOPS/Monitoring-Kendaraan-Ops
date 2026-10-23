// Helper murni kas kecil (diuji di tests/frontend/kaskecil-helpers.test.ts; tanpa DOM).

export const PECAHAN = [
  ['100000', 'Rp 100.000'], ['50000', 'Rp 50.000'], ['20000', 'Rp 20.000'], ['10000', 'Rp 10.000'], ['5000', 'Rp 5.000'], ['2000', 'Rp 2.000'],
  ['1000', 'Rp 1.000 (kertas)'], ['K1000', 'Rp 1.000 (koin)'], ['500', 'Rp 500'], ['200', 'Rp 200'], ['100', 'Rp 100'], ['50', 'Rp 50'],
];
export const PECAHAN_OPNAME = [PECAHAN[0], ['75000', 'Rp 75.000'], ...PECAHAN.slice(1)];

const nilai = (k) => Number(String(k).replace('K', ''));
export const jumlahPecahan = (p) => Object.entries(p || {}).reduce((n, [k, v]) => n + nilai(k) * (Number(v) || 0), 0);

// Hanya pecahan yang terisi (>0), kunci → bilangan bulat.
export function bersihkanPecahan(isian) {
  const out = {};
  for (const [k, v] of Object.entries(isian || {})) {
    const n = Math.floor(Number(v));
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

const SATUAN = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan', 'Sepuluh', 'Sebelas'];
function eja(n) {
  if (n < 12) return SATUAN[n];
  if (n < 20) return eja(n - 10) + ' Belas';
  if (n < 100) return eja(Math.floor(n / 10)) + ' Puluh' + (n % 10 ? ' ' + eja(n % 10) : '');
  if (n < 200) return 'Seratus' + (n % 100 ? ' ' + eja(n % 100) : '');
  if (n < 1000) return eja(Math.floor(n / 100)) + ' Ratus' + (n % 100 ? ' ' + eja(n % 100) : '');
  if (n < 2000) return 'Seribu' + (n % 1000 ? ' ' + eja(n % 1000) : '');
  if (n < 1e6) return eja(Math.floor(n / 1000)) + ' Ribu' + (n % 1000 ? ' ' + eja(n % 1000) : '');
  if (n < 1e9) return eja(Math.floor(n / 1e6)) + ' Juta' + (n % 1e6 ? ' ' + eja(n % 1e6) : '');
  if (n < 1e12) return eja(Math.floor(n / 1e9)) + ' Miliar' + (n % 1e9 ? ' ' + eja(n % 1e9) : '');
  return eja(Math.floor(n / 1e12)) + ' Triliun' + (n % 1e12 ? ' ' + eja(n % 1e12) : '');
}
export function terbilang(n) {
  const v = Math.floor(Math.abs(Number(n) || 0));
  return (v === 0 ? 'Nol' : eja(v)) + ' Rupiah';
}

const HARI = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
const BULAN = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
export const namaBulan = (bulan) => {
  const m = /^(\d{4})-(\d{2})/.exec(String(bulan || ''));
  return m ? `${BULAN[Number(m[2]) - 1]} ${m[1]}` : String(bulan || '');
};
// '2026-10-22' → 'Kamis, 22 Oktober 2026'
export function tglPanjang(t) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t || ''));
  if (!m) return String(t || '');
  const hari = HARI[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
  return `${hari}, ${Number(m[3])} ${BULAN[Number(m[2]) - 1]} ${m[1]}`;
}
export const tglId = (t) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(t || '');
};

// ── Excel (spesifikasi sheet untuk bukuExcel di pages/rekap.js) ────────────
export function sheetLaporanHarian(lap, { warehouse = '' } = {}) {
  const r = lap.ringkasan;
  return [{
    nama: 'Laporan Harian',
    aoa: [
      ['Laporan Harian Kas Kecil'],
      ['Warehouse', warehouse],
      ['Tanggal', tglId(lap.tanggal)],
      [],
      ['Saldo Awal', r.saldoAwal, 'Kas Keluar', r.keluar, 'Kas Masuk', r.masuk, 'Belum Selesai', r.belumSelesai, 'Saldo Akhir', r.saldoAkhir],
      [],
      ['No', 'Jam', 'No. Kas Keluar', 'No. Referensi', 'No. Kas Masuk', 'Nama', 'Admin', 'Kode Akun', 'Jenis Transaksi', 'Debit (Rp)', 'Kredit (Rp)', 'Saldo (Rp)', 'Status'],
      ...lap.baris.map((b, i) => [i + 1, b.jam, b.nomorKK, b.referensi, b.nomorKM, b.nama, b.admin, b.kodeAkun, b.namaJenis, b.debit, b.kredit, b.saldo, b.status]),
      ['', '', '', '', '', '', '', '', 'TOTAL', lap.baris.reduce((n, b) => n + b.debit, 0), lap.baris.reduce((n, b) => n + b.kredit, 0), r.saldoAkhir, ''],
    ],
    angka: { kolom: [1, 3, 5, 7, 9, 10, 11] },
  }];
}

export function sheetSummary(summary, { warehouse = '', bulan = '' } = {}) {
  const jenis = summary.jenis;
  return [{
    nama: 'Summary Kas Kecil',
    aoa: [
      ['Summary Kas Kecil'],
      ['Warehouse', warehouse],
      ['Bulan', namaBulan(bulan)],
      [],
      ['Tanggal', ...jenis, 'Total (Rp)'],
      ...summary.baris.map((b) => [tglId(b.tanggal), ...jenis.map((j) => b.nilai[j] ?? 0), b.total]),
      ['TOTAL', ...jenis.map((j) => summary.total[j] ?? 0), summary.total.semua ?? 0],
    ],
    angka: { baris: summary.baris.map((_, i) => i + 5).concat([5 + summary.baris.length]), kolom: jenis.map((_, i) => i + 1).concat([jenis.length + 1]) },
  }];
}

export function sheetPembanding(baris, { warehouse = '', bulan = '' } = {}) {
  const jumlah = (f) => baris.reduce((n, b) => n + f(b), 0);
  return [{
    nama: 'Pembanding',
    aoa: [
      ['Pembanding Aplikasi vs Kas Kecil'],
      ['Warehouse', warehouse],
      ['Bulan', namaBulan(bulan)],
      [],
      ['Tanggal', 'BBM Tunai Aplikasi', 'Bensin Delivery Kas', 'Selisih BBM', 'Top Up Flazz Aplikasi', 'Pengisian ETOLL Kas', 'Selisih Top Up', 'Tol Tunai Aplikasi', 'Uang Muka Delivery Kas', 'Selisih Tol', 'Keterangan'],
      ...baris.map((b) => [tglId(b.tanggal), b.bbm.app, b.bbm.kas, b.bbm.selisih, b.topup.app, b.topupFinance ? 'Via Finance' : b.topup.kas, b.topupFinance ? '-' : b.topup.selisih, b.tol.app, b.tol.kas, b.tol.selisih, b.cocok ? 'Cocok' : 'Selisih']),
      ['TOTAL', jumlah((b) => b.bbm.app), jumlah((b) => b.bbm.kas), jumlah((b) => b.bbm.selisih), jumlah((b) => b.topup.app), jumlah((b) => (b.topupFinance ? 0 : b.topup.kas)), jumlah((b) => (b.topupFinance ? 0 : b.topup.selisih)), jumlah((b) => b.tol.app), jumlah((b) => b.tol.kas), jumlah((b) => b.tol.selisih), ''],
    ],
    angka: { baris: baris.map((_, i) => i + 5).concat([5 + baris.length]), kolom: [1, 2, 3, 4, 5, 6, 7, 8, 9] },
  }];
}

export const namaFileKas = (jenis, kode, periode) => `kas-kecil-${jenis}-${kode || 'semua'}-${periode}.xlsx`;
