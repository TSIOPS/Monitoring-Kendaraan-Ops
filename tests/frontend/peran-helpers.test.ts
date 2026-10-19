import { describe, expect, it } from 'vitest';
import { bolehTulis, isManagement, isSuper, lihatSemuaCabang, ruteDilarang, saringMenu } from '../../static/js/peran.js';

describe('helper peran frontend', () => {
  it('isSuper / isManagement / lihatSemuaCabang / bolehTulis', () => {
    expect(isSuper('SUPERADMIN')).toBe(true);
    expect(isManagement(' management ')).toBe(true);
    expect(lihatSemuaCabang('MANAGEMENT')).toBe(true);
    expect(lihatSemuaCabang('PIC CABANG')).toBe(false);
    expect(bolehTulis('MANAGEMENT')).toBe(false);
    expect(bolehTulis('PIC CABANG')).toBe(true);
    expect(bolehTulis(undefined)).toBe(true);
  });

  it('ruteDilarang: MANAGEMENT tidak boleh rute input/edit/pengaturan/audit', () => {
    for (const h of ['#/input', '#/edit/TRX-1', '#/jalur/buat', '#/jalur/edit/J-1', '#/flazz/topup', '#/flazz/rekon', '#/pengaturan', '#/audit']) {
      expect(ruteDilarang('MANAGEMENT', h)).toBe(true);
    }
    for (const h of ['#/dashboard', '#/history', '#/transaksi', '#/jalur', '#/jalur/ringkasan', '#/flazz', '#/flazz/riwayat', '#/master', '#/perbandingan', '#/rekap', '#/performa', '#/galeri', '#/password']) {
      expect(ruteDilarang('MANAGEMENT', h)).toBe(false);
    }
  });

  it('ruteDilarang: query string diabaikan dan prefiks mirip tidak terblokir', () => {
    expect(ruteDilarang('MANAGEMENT', '#/input?x=1')).toBe(true);
    expect(ruteDilarang('MANAGEMENT', '#/inputan')).toBe(false);
  });

  it('ruteDilarang: role lain tidak berubah', () => {
    expect(ruteDilarang('PIC CABANG', '#/input')).toBe(false);
    expect(ruteDilarang('SUPERADMIN', '#/audit')).toBe(false);
  });

  it('saringMenu memakai daftar peran per item dan membuang grup kosong', () => {
    const nav = [
      { hash: '#/dashboard', label: 'Dashboard' },
      { label: 'Grup', items: [{ hash: '#/a', label: 'A', peran: ['SUPERADMIN'] }, { hash: '#/b', label: 'B' }] },
      { label: 'Kosong', items: [{ hash: '#/c', label: 'C', peran: ['SUPERADMIN'] }] },
    ];
    expect(saringMenu(nav, 'MANAGEMENT')).toEqual([
      { hash: '#/dashboard', label: 'Dashboard' },
      { label: 'Grup', items: [{ hash: '#/b', label: 'B' }] },
    ]);
    expect(saringMenu(nav, 'superadmin')[2].items).toHaveLength(1);
  });
});
