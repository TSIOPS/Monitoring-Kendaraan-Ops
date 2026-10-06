import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { awalBulan, bukuExcel, kelompokRekap, lebarKolom, ringkasRekap, susunExcel } from '../../static/js/pages/rekap.js';

const L = (o: Record<string, unknown>) => ({ tanggal: '2026-10-01', kode_cabang: 'BDG', plat_nomor: 'D 1 A', supir: 'Agus', jenis: 'BBM', metode: 'TUNAI', card_id: '', kartu: '', amount: 0, sumber: 'LAPORAN', ref: 'TRX-1', ...o });
const lines = [
  L({ jenis: 'BBM', metode: 'ETOLL', card_id: 'FLZ-1', kartu: 'E toll 1', amount: 200000 }),
  L({ jenis: 'TOL', metode: 'ETOLL', card_id: 'FLZ-1', kartu: 'E toll 1', amount: 15000 }),
  L({ jenis: 'BBM', metode: 'TUNAI', amount: 100000, plat_nomor: 'D 2 B' }),
  L({ jenis: 'TOL', metode: 'TUNAI', amount: 7000 }),
];

describe('rekap pengeluaran', () => {
  it('awal bulan dari tanggal', () => {
    expect(awalBulan('2026-10-06')).toBe('2026-10-01');
  });
  it('ringkasan per jenis & metode', () => {
    expect(ringkasRekap(lines)).toEqual({ bbmEtoll: 200000, tolEtoll: 15000, bbmTunai: 100000, tolTunai: 7000, totalEtoll: 215000, totalTunai: 107000, total: 322000, jumlah: 4 });
  });
  it('per kartu hanya etoll; per kendaraan semua metode, urut total', () => {
    expect(kelompokRekap(lines, 'kartu').map((g) => [g.label, g.bbmEtoll, g.tolEtoll, g.total, g.cabang])).toEqual([['E toll 1', 200000, 15000, 215000, 'BDG']]);
    expect(kelompokRekap(lines, 'kendaraan').map((g) => [g.label, g.total])).toEqual([['D 1 A', 222000], ['D 2 B', 100000]]);
  });
  it('Excel: 4 sheet, nominal berformat ribuan, total, nama warehouse, autofilter', () => {
    const sheets = susunExcel(lines, { dari: '2026-10-01', sampai: '2026-10-06', warehouse: 'WHO BANDUNG', namaCabang: { BDG: 'WHO BANDUNG' } });
    const wb = XLSX.read(XLSX.write(bukuExcel(XLSX, sheets), { type: 'array', bookType: 'xlsx' }), { type: 'array', cellNF: true });
    expect(wb.SheetNames).toEqual(['Ringkasan', 'Detail', 'Per Kartu Etoll', 'Per Kendaraan']);
    const det = wb.Sheets.Detail!;
    expect(XLSX.utils.sheet_to_json(det, { header: 1 })[1]).toEqual([1, '01/10/2026', 'WHO BANDUNG (BDG)', 'D 1 A', 'Agus', 'BBM', 'Etoll', 'E toll 1', 200000, 'Laporan harian', 'TRX-1']);
    expect(det.I2!.z).toBe('#,##0');
    expect(det.I6!.v).toBe(322000);
    expect(det['!autofilter']!.ref).toBe('A1:K5');
    const rk = XLSX.utils.sheet_to_json(wb.Sheets.Ringkasan!, { header: 1 }) as unknown[][];
    expect(rk[1]).toEqual(['Periode', '01/10/2026 s.d. 06/10/2026']);
    expect(rk[7]).toEqual(['Total', 215000, 107000, 322000]);
  });
  it('lebar kolom mengikuti isi terpanjang', () => {
    expect(lebarKolom([['No', 'Kendaraan'], [1, 'D 1234 ABC']])).toEqual([{ wch: 6 }, { wch: 12 }]);
  });
});

describe('rekap: plat berspasi', () => {
  it('plat dengan spasi tepi digabung ke kendaraan yang sama', () => {
    const g = kelompokRekap([L({ plat_nomor: ' D 8854 FD ', amount: 1 }), L({ plat_nomor: 'D 8854 FD', amount: 2 })], 'kendaraan');
    expect(g.map((x) => [x.label, x.total])).toEqual([['D 8854 FD', 3]]);
  });
});
