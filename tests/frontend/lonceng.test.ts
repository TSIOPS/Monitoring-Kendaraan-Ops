import { describe, expect, it } from 'vitest';
import { susunNotifikasi } from '../../static/js/lonceng.js';

describe('lonceng: susunNotifikasi', () => {
  it('tugas hari ini lebih dulu, lalu peringatan; tautan ke halaman tindak lanjut', () => {
    const list = susunNotifikasi(
      {
        pajakKIR: [{ plat_nomor: 'D 1 A', nama_kendaraan: 'Grand Max', worst: 'KRITIS', alerts: [{ tipe: 'PAJAK', status: 'KRITIS', sisa_hari: 5 }, { tipe: 'KIR', status: 'LEWAT', sisa_hari: -3 }] }],
        saldo: [{ card_name: 'E toll 3', last_balance: 38562 }],
        oli: [{ plat_nomor: 'Z 1 B', nama_kendaraan: 'Mio', status: 'GANTI_OLI', sisa_km: -250 }],
        odoEstimasi: [],
      },
      { item: [{ plat_nomor: 'D 8561 FI', nama_driver: 'Agus', perlu: ['LAPORAN', 'REKONSILIASI'] }, { plat_nomor: 'D 2', nama_driver: 'Budi', perlu: ['REKONSILIASI'] }] },
    );
    expect(list.map((x) => [x.grup, x.href])).toEqual([
      ['Tugas belum selesai', '#/input'], ['Tugas belum selesai', '#/flazz/rekon'],
      ['Pajak & KIR', '#/dashboard'], ['Saldo etoll rendah', '#/flazz/topup'], ['Ganti oli', '#/dashboard'],
    ]);
    expect(list[0]!.ket).toBe('Belum laporan & rekonsiliasi');
    expect(list[2]!.ket).toBe('Pajak sisa 5 hari · KIR lewat 3 hari');
    expect(list[3]!.ket).toBe('Saldo Rp 38.562');
  });
  it('read-only (boleh=false): tautan tulis dialihkan ke halaman baca', () => {
    const list = susunNotifikasi(
      { saldo: [{ card_name: 'E toll 3', last_balance: 100 }] },
      { item: [{ plat_nomor: 'D 1', nama_driver: 'A', perlu: ['LAPORAN'] }] },
      false,
    );
    expect(list.map((x) => x.href)).toEqual(['#/flazz', '#/flazz']);
  });
  it('tanpa data -> kosong', () => {
    expect(susunNotifikasi(null, null)).toEqual([]);
  });
});
