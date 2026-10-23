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
