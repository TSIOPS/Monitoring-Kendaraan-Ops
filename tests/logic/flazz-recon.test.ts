import { describe, expect, it } from 'vitest';
import {
  buildBbmFlazz, computeLedger, deleteRecon409, hasCompliantLaporan, jalurSudahDilaporkan, latestActiveUsage,
  reconGate, reconNumbers, reconStatus, usageClosedBy, UsageLike,
} from '../../src/logic/flazz-recon';
import { laporanRow } from '../helpers';

const usage = (over: Partial<UsageLike> = {}): UsageLike => ({
  id: 'U-1', card_id: 'FLZ-A', status: 'DIBERIKAN', date: '2026-10-01T00:00:00.000Z', used_at: '2026-10-01T00:00:00.000Z',
  returned_at: '', opening_balance: 500000, driver_id: 'Supir A', vehicle_id: 'V-1', ref_type: 'JALUR', ref_id: 'J-1', ...over,
});
const item = (over: Record<string, unknown> = {}) => ({ card_id: 'FLZ-A', amount: 0, date: '2026-10-02', created_at: '2026-10-02T01:00:00.000Z', is_deleted: '', ...over }) as any;
const SINCE = Date.parse('2026-10-01T00:00:00.000Z');

describe('latestActiveUsage', () => {
  it('memilih DIBERIKAN dengan used_at terbaru untuk kartu itu (id kanonik)', () => {
    const list = [usage({ id: 'a' }), usage({ id: 'b', used_at: '2026-10-03T00:00:00.000Z' }), usage({ id: 'c', status: 'DIKEMBALIKAN', used_at: '2026-10-09T00:00:00.000Z' })];
    expect(latestActiveUsage(list, 'FLZA')?.id).toBe('b');
    expect(latestActiveUsage(list, 'FLZ-X')).toBeNull();
  });
});

