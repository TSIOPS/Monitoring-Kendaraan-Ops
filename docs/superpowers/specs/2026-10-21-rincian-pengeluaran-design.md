# Rincian Pengeluaran per Nota + Pengingat Unduh Excel — Desain

Tanggal: 2026-10-21 · Status: disetujui pemilik repo (brainstorming 2026-10-20/21)

## Latar belakang

Saat ini satu laporan pengiriman (`penggunaan_bbm`) hanya menyimpan **total** BBM dan tol dalam
dua slot pembayaran per jenis (slot 1: `metode_pembayaran`/`flazz_card_id`/`biaya_bbm`,
`metode_toll`/`flazz_card_id_toll`/`biaya_toll`; slot 2: `flazz_card_id_2`/`biaya_bbm_2`,
`flazz_card_id_toll_2`/`biaya_toll_2`). Dalam satu pengiriman supir bisa beli BBM dan bayar tol
berkali-kali; admin cabang harus menjumlahkan sendiri dan rinciannya hilang.

Tujuan:
1. Admin cabang mencatat **setiap nota** (jenis, nominal, dibayar pakai apa, keterangan).
2. Bukti foto tetap **2 foto gabungan** (struk BBM, bukti tol) — tidak foto per nota.
3. Setelah semua tugas hari itu selesai (laporan + rekon), admin **diingatkan terus** untuk
   mengunduh Excel rekap bulan berjalan dan mengirimkannya sendiri ke `ceocrew01@gmail.com`.

## Keputusan utama

| # | Keputusan |
|---|---|
| D1 | Rincian disimpan sebagai kolom JSON `rincian` di `penggunaan_bbm` (pendekatan A). Server **menjumlahkan** rincian ke kolom total & slot yang sudah ada. Rekon, ledger/saldo Flazz, Perbandingan, Dashboard, backup **tidak diubah**. |
| D2 | Rincian **wajib** untuk laporan baru: isian total BBM/tol & kartu-2 di form diganti tabel rincian; total dihitung otomatis. Laporan tanpa pengeluaran boleh rincian kosong. |
| D3 | Per jenis (BBM / Tol) **maksimal 2 cara bayar** dalam satu laporan (batas slot). Lebih dari itu ditolak dengan pesan jelas. |
| D4 | Kolom per baris: Jenis (BBM/Tol), Nominal, Dibayar (kartu etoll jalur atau Tunai), Keterangan (opsional, ≤ 100 karakter). Maks 30 baris. |
| D5 | Foto tetap 2 slot (`foto_struk_bbm`, `foto_struk_toll`), wajib bila ada baris jenis tsb. |
| D6 | Laporan lama (tanpa `rincian`) tidak dimigrasi massal; dibaca sebagai baris turunan dari slot. |
| D7 | Excel Rekap: sheet **Detail** jadi per nota + kolom **Keterangan**; sheet lain tetap. |
| D8 | Pengingat unduh Excel: pop-up + banner terus sampai tombol **Unduh Excel** (dari pengingat) ditekan; tidak memblokir pekerjaan. Hanya tombol unduh — tidak ada tombol salin/buka email. |

## 1. Data

### Kolom baru
`db/rincian-pengeluaran.sql` (idempoten, dijalankan ke Supabase **sebelum** deploy; juga ditambahkan
ke `db/schema.sql`):

```sql
alter table penggunaan_bbm add column if not exists rincian jsonb not null default '[]'::jsonb;
```

Bentuk item:
```json
{ "jenis": "BBM" | "TOL", "nominal": 200000, "kartu": "<card_id>" | "", "keterangan": "SPBU Cikampek" }
```
`kartu` kosong = Tunai. Urutan array = urutan input.

### Penjumlahan rincian → slot (fungsi murni, `src/logic/rincian.ts`)
`rincianKeSlot(rincian)` per jenis:
1. Kelompokkan baris per sumber bayar (kartu kanonis via `canonicalCardId`, atau `TUNAI`), urut
   kemunculan pertama; jumlahkan nominal.
