import { describe, expect, it } from 'vitest';
import { bodyEdit, rincianBerubah, tanggalIso, validateEdit } from '../../static/js/pages/edit.js';

const TRX = { km_awal: 1000, km_akhir: 1100 };
const NILAI = {
  tanggal: '2026-10-05', nama_supir: 'Supir A', km_awal: '1000', km_akhir: '1100', bar_awal: '8', bar_akhir: '4', liter_bbm: '10',
  rincian: [{ jenis: 'BBM', nominal: 100000, kartu: '', keterangan: '' }],
};

describe('tanggalIso', () => {
  it('mengubah format tampilan DD/MM/YYYY ke YYYY-MM-DD', () => {
    expect(tanggalIso('05/10/2026')).toBe('2026-10-05');
    expect(tanggalIso('2026-10-05')).toBe('2026-10-05');
    expect(tanggalIso('-')).toBe('');
  });
});

describe('validateEdit', () => {
  it('menerima nilai valid', () => {
    expect(validateEdit(NILAI)).toEqual([]);
  });
  it('menolak KM akhir < KM awal, angka negatif, dan rincian tidak valid', () => {
    expect(validateEdit({ ...NILAI, km_akhir: '900' })).toContain('KM akhir tidak boleh lebih kecil dari KM awal.');
    expect(validateEdit({ ...NILAI, liter_bbm: '-1' })).toContain('Liter harus angka dan tidak boleh negatif.');
    expect(validateEdit({ ...NILAI, rincian: [{ jenis: 'BBM', nominal: -1, kartu: '', keterangan: '' }] })).toContain('Baris 1: nominal harus lebih dari 0.');
  });
});

describe('bodyEdit', () => {
  it('KM tidak dikirim bila tidak berubah (km_sumber ESTIMASI tetap)', () => {
    const b = bodyEdit(TRX, NILAI);
    expect(b).not.toHaveProperty('km_awal');
    expect(b).not.toHaveProperty('km_akhir');
    expect(b).toMatchObject({ tanggal: '2026-10-05', nama_supir: 'Supir A', bar_awal: 8, bar_akhir: 4, liter_bbm: 10, rincian: NILAI.rincian });
    expect(b).not.toHaveProperty('biaya_bbm');
  });
  it('KM dikirim berpasangan bila salah satu berubah', () => {
    expect(bodyEdit(TRX, { ...NILAI, km_akhir: '1150' })).toMatchObject({ km_awal: 1000, km_akhir: 1150 });
  });
  it('rincian tidak dikirim bila isinya sama dengan rincian awal (pembayaran lama dipertahankan server)', () => {
    const b = bodyEdit({ ...TRX, rincian: [{ jenis: 'BBM', nominal: 100000, kartu: '', keterangan: '' }] }, NILAI);
    expect(b).not.toHaveProperty('rincian');
    const ubah = bodyEdit({ ...TRX, rincian: [{ jenis: 'BBM', nominal: 90000, kartu: '', keterangan: '' }] }, NILAI);
    expect(ubah).toHaveProperty('rincian', NILAI.rincian);
  });
});

describe('rincianBerubah', () => {
  const R = (jenis: string, nominal: unknown, kartu = '', keterangan = '') => ({ jenis, nominal, kartu, keterangan });
  it('sama setelah dinormalkan (spasi, angka string, baris kosong) -> false', () => {
    expect(rincianBerubah([R('BBM', 100000, 'FLZ-1', 'SPBU')], [R('BBM', '100000', ' FLZ-1 ', ' SPBU '), R('BBM', '')])).toBe(false);
    expect(rincianBerubah(undefined, [])).toBe(false);
  });
  it('beda jenis / nominal / kartu / keterangan / urutan / jumlah baris -> true', () => {
    const awal = [R('BBM', 100000, 'FLZ-1', 'A'), R('TOL', 5000)];
    expect(rincianBerubah(awal, [R('TOL', 100000, 'FLZ-1', 'A'), R('TOL', 5000)])).toBe(true);
    expect(rincianBerubah(awal, [R('BBM', 100001, 'FLZ-1', 'A'), R('TOL', 5000)])).toBe(true);
    expect(rincianBerubah(awal, [R('BBM', 100000, '', 'A'), R('TOL', 5000)])).toBe(true);
    expect(rincianBerubah(awal, [R('BBM', 100000, 'FLZ-1', 'B'), R('TOL', 5000)])).toBe(true);
    expect(rincianBerubah(awal, [R('TOL', 5000), R('BBM', 100000, 'FLZ-1', 'A')])).toBe(true);
    expect(rincianBerubah(awal, [R('BBM', 100000, 'FLZ-1', 'A')])).toBe(true);
  });
});

describe('tebakJenisBbm', () => {
  it('jenis dari harga per liter transaksi lama', async () => {
    const { tebakJenisBbm } = await import('../../static/js/pages/edit.js');
    const opsi = [{ value: 'B1', harga: 10000 }, { value: 'B2', harga: 6800 }];
    expect(tebakJenisBbm(opsi, 200000, 20)).toBe('B1');
    expect(tebakJenisBbm(opsi, 68000, 10)).toBe('B2');
    expect(tebakJenisBbm(opsi, 0, 0)).toBe('');
  });
  it('liter yang dibulatkan 2 desimal tetap dikenali (harga tidak habis dibagi)', async () => {
    const { tebakJenisBbm } = await import('../../static/js/pages/edit.js');
    const opsi = [{ value: 'PERTALITE', harga: 10000 }, { value: 'PERTAMAX', harga: 12500 }, { value: 'DEX', harga: 13300 }];
    expect(tebakJenisBbm(opsi, 40000, 3.01)).toBe('DEX');
    expect(tebakJenisBbm(opsi, 40000, 3.2)).toBe('PERTAMAX');
    expect(tebakJenisBbm(opsi, 40000, 4)).toBe('PERTALITE');
    expect(tebakJenisBbm(opsi, 40000, 3.7)).toBe('');
  });
});
