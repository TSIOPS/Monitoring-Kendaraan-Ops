import { describe, expect, it } from 'vitest';
import { rekapPengeluaran, rekapTopup } from '../../src/logic/rekap';

const row = (over: Record<string, unknown>) => ({
  transaction_id: 'TRX-1', tanggal: '2026-10-01', kode_cabang: 'BDG', vehicle_id: 'V-1', plat_nomor: 'D 1 A', nama_supir: 'Agus',
  metode_pembayaran: '', flazz_card_id: '', biaya_bbm: 0, metode_toll: '', flazz_card_id_toll: '', biaya_toll: 0,
  flazz_card_id_2: '', biaya_bbm_2: 0, flazz_card_id_toll_2: '', biaya_toll_2: 0, ...over,
}) as any;
const cards = [
  { id: 'FLZ-1', card_name: 'E toll 1', branch_id: 'BDG' },
  { id: 'FLZ-2', card_name: 'E toll 2', branch_id: 'JKT' },
];
const dasar = { tols: [], cards, platByVehicle: new Map([['V-9', 'B 9 Z']]), dari: '2026-10-01', sampai: '2026-10-31', cabang: '' };
const ringkas = (lines: any[]) => lines.map((l) => [l.jenis, l.metode, l.kartu, l.amount]);

describe('rekapPengeluaran', () => {
  it('BBM tunai, tol ikut metode BBM (etoll) dengan kartu BBM', () => {
    expect(ringkas(rekapPengeluaran({ ...dasar, rows: [row({ metode_pembayaran: 'TUNAI', biaya_bbm: 100000 })] }))).toEqual([['BBM', 'TUNAI', '', 100000]]);
    expect(ringkas(rekapPengeluaran({ ...dasar, rows: [row({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 200000, biaya_toll: 15000 })] })))
      .toEqual([['BBM', 'ETOLL', 'E toll 1', 200000], ['TOL', 'ETOLL', 'E toll 1', 15000]]);
  });

  it('laporan berincian: 1 line per nota dengan keterangan; laporan lama diberi keterangan penanda', () => {
    const rows = [
      row({ transaction_id: 'TRX-1', tanggal: '2026-10-05', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 300, metode_toll: 'TUNAI', biaya_toll: 50,
        rincian: [{ jenis: 'BBM', nominal: 100, kartu: 'FLZ-1', keterangan: 'SPBU A' }, { jenis: 'BBM', nominal: 200, kartu: 'FLZ-1', keterangan: 'SPBU B' }, { jenis: 'TOL', nominal: 50, kartu: '', keterangan: 'GT' }] }),
      row({ transaction_id: 'TRX-2', tanggal: '2026-10-05', biaya_bbm: 70 }),
    ];
    const lines = rekapPengeluaran({ ...dasar, rows, tols: [{ id: 'T-1', date: '2026-10-05', card_id: 'FLZ-1', driver_id: 'x', vehicle_id: 'V-1', amount: 9, notes: 'tol manual' }] });
    expect(lines.map((l) => [l.ref, l.jenis, l.metode, l.amount, l.keterangan])).toEqual(expect.arrayContaining([
      ['TRX-1', 'BBM', 'ETOLL', 100, 'SPBU A'], ['TRX-1', 'BBM', 'ETOLL', 200, 'SPBU B'], ['TRX-1', 'TOL', 'TUNAI', 50, 'GT'],
      ['TRX-2', 'BBM', 'TUNAI', 70, '(total, tanpa rincian)'], ['T-1', 'TOL', 'ETOLL', 9, 'tol manual'],
    ]));
    expect(lines).toHaveLength(5);
  });

  it('kartu ke-2: nominal dengan kartu = etoll, tanpa kartu = tunai', () => {
    const lines = rekapPengeluaran({ ...dasar, rows: [row({
      metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 50000,
      flazz_card_id_2: 'FLZ-2', biaya_bbm_2: 30000, biaya_toll_2: 7000,
    })] });
    expect(ringkas(lines)).toEqual([['BBM', 'ETOLL', 'E toll 1', 50000], ['BBM', 'ETOLL', 'E toll 2', 30000], ['TOL', 'TUNAI', '', 7000]]);
  });

  it('metode kosong dengan nominal = tunai; nominal 0 diabaikan', () => {
    expect(ringkas(rekapPengeluaran({ ...dasar, rows: [row({ biaya_bbm: 90000 }), row({ transaction_id: 'TRX-2' })] }))).toEqual([['BBM', 'TUNAI', '', 90000]]);
  });

  it('tol manual Flazz ikut sebagai TOL ETOLL; warehouse dari kartu', () => {
    const tols = [
      { id: 'TOL-1', date: '2026-10-05', card_id: 'FLZ-1', driver_id: 'Budi', vehicle_id: 'V-9', amount: 12000 },
      { id: 'TOL-2', date: '2026-10-05', card_id: 'FLZ-2', driver_id: 'Cici', vehicle_id: 'V-9', amount: 8000 },
    ];
    const lines = rekapPengeluaran({ ...dasar, tols, rows: [], cabang: 'BDG' });
    expect(lines).toEqual([expect.objectContaining({ sumber: 'TOL_MANUAL', jenis: 'TOL', metode: 'ETOLL', kartu: 'E toll 1', plat_nomor: 'B 9 Z', kode_cabang: 'BDG', amount: 12000 })]);
  });

  it('rentang tanggal dan warehouse membatasi baris laporan', () => {
    const rows = [
      row({ transaction_id: 'A', tanggal: '2026-09-30', biaya_bbm: 1 }),
      row({ transaction_id: 'B', tanggal: '2026-10-31', biaya_bbm: 2 }),
      row({ transaction_id: 'C', tanggal: '2026-10-10', biaya_bbm: 3, kode_cabang: 'JKT' }),
    ];
    expect(rekapPengeluaran({ ...dasar, rows }).map((l) => l.ref)).toEqual(['B', 'C']);
    expect(rekapPengeluaran({ ...dasar, rows, cabang: 'JKT' }).map((l) => l.ref)).toEqual(['C']);
  });
});

