import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { bukuExcel } from '../../static/js/pages/rekap.js';
import { barisPajakKir, namaFilePajakKir, ringkasPajakKir, sheetPajakKir, statusTanggal } from '../../static/js/pajak-kir.js';

const TODAY = '2026-10-30';
const v = (o: Record<string, unknown>) => ({ vehicle_id: 'V', plat_nomor: 'D 1 A', nama: 'Grand Max', jenis: 'Mobil', cabang: 'BGR', tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '', ...o });

describe('statusTanggal', () => {
  it.each([
    ['2026-10-29', 'LEWAT', -1], ['2026-10-30', 'LEWAT', 0], ['2026-10-31', 'KRITIS', 1], ['2026-11-29', 'KRITIS', 30],
    ['2026-11-30', 'WASPADA', 31], ['2026-12-29', 'WASPADA', 60], ['2026-12-30', 'AMAN', 61],
  ])('%s', (tgl, status, sisa) => expect(statusTanggal(tgl as string, TODAY)).toMatchObject({ status, sisa }));
  it('kosong/tidak valid = tanpa status', () => {
    expect(statusTanggal('', TODAY)).toEqual({ tanggal: '', sisa: null, status: '' });
    expect(statusTanggal('bukan-tanggal', TODAY).status).toBe('');
  });
});

describe('barisPajakKir', () => {
  const kendaraan = [
    v({ vehicle_id: '1', plat_nomor: 'D 2 B', tanggal_pajak: '2027-05-01', tanggal_pajak_5_tahunan: '2030-05-01', tanggal_kir: '2027-01-01' }), // aman
    v({ vehicle_id: '2', plat_nomor: 'D 3 C', tanggal_pajak: '2026-10-06', tanggal_kir: '2026-12-11' }), // lewat (24 hari lalu)
    v({ vehicle_id: '3', plat_nomor: 'D 4 D', cabang: 'KWG', tanggal_pajak: '2027-05-01', tanggal_kir: '2026-11-04' }), // kritis
    v({ vehicle_id: '4', plat_nomor: 'Z 5 E', jenis: 'Motor', cabang: 'TSM', tanggal_pajak: '2026-10-17', tanggal_pajak_5_tahunan: '2026-10-01', tanggal_kir: '2026-10-01' }),
  ];
  const nama = { BGR: 'Who Bogor', KWG: 'Who Karawang', TSM: 'Who Tasikmalaya' };

  it('semua kendaraan aktif, urut paling mendesak dulu; motor: pajak 5 tahunan & KIR dikosongkan', () => {
    const b = barisPajakKir(kendaraan, { today: TODAY, namaCabang: nama });
    expect(b.map((x) => [x.plat, x.terburuk])).toEqual([['D 3 C', 'LEWAT'], ['Z 5 E', 'LEWAT'], ['D 4 D', 'KRITIS'], ['D 2 B', 'AMAN']]);
    const motor = b.find((x) => x.plat === 'Z 5 E')!;
    expect(motor.dok.pajak5).toMatchObject({ na: true, status: '', tanggal: '' });
    expect(motor.dok.kir.na).toBe(true);
    expect(motor.dok.pajak).toMatchObject({ status: 'LEWAT', sisa: -13 });
    expect(b[0]!.namaCabang).toBe('Who Bogor');
  });

  it('filter warehouse; belum diisi dihitung tersendiri', () => {
    const b = barisPajakKir(kendaraan, { today: TODAY, cabang: 'KWG', namaCabang: nama });
    expect(b.map((x) => x.plat)).toEqual(['D 4 D']);
    const semua = barisPajakKir([...kendaraan, v({ vehicle_id: '9', plat_nomor: 'D 9 Z' })], { today: TODAY });
    expect(ringkasPajakKir(semua)).toEqual({ total: 5, lewat: 2, kritis: 1, waspada: 0, aman: 1, kosong: 1 });
  });
});

describe('sheetPajakKir', () => {
  it('kolom per dokumen (jatuh tempo, sisa hari, status), total, jadi buku Excel dengan autofilter dari header', () => {
    const baris = barisPajakKir([v({ plat_nomor: 'D 3 C', tanggal_pajak: '2026-10-06', tanggal_kir: '2026-12-11' })], { today: TODAY, namaCabang: { BGR: 'Who Bogor' } });
    const [sheet] = sheetPajakKir(baris, { warehouse: 'Who Bogor', today: TODAY });
    expect(sheet!.aoa[5]!.slice(0, 8)).toEqual(['No', 'Warehouse', 'Plat Nomor', 'Nama Kendaraan', 'Jenis', 'Pajak Tahunan — Jatuh Tempo', 'Pajak Tahunan — Sisa Hari', 'Pajak Tahunan — Status']);
    expect(sheet!.aoa[6]!.slice(0, 8)).toEqual([1, 'Who Bogor', 'D 3 C', 'Grand Max', 'Mobil', '06/10/2026', -24, 'LEWAT']);
    expect(sheet!.aoa[6]!.at(-1)).toBe('LEWAT');
    expect(sheet!.aoa[3]![1]).toMatch(/Lewat: 1 \| Kritis/);
    expect(sheet!.aoa.at(-1)![1]).toBe('TOTAL KENDARAAN');
    const wb = XLSX.read(XLSX.write(bukuExcel(XLSX, [sheet]), { type: 'array', bookType: 'xlsx' }), { type: 'array' });
    expect(wb.SheetNames).toEqual(['Pajak & KIR']);
    expect(wb.Sheets['Pajak & KIR']!['!autofilter']!.ref.startsWith('A6:')).toBe(true);
    expect(namaFilePajakKir('', TODAY)).toBe('pajak-kir-semua-2026-10-30.xlsx');
    expect(namaFilePajakKir('BGR', TODAY)).toBe('pajak-kir-BGR-2026-10-30.xlsx');
  });
});
