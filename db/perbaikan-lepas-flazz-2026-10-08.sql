-- Perbaikan 08/10/2026: membatalkan "Lepas Flazz" yang tidak disengaja (akun snd_2, 07:10-07:16 WIB)
-- dan pengembalian ganda Rp 5.500 di E toll 6 (hapus rekon + hapus laporan Agus, 07/10/2026).
-- Saldo target = saldo fisik rekonsiliasi terakhir (sama dengan file GAS) + topup baru.
-- Pengaman: hanya mengubah baris yang nilainya masih sama dengan kondisi saat skrip dibuat.
begin;

-- 1) Kembalikan metode BBM ke FLAZZ dengan kartu semula (16 laporan).
update penggunaan_bbm p set metode_pembayaran = 'FLAZZ', flazz_card_id = v.kartu
from (values
  ('TRX-1791363813319','FLZ-1788491353941', 25000),
  ('TRX-1791363564093','FLZ-1790233000303',100000),
  ('TRX-1791363762122','FLZ-1788490983989',400000),
  ('TRX-1791278151207','FLZ-1788491013339', 20000),
  ('TRX-1791278005057','FLZ-1788491125050', 24400),
  ('TRX-1791268492822','FLZ-1788491257484',300300),
  ('TRX-1791267116543','FLZ-1788404380096',200000),
  ('TRX-1791259536569','FLZ-1790233000303',150000),
  ('TRX-1791258834763','FLZ-1788578941426',100000),
  ('TRX-1791192276365','FLZ-1788491168252',200000),
  ('TRX-1791188576449','FLZ-1788490983989',400000),
  ('TRX-1791179309536','FLZ-1788491086827', 27700),
  ('TRX-1791021293174','FLZ-1788491125050', 27200),
  ('TRX-1791016221233','FLZ-1788491257484',200000),
  ('TRX-1791015995749','FLZ-1788491013339', 23000),
  ('TRX-1791008632574','FLZ-1788491086827', 24000)
) as v(trx, kartu, biaya)
where p.transaction_id = v.trx and p.metode_pembayaran = 'TUNAI' and p.flazz_card_id = '' and p.biaya_bbm = v.biaya;

-- 2) Saldo kartu ke nilai yang benar.
update flazz_card c set last_balance = v.target, updated_at = now()
from (values
  ('FLZ-1788404380096',  546000,  346000), -- WHP BDG 1
  ('FLZ-1788490983989', 1042500,  242500), -- WHP BDG 3
  ('FLZ-1788491013339',  381562,  338562), -- E toll 3  (38.562 + topup 300.000)
  ('FLZ-1788491086827',  366730,  315030), -- E toll 4
  ('FLZ-1788491125050',  840340,  788740), -- E toll 5  (88.740 + topup 700.000)
  ('FLZ-1788491168252', 1139500,  934000), -- E toll 6  (termasuk koreksi ganda 5.500)
  ('FLZ-1788491257484', 1543700, 1043400), -- E toll 8
  ('FLZ-1788491353941', 1747800, 1722800), -- E toll 11
  ('FLZ-1788578941426',  166108,   66108), -- WHP BDG TRK 3
  ('FLZ-1790233000303',  659601,  409601)  -- WHP BDG TRK 1
) as v(id, kini, target)
where c.id = v.id and c.last_balance = v.kini;

-- Periksa: harus 16 laporan FLAZZ dan 10 kartu dengan saldo target.
select count(*) as laporan_flazz from penggunaan_bbm where transaction_id in (
  'TRX-1791363813319','TRX-1791363564093','TRX-1791363762122','TRX-1791278151207','TRX-1791278005057','TRX-1791268492822',
  'TRX-1791267116543','TRX-1791259536569','TRX-1791258834763','TRX-1791192276365','TRX-1791188576449','TRX-1791179309536',
  'TRX-1791021293174','TRX-1791016221233','TRX-1791015995749','TRX-1791008632574') and metode_pembayaran = 'FLAZZ';
select id, card_name, last_balance from flazz_card where id in (
  'FLZ-1788404380096','FLZ-1788490983989','FLZ-1788491013339','FLZ-1788491086827','FLZ-1788491125050',
  'FLZ-1788491168252','FLZ-1788491257484','FLZ-1788491353941','FLZ-1788578941426','FLZ-1790233000303') order by card_name;

commit;
