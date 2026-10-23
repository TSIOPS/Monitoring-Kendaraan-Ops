import { describe, expect, it } from 'vitest';
import schemaSql from '../db/schema.sql?raw';

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