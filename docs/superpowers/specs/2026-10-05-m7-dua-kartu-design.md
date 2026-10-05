# M7 — Pembayaran Dua Kartu pada Transaksi BBM (Design)

Tanggal: 2026-10-05
Status: disetujui 2026-10-05 (D1 dan D2 sesuai usulan)

## 1. Latar Belakang

Aplikasi baru diporting dari salinan lokal kode GAS per **2026-09-18**
(`D:\Monitoring Kendaraan Ops\src`, commit `7e7730d`). Setelah tanggal itu GAS
online mendapat fitur **pembayaran dengan kartu ke-2** (PAGE_VER `20260927v2`).
Data pertama yang memakainya bertanggal 2026-09-25, dan fitur masih dipakai
(terakhir 2026-10-05). Fitur ini tidak ada di schema, logika, maupun UI aplikasi
baru, sehingga migrasi data membuang kolomnya.

Sumber kebenaran port ini: kode GAS terbaru hasil `clasp clone` (tidak mengubah
folder GAS lokal), terutama `PaymentLogic.js`, `SpreadsheetOps.js`,
`FlazzOps.js`, `SummaryOps.js`, `Code.js`, `Index.html`, `js.html`.

## 2. Tujuan dan Batasan

**Masuk scope**
1. Simpan, tampilkan, edit, hapus, dan lepas-Flazz transaksi yang memakai grup
   pembayaran ke-2, dengan potong/kembalikan saldo per kartu yang benar.
2. Ringkasan bulanan, prefill, cek saldo, dan cek duplikat ikut menghitung grup-2.
3. Form Input Laporan dan Edit Transaksi mendukung grup-2.
4. Perbaikan GAS yang terkait edit: `perubahan_bar` dan `km_per_liter` dihitung
   ulang saat KM/bar/liter diedit.
5. Kolom kartu ke-2 pada `jalur_pengiriman` ikut disimpan (data saja).
6. Migrasi ulang agar data grup-2 yang tadi dibuang ikut masuk.

**Di luar scope (milestone berikutnya)**
- Modul Jalur Pengiriman (CRUD, dua slot kartu etoll, status SELESAI setelah
  semua kartu direkon). Aplikasi baru belum punya modul jalur sama sekali.
- Migrasi foto Drive → Storage.
- Recalc kolom `warning` tersimpan: aplikasi baru sudah menghitung peringatan
  selisih odometer secara dinamis saat membaca (`buildRecentList`), jadi tidak perlu.
- Bentrok ID `Flazz_Usage` (perbaikan GAS): aplikasi baru sudah memakai akhiran
  acak pada `genId`, tidak terdampak.

## 3. Model Data

Tambah ke `penggunaan_bbm` (aman, `add column if not exists`, ada default):

| Kolom | Tipe | Default | Arti |
|---|---|---|---|
| `flazz_card_id_2` | text | `''` | Kartu Flazz untuk BBM grup-2 |
| `biaya_bbm_2` | numeric | `0` | Nominal BBM grup-2 |
| `flazz_card_id_toll_2` | text | `''` | Kartu Flazz untuk tol grup-2 |
| `biaya_toll_2` | numeric | `0` | Nominal tol grup-2 |

Tambah ke `jalur_pengiriman`: `flazz_card_id_2 text default ''`,
`flazz_card_name_2 text default ''`.

**Tidak ada kolom metode untuk grup-2.** Metode diturunkan dari isinya (1:1 GAS
`group2FromRow`):
- kartu terisi → `FLAZZ`
- nominal > 0 tanpa kartu → `TUNAI` (tidak menyentuh saldo, tetap dihitung di total)
- keempat kolom kosong/0 → tidak ada grup-2 (baris lama tidak berubah perilakunya)

`biaya_bbm` dan `biaya_toll` tetap berarti **porsi grup-1**. Total transaksi =
grup-1 + grup-2.

## 4. Aturan Bisnis (port 1:1 GAS)

### 4.1 Logika murni (`src/logic/laporan.ts`)

