import { describe, expect, it } from 'vitest';
import { buildPayload, hitungLiter, opsiBbm, opsiSupirJalur, tanggalWib, teksBannerDraft, validateForm } from '../../static/js/pages/input.js';

describe('teksBannerDraft', () => {
  // 18-10-2026 14:20 WIB = 07:20 UTC
  const disimpan = Date.UTC(2026, 9, 18, 7, 20);

  it('draft hari ini: hanya jam', () => {
    expect(teksBannerDraft(disimpan, '2026-10-18', '2026-10-18')).toMatch(/^Isian dari 14[.:]20 dipulihkan\. Foto perlu dipilih ulang\.$/);
  });

  it('draft tanggal lain: menyebut tanggal simpan dan tanggal laporan', () => {
    expect(teksBannerDraft(disimpan, '2026-10-18', '2026-10-19')).toMatch(
      /^Isian dari 18-10-2026 14[.:]20 dipulihkan — tanggal laporan diisi 18-10-2026\. Foto perlu dipilih ulang\.$/,
    );
  });
});

const DASAR = {
  vehicle_id: 'V-1',
  tanggal: '2026-09-21',
  nama_supir: 'Supir A',
  km_awal: '1000',
  km_akhir: '1100',
  bar_awal: '8',
  bar_akhir: '4',
  liter_bbm: '10',
  rincian: [{ jenis: 'BBM', nominal: 120000, kartu: '', keterangan: '' }],
  ada_struk_bbm: true,
  ada_struk_tol: true,
  km_awal_broken: false,
  km_akhir_broken: false,
  km_tanpa_estimasi: false,
};

describe('validateForm', () => {
  it('menerima form lengkap yang valid', () => {
    expect(validateForm(DASAR)).toEqual([]);
  });

  it('menolak kendaraan kosong', () => {
    const err = validateForm({ ...DASAR, vehicle_id: '' });
    expect(err).toContain('Kendaraan wajib dipilih.');
  });

  it('menolak tanggal kosong', () => {
    expect(validateForm({ ...DASAR, tanggal: '' })).toContain('Tanggal wajib diisi.');
  });

  it('menolak nama supir kosong', () => {
    expect(validateForm({ ...DASAR, nama_supir: '' })).toContain('Nama supir wajib diisi.');
  });

  it('menolak KM kosong', () => {
    expect(validateForm({ ...DASAR, km_akhir: '' })).toContain('KM akhir wajib diisi (atau centang meter mati/rusak).');
    // Meter rusak: KM sisi itu boleh kosong (diestimasi server).
    expect(validateForm({ ...DASAR, km_awal: '', km_akhir: '', km_awal_broken: true, km_akhir_broken: true }).join(' ')).not.toContain('KM');
    expect(validateForm({ ...DASAR, km_awal: '', km_akhir_broken: true, km_akhir: '' })).toContain('KM awal wajib diisi (atau centang meter mati/rusak).');
  });

  it('menolak KM bukan angka', () => {
    const err = validateForm({ ...DASAR, km_akhir: 'seratus' });
    expect(err.some((e) => e.includes('KM'))).toBe(true);
  });

  it('menolak liter negatif', () => {
    const err = validateForm({ ...DASAR, liter_bbm: '-3' });
    expect(err.some((e) => e.includes('Liter'))).toBe(true);
  });
});

describe('buildPayload', () => {
  it('mengubah semua angka menjadi string untuk field confirmed', () => {
    const p = buildPayload(DASAR, { files: { odo_awal: 'u1', odo_akhir: '' }, km_awal: '1000', km_akhir: '1100' });
    expect(p.km_awal_confirmed).toBe('1000');
    expect(p.km_akhir_confirmed).toBe('1100');
  });

  it('memasukkan serverData apa adanya', () => {
    const sd = { files: { odo_awal: 'u1', odo_akhir: 'u2' }, km_awal: '1000', km_akhir: '1100' };
    expect(buildPayload(DASAR, sd).serverData).toEqual(sd);
  });

  it('menyalin boolean meter mati apa adanya', () => {
    const p = buildPayload({ ...DASAR, km_akhir_broken: true }, { files: {}, km_awal: '', km_akhir: '' });
    expect(p.km_akhir_broken).toBe(true);
  });

  it('mengirim liter sebagai angka', () => {
    const p = buildPayload(DASAR, { files: {}, km_awal: '', km_akhir: '' });
    expect(p.liter_bbm).toBe(10);
  });

  it('mengubah bar menjadi string', () => {
    const p = buildPayload(DASAR, { files: {}, km_awal: '', km_akhir: '' });
    expect(p.bar_awal).toBe('8');
  });
});

