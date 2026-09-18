-- ==========================================
-- SKEMA POSTGRESQL — monitoring kendaraan ops
-- Mapping 1:1 dari DATABASE_SCHEMA (DatabaseSetup.js)
-- Jalankan di Supabase SQL editor / `supabase db push`
-- ==========================================

-- MASTER ------------------------------------------------------------------
create table if not exists cabang (
  kode_cabang text primary key,
  nama_cabang text not null default '',
  lokasi text not null default '',
  status text not null default 'Aktif'
);

create table if not exists supir (
  supir_id text primary key,
  nama_supir text not null default '',
  kode_cabang text not null default '',
  status text not null default 'Aktif'
);

create table if not exists bbm (
  bbm_id text primary key,
  jenis_bbm text not null default '',
  harga_per_liter numeric not null default 0,
  kode_cabang text not null default '',
  status text not null default 'Aktif'
);

create table if not exists pengguna (
  user_id text primary key,
  username text not null unique,
  password text not null,
  nama text not null default '',
  role text not null default 'PIC CABANG',
  kode_cabang text not null default '',
  status text not null default 'Aktif',
  email text not null default ''
);

create table if not exists kendaraan (
  vehicle_id text primary key,
  plat_nomor text not null default '',
  nama_kendaraan text not null default '',
  jenis_kendaraan text not null default '',
  merk text not null default '',
  model text not null default '',
  kapasitas_tangki numeric not null default 0,
  jumlah_bar numeric not null default 0,
  standar_km_l numeric not null default 0,
  kode_cabang text not null default '',
  status text not null default 'Aktif',
  jenis_indikator text not null default '',
  tanggal_pajak text not null default '',
  tanggal_pajak_5_tahunan text not null default '',
  tanggal_kir text not null default '',
  km_terakhir_ganti_oli numeric not null default 0,
  interval_ganti_oli_km numeric not null default 0
);

-- CORE LAPORAN -------------------------------------------------------------
create table if not exists penggunaan_bbm (
  transaction_id text primary key,
  timestamp text not null default '',
  tanggal text not null default '',
  user_id text not null default '',
  nama_pengguna text not null default '',
  kode_cabang text not null default '',
  vehicle_id text not null default '',
  plat_nomor text not null default '',
  foto_km_awal text not null default '',
  ocr_km_awal text not null default '',
  km_awal_confirmed text not null default '',
  bar_awal text not null default '',
  foto_km_akhir text not null default '',
  ocr_km_akhir text not null default '',
  km_akhir_confirmed text not null default '',
  bar_akhir text not null default '',
  km_tempuh numeric not null default 0,
  perubahan_bar numeric not null default 0,
  liter_bbm numeric not null default 0,
  biaya_bbm numeric not null default 0,
  foto_struk_bbm text not null default '',
  biaya_toll numeric not null default 0,
  foto_struk_toll text not null default '',
  km_per_liter numeric not null default 0,
  status text not null default '',
  warning text not null default '',
  nama_supir text not null default '',
  metode_pembayaran text not null default 'TUNAI',
  flazz_card_id text not null default '',
  km_sumber text not null default '',
  metode_toll text not null default '',
  flazz_card_id_toll text not null default ''
);

create table if not exists pengisian_bbm (
  fuel_id text primary key,
  timestamp text not null default '',
  tanggal text not null default '',
  vehicle_id text not null default '',
  plat_nomor text not null default '',
  user_id text not null default '',
  km numeric not null default 0,
  jenis_bbm text not null default '',
  liter numeric not null default 0,
  harga_per_liter numeric not null default 0,
  total_biaya numeric not null default 0,
  nama_spbu text not null default '',
  foto_struk text not null default '',
  status text not null default ''
);

create table if not exists foto_evidence (
  evidence_id text primary key,
  transaction_id text not null default '',
  tipe_foto text not null default '',
  file_url text not null default '',
  file_id text not null default '',
  timestamp text not null default ''
);

-- AUDIT & KONFIGURASI ---------------------------------------------------------
create table if not exists audit_log (
  log_id text primary key,
  timestamp text not null default '',
  user_id text not null default '',
  username text not null default '',
  action text not null default '',
  modul text not null default '',
  keterangan text not null default '',
  data_sebelum text not null default '',
  data_sesudah text not null default '',
  ip text not null default ''
);

