import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { bandingDuaBulan, bandingkan, bandingRentang, cekPilihanBulan, cekRentangBanding, rentangBulan, susunExcelBulan, daftarBulan, hariDalamBulan, jenisWarehouse, labelBulan, labelRentang, mundurSebulan, periodeLalu, susunExcelBanding, susunExcelRentang, teksDelta, teksDeltaPersen } from '../../static/js/pages/perbandingan.js';
import { bukuExcel } from '../../static/js/pages/rekap.js';

const L = (o: Record<string, unknown>) => ({ kode_cabang: 'BDG', jenis: 'BBM', metode: 'TUNAI', amount: 0, ...o });
const cabangList = [
  { kode: 'BDG', nama: 'Who Bandung' },
  { kode: 'TSM', nama: 'Who Tasikmalaya' },
  { kode: 'GDGBDG', nama: 'Whp Bandung' },
];
const vehicles = [{ cabang: 'BDG' }, { cabang: 'BDG' }, { cabang: 'GDGBDG' }, { cabang: 'TSM' }, { cabang: 'CMS' }];

describe('perbandingan pengeluaran', () => {
  it('Whp / kode GDG = gudang pusat; selain itu cabang', () => {
    expect(jenisWarehouse('GDGBDG', 'Whp Bandung')).toBe('PUSAT');
    expect(jenisWarehouse('XYZ', 'WHP Garut')).toBe('PUSAT');
    expect(jenisWarehouse('BDG', 'Who Bandung')).toBe('CABANG');
    expect(jenisWarehouse('CBY', 'Who Cibaduyut')).toBe('CABANG');
  });

  it('jumlah per warehouse, subtotal per kelompok, persen, per kendaraan', () => {
    const lines = [
      L({ jenis: 'BBM', metode: 'ETOLL', amount: 600000 }),
      L({ jenis: 'TOL', metode: 'ETOLL', amount: 100000 }),
      L({ jenis: 'BBM', metode: 'TUNAI', amount: 300000, kode_cabang: 'TSM' }),
      L({ jenis: 'BBM', metode: 'TUNAI', amount: 1000000, kode_cabang: 'GDGBDG' }),
    ];
    const h = bandingkan(lines, cabangList, vehicles);
    expect(h.cabang.baris.map((w: any) => [w.nama, w.total])).toEqual([['Who Bandung', 700000], ['Who Tasikmalaya', 300000]]);
    expect(h.cabang.baris[0]).toMatchObject({ bbmEtoll: 600000, tolEtoll: 100000, etoll: 700000, tunai: 0, kendaraan: 2, perKendaraan: 350000 });
    expect(h.cabang.sub).toMatchObject({ total: 1000000, kendaraan: 3 });
    expect(h.pusat.sub).toMatchObject({ total: 1000000, kendaraan: 1, perKendaraan: 1000000 });
    expect(h.total.total).toBe(2000000);
    expect(Math.round(h.cabang.baris[0].persen)).toBe(35);
    expect(Math.round(h.pusat.sub.persen)).toBe(50);
  });

  it('warehouse tidak aktif (Ciamis) tidak dihitung, warehouse tanpa pengeluaran tetap tampil 0', () => {
    const h = bandingkan([L({ amount: 500000, kode_cabang: 'CMS' }), L({ amount: 200000 })], cabangList, vehicles);
    expect(h.diabaikan).toBe(1);
    expect(h.total.total).toBe(200000);
    expect(h.cabang.baris.find((w: any) => w.kode === 'TSM')).toMatchObject({ total: 0, perKendaraan: 0, kendaraan: 1 });
    expect([...h.cabang.baris, ...h.pusat.baris].some((w: any) => w.kode === 'CMS')).toBe(false);
  });

  it('tanpa data: total 0 dan persen 0 (tidak NaN)', () => {
    const h = bandingkan([], cabangList, []);
    expect(h.total.total).toBe(0);
    expect(h.cabang.baris[0].persen).toBe(0);
    expect(h.cabang.baris[0].perKendaraan).toBe(0);
  });
});

