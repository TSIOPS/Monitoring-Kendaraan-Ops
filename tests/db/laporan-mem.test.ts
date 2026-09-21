import { describe, expect, it } from 'vitest';
import { CardBalanceError } from '../../src/db/laporan';
import { memLaporan, laporanRow } from '../helpers';

const card = (over = {}) => ({
  id: 'FLZ-1', card_number: '123', card_name: 'Kartu A', branch_id: 'CBG-A', driver_id: '',
  default_driver_id: 'D-1', last_balance: 100000, status: 'TERSEDIA', ...over,
});

describe('memLaporan', () => {
  it('insert memberi seq naik; rowsInScope urut naik & dibatasi', async () => {
    const { state, repo } = memLaporan();
    await repo.insert(laporanRow({ transaction_id: 'TRX-1' }));
    await repo.insert(laporanRow({ transaction_id: 'TRX-2' }));
    await repo.insert(laporanRow({ transaction_id: 'TRX-3' }));
    expect(state.rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    const rows = await repo.rowsInScope('', 2);
    expect(rows.map((r) => r.transaction_id)).toEqual(['TRX-2', 'TRX-3']);
  });

  it('lastForVehicle mengambil seq terbesar', async () => {
    const { repo } = memLaporan({ rows: [laporanRow({ transaction_id: 'A', km_akhir_confirmed: '100' }), laporanRow({ transaction_id: 'B', km_akhir_confirmed: '250' })] });
    expect(await repo.lastForVehicle('V-1')).toEqual({ km_akhir: 250, tanggal: '2026-09-01' });
    expect(await repo.lastForVehicle('V-9')).toBeNull();
  });

  it('rowsInMonth filter prefix tanggal', async () => {
    const { repo } = memLaporan({ rows: [laporanRow({ transaction_id: 'A', tanggal: '2026-09-30' }), laporanRow({ transaction_id: 'B', tanggal: '2026-10-01' })] });
    expect((await repo.rowsInMonth('', '2026-09')).map((r) => r.transaction_id)).toEqual(['A']);
  });

  it('adjustBalance menurun dengan guard, menaik bebas', async () => {
    const { repo } = memLaporan({ flazzCard: [card()] });
    expect(await repo.adjustBalance('FLZ-1', -40000)).toBe(60000);
    await expect(repo.adjustBalance('FLZ-1', -70000)).rejects.toBeInstanceOf(CardBalanceError);
    expect(await repo.adjustBalance('FLZ-1', 10000)).toBe(70000);
  });

  it('createUsage/returnUsageForRef mengubah status kartu', async () => {
    const { state, repo } = memLaporan({ flazzCard: [card()] });
    await repo.createUsage({ cardId: 'FLZ-1', driverName: 'Supir A', vehicleId: 'V-1', refType: 'TRX', refId: 'TRX-1', usedAt: '2026-09-01T00:00:00.000Z' });
    expect(state.flazzCard[0]!.status).toBe('SEDANG_DIGUNAKAN');
    expect(state.flazzCard[0]!.driver_id).toBe('Supir A');
    expect(await repo.hasActiveUsage('FLZ-1')).toBe(true);
    await repo.returnUsageForRef('TRX', 'TRX-1');
    expect(await repo.hasActiveUsage('FLZ-1')).toBe(false);
    expect(state.flazzCard[0]!.status).toBe('TERSEDIA');
    expect(state.flazzCard[0]!.driver_id).toBe('D-1');
  });

  it('findJalurByCriteria mengabaikan is_deleted dan mengembalikan match terakhir', async () => {
    const { repo } = memLaporan({ jalur: [
      { id: 'J-1', tanggal: '2026-09-01', nama_driver: 'S', vehicle_id: 'V-1', kode_cabang: 'CBG-A', status: 'BELUM_DIISI', laporan_id: '' },
      { id: 'J-2', tanggal: '2026-09-01', nama_driver: 'S', vehicle_id: 'V-1', kode_cabang: 'CBG-A', status: 'BELUM_DIISI', laporan_id: '' },
      { id: 'J-3', tanggal: '2026-09-01', nama_driver: 'S', vehicle_id: 'V-1', kode_cabang: 'CBG-A', status: 'BELUM_DIISI', laporan_id: '', is_deleted: '1' },
    ] });
    const j = await repo.findJalurByCriteria({ tanggal: '2026-09-01', vehicle_id: 'V-1', nama_driver: 'S', kode_cabang: 'CBG-A' });
    expect(j?.id).toBe('J-2');
  });

  it('setJalurStatus & releaseJalurReport', async () => {
    const { state, repo } = memLaporan({ jalur: [{ id: 'J-1', tanggal: '2026-09-01', nama_driver: 'S', vehicle_id: 'V-1', kode_cabang: 'CBG-A', status: 'BELUM_DIISI', laporan_id: '' }] });
    await repo.setJalurStatus('J-1', 'SUDAH_LAPORAN', 'TRX-1');
    expect(state.jalur[0]).toMatchObject({ status: 'SUDAH_LAPORAN', laporan_id: 'TRX-1' });
    await repo.releaseJalurReport('TRX-1');
    expect(state.jalur[0]).toMatchObject({ status: 'BELUM_DIISI', laporan_id: '' });
  });
});