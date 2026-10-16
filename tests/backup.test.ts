import { describe, expect, it, vi, afterEach } from 'vitest';
import { folderKedaluwarsa, jalankanBackup, tanggalWibDari, TABEL_BACKUP, totalDariContentRange } from '../src/backup';

function r2Palsu() {
  const isi = new Map<string, string>();
  return {
    isi,
    async put(k: string, v: ArrayBuffer | string) { isi.set(k, typeof v === 'string' ? v : new TextDecoder().decode(v)); },
    async delete(k: string) { isi.delete(k); },
    async list(o: { prefix: string; delimiter?: string }) {
      const keys = [...isi.keys()].filter((k) => k.startsWith(o.prefix));
      if (o.delimiter) {
        const pre = new Set(keys.map((k) => o.prefix + k.slice(o.prefix.length).split('/')[0] + '/'));
        return { objects: [], delimitedPrefixes: [...pre] };
      }
      return { objects: keys.map((key) => ({ key })), delimitedPrefixes: [] };
    },
  };
}

describe('backup harian', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('tanggal WIB, total dari Content-Range, folder kedaluwarsa 30 hari', () => {
    expect(tanggalWibDari(Date.parse('2026-10-16T19:00:00Z'))).toBe('2026-10-17');
    expect(totalDariContentRange('0-999/5288')).toBe(5288);
    expect(totalDariContentRange('*/0')).toBe(0);
    expect(folderKedaluwarsa(['2026-09-15', '2026-09-16', '2026-10-16', 'lain'], '2026-10-16')).toEqual(['2026-09-15']);
  });

  it('menyalin semua tabel per halaman 1.000 baris, menulis ringkasan, menghapus folder lama', async () => {
    const r2 = r2Palsu();
    await r2.put('backup/2026-09-01/cabang-0.json', '[]');
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: { headers: Record<string, string> }) => {
      const from = Number(String(init.headers.Range).split('-')[0]);
      const total = String(url).includes('/audit_log?') ? 1500 : 3;
      const n = Math.max(0, Math.min(1000, total - from));
      return new Response(JSON.stringify(Array.from({ length: n }, (_, i) => ({ id: from + i }))), { status: 206, headers: { 'Content-Range': `${from}-${from + n - 1}/${total}` } });
    }));
    const env = { SUPABASE_URL: 'https://x', SUPABASE_SERVICE_ROLE_KEY: 'k', BACKUP: r2 } as any;
    const r = await jalankanBackup(env, Date.parse('2026-10-16T19:00:00Z'));
    expect(r.tanggal).toBe('2026-10-17');
    expect(r.baris.audit_log).toBe(1500);
    expect(r2.isi.has('backup/2026-10-17/audit_log-1.json')).toBe(true);
    expect([...r2.isi.keys()].filter((k) => k.startsWith('backup/2026-10-17/')).length).toBe(TABEL_BACKUP.length + 2);
    expect(r.dihapus).toEqual(['2026-09-01']);
    expect(r2.isi.has('backup/2026-09-01/cabang-0.json')).toBe(false);
  });
});