describe('perbandingan bulan vs bulan', () => {
  const HARI = '2026-10-07';
  const bulan = daftarBulan(HARI, 3);
  const baris = [
    L({ tanggal: '2026-08-15', jenis: 'BBM', metode: 'TUNAI', amount: 100000 }),
    L({ tanggal: '2026-09-03', jenis: 'BBM', metode: 'ETOLL', amount: 300000 }),
    L({ tanggal: '2026-09-20', jenis: 'TOL', metode: 'TUNAI', amount: 200000 }),
    L({ tanggal: '2026-10-05', jenis: 'BBM', metode: 'TUNAI', amount: 150000 }),
    L({ tanggal: '2026-09-02', jenis: 'BBM', metode: 'ETOLL', amount: 1000000, kode_cabang: 'GDGBDG' }),
    L({ tanggal: '2026-10-02', amount: 500000, kode_cabang: 'CMS' }),
    L({ tanggal: '2026-07-30', amount: 999 }),
  ];

  it('daftar bulan melewati pergantian tahun; label & hari dalam bulan', () => {
    expect(bulan).toEqual(['2026-08', '2026-09', '2026-10']);
    expect(daftarBulan('2026-02-10', 4)).toEqual(['2025-11', '2025-12', '2026-01', '2026-02']);
    expect(labelBulan('2026-05')).toBe('Mei 2026');
    expect([hariDalamBulan('2026-02'), hariDalamBulan('2024-02'), hariDalamBulan('2026-10')]).toEqual([28, 29, 31]);
  });

  it('format selisih: naik +, turun −, tanpa pembanding "-"', () => {
    expect(teksDelta(1500000)).toBe('+Rp 1.500.000');
    expect(teksDelta(-250000)).toBe('−Rp 250.000');
    expect(teksDelta(0)).toBe('-');
    expect(teksDeltaPersen(12.34)).toBe('+12,3%');
    expect(teksDeltaPersen(-50)).toBe('−50%');
    expect(teksDeltaPersen(null)).toBe('-');
  });

  it('Excel cabang vs gudang pusat: ringkasan kelompok dan total', () => {
    const h = bandingkan([L({ amount: 700000 }), L({ amount: 300000, kode_cabang: 'GDGBDG' })], cabangList, vehicles);
    const wb = XLSX.read(XLSX.write(bukuExcel(XLSX, susunExcelBanding(h, { dari: '2026-10-01', sampai: '2026-10-07' })), { type: 'array', bookType: 'xlsx' }), { type: 'array', cellNF: true });
    expect(wb.SheetNames).toEqual(['Ringkasan', 'Per Warehouse']);
    const rk = XLSX.utils.sheet_to_json(wb.Sheets.Ringkasan!, { header: 1 }) as any[][];
    expect(rk[1]).toEqual(['Periode', '01/10/2026 s.d. 07/10/2026']);
    expect(rk[5]![0]).toBe('Cabang (Who)');
    expect(rk[7]!.slice(0, 8)).toEqual(['Total', 3, 4, 1000000, 0, 0, 1000000, 1000000]);
    expect(wb.Sheets.Ringkasan!.I6!.z).toBe('0.0"%"');
    const d = XLSX.utils.sheet_to_json(wb.Sheets['Per Warehouse']!, { header: 1 }) as any[][];
    expect(d[d.length - 1]![2]).toBe('TOTAL');
    expect(d[d.length - 1]![12]).toBe(1000000);
  });
});

