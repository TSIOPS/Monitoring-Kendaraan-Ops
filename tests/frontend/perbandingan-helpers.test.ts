import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { bandingBulan, bandingkan, daftarBulan, hariDalamBulan, jenisWarehouse, labelBulan, susunExcelBanding, susunExcelBulanan, teksDelta, teksDeltaPersen } from '../../static/js/pages/perbandingan.js';
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

  it('total per bulan, rata-rata bulan penuh, selisih periode sama, proyeksi, warehouse nonaktif dilewati', () => {
    const b = bandingBulan(baris, cabangList, bulan, HARI);
    expect(b.berjalan).toBe(true);
    expect(b.diabaikan).toBe(1);
    const bdg = b.cabang.baris.find((w: any) => w.kode === 'BDG');
    expect(bdg.per).toEqual({ '2026-08': 100000, '2026-09': 500000, '2026-10': 150000 });
    expect(bdg.rinci['2026-09']).toMatchObject({ bbmEtoll: 300000, tolTunai: 200000, total: 500000 });
    expect(bdg).toMatchObject({ total: 750000, rata: 300000, terakhir: 150000, pembandingTerakhir: 300000, delta: -150000, deltaPersen: -50 });
    expect(bdg.proyeksi).toBeCloseTo((150000 / 7) * 31, 5);
    const tsm = b.cabang.baris.find((w: any) => w.kode === 'TSM');
    expect(tsm).toMatchObject({ total: 0, delta: 0, deltaPersen: null, proyeksi: 0 });
    expect(b.pusat.baris[0]).toMatchObject({ nama: 'Whp Bandung', delta: -1000000, deltaPersen: -100 });
    expect(b.cabang.sub).toMatchObject({ nama: 'Subtotal Cabang (Who)', total: 750000, delta: -150000 });
    expect(b.total).toMatchObject({ nama: 'TOTAL', total: 1750000, pembandingTerakhir: 1300000, delta: -1150000 });
    expect(b.total.deltaPersen).toBeCloseTo(-88.46, 1);
    expect(b.total.per['2026-09']).toBe(1500000);
  });

  it('bulan awal tanpa data dipangkas dan tidak dihitung sebagai 0 pada rata-rata', () => {
    const b = bandingBulan(baris.filter((l: any) => l.tanggal >= '2026-09-01' && l.kode_cabang !== 'CMS'), cabangList, daftarBulan(HARI, 6), HARI);
    expect(b.bulan).toEqual(['2026-09', '2026-10']);
    const bdg = b.cabang.baris.find((w: any) => w.kode === 'BDG');
    expect(bdg.rata).toBe(500000); // hanya September (bulan penuh); Mei–Agu tidak dihitung
    expect(b.total.rata).toBe(1500000);
  });

  it('hanya bulan berjalan yang punya data: rata-rata 0 (belum ada bulan penuh), tanpa pembanding', () => {
    const b = bandingBulan([L({ tanggal: '2026-10-05', amount: 150000 })], cabangList, daftarBulan(HARI, 6), HARI);
    expect(b.bulan).toEqual(['2026-10']);
    expect(b.total).toMatchObject({ rata: 0, delta: 0, deltaPersen: null, total: 150000 });
  });

  it('format selisih: naik +, turun −, tanpa pembanding "-"', () => {
    expect(teksDelta(1500000)).toBe('+Rp 1.500.000');
    expect(teksDelta(-250000)).toBe('−Rp 250.000');
    expect(teksDelta(0)).toBe('-');
    expect(teksDeltaPersen(12.34)).toBe('+12,3%');
    expect(teksDeltaPersen(-50)).toBe('−50%');
    expect(teksDeltaPersen(null)).toBe('-');
  });

  it('Excel bulanan: 3 sheet, angka berformat ribuan & persen, subtotal/total, filter rinci', () => {
    const b = bandingBulan(baris, cabangList, bulan, HARI);
    const wb = XLSX.read(XLSX.write(bukuExcel(XLSX, susunExcelBulanan(b)), { type: 'array', bookType: 'xlsx' }), { type: 'array', cellNF: true });
    expect(wb.SheetNames).toEqual(['Ringkasan', 'Per Warehouse', 'Rinci Bulanan']);
    const m = XLSX.utils.sheet_to_json(wb.Sheets['Per Warehouse']!, { header: 1 }) as any[][];
    expect(m[0]).toEqual(['No', 'Jenis', 'Warehouse', 'Agu 2026', 'Sep 2026', 'Okt 2026 (berjalan)', 'Total (Rp)', 'Rata-rata/Bulan (Rp)', 'Selisih s.d. tgl 7 (Rp)', 'Selisih (%)', 'Proyeksi Bulan Berjalan (Rp)']);
    expect(m[1]!.slice(0, 10)).toEqual([1, 'Cabang (Who)', 'Who Bandung', 100000, 500000, 150000, 750000, 300000, -150000, -50]);
    expect(m[1]![10]).toBeCloseTo((150000 / 7) * 31, 5);
    expect(m.map((r) => r[2]).slice(3)).toEqual(['Subtotal Cabang (Who)', 'Whp Bandung', 'Subtotal Gudang Pusat (Whp)', 'TOTAL']);
    expect(wb.Sheets['Per Warehouse']!.D2!.z).toBe('#,##0');
    expect(wb.Sheets['Per Warehouse']!.J2!.z).toBe('0.0"%"');
    const r = XLSX.utils.sheet_to_json(wb.Sheets['Rinci Bulanan']!, { header: 1 }) as any[][];
    expect(r).toHaveLength(6);
    expect(r[5]).toEqual(['TOTAL', '', '', 1300000, 250000, 0, 200000, 1750000]);
    expect(wb.Sheets['Rinci Bulanan']!['!autofilter']!.ref).toBe('A1:H5');
    const rk = XLSX.utils.sheet_to_json(wb.Sheets.Ringkasan!, { header: 1 }) as any[][];
    expect(rk[1]).toEqual(['Periode', 'Agu 2026 s.d. Okt 2026']);
    expect(rk[6]).toEqual(['Agu 2026', 100000, 0, 100000, '', '']);
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
