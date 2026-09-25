import { describe, expect, it } from 'vitest';
import type { LaporanRow } from '../../src/logic/laporan';
import type { WarningVehicle } from '../../src/logic/warnings';
import { buildOdoMap, computeWarnings, daysUntil } from '../../src/logic/warnings';

const TODAY = new Date('2026-09-25T00:00:00Z');

const vehicle = (over: Partial<WarningVehicle> = {}): WarningVehicle => ({
  vehicle_id: 'V-1', plat_nomor: 'B 1 A', kode_cabang: 'CBG-A', status: 'Aktif',
  jenis_kendaraan: 'Mobil',
  tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '',
  km_terakhir_ganti_oli: 10000, interval_ganti_oli_km: 5000,
  ...over,
});

function row(over: Partial<LaporanRow> = {}): LaporanRow {
  return {
    transaction_id: 'TRX-1', timestamp: '2026-09-01T01:00:00.000Z', tanggal: '2026-09-01',
    user_id: 'U-1', nama_pengguna: 'B', kode_cabang: 'CBG-A', vehicle_id: 'V-1', plat_nomor: 'B 1 A',
    foto_km_awal: '', ocr_km_awal: '', km_awal_confirmed: '100', bar_awal: '8',
    foto_km_akhir: '', ocr_km_akhir: '', km_akhir_confirmed: '1000', bar_akhir: '4',
    km_tempuh: 100, perubahan_bar: 4, liter_bbm: 10, biaya_bbm: 100000,
    foto_struk_bbm: '', biaya_toll: 0, foto_struk_toll: '', km_per_liter: 10,
    status: 'COMPLETED', warning: '', nama_supir: 'S', metode_pembayaran: 'TUNAI',
    flazz_card_id: '', km_sumber: 'AKTUAL', metode_toll: 'TUNAI', flazz_card_id_toll: '',
    seq: 1,
    ...over,
  };
}

const run = (kendaraan: WarningVehicle[], odoMap: Record<string, number>, today: Date = TODAY) =>
  computeWarnings({
    kendaraan,
    user: { role: 'SUPERADMIN', cabang: '' },
    odoMap,
    cabangNama: new Map([['CBG-A', 'Cabang A'], ['CBG-B', 'Cabang B']]),
    today,
  });

describe('buildOdoMap', () => {
  it('seq tertinggi menang; KM <= 0 diabaikan; tanpa baris tidak ada entri', () => {
    const map = buildOdoMap([
      row({ vehicle_id: 'V-1', km_akhir_confirmed: '12000', seq: 1 }),
      row({ vehicle_id: 'V-1', km_akhir_confirmed: '13000', seq: 2 }),
      row({ vehicle_id: 'V-1', km_akhir_confirmed: '14000', seq: 3 }),
      row({ vehicle_id: 'V-2', km_akhir_confirmed: '0', seq: 4 }),
      row({ vehicle_id: '', km_akhir_confirmed: '500', seq: 5 }),
    ]);
    expect(map).toEqual({ 'V-1': 14000 });
    expect(buildOdoMap([])).toEqual({});
  });
});

describe('daysUntil', () => {
  it('hitung sisa hari UTC; kosong/tidak valid -> null', () => {
    expect(daysUntil('2026-10-25', TODAY)).toBe(30);
    expect(daysUntil('2026-09-25', TODAY)).toBe(0);
    expect(daysUntil('2026-07-20', TODAY)).toBe(-67);
    expect(daysUntil('', TODAY)).toBeNull();
    expect(daysUntil('abc', TODAY)).toBeNull();
    expect(daysUntil(null, TODAY)).toBeNull();
  });
});

describe('computeWarnings — OLI', () => {
  it('mendekati -> PERHATIAN dengan pesan verbatim', () => {
    const items = run([vehicle()], { 'V-1': 14980 });
    expect(items).toEqual([
      {
        kategori: 'OLI', severity: 'PERHATIAN', vehicle_id: 'V-1', plat_nomor: 'B 1 A',
        kode_cabang: 'CBG-A', nama_cabang: 'Cabang A',
        pesan: 'Sebentar lagi ganti oli - sisa 20 km',
        km_sekarang: 14980, km_target: 15000, sisa_km: 20,
      },
    ]);
  });

  it('lewat -> KRITIS dengan pesan verbatim', () => {
    const items = run([vehicle()], { 'V-1': 15020 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      severity: 'KRITIS',
      pesan: 'Wajib ganti oli - sudah lewat 20 km',
      km_sekarang: 15020, km_target: 15000, sisa_km: -20,
    });
  });

  it('sisa > 50 km -> tidak ada item', () => {
    expect(run([vehicle()], { 'V-1': 10000 })).toEqual([]);
  });

  it('km_terakhir_ganti_oli <= 0 -> skip', () => {
    expect(run([vehicle({ km_terakhir_ganti_oli: 0 })], { 'V-1': 14980 })).toEqual([]);
    expect(run([vehicle({ km_terakhir_ganti_oli: -5 })], { 'V-1': 14980 })).toEqual([]);
  });

  it('tanpa odo -> skip', () => {
    expect(run([vehicle()], {})).toEqual([]);
  });

  it('interval_ganti_oli_km <= 0 -> fallback defaultOilIntervalKm', () => {
    const mobil = run([vehicle({ interval_ganti_oli_km: 0 })], { 'V-1': 14980 });
    expect(mobil).toHaveLength(1);
    expect(mobil[0]).toMatchObject({ sisa_km: 20, km_target: 15000 });

    const motor = run(
      [vehicle({ jenis_kendaraan: 'Motor', interval_ganti_oli_km: 0, km_terakhir_ganti_oli: 1000 })],
      { 'V-1': 3980 },
    );
    expect(motor[0]).toMatchObject({ sisa_km: 20, km_target: 4000 });
  });

  it('interval > 0 dihormati', () => {
    const items = run([vehicle({ interval_ganti_oli_km: 2000 })], { 'V-1': 13000 });
    expect(items[0]).toMatchObject({ severity: 'KRITIS', sisa_km: -1000, km_target: 12000 });
  });
});

