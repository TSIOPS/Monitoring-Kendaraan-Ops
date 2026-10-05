import { describe, expect, it } from 'vitest';
import {
  buildFlazzChecks, buildRecentList, cardGroups, distinctFlazzCardsOf, flazzBbmShare, flazzCardCharge,
  flazzEditDelta, flazzShareForCard, flazzTolShare, group2FromRow, groupMonthly, isDuplicateRow,
  isFlazzRowForCard, mapPrefillRow, rowBbmTotal, rowTolTotal,
} from '../../src/logic/laporan';
import { laporanRow } from '../helpers';

// Kasus nyata dari data GAS (TRX-1790403411499): BBM kartu A 150rb + kartu B 500rb, tol kartu A.
const DUA_KARTU = laporanRow({
  metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-A', biaya_bbm: 150000,
  metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-A', biaya_toll: 463000,
  flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000, flazz_card_id_toll_2: 'FLZ-B', biaya_toll_2: 0,
});

describe('group2FromRow', () => {
  it('null bila keempat kolom kosong (baris lama tidak tersentuh)', () => {
    expect(group2FromRow(laporanRow())).toBeNull();
  });

  it('kartu terisi -> FLAZZ', () => {
    expect(group2FromRow(DUA_KARTU)).toEqual({ mBbm: 'FLAZZ', cBbm: 'FLZ-B', bBbm: 500000, mTol: 'FLAZZ', cTol: 'FLZ-B', bTol: 0 });
  });

  it('nominal tanpa kartu -> TUNAI', () => {
    const g = group2FromRow(laporanRow({ biaya_bbm_2: 20000 }));
    expect(g).toMatchObject({ mBbm: 'TUNAI', cBbm: '', bBbm: 20000, mTol: '' });
  });

  it('menerima kunci state (cardBbm2, biayaBbm2, ...)', () => {
    expect(group2FromRow({ cardTol2: 'FLZ-C', biayaTol2: 7000 })).toMatchObject({ mBbm: '', mTol: 'FLAZZ', cTol: 'FLZ-C', bTol: 7000 });
  });
});

describe('cardGroups dan share per kartu', () => {
  it('baris lama hanya punya satu grup', () => {
    expect(cardGroups(laporanRow())).toHaveLength(1);
  });

  it('share dijumlahkan dari semua grup', () => {
    expect(flazzBbmShare(DUA_KARTU, 'FLZ-A')).toBe(150000);
    expect(flazzBbmShare(DUA_KARTU, 'FLZ-B')).toBe(500000);
    expect(flazzTolShare(DUA_KARTU, 'FLZ-A')).toBe(463000);
    expect(flazzShareForCard(DUA_KARTU, 'FLZ-B')).toBe(500000);
    expect(isFlazzRowForCard(DUA_KARTU, 'FLZ-B')).toBe(true);
    expect(isFlazzRowForCard(DUA_KARTU, 'FLZ-X')).toBe(false);
  });

  it('kartu yang sama di grup-1 dan grup-2 teragregasi', () => {
    const r = laporanRow({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-A', biaya_bbm: 100000, metode_toll: 'TUNAI', flazz_card_id_2: 'FLZ-A', biaya_bbm_2: 50000 });
    expect(flazzCardCharge(r, 'FLZ-A')).toBe(150000);
  });

  it('nominal grup-2 tanpa kartu tidak membebani kartu mana pun', () => {
    const r = laporanRow({ biaya_bbm_2: 30000 });
    expect(flazzCardCharge(r, 'FLZ-A')).toBe(0);
    expect(distinctFlazzCardsOf(r)).toEqual([]);
  });
});

describe('distinctFlazzCardsOf dan flazzEditDelta', () => {
  it('mengumpulkan kartu dari semua grup tanpa duplikat', () => {
    expect(distinctFlazzCardsOf(DUA_KARTU)).toEqual(['FLZ-A', 'FLZ-B']);
  });

  it('memindah kartu grup-2: kartu lama dikembalikan, kartu baru dipotong', () => {
    const lama = { metodeBbm: 'TUNAI', cardBbm: '', biayaBbm: 0, metodeTol: 'TUNAI', cardTol: '', biayaTol: 0, cardBbm2: 'FLZ-B', biayaBbm2: 40000 };
    const baru = { ...lama, cardBbm2: 'FLZ-C' };
    expect(flazzEditDelta(lama, baru, 'FLZ-B')).toBe(40000);
    expect(flazzEditDelta(lama, baru, 'FLZ-C')).toBe(-40000);
  });
});

describe('total transaksi', () => {
  it('rowBbmTotal dan rowTolTotal = grup-1 + grup-2', () => {
    expect(rowBbmTotal(DUA_KARTU)).toBe(650000);
    expect(rowTolTotal(laporanRow({ biaya_toll: 10000, biaya_toll_2: 5000 }))).toBe(15000);
  });

  it('groupMonthly menjumlahkan grup-2', () => {
    const out = groupMonthly([{ ...DUA_KARTU, tanggal: '2026-09-25' }], '2026-09');
    expect(out[0]).toMatchObject({ total_biaya_bbm: 650000, total_toll: 463000 });
  });
});

describe('buildFlazzChecks dengan grup-2', () => {
  it('menambah cek kartu 2 dan mengagregasi kartu yang sama', () => {
    const checks = buildFlazzChecks('FLAZZ', 'FLZ-A', 100000, 'TUNAI', '', 0, { cardBbm2: 'FLZ-A', biayaBbm2: 50000, cardTol2: 'FLZ-B', biayaTol2: 7000 });
    expect(checks).toEqual([
      { cardId: 'FLZ-A', label: ['BBM', 'BBM kartu 2'], total: 150000 },
      { cardId: 'FLZ-B', label: ['tol kartu 2'], total: 7000 },
    ]);
  });

  it('tanpa grup-2 hasilnya sama seperti sebelumnya', () => {
    expect(buildFlazzChecks('FLAZZ', 'FLZ-A', 100000, 'TUNAI', '', 0)).toEqual([{ cardId: 'FLZ-A', label: ['BBM'], total: 100000 }]);
  });
});

describe('isDuplicateRow dengan grup-2', () => {
  const kunci = { vehicle_id: 'V-1', tanggal: '2026-09-01', km_awal: '100', km_akhir: '200', liter: '10', biaya_bbm: '100000', biaya_toll: '0' };

  it('nominal grup-2 berbeda bukan duplikat', () => {
    const r = laporanRow({ biaya_bbm_2: 50000 });
    expect(isDuplicateRow(r, { ...kunci, biaya_bbm_2: '0', biaya_toll_2: '0' })).toBe(false);
    expect(isDuplicateRow(r, { ...kunci, biaya_bbm_2: '50000', biaya_toll_2: '0' })).toBe(true);
  });

  it('kunci tanpa grup-2 dianggap 0', () => {
    expect(isDuplicateRow(laporanRow(), kunci)).toBe(true);
  });
});

describe('pembacaan membawa grup-2', () => {
  const cardMap = new Map([['FLZA', 'FLZ-A'], ['FLZB', 'FLZ-B']]);

  it('mapPrefillRow', () => {
    expect(mapPrefillRow(DUA_KARTU, cardMap)).toMatchObject({ flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000, flazz_card_id_toll_2: 'FLZ-B', biaya_toll_2: 0 });
  });

  it('buildRecentList memberi field grup-2 dan total', () => {
    const [item] = buildRecentList([DUA_KARTU], new Map(), new Map(), cardMap);
    expect(item).toMatchObject({ flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000, total_bbm: 650000, total_toll: 463000 });
  });
});
