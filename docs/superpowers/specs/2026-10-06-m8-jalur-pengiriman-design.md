# M8 — Modul Jalur Pengiriman (Design)

Tanggal: 2026-10-06
Status: draft, menunggu review

## 1. Latar Belakang

Setiap laporan BBM wajib menempel ke jalur pengiriman berstatus `BELUM_DIISI`
(gate di `POST /api/laporan`). Aplikasi baru belum bisa membuat, mengubah, atau
menghapus jalur, sehingga input laporan harian belum dapat dipakai. Status jalur
juga belum naik ke `SELESAI` saat kartu etoll direkonsiliasi.

Sumber port: kode GAS terbaru (`clasp clone`): `JalurOps.js`, `JalurStatus.js`,
`FlazzOps.js` (rekon → status jalur), `JalurPages.html`, `JalurScript.html`,
`js.html` (Input Laporan memakai daftar jalur).

## 2. Scope

**Masuk**
1. API jalur: daftar per rentang tanggal, daftar supir siap-lapor per tanggal,
   buat (banyak baris sekaligus), ubah, hapus. Dua slot kartu etoll.
2. Gate "jalur baru diblokir" bila jalur sebelumnya untuk kendaraan yang sama belum tuntas.
3. Penyerahan kartu etoll ke supir saat jalur dibuat/diubah, pengembalian saat
   kartu dilepas atau jalur dihapus.
4. Status jalur dihitung ulang setelah rekonsiliasi dibuat, diubah, atau dihapus
   (`SELESAI` hanya bila **semua** kartu jalur sudah direkon).
5. Halaman: Daftar Jalur, Buat Jalur, Ringkasan Jalur (bisa dicetak), Edit Jalur.
6. Input Laporan: supir dipilih dari jalur `BELUM_DIISI` pada tanggal itu;
   kendaraan dan kartu tol terisi otomatis dari jalur.

**Di luar**
- `backfillJalurStatus` (alat perbaikan massal SUPERADMIN). Status hasil migrasi
  sudah berasal dari GAS; bisa ditambah kemudian bila perlu.
- Tombol "Screenshot" (html2canvas). Diganti cetak browser (lihat D3).

## 3. Data

Tabel `jalur_pengiriman` sudah ada (termasuk `flazz_card_id_2`,
`flazz_card_name_2` dari M7). **Tidak ada perubahan schema.**

Status: `BELUM_DIISI` → `SUDAH_LAPORAN` (laporan tersimpan) → `SELESAI`
(semua kartu direkon pada/ setelah tanggal jalur). Hapus jalur = hapus baris
(hard delete, sama seperti GAS).

## 4. API

Semua endpoint butuh login. Akses = SUPERADMIN atau PIC CABANG; PIC tanpa
cabang ditolak menulis. PIC hanya melihat/mengelola jalur, kendaraan, supir,
dan kartu cabangnya sendiri. SUPERADMIN boleh memfilter `?cabang=`.

### 4.1 `GET /api/jalur?tanggal=YYYY-MM-DD&tanggal_akhir=YYYY-MM-DD&cabang=`
Daftar jalur dalam rentang (tanpa `tanggal_akhir` = satu hari), tanpa yang
`is_deleted = 1`. Tiap item membawa data jalur + kartu 1/2 + status +
`laporan_id`, serta sisa hari & status **pajak tahunan, pajak 5 tahunan, KIR**
kendaraan (`AMAN` > 60 hari, `WASPADA` ≤ 60, `KRITIS` ≤ 30, `LEWAT` ≤ 0,
`TIDAK_ADA` bila kosong; dihitung terhadap tanggal hari ini WIB).
Urutan: tanggal terbaru, lalu Mobil sebelum jenis lain, lalu nama driver.
Respons juga `created_by` (nama pembuat item pertama).

### 4.2 `GET /api/jalur/drivers?tanggal=YYYY-MM-DD&cabang=`
Supir yang punya jalur `BELUM_DIISI` pada tanggal itu (unik per nama+kendaraan):
`nama_driver, driver_id, vehicle_id, plat_nomor, nama_kendaraan, flazz_card_id,
flazz_card_name, flazz_card_id_2, flazz_card_name_2`. Dipakai form Input Laporan.

### 4.3 `POST /api/jalur`
Body `{ tanggal, rows: [{ driver_id, driver2_id?, vehicle_id, rute_tujuan,
etoll_card_id?, etoll_card_id_2? }] }`. Baris tanpa driver/kendaraan/rute dilewati;
minimal satu baris wajib ada.

1. **Gate:** untuk tiap kendaraan, ambil jalur **terakhir sebelum** tanggal input.
   Bila statusnya belum final, tolak seluruh simpan:
   `Jalur baru diblokir: Kendaraan <plat> (jalur <tgl>, status <st>) masih belum
   selesai. Harap <rekonsiliasi saldo flazz | input laporan> terlebih dahulu.`
   Status final = `SELESAI` bila jalur itu punya kartu, selain itu `SUDAH_LAPORAN` (lihat D1).
2. Validasi per baris: supir/kendaraan/kartu wajib ada dan (untuk PIC) milik
   cabangnya; kartu 2 harus berbeda dari kartu 1
   (`Kartu etoll ke-2 harus berbeda dari kartu etoll ke-1.`).
3. Simpan: `id = JLR-<ms>-<n>`, nama driver/kendaraan diambil dari master,
   nama kartu dari master kartu (D2), `kode_cabang` = cabang kendaraan untuk
   SUPERADMIN, cabang user untuk PIC; status `BELUM_DIISI`.