- `group2FromRow(row)` dan `cardGroups(row)`: grup-1 selalu ada (memakai
  `resolveTollMethod`/`resolveTollCard` seperti sekarang), grup-2 hanya bila terisi.
  Menerima kunci kolom (`flazz_card_id_2`, …) maupun kunci state (`cardBbm2`,
  `biayaBbm2`, `cardTol2`, `biayaTol2`).
- `flazzBbmShare`, `flazzTolShare`, `flazzShareForCard`, `isFlazzRowForCard`,
  `flazzCardCharge`, `flazzEditDelta` dijumlahkan dari **semua grup**, sehingga
  satu transaksi dapat membebani dua kartu, dan grup-1 + grup-2 pada kartu yang
  sama teragregasi.
- `distinctFlazzCardsOf(state)` menggantikan `distinctFlazzCards(4 argumen)`.
- `rowBbmTotal(row)` = `biaya_bbm + biaya_bbm_2`; `rowTolTotal(row)` = `biaya_toll + biaya_toll_2`.
- `buildFlazzChecks` menambah cek `BBM kartu 2` dan `tol kartu 2`, keyed per
  kartu (teragregasi dengan grup-1 bila kartunya sama).

### 4.2 `POST /api/laporan`

Body menerima tambahan opsional `flazz_card_id_2`, `biaya_bbm_2`,
`flazz_card_id_toll_2`, `biaya_toll_2`.

1. Cek saldo memakai `buildFlazzChecks` yang sudah mencakup grup-2. Kartu grup-2
   yang tidak ditemukan → 409 `msgCardNotFound` dengan label `BBM kartu 2`/`tol kartu 2`.
2. Kunci duplikat ditambah `biaya_bbm_2` dan `biaya_toll_2`.
3. Insert menyimpan keempat kolom.
4. Potong saldo per kartu (sudah per-cek teragregasi), rollback seperti sekarang
   bila gagal.
5. Penyerahan kartu (`flazz_usage`) dibuat otomatis untuk **setiap** kartu
   terpakai, termasuk kartu grup-2.
6. Audit `biaya` = `rowBbmTotal`.

### 4.3 `PUT /api/laporan/:id`

1. Field grup-2 opsional; `undefined`/`null` → pertahankan nilai lama
   (`parseEditAmount` untuk nominal).
2. Bila kartu grup-2 berganti ke kartu lain: kartu wajib ada
   (`Kartu tujuan grup-2 tidak ditemukan.`) dan dapat diakses user (`assertFlazzAccess`).
   Tidak ada "wajib pilih kartu" untuk grup-2.
3. State lama/baru membawa grup-2; kartu terlibat = gabungan
   `distinctFlazzCardsOf(lama)` dan `(baru)`; cek saldo dan penyesuaian per kartu
   memakai `flazzEditDelta` yang sudah mencakup grup-2.
4. Patch menulis keempat kolom.
5. **Perbaikan GAS:** `perubahan_bar` dan `km_per_liter` dihitung ulang dengan
   rumus yang sama seperti saat simpan (`computeLiterKonsumsi`, `computeEfisiensi`),
   memakai nilai hasil edit.
6. Penyerahan otomatis untuk kartu grup-2 yang baru menjadi Flazz, seperti grup-1.
7. Audit sebelum/sesudah memuat field grup-2.

### 4.4 `DELETE /api/laporan/:id`

Kembalikan saldo ke **semua** kartu terlibat (grup-1 dan grup-2) dan kembalikan
penyerahannya. Sisanya tidak berubah.

### 4.5 `DELETE /api/laporan/:id/flazz` (lepas Flazz)

Perilaku M5 dipertahankan: yang dilepas hanya **BBM**, tol tidak diubah, dan
nominal BBM tetap tercatat sebagai tunai.

Diperluas ke grup-2 (lihat keputusan D1):
- Boleh dipakai bila BBM grup-1 **atau** BBM grup-2 memakai Flazz.
- Grup-1 BBM Flazz: perilaku sekarang.
- Grup-2 BBM Flazz: `flazz_card_id_2` dikosongkan, `biaya_bbm_2` dipertahankan
  (otomatis menjadi tunai), saldo `biaya_bbm_2` dikembalikan ke kartunya.
