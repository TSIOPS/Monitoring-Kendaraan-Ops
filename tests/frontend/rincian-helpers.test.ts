import { describe, expect, it } from 'vitest';
import { ringkasRincian, validasiRincian, bersihkanRincian, nominalBawaan, jenisTunaiSaja, JENIS, labelJenis, NOMINAL_RETRIBUSI } from '../../static/js/rincian.js';

const B = (jenis: string, nominal: unknown, kartu = '', keterangan = '') => ({ jenis, nominal, kartu, keterangan });

describe('rincian (klien)', () => {
  it('bersihkanRincian membuang baris kosong total (nominal & keterangan kosong)', () => {
    expect(bersihkanRincian([B('BBM', ''), B('TOL', '5000', '', ' GT ')])).toEqual([{ jenis: 'TOL', nominal: 5000, kartu: '', keterangan: 'GT' }]);
  });
  it('ringkasan total BBM, tol, dan per kartu', () => {
    const r = ringkasRincian([B('BBM', 200000, 'FLZ-1'), B('TOL', 15500, 'FLZ-1'), B('BBM', 50000)]);
    expect(r).toEqual({ bbm: 250000, tol: 15500, retribusi: 0, parkir: 0, perKartu: { 'FLZ-1': 215500 }, jumlah: 3 });
  });
  it('4 jenis: BBM, Tol, Retribusi, Parkir Delivery; label dan default nominal', () => {
    expect(JENIS.map((j: { value: string }) => j.value)).toEqual(['BBM', 'TOL', 'RETRIBUSI', 'PARKIR']);
    expect(labelJenis('TOL')).toBe('Tol');
    expect(labelJenis('RETRIBUSI')).toBe('Retribusi');
    expect(labelJenis('PARKIR')).toBe('Parkir Delivery');
    expect(NOMINAL_RETRIBUSI).toBe(10000);
    expect(nominalBawaan('RETRIBUSI')).toBe('10000');
    expect(nominalBawaan('PARKIR')).toBe('');
    expect(nominalBawaan('BBM')).toBe('');
    expect(jenisTunaiSaja('RETRIBUSI')).toBe(true);
    expect(jenisTunaiSaja('PARKIR')).toBe(true);
    expect(jenisTunaiSaja('BBM')).toBe(false);
    expect(jenisTunaiSaja('TOL')).toBe(false);
  });
  it('bersihkanRincian mempertahankan jenis baru dan memaksa kartu kosong (tunai) untuk Retribusi/Parkir', () => {
    expect(bersihkanRincian([B('retribusi', '10000', 'FLZ-1', ' Gerbang '), B('PARKIR', '5000', 'FLZ-2')])).toEqual([
      { jenis: 'RETRIBUSI', nominal: 10000, kartu: '', keterangan: 'Gerbang' },
      { jenis: 'PARKIR', nominal: 5000, kartu: '', keterangan: '' },
    ]);
  });
  it('ringkasRincian: Retribusi/Parkir terpisah, tidak masuk tol maupun perKartu', () => {
    const r = ringkasRincian([B('BBM', 100000, 'FLZ-1'), B('TOL', 5000), B('RETRIBUSI', 10000, 'FLZ-1'), B('PARKIR', 3000), B('PARKIR', 2000)]);
    expect(r).toEqual({ bbm: 100000, tol: 5000, retribusi: 10000, parkir: 5000, perKartu: { 'FLZ-1': 100000 }, jumlah: 5 });
  });
  it('validasiRincian menerima 4 jenis; jenis lain ditolak; Retribusi/Parkir bukan "cara bayar" (maks 2 hanya BBM/Tol)', () => {
    expect(validasiRincian([B('RETRIBUSI', 10000), B('PARKIR', 1)])).toEqual([]);
    expect(validasiRincian([B('LAIN', 1)])).toEqual(['Baris 1: jenis harus BBM, Tol, Retribusi, atau Parkir Delivery.']);
    expect(validasiRincian([B('BBM', 1, 'A'), B('BBM', 1, 'B'), B('RETRIBUSI', 10000), B('PARKIR', 1)])).toEqual([]);
    expect(validasiRincian([B('RETRIBUSI', 0)])).toEqual(['Baris 1: nominal harus lebih dari 0.']);
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
