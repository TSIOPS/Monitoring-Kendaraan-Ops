import { describe, expect, it } from 'vitest';
import type { MasterAllRaw } from '../../src/db/master';
import { getMasterPayload } from '../../src/logic/master';

function sampleRaw(): MasterAllRaw {
  return {
    cabang: [
      { kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: 'Jkt', status: 'Aktif' },
      { kode_cabang: 'CBG-B', nama_cabang: 'Cabang B', lokasi: 'Sby', status: 'Aktif' },
      { kode_cabang: 'CBG-MATI', nama_cabang: 'Mati', lokasi: '', status: 'Non-Aktif' },
    ],
    supir: [
      { supir_id: 'DRV-1', nama_supir: 'Ali', kode_cabang: 'CBG-A', default_vehicle_id: 'V-1', status: 'Aktif' },
      { supir_id: 'DRV-2', nama_supir: 'Budi', kode_cabang: 'CBG-B', default_vehicle_id: '', status: 'Aktif' },
      { supir_id: 'DRV-3', nama_supir: 'Caca', kode_cabang: 'CBG-A', default_vehicle_id: '', status: 'Non-Aktif' },
    ],
    bbm: [
      { bbm_id: 'BBM-P', jenis_bbm: 'Pertalite', harga_per_liter: 10000, kode_cabang: '', status: 'Aktif' },
      { bbm_id: 'BBM-PX', jenis_bbm: 'Pertalite A', harga_per_liter: 10200, kode_cabang: 'CBG-A', status: 'Aktif' },
      { bbm_id: 'BBM-S', jenis_bbm: 'Solar', harga_per_liter: 12000, kode_cabang: '', status: 'Aktif' },
      { bbm_id: 'BBM-X', jenis_bbm: 'Mati', harga_per_liter: 1, kode_cabang: '', status: 'Non-Aktif' },
    ],
    kendaraan: [
      {
        vehicle_id: 'V-1', plat_nomor: 'B 1 A', nama_kendaraan: 'Corolla', jenis_kendaraan: 'Mobil',
        merk: 'Toyota', model: 'Altis', kapasitas_tangki: 50, jumlah_bar: 8, standar_km_l: 12,
        kode_cabang: 'CBG-A', status: 'Aktif', jenis_indikator: 'DIGITAL_BAR',
        tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '',
        km_terakhir_ganti_oli: 10000, interval_ganti_oli_km: 0,
      },
      {
        vehicle_id: 'V-2', plat_nomor: 'L 2 B', nama_kendaraan: 'Vario', jenis_kendaraan: 'Motor',
        merk: 'Honda', model: 'Vario', kapasitas_tangki: 5, jumlah_bar: 4, standar_km_l: 40,
        kode_cabang: 'CBG-B', status: 'Aktif', jenis_indikator: 'ANALOG_JARUM',
        tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '',
        km_terakhir_ganti_oli: 2000, interval_ganti_oli_km: 0,
      },
      {
        vehicle_id: 'V-3', plat_nomor: 'B 3 C', nama_kendaraan: 'Innova', jenis_kendaraan: 'Mobil',
        merk: 'Toyota', model: 'Innova', kapasitas_tangki: 55, jumlah_bar: 8, standar_km_l: 11,
        kode_cabang: 'CBG-A', status: 'Non-Aktif', jenis_indikator: 'DIGITAL_BAR',
        tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '',
        km_terakhir_ganti_oli: 0, interval_ganti_oli_km: 0,
      },
    ],
    pengguna: [
      { user_id: 'U-1', username: 'super', nama: 'Super', role: 'SUPERADMIN', kode_cabang: '', status: 'Aktif' },
      { user_id: 'U-2', username: 'pic', nama: 'Pic A', role: 'PIC CABANG', kode_cabang: 'CBG-A', status: 'Aktif' },
    ],
    flazzCard: [
      { id: 'FC-1', card_number: '111', card_name: 'Bca', card_type: 'BCA_FLAZZ', card_role: 'UTAMA', branch_id: 'CBG-A', driver_id: 'DRV-1', default_driver_id: '', last_balance: 0, status: '', notes: '' },
      { id: 'FC-2', card_number: '222', card_name: 'Bca2', card_type: 'BCA_FLAZZ', card_role: 'CADANGAN', branch_id: 'CBG-B', driver_id: 'DRV-2', default_driver_id: '', last_balance: 0, status: '', notes: '' },
    ],
  };
}