- Penyerahan kartu dikembalikan hanya bila kartu itu tidak lagi dipakai untuk tol
  di grup mana pun pada transaksi ini.

### 4.6 Pembacaan

- `GET /api/dashboard`: tiap item transaksi membawa keempat field grup-2 (kartu
  dikanonikkan seperti grup-1) plus `total_bbm` dan `total_toll`.
- Ringkasan bulanan (`groupMonthly`): `total_biaya_bbm` dan `total_toll` memakai
  `rowBbmTotal`/`rowTolTotal`.
- `GET /api/laporan/prefill`: membawa keempat field grup-2.
- Performa 7-trip tidak berubah (berbasis liter, bukan rupiah).

## 5. Frontend

**Input Laporan** (meniru GAS):
- Tombol `Tambah pengeluaran dengan kartu ke-2` membuka bagian berisi
  `Nominal BBM (kartu 2)`, `Kartu Flazz BBM (kartu 2)`, `Nominal Tol (kartu 2)`,
  `Kartu Flazz Tol (kartu 2)`. Pilihan kartu default `Tanpa kartu (tunai)`.
- Catatan: "Dipakai saat satu kartu tidak cukup. Bila nominal diisi tanpa kartu,
  biaya itu dicatat sebagai tunai."
- Prefill mengisi grup-2 bila transaksi terakhir kendaraan itu memakainya
  (bagian langsung terbuka).
- Validasi klien: nominal grup-2 angka ≥ 0. Aturan lain diserahkan ke server.

**Edit Transaksi:** bagian `Kartu ke-2 (opsional)` dengan empat field yang sama,
terisi dari transaksi.

**Tabel Transaksi:** kolom biaya BBM dan tol menampilkan total (`total_bbm`,
`total_toll`); baris yang memakai grup-2 diberi penanda `2 kartu`.

## 6. Migrasi

- Terapkan perubahan schema ke Supabase lewat `scripts/apply-schema.mjs`
  (idempotent, `add column if not exists`).
- `scripts/migrate-sheets.mjs` tidak perlu diubah: kolom yang kini ada di schema
  otomatis ikut. Jalankan dry-run (kolom dibuang harus 0), lalu `--apply`.
  Upsert memperbarui baris yang sudah ada tanpa menggandakan.

## 7. Keputusan yang Perlu Disetujui

**D1 — Lepas Flazz pada grup-2.** GAS mengosongkan kartu *dan* menolkan nominal
grup-2, serta ikut melepas tol. Aplikasi baru (keputusan M5) hanya melepas BBM
dan mempertahankan nominal sebagai tunai.
Usulan: ikuti M5 (bagian 4.5) agar perilaku grup-1 dan grup-2 konsisten.

**D2 — Kolom jalur kartu ke-2.** Usulan: tambahkan kolomnya sekarang (data saja)
agar migrasi ulang tidak kehilangan informasi kartu pada 2 jalur; logikanya
menyusul di modul jalur.

## 8. Verifikasi

- Unit test logika murni: `cardGroups`, share per kartu, agregasi kartu sama di
  grup-1 dan grup-2, `flazzEditDelta` saat kartu grup-2 berganti, total bulanan,
  kunci duplikat.
- Route test (pola test M3/M5): simpan dua kartu memotong dua saldo; saldo kurang
  pada kartu 2 → 409 tanpa potong apa pun; edit memindah kartu grup-2 →
  kartu lama +, kartu baru −; hapus mengembalikan dua saldo; lepas Flazz grup-2.
- Regresi: seluruh test lama tetap hijau (transaksi tanpa grup-2 tidak berubah).
- Setelah migrasi ulang: `TRX-1790403411499` memiliki `biaya_bbm_2 = 500000`
  dan kartu ke-2 terisi; ringkasan September cabangnya bertambah Rp500.000.
- Manual di produksi: input dua kartu, edit, hapus; cek saldo kedua kartu.
