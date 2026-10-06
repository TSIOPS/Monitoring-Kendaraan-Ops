import { describe, expect, it } from 'vitest';
import { bodyKendaraan, bodyPengguna, fieldKosong } from '../../static/js/pages/master.js';

describe('fieldKosong', () => {
  const fields = [
    { key: 'nama', label: 'Nama', wajib: true },
    { key: 'password', label: 'Password', wajib: (_v: unknown, isEdit: boolean) => !isEdit },
    { key: 'cabang', label: 'Warehouse', wajib: (v: any) => v.role !== 'SUPERADMIN' },
    { key: 'catatan', label: 'Catatan' },
  ];

  it('melaporkan field wajib yang kosong', () => {
    expect(fieldKosong(fields, { nama: ' ', password: '', cabang: '', role: 'PIC CABANG' }, false))
      .toEqual(['Nama wajib diisi.', 'Password wajib diisi.', 'Warehouse wajib diisi.']);
  });

  it('wajib bersyarat: password tidak wajib saat edit, warehouse tidak wajib untuk SUPERADMIN', () => {
    expect(fieldKosong(fields, { nama: 'A', password: '', cabang: '', role: 'SUPERADMIN' }, true)).toEqual([]);
  });
});

describe('body API', () => {
  it('bodyKendaraan memakai nama field API M2 dan angka', () => {
    const b = bodyKendaraan({
      plat: ' B 1 A ', nama: 'Truk', jenis: 'Mobil', merk: '', model: '', kapasitas_tangki: '50', jumlah_bar: '8', standar_km_l: '',
      jenis_indikator: 'DIGITAL_BAR', cabang: 'CBG-A', tanggal_pajak: '2027-01-01', tanggal_pajak_5_tahunan: '', tanggal_kir: '',
      interval_ganti_oli_km: '5000', km_terakhir_ganti_oli: '',
    });
    expect(b).toMatchObject({ plat: 'B 1 A', kapasitas_tangki: 50, jumlah_bar: 8, standar_km_l: 0, cabang: 'CBG-A', interval_ganti_oli_km: 5000, km_terakhir_ganti_oli: 0 });
  });

  it('bodyPengguna: password kosong saat edit tidak dikirim; SUPERADMIN tanpa warehouse', () => {
    expect(bodyPengguna({ username: 'a', nama: 'A', role: 'PIC CABANG', cabang: 'CBG-A', password: '' }, true)).not.toHaveProperty('password');
    expect(bodyPengguna({ username: 'a', nama: 'A', role: 'SUPERADMIN', cabang: 'CBG-A', password: 'x' }, false)).toEqual({ username: 'a', nama: 'A', role: 'SUPERADMIN', cabang: '', password: 'x' });
  });
});

describe('teksOliMaster', () => {
  it('baseline 0 tampil "Belum diatur", selain itu km / interval', async () => {
    const { teksOliMaster } = await import('../../static/js/pages/master.js');
    expect(teksOliMaster({ km_terakhir_ganti_oli: 0, interval_ganti_oli_km: 3000 })).toBe('Belum diatur (interval 3.000)');
    expect(teksOliMaster({ km_terakhir_ganti_oli: 90646, interval_ganti_oli_km: 5000 })).toBe('90.646 / 5.000');
  });
});
