import { describe, expect, it } from 'vitest';
import {
  cardDiff, compareJalur, driversForDate, findBlockers, jalurCardIds, jalurFinalStatus, JalurFull,
  latestJalurForCard, reconMaxTglByCard, statusDokumen, statusTuntas, todayWib,
} from '../../src/logic/jalur';

export const jalur = (over: Partial<JalurFull> = {}): JalurFull => ({
  id: 'J-1', tanggal: '2026-10-01', driver_id: 'D-1', nama_driver: 'Supir A', driver2_id: '', nama_driver2: '',
  vehicle_id: 'V-1', plat_nomor: 'B 1 A', nama_kendaraan: 'Truk', jenis_kendaraan: 'Mobil', rute_tujuan: 'Gudang - Toko',
  kode_cabang: 'CBG-A', flazz_card_id: '', flazz_card_name: '', flazz_card_id_2: '', flazz_card_name_2: '',
  created_by: 'Pic', created_at: '2026-10-01T00:00:00.000Z', updated_at: '', is_deleted: '', status: 'BELUM_DIISI', laporan_id: '',
  ...over,
});

describe('jalurFinalStatus (aturan status)', () => {
  const rekon = { FLZA: '2026-10-02', FLZB: '2026-09-30' };

  it('tanpa laporan -> BELUM_DIISI', () => {
    expect(jalurFinalStatus('', ['FLZ-A'], '2026-10-01', rekon)).toBe('BELUM_DIISI');
  });

  it('tanpa kartu Flazz cukup SUDAH_LAPORAN', () => {
    expect(jalurFinalStatus('TRX-1', [], '2026-10-01', rekon)).toBe('SUDAH_LAPORAN');
  });

  it('dengan kartu yang sudah direkon pada/setelah tanggal jalur -> SELESAI', () => {
    expect(jalurFinalStatus('TRX-1', ['FLZ-A'], '2026-10-01', rekon)).toBe('SELESAI');
  });

  it('dua kartu: SELESAI hanya bila keduanya direkon', () => {
    expect(jalurFinalStatus('TRX-1', ['FLZ-A', 'FLZ-B'], '2026-10-01', rekon)).toBe('SUDAH_LAPORAN');
    expect(jalurFinalStatus('TRX-1', ['FLZ-A', 'FLZ-B'], '2026-10-01', { ...rekon, FLZB: '2026-10-01' })).toBe('SELESAI');
  });

  it('reconMaxTglByCard mengabaikan rekon terhapus dan memakai tanggal terbaru', () => {
    expect(reconMaxTglByCard([
      { card_id: 'FLZ-A', date: '2026-10-01' },
      { card_id: 'FLZ-A', date: '2026-10-05', is_deleted: '1' },
      { card_id: 'FLZ-A', date: '2026-10-03' },
    ])).toEqual({ FLZA: '2026-10-03' });
  });
});

describe('gate jalur baru', () => {
  it('statusTuntas: tanpa kartu SUDAH_LAPORAN, kartu di slot 1 atau 2 -> SELESAI', () => {
    expect(statusTuntas(jalur())).toBe('SUDAH_LAPORAN');
    expect(statusTuntas(jalur({ flazz_card_id: 'FLZ-A' }))).toBe('SELESAI');
    expect(statusTuntas(jalur({ flazz_card_id_2: 'FLZ-B' }))).toBe('SELESAI');
  });

  it('memblokir bila jalur terakhir sebelum tanggal belum tuntas', () => {
    const rows = [
      jalur({ id: 'J-lama', tanggal: '2026-09-28', status: 'SELESAI' }),
      jalur({ id: 'J-1', tanggal: '2026-10-01', status: 'BELUM_DIISI' }),
    ];
    expect(findBlockers(rows, ['V-1'], '2026-10-02').map((j) => j.id)).toEqual(['J-1']);
  });

  it('jalur tanpa kartu yang SUDAH_LAPORAN tidak memblokir', () => {
    expect(findBlockers([jalur({ status: 'SUDAH_LAPORAN' })], ['V-1'], '2026-10-02')).toEqual([]);
  });

  it('jalur dengan kartu hanya di slot 2 yang baru SUDAH_LAPORAN tetap memblokir (D1)', () => {
    const rows = [jalur({ status: 'SUDAH_LAPORAN', flazz_card_id_2: 'FLZ-B' })];
    expect(findBlockers(rows, ['V-1'], '2026-10-02')).toHaveLength(1);
  });

  it('jalur pada tanggal yang sama atau sesudahnya tidak dihitung', () => {
    expect(findBlockers([jalur({ tanggal: '2026-10-02' })], ['V-1'], '2026-10-02')).toEqual([]);
  });
});

describe('kartu', () => {
  it('jalurCardIds membuang slot kosong dan duplikat', () => {
    expect(jalurCardIds('FLZ-A', '')).toEqual(['FLZ-A']);
    expect(jalurCardIds('FLZ-A', 'FLZ-A')).toEqual(['FLZ-A']);
    expect(jalurCardIds('', 'FLZ-B')).toEqual(['FLZ-B']);
  });

  it('cardDiff per himpunan: kartu yang pindah slot tidak dikembalikan', () => {
    expect(cardDiff(['FLZ-A', 'FLZ-B'], ['FLZ-B', 'FLZ-C'])).toEqual({ kembalikan: ['FLZ-A'], serahkan: ['FLZ-C'] });
    expect(cardDiff(['FLZ-A'], ['FLZ-B', 'FLZ-A'])).toEqual({ kembalikan: [], serahkan: ['FLZ-B'] });
  });

  it('latestJalurForCard memilih jalur terbaru yang memakai kartu di slot mana pun', () => {
    const rows = [
      jalur({ id: 'J-1', tanggal: '2026-10-01', flazz_card_id: 'FLZ-A' }),
      jalur({ id: 'J-2', tanggal: '2026-10-03', flazz_card_id_2: 'FLZ-A' }),
      jalur({ id: 'J-3', tanggal: '2026-10-04', flazz_card_id: 'FLZ-X' }),
    ];
    expect(latestJalurForCard(rows, 'FLZ-A')?.id).toBe('J-2');
    expect(latestJalurForCard(rows, 'FLZ-Z')).toBeNull();
  });
});

describe('statusDokumen (pajak/KIR)', () => {
  it('ambang AMAN, WASPADA, KRITIS, LEWAT, TIDAK_ADA', () => {
    expect(statusDokumen('2026-12-31', '2026-10-06')).toEqual({ sisa_hari: 86, status: 'AMAN' });
    expect(statusDokumen('2026-12-05', '2026-10-06').status).toBe('WASPADA');
    expect(statusDokumen('2026-11-05', '2026-10-06')).toEqual({ sisa_hari: 30, status: 'KRITIS' });
    expect(statusDokumen('2026-10-06', '2026-10-06')).toEqual({ sisa_hari: 0, status: 'LEWAT' });
    expect(statusDokumen('', '2026-10-06')).toEqual({ sisa_hari: null, status: 'TIDAK_ADA' });
  });

  it('todayWib memakai Asia/Jakarta', () => {
    expect(todayWib(new Date(Date.UTC(2026, 9, 5, 18, 0)))).toBe('2026-10-06');
  });
});

describe('daftar dan supir per tanggal', () => {
  it('compareJalur: tanggal terbaru, Mobil dulu, lalu nama driver', () => {
    const list = [
      jalur({ id: 'a', tanggal: '2026-10-01', nama_driver: 'Budi' }),
      jalur({ id: 'b', tanggal: '2026-10-02', jenis_kendaraan: 'Motor', nama_driver: 'Andi' }),
      jalur({ id: 'c', tanggal: '2026-10-02', nama_driver: 'Cici' }),
      jalur({ id: 'd', tanggal: '2026-10-02', nama_driver: 'Bayu' }),
    ].sort(compareJalur);
    expect(list.map((j) => j.id)).toEqual(['d', 'c', 'b', 'a']);
  });

  it('driversForDate hanya BELUM_DIISI pada tanggal & cabang itu, unik per nama+kendaraan', () => {
    const rows = [
      jalur({ id: '1' }),
      jalur({ id: '2' }),
      jalur({ id: '3', nama_driver: 'Supir B', status: 'SUDAH_LAPORAN' }),
      jalur({ id: '4', nama_driver: 'Supir C', kode_cabang: 'CBG-B' }),
      jalur({ id: '5', nama_driver: 'Supir D', tanggal: '2026-10-02' }),
    ];
    expect(driversForDate(rows, '2026-10-01', 'CBG-A').map((d) => d.nama_driver)).toEqual(['Supir A']);
    expect(driversForDate(rows, '2026-10-01', null).map((d) => d.nama_driver)).toEqual(['Supir A', 'Supir C']);
  });
});