describe('tanggalWib', () => {
  it('memakai tanggal WIB walau UTC masih hari sebelumnya', () => {
    // 4 Okt 2026 23:00 UTC = 5 Okt 2026 06:00 WIB.
    expect(tanggalWib(new Date(Date.UTC(2026, 9, 4, 23, 0)))).toBe('2026-10-05');
  });

  it('tetap WIB saat perangkat di zona lebih timur', () => {
    // 5 Okt 2026 16:30 UTC = 6 Okt 00:30 WITA, tetapi masih 5 Okt 23:30 WIB.
    expect(tanggalWib(new Date(Date.UTC(2026, 9, 5, 16, 30)))).toBe('2026-10-05');
  });

  it('menambah nol di depan bulan dan hari', () => {
    expect(tanggalWib(new Date(Date.UTC(2026, 0, 3, 5, 0)))).toBe('2026-01-03');
  });
});

describe('validateForm + rincian', () => {
  it('galat rincian ikut', () => {
    expect(validateForm({ ...DASAR, rincian: [{ jenis: 'BBM', nominal: 0, kartu: '', keterangan: '' }] })).toContain('Baris 1: nominal harus lebih dari 0.');
  });
  it('struk wajib per jenis yang ada', () => {
    expect(validateForm({ ...DASAR, ada_struk_bbm: false })).toContain('Foto struk BBM wajib diupload karena ada biaya BBM.');
    expect(validateForm({ ...DASAR, rincian: [{ jenis: 'TOL', nominal: 5000, kartu: '', keterangan: '' }], ada_struk_tol: false, ada_struk_bbm: false }))
      .toEqual(['Foto struk / bukti tol wajib diupload karena ada biaya tol.']);
  });
  it('BBM tanpa jenis BBM ditolak', () => {
    expect(validateForm({ ...DASAR, harga_bbm: 0 })).toContain('Pilih jenis BBM agar liter terhitung.');
    expect(validateForm({ ...DASAR, harga_bbm: 10000 })).not.toContain('Pilih jenis BBM agar liter terhitung.');
    expect(validateForm({ ...DASAR, rincian: [], harga_bbm: 0 })).not.toContain('Pilih jenis BBM agar liter terhitung.');
  });
  it('galat 3 cara bayar memakai label kartu', () => {
    const rincian = [
      { jenis: 'TOL', nominal: 1, kartu: 'A', keterangan: '' },
      { jenis: 'TOL', nominal: 1, kartu: 'B', keterangan: '' },
      { jenis: 'TOL', nominal: 1, kartu: '', keterangan: '' },
    ];
    expect(validateForm({ ...DASAR, rincian, label_kartu: (id: string) => `Etoll ${id}` }).join(' ')).toContain('(Etoll A, Etoll B, Tunai)');
  });
});

describe('buildPayload + rincian', () => {
  it('mengirim rincian, tanpa field slot', () => {
    const p = buildPayload(DASAR, { files: {}, km_awal: '', km_akhir: '' });
    expect(p.rincian).toEqual(DASAR.rincian);
    expect(p).not.toHaveProperty('biaya_bbm');
    expect(p).not.toHaveProperty('flazz_card_id_2');
    expect(p).not.toHaveProperty('metode_pembayaran');
  });
});

describe('opsiSupirJalur', () => {
  it('nilai = indeks (nama bisa sama di kendaraan berbeda), label memuat plat', () => {
    expect(opsiSupirJalur([
      { nama_driver: 'Andi', plat_nomor: 'B 1 A' },
      { nama_driver: 'Andi', plat_nomor: 'B 2 B' },
      { nama_driver: 'Budi', plat_nomor: '' },
    ])).toEqual([
      { value: '0', label: 'Andi — B 1 A' },
      { value: '1', label: 'Andi — B 2 B' },
      { value: '2', label: 'Budi' },
    ]);
  });
});

describe('liter otomatis dari biaya BBM', () => {
  it('hitungLiter = biaya / harga, dua desimal; kosong bila salah satu nol', () => {
    expect(hitungLiter(100000, 10000)).toBe('10.00');
    expect(hitungLiter(50000, 12500)).toBe('4.00');
    expect(hitungLiter(10000, 3000)).toBe('3.33');
    expect(hitungLiter(0, 10000)).toBe('');
    expect(hitungLiter(100000, 0)).toBe('');
  });
  it('opsiBbm menerima bentuk payload SUPERADMIN maupun PIC', () => {
    expect(opsiBbm([{ id: 'B1', jenis: 'Pertalite', harga: 10000 }])).toEqual([{ value: 'B1', harga: 10000, label: 'Pertalite — Rp 10.000/L' }]);
    expect(opsiBbm([{ bbm_id: 'B2', jenis_bbm: 'Solar', harga_per_liter: '6800' }])).toEqual([{ value: 'B2', harga: 6800, label: 'Solar — Rp 6.800/L' }]);
  });
});

