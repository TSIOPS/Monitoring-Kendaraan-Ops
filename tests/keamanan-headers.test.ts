import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HEADER_KEAMANAN } from '../src/utils/keamanan';

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
