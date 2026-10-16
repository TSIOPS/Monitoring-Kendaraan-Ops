import { describe, expect, it } from 'vitest';
import { kunciKeBytes, menitWib, MENIT_PERINGATAN, perluPasangDulu, teksTugas } from '../../static/js/notifikasi.js';

describe('notifikasi', () => {
  it('menit WIB dan ambang 16:30', () => {
    expect(menitWib(new Date('2026-10-07T09:30:00Z'))).toBe(MENIT_PERINGATAN);
    expect(menitWib(new Date('2026-10-07T01:00:00Z'))).toBe(8 * 60);
  });
  it('teks tugas', () => {
    expect(teksTugas({ laporan: 3, rekonsiliasi: 1 })).toBe('3 laporan & 1 rekonsiliasi belum selesai');
    expect(teksTugas({ laporan: 0, rekonsiliasi: 2 })).toBe('2 rekonsiliasi belum selesai');
    expect(teksTugas({ laporan: 0, rekonsiliasi: 0 })).toBe('');
  });
  it('kunci VAPID base64url ke bytes', () => {
    expect(Array.from(kunciKeBytes('AQID'))).toEqual([1, 2, 3]);
    expect(kunciKeBytes('_-8').length).toBe(2);
  });
  it('iPhone perlu dipasang ke layar utama dulu', () => {
    expect(perluPasangDulu('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', false)).toBe(true);
    expect(perluPasangDulu('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)', true)).toBe(false);
    expect(perluPasangDulu('Mozilla/5.0 (Linux; Android 14)', false)).toBe(false);
  });
});

describe('nada pengingat', () => {
  it('enam nada dalam ~2 detik; tanpa Web Audio tidak error', async () => {
    const { NADA_PENGINGAT, bunyiPengingat } = await import('../../static/js/notifikasi.js');
    expect(NADA_PENGINGAT).toHaveLength(6);
    expect(Math.max(...NADA_PENGINGAT.map((n: number[]) => Number(n[1])))).toBeLessThan(2);
    (globalThis as any).window = {};
    expect(bunyiPengingat()).toBe(false);
    delete (globalThis as any).window;
  });
});

describe('suara yang diucapkan', () => {
  it('kalimat dari ringkasan tugas; kosong bila tidak ada tugas', async () => {
    const { kalimatPengingat } = await import('../../static/js/notifikasi.js');
    expect(kalimatPengingat({ laporan: 3, rekonsiliasi: 2 })).toBe('Perhatian. Hari ini masih ada 3 laporan dan 2 rekonsiliasi yang belum selesai. Segera selesaikan sebelum jam lima sore.');
    expect(kalimatPengingat({ laporan: 0, rekonsiliasi: 1 })).toContain('masih ada 1 rekonsiliasi yang');
    expect(kalimatPengingat({ laporan: 0, rekonsiliasi: 0 })).toBe('');
  });
  it('memilih suara bahasa Indonesia (Google lebih dulu)', async () => {
    const { pilihSuaraId } = await import('../../static/js/notifikasi.js');
    const v = [{ name: 'Microsoft David', lang: 'en-US' }, { name: 'Microsoft Andika', lang: 'id-ID' }, { name: 'Google Bahasa Indonesia', lang: 'id-ID' }];
    expect(pilihSuaraId(v)!.name).toBe('Google Bahasa Indonesia');
    expect(pilihSuaraId([{ name: 'X', lang: 'en-US' }])).toBeNull();
  });
});
