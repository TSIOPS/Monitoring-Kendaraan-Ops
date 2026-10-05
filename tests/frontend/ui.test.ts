import { describe, expect, it } from 'vitest';
import { esc, fmtNum, fmtDateId } from '../../static/js/ui.js';

describe('esc', () => {
  it('meng-escape tag HTML', () => {
    expect(esc('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('meng-escape kutip untuk atribut', () => {
    expect(esc('a"b\'c')).toBe('a&quot;b&#39;c');
  });

  it('mengubah null dan undefined menjadi string kosong', () => {
    expect(esc(null)).toBe('');
    expect(esc(undefined)).toBe('');
  });

  it('mengubah angka menjadi string tanpa escape tambahan', () => {
    expect(esc(1500000)).toBe('1500000');
  });
});

describe('fmtNum', () => {
  it('memakai pemisah ribuan titik', () => {
    expect(fmtNum(1500000)).toBe('1.500.000');
  });

  it('memakai koma untuk desimal', () => {
    expect(fmtNum(1234.5)).toBe('1.234,5');
  });

  it('mengembalikan nol untuk input tidak valid', () => {
    expect(fmtNum(null)).toBe('0');
  });
});

describe('fmtDateId', () => {
  it('memformat tanggal Indonesia menjadi d-M-yyyy', () => {
    expect(fmtDateId('2026-09-21')).toBe('21-9-2026');
  });

  it('mengembalikan input apa adanya bila tidak berbentuk tanggal', () => {
    expect(fmtDateId('bukan tanggal')).toBe('bukan tanggal');
  });
});
