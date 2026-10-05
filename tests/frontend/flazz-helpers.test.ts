import { describe, expect, it } from 'vitest';
import { hitungListing, infoSelisih, tglKey } from '../../static/js/pages/flazz.js';

describe('tglKey', () => {
  it('tanggal polos apa adanya; stempel waktu ke tanggal WIB', () => {
    expect(tglKey('2026-10-05')).toBe('2026-10-05');
    expect(tglKey('2026-10-04T18:30:00.000Z')).toBe('2026-10-05');
    expect(tglKey('bukan')).toBe('');
  });
});

describe('infoSelisih (fisik - sistem, seperti GAS)', () => {
  it('sesuai, kurang, lebih', () => {
    expect(infoSelisih(430000, 430000)).toMatchObject({ teks: 'Saldo sesuai.', aksi: 'IGNORE' });
    expect(infoSelisih(430000, 420000).teks).toContain('Selisih kurang');
    expect(infoSelisih(430000, 440000)).toMatchObject({ aksi: 'ADJUST' });
  });
});

describe('hitungListing (rumus List Flazz GAS)', () => {
  const card = { id: 'FLZ-A', last_balance: 300000 };
  const data = {
    topups: [{ card_id: 'FLZ-A', amount: 100000, date: '2026-10-02', created_at: '2026-10-02T01:00:00.000Z' }],
    tols: [{ card_id: 'FLZ-A', amount: 5000, date: '2026-10-03', created_at: '2026-10-03T01:00:00.000Z' }],
    bbmFlazz: [{ card_id: 'FLZ-A', amount: 150000, toll_amount: 20000, tanggal: '2026-10-03', timestamp: '2026-10-03T02:00:00.000Z' }],
    recons: [],
  };

  it('tanpa rekon: saldo akhir = saldo kini, saldo awal direkonstruksi', () => {
    const h = hitungListing(card, data, '2026-10-01', '2026-10-31');
    expect(h).toMatchObject({ pengeluaran: 175000, totalTopup: 100000, saldoAkhir: 300000, saldoAwal: 375000 });
  });

  it('tanpa aktivitas pada periode: saldo awal 0 (perilaku GAS)', () => {
    expect(hitungListing(card, data, '2026-11-01', '2026-11-30')).toMatchObject({ saldoAwal: 0, pengeluaran: 0, saldoAkhir: 300000 });
  });

  it('dengan rekon: saldo awal dari rekon terakhir, saldo akhir + aktivitas setelahnya', () => {
    const d = { ...data, recons: [{ card_id: 'FLZ-A', date: '2026-10-02', reconciled_at: '2026-10-02T12:00:00.000Z', opening_balance: 400000, flazz_balance: 500000 }] };
    const h = hitungListing(card, d, '2026-10-01', '2026-10-31');
    // Setelah rekon: tol 5.000 + BBM 150.000 + tol 20.000 = 175.000.
    expect(h).toMatchObject({ saldoAwal: 400000, saldoAkhir: 325000 });
  });
});
