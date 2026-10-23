import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { bukuExcel } from '../../static/js/pages/rekap.js';
import {
  PECAHAN, PECAHAN_OPNAME, bersihkanPecahan, jumlahPecahan, namaBulan, sheetLaporanHarian, sheetPembanding, sheetSummary, terbilang, tglId, tglPanjang,
} from '../../static/js/kaskecil-helpers.js';
import { PECAHAN as PECAHAN_SERVER, PECAHAN_OPNAME as OPNAME_SERVER } from '../../src/logic/kaskecil';

describe('helper kas kecil (frontend)', () => {
  it('daftar pecahan identik dengan server', () => {
    expect((PECAHAN as string[][]).map((p) => p[0])).toEqual([...PECAHAN_SERVER]);
    expect((PECAHAN_OPNAME as string[][]).map((p) => p[0])).toEqual([...OPNAME_SERVER]);
  });
  it.each([
    [0, 'Nol Rupiah'], [10000, 'Sepuluh Ribu Rupiah'], [100000, 'Seratus Ribu Rupiah'], [1000, 'Seribu Rupiah'],
    [215000, 'Dua Ratus Lima Belas Ribu Rupiah'], [2103000, 'Dua Juta Seratus Tiga Ribu Rupiah'], [11500, 'Sebelas Ribu Lima Ratus Rupiah'],
    [1250000000, 'Satu Miliar Dua Ratus Lima Puluh Juta Rupiah'], [2000000, 'Dua Juta Rupiah'],
  ])('terbilang %i', (n, t) => expect(terbilang(n as number)).toBe(t));
  it('jumlahPecahan & bersihkanPecahan', () => {
    expect(jumlahPecahan({ '100000': 2, K1000: 3 })).toBe(203000);
    expect(bersihkanPecahan({ '50000': '2', '20000': 0, '10000': '', '5000': -1, '2000': 1.9 })).toEqual({ '50000': 2, '2000': 1 });
  });
  it('tanggal', () => {
    expect(tglPanjang('2026-10-22')).toBe('Kamis, 22 Oktober 2026');
    expect(tglId('2026-10-22')).toBe('22/10/2026');
    expect(namaBulan('2026-10')).toBe('Oktober 2026');
  });
  it('sheet Excel: laporan harian, summary, pembanding menghasilkan buku valid', () => {
    const lap = {
      tanggal: '2026-10-22', saldoAwal: 100,
      ringkasan: { saldoAwal: 100, keluar: 50, masuk: 20, belumSelesai: 30, saldoAkhir: 70 },
      baris: [{ jam: '10:00:00', nomorKK: 'KK-1', referensi: 'BO-1', nomorKM: '', nama: 'A', admin: 'B', kodeAkun: '6101', namaJenis: 'Bensin', debit: 0, kredit: 50, saldo: 50, status: 'Open' }],
    };
    const summary = { jenis: ['Bensin', 'ETOLL'], baris: [{ tanggal: '2026-10-01', nilai: { Bensin: 250000 }, total: 250000 }], total: { Bensin: 250000, ETOLL: 0, semua: 250000 } };
    const banding = [{ tanggal: '2026-10-01', bbm: { app: 1, kas: 1, selisih: 0 }, topup: { app: 0, kas: 0, selisih: 0 }, tol: { app: 0, kas: 0, selisih: 0 }, cocok: true }];
    const sheets = [...sheetLaporanHarian(lap, { warehouse: 'WHO KARAWANG' }), ...sheetSummary(summary, { warehouse: 'WHO KARAWANG', bulan: '2026-10' }), ...sheetPembanding(banding, { bulan: '2026-10' })];
    const wb = XLSX.read(XLSX.write(bukuExcel(XLSX, sheets), { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    expect(wb.SheetNames).toEqual(['Laporan Harian', 'Summary Kas Kecil', 'Pembanding']);
    const rows = (n: string) => XLSX.utils.sheet_to_json(wb.Sheets[n]!, { header: 1 }) as unknown[][];
    expect(rows('Laporan Harian')[6]![2]).toBe('No. Kas Keluar');
    expect(rows('Laporan Harian').at(-1)).toEqual(['', '', '', '', '', '', '', '', 'TOTAL', 0, 50, 70, '']);
    expect(rows('Summary Kas Kecil')[4]).toEqual(['Tanggal', 'Bensin', 'ETOLL', 'Total (Rp)']);
    expect(rows('Summary Kas Kecil').at(-1)).toEqual(['TOTAL', 250000, 0, 250000]);
    expect(rows('Pembanding').at(-1)![0]).toBe('TOTAL');
  });
});

describe('Excel daftar kas keluar & kas masuk', () => {
  const kk = (o: Record<string, unknown>) => ({ id: 'KK-1', tanggal: '2026-10-02', jam: '10:00:00', no_referensi: 'BO-1', no_kas_masuk: '', penerima: 'Agus', admin: 'Gin', kode_akun: '6101-103', jenis: 'Uang Muka', pecahan: { '50000': 2 }, jumlah: 100000, keterangan: 'x', status: 'Open', ...o });
  const km = (o: Record<string, unknown>) => ({ id: 'KM-1', tanggal: '2026-10-02', jam: '16:00:00', no_kas_keluar: 'KK-2', no_referensi: 'BO-2', penerima: 'Budi', admin: 'Gin', kode_akun: '6101-103', jenis: 'Uang Muka', pecahan: {}, jumlah: 40000, keterangan: '', ...o });
  it('kolom mengikuti Excel lama, penggunaan = keluar − kembali, ada total, urut tanggal', async () => {
    const { sheetDaftarKeluar, sheetDaftarMasuk } = await import('../../static/js/kaskecil-helpers.js');
    const keluar = [kk({ id: 'KK-2', tanggal: '2026-10-03', no_kas_masuk: 'KM-1', status: 'Closed', jumlah: 100000, pecahan: {} }), kk({})];
    const sk = sheetDaftarKeluar(keluar, [km({})], { warehouse: 'WHO KARAWANG', dari: '2026-10-01', sampai: '2026-10-31' });
    expect(sk.nama).toBe('Kas Keluar');
    expect(sk.aoa[4]!.slice(0, 11)).toEqual(['No', 'Tanggal', 'Jam', 'No. Kas Keluar', 'No. Referensi', 'No. Kas Masuk', 'Penerima', 'Penerima 2', 'Admin', 'Kode Akun', 'Jenis Transaksi']);
    expect(sk.aoa[5]![3]).toBe('KK-1'); // lebih awal dulu
    expect(sk.aoa[5]![12]).toBe(2); // 50.000 × 2 lembar
    const kolom = (b: unknown[], n: string) => b[sk.aoa[4]!.indexOf(n)];
    expect(kolom(sk.aoa[6]!, 'Uang Kembali (Rp)')).toBe(40000);
    expect(kolom(sk.aoa[6]!, 'Penggunaan (Rp)')).toBe(60000);
    expect(kolom(sk.aoa.at(-1)!, 'Kas Keluar (Rp)')).toBe(200000);
    expect(kolom(sk.aoa.at(-1)!, 'Penggunaan (Rp)')).toBe(160000);
    const sm = sheetDaftarMasuk([km({}), km({ id: 'KM-0', jumlah: 500000, no_kas_keluar: '' })], { warehouse: 'X', dari: '2026-10-01', sampai: '2026-10-31' });
    expect(sm.aoa[4]!.at(-2)).toBe('Jumlah (Rp)');
    expect(sm.aoa.at(-1)![sm.aoa[4]!.indexOf('Jumlah (Rp)')]).toBe(540000);
  });
  it('menjadi buku Excel valid dengan autofilter dimulai dari baris header', async () => {
    const { sheetDaftarKeluar, sheetDaftarMasuk } = await import('../../static/js/kaskecil-helpers.js');
    const wb = XLSX.read(XLSX.write(bukuExcel(XLSX, [sheetDaftarKeluar([kk({})], []), sheetDaftarMasuk([km({})])]), { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    expect(wb.SheetNames).toEqual(['Kas Keluar', 'Kas Masuk']);
    expect(wb.Sheets['Kas Keluar']!['!autofilter']!.ref.startsWith('A5:')).toBe(true);
  });
});

describe('sheet Saldo per Pecahan', () => {
  it('baris per pecahan + total + selisih, jadi buku Excel valid', async () => {
    const { sheetSaldoPecahan, labelPecahan } = await import('../../static/js/kaskecil-helpers.js');
    expect(labelPecahan('K1000')).toBe('Rp 1.000 (koin)');
    const rin = {
      baris: [{ kunci: '100000', awal: 5, masuk: 0, keluar: 1, akhir: 4, nilaiAkhir: 400000 }, { kunci: '50000', awal: 2, masuk: 4, keluar: 0, akhir: 6, nilaiAkhir: 300000 }],
      nilaiAwal: 600000, nilaiAkhir: 700000, saldoUang: 700000, selisih: 0, sinkron: true, negatif: [],
    };
    const sheets = sheetSaldoPecahan(rin, { warehouse: 'WHO KARAWANG', tanggal: '2026-10-22' });
    expect(sheets[0]!.nama).toBe('Saldo per Pecahan');
    const wb = XLSX.read(XLSX.write(bukuExcel(XLSX, sheets), { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Saldo per Pecahan']!, { header: 1 }) as unknown[][];
    expect(rows[4]).toEqual(['Pecahan', 'Saldo Awal (lembar)', 'Masuk (lembar)', 'Keluar (lembar)', 'Saldo Akhir (lembar)', 'Nilai Saldo Akhir (Rp)']);
    expect(rows[5]).toEqual(['Rp 100.000', 5, 0, 1, 4, 400000]);
    expect(rows[7]).toEqual(['TOTAL', '', '', '', '', 700000]);
    expect(rows[9]![5]).toBe(0);
  });
});
