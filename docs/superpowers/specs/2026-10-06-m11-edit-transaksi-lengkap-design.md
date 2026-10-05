# M11 — Edit Transaksi Lengkap (Design)

Tanggal: 2026-10-06
Status: disetujui ("iya", 2026-10-06)

## Latar Belakang

Halaman Edit (M6) hanya mengubah pembayaran. GAS (alur edit utama di form Input,
`js.html` ~baris 1370) mengirim: `tanggal`, `nama_supir`, `km_awal`, `km_akhir`,
`bar_awal`, `bar_akhir`, `liter_bbm`, pembayaran grup-1 dan grup-2, serta foto
odometer baru (opsional). `PUT /api/laporan/:id` sudah menerima semua field itu
dengan aturan setara GAS (`editDailyTransactionUnlocked`): selisih saldo Flazz
per kartu, ganti foto (foto lama dihapus), tautan jalur dilepas lalu ditautkan
ulang bila tanggal/supir berubah, dan (M7) `perubahan_bar`/`km_per_liter`
dihitung ulang. **Tidak ada perubahan server.**

## Halaman Edit (`#/edit/:id`)

- Kendaraan tetap terkunci (GAS juga tidak mengubah kendaraan).
- Field yang bisa diubah: tanggal, supir (dari master supir cabang kendaraan,
  nilai lama tetap ada), KM awal/akhir, bar awal/akhir (terkunci 100 untuk
  kendaraan `ANALOG_JARUM`), liter BBM, pembayaran BBM/tol, kartu ke-2, foto
  odometer awal/akhir (pratinjau foto lama; kosong = tidak diganti).
- Peringatan: mengubah tanggal atau supir memindahkan tautan jalur.
- Validasi klien: KM/bar/liter angka ≥ 0, KM akhir ≥ KM awal.

**Satu perbedaan sengaja:** GAS selalu mengirim KM sehingga server menandai
`km_sumber = AKTUAL` pada setiap edit, termasuk transaksi `ESTIMASI` yang KM-nya
tidak disentuh. Halaman baru mengirim KM **hanya bila nilainya berubah**.

## Verifikasi

Unit test penyusun body edit (diff KM, tanggal dari format tampilan, field
pembayaran); uji tampilan headless (baca saja).
