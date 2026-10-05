# M9 — Halaman Flazz + Rekonsiliasi Model GAS (Design)

Tanggal: 2026-10-06
Status: draft, menunggu review

## 1. Latar Belakang

M5 membangun API Flazz (kartu, top up, tol, rekonsiliasi, adjust) tanpa halaman.
Saat menyiapkan halaman ditemukan bahwa **rekonsiliasi M5 tidak mengikuti GAS**
(sudah begitu sejak versi GAS 2026-09-18):

| | GAS | M5 |
|---|---|---|
| Alur | Satu langkah "Pengembalian & Rekonsiliasi" | Snapshot, lalu Apply/Ignore |
| Saldo sistem | Dihitung server dari periode penyerahan | Diketik di body |
| Efek | Saldo kartu, kartu TERSEDIA, penyerahan DIKEMBALIKAN | Hanya saldo saat Apply |
| Syarat | Laporan berfoto KM pada periode kartu | Tidak ada |
| Hapus | SUPERADMIN, rekon terakhir, membalik semua efek | Soft-delete saja |
| Status | `SESUAI` / `PERLU_PEMERIKSAAN` | `UNRECONCILED` / `APPLIED` / `IGNORED` |

380 rekon hasil migrasi berstatus `SESUAI`/`PERLU_PEMERIKSAAN`. **Keputusan
pengguna (2026-10-06): port model GAS 1:1.**

Sumber port: GAS terbaru `FlazzOps.js` (`computeFlazzLedger`,
`hasCompliantFlazzLaporan`, `jalurTerkaitSudahDilaporkan`, `checkReconGate`,
`saveFlazzReconUnlocked`, `deleteFlazzReconUnlocked`, `getFlazzDashboardData`),
`FlazzPages.html`, `FlazzScript.html`.

## 2. Scope

**Masuk**
1. API rekonsiliasi model GAS (preview saldo sistem, cek syarat, simpan, hapus).
2. API data dashboard Flazz (kartu + riwayat) untuk halaman.
3. Halaman: List Flazz (+ detail kartu yang bisa dicetak), Top Up,
   Pengembalian & Rekonsiliasi, Riwayat (top up, tol, BBM Flazz, penyerahan, rekon).
4. Edit/hapus top up dan tol dari Riwayat (API M5 yang sudah ada).

**Di luar**
- Form tambah/ubah/nonaktifkan kartu: tetap di halaman **Data Master** (M10),
  seperti letaknya di GAS (D3).
- Penyerahan kartu manual (`saveFlazzUsage`, SUPERADMIN): tidak ada di UI GAS.

## 3. Ledger dan saldo sistem (port `computeFlazzLedger`)

Untuk kartu `K`, cari penyerahan **aktif terbaru** (`flazz_usage` status
`DIBERIKAN`, urut `used_at`). `since` = `used_at` (fallback `date`).

Dalam periode (`waktu > since`; tanpa penyerahan aktif = semua waktu):
- `total_topup` = top up `K` yang tidak terhapus, waktu = `created_at` (fallback `date`).
- `total_tol` = tol manual `K` yang tidak terhapus (waktu sama) **+** bagian tol
  `K` dari laporan BBM (waktu = `timestamp`).
- `total_bbm_flazz` = bagian BBM `K` dari laporan BBM.

Bagian per kartu memakai `flazzBbmShare`/`flazzTolShare` M7 yang **mencakup
grup-2** (D1).

```
opening      = usage.opening_balance > 0 ? usage.opening_balance
             : saldo_kini + total_bbm_flazz + total_tol - total_topup
flazz_balance = opening + total_topup - total_bbm_flazz - total_tol
difference    = flazz_balance - actual_balance        (tanda sama dengan GAS)
status        = |difference| <= 1 ? SESUAI : PERLU_PEMERIKSAAN
```

## 4. Syarat rekonsiliasi (port `hasCompliantFlazzLaporan` + `checkReconGate`)

