import { describe, expect, it } from 'vitest';
import { ringkasRincian, validasiRincian, bersihkanRincian } from '../../static/js/rincian.js';

const B = (jenis: string, nominal: unknown, kartu = '', keterangan = '') => ({ jenis, nominal, kartu, keterangan });

describe('rincian (klien)', () => {
  it('bersihkanRincian membuang baris kosong total (nominal & keterangan kosong)', () => {
    expect(bersihkanRincian([B('BBM', ''), B('TOL', '5000', '', ' GT ')])).toEqual([{ jenis: 'TOL', nominal: 5000, kartu: '', keterangan: 'GT' }]);
  });
  it('ringkasan total BBM, tol, dan per kartu', () => {
    const r = ringkasRincian([B('BBM', 200000, 'FLZ-1'), B('TOL', 15500, 'FLZ-1'), B('BBM', 50000)]);
    expect(r).toEqual({ bbm: 250000, tol: 15500, perKartu: { 'FLZ-1': 215500 }, jumlah: 3 });
  });
  it('validasi sama dengan server: nominal, keterangan, maks 30, maks 2 cara bayar', () => {
    expect(validasiRincian([B('BBM', 0)])).toEqual(['Baris 1: nominal harus lebih dari 0.']);
    expect(validasiRincian([B('TOL', 1, '', 'x'.repeat(101))])).toEqual(['Baris 1: keterangan maksimal 100 karakter.']);
    expect(validasiRincian(Array.from({ length: 31 }, () => B('BBM', 1)))).toEqual(['Rincian pengeluaran maksimal 30 baris.']);
    expect(validasiRincian([B('TOL', 1, 'A'), B('TOL', 1, 'B'), B('TOL', 1)], (id: string) => `Etoll ${id}`))
      .toEqual(['Tol dibayar dengan 3 cara (Etoll A, Etoll B, Tunai). Maksimal 2 cara per jenis — gabungkan atau pindahkan salah satu.']);
  });
  it('validasi sama dengan server: nominal maks Rp 100.000.000, tak hingga, kartu maks 64 karakter', () => {
    expect(validasiRincian([B('BBM', 100000000), B('BBM', 100000001), B('TOL', Infinity), B('TOL', 1, 'K'.repeat(65))])).toEqual([
      'Baris 2: nominal maksimal Rp 100.000.000.',
      'Baris 3: nominal harus lebih dari 0.',
      'Baris 4: kartu tidak valid.',
    ]);
  });
});
