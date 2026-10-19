import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEADER_KEAMANAN, polaUsername } from '../src/utils/keamanan';

describe('header keamanan aset statis', () => {
  it('static/_headers sama persis dengan HEADER_KEAMANAN di kode', () => {
    const isi = readFileSync('static/_headers', 'utf8');
    const baris = new Map(isi.split(/\r?\n/).filter((l) => /^\s+\S+:/.test(l)).map((l) => {
      const t = l.trim();
      const i = t.indexOf(':');
      return [t.slice(0, i), t.slice(i + 1).trim()] as [string, string];
    }));
    expect(Object.fromEntries(baris)).toEqual(HEADER_KEAMANAN);
  });
});

describe('polaUsername', () => {
  it('meng-escape _ dan \ agar dicocokkan literal oleh ILIKE', () => {
    expect(polaUsername('pic_jkt')).toBe('pic\\_jkt');
    expect(polaUsername('a\\b')).toBe('a\\\\b');
  });
  it('username biasa tidak berubah', () => {
    expect(polaUsername('picjkt')).toBe('picjkt');
  });
  it('menolak wildcard % dan * (null = pasti tidak ada akun)', () => {
    expect(polaUsername('admin%')).toBeNull();
    expect(polaUsername('%')).toBeNull();
    expect(polaUsername('adm*')).toBeNull();
  });
});