4. Penyerahan: tiap kartu (slot 1 dan 2) diserahkan ke driver
   (`flazz_usage`, ref `JALUR`). Bila kartu masih tercatat dipegang, tetap
   disimpan dan respons membawa `warnings`:
   `Kartu etoll "<nama>" masih dipakai (belum dikembalikan) untuk <driver>. Proses admin sebelumnya belum selesai.`
5. Audit `CREATE jalur`. Respons `{ msg: '<n> jadwal pengiriman berhasil disimpan.', saved, warnings? }`.

### 4.4 `PUT /api/jalur/:id`
Field opsional: `tanggal, rute_tujuan, driver_id, driver2_id, vehicle_id,
etoll_card_id, etoll_card_id_2` (tidak dikirim = tidak diubah).
- Validasi referensi sebelum menulis (`Driver utama tidak ditemukan.`, dst.).
- Bila kendaraan diganti, kendaraan baru harus lolos gate 4.3-1
  (pesan ditambah `sebelum memindahkan jalur ini ke kendaraan tersebut.`).
- Sinkron kartu **per himpunan**, bukan per slot: kartu lama yang tidak lagi
  dipakai di slot mana pun dikembalikan; kartu baru yang belum ada diserahkan.
- Audit `EDIT jalur`. Respons `{ msg: 'Jadwal berhasil diperbarui.' }`.

### 4.5 `DELETE /api/jalur/:id`
Semua kartu jalur dikembalikan, baris dihapus, audit `DELETE jalur`.
Respons `{ msg: 'Jadwal berhasil dihapus.' }`.

### 4.6 Rekonsiliasi → status jalur
Setelah rekonsiliasi kartu **dibuat, diubah, atau dihapus**: cari jalur
**terbaru** (tanggal terbesar) yang memakai kartu itu di slot 1 atau 2, lalu
hitung ulang statusnya dengan `jalurFinalStatus` (port `JalurStatus.js`):
- tanpa laporan → `BELUM_DIISI`
- ada laporan, tanpa kartu → `SUDAH_LAPORAN`
- ada laporan, semua kartu punya rekon (tidak terhapus) bertanggal ≥ tanggal jalur → `SELESAI`
- selainnya → `SUDAH_LAPORAN`

Status hanya ditulis bila berubah.

### 4.7 Pengembalian kartu
GAS `returnFlazzUsage(kartu)` mengembalikan penyerahan kartu yang **sedang aktif**,
apa pun asalnya. Ditambahkan `returnActiveUsageForCard(cardId)` di repo Flazz
dengan semantik itu, dipakai oleh 4.4 dan 4.5.

## 5. Frontend

Menu baru **Jalur** (Daftar, Buat, Ringkasan).

- **Daftar Jalur** (`#/jalur`): filter rentang tanggal (+ warehouse untuk
  SUPERADMIN); tabel Tanggal, Kendaraan, Driver, Rute, Etoll (1/2), Status,
  Pajak; aksi Edit dan Hapus (konfirmasi).
- **Buat Jalur** (`#/jalur/buat`): tanggal + baris dinamis (Tambah Baris):
  Driver 1, Driver 2 (opsional), Kendaraan, Rute, Kartu etoll 1, Kartu etoll 2
  (opsional). Peringatan `warnings` ditampilkan setelah simpan.
- **Edit Jalur** (`#/jalur/edit/:id`): field yang sama untuk satu jalur.
- **Ringkasan Jalur** (`#/jalur/ringkasan`): satu tanggal; kolom Kendaraan,
  Driver 1, Driver 2, Rute, Etoll, Pajak tahunan, Pajak 5 tahunan, KIR; tombol Cetak.
- **Input Laporan:** setelah tanggal dipilih, dropdown Supir diisi dari
  `GET /api/jalur/drivers`. Memilih supir mengisi kendaraan; kartu jalur slot 1
  mengisi kartu tol (metode tol Flazz); kartu slot 2 menyiapkan kartu ke-2 (BBM
  dan tol) dan membuka bagian kartu ke-2 tanpa mengubah nominal. Bila tidak ada
  jalur: pesan "Belum ada jalur BELUM DIISI pada tanggal ini" + tautan Buat Jalur.

## 6. Keputusan yang Perlu Disetujui

**D1 — Status final pada gate jalur baru.** GAS menilai "punya kartu" hanya dari
slot 1. Jalur yang kartunya hanya di slot 2 (ada 1 di data) dianggap tuntas di
`SUDAH_LAPORAN` oleh gate, padahal status sebenarnya baru `SELESAI` setelah rekon.
Usulan: pakai slot 1 **atau** slot 2, konsisten dengan `jalurFinalStatus`.

**D2 — Nama kartu.** GAS menyimpan nama kartu yang dikirim browser. Usulan: ambil
dari master kartu di server agar tidak bisa salah/ dipalsukan.

**D3 — Screenshot.** Usulan: tidak diporting; Ringkasan memakai cetak browser
(bisa "Simpan sebagai PDF").

**D4 — Supir di Input Laporan.** Usulan: ikuti GAS, supir hanya bisa dipilih dari
jalur `BELUM_DIISI` (laporan tanpa jalur toh ditolak server).

## 7. Verifikasi

- Unit test: `jalurFinalStatus`, status pajak, gate blocker, urutan daftar,
  pemilihan jalur terbaru per kartu, sinkron kartu per himpunan.
- Route test: buat (gate, validasi kartu sama, cabang PIC, handoff + warnings),
  ubah (pindah kendaraan ter-gate, kartu pindah slot tidak dikembalikan),
  hapus (kartu kembali), daftar & drivers (scope cabang, hanya `BELUM_DIISI`),
  rekon create/update/delete menaikkan/menurunkan status jalur 2 kartu.
- Regresi seluruh test lama.
- Manual: buat jalur → input laporan memilih supir dari jalur → jalur
  `SUDAH_LAPORAN` → rekon kartu → `SELESAI`.
