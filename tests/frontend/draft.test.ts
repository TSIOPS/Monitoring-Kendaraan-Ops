import { describe, expect, it } from 'vitest';
import { bacaDraft, hapusDraft, kunciDraft, simpanDraft, DRAFT_UMUR_MS } from '../../static/js/draft.js';

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

describe('draft form', () => {
  it('kunci dibedakan per form dan per user', () => {
    expect(kunciDraft('input', 'U-1')).toBe('draft.input.U-1');
    expect(kunciDraft('input', '')).toBe('draft.input.anon');
  });

  it('simpan lalu baca mengembalikan nilai dan waktu simpan', () => {
    const s = new Mem();
    simpanDraft(s, 'k', { km_awal: '12345' }, 1000);
    expect(bacaDraft(s, 'k', 2000)).toEqual({ nilai: { km_awal: '12345' }, disimpan: 1000 });
  });

  it('draft kedaluwarsa dibuang', () => {
    const s = new Mem();
    simpanDraft(s, 'k', { a: '1' }, 0);
    expect(bacaDraft(s, 'k', DRAFT_UMUR_MS + 1)).toBeNull();
    expect(s.getItem('k')).toBeNull();
  });

  it('JSON rusak / storage melempar tidak membuat crash', () => {
    const s = new Mem();
    s.setItem('k', '{rusak');
    expect(bacaDraft(s, 'k', 0)).toBeNull();
    const lempar = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
    expect(bacaDraft(lempar, 'k', 0)).toBeNull();
    expect(() => simpanDraft(lempar, 'k', {}, 0)).not.toThrow();
    expect(() => hapusDraft(lempar, 'k')).not.toThrow();
  });

  it('draft tanpa isi berarti (semua kosong) tidak disimpan', () => {
    const s = new Mem();
    simpanDraft(s, 'k', { a: '', b: false }, 0);
    expect(s.getItem('k')).toBeNull();
  });
});
