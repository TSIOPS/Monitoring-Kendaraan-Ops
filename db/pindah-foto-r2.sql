-- Pindah alamat foto bukti dari Supabase Storage ke Cloudflare R2 (16/10/2026).
-- Jalankan SETELAH semua foto disalin ke R2 (skrip salin-foto). Kunci objek sama, hanya
-- awalan URL yang diganti: https://<proyek>.supabase.co/storage/v1/object/public/foto/<kunci>
-- menjadi /foto/<kunci>. Foto yang belum tersalin tetap tampil: /foto/* mengambil dari
-- Supabase bila belum ada di R2. Logo (bucket "settings") tidak diubah.
begin;

update penggunaan_bbm set
  foto_km_awal    = regexp_replace(foto_km_awal,    '^https://[^/]+/storage/v1/object/public/foto/', '/foto/'),
  foto_km_akhir   = regexp_replace(foto_km_akhir,   '^https://[^/]+/storage/v1/object/public/foto/', '/foto/'),
  foto_struk_bbm  = regexp_replace(foto_struk_bbm,  '^https://[^/]+/storage/v1/object/public/foto/', '/foto/'),
  foto_struk_toll = regexp_replace(foto_struk_toll, '^https://[^/]+/storage/v1/object/public/foto/', '/foto/')
where foto_km_awal like '%/storage/v1/object/public/foto/%'
   or foto_km_akhir like '%/storage/v1/object/public/foto/%'
   or foto_struk_bbm like '%/storage/v1/object/public/foto/%'
   or foto_struk_toll like '%/storage/v1/object/public/foto/%';

update flazz_topup set evidence_url = regexp_replace(evidence_url, '^https://[^/]+/storage/v1/object/public/foto/', '/foto/')
where evidence_url like '%/storage/v1/object/public/foto/%';

update flazz_tol set evidence_url = regexp_replace(evidence_url, '^https://[^/]+/storage/v1/object/public/foto/', '/foto/')
where evidence_url like '%/storage/v1/object/public/foto/%';

-- Periksa: semua harus 0.
select
  (select count(*) from penggunaan_bbm where foto_km_awal like '%supabase.co%' or foto_km_akhir like '%supabase.co%'
     or foto_struk_bbm like '%supabase.co%' or foto_struk_toll like '%supabase.co%') as laporan_masih_supabase,
  (select count(*) from flazz_topup where evidence_url like '%supabase.co%') as topup_masih_supabase,
  (select count(*) from flazz_tol where evidence_url like '%supabase.co%') as tol_masih_supabase,
  (select count(*) from penggunaan_bbm where foto_km_awal like '/foto/%') as laporan_di_r2;

commit;
