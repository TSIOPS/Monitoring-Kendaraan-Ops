# M10 — Halaman Data Master (Design)

Tanggal: 2026-10-06
Status: disetujui ("lanjut", 2026-10-06; D1 sesuai usulan)

## 1. Latar Belakang

API master (M2) dan kartu Flazz (M5) sudah ada tetapi belum punya halaman.
Pemeriksaan terhadap GAS terbaru (`Index.html` page-master, `js.html`,
`SpreadsheetOps.js`): aturan simpan/hapus M2 sudah 1:1 (soft-delete
`Non-Aktif`, pesan identik, cabang dengan data terkait ditolak, akun sendiri
dan SUPERADMIN terakhir dilindungi). Tidak perlu perubahan API, kecuali D1.

## 2. Halaman `#/master` (menu **Data Master**)

Filter warehouse (SUPERADMIN). Tab sama dengan GAS:

| Tab | Akses | Kolom | Aksi |
|---|---|---|---|
| Kendaraan | PIC (cabangnya), SUPERADMIN | Plat, Nama, Jenis, Indikator, Warehouse, Pajak, KIR, Oli | Tambah, Edit, Reset oli, Hapus |
| Warehouse | SUPERADMIN | Kode, Nama, Lokasi | Tambah, Edit, Hapus |
| Supir | PIC, SUPERADMIN | Nama, Warehouse, Kendaraan default | Tambah, Edit, Hapus |
| BBM | SUPERADMIN | Jenis, Harga/liter, Warehouse (kosong = global) | Tambah, Edit, Hapus |
| Kartu Flazz | PIC, SUPERADMIN | ID, Nomor, Nama, Tipe, Kategori, Warehouse, Saldo, Status | Kartu baru, Edit, Nonaktifkan / Aktifkan |
| Pengguna | SUPERADMIN | Username, Nama, Role, Warehouse, Status | Tambah, Edit (password opsional), Nonaktifkan / Aktifkan |

Form mengikuti field GAS:
- Kendaraan: plat, nama, jenis (Mobil/Motor), merk, model, kapasitas tangki,
  jumlah bar, standar KM/L, jenis indikator (Digital Bar, Analog/Jarum,
  Digital Angka, Tidak Ada, Lainnya), jatuh tempo pajak tahunan, pajak 5
  tahunan, KIR, interval ganti oli, KM terakhir ganti oli, warehouse.
- Warehouse: kode (tidak bisa diubah saat edit), nama, lokasi.
- Supir: nama, warehouse, kendaraan default (opsional, sesuai warehouse).
- BBM: jenis, harga per liter, warehouse (opsional).
- Kartu: nomor, nama, tipe (BCA Flazz, Mandiri E-Money, BRI Brizzi, BNI
  TapCash), peran (Kartu Utama/Cadangan), warehouse, supir default, keterangan.
- Pengguna: username, password (wajib saat tambah; kosong = tidak diubah),
  nama, role (PIC CABANG/SUPERADMIN), warehouse (wajib untuk PIC).

Hapus/nonaktifkan memakai konfirmasi; pesan server ditampilkan apa adanya.

## 3. Keputusan

**D1 — Lokasi cabang dan warehouse BBM ikut di payload master.** GAS mengisi form
edit dari payload yang tidak membawa `lokasi` (cabang) dan `kode_cabang` (BBM,
SUPERADMIN), sehingga setiap edit di GAS mengosongkan kedua field itu. Usulan:
tambahkan ke payload (perubahan aditif) agar edit tidak menghapus data.

## 4. Di luar scope (dicatat untuk milestone berikutnya)

- Form Edit Transaksi GAS mengizinkan ubah tanggal, supir, KM, foto, jenis BBM,
  dan liter; halaman Edit aplikasi baru (M6) hanya pembayaran. API PUT sudah
  menerima field tersebut.
- Mengaktifkan kembali kendaraan/supir/BBM/warehouse yang Non-Aktif (GAS juga
  tidak menyediakan).

## 5. Verifikasi

Unit test helper form (validasi & payload per entitas); test payload master
untuk D1; uji tampilan headless (baca saja) per tab.
