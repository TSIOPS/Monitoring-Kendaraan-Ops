# Kas Kecil — Spesifikasi

Menyatukan pencatatan kas kecil (Excel `kas <cabang>.xlsb`) ke aplikasi, lengkap dengan pembanding otomatis terhadap
laporan BBM/tol/top up Flazz. **Tidak boleh di-deploy** sampai pemilik repo menyatakan siap (kerja & commit boleh,
`wrangler deploy` jangan). Sheet Etoll di Excel diabaikan (sudah diakomodir modul Flazz). Kas Penjualan di luar cakupan.

## Keputusan pemilik (2026-10-23)
1. Yang mengisi: PIC CABANG yang sudah ada (tanpa peran baru). MANAGEMENT hanya baca; SUPERADMIN semua cabang + master jenis.
2. Semua cabang termasuk WHP Bandung dan WHP Tasikmalaya.
3. Semua tahap dikerjakan: input & penyelesaian, pembanding, summary/Excel/cetak, impor data lama.
4. Format nomor sama dengan Excel. 5. Cetak mengikuti format Excel.

## Alur (dari Excel Karawang)
- **Kas Keluar (KK):** tanggal+jam, No KK, No Referensi (BO/BP), nama penerima, admin (pencatat), jenis transaksi (+kode akun),
  jumlah (opsional dirinci pecahan), keterangan "Untuk Penggunaan". Status **Open**.
- **Penyelesaian (Kas Masuk, KM):** sisa uang kembali (0…nominal KK, opsional pecahan) → KK jadi **Closed**.
  Penggunaan sebenarnya = nominal KK − uang kembali.
- Jenis tertentu (`tanpa_penyelesaian`: Setoran Tunai Kas Kecil, Closing Kas, Tukar Denom) langsung Closed.
- **Tambah Saldo:** Kas Masuk tanpa KK (menambah saldo kas kecil).
- **Saldo** = saldo awal + Σ KM − Σ KK (sejak tanggal saldo awal). Saldo awal per cabang (tanggal + jumlah), diatur SUPERADMIN.
- **Laporan harian:** saldo awal hari, daftar transaksi (No, tgl, KK, ref, KM, nama, jenis, debit=KM, kredit=KK, saldo, status),
  ringkasan (transaksi hari ini, selesai, masuk, belum selesai, saldo akhir).
- **Summary bulanan:** matriks tanggal × jenis, nilai = Σ KK − Σ KM (pengeluaran bersih) per tanggal KK, baris Total.
- **BA Cash Opname:** hitung fisik per pecahan (13 baris: 100.000…50) vs nilai buku (saldo akhir hari), selisih, nomor
  `CO.{seq3}/TSI-OPR/{KODE}/{BULAN ROMAWI}/{TAHUN}` (seq per cabang per tahun).

## Saldo per pecahan, setoran Senin & tambah saldo (2026-10-23)
- Uang SELALU dicatat per pecahan (12 baris seperti Excel; jumlah = total pecahan) untuk kas keluar, uang kembali, tambah saldo, setoran. Saldo per pecahan = saldo awal (pecahan) + KM − KK; ditampilkan sebagai tabel di Laporan Harian (Saldo Awal | Masuk | Keluar | Saldo Akhir | Nilai) dan di form kas keluar (kolom Tersedia; input melebihi tersedia diberi peringatan, tidak memblokir).
- **Setoran Tunai Kas Kecil** hanya lewat tombol "Setor Seluruh Saldo ke Bank" (POST /api/kaskecil/setoran): mengeluarkan SELURUH saldo sesuai pecahan yang ada (tanpa sisa), foto bukti setor bank wajib, hanya hari ini, ditolak bila rincian pecahan tidak sinkron dengan saldo uang.
- **Tambah Saldo** per pecahan yang dimasukkan. `dana_mingguan` per warehouse (diatur SUPERADMIN) hanya acuan: form menampilkan lebih/kurang dari dana tetap Senin, tidak membatasi.
- Saldo awal menyimpan pecahan; impor Excel menurunkannya dari kolom Saldo sheet Input Kas Kecil.

## Penomoran (per cabang, per bulan, urut naik)
- `KK-{WHO|WHP}-{KODE}-{YYYYMMDD}{NNNN}`; `KM-…` sama; referensi `BO-…`/`BP-…` (prefiks dari jenis; counter terpisah BO/BP).
- **BP** = nomor dari form Excel WHO (surat jalan: isi bensin, top up etoll, parkir delivery) — PIC hanya mengisi NOMOR URUT (1–9999, wajib); awalan BP-{WHO|WHP}-{kode}-{tanggal YYYYMMDD} dibuat otomatis (hasil mis. BP-WHO-BDG-202610280012), sehingga beberapa pengeluaran satu driver di hari yang sama dengan urut sama memperoleh nomor BP yang sama; saran nomor urut driver itu (14 hari) muncul di form. Jenis ber-BP: Pengiriman via Pihak ketiga, Bensin Delivery, Parkir Untuk Delivery, Uang Jalan Distribusi. **Pengisian ETOLL tetap BO** (keputusan pemilik 2026-10-24). **BO** = otomatis, baru untuk setiap pengeluaran (tidak berhubungan dengan BP). Jenis lain tanpa referensi.
- NNNN = urutan di bulan itu (bukan per hari), sesuai Excel. WHO/WHP dari awalan nama cabang (bawaan WHO).

## Pembanding (harian, per warehouse)
| Aplikasi | Kas kecil (bersih) |
|---|---|
| BBM tunai (rekap pengeluaran) | Biaya Bensin Delivery |
| Top up Flazz | Biaya Pengisian ETOLL |
| Tol tunai | Biaya Uang Muka Delivery (indikatif) |
Selisih ≠ 0 diberi tanda. **Pengecualian (2026-10-23):** WHP Bandung (GDGBDG), WHO Bandung (BDG), WHO Cibaduyut (CBY) top up Flazz dibayar langsung Finance → baris top up tampil "Via Finance", tidak dibandingkan.

## Data (db/kas-kecil.sql, RLS aktif)
`kas_jenis`, `kas_keluar`, `kas_masuk`, `kas_saldo_awal`, `kas_opname`. Seed jenis dari DbPengeluaran (union semua cabang).

## Hak akses
PIC: baca/tulis cabangnya. MANAGEMENT: baca semua. SUPERADMIN: semua + master jenis + saldo awal. Hapus = soft delete
(`is_deleted='1'`); KK yang sudah Closed tidak bisa dihapus/diubah tanpa membatalkan penyelesaiannya dulu.

## Cetak
Bukti Kas Keluar, Penyelesaian Kas Kecil (dengan terbilang rupiah), Laporan Harian, BA Cash Opname — halaman HTML ber-CSS cetak.
