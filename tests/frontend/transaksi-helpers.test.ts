import { describe, expect, it } from 'vitest';
import { teksBarisRincian, totalBulan } from '../../static/js/pages/transaksi.js';

describe('teksBarisRincian', () => {
  it('format satu nota: jenis, nominal, dibayar, keterangan', () => {
    const label = (id: string) => (id === 'FLZ-1' ? 'Etoll A' : id);
    expect(teksBarisRincian({ jenis: 'BBM', nominal: 200000, kartu: 'FLZ-1', keterangan: 'SPBU A' }, label)).toBe('BBM · Rp 200.000 · Etoll A · SPBU A');
    expect(teksBarisRincian({ jenis: 'TOL', nominal: 5000, kartu: '', keterangan: '' }, label)).toBe('Tol · Rp 5.000 · Tunai');
  });
});

describe('teksBarisRincian Retribusi/Parkir', () => {
  it('label jenis baru dan selalu Tunai', () => {
    expect(teksBarisRincian({ jenis: 'RETRIBUSI', nominal: 10000, kartu: '', keterangan: 'Gerbang' })).toBe('Retribusi · Rp 10.000 · Tunai · Gerbang');
    expect(teksBarisRincian({ jenis: 'PARKIR', nominal: 5000, kartu: '', keterangan: '' })).toBe('Parkir Delivery · Rp 5.000 · Tunai');
  });
});

describe('totalBulan', () => {
  it('menjumlah semua cabang termasuk retribusi, parkir, dan total pengeluaran', () => {
    const t = totalBulan([
      { total_transaksi: 2, total_liter: 30, total_biaya_bbm: 300000, total_toll: 5000, total_retribusi: 10000, total_parkir: 4000, total_pengeluaran: 319000 },
      { total_transaksi: 1, total_liter: 5, total_biaya_bbm: 50000, total_toll: 0, total_retribusi: 0, total_parkir: 1000, total_pengeluaran: 51000 },
    ]);
    expect(t).toEqual({ transaksi: 3, liter: 35, bbm: 350000, tol: 5000, retribusi: 10000, parkir: 5000, pengeluaran: 370000 });
  });
  it('cache lama tanpa field baru dianggap nol; total pengeluaran dihitung dari komponen', () => {
    const t = totalBulan([{ total_transaksi: 1, total_liter: 10, total_biaya_bbm: 100, total_toll: 5 }]);
    expect(t).toEqual({ transaksi: 1, liter: 10, bbm: 100, tol: 5, retribusi: 0, parkir: 0, pengeluaran: 105 });
  });
});
