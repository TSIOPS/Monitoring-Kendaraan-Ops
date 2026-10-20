import { describe, expect, it } from 'vitest';
import { normalRincian, rincianKeSlot, slotKeRincian, rincianDariRow, MSG_RINCIAN_MAKS_BARIS } from '../../src/logic/rincian';
import type { LaporanRow } from '../../src/logic/laporan';

const B = (jenis: string, nominal: unknown, kartu = '', keterangan = '') => ({ jenis, nominal, kartu, keterangan });

describe('normalRincian', () => {
  it('membersihkan item valid: jenis huruf besar, nominal dibulatkan, keterangan dipangkas', () => {
    const r = normalRincian([B('bbm', '200000.4', ' FLZ-1 ', '  SPBU Cikampek  '), B('Tol', 15500)]);
    expect(r.galat).toEqual([]);
    expect(r.items).toEqual([
      { jenis: 'BBM', nominal: 200000, kartu: 'FLZ-1', keterangan: 'SPBU Cikampek' },
      { jenis: 'TOL', nominal: 15500, kartu: '', keterangan: '' },
    ]);
  });
  it('bukan array -> galat; > 30 baris -> galat', () => {
    expect(normalRincian('x').galat).toEqual(['Rincian pengeluaran tidak valid.']);
    expect(normalRincian(Array.from({ length: 31 }, () => B('BBM', 1))).galat).toEqual([MSG_RINCIAN_MAKS_BARIS]);
  });
  it('galat per baris: jenis, nominal <= 0 / bukan angka, keterangan > 100', () => {
    const r = normalRincian([B('SOLAR', 1), B('BBM', 0), B('TOL', 'abc'), B('BBM', 1, '', 'x'.repeat(101))]);
    expect(r.galat).toEqual([
      'Baris 1: jenis harus BBM atau Tol.',
      'Baris 2: nominal harus lebih dari 0.',
      'Baris 3: nominal harus lebih dari 0.',
      'Baris 4: keterangan maksimal 100 karakter.',
    ]);
  });
});

describe('rincianKeSlot', () => {
  it('kosong -> semua slot nol, metode tunai eksplisit', () => {
    expect(rincianKeSlot([])).toEqual({ slot: {
      metode_pembayaran: 'TUNAI', flazz_card_id: '', biaya_bbm: 0, metode_toll: 'TUNAI', flazz_card_id_toll: '', biaya_toll: 0,
      flazz_card_id_2: '', biaya_bbm_2: 0, flazz_card_id_toll_2: '', biaya_toll_2: 0,
    }, galat: [] });
  });
  it('satu kartu untuk BBM & tol; nominal sejenis dijumlah; kartu kanonis sama digabung', () => {
    const { slot, galat } = rincianKeSlot(normalRincian([B('BBM', 200000, 'FLZ-1'), B('TOL', 15500, 'FLZ-1'), B('TOL', 23000, 'FLZ1')]).items);
    expect(galat).toEqual([]);
    expect(slot).toMatchObject({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 200000, metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-1', biaya_toll: 38500, biaya_bbm_2: 0, biaya_toll_2: 0 });
  });
  it('dua sumber per jenis: urutan kemunculan; tunai di slot-2 = kartu kosong', () => {
    const { slot } = rincianKeSlot(normalRincian([B('BBM', 200000, 'FLZ-1'), B('BBM', 150000), B('TOL', 5000), B('TOL', 7000, 'FLZ-2')]).items);
    expect(slot).toMatchObject({
      metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 200000, flazz_card_id_2: '', biaya_bbm_2: 150000,
      metode_toll: 'TUNAI', flazz_card_id_toll: '', biaya_toll: 5000, flazz_card_id_toll_2: 'FLZ-2', biaya_toll_2: 7000,
    });
  });
  it('lebih dari 2 cara bayar per jenis -> galat dengan label kartu', () => {
    const { galat } = rincianKeSlot(normalRincian([B('BBM', 1, 'FLZ-1'), B('BBM', 1, 'FLZ-2'), B('BBM', 1)]).items, (id) => (id === 'FLZ-1' ? 'Etoll A' : 'Etoll B'));
    expect(galat).toEqual(['BBM dibayar dengan 3 cara (Etoll A, Etoll B, Tunai). Maksimal 2 cara per jenis — gabungkan atau pindahkan salah satu.']);
  });
});

const row = (o: Partial<LaporanRow>) => ({
  metode_pembayaran: 'TUNAI', flazz_card_id: '', biaya_bbm: 0, metode_toll: 'TUNAI', flazz_card_id_toll: '', biaya_toll: 0,
  flazz_card_id_2: '', biaya_bbm_2: 0, flazz_card_id_toll_2: '', biaya_toll_2: 0, ...o,
}) as LaporanRow;

describe('slotKeRincian & rincianDariRow', () => {
  it('laporan lama: 1 baris per slot bernominal, tol ikut kartu BBM bila metode_toll kosong', () => {
    expect(slotKeRincian(row({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 350000, metode_toll: '', biaya_toll: 42000, biaya_bbm_2: 50000 }))).toEqual([
      { jenis: 'BBM', nominal: 350000, kartu: 'FLZ-1', keterangan: '' },
      { jenis: 'TOL', nominal: 42000, kartu: 'FLZ-1', keterangan: '' },
      { jenis: 'BBM', nominal: 50000, kartu: '', keterangan: '' },
    ]);
  });
  it('rincianDariRow memakai kolom rincian bila ada, tandai lama bila tidak', () => {
    const it1 = { jenis: 'TOL' as const, nominal: 5000, kartu: '', keterangan: 'GT A' };
    expect(rincianDariRow(row({ biaya_toll: 5000, rincian: [it1] }))).toEqual({ items: [it1], lama: false });
    expect(rincianDariRow(row({ biaya_toll: 5000 }))).toEqual({ items: [{ jenis: 'TOL', nominal: 5000, kartu: '', keterangan: '' }], lama: true });
  });
});
