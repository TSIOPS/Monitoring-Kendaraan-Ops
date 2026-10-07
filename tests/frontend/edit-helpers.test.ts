import { describe, expect, it } from 'vitest';
import { bodyEdit, tanggalIso, validateEdit } from '../../static/js/pages/edit.js';

const TRX = { km_awal: 1000, km_akhir: 1100 };
const NILAI = {
  tanggal: '2026-10-05', nama_supir: 'Supir A', km_awal: '1000', km_akhir: '1100', bar_awal: '8', bar_akhir: '4', liter_bbm: '10',
  metode_pembayaran: 'TUNAI', biaya_bbm: '100000', biaya_toll: '0', flazz_card_id: '', metode_toll: '', flazz_card_id_toll: '',
  flazz_card_id_2: '', biaya_bbm_2: '', flazz_card_id_toll_2: '', biaya_toll_2: '',
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
  it('menolak KM akhir < KM awal, angka negatif, dan Flazz tanpa kartu', () => {
    expect(validateEdit({ ...NILAI, km_akhir: '900' })).toContain('KM akhir tidak boleh lebih kecil dari KM awal.');
    expect(validateEdit({ ...NILAI, liter_bbm: '-1' })).toContain('Liter harus angka dan tidak boleh negatif.');
    expect(validateEdit({ ...NILAI, metode_pembayaran: 'FLAZZ' })).toContain('Pilih kartu Flazz untuk pembayaran.');
  });
});

describe('bodyEdit', () => {
  it('KM tidak dikirim bila tidak berubah (km_sumber ESTIMASI tetap)', () => {
    const b = bodyEdit(TRX, NILAI);
    expect(b).not.toHaveProperty('km_awal');
    expect(b).not.toHaveProperty('km_akhir');
    expect(b).toMatchObject({ tanggal: '2026-10-05', nama_supir: 'Supir A', bar_awal: 8, bar_akhir: 4, liter_bbm: 10, biaya_bbm_2: 0 });
  });
  it('KM dikirim berpasangan bila salah satu berubah', () => {
    expect(bodyEdit(TRX, { ...NILAI, km_akhir: '1150' })).toMatchObject({ km_awal: 1000, km_akhir: 1150 });
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
});
