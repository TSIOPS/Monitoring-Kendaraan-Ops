import { describe, expect, it } from 'vitest';
import { fotoPertama, jamWib, ringkasKartu, samarkanNomor, sapaan, saringPeringatan, teksOli } from '../../static/js/pages/dashboard.js';
import { halaman, saringGaleri } from '../../static/js/pages/galeri.js';
import { saringPerforma } from '../../static/js/pages/performa.js';

describe('dashboard', () => {
  it('sapaan per jam seperti GAS', () => {
    expect(sapaan(5)).toBe('Selamat Pagi');
    expect(sapaan(11)).toBe('Selamat Siang');
    expect(sapaan(15)).toBe('Selamat Sore');
    expect(sapaan(18)).toBe('Selamat Malam');
    expect(sapaan(2)).toBe('Selamat Malam');
  });
  it('jam memakai WIB', () => {
    expect(jamWib(new Date('2026-10-06T05:30:00Z'))).toBe(12);
    expect(jamWib(new Date('2026-10-06T17:30:00Z'))).toBe(0);
  });
  it('nomor kartu disamarkan 4 digit terakhir', () => {
    expect(samarkanNomor('0145008201683728')).toBe('***3728');
    expect(samarkanNomor('123')).toBe('123');
  });
  it('filter warehouse dan total peringatan', () => {
    const res = { pajakKIR: [{ cabang: 'BDG' }, { cabang: 'JKT' }], saldo: [{ cabang: 'BDG' }], oli: [], odoEstimasi: [{ cabang: 'JKT' }] };
    expect(saringPeringatan(res, '').total).toBe(4);
    const bdg = saringPeringatan(res, 'BDG');
    expect(bdg.total).toBe(2);
    expect(bdg.odoEstimasi).toEqual([]);
  });
  it('teks oli', () => {
    expect(teksOli({ status: 'GANTI_OLI', sisa_km: -200, interval_km: 3000 })).toBe('sudah lewat 200 KM dari interval 3000 KM');
    expect(teksOli({ status: 'WASPADA', sisa_km: 300, interval_km: 5000 })).toBe('sisa 300 KM lagi (interval 5000 KM)');
  });
  it('ringkasan kartu etoll', () => {
    const r = ringkasKartu(
      [{ status: 'SEDANG_DIGUNAKAN', last_balance: 100 }, { status: 'TERSEDIA', last_balance: '50' }],
      [{ amount: 46500, date: '2026-10-05' }, { amount: 1, date: '2026-01-01' }],
    );
    expect(r).toEqual({ aktif: 1, total: 2, saldo: 150, topupTerakhir: { amount: 46500, date: '2026-10-05' } });
    expect(ringkasKartu([], []).topupTerakhir).toBeNull();
  });
  it('foto pertama untuk galeri terbaru', () => {
    expect(fotoPertama({ foto_odo_akhir: 'u2', foto_odo_akhir_thumb: 't2', foto_struk_bbm: 'u3' })).toEqual({ url: 'u2', thumb: 't2' });
    expect(fotoPertama({})).toBeNull();
  });
});

describe('galeri', () => {
  const rows = [{ foto_odo_awal: 'a' }, { foto_struk_bbm: 'b' }, {}];
  it('saring per jenis foto', () => {
    expect(saringGaleri(rows, 'all')).toHaveLength(2);
    expect(saringGaleri(rows, 'struk_bbm')).toEqual([{ foto_struk_bbm: 'b' }]);
  });
  it('halaman dibatasi ke rentang yang ada', () => {
    const list = Array.from({ length: 23 }, (_, i) => i);
    expect(halaman(list, 3)).toEqual({ total: 3, aktif: 3, isi: [20, 21, 22] });
    expect(halaman(list, 9).aktif).toBe(3);
    expect(halaman([], 1)).toEqual({ total: 1, aktif: 1, isi: [] });
  });
});

describe('performa', () => {
  it('filter warehouse lewat nama cabang', () => {
    const items = [{ cabang: 'WHO BANDUNG' }, { cabang: 'WHP JAKARTA' }];
    const cab = [{ kode: 'BDG', nama: 'WHO BANDUNG' }];
    expect(saringPerforma(items, 'BDG', cab)).toEqual([{ cabang: 'WHO BANDUNG' }]);
    expect(saringPerforma(items, '', cab)).toHaveLength(2);
  });
});
