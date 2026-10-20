import { describe, expect, it } from 'vitest';
import { perluTampilRilis, versiBerubah } from '../../static/js/versi.js';
import { RILIS } from '../../static/js/rilis.js';

describe('versi & rilis', () => {
  it('versiBerubah hanya bila keduanya terisi dan berbeda', () => {
    expect(versiBerubah('a', 'b')).toBe(true);
    expect(versiBerubah('a', 'a')).toBe(false);
    expect(versiBerubah('', 'b')).toBe(false);
    expect(versiBerubah('a', '')).toBe(false);
  });
  it('perluTampilRilis bila id terbaru belum dilihat', () => {
    expect(perluTampilRilis([{ id: 'r2' }, { id: 'r1' }], 'r1')).toBe(true);
    expect(perluTampilRilis([{ id: 'r2' }], 'r2')).toBe(false);
    expect(perluTampilRilis([], null)).toBe(false);
  });
  it('catatan rilis terbaru = rincian pengeluaran', () => {
    expect(RILIS[0]!.id).toBe('2026-10-21-rincian');
    expect(RILIS[0]!.poin.length).toBeGreaterThan(0);
  });
});