Kartu boleh direkon bila salah satu terpenuhi:
1. Ada laporan BBM pada periode (`timestamp >= since`) yang melibatkan `K`
   (BBM atau tol, grup 1 atau 2 — D1) dengan **foto KM awal dan akhir terisi**,
   dan (kecuali kendaraan `ANALOG_JARUM`) KM awal dan akhir > 0.
2. Kartu sedang diserahkan lewat jalur (`ref_type = JALUR`) dan jalur itu sudah
   `SUDAH_LAPORAN`/`SELESAI` (laporan ada, tanpa pengeluaran kartu).

Alasan yang dikembalikan (teks GAS):
- `Laporan pengiriman sudah diinput (tanpa pengeluaran kartu); rekon pengembalian diperbolehkan.`
- `Laporan valid dengan foto KM awal & akhir terdeteksi.`
- `Belum ada laporan valid dengan foto KM awal & akhir pada periode kartu ini.`

## 5. API

Akses mengikuti M5: PIC hanya kartu cabangnya; SUPERADMIN semua.

| Metode | Path | Fungsi |
|---|---|---|
| GET | `/api/flazz/dashboard` | `{cards, topups, tols, tolHistory, usages, recons, bbmFlazz}` (port `getFlazzDashboardData`, termasuk grup-2) |
| GET | `/api/flazz/reconciliation/preview?card_id=` | `{eligible, reason, usage, opening_balance, total_topup, total_bbm_flazz, total_tol, flazz_balance}` — angka yang sama dengan yang akan disimpan (D5) |
| POST | `/api/flazz/reconciliation` | **Diganti** ke model GAS (5.1) |
| DELETE | `/api/flazz/reconciliation/:id` | **Diganti** ke model GAS (5.2) |
| GET | `/api/flazz/reconciliation[/:id]` | Tetap |
| PUT / apply / ignore | `/api/flazz/reconciliation/...` | **Dihapus** (tidak ada di GAS, D4) |

### 5.1 Simpan rekonsiliasi
Body `{ card_id, actual_balance, action?: 'ADJUST'|'IGNORE', notes?, tanggal?, evidence? }`.
1. Akses kartu; hitung §3; syarat §4 gagal → 409
   `Rekonsiliasi diblokir: belum ada laporan valid dengan foto KM awal & akhir pada periode kartu. Harap input laporan dahulu.`
2. `actual_balance` harus angka ≥ 0 (`Saldo aktual wajib berupa angka yang valid.`).
3. `action` default: `ADJUST` bila SESUAI, `IGNORE` bila tidak.
4. Simpan rekon: `date` = `tanggal` atau hari ini (WIB, `YYYY-MM-DD`),
   `driver_id`/`vehicle_id` dari penyerahan, `reconciled_by` = nama user,
   `reconciled_at` = sekarang (ISO).
5. Kartu: saldo = `actual_balance` bila SESUAI atau ADJUST, selain itu
   `flazz_balance`; status `TERSEDIA`; pemegang = supir default.
6. Penyerahan aktif terbaru → `DIKEMBALIKAN` (`returned_at` = sekarang).
7. Hitung ulang status jalur kartu (M8 §4.6). Audit `CREATE flazz`.
8. Respons `{ msg: 'Rekonsiliasi disimpan. Status: <status>. Kartu tersedia kembali.' }`.

### 5.2 Hapus rekonsiliasi
Hanya SUPERADMIN (`Akses ditolak: hanya SUPERADMIN yang dapat menghapus rekonsiliasi.`).
Ditolak (409) bila:
- bukan rekon **terakhir** kartu itu (`Hanya baris rekonsiliasi TERAKHIR untuk kartu ini yang dapat dihapus.`);
- ada laporan BBM/tol ber-Flazz kartu itu (grup 1 atau 2, D1) dengan
  `timestamp` setelah rekon;
- ada top up kartu itu setelah rekon;
- kartu sudah diserahkan lagi (`DIBERIKAN` baru) setelah rekon.

