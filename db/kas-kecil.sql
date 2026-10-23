-- Migrasi kas kecil. Aman dijalankan berulang. Jalankan di Supabase SQL Editor SEBELUM deploy fitur kas kecil.
-- KAS KECIL (docs/superpowers/specs/2026-10-23-kas-kecil-design.md) ----------------
create table if not exists kas_jenis (
  id text primary key,
  kode_akun text not null default '',
  nama text not null,
  prefiks_ref text not null default '',          -- 'BO' | 'BP' | '' (tanpa nomor referensi)
  tipe text not null default 'KELUAR',           -- 'KELUAR' | 'MASUK' (Tambah Saldo)
  tanpa_penyelesaian boolean not null default false,
  aktif boolean not null default true,
  urut integer not null default 0
);

create table if not exists kas_keluar (
  id text primary key,                            -- No Kas Keluar: KK-WHO-KWG-202610220121
  kode_cabang text not null default '',
  tanggal text not null default '',
  jam text not null default '',
  no_referensi text not null default '',          -- BO-/BP-...
  penerima text not null default '',
  admin text not null default '',
  jenis_id text not null default '',
  kode_akun text not null default '',
  jenis text not null default '',
  pecahan jsonb not null default '{}'::jsonb,
  jumlah numeric not null default 0,
  keterangan text not null default '',
  status text not null default 'Open',            -- 'Open' | 'Closed'
  no_kas_masuk text not null default '',
  created_by text not null default '',
  created_at text not null default '',
  is_deleted text not null default ''
);
create index if not exists kas_keluar_cabang_tgl on kas_keluar (kode_cabang, tanggal);

create table if not exists kas_masuk (
  id text primary key,                            -- No Kas Masuk: KM-WHO-KWG-202610220058
  kode_cabang text not null default '',
  tanggal text not null default '',
  jam text not null default '',
  no_kas_keluar text not null default '',         -- '' = Tambah Saldo
  no_referensi text not null default '',
  penerima text not null default '',
  admin text not null default '',
  jenis_id text not null default '',
  kode_akun text not null default '',
  jenis text not null default '',
  pecahan jsonb not null default '{}'::jsonb,
  jumlah numeric not null default 0,
  keterangan text not null default '',
  created_by text not null default '',
  created_at text not null default '',
  is_deleted text not null default ''
);
create index if not exists kas_masuk_cabang_tgl on kas_masuk (kode_cabang, tanggal);

create table if not exists kas_saldo_awal (
  kode_cabang text primary key,
  tanggal text not null default '',
  jumlah numeric not null default 0
);

create table if not exists kas_opname (
  id text primary key,                            -- CO.001/TSI-OPR/KWG/X/2026
  kode_cabang text not null default '',
  tanggal text not null default '',
  pemeriksa text not null default '',
  pecahan jsonb not null default '{}'::jsonb,     -- hitung fisik per pecahan
  nilai_fisik numeric not null default 0,
  nilai_buku numeric not null default 0,
  selisih numeric not null default 0,
  catatan text not null default '',
  created_by text not null default '',
  created_at text not null default '',
  is_deleted text not null default ''
);

alter table kas_jenis enable row level security;
alter table kas_keluar enable row level security;
alter table kas_masuk enable row level security;
alter table kas_saldo_awal enable row level security;
alter table kas_opname enable row level security;

-- Seed jenis transaksi (gabungan DbPengeluaran semua cabang).
insert into kas_jenis (id, kode_akun, nama, prefiks_ref, tipe, tanpa_penyelesaian, aktif, urut) values
  ('KJ-01', '6101-101', 'Biaya Pengiriman via Pihak ketiga', 'BP', 'KELUAR', false, true, 1),
  ('KJ-02', '5101-102', 'Biaya Jamuan Supir dari Pabrik', 'BO', 'KELUAR', false, true, 2),
  ('KJ-03', '6101-103', 'Biaya Bensin Delivery', 'BP', 'KELUAR', false, true, 3),
  ('KJ-04', '6101-103', 'Biaya Pengisian ETOLL', 'BO', 'KELUAR', false, true, 4),
  ('KJ-05', '6101-103', 'Biaya Parkir Untuk Delivery', 'BP', 'KELUAR', false, true, 5),
  ('KJ-06', '6101-103', 'Biaya Uang Muka Delivery', 'BO', 'KELUAR', false, true, 6),
  ('KJ-07', '7101-109', 'Biaya Iuran Lingkungan Kantor', 'BO', 'KELUAR', false, true, 7),
  ('KJ-08', '7101-109', 'Biaya Listrik', 'BO', 'KELUAR', false, true, 8),
  ('KJ-09', '7101-109', 'Biaya Tagihan Air', 'BO', 'KELUAR', false, true, 9),
  ('KJ-10', '7101-109', 'Biaya Telepon', 'BO', 'KELUAR', false, true, 10),
  ('KJ-11', '9101-105', 'Biaya Administrasi Bank', 'BO', 'KELUAR', false, true, 11),
  ('KJ-12', '7101-117', 'Biaya Perawatan Aset', 'BO', 'KELUAR', false, true, 12),
  ('KJ-13', '7101-117', 'Biaya Perawatan Gedung', 'BO', 'KELUAR', false, true, 13),
  ('KJ-14', '7101-117', 'Biaya Perawatan Kendaraan', 'BO', 'KELUAR', false, true, 14),
  ('KJ-15', '7101-118', 'Biaya Parkir ke Bank', 'BO', 'KELUAR', false, true, 15),
  ('KJ-16', '7101-118', 'Biaya Retribusi', 'BO', 'KELUAR', false, true, 16),
  ('KJ-17', '7101-118', 'Biaya Sumbangan', 'BO', 'KELUAR', false, true, 17),
  ('KJ-18', '7101-119', 'Biaya Pembelian Isi Ulang Air Minum atau Gas', 'BO', 'KELUAR', false, true, 18),
  ('KJ-19', '7101-119', 'Biaya Pembelian Bensin Genset', 'BO', 'KELUAR', false, true, 19),
  ('KJ-20', '6101-102', 'Biaya Management', 'BO', 'KELUAR', false, true, 20),
  ('KJ-21', '7101-115', 'Biaya Bensin Oprasional', 'BO', 'KELUAR', false, true, 21),
  ('KJ-22', '7000-01', 'Biaya Uang Jalan Distribusi', 'BP', 'KELUAR', false, true, 22),
  ('KJ-23', '1102-103', 'Setoran Tunai Kas Kecil', '', 'KELUAR', true, true, 23),
  ('KJ-24', '', 'Closing Kas', '', 'KELUAR', true, true, 24),
  ('KJ-25', '', 'Tukar Denom', '', 'KELUAR', true, true, 25),
  ('KJ-26', '', 'Tambah Saldo', '', 'MASUK', false, true, 26)
on conflict (id) do nothing;