2. Bila > 2 sumber → galat `MSG_RINCIAN_MAKS_2` (D3).
3. Isi slot:
   - BBM: sumber pertama → slot 1 (`metode_pembayaran` FLAZZ/TUNAI, `flazz_card_id`, `biaya_bbm`);
     sumber kedua → slot 2 (`flazz_card_id_2` = kartu atau '' bila tunai, `biaya_bbm_2`).
     Bila sumber kedua adalah kartu dan sumber pertama tunai, tukar urutan agar kartu di slot 1
     (slot 2 tanpa kartu = tunai, sesuai semantik M7).
   - Tol: sama dengan `metode_toll`/`flazz_card_id_toll`/`biaya_toll` dan
     `flazz_card_id_toll_2`/`biaya_toll_2`.
4. Hasilnya dimasukkan ke payload yang sama seperti hari ini, sehingga seluruh validasi lama
   (`buildFlazzChecks`, saldo cukup, `cekKartuJalur`, `cekBuktiWajib`, delta edit, kunci rekon)
   berjalan tanpa perubahan.

Kebalikan untuk laporan lama: `slotKeRincian(row)` → baris turunan dari `cardGroups(row)`
(1 baris per slot bernominal > 0, keterangan kosong). Dipakai Edit, History, dan Rekap.

### Validasi server (`POST /api/laporan`, `PUT /api/laporan/:id`)
- `rincian` harus array ≤ 30 item; `jenis` ∈ {BBM, TOL}; `nominal` angka > 0 (dibulatkan ke rupiah);
  `keterangan` string dipangkas, ≤ 100 karakter; `kartu` string.
- Bila `rincian` dikirim, nilai total/slot dari klien **diabaikan**; slot selalu dari `rincianKeSlot`.
- `liter_bbm` tetap dihitung dari total BBM ÷ harga (seperti sekarang).
- PUT tanpa field `rincian` (klien lama) tetap memakai jalur lama (kompatibel selama transisi cache SW).

### Lepas Flazz (`DELETE /api/laporan/:id/flazz`)
Selain mengubah slot ke tunai seperti sekarang, baris rincian BBM dengan kartu yang dilepas diubah
`kartu: ''` (Tunai). Nominal & keterangan tetap.

## 2. UI

### Input Laporan & Edit Laporan (`static/js/pages/input.js`, `edit.js`)
- Bagian "Pengeluaran" diganti komponen tabel rincian (modul baru `static/js/rincian.js`):
  baris = [Jenis ▾][Nominal Rp][Dibayar ▾][Keterangan][hapus], tombol **+ Tambah baris**.
- Opsi "Dibayar" = kartu dari jalur terpilih (`kartuJalur`) + **Tunai**.
- Ringkasan langsung di bawah tabel: Total BBM, Liter (otomatis), Total Tol, pemakaian per kartu
  beserta saldo.
- Validasi klien = validasi server (nominal > 0, maks 2 cara bayar per jenis, maks 30 baris, foto
  wajib bila ada baris jenis tsb). Helper murni ber-`export` agar dites di `node`.
- Jenis BBM (harga per liter) tetap dipilih sekali per laporan.
- Edit laporan lama: tabel diisi dari `slotKeRincian`. Laporan yang kartunya sudah direkon: server
  menolak bila total per kartu berubah (aturan lama); mengubah keterangan / memecah baris dengan
  total kartu sama tetap boleh.
- DOM dibangun dengan `el()` (tanpa `innerHTML`).

### History Laporan (`static/js/pages/transaksi.js`)
Baris laporan mendapat tombol kecil **Rincian (n)** yang membuka daftar nota (jenis, nominal,
dibayar, keterangan). Laporan lama menampilkan baris turunan dengan label "(total, tanpa rincian)".

### Rekap Pengeluaran (`src/logic/rekap.ts`, `static/js/pages/rekap.js`)
- `rekapPengeluaran` memecah laporan per item `rincian` (laporan lama: per slot seperti sekarang).
  `RekapLine` mendapat field `keterangan`.
- Tabel detail di layar + sheet Excel **Detail** mendapat kolom **Keterangan** (setelah Nominal):
  `No, Tanggal, Warehouse, Kendaraan, Supir, Jenis, Metode, Kartu Etoll, Nominal (Rp), Keterangan, Sumber, Referensi`.
  Laporan lama: "(total, tanpa rincian)"; tol manual Flazz: `notes`-nya.
