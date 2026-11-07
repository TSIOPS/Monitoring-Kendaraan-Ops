-- Foto bukti retribusi & parkir delivery (spec 2026-11-07-retribusi-parkir-design.md). Idempoten;
-- jalankan di Supabase SQL editor SEBELUM deploy. Rincian jenis RETRIBUSI/PARKIR tersimpan di kolom
-- rincian (jsonb) yang sudah ada; hanya dua kolom foto opsional yang baru.
alter table penggunaan_bbm add column if not exists foto_struk_retribusi text not null default '';
alter table penggunaan_bbm add column if not exists foto_struk_parkir text not null default '';