describe('computeLedger', () => {
  it('hanya menghitung yang tercatat SETELAH penyerahan, tidak terhapus, kartu yang sama', () => {
    const l = computeLedger('FLZ-A', SINCE,
      [item({ amount: 100000 }), item({ amount: 5, created_at: '2026-10-01T00:00:00.000Z' }), item({ amount: 7, is_deleted: '1' }), item({ amount: 9, card_id: 'FLZ-B' })],
      [item({ amount: 3000 })],
      [laporanRow({ timestamp: '2026-10-02T02:00:00.000Z', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-A', biaya_bbm: 150000, metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-A', biaya_toll: 20000 }),
        laporanRow({ timestamp: '2026-09-30T02:00:00.000Z', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-A', biaya_bbm: 999 })],
    );
    expect(l).toEqual({ total_topup: 100000, total_tol: 23000, total_bbm_flazz: 150000 });
  });

  it('pembayaran kartu ke-2 ikut dihitung (D1)', () => {
    const l = computeLedger('FLZ-B', SINCE, [], [], [laporanRow({ timestamp: '2026-10-02T02:00:00.000Z', flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000, flazz_card_id_toll_2: 'FLZ-B', biaya_toll_2: 4000 })]);
    expect(l).toEqual({ total_topup: 0, total_bbm_flazz: 500000, total_tol: 4000 });
  });

  it('tanpa penyerahan (since null) semua waktu dihitung', () => {
    expect(computeLedger('FLZ-A', null, [item({ amount: 10, created_at: 'bukan tanggal' })], [], []).total_topup).toBe(10);
  });
});

describe('reconNumbers & reconStatus', () => {
  const l = { total_topup: 100000, total_bbm_flazz: 150000, total_tol: 23000 };
  it('opening dari penyerahan bila > 0', () => {
    expect(reconNumbers(500000, 0, l)).toMatchObject({ opening_balance: 500000, flazz_balance: 427000 });
  });
  it('opening 0 direkonstruksi dari saldo kini', () => {
    expect(reconNumbers(0, 427000, l)).toMatchObject({ opening_balance: 500000, flazz_balance: 427000 });
  });
  it('selisih = sistem - fisik; toleransi 1 rupiah', () => {
    expect(reconStatus(427000, 427000)).toEqual({ difference: 0, status: 'SESUAI' });
    expect(reconStatus(427000, 426999)).toEqual({ difference: 1, status: 'SESUAI' });
    expect(reconStatus(427000, 420000)).toEqual({ difference: 7000, status: 'PERLU_PEMERIKSAAN' });
  });
});

describe('syarat rekonsiliasi', () => {
  const ok = laporanRow({ timestamp: '2026-10-02T02:00:00.000Z', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-A', foto_km_awal: 'u1', foto_km_akhir: 'u2', km_awal_confirmed: '100', km_akhir_confirmed: '200' });
  const jenis = new Map([['V-1', 'DIGITAL_BAR'], ['V-J', 'ANALOG_JARUM']]);

  it('laporan berfoto lengkap dengan KM > 0 memenuhi', () => {
    expect(hasCompliantLaporan('FLZ-A', SINCE, [ok], jenis)).toBe(true);
  });
  it('foto kosong atau sebelum periode tidak memenuhi; laporan pada momen penyerahan tetap dihitung', () => {
    expect(hasCompliantLaporan('FLZ-A', SINCE, [{ ...ok, foto_km_akhir: '' }], jenis)).toBe(false);
    expect(hasCompliantLaporan('FLZ-A', SINCE, [{ ...ok, timestamp: '2026-09-30T00:00:00.000Z' }], jenis)).toBe(false);
    expect(hasCompliantLaporan('FLZ-A', SINCE, [{ ...ok, timestamp: '2026-10-01T00:00:00.000Z' }], jenis)).toBe(true);
  });
  it('kendaraan jarum tidak perlu KM > 0; kartu ke-2 ikut (D1)', () => {
    expect(hasCompliantLaporan('FLZ-A', SINCE, [{ ...ok, vehicle_id: 'V-J', km_awal_confirmed: '0' }], jenis)).toBe(true);
    expect(hasCompliantLaporan('FLZ-B', SINCE, [{ ...ok, flazz_card_id_2: 'FLZ-B' }], jenis)).toBe(true);
  });
  it('jalur yang sudah dilaporkan meloloskan tanpa laporan berkartu', () => {
    expect(jalurSudahDilaporkan('FLZ-A', [usage()], new Map([['J-1', 'SUDAH_LAPORAN']]))).toBe(true);
    expect(jalurSudahDilaporkan('FLZ-A', [usage()], new Map([['J-1', 'BELUM_DIISI']]))).toBe(false);
    expect(reconGate(false, true).eligible).toBe(true);
    expect(reconGate(false, false)).toEqual({ eligible: false, reason: 'Belum ada laporan valid dengan foto KM awal & akhir pada periode kartu ini.' });
  });
});

describe('hapus rekonsiliasi', () => {
  const recon = { id: 'R-2', card_id: 'FLZ-A', date: '2026-10-05', reconciled_at: '2026-10-05T10:00:00.000Z', is_deleted: '', opening_balance: 500000 };

  it('boleh bila terakhir dan tanpa aktivitas baru', () => {
    expect(deleteRecon409(recon, [recon, { ...recon, id: 'R-1', reconciled_at: '2026-10-01T00:00:00.000Z' }], [], [], [])).toBeNull();
  });
  it('menolak bila ada rekon lebih baru', () => {
    expect(deleteRecon409(recon, [recon, { ...recon, id: 'R-3', reconciled_at: '2026-10-06T00:00:00.000Z' }], [], [], [])).toContain('TERAKHIR');
  });
  it('menolak bila ada laporan kartu ke-2, top up, atau penyerahan baru setelahnya', () => {
    const lap = laporanRow({ timestamp: '2026-10-05T11:00:00.000Z', flazz_card_id_2: 'FLZ-A', biaya_bbm_2: 1000 });
    expect(deleteRecon409(recon, [recon], [lap], [], [])).toContain('laporan BBM ber-Flazz baru');
    expect(deleteRecon409(recon, [recon], [], [item({ created_at: '2026-10-05T11:00:00.000Z' })], [])).toContain('Top Up baru');
    expect(deleteRecon409(recon, [recon], [], [], [usage({ used_at: '2026-10-05T11:00:00.000Z' })])).toContain('diserahkan lagi');
  });
  it('usageClosedBy memilih DIKEMBALIKAN terakhir sebelum/pada waktu rekon', () => {
    const list = [
      usage({ id: 'u1', status: 'DIKEMBALIKAN', returned_at: '2026-10-01T00:00:00.000Z' }),
      usage({ id: 'u2', status: 'DIKEMBALIKAN', returned_at: '2026-10-05T10:00:00.000Z' }),
      usage({ id: 'u3', status: 'DIKEMBALIKAN', returned_at: '2026-10-07T00:00:00.000Z' }),
    ];
    expect(usageClosedBy(recon, list)?.id).toBe('u2');
  });
});

describe('buildBbmFlazz', () => {
  it('tol kartu sama digabung ke baris BBM; kartu ke-2 menjadi baris terpisah', () => {
    const r = laporanRow({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-A', biaya_bbm: 150000, metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-A', biaya_toll: 20000, flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000 });
    const out = buildBbmFlazz([r], (x) => String(x));
    expect(out.map((b) => [b.card_id, b.amount, b.toll_amount])).toEqual([['FLZ-A', 150000, 20000], ['FLZ-B', 500000, 0]]);
  });
});
