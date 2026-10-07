-- ============================================================================
-- AKTIFKAN ROW LEVEL SECURITY (RLS) di semua tabel aplikasi.
--
-- Tanpa policy apa pun, peran `anon` dan `authenticated` (anon key / publishable key
-- Supabase) TIDAK BISA membaca atau mengubah tabel lewat REST/GraphQL.
-- Aplikasi (Cloudflare Worker) dan skrip migrasi memakai service role key, yang
-- melewati RLS, sehingga tidak terpengaruh. Aman dijalankan berulang.
-- ============================================================================

alter table cabang               enable row level security;
alter table supir                enable row level security;
alter table bbm                  enable row level security;
alter table pengguna             enable row level security;
alter table kendaraan            enable row level security;
alter table penggunaan_bbm       enable row level security;
alter table pengisian_bbm        enable row level security;
alter table foto_evidence        enable row level security;
alter table audit_log            enable row level security;
alter table konfigurasi          enable row level security;
alter table pengaturan           enable row level security;
alter table flazz_card           enable row level security;
alter table flazz_usage          enable row level security;
alter table flazz_topup          enable row level security;
alter table flazz_tol            enable row level security;
alter table flazz_reconciliation enable row level security;
alter table jalur_pengiriman     enable row level security;

-- Cek: semua baris harus rls_aktif = true.
select c.relname as tabel, c.relrowsecurity as rls_aktif
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r'
order by c.relname;
