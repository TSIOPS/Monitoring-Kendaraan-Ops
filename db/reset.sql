-- ============================================================================
-- RESET DATA (CUTOVER) — MENGHAPUS SEMUA ISI TABEL, struktur tabel tetap.
-- Jalankan di Supabase SQL Editor HANYA saat cutover, tepat sebelum
-- `node scripts/migrate-sheets.mjs <export.xlsx> --apply`.
-- Tidak bisa dibatalkan. Semua data akan diisi ulang dari export GAS.
-- ============================================================================

truncate table
  penggunaan_bbm,
  pengisian_bbm,
  foto_evidence,
  jalur_pengiriman,
  flazz_usage,
  flazz_topup,
  flazz_tol,
  flazz_reconciliation,
  flazz_card,
  kendaraan,
  supir,
  bbm,
  cabang,
  pengguna,
  audit_log,
  konfigurasi,
  pengaturan
restart identity;

-- Cek: semua harus 0.
select 'penggunaan_bbm' as tabel, count(*) from penggunaan_bbm
union all select 'jalur_pengiriman', count(*) from jalur_pengiriman
union all select 'flazz_card', count(*) from flazz_card
union all select 'pengguna', count(*) from pengguna
union all select 'audit_log', count(*) from audit_log;
