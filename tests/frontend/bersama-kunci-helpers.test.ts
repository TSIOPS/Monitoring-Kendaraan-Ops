import { describe, expect, it } from 'vitest';
import { bisaLepasFlazz } from '../../static/js/pages/transaksi.js';
import { sudahDirekon } from '../../static/js/pages/flazz.js';
import { opsiCabang } from '../../static/js/pages/jalur.js';
import { bodyKendaraan } from '../../static/js/pages/master.js';
import { tandaiKunciRekon } from '../../src/logic/flazz-recon';

describe('Lepas Flazz tersembunyi bila sudah direkonsiliasi', () => {
  it('bisaLepasFlazz: hanya BBM ber-Flazz yang belum terkunci', () => {
    expect(bisaLepasFlazz({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'F1' })).toBe(true);
    expect(bisaLepasFlazz({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'F1', kunci_lepas: true })).toBe(false);
    expect(bisaLepasFlazz({ metode_pembayaran: 'TUNAI', flazz_card_id: 'F1' })).toBe(false);
    expect(bisaLepasFlazz({ metode_pembayaran: 'TUNAI', flazz_card_id: '', flazz_card_id_2: 'F2' })).toBe(true);
  });

  it('tandaiKunciRekon: rekon kartu pada/setelah laporan mengunci; rekon lama/terhapus tidak', () => {
    const t = (o = {}) => ({ timestamp: 0, sub_timestamp: Date.parse('2026-10-07T08:00:00Z'), metode_pembayaran: 'FLAZZ', flazz_card_id: 'F1',
      metode_toll: 'FLAZZ', flazz_card_id_toll: 'F9', flazz_card_id_2: '', flazz_card_id_toll_2: '', ...o }) as any;
    const rec = (card: string, at: string, del = '') => ({ id: 'R', card_id: card, date: at.slice(0, 10), reconciled_at: at, is_deleted: del, opening_balance: 0 });
    const [a, b, c] = tandaiKunciRekon([t(), t(), t()], [rec('F1', '2026-10-07T09:00:00Z')]);
    expect([a!.kunci_lepas, a!.kunci_hapus]).toEqual([true, true]);
    const [d] = tandaiKunciRekon([t()], [rec('F9', '2026-10-07T09:00:00Z')]);
    expect([d!.kunci_lepas, d!.kunci_hapus]).toEqual([false, true]);
    const [e] = tandaiKunciRekon([t()], [rec('F1', '2026-10-06T09:00:00Z'), rec('F1', '2026-10-08T09:00:00Z', '1')]);
    expect([e!.kunci_lepas, e!.kunci_hapus]).toEqual([false, false]);
    expect(b && c).toBeTruthy();
  });

  it('sudahDirekon (Riwayat Flazz) memakai rekon kartu yang sama setelah laporan', () => {
    const b = { card_id: 'F1', timestamp: '2026-10-07T08:00:00Z', tanggal: '2026-10-07' };
    expect(sudahDirekon(b, [{ card_id: 'F1', reconciled_at: '2026-10-07T09:00:00Z' }])).toBe(true);
    expect(sudahDirekon(b, [{ card_id: 'F2', reconciled_at: '2026-10-07T09:00:00Z' }])).toBe(false);
    expect(sudahDirekon(b, [{ card_id: 'F1', reconciled_at: '2026-10-07T09:00:00Z', is_deleted: '1' }])).toBe(false);
  });
});

describe('kendaraan bersama di tampilan', () => {
  it('opsiCabang menyertakan kendaraan yang dipakai bersama', () => {
    const list = [{ id: 'A', cabang: 'GDG', cabang_bersama: ['CBY'] }, { id: 'B', cabang: 'CBY', cabang_bersama: [] }, { id: 'C', cabang: 'TSM' }];
    expect(opsiCabang(list, 'CBY', 'cabang').map((x: any) => x.id)).toEqual(['A', 'B']);
    expect(opsiCabang(list, '', 'cabang')).toHaveLength(3);
  });

  it('bodyKendaraan mengirim cabang_bersama hanya bila isiannya ada', () => {
    const dasar = { plat: 'Z 1', nama: 'Mio', jenis: 'Motor', merk: '', model: '', cabang: 'GDG' };
    expect(bodyKendaraan(dasar)).not.toHaveProperty('cabang_bersama');
    expect(bodyKendaraan({ ...dasar, cabang_bersama: 'CBY,GDG,' }).cabang_bersama).toEqual(['CBY']);
    expect(bodyKendaraan({ ...dasar, cabang_bersama: '' }).cabang_bersama).toEqual([]);
  });
});