- Ringkasan / Per Kartu Etoll / Per Kendaraan: angka tidak berubah; "Jumlah pembayaran" kini
  menghitung jumlah nota.
- Filter tanggal menu Rekap tetap (default tanggal 1 bulan berjalan s.d. hari ini).

## 3. Pengingat Unduh Excel setelah rekon

### Kapan aktif
Untuk user **PIC CABANG**, pada tanggal hari ini (WIB): ada ≥ 1 jalur hari ini di cabangnya,
**semua** item tugas hari ini selesai (tidak ada `LAPORAN` / `REKONSILIASI` tertunda — memakai
`ringkasTugas` yang sudah ada), dan cabang belum mengunduh Excel hari ini.

### Server
- `ringkasTugas`/`tugasUntuk` menambah field `unduh_excel: boolean` (perlu unduh).
- Status unduh disimpan di KV: `unduh-rekap:<kode_cabang>:<YYYY-MM-DD>` (TTL 8 hari).
- `POST /api/rekap/unduh-harian` (PIC CABANG, cabang sendiri dari sesi) → set KV + Audit Log
  (modul `REKAP`, aksi `UNDUH_HARIAN`). MANAGEMENT ditolak oleh penjaga yang ada.

### Klien
- Setelah rekon disimpan (`flazz.js`) dan di banner tugas (`app.js`), bila `unduh_excel` true tampil
  pop-up/banner:
  > ✅ Tugas hari ini selesai. Unduh Excel rekap pengeluaran bulan ini, lalu kirim ke
  > **ceocrew01@gmail.com** bersama Excel laporan lainnya.
  > **[⬇ Unduh Excel]**
- Tombol mengunduh Rekap Pengeluaran cabang tsb dari tanggal 1 bulan berjalan s.d. hari ini
  (pakai `susunExcel`/`bukuExcel` yang ada), nama file sama dengan format menu Rekap yang sudah ada:
  `rekap-pengeluaran-<dari>_<sampai>-<kode_cabang>.xlsx`
  (mis. `rekap-pengeluaran-2026-10-01_2026-10-21-CKR.xlsx`), lalu memanggil `POST /api/rekap/unduh-harian`;
  banner hilang setelah sukses.
- Banner merah tetap tampil di Dashboard sampai diunduh. Pop-up tidak memblokir menu lain.
- Alamat email = konstanta `EMAIL_KIRIM_REKAP` di `static/js/` (ubah lewat kode bila perlu).
- Unduhan dari menu Rekap biasa **tidak** menghapus pengingat.

## 4. Tes

- `tests/logic/rincian.test.ts`: `rincianKeSlot` (1 sumber, 2 sumber, tunai+kartu ditukar, >2 sumber
  ditolak, kartu kanonis sama digabung), `slotKeRincian` (laporan lama 1/2 slot, nominal 0 dilewati),
  validasi item (nominal ≤ 0, keterangan > 100, > 30 baris).
- Tes route laporan: POST dengan rincian mengisi slot & memotong saldo benar; PUT ubah keterangan
  saja pada laporan terekon diterima; PUT ubah total kartu terekon ditolak; Lepas Flazz mengubah
  rincian.
- `tests/logic/rekap*.test.ts`: laporan berincian menghasilkan 1 line per item dengan keterangan;
  laporan lama tidak berubah.
- `tests/frontend/rincian-helpers.test.ts`: ringkasan total/per kartu, validasi klien.
- `tests/frontend/rekap-helpers` (Excel): kolom Keterangan di sheet Detail.
- Tugas: `unduh_excel` true/false sesuai kondisi; route `unduh-harian` set KV + audit, MANAGEMENT 403.

## 5. Di luar cakupan
- Foto per nota, jam transaksi, OCR/screenshot riwayat kartu Flazz.
- Kirim email otomatis dari server.
- Perubahan rekon, Perbandingan, Dashboard, menu Flazz → Tol.

## 6. Rilis
1. Jalankan `db/rincian-pengeluaran.sql` ke Supabase.
2. Deploy Worker (`npm run deploy`, dari komputer kantor).
3. Sosialisasi ke PIC: isi per nota, foto tetap gabungan, unduh & kirim Excel setelah rekon.
