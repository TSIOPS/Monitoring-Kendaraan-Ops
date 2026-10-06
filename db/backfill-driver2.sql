-- ============================================================================
-- ISI DRIVER 2 LAPORAN DARI JALUR (jalankan SETELAH migrate-sheets saat cutover).
-- Export GAS tidak punya kolom driver kedua di laporan; nilainya diambil dari
-- jalur yang tertaut (laporan_id). Driver 2 yang sama dengan Driver 1
-- (salah input di jalur lama) diabaikan. Aman diulang.
-- ============================================================================

update penggunaan_bbm p
set nama_supir_2 = j.nama_driver2
from jalur_pengiriman j
where j.laporan_id = p.transaction_id
  and coalesce(j.nama_driver2, '') <> ''
  and coalesce(j.is_deleted, '') <> '1'
  and lower(trim(j.nama_driver2)) <> lower(trim(p.nama_supir));

-- Cek: jumlah laporan berisi Driver 2.
select count(*) as laporan_dengan_driver2 from penggunaan_bbm where nama_supir_2 <> '';