create table if not exists konfigurasi (
  key text primary key,
  value text not null default '',
  keterangan text not null default ''
);

create table if not exists pengaturan (
  key text primary key,
  value text not null default '',
  updated_at text not null default ''
);

-- FLAZZ ------------------------------------------------------------------------
create table if not exists flazz_card (
  id text primary key,
  card_number text not null default '',
  card_name text not null default '',
  card_type text not null default '',
  card_role text not null default '',
  branch_id text not null default '',
  driver_id text not null default '',
  default_driver_id text not null default '',
  last_balance numeric not null default 0,
  status text not null default '',
  notes text not null default '',
  created_at text not null default '',
  updated_at text not null default ''
);

create table if not exists flazz_usage (
  id text primary key,
  date text not null default '',
  card_id text not null default '',
  driver_id text not null default '',
  vehicle_id text not null default '',
  usage_type text not null default '',
  primary_card_id text not null default '',
  backup_card_id text not null default '',
  reason text not null default '',
  opening_balance numeric not null default 0,
  used_at text not null default '',
  returned_at text not null default '',
  status text not null default '',
  created_by text not null default '',
  created_at text not null default '',
  ref_type text not null default '',
  ref_id text not null default ''
);

create table if not exists flazz_topup (
  id text primary key,
  date text not null default '',
  card_id text not null default '',
  amount numeric not null default 0,
  evidence_url text not null default '',
  notes text not null default '',
  created_by text not null default '',
  created_at text not null default '',
  is_deleted text not null default ''
);

create table if not exists flazz_tol (
  id text primary key,
  date text not null default '',
  card_id text not null default '',
  driver_id text not null default '',
  vehicle_id text not null default '',
  amount numeric not null default 0,
  evidence_url text not null default '',
  notes text not null default '',
  created_by text not null default '',
  created_at text not null default '',
  is_deleted text not null default ''
);

create table if not exists flazz_reconciliation (
  id text primary key,
  date text not null default '',
  card_id text not null default '',
  driver_id text not null default '',
  vehicle_id text not null default '',
  opening_balance numeric not null default 0,
  total_topup numeric not null default 0,
  total_bbm_flazz numeric not null default 0,
  total_tol numeric not null default 0,
  total_expense numeric not null default 0,
  flazz_balance numeric not null default 0,
  actual_balance numeric not null default 0,
  difference numeric not null default 0,
  reconciliation_status text not null default '',
  notes text not null default '',
  reconciled_by text not null default '',
  reconciled_at text not null default '',
  is_deleted text not null default ''
);

-- JALUR PENGIRIMAN -------------------------------------------------------------
create table if not exists jalur_pengiriman (
  id text primary key,
  tanggal text not null default '',
  driver_id text not null default '',
  nama_driver text not null default '',
  driver2_id text not null default '',
  nama_driver2 text not null default '',
  vehicle_id text not null default '',
  plat_nomor text not null default '',
  nama_kendaraan text not null default '',
  jenis_kendaraan text not null default '',
  rute_tujuan text not null default '',
  kode_cabang text not null default '',
  flazz_card_id text not null default '',
  flazz_card_name text not null default '',
  created_by text not null default '',
  created_at text not null default '',
  updated_at text not null default '',
  is_deleted text not null default '',
  status text not null default '',
  laporan_id text not null default ''
);

-- INDEX --------------------------------------------------------------------------
create index if not exists idx_penggunaan_branch_tgl on penggunaan_bbm (kode_cabang, tanggal);
create index if not exists idx_audit_ts on audit_log (timestamp);
create index if not exists idx_flazz_usage_card on flazz_usage (card_id);
create index if not exists idx_flazz_topup_card on flazz_topup (card_id);
create index if not exists idx_flazz_tol_card on flazz_tol (card_id);
create index if not exists idx_flazz_recon_card on flazz_reconciliation (card_id);
create index if not exists idx_jalur_tgl_cabang on jalur_pengiriman (tanggal, kode_cabang);

-- SEED PENGATURAN -------------------------------------------------------------------
insert into pengaturan (key, value, updated_at)
values
  ('logo_url', '', ''),
  ('app_name', 'Monitoring Kendaraan Operasional', ''),
  ('company_name', 'PT Tridaya Sinergi Indonesia', ''),
  ('footer_text', '© 2026 Tridaya Sinergi Indonesia', '')
on conflict (key) do nothing;