describe('kartuJalur', () => {
  const cards = [{ id: 'FLZ-1' }, { id: 'FLZ-2' }, { id: 'FLZ-3' }];
  it('hanya kartu yang dikeluarkan di jalur, urut kartu 1 lalu 2', async () => {
    const { kartuJalur } = await import('../../static/js/pages/input.js');
    expect(kartuJalur(cards, { flazz_card_id: 'FLZ-3', flazz_card_id_2: 'FLZ-1' }).map((c: any) => c.id)).toEqual(['FLZ-3', 'FLZ-1']);
    expect(kartuJalur(cards, { flazz_card_id: '', flazz_card_id_2: '' })).toEqual([]);
    expect(kartuJalur(cards, null)).toHaveLength(3);
  });
});

describe('kartuDefaultJalur', () => {
  const cards = [{ id: 'FLZ-1' }, { id: 'FLZ-2' }];
  it('default "Dibayar" = kartu 1 jalur bila ada di daftar kartu; selain itu Tunai', async () => {
    const { kartuDefaultJalur } = await import('../../static/js/pages/input.js');
    expect(kartuDefaultJalur(cards, { flazz_card_id: 'FLZ-2', flazz_card_id_2: 'FLZ-1' })).toBe('FLZ-2');
    expect(kartuDefaultJalur(cards, { flazz_card_id: 'FLZ-9' })).toBe('');
    expect(kartuDefaultJalur(cards, { flazz_card_id: '' })).toBe('');
    expect(kartuDefaultJalur(cards, null)).toBe('');
  });
});

describe('validasi jarum', () => {
  it('persen jarum harus 0-100', () => {
    expect(validateForm({ ...DASAR, jarum: true, bar_awal: '120', bar_akhir: '50' })).toContain('Indikator jarum diisi persen jarum 0–100.');
    expect(validateForm({ ...DASAR, jarum: true, bar_awal: '67', bar_akhir: '36' })).not.toContain('Indikator jarum diisi persen jarum 0–100.');
  });
});

describe('meteran jarum', () => {
  it('meteran wajib digeser: kosong ditolak untuk jarum, tidak untuk bar digital', () => {
    const pesan = 'Geser meteran bensin awal dan akhir sesuai posisi jarum.';
    expect(validateForm({ ...DASAR, jarum: true, bar_awal: '', bar_akhir: '40' })).toContain(pesan);
    expect(validateForm({ ...DASAR, jarum: true, bar_awal: '0', bar_akhir: '40' })).not.toContain(pesan);
    expect(validateForm({ ...DASAR, jarum: false, bar_awal: '', bar_akhir: '' })).not.toContain(pesan);
  });
  it('persen dibulatkan & dibatasi 0-100; jenis motor/mobil; warna level seperti GAS', async () => {
    const { persenJarum, jenisMeteran, warnaLevel } = await import('../../static/js/meteran.js');
    expect(persenJarum('')).toBeNull();
    expect(persenJarum('67.6')).toBe(68);
    expect(persenJarum('150')).toBe(100);
    expect(jenisMeteran('Motor')).toBe('motor');
    expect(jenisMeteran('Mobil')).toBe('mobil');
    expect([warnaLevel(10), warnaLevel(30), warnaLevel(80)]).toEqual(['#dc3545', '#fd7e14', '#198754']);
  });
});

describe('digit KM', () => {
  it('5-6 digit; odometer < 10.000 atau tanpa riwayat dikecualikan; meter rusak tidak dicek', async () => {
    const { pesanDigitKm } = await import('../../static/js/pages/input.js');
    expect(pesanDigitKm('KM awal', '1410', 14000)).toContain('minimal 5 digit');
    expect(pesanDigitKm('KM awal', '14100', 14000)).toBe('');
    expect(pesanDigitKm('KM akhir', '1000000', 14000)).toContain('maksimal 6 digit');
    expect(pesanDigitKm('KM awal', '8513', 8507)).toBe('');
    expect(pesanDigitKm('KM awal', '500', null)).toBe('');
    const err = validateForm({ ...DASAR, km_awal: '1410', km_akhir: '14200', km_terakhir: 14000, km_awal_broken: true });
    expect(err.join(' ')).not.toContain('digit');
  });
});

describe('bukti wajib di form', () => {
  it('struk BBM & bukti tol wajib bila ada biayanya', () => {
    const rincian = [{ jenis: 'BBM', nominal: 100000, kartu: '', keterangan: '' }, { jenis: 'TOL', nominal: 15000, kartu: '', keterangan: '' }];
    const e = validateForm({ ...DASAR, rincian, harga_bbm: 10000, ada_struk_bbm: false, ada_struk_tol: false }).join(' ');
    expect(e).toContain('struk BBM wajib');
    expect(e).toContain('bukti tol wajib');
    expect(validateForm({ ...DASAR, rincian: [], ada_struk_bbm: false, ada_struk_tol: false }).join(' ')).not.toContain('wajib diupload');
  });
});