Efek: penyerahan `DIKEMBALIKAN` terakhir (`returned_at <= reconciled_at`) kembali
`DIBERIKAN`; rekon soft-delete; saldo kartu = `opening_balance` rekon; status
`SEDANG_DIGUNAKAN`; pemegang = supir penyerahan itu; status jalur dihitung ulang.
Pesan: `Rekonsiliasi dihapus. Saldo kartu dikembalikan ke saldo awal dan status kartu jadi SEDANG_DIGUNAKAN.`

### 5.3 Bukti foto (D2)
`evidence` (base64 data URI + nama) diunggah ke Storage memakai
`uploadEvidence` yang sudah ada (folder `Flazz_TopUp` / `Flazz_Recon`), URL
disimpan di `evidence_url` (top up) — rekon tidak punya kolom bukti di schema,
URL dicatat di `notes`.

## 6. Halaman (menu **Flazz**)

- **List Flazz** (`#/flazz`): warehouse (SUPERADMIN), periode, cari nomor/nama.
  Tabel No, Nomor kartu, Nama, Driver, Status, Saldo awal, Pengeluaran, Saldo
  akhir, dengan rumus periode dari GAS (`renderFlazzListingTable`: pakai rekon
  terakhir dalam periode + aktivitas setelahnya; tanpa rekon = saldo kini).
  Klik kartu → detail riwayat periode, tombol Cetak.
- **Top Up** (`#/flazz/topup`): kartu, nominal (> 0), tanggal, catatan, foto bukti.
- **Pengembalian & Rekonsiliasi** (`#/flazz/rekon`): pilih kartu
  `SEDANG_DIGUNAKAN`; tampil status syarat dan saldo sistem dari `preview`
  (tombol simpan nonaktif bila tidak memenuhi syarat); isi saldo fisik; info
  selisih ("Saldo sesuai" / "Selisih kurang …" / "Selisih lebih …");
  tindakan pada selisih (Sesuaikan ke saldo fisik / Abaikan); catatan; foto bukti.
- **Riwayat** (`#/flazz/riwayat`): warehouse, rentang tanggal; tab Top Up
  (edit/hapus), Tol (manual: edit/hapus; dari laporan: tampil saja), BBM Flazz
  (lepas Flazz), Penyerahan, Rekonsiliasi (hapus, SUPERADMIN).

## 7. Keputusan yang Perlu Disetujui

**D1 — Kartu ke-2 di ledger, syarat, dan hapus rekon.** GAS terbaru membangun
state tanpa kolom grup-2 di `computeFlazzLedger`, `hasCompliantFlazzLaporan`, dan
pemeriksaan hapus rekon, sehingga pengeluaran kartu ke-2 (yang sudah memotong
saldo) tidak ikut dihitung → rekon kartu itu selalu selisih. Usulan: ikutkan
grup-2 (perbaikan bug).

**D2 — Foto bukti top up/rekon.** GAS mengunggah foto; M5 hanya URL. Usulan:
dukung unggah foto (memakai mekanisme upload yang sudah ada).

**D3 — Form kartu Flazz.** Usulan: di halaman Data Master (M10), seperti GAS.

**D4 — Endpoint M5 PUT/apply/ignore rekonsiliasi.** Usulan: dihapus agar hanya
ada satu cara rekonsiliasi.

**D5 — Saldo sistem dihitung di server.** GAS menghitungnya di browser lalu
menghitung ulang di server. Usulan: satu perhitungan di server (`preview`) agar
angka di layar sama persis dengan yang disimpan.

## 8. Verifikasi

- Unit test ledger (periode, grup-2, opening rekonstruksi), syarat (foto, jarum,
  jalur), status SESUAI/PERLU_PEMERIKSAAN, rumus List Flazz.
- Route test simpan (efek kartu/penyerahan/jalur, blokir syarat), hapus (hanya
  SUPERADMIN, hanya terakhir, blokir aktivitas baru, efek dibalik), dashboard,
  preview; test rekon M5 lama diganti.
- Manual: top up → kartu bertambah; jalur berkartu → laporan → rekon → kartu
  TERSEDIA dan jalur SELESAI; hapus rekon → kembali.
