import { describe, expect, it } from 'vitest';
import { badgeDokumenRingkasan, kumpulkanBaris, teksDokumen } from '../../static/js/pages/jalur.js';

describe('kumpulkanBaris', () => {
  const lengkap = { driver_id: 'S-1', driver2_id: '', vehicle_id: 'V-1', rute_tujuan: 'Gudang - Toko', etoll_card_id: '', etoll_card_id_2: '' };

  it('melewati baris kosong dan menerima baris lengkap', () => {
    const kosong = { driver_id: '', driver2_id: '', vehicle_id: '', rute_tujuan: '', etoll_card_id: '', etoll_card_id_2: '' };
    expect(kumpulkanBaris([kosong, lengkap])).toEqual({ valid: [lengkap], err: [] });
  });

  it('menolak baris setengah terisi dengan nomor baris', () => {
    expect(kumpulkanBaris([{ ...lengkap, rute_tujuan: ' ' }]).err).toEqual(['Baris 1: driver, kendaraan, dan rute wajib diisi.']);
  });

  it('menolak kartu 1 dan 2 yang sama', () => {
    expect(kumpulkanBaris([{ ...lengkap, etoll_card_id: 'FLZ-A', etoll_card_id_2: 'FLZ-A' }]).err[0]).toContain('kartu etoll ke-2');
  });

  it('semua kosong -> minta minimal satu baris', () => {
    expect(kumpulkanBaris([]).err).toEqual(['Isi minimal satu baris jalur.']);
  });
});

describe('teksDokumen', () => {
  it('format sisa hari, lewat, dan tidak ada', () => {
    expect(teksDokumen('AMAN', 86)).toBe('86 hari');
    expect(teksDokumen('LEWAT', -5)).toBe('Lewat 5 hari');
    expect(teksDokumen('TIDAK_ADA', null)).toBe('-');
  });
});

describe('badgeDokumenRingkasan (seperti jalurPajakBadge GAS)', () => {
  it('teks dan warna per status', () => {
    expect(badgeDokumenRingkasan('AMAN', 71, 'Pajak')).toEqual({ text: 'Pajak habis dalam 71 hari', kelas: 'bg-success' });
    expect(badgeDokumenRingkasan('WASPADA', 40, 'KIR')).toEqual({ text: 'KIR habis dalam 40 hari', kelas: 'bg-warning text-dark' });
    expect(badgeDokumenRingkasan('KRITIS', 29, 'KIR')).toEqual({ text: 'KIR habis dalam 29 hari', kelas: 'bg-danger' });
    expect(badgeDokumenRingkasan('LEWAT', -5, 'Pajak 5 Tahun')).toEqual({ text: 'Pajak 5 Tahun lewat 5 hari', kelas: 'bg-dark' });
    expect(badgeDokumenRingkasan('TIDAK_ADA', null, 'Pajak')).toEqual({ text: 'Pajak -', kelas: 'bg-secondary' });
  });
});
