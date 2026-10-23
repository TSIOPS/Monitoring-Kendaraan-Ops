import { describe, expect, it } from 'vitest';
import schemaSql from '../db/schema.sql?raw';
import kasKecilSql from '../db/kas-kecil.sql?raw';

const sql = schemaSql;

const REQUIRED_TABLES = [
  'cabang',
  'supir',
  'bbm',
  'pengguna',
  'kendaraan',
  'penggunaan_bbm',
  'pengisian_bbm',
  'foto_evidence',
  'audit_log',
  'konfigurasi',
  'pengaturan',
  'flazz_card',
  'flazz_usage',
  'flazz_topup',
  'flazz_tol',
  'flazz_reconciliation',
  'jalur_pengiriman',
  'kas_jenis',
  'kas_keluar',
  'kas_masuk',
  'kas_saldo_awal',
  'kas_opname',
];

describe('db/schema.sql', () => {
  it('penggunaan_bbm punya kolom rincian jsonb', () => {
    expect(sql).toMatch(/alter table penggunaan_bbm add column if not exists rincian jsonb not null default '\[\]'::jsonb;/i);
  });
  it('mendefinisikan semua tabel yang dibutuhkan', () => {
    for (const t of REQUIRED_TABLES) {
      expect(sql, `tabel ${t} harus ada`).toMatch(new RegExp(`create table if not exists ${t}\\s*\\(`, 'i'));
    }
  });

  it('seimbang tanda kurung (create + insert)', () => {
    const opens = (sql.match(/\(/g) || []).length;
    const closes = (sql.match(/\)/g) || []).length;
    expect(opens).toBe(closes);
  });

  it('seed pengaturan default ada', () => {
    expect(sql).toMatch(/on conflict\s*\(key\)\s*do nothing/i);
  });
});

// Mencegah "relation ... does not exist" saat SQL dijalankan di SQL Editor Supabase: setiap ALTER/INDEX kas_* harus SETELAH CREATE TABLE-nya.
describe.each([['db/schema.sql', sql], ['db/kas-kecil.sql', kasKecilSql]])('urutan DDL kas kecil — %s', (nama, isi) => {
  it('ALTER/INDEX/RLS kas_* muncul setelah CREATE TABLE-nya', () => {
    const pola = /^(?:alter table|create index if not exists \w+ on) (kas_\w+)/gim;
    let n = 0;
    for (const m of isi.matchAll(pola)) {
      const c = isi.search(new RegExp(`create table if not exists ${m[1]}\\s*\\(`, 'i'));
      expect(c, `${nama}: tabel ${m[1]} tidak dibuat`).toBeGreaterThanOrEqual(0);
      expect(c, `${nama}: "${m[0]}" muncul sebelum CREATE TABLE ${m[1]}`).toBeLessThan(m.index!);
      n++;
    }
    expect(n).toBeGreaterThan(5);
  });
});

describe('db/kas-kecil.sql', () => {
  it('memuat kolom baru dan seed jenis', () => {
    for (const kolom of ['penerima_2', 'bukti_url', 'dana_mingguan']) expect(kasKecilSql).toContain(kolom);
    expect(kasKecilSql).toMatch(/insert into kas_jenis/i);
    expect((kasKecilSql.match(/\('KJ-\d+'/g) ?? []).length).toBe(26);
  });
});
