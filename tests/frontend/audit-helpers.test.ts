import { describe, expect, it } from 'vitest';
import { labelPengguna, rincianPerubahan, susunExcelAudit, waktuWib } from '../../static/js/pages/audit.js';
import { opsiPengguna, saringPengguna } from '../../static/js/pages/transaksi.js';

describe('audit log', () => {
  it('waktu ditampilkan dalam WIB', () => {
    expect(waktuWib('2026-10-08T00:10:11.225Z')).toBe('08/10/2026 07:10');
    expect(waktuWib('2026-10-07T17:00:00.000Z')).toBe('08/10/2026 00:00');
  });
  it('rincian perubahan per kolom menandai yang berubah', () => {
    const d = rincianPerubahan('{"metode_pembayaran":"FLAZZ","biaya_bbm":400000}', '{"metode_pembayaran":"TUNAI","biaya_bbm":400000}');
    expect(d.mentah).toBe(false);
    expect(d.baris).toEqual([
      { kolom: 'metode_pembayaran', sebelum: 'FLAZZ', sesudah: 'TUNAI', berubah: true },
      { kolom: 'biaya_bbm', sebelum: '400000', sesudah: '400000', berubah: false },
    ]);
    expect(rincianPerubahan('', '{"a":1}').baris).toEqual([{ kolom: 'a', sebelum: '', sesudah: '1', berubah: false }]);
    expect(rincianPerubahan('{"a":1', '')).toEqual({ mentah: true, sebelum: '{"a":1', sesudah: '' });
  });
  it('label pengguna memakai nama dari master', () => {
    const peta = new Map([['snd_2', 'SnD Support'], ['x', 'x']]);
    expect(labelPengguna('snd_2', peta)).toBe('SnD Support (snd_2)');
    expect(labelPengguna('x', peta)).toBe('x');
    expect(labelPengguna('baru', peta)).toBe('baru');
  });
  it('Excel: header + baris dengan label aksi & modul', () => {
    const [sh] = susunExcelAudit([{ timestamp: '2026-10-08T00:10:11.225Z', username: 'snd_2', action: 'DETACH', modul: 'transaksi', keterangan: 'TRX-1', data_sebelum: '{}', data_sesudah: '{}', ip: '' }], new Map([['snd_2', 'SnD Support']]));
    expect(sh!.aoa[0]![0]).toBe('Waktu (WIB)');
    expect(sh!.aoa[1]!.slice(0, 6)).toEqual(['08/10/2026 07:10', 'snd_2', 'SnD Support', 'Lepas Flazz', 'Laporan', 'TRX-1']);
  });
});

describe('history: diinput oleh', () => {
  const rows = [{ user: 'Eko Sepriadi' }, { user: 'Admin WHO' }, { user: 'Eko Sepriadi' }, { user: '' }];
  it('opsi unik terurut & penyaringan', () => {
    expect(opsiPengguna(rows)).toEqual(['Admin WHO', 'Eko Sepriadi']);
    expect(saringPengguna(rows, 'Eko Sepriadi')).toHaveLength(2);
    expect(saringPengguna(rows, '')).toHaveLength(4);
  });
});