describe('bulan vs bulan: rentang tanggal', () => {
  const lines = [
    L({ tanggal: '2026-09-03', jenis: 'BBM', metode: 'ETOLL', amount: 300000 }),
    L({ tanggal: '2026-09-25', jenis: 'TOL', metode: 'TUNAI', amount: 200000 }),
    L({ tanggal: '2026-10-05', jenis: 'BBM', metode: 'TUNAI', amount: 450000 }),
    L({ tanggal: '2026-09-10', amount: 1000000, kode_cabang: 'GDGBDG' }),
    L({ tanggal: '2026-10-10', amount: 400000, kode_cabang: 'GDGBDG' }),
    L({ tanggal: '2026-10-02', amount: 500000, kode_cabang: 'CMS' }),
  ];

  it('tanggal mundur sebulan: akhir bulan ikut akhir bulan, tanggal tidak ada dipotong', () => {
    expect(mundurSebulan('2026-10-19')).toBe('2026-09-19');
    expect(mundurSebulan('2026-10-31')).toBe('2026-09-30');
    expect(mundurSebulan('2026-03-30')).toBe('2026-02-28');
    expect(mundurSebulan('2026-02-28')).toBe('2026-01-31');
    expect(mundurSebulan('2026-01-15')).toBe('2025-12-15');
    expect(periodeLalu('2026-10-01', '2026-10-19')).toEqual({ dari: '2026-09-01', sampai: '2026-09-19' });
  });

  it('validasi rentang & label', () => {
    expect(cekRentangBanding('', '2026-10-19')).toContain('Isi tanggal');
    expect(cekRentangBanding('2026-10-20', '2026-10-19')).toContain('tidak boleh setelah');
    expect(cekRentangBanding('2026-09-01', '2026-10-19')).toContain('maksimal 31 hari');
    expect(cekRentangBanding('2026-10-01', '2026-10-31')).toBe('');
    expect(labelRentang('2026-10-01', '2026-10-19')).toBe('1–19 Okt 2026');
    expect(labelRentang('2026-09-28', '2026-10-05')).toBe('28 Sep – 5 Okt 2026');
    expect(labelRentang('2026-10-07', '2026-10-07')).toBe('7 Okt 2026');
  });

  it('bulan berjalan (tgl 1 s.d. hari ini): pembanding periode sama, bulan lalu penuh, proyeksi', () => {
    const h = bandingRentang(lines, cabangList, '2026-10-01', '2026-10-19', '2026-10-19');
    expect(h.berjalan).toBe(true);
    expect(h.diabaikan).toBe(1);
    const bdg = h.cabang.baris.find((w: any) => w.kode === 'BDG');
    expect(bdg).toMatchObject({ lalu: 300000, ini: 450000, penuhLalu: 500000, delta: 150000, deltaPersen: 50 });
    expect(bdg.proyeksi).toBeCloseTo((450000 / 19) * 31, 5);
    expect(h.pusat.sub).toMatchObject({ lalu: 1000000, ini: 400000, delta: -600000 });
    expect(h.total).toMatchObject({ lalu: 1300000, ini: 850000, penuhLalu: 1500000, delta: -450000 });
  });

  it('rentang bebas di tengah bulan: tanpa bulan penuh & proyeksi', () => {
    const h = bandingRentang(lines, cabangList, '2026-10-05', '2026-10-09', '2026-10-19');
    expect(h.berjalan).toBe(false);
    expect(h.lalu).toEqual({ dari: '2026-09-05', sampai: '2026-09-09' });
    const bdg = h.cabang.baris.find((w: any) => w.kode === 'BDG');
    expect(bdg).toMatchObject({ lalu: 0, ini: 450000, deltaPersen: null, proyeksi: null });
  });

  it('Excel: 3 sheet; kolom bulan lalu penuh & proyeksi hanya untuk bulan berjalan', () => {
    const h = bandingRentang(lines, cabangList, '2026-10-01', '2026-10-19', '2026-10-19');
    const wb = XLSX.read(XLSX.write(bukuExcel(XLSX, susunExcelRentang(h)), { type: 'array', bookType: 'xlsx' }), { type: 'array', cellNF: true });
    expect(wb.SheetNames).toEqual(['Ringkasan', 'Per Warehouse', 'Rinci']);
    const m = XLSX.utils.sheet_to_json(wb.Sheets['Per Warehouse']!, { header: 1 }) as any[][];
    expect(m[0]).toEqual(['No', 'Jenis', 'Warehouse', 'Sep 2026 penuh (Rp)', '1–19 Sep 2026 (Rp)', '1–19 Okt 2026 (Rp)', 'Selisih (Rp)', 'Selisih (%)', 'Proyeksi Akhir Bulan (Rp)']);
    expect(m[1]!.slice(0, 8)).toEqual([1, 'Cabang (Who)', 'Who Bandung', 500000, 300000, 450000, 150000, 50]);
    expect(wb.Sheets['Per Warehouse']!.H2!.z).toBe('0.0"%"');
    const bebas = susunExcelRentang(bandingRentang(lines, cabangList, '2026-10-05', '2026-10-09', '2026-10-19'));
    expect(bebas[1]!.aoa[0]).toEqual(['No', 'Jenis', 'Warehouse', '5–9 Sep 2026 (Rp)', '5–9 Okt 2026 (Rp)', 'Selisih (Rp)', 'Selisih (%)']);
  });
});