describe('getMasterPayload', () => {
  it('SUPERADMIN menerima semua master (Aktif saja) + bentuk GAS super', () => {
    const p = getMasterPayload(sampleRaw(), { role: 'SUPERADMIN', cabang: '' }, {});
    expect(p.cabangList).toEqual([
      { kode: 'CBG-A', nama: 'Cabang A' },
      { kode: 'CBG-B', nama: 'Cabang B' },
    ]);
    expect(p.vehicles.map((v: any) => v.vehicle_id)).toEqual(['V-1', 'V-2']);
    expect(p.vehicles[0]).toMatchObject({ plat_nomor: 'B 1 A', nama: 'Corolla', jenis: 'Mobil', cabang: 'CBG-A' });
    expect(p.drivers.map((d: any) => d.id)).toEqual(['DRV-1', 'DRV-2']);
    expect(p.bbmList).toEqual([
      { id: 'BBM-P', jenis: 'Pertalite', harga: 10000 },
      { id: 'BBM-PX', jenis: 'Pertalite A', harga: 10200 },
      { id: 'BBM-S', jenis: 'Solar', harga: 12000 },
    ]);
    expect(p.penggunaList.map((u: any) => u.username)).toEqual(['super', 'pic']);
    expect(p.penggunaList[0]).toHaveProperty('cabang');
    expect(p.flazzCards.map((f: any) => f.id)).toEqual(['FC-1', 'FC-2']);
  });

  it('PIC CABANG dibatasi warehouse sendiri; BBM override menang atas global', () => {
    const p = getMasterPayload(sampleRaw(), { role: 'PIC CABANG', cabang: 'CBG-A' }, {});
    expect(p.cabangList).toEqual([{ kode: 'CBG-A', nama: 'Cabang A' }]);
    expect(p.vehicles.map((v: any) => v.vehicle_id)).toEqual(['V-1']);
    expect(p.drivers.map((d: any) => d.id)).toEqual(['DRV-1']);
    expect(p.bbmList).toEqual([
      { bbm_id: 'BBM-P', jenis_bbm: 'Pertalite', harga_per_liter: 10000, kode_cabang: '' },
      { bbm_id: 'BBM-S', jenis_bbm: 'Solar', harga_per_liter: 12000, kode_cabang: '' },
      { bbm_id: 'BBM-PX', jenis_bbm: 'Pertalite A', harga_per_liter: 10200, kode_cabang: 'CBG-A' },
    ]);
    expect(p.penggunaList).toEqual([]);
    expect(p.flazzCards.map((f: any) => f.id)).toEqual(['FC-1']);
  });

  it('PIC cabang tidak dikenal: cabangList fallback ke kode', () => {
    const p = getMasterPayload(sampleRaw(), { role: 'PIC CABANG', cabang: 'CBG-Z' }, {});
    expect(p.cabangList).toEqual([{ kode: 'CBG-Z', nama: 'CBG-Z' }]);
    expect(p.vehicles).toEqual([]);
    expect(p.flazzCards).toEqual([]);
  });

  it('interval ganti oli fallback defaultOilIntervalKm; motor 3000 mobil 5000', () => {
    const p = getMasterPayload(sampleRaw(), { role: 'SUPERADMIN', cabang: '' }, {});
    expect(p.vehicles.find((v: any) => v.vehicle_id === 'V-1')?.interval_ganti_oli_km).toBe(5000);
    expect(p.vehicles.find((v: any) => v.vehicle_id === 'V-2')?.interval_ganti_oli_km).toBe(3000);
  });

  it('odo_estimasi_terakhir true hanya utk ANALOG_JARUM dgn sumber ESTIMASI', () => {
    const raw = sampleRaw();
    const v2 = raw.kendaraan.find((v) => v.vehicle_id === 'V-2')!;
    v2.jenis_indikator = 'ANALOG_JARUM';
    const p = getMasterPayload(raw, { role: 'SUPERADMIN', cabang: '' }, { 'V-2': 'ESTIMASI' });
    expect(p.vehicles.find((v: any) => v.vehicle_id === 'V-2')?.odo_estimasi_terakhir).toBe(true);
    const p2 = getMasterPayload(raw, { role: 'SUPERADMIN', cabang: '' }, { 'V-2': 'AKTUAL' });
    expect(p2.vehicles.find((v: any) => v.vehicle_id === 'V-2')?.odo_estimasi_terakhir).toBe(false);
  });
});