describe('computeWarnings — tanggal', () => {
  it('PAJAK mendekati -> PERHATIAN, pesan verbatim', () => {
    const items = run([vehicle({ tanggal_pajak: '2026-10-25' })], {});
    expect(items).toEqual([
      {
        kategori: 'PAJAK', severity: 'PERHATIAN', vehicle_id: 'V-1', plat_nomor: 'B 1 A',
        kode_cabang: 'CBG-A', nama_cabang: 'Cabang A',
        pesan: 'Pajak tahunan jatuh tempo 25/10/2026 (sisa 30 hari)',
        tanggal_jatuh_tempo: '2026-10-25', sisa_hari: 30,
      },
    ]);
  });

  it('PAJAK lewat -> KRITIS, pesan verbatim', () => {
    const items = run([vehicle({ tanggal_pajak: '2026-09-20' })], {});
    expect(items[0]).toMatchObject({
      kategori: 'PAJAK', severity: 'KRITIS',
      pesan: 'Pajak tahunan sudah lewat jatuh tempo 20/09/2026', sisa_hari: -5,
    });
  });

  it('label PAJAK_5_TAHUNAN dan KIR dengan pola pesan sama', () => {
    const items = run(
      [vehicle({ tanggal_pajak: '2026-09-26', tanggal_pajak_5_tahunan: '2026-09-27', tanggal_kir: '2026-09-28' })],
      {},
    );
    expect(items.map((i) => i.pesan)).toEqual([
      'Pajak tahunan jatuh tempo 26/09/2026 (sisa 1 hari)',
      'Pajak 5 tahunan jatuh tempo 27/09/2026 (sisa 2 hari)',
      'KIR jatuh tempo 28/09/2026 (sisa 3 hari)',
    ]);
  });

  it('tanggal kosong/tidak valid -> skip', () => {
    expect(run([vehicle()], {})).toEqual([]);
    expect(run([vehicle({ tanggal_pajak: 'abc', tanggal_kir: '2026/13/40' })], {})).toEqual([]);
  });
});

describe('computeWarnings — scope & sort', () => {
  it('kendaraan Non-Aktif tidak muncul', () => {
    expect(run([vehicle({ status: 'Non-Aktif', km_terakhir_ganti_oli: 5000 })], { 'V-1': 14980 })).toEqual([]);
  });

  it('PIC hanya melihat cabangnya sendiri', () => {
    const items = computeWarnings({
      kendaraan: [
        vehicle({ vehicle_id: 'V-A', kode_cabang: 'CBG-A' }),
        vehicle({ vehicle_id: 'V-B', kode_cabang: 'CBG-B' }),
      ],
      user: { role: 'PIC CABANG', cabang: 'CBG-A' },
      odoMap: { 'V-A': 14980, 'V-B': 14980 },
      cabangNama: new Map([['CBG-A', 'Cabang A'], ['CBG-B', 'Cabang B']]),
      today: TODAY,
    });
    expect(items.map((i) => i.vehicle_id)).toEqual(['V-A']);
  });

  it('urutan: KRITIS dulu, sisa terkecil duluan (paling lewat di depan)', () => {
    const items = computeWarnings({
      kendaraan: [
        vehicle({ vehicle_id: 'V-P', plat_nomor: 'B 9 P', tanggal_pajak: '2026-07-20' }),
        vehicle({ vehicle_id: 'V-O', plat_nomor: 'B 8 O' }),
      ],
      user: { role: 'SUPERADMIN', cabang: '' },
      odoMap: { 'V-O': 15020 },
      cabangNama: new Map([['CBG-A', 'Cabang A']]),
      today: TODAY,
    });
    expect(items.map((i) => i.vehicle_id)).toEqual(['V-P', 'V-O']);
  });

  it('tie-break plat_nomor saat sisa & kategori sama', () => {
    const items = run([
      vehicle({ vehicle_id: 'V-B', plat_nomor: 'B 2 B' }),
      vehicle({ vehicle_id: 'V-A', plat_nomor: 'B 1 A' }),
    ], { 'V-A': 14980, 'V-B': 14980 });
    expect(items.map((i) => i.vehicle_id)).toEqual(['V-A', 'V-B']);
  });
});