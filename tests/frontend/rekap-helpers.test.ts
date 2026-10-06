import { describe, expect, it } from 'vitest';
import { awalBulan, csvRekap, kelompokRekap, ringkasRekap } from '../../static/js/pages/rekap.js';

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
  it('CSV memakai titik koma dan meng-escape sel', () => {
    const csv = csvRekap([L({ supir: 'Agus; "A"', amount: 5 })]).split('\r\n');
    expect(csv[0]).toBe('Tanggal;Warehouse;Kendaraan;Supir;Jenis;Metode;Kartu Etoll;Nominal;Sumber;Referensi');
    expect(csv[1]).toBe('2026-10-01;BDG;D 1 A;"Agus; ""A""";BBM;TUNAI;;5;Laporan harian;TRX-1');
  });
});