describe('bulan vs bulan: total sebulan', () => {
  const lines = [
    L({ tanggal: '2026-09-03', jenis: 'BBM', metode: 'ETOLL', amount: 300000 }),
    L({ tanggal: '2026-09-28', jenis: 'TOL', metode: 'TUNAI', amount: 200000 }),
    L({ tanggal: '2026-10-05', jenis: 'BBM', metode: 'TUNAI', amount: 450000 }),
    L({ tanggal: '2026-10-25', amount: 999 }),
    L({ tanggal: '2026-09-10', amount: 1000000, kode_cabang: 'GDGBDG' }),
    L({ tanggal: '2026-10-02', amount: 500000, kode_cabang: 'CMS' }),
  ];

  it('rentang bulan: penuh vs berjalan s.d. hari ini; validasi pilihan', () => {
    expect(rentangBulan('2026-09', '2026-10-19')).toMatchObject({ dari: '2026-09-01', sampai: '2026-09-30', berjalan: false, label: 'Sep 2026 (1–30)' });
    expect(rentangBulan('2026-10', '2026-10-19')).toMatchObject({ sampai: '2026-10-19', berjalan: true, label: 'Okt 2026 (1–19, berjalan)' });
    expect(cekPilihanBulan('2026-10', '2026-10', '2026-10-19')).toContain('berbeda');
    expect(cekPilihanBulan('2026-09', '2026-11', '2026-10-19')).toContain('belum berjalan');
    expect(cekPilihanBulan('2026-09', '2026-10', '2026-10-19')).toBe('');
  });

  it('total September penuh vs Oktober berjalan; selisih = Okt − Sep; proyeksi', () => {
    const h = bandingDuaBulan(lines, cabangList, '2026-09', '2026-10', '2026-10-19');
    expect(h.diabaikan).toBe(1);
    const bdg = h.cabang.baris.find((w: any) => w.kode === 'BDG');
    expect(bdg).toMatchObject({ a: 500000, b: 450000, delta: -50000, deltaPersen: -10 });
    expect(bdg.proyeksi).toBeCloseTo((450000 / 19) * 31, 5);
    expect(h.total).toMatchObject({ a: 1500000, b: 450000 });
    // Bulan lampau vs bulan lampau: tanpa proyeksi.
    expect(bandingDuaBulan(lines, cabangList, '2026-08', '2026-09', '2026-10-19').adaProyeksi).toBe(false);
  });

  it('Excel: kolom total kedua bulan, selisih, persen, proyeksi', () => {
    const h = bandingDuaBulan(lines, cabangList, '2026-09', '2026-10', '2026-10-19');
    const wb = XLSX.read(XLSX.write(bukuExcel(XLSX, susunExcelBulan(h)), { type: 'array', bookType: 'xlsx' }), { type: 'array', cellNF: true });
    expect(wb.SheetNames).toEqual(['Ringkasan', 'Per Warehouse', 'Rinci']);
    const m = XLSX.utils.sheet_to_json(wb.Sheets['Per Warehouse']!, { header: 1 }) as any[][];
    expect(m[0]).toEqual(['No', 'Jenis', 'Warehouse', 'Sep 2026 (1–30) (Rp)', 'Okt 2026 (1–19, berjalan) (Rp)', 'Selisih (Rp)', 'Selisih (%)', 'Proyeksi Akhir Bulan (Rp)']);
    expect(m[1]!.slice(0, 7)).toEqual([1, 'Cabang (Who)', 'Who Bandung', 500000, 450000, -50000, -10]);
    expect(wb.Sheets['Per Warehouse']!.G2!.z).toBe('0.0"%"');
  });
});
