import { describe, expect, it } from 'vitest';
import { memFlazz } from '../helpers';
import { CardBalanceError } from '../../src/db/flazz';

const flazzRow = (over: any = {}) => ({
  id: 'FLZ-1',
  card_number: '123',
  card_name: 'Kartu A',
  card_type: '',
  card_role: '',
  branch_id: 'CBG-A',
  driver_id: '',
  default_driver_id: 'DRV-1',
  last_balance: 100000,
  status: 'TERSEDIA',
  notes: '',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...over,
});

describe('FlazzRepo memory', () => {
  it('adjustBalance menolak saldo negatif', async () => {
    const { repo, state } = memFlazz({ cards: [flazzRow({ id: 'FLZ-1', last_balance: 100000 })] });
    await expect(repo.adjustBalance('FLZ-1', -150000)).rejects.toBeInstanceOf(CardBalanceError);
    expect(state.cards[0]!.last_balance).toBe(100000);
  });

  it('adjustBalance positif', async () => {
    const { repo } = memFlazz({ cards: [flazzRow({ id: 'FLZ-1', last_balance: 100000 })] });
    const r = await repo.adjustBalance('FLZ-1', 50000);
    expect(r).toBe(150000);
  });

  it('createUsage dan returnUsageForRef', async () => {
    const { repo, state } = memFlazz({ cards: [flazzRow({ id: 'FLZ-1', status: 'TERSEDIA' })] });
    await repo.createUsage({ cardId: 'FLZ-1', driverName: 'D-1', vehicleId: 'V-1', refType: 'TRX', refId: 'TRX-1', usedAt: '2026-09-01T01:00:00.000Z' });
    expect(state.cards[0]!.status).toBe('SEDANG_DIGUNAKAN');
    await repo.returnUsageForRef('TRX', 'TRX-1');
    expect(state.cards[0]!.status).toBe('TERSEDIA');
  });

  it('returnUsageForCardRef hanya kartu diminta', async () => {
    const { repo, state } = memFlazz({
      cards: [flazzRow({ id: 'FLZ-1', status: 'SEDANG_DIGUNAKAN' }), flazzRow({ id: 'FLZ-2', status: 'SEDANG_DIGUNAKAN' })],
    });
    await repo.createUsage({ cardId: 'FLZ-1', driverName: 'D-1', vehicleId: 'V-1', refType: 'TRX', refId: 'TRX-1', usedAt: '2026-09-01T01:00:00.000Z' });
    await repo.createUsage({ cardId: 'FLZ-2', driverName: 'D-2', vehicleId: 'V-1', refType: 'TRX', refId: 'TRX-1', usedAt: '2026-09-01T01:00:00.000Z' });
    await repo.returnUsageForCardRef('TRX', 'TRX-1', 'FLZ-1');
    expect(state.cards[0]!.status).toBe('TERSEDIA');
    expect(state.cards[1]!.status).toBe('SEDANG_DIGUNAKAN');
  });
});
