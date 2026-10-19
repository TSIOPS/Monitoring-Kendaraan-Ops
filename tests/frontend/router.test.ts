import { describe, expect, it, vi } from 'vitest';
import { matchRoute, putuskanKeluar, registerRoute, tujuanSetelahLogin } from '../../static/js/router.js';

const loader = async () => ({ render: () => undefined });

registerRoute('#/login', loader, { guard: false });
registerRoute('#/transaksi', loader);
registerRoute('#/edit/:id', loader);

describe('matchRoute', () => {
  it('mencocokkan route yang didaftarkan dengan awalan #', () => {
    expect(matchRoute('#/login')).not.toBeNull();
    expect(matchRoute('#/transaksi')).not.toBeNull();
  });

  it('memakai #/login untuk hash kosong', () => {
    expect(matchRoute('')?.guard).toBe(false);
  });

  it('mencocokkan route berparameter', () => {
    expect(matchRoute('#/edit/TRX-1')).not.toBeNull();
  });

  it('mengembalikan null untuk route tak dikenal', () => {
    expect(matchRoute('#/tidak-ada')).toBeNull();
  });
});

describe('putuskanKeluar', () => {
  it('tanpa penjaga: boleh pindah', () => {
    expect(putuskanKeluar(null, () => false)).toBe(true);
  });
  it('penjaga tidak memberi pesan: boleh pindah tanpa bertanya', () => {
    const tanya = vi.fn(() => false);
    expect(putuskanKeluar(() => '', tanya)).toBe(true);
    expect(tanya).not.toHaveBeenCalled();
  });
  it('penjaga memberi pesan: ikut jawaban konfirmasi', () => {
    expect(putuskanKeluar(() => 'Belum disimpan', () => true)).toBe(true);
    expect(putuskanKeluar(() => 'Belum disimpan', () => false)).toBe(false);
  });
});

describe('tujuanSetelahLogin', () => {
  it('memakai rute tersimpan bila aman', () => {
    expect(tujuanSetelahLogin('#/input')).toBe('#/input');
    expect(tujuanSetelahLogin('#/edit/TRX-1')).toBe('#/edit/TRX-1');
  });
  it('default dashboard untuk kosong, login, atau bukan hash rute', () => {
    expect(tujuanSetelahLogin('')).toBe('#/dashboard');
    expect(tujuanSetelahLogin('#/login')).toBe('#/dashboard');
    expect(tujuanSetelahLogin('https://jahat.example')).toBe('#/dashboard');
    expect(tujuanSetelahLogin(null)).toBe('#/dashboard');
  });
});
