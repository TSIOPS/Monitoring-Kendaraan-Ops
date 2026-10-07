import { describe, expect, it } from 'vitest';
import { bandingkan, jenisWarehouse } from '../../static/js/pages/perbandingan.js';

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
