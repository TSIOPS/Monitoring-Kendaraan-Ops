import { describe, expect, it } from 'vitest';
import { ringkasanPeringatan, statusOli } from '../../src/logic/warnings';

const kendaraan = (over: Record<string, unknown> = {}) => ({
  vehicle_id: 'V-1', plat_nomor: 'D 1 A', nama_kendaraan: 'Grand Max', jenis_kendaraan: 'Mobil',
  kode_cabang: 'BDG', status: 'Aktif', jenis_indikator: 'DIGITAL_BAR',
  tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '',
  km_terakhir_ganti_oli: 0, interval_ganti_oli_km: 0, ...over,
});
const kartu = (over: Record<string, unknown> = {}) => ({
  id: 'FLZ-1', card_number: '0145008201683728', card_name: 'E toll 1', card_type: 'BCA_FLAZZ',
  branch_id: 'BDG', last_balance: 50000, status: 'TERSEDIA', ...over,
});
const SUPER = { role: 'SUPERADMIN', cabang: '' };
const TODAY = '2026-10-06';

describe('statusOli (warnOilStatus GAS)', () => {
  it('null bila baseline kosong atau masih jauh dari interval', () => {
    expect(statusOli(kendaraan(), 9000)).toBeNull();
    expect(statusOli(kendaraan({ km_terakhir_ganti_oli: 10000 }), 12000)).toBeNull();
  });
  it('WASPADA bila sisa <= 500 km, GANTI_OLI bila tempuh >= interval', () => {
    expect(statusOli(kendaraan({ km_terakhir_ganti_oli: 10000 }), 14600)).toMatchObject({ status: 'WASPADA', sisa_km: 400, tempuh_km: 4600, interval_km: 5000 });
    expect(statusOli(kendaraan({ km_terakhir_ganti_oli: 10000, jenis_kendaraan: 'Motor' }), 13200)).toMatchObject({ status: 'GANTI_OLI', sisa_km: -200, interval_km: 3000 });
  });
  it('tanpa transaksi sejak ganti oli: tempuh 0', () => {
    expect(statusOli(kendaraan({ km_terakhir_ganti_oli: 10000, interval_ganti_oli_km: 400 }), undefined)).toMatchObject({ status: 'WASPADA', tempuh_km: 0, sisa_km: 400 });
  });
});

describe('ringkasanPeringatan (warningsSummary GAS)', () => {
  it('pajak & KIR per kendaraan: hanya LEWAT/KRITIS/WASPADA, urut terparah lalu sisa hari', () => {
    const out = ringkasanPeringatan({
      kendaraan: [
        kendaraan({ vehicle_id: 'V-1', plat_nomor: 'A', tanggal_pajak: '2026-10-20' }),
        kendaraan({ vehicle_id: 'V-2', plat_nomor: 'B', tanggal_pajak: '2026-10-06', tanggal_kir: '2026-11-20' }),
        kendaraan({ vehicle_id: 'V-3', plat_nomor: 'C', tanggal_pajak: '2027-10-06' }),
      ],
      kartu: [], rows: [], user: SUPER, today: TODAY,
    });
    expect(out.pajakKIR.map((p) => p.plat_nomor)).toEqual(['B', 'A']);
    expect(out.pajakKIR[0]).toMatchObject({ worst: 'LEWAT', cabang: 'BDG', nama_kendaraan: 'Grand Max' });
    expect(out.pajakKIR[0]!.alerts).toEqual([
      { tipe: 'PAJAK', status: 'LEWAT', sisa_hari: 0, tanggal: '2026-10-06' },
      { tipe: 'KIR', status: 'WASPADA', sisa_hari: 45, tanggal: '2026-11-20' },
    ]);
  });

  it('saldo kartu < 100.000 kecuali NONAKTIF, urut saldo terkecil; PIC hanya cabangnya', () => {
    const kartuList = [
      kartu({ id: 'K1', last_balance: 90000 }),
      kartu({ id: 'K2', last_balance: 20000 }),
      kartu({ id: 'K3', last_balance: 10000, status: 'NONAKTIF' }),
      kartu({ id: 'K4', last_balance: 150000 }),
      kartu({ id: 'K5', last_balance: 5000, branch_id: 'JKT' }),
    ];
    const sup = ringkasanPeringatan({ kendaraan: [], kartu: kartuList, rows: [], user: SUPER, today: TODAY });
    expect(sup.saldo.map((c) => c.id)).toEqual(['K5', 'K2', 'K1']);
    const pic = ringkasanPeringatan({ kendaraan: [], kartu: kartuList, rows: [], user: { role: 'PIC CABANG', cabang: 'BDG' }, today: TODAY });
    expect(pic.saldo.map((c) => c.id)).toEqual(['K2', 'K1']);
  });

  it('oli dari KM akhir transaksi terakhir; odometer estimasi hanya untuk ANALOG_JARUM', () => {
    const out = ringkasanPeringatan({
      kendaraan: [
        kendaraan({ vehicle_id: 'V-1', km_terakhir_ganti_oli: 10000, jenis_indikator: 'ANALOG_JARUM' }),
        kendaraan({ vehicle_id: 'V-2', plat_nomor: 'D 2', km_terakhir_ganti_oli: 10000 }),
      ],
      kartu: [],
      rows: [
        { vehicle_id: 'V-1', km_akhir_confirmed: 14000, km_sumber: 'AKTUAL', seq: 1 },
        { vehicle_id: 'V-1', km_akhir_confirmed: 14700, km_sumber: 'ESTIMASI', seq: 2 },
        { vehicle_id: 'V-2', km_akhir_confirmed: 15100, km_sumber: 'ESTIMASI', seq: 3 },
      ],
      user: SUPER, today: TODAY,
    });
    expect(out.oli.map((o) => [o.vehicle_id, o.status])).toEqual([['V-2', 'GANTI_OLI'], ['V-1', 'WASPADA']]);
    expect(out.odoEstimasi.map((o) => o.vehicle_id)).toEqual(['V-1']);
  });

  it('kendaraan non-aktif dan cabang lain (untuk PIC) diabaikan', () => {
    const out = ringkasanPeringatan({
      kendaraan: [
        kendaraan({ vehicle_id: 'V-1', tanggal_pajak: '2026-10-06', status: 'Non-Aktif' }),
        kendaraan({ vehicle_id: 'V-2', tanggal_pajak: '2026-10-06', kode_cabang: 'JKT' }),
        kendaraan({ vehicle_id: 'V-3', tanggal_pajak: '2026-10-06' }),
      ],
      kartu: [], rows: [], user: { role: 'PIC CABANG', cabang: 'BDG' }, today: TODAY,
    });
    expect(out.pajakKIR.map((p) => p.vehicle_id)).toEqual(['V-3']);
  });
});
