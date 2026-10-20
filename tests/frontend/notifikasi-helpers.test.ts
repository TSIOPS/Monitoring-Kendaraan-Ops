import { describe, expect, it } from 'vitest';
import { bannerTampil, teksUnduhExcel, kunciKeBytes, menitWib, MENIT_PERINGATAN, perluPasangDulu, teksTugas, teksBanner } from '../../static/js/notifikasi.js';

import { EMAIL_KIRIM_REKAP, rentangUnduhHarian } from '../../static/js/unduh-rekap.js';

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
    expect(kalimatPengingat({ laporan: 3, rekonsiliasi: 2 }, new Date('2026-10-16T05:00:00Z'))).toBe('Perhatian. Masih ada 3 laporan dan 2 rekonsiliasi yang belum selesai. Segera selesaikan sebelum jam lima sore.');
    expect(kalimatPengingat({ laporan: 2, rekonsiliasi: 0, tertunggak: 1 }, new Date('2026-10-16T05:00:00Z'))).toBe('Perhatian. Masih ada 2 laporan yang belum selesai, termasuk 1 jalur dari hari sebelumnya. Segera selesaikan sebelum jam lima sore.');
    expect(kalimatPengingat({ laporan: 0, rekonsiliasi: 1 })).toContain('Masih ada 1 rekonsiliasi yang');
    expect(kalimatPengingat({ laporan: 0, rekonsiliasi: 0 })).toBe('');
  });
  it('memilih suara bahasa Indonesia (Google lebih dulu)', async () => {
    const { pilihSuaraId } = await import('../../static/js/notifikasi.js');
    const v = [{ name: 'Microsoft David', lang: 'en-US' }, { name: 'Microsoft Andika', lang: 'id-ID' }, { name: 'Google Bahasa Indonesia', lang: 'id-ID' }];
    expect(pilihSuaraId(v)!.name).toBe('Google Bahasa Indonesia');
    expect(pilihSuaraId([{ name: 'X', lang: 'en-US' }])).toBeNull();
  });
});

describe('jam operasional akhir pekan', () => {
  it('Senin-Jumat tutup 17:00 (pengingat 16:30); Sabtu-Minggu 16:00 (pengingat 15:30)', async () => {
    const { jamOperasional, menitPeringatan, kalimatPengingat } = await import('../../static/js/notifikasi.js');
    const jumat = new Date('2026-10-16T05:00:00Z');
    const sabtu = new Date('2026-10-17T05:00:00Z');
    const minggu = new Date('2026-10-18T05:00:00Z');
    expect(jamOperasional(jumat).jam).toBe('17:00');
    expect(menitPeringatan(jumat)).toBe(16 * 60 + 30);
    expect(jamOperasional(sabtu).jam).toBe('16:00');
    expect(menitPeringatan(minggu)).toBe(15 * 60 + 30);
    // Sabtu 23:30 UTC = Minggu 06:30 WIB -> tetap akhir pekan; Minggu 17:30 UTC = Senin 00:30 WIB -> hari kerja.
    expect(jamOperasional(new Date('2026-10-18T17:30:00Z')).jam).toBe('17:00');
    expect(kalimatPengingat({ laporan: 1, rekonsiliasi: 0 })).toMatch(/jam (lima|empat) sore\.$/);
  });
});

describe('teksBanner', () => {
  const teks = '3 laporan belum selesai';
  it('pengguna yang bisa menulis: ajakan menyelesaikan', () => {
    expect(teksBanner(teks, false, '17:00', true)).toBe('Hari ini: 3 laporan belum selesai.');
    expect(teksBanner(teks, true, '17:00', true)).toBe('Segera selesaikan sebelum 17:00 — hari ini 3 laporan belum selesai.');
  });
  it('read-only: netral, tanpa perintah menyelesaikan', () => {
    const t = teksBanner(teks, true, '17:00', false);
    expect(t).toBe('Pemantauan: hari ini 3 laporan belum selesai di cabang.');
    expect(teksBanner(teks, false, '17:00', false)).toBe(t);
    expect(t).not.toMatch(/segera/i);
  });
});

describe('pengingat unduh Excel', () => {
  it('teks menyebut email tujuan', () => {
    expect(EMAIL_KIRIM_REKAP).toBe('ceocrew01@gmail.com');
    expect(teksUnduhExcel()).toBe('Tugas hari ini selesai. Unduh Excel rekap pengeluaran bulan ini, lalu kirim ke ceocrew01@gmail.com bersama Excel laporan lainnya.');
  });
  it('banner unduh tetap tampil walau masih ada tugas (mis. tunggakan hari sebelumnya)', () => {
    expect(bannerTampil({ laporan: 1, tertunggak: 1, unduh_excel: true }, true)).toEqual({ tugas: true, unduh: true });
    expect(bannerTampil({ unduh_excel: true }, true)).toEqual({ tugas: false, unduh: true });
    expect(bannerTampil({ unduh_excel: true }, false)).toEqual({ tugas: false, unduh: false });
    expect(bannerTampil({ rekonsiliasi: 2, unduh_excel: false }, true)).toEqual({ tugas: true, unduh: false });
  });
  it('rentang = tanggal 1 bulan berjalan s.d. hari ini', () => {
    expect(rentangUnduhHarian('2026-10-21')).toEqual({ dari: '2026-10-01', sampai: '2026-10-21' });
  });
});
