-- Kendaraan bersama (08/10/2026): satu kendaraan fisik didaftarkan sekali di warehouse pemilik,
-- warehouse lain yang ikut memakai dicatat di kendaraan.cabang_bersama ("CBY,GDGTSM").
-- Laporan & jalur tetap distempel warehouse pemakainya (rekap biaya tidak berubah); yang
-- dipindah hanya vehicle_id agar riwayat KM, ganti oli, dan efisiensi menyatu.
-- Pengaman: setiap UPDATE hanya mengenai baris dengan nilai lama yang diharapkan.
begin;

-- 1) Kolom baru.
alter table kendaraan add column if not exists cabang_bersama text not null default '';

-- 2) Z 3821 IF: pemilik WHP Bandung (V-1791356181552), dipakai juga WHO Cibaduyut.
--    Data teknis diambil dari data Cibaduyut (kapasitas 46057 L & standar 0 di data WHP salah ketik).
update kendaraan set cabang_bersama = 'CBY', kapasitas_tangki = 4, standar_km_l = 40
  where vehicle_id = 'V-1791356181552' and kode_cabang = 'GDGBDG';
update penggunaan_bbm set vehicle_id = 'V-1791356181552' where vehicle_id = 'V-1790234473072';
update jalur_pengiriman set vehicle_id = 'V-1791356181552' where vehicle_id = 'V-1790234473072';
update flazz_usage set vehicle_id = 'V-1791356181552' where vehicle_id = 'V-1790234473072';
update flazz_reconciliation set vehicle_id = 'V-1791356181552' where vehicle_id = 'V-1790234473072';
update supir set default_vehicle_id = 'V-1791356181552' where default_vehicle_id = 'V-1790234473072';
update kendaraan set status = 'Non-Aktif' where vehicle_id = 'V-1790234473072';

-- 3) D 8724 FN: pemilik WHO Tasikmalaya (V-1788853507067), dipakai juga WHP Tasikmalaya.
--    Data WHP (V-1790934129162) belum punya laporan/jalur.
update kendaraan set cabang_bersama = 'GDGTSM' where vehicle_id = 'V-1788853507067' and kode_cabang = 'TSM';
update supir set default_vehicle_id = 'V-1788853507067' where default_vehicle_id = 'V-1790934129162';
update kendaraan set status = 'Non-Aktif' where vehicle_id = 'V-1790934129162';

-- 4) D 8477 FF: pemilik WHO Tasikmalaya (V-1788854171549), dipakai juga WHP Tasikmalaya.
--    Laporan WHP 21/09 (KM 323.330-323.454) cocok dengan riwayat mobil ini -> dipindah.
--    Laporan WHP 17/09 TRX-1789633711527 (KM 133.438-133.482) TIDAK dipindah: KM-nya sama persis
--    dengan laporan D 8724 FN 17/09 (kemungkinan ganda/salah plat); tetap di data lama yang dinonaktifkan.
update penggunaan_bbm set vehicle_id = 'V-1788854171549'
  where vehicle_id = 'V-1788855410066' and transaction_id = 'TRX-1789978014182';
update jalur_pengiriman set vehicle_id = 'V-1788854171549'
  where vehicle_id = 'V-1788855410066' and id = 'JLR-1789977842137-0';
update kendaraan set cabang_bersama = 'GDGTSM' where vehicle_id = 'V-1788854171549' and kode_cabang = 'TSM';
update supir set default_vehicle_id = 'V-1788854171549' where default_vehicle_id = 'V-1788855410066';
update kendaraan set status = 'Non-Aktif' where vehicle_id = 'V-1788855410066';

-- Periksa: 3 kendaraan bersama, data ganda Non-Aktif.
select vehicle_id, plat_nomor, kode_cabang, cabang_bersama, status, kapasitas_tangki, standar_km_l
  from kendaraan where replace(upper(plat_nomor), ' ', '') in ('Z3821IF', 'D8724FN', 'D8477FF') order by plat_nomor, status;
select vehicle_id, count(*) as laporan from penggunaan_bbm
  where vehicle_id in ('V-1791356181552', 'V-1790234473072', 'V-1788854171549', 'V-1788855410066') group by vehicle_id;

commit;