describe('rekapTopup', () => {
  const kartu = [{ id: 'FLZ-1', card_name: 'E toll 1', card_number: '0145', branch_id: 'BDG' }, { id: 'FLZ-2', card_name: 'E toll 2', card_number: '0146', branch_id: 'JKT' }];
  const tp = (over: Record<string, unknown>) => ({ id: 'TP-1', date: '2026-10-05', card_id: 'FLZ-1', amount: 500000, evidence_url: 'u', notes: '', created_by: 'agus', ...over });
  const nama = new Map([['agus', 'Agus Setiawan']]);
  it('menyaring rentang & warehouse, mengurutkan tanggal, memberi nama kartu/pencatat/bukti', () => {
    const out = rekapTopup({
      topups: [tp({ id: 'a', date: '2026-10-09' }), tp({ id: 'b', date: '2026-09-30' }), tp({ id: 'c', card_id: 'FLZ-2' }), tp({ id: 'd', evidence_url: '', created_by: 'x' })],
      cards: kartu, namaPengguna: nama, dari: '2026-10-01', sampai: '2026-10-31', cabang: 'BDG',
    });
    expect(out.map((t) => [t.id, t.tanggal, t.kode_cabang, t.kartu, t.nominal, t.dicatat_oleh, t.ada_bukti])).toEqual([
      ['d', '2026-10-05', 'BDG', 'E toll 1', 500000, 'x', false],
      ['a', '2026-10-09', 'BDG', 'E toll 1', 500000, 'Agus Setiawan', true],
    ]);
  });
  it('tanpa filter warehouse: semua cabang; kartu tak dikenal tetap tampil', () => {
    const out = rekapTopup({ topups: [tp({ card_id: 'FLZ-9' }), tp({ id: 'c', card_id: 'FLZ-2' })], cards: kartu, namaPengguna: nama, dari: '2026-10-01', sampai: '2026-10-31', cabang: '' });
    expect(out.map((t) => [t.kartu, t.kode_cabang])).toEqual([['FLZ-9', ''], ['E toll 2', 'JKT']]);
  });
});
