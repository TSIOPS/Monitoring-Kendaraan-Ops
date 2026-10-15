import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { autoRefresh } from '../../static/js/ui.js';

// DOM minimal (lingkungan tes = node): window.location.hash, document.hidden/activeElement.
function siapkanDom(hash = '#/jalur') {
  const g = globalThis as any;
  g.window = { location: { hash }, addEventListener: () => {} };
  g.document = { hidden: false, activeElement: null, addEventListener: () => {}, removeEventListener: () => {} };
  return { win: g.window, doc: g.document };
}
const viewPalsu = (): any => ({ isConnected: true, dataset: {} as Record<string, string>, contains: (_x: unknown): boolean => false });

describe('autoRefresh', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); delete (globalThis as any).window; delete (globalThis as any).document; });

  it('memuat ulang tiap interval selama di halaman yang sama', async () => {
    siapkanDom();
    const view = viewPalsu();
    const muat = vi.fn(async () => {});
    autoRefresh(view, muat, { ms: 1000 });
    await vi.advanceTimersByTimeAsync(3000);
    expect(muat).toHaveBeenCalledTimes(3);
  });

  it('berhenti setelah pindah halaman; dilewati saat tab tersembunyi, sedang mengetik, atau sibuk', async () => {
    const { win, doc } = siapkanDom();
    const view = viewPalsu();
    const muat = vi.fn(async () => {});
    let sibuk = false;
    autoRefresh(view, muat, { ms: 1000, sibuk: (() => sibuk) as any });
    doc.hidden = true;
    await vi.advanceTimersByTimeAsync(1000);
    doc.hidden = false;
    doc.activeElement = { tagName: 'INPUT' };
    view.contains = () => true;
    await vi.advanceTimersByTimeAsync(1000);
    doc.activeElement = null;
    sibuk = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(muat).not.toHaveBeenCalled();
    sibuk = false;
    win.location.hash = '#/dashboard';
    await vi.advanceTimersByTimeAsync(3000);
    expect(muat).not.toHaveBeenCalled();
  });

  it('render ulang halaman yang sama menggantikan refresh lama (tidak dobel)', async () => {
    siapkanDom();
    const view = viewPalsu();
    const lama = vi.fn(async () => {});
    const baru = vi.fn(async () => {});
    autoRefresh(view, lama, { ms: 1000 });
    autoRefresh(view, baru, { ms: 1000 });
    await vi.advanceTimersByTimeAsync(2000);
    expect(lama).not.toHaveBeenCalled();
    expect(baru).toHaveBeenCalledTimes(2);
  });
});

describe('perluMuatUlang (modul beda versi setelah deploy)', () => {
  it('mengenali galat modul lama / gagal unduh, bukan galat biasa', async () => {
    const { perluMuatUlang } = await import('../../static/js/router.js');
    expect(perluMuatUlang(new SyntaxError("The requested module '../ui.js' does not provide an export named 'autoRefresh'"))).toBe(true);
    expect(perluMuatUlang(new TypeError('Failed to fetch dynamically imported module: https://x/js/pages/jalur.js'))).toBe(true);
    expect(perluMuatUlang(new Error('Akses ditolak'))).toBe(false);
  });
});