describe('gate per driver', () => {
  const j = (o: Record<string, unknown>) => ({ id: 'J', tanggal: '2026-10-05', driver_id: 'D-1', nama_driver: 'Agus', driver2_id: '', nama_driver2: '',
    vehicle_id: 'V-1', plat_nomor: 'D 1 A', flazz_card_id: '', flazz_card_id_2: '', status: 'BELUM_DIISI', is_deleted: '', created_at: '', ...o }) as any;
  it('jalur terakhir driver (sebagai Driver 1 atau 2) belum tuntas -> diblokir', async () => {
    const { findDriverBlockers } = await import('../../src/logic/jalur');
    expect(findDriverBlockers([j({})], ['D-1'], '2026-10-06')[0]).toContain('Driver Agus (jalur 2026-10-05, D 1 A, status BELUM_DIISI) masih belum selesai. Harap input laporan');
    expect(findDriverBlockers([j({ driver_id: 'D-9', driver2_id: 'D-1', nama_driver2: 'Agus' })], ['D-1'], '2026-10-06')).toHaveLength(1);
  });
  it('tanpa kartu cukup SUDAH_LAPORAN; dengan kartu harus SELESAI (rekonsiliasi)', async () => {
    const { findDriverBlockers } = await import('../../src/logic/jalur');
    expect(findDriverBlockers([j({ status: 'SUDAH_LAPORAN' })], ['D-1'], '2026-10-06')).toEqual([]);
    expect(findDriverBlockers([j({ status: 'SUDAH_LAPORAN', flazz_card_id: 'FLZ-1' })], ['D-1'], '2026-10-06')[0]).toContain('rekonsiliasi saldo flazz');
    expect(findDriverBlockers([j({ status: 'SELESAI', flazz_card_id: 'FLZ-1' })], ['D-1'], '2026-10-06')).toEqual([]);
  });
  it('sudah terjadwal di tanggal sama -> diblokir; jalur yang diedit dikecualikan', async () => {
    const { findDriverBlockers } = await import('../../src/logic/jalur');
    expect(findDriverBlockers([j({ id: 'J-1', tanggal: '2026-10-06', status: 'BELUM_LAPORAN' })], ['D-1'], '2026-10-06')[0]).toContain('sudah terjadwal pada 2026-10-06');
    expect(findDriverBlockers([j({ id: 'J-1', tanggal: '2026-10-06' })], ['D-1'], '2026-10-06', 'J-1')).toEqual([]);
  });
  it('jalur di tanggal sama yang sudah tuntas tidak memblokir jalur baru', async () => {
    const { findDriverBlockers } = await import('../../src/logic/jalur');
    expect(findDriverBlockers([j({ id: 'J-1', tanggal: '2026-10-06', status: 'SUDAH_LAPORAN' })], ['D-1'], '2026-10-06')).toEqual([]);
    expect(findDriverBlockers([j({ id: 'J-1', tanggal: '2026-10-06', status: 'SUDAH_LAPORAN', flazz_card_id: 'FLZ-1' })], ['D-1'], '2026-10-06')[0]).toContain('sudah terjadwal');
    expect(findDriverBlockers([j({ id: 'J-1', tanggal: '2026-10-06', status: 'SELESAI', flazz_card_id: 'FLZ-1' })], ['D-1'], '2026-10-06')).toEqual([]);
  });
  it('driverGanda: driver dipilih dua kali dalam satu simpan', async () => {
    const { driverGanda } = await import('../../src/logic/jalur');
    expect(driverGanda([{ driver_id: 'D-1', driver2_id: 'D-2' }, { driver_id: 'D-3', driver2_id: 'D-1' }])).toEqual(['D-1']);
    expect(driverGanda([{ driver_id: 'D-1' }, { driver_id: 'D-2' }])).toEqual([]);
  });
});
