-- Rincian pengeluaran per nota (spec 2026-10-21). Idempoten; jalankan di Supabase SQL editor sebelum deploy.
-- Item: {"jenis":"BBM"|"TOL","nominal":200000,"kartu":"<card_id>"|"","keterangan":"..."}; kartu kosong = tunai.
alter table penggunaan_bbm add column if not exists rincian jsonb not null default '[]'::jsonb;
