import { describe, expect, it } from 'vitest';
import { buildPayload, hitungLiter, opsiBbm, opsiSupirJalur, tanggalWib, validateForm } from '../../static/js/pages/input.js';

const DASAR = {
  vehicle_id: 'V-1',
  tanggal: '2026-09-21',
  nama_supir: 'Supir A',
  km_awal: '1000',
  km_akhir: '1100',
  bar_awal: '8',
  bar_akhir: '4',
  liter_bbm: '10',
  biaya_bbm: '120000',
  biaya_toll: '0',
  metode_pembayaran: 'TUNAI',
  flazz_card_id: '',
  metode_toll: '',
  flazz_card_id_toll: '',
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
    expect(validateForm({ ...DASAR, km_akhir: '' })).toContain('KM awal dan akhir wajib diisi.');
  });

  it('menolak KM bukan angka', () => {
    const err = validateForm({ ...DASAR, km_akhir: 'seratus' });
    expect(err.some((e) => e.includes('KM'))).toBe(true);
  });

  it('menolak liter negatif', () => {
    const err = validateForm({ ...DASAR, liter_bbm: '-3' });
    expect(err.some((e) => e.includes('Liter'))).toBe(true);
  });

  it('menolak FLAZZ tanpa kartu', () => {
    const err = validateForm({ ...DASAR, metode_pembayaran: 'FLAZZ', flazz_card_id: '' });
    expect(err).toContain('Pilih kartu Flazz untuk pembayaran.');
  });

  it('menerima FLAZZ dengan kartu', () => {
    expect(validateForm({ ...DASAR, metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1' })).toEqual([]);
  });

  it('menolak tol FLAZZ tanpa kartu tol', () => {
    const err = validateForm({ ...DASAR, biaya_toll: '5000', metode_toll: 'FLAZZ', flazz_card_id_toll: '' });
    expect(err).toContain('Pilih kartu Flazz untuk tol.');
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
    expect(p.biaya_bbm).toBe(120000);
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

describe('grup-2 (kartu kedua)', () => {
  it('buildPayload mengirim field grup-2 dengan nominal sebagai angka', () => {
    const p = buildPayload(
      { ...DASAR, flazz_card_id_2: 'FLZ-B', biaya_bbm_2: '500000', flazz_card_id_toll_2: '', biaya_toll_2: '' },
      { files: {}, km_awal: '', km_akhir: '' },
    );
    expect(p).toMatchObject({ flazz_card_id_2: 'FLZ-B', biaya_bbm_2: 500000, flazz_card_id_toll_2: '', biaya_toll_2: 0 });
  });

  it('buildPayload tanpa grup-2 mengirim nilai kosong', () => {
    const p = buildPayload(DASAR, { files: {}, km_awal: '', km_akhir: '' });
    expect(p).toMatchObject({ flazz_card_id_2: '', biaya_bbm_2: 0, flazz_card_id_toll_2: '', biaya_toll_2: 0 });
  });

  it('validateForm menolak nominal grup-2 negatif atau bukan angka', () => {
    expect(validateForm({ ...DASAR, biaya_bbm_2: '-1' })).toContain('Nominal kartu ke-2 harus angka dan tidak boleh negatif.');
    expect(validateForm({ ...DASAR, biaya_toll_2: 'abc' })).toContain('Nominal kartu ke-2 harus angka dan tidak boleh negatif.');
  });

  it('validateForm menerima nominal grup-2 tanpa kartu (dicatat tunai)', () => {
    expect(validateForm({ ...DASAR, biaya_toll_2: '7000' })).toEqual([]);
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
  it('biaya BBM tanpa jenis BBM ditolak', () => {
    expect(validateForm({ ...DASAR, biaya_bbm: '100000', harga_bbm: 0 })).toContain('Pilih jenis BBM agar liter terhitung.');
    expect(validateForm({ ...DASAR, biaya_bbm: '100000', harga_bbm: 10000 })).not.toContain('Pilih jenis BBM agar liter terhitung.');
    expect(validateForm({ ...DASAR, biaya_bbm: '', harga_bbm: 0 })).not.toContain('Pilih jenis BBM agar liter terhitung.');
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
