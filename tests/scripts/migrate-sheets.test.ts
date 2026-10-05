import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  cariPkGanda,
  keAngka,
  nilaiSel,
  parseSchema,
  pisahkanSupirGanda,
  pulihkanNomorKartu,
  serialKeIsoUtc,
  serialKeTanggal,
  siapkan,
  terapkanRemapJalur,
} from '../../scripts/migrate-sheets.mjs';

const schema = parseSchema(readFileSync('db/schema.sql', 'utf8'));

// 46300 = 2026-10-05 (dicek dengan XLSX.SSF.parse_date_code); 0.25 hari = 06:00.
const SERIAL_5_OKT = 46300;

describe('konversi tanggal Excel (jam dinding WIB)', () => {
  it('tanggal-saja menjadi YYYY-MM-DD', () => {
    expect(serialKeTanggal(SERIAL_5_OKT)).toBe('2026-10-05');
  });

  it('tanggal-saja membuang komponen jam', () => {
    expect(serialKeTanggal(SERIAL_5_OKT + 0.99)).toBe('2026-10-05');
  });

  it('stempel waktu WIB dikonversi ke ISO UTC', () => {
    // 5 Okt 06:00 WIB = 4 Okt 23:00 UTC.
    expect(serialKeIsoUtc(SERIAL_5_OKT + 0.25)).toBe('2026-10-04T23:00:00.000Z');
  });

  it('nilaiSel memilih format menurut kolom', () => {
    const cell = { t: 'n', v: SERIAL_5_OKT + 0.5, z: 'm/d/yyyy h:mm:ss' };
    expect(nilaiSel(cell, 'penggunaan_bbm', 'tanggal', 'text', [])).toBe('2026-10-05');
    expect(nilaiSel(cell, 'penggunaan_bbm', 'timestamp', 'text', [])).toBe('2026-10-05T05:00:00.000Z');
    expect(nilaiSel(cell, 'flazz_topup', 'date', 'text', [])).toBe('2026-10-05');
    expect(nilaiSel(cell, 'flazz_usage', 'date', 'text', [])).toBe('2026-10-05T05:00:00.000Z');
  });
});

describe('konversi nilai', () => {
  it('angka di kolom teks menjadi string tanpa notasi ilmiah', () => {
    expect(nilaiSel({ t: 'n', v: 145012345678901 }, 'flazz_card', 'card_number', 'text', [])).toBe('145012345678901');
    expect(nilaiSel({ t: 'n', v: 12345 }, 'penggunaan_bbm', 'km_awal_confirmed', 'text', [])).toBe('12345');
  });

  it('sel kosong memakai default kolom', () => {
    expect(nilaiSel(undefined, 'kendaraan', 'jumlah_bar', 'num', [])).toBe(0);
    expect(nilaiSel({ t: 's', v: '  ' }, 'kendaraan', 'merk', 'text', [])).toBe('');
  });

  it('keAngka menerima string dengan koma desimal', () => {
    expect(keAngka('12,5')).toBe(12.5);
    expect(keAngka('12.5')).toBe(12.5);
    expect(keAngka('abc')).toBeNull();
  });

  it('teks non-angka di kolom angka dicatat sebagai masalah', () => {
    const masalah: unknown[] = [];
    expect(nilaiSel({ t: 's', v: 'n/a' }, 'kendaraan', 'jumlah_bar', 'num', masalah)).toBe(0);
    expect(masalah).toHaveLength(1);
  });
});

describe('perbaikan data', () => {
  it('memulihkan 0 di depan nomor kartu 15 digit berawalan 145', () => {
    expect(pulihkanNomorKartu('145012345678901')).toBe('0145012345678901');
    expect(pulihkanNomorKartu('0145012345678901')).toBe('0145012345678901');
    expect(pulihkanNomorKartu('6013012345678901')).toBe('6013012345678901');
    expect(pulihkanNomorKartu('0145 0123 4567 8901')).toBe('0145 0123 4567 8901');
  });

  it('memberi ID baru untuk supir ganda dan memetakan ulang jalur berdasarkan nama', () => {
    const supir = [
      { supir_id: 'DRV-1', nama_supir: 'Andi' },
      { supir_id: 'DRV-1', nama_supir: 'Budi' },
    ];
    const remap = pisahkanSupirGanda(supir);
    expect(supir[1]!.supir_id).toBe('DRV-1-B');
    const jalur = [
      { driver_id: 'DRV-1', nama_driver: 'Andi', driver2_id: '', nama_driver2: '' },
      { driver_id: 'DRV-1', nama_driver: 'Budi', driver2_id: 'DRV-1', nama_driver2: 'Budi' },
    ];
    expect(terapkanRemapJalur(jalur, remap)).toBe(2);
    expect(jalur[0]!.driver_id).toBe('DRV-1');
    expect(jalur[1]!.driver_id).toBe('DRV-1-B');
    expect(jalur[1]!.driver2_id).toBe('DRV-1-B');
    expect(cariPkGanda(supir, 'supir_id')).toEqual([]);
  });
});

describe('siapkan', () => {
  it('memetakan kolom alias, membuang kolom asing, dan konsisten per baris', () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['supir_id', 'nama_supir', 'kode_cabang', 'status', 'vehicle_id'],
        ['DRV-1', 'Andi', 'BDG', 'Aktif', 'V-1'],
        ['DRV-2', 'Budi', 'BDG', 'Aktif', ''],
      ]),
      'Supir',
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ['transaction_id', 'tanggal', 'biaya_bbm', 'biaya_bbm_2'],
        ['TRX-1', '2026-10-04', 1000, 500],
        ['TRX-2', '2026-10-04', 2000, 0],
      ]),
      'Penggunaan_BBM',
    );
    // siapkan() dari .mjs bertipe {} bagi TypeScript; bentuknya diuji di bawah.
    const { hasil, laporan } = siapkan(wb, schema) as { hasil: Record<string, any>; laporan: Record<string, any> };
    expect(hasil.supir.rows[0].default_vehicle_id).toBe('V-1');
    expect(hasil.supir.rows[1].default_vehicle_id).toBe('');
    expect(hasil.penggunaan_bbm.rows[0]).not.toHaveProperty('biaya_bbm_2');
    expect(laporan.kolomDibuang.penggunaan_bbm.biaya_bbm_2).toEqual(['TRX-1']);
    const kunci = hasil.penggunaan_bbm.rows.map((r: object) => Object.keys(r).join());
    expect(new Set(kunci).size).toBe(1);
  });
});
