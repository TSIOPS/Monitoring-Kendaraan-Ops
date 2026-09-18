# Migrasi Monitoring Kendaraan Ops ke Supabase & Cloudflare

**Tanggal:** 2026-09-18
**Status:** Disetujui
**Proyek asal:** `D:\Monitoring Kendaraan Ops` (Google Apps Script)
**Proyek baru:** `D:\Monitoring Kendaraan Ops Cloud`

## 1. Latar Belakang & Tujuan

Aplikasi "Sistem Monitoring BBM & Operasional Harian" (PT Tridaya Sinergi Indonesia)
saat ini berjalan di atas Google Apps Script (GAS): frontend vanilla JS + Bootstrap 5,
backend GAS V8, database Google Sheets (18 sheet), penyimpanan foto di Google Drive,
deploy via clasp ke GAS Web App anonim.

**Alasan migrasi:** keterbatasan performa Google Sheets sebagai database.

**Tujuan:** memindahkan seluruh aplikasi (isi & workflow 1:1 dengan GAS) ke
Supabase (database + storage) dan Cloudflare (hosting + backend + CDN), tanpa
merubah pengalaman kerja pengguna.

Project GAS yang berjalan **tidak akan disentuh** — versi baru dibangun di
folder/repo terpisah dan hanya menggantikan setelah selesai & terverifikasi.

## 2. Keputusan Arsitektur (Sudah Disetujui)

**Pendekatan A — Satu Cloudflare Worker + Supabase**

```
┌─────────────────────────────────────────────────────┐
│  Cloudflare Worker (satu deploy, *.workers.dev)      │
│                                                     │
│  ├─ Static Assets:  Index.html, js.html, css.html,  │
│  │   FlazzPages, JalurPages, Html2canvasLib, dll.   │
│  │   (file UI Bootstrap 5 di-reuse apa adanya)       │
│  │                                                   │
│  └─ REST API: /api/*  (port dari Code.js +          │
│        SpreadsheetOps, FlazzOps, JalurOps, dll.)     │
│        Semua logika bisnis dipindah 1:1              │
└──────────────┬─────────────────┬────────────────┬────┘
               │                 │                │
        Supabase PostgreSQL   Supabase Storage   Cloudflare KV
        (data utama)          (foto evidence     (session token,
                              per cabang)         rate limit counter)
        └─ backup bulanan ke Supabase Storage
```

Alur data:
1. Browser buka Worker → dapat HTML/JS/CSS.
2. JS klien yang tadinya memanggil `google.script.run(apiXxx)` → diganti
   `fetch('/api/xxx')` dengan token.
3. Worker memvalidasi token → proses logika (sama seperti `requireUser` GAS) →
   baca/tulis Postgres + unggah/ambil foto di Storage → balas JSON.
4. Foto diambil langsung dari URL publik Storage (cache CDN Cloudflare).

## 3. Skema Database (PostgreSQL)

18 sheet diubah jadi tabel relasional dengan tipe data benar.

| Sheet (GAS) | Tabel Postgres | Catatan |
|---|---|---|
| Cabang | `cabang` | PRIMARY KEY `kode` (immutable) |
| Supir | `supir` | soft-delete |
| BBM | `bbm` | jenis BBM + harga |
| Pengguna | `pengguna` | username UNIQUE, hash lama + salt dipindah utuh |
| Kendaraan | `kendaraan` | soft-delete |
| Konfigurasi / Pengaturan | `konfigurasi` | key-value (logo, nama, tema) |
| Audit_Log | `audit_log` | semua aksi tulis, index waktu |
| Penggunaan_BBM | `penggunaan_bbm` | core table; FK cabang/supir/kendaraan/bbm |
| Pengisian_BBM | `pengisian_bbm` | |
| Foto_Evidence | `foto_evidence` | path ke Storage + metadata |
| Flazz_Card / Usage / TopUp / Tol / Reconciliation | `flazz_card`, `flazz_usage`, `flazz_topup`, `flazz_tol`, `flazz_recon` | |
| Dashboard / cache sheet | dihapus | query langsung + cache KV |
| Session | (di KV, bukan tabel) | token 12 jam di Cloudflare KV |

Aturan bisnis yang dipertahankan 1:1 dari GAS:
- Soft-delete untuk master data (cabang/supir/kendaraan/bbm).
- Kode cabang immutable.
- Pemisahan akses: `PIC CABANG` hanya baca/tulis cabang sendiri (server-side).
- Validasi bisnis sama: estimasi KM analog, perhitungan liter BBM,
  rekonsiliasi Flazz, engine peringatan, dll.

## 4. Desain API

Penggantian `google.script.run` → REST API, 1:1:

| Dulu (GAS) | Baru (REST) |
|---|---|
| `doLogin(username, password)` | `POST /api/login` |
| `doLogout(token)` | `POST /api/logout` |
| `getMasterData(token)` | `GET /api/master` (cache 30 dtk di KV) |
| `saveDailyTransaction` | `POST /api/laporan` |
| `apiEditDailyTransaction` | `PUT /api/laporan/:id` |
| `apiDeleteDailyTransaction` | `DELETE /api/laporan/:id` |
| `getLastLaporanPrefill` | `GET /api/laporan/prefill` |
| `getPerformaData` | `GET /api/laporan/performa` |
| `processDailyImages` | `POST /api/laporan/photos` → simpan ke Storage |
| `apiSaveFlazzCard/TopUp/Tol/Recon` | `POST /api/flazz/**` |
| `apiSaveJalur / Update / Delete` | `POST/PUT/DELETE /api/jalur` |
| `getDashboardWarnings / Data` | `GET /api/dashboard` |
| `saveAppSettings / getAppSettings` | `GET/PUT /api/settings` |
| `uploadLogo` | `POST /api/settings/logo` |
| `apiDetectFuelLevel` (Gemini) | `POST /api/fuel-detect` (opsi manual) |
| `backup` / `restore_backup` | `POST /api/admin/backup` (bulanan) |

Semua endpoint mewajibkan `Authorization: Bearer <token>` dan divalidasi
`requireUser(token)` di Worker — role/cabang tidak pernah dipercaya dari klien.

## 5. Autentikasi & Keamanan

- **Login:** username + password existing. Hash password disimpan dengan format
  identik GAS (salt + iterasi PBKDF2-style) sehingga **langsung migrasi** tanpa
  reset password. Hash lama (satu-round) tetap valid dan auto-upgrade saat login.
- **Session token:** token acak TTL 12 jam di **Cloudflare KV** (bukan Postgres).
  Dicek di Worker untuk setiap request.
- **Rate limiting:** login maks 5×/5 menit per username, penghitung di KV.
- **Isolasi cabang:** `PIC CABANG` dibatasi server-side untuk cabang sendiri
  (replika `assertOwnWarehouse`).
- **XSS:** semua data dirender lewat `esc()`/`escUrl()` (dipertahankan).
- **CORS:** Worker membatasi `Access-Control-Allow-Origin` ke alamat sendiri.
- **Foto:** URL publik Storage tetapi nama file acak + struktur folder per cabang.

### Kompresi Foto

- Foto dikompres **di browser sebelum diunggah**: `<canvas>` resize maks
  ~1280px, JPEG/WebP kualitas ~80.
- Versi asli **tidak disimpan** (keputusan pengguna).
- Foto lama saat migrasi juga dikompres oleh script migrasi.

## 6. Migrasi Data & Foto

Dua script migrasi, jalan **offline di lokal**, memakai *copy* spreadsheet /
folder Drive (bukan data produksi GAS).

1. **Migrasi data** (Node.js: baca Google Sheets copy → insert ke Supabase):
   - Mapping 18 sheet → tabel.
   - Password hash + salt dipindah utuh (tidak di-reset).
   - ID/relasi dipertahankan.
   - Verifikasi: jumlah baris per sheet sebelum vs sesudah sama persis;
     uji login beberapa user.
   - Durasi: sekali jalan (data puluhan ribu baris).

2. **Migrasi foto** (Node: Google Drive API → Supabase Storage):
   - Unduh dari *copy* folder Drive per cabang.
   - Kompres jadi WebP/JPEG maks ~1280px.
   - Unggah ke `storage/foto/<kode-cabang>/<nama-acak>.webp`.
   - Tulis `foto_evidence` agar laporan terhubung ke path baru.
   - Verifikasi: jumlah foto sebelum vs sesudah sama (dengan toleransi gagal decode).

## 7. Fitur Operasional

| Fitur GAS | Keputusan |
|---|---|
| Backup harian (14 retensi) | **Diganti backup bulanan** (trigger Worker/cron), retensi 24 bulan, dump Postgres + snapshot Storage di Supabase Storage |
| Email laporan kesehatan harian | **Dihapus** |
| Rate limiting login | Dipertahankan (5×/5 mnt) |
| Audit log | **Diperluas**: mencatat semua aksi tulis |
| Engine peringatan (pajak/KIR/olie/Flazz `SEDANG_DIGUNAKAN`) | Dipertahankan |
| Deteksi level BBM Gemini (manual) | Dipertahankan |
| Tool diagnosa internal | Dipertahankan |
| Caching UI (`PAGE_VER`, cache 6 jam) | **Tidak diperlukan** (asli langsung dilayani Worker) |

### Audit Log (detail)

Mencatat **semua tindakan tulis**:
- Login / logout / gagal login (username, waktu Asia/Jakarta, IP/User-Agent).
- Data master: tambah/ubah/hapus Cabang, Kendaraan, Supir, BBM, Pengguna
  + ringkasan sebelum→sesudah.
- Laporan BBM: simpan/edit/hapus `penggunaan_bbm` + ringkasan.
- Foto: upload/hapus evidence.
- Flazz: card/topup/tol/rekonsiliasi (termasuk Adjust/Ignore).
- Jalur pengiriman: buat/ubah/hapus.
- Pengaturan: ubah logo/nama perusahaan/tema.
- Admin: jalankan backup bulanan.

Format baris: `id, waktu, user, cabang, aksi, detail (JSON ringkas
sebelum→sesudah), IP`. **Tindakan baca tidak dicatat.**

## 8. Frontend

- File UI di-reuse, penyesuaian minimal:
  - `google.script.run` → `fetch('/api/xxx')` + header token.
  - Deteksi session → `GET /api/session`.
  - Upload foto → alur kompres `<canvas>` → upload endpoint.
  - URL foto Drive → URL Storage.
  - html2canvas summary / WhatsApp share tetap tanpa perubahan (client-side).
  - `esc()`/`escUrl()` dipertahankan.
- UI tidak berubah. File terpisah (`js.html`, `css.html`, dll.) digabung jadi
  file statis worker; `PAGE_VER` & cache 6 jam dibuang.

## 9. Error Handling & Observability

- Worker: handler terpusat → JSON seragam `{ok:false, error, message}`;
  rollback transaksi bila sebagian gagal.
- Debug via `wrangler tail` / OpenTelemetry.
- Audit log ditulis ke `audit_log`; email kesehatan dihapus.

## 10. Testing

- **Unit:** logika murni (`PaymentLogic`, perhitungan KM/liter, warnings) pakai vitest.
- **Integrasi API:** dengan Supabase test project.
- **Keamanan:** port 17 assertion isolasi cabang dari GAS → dijalankan ulang, harus PASS.
- **Regression:** sandingkan output versi baru vs GAS untuk data percobaan yang sama.

## 11. Deploy & Alur Kerja

- Tool: `wrangler deploy` ke `*.workers.dev`.
- Migrasi database via Supabase SQL (migration files) + script Node.
- Alur kerja: verifikasi → commit → deploy (mirip `deploy.ps1` sekarang).
- `.env` lokal untuk kredensial (GAS menggunakan Script Properties;
  versi baru memakai secret Worker + Supabase).

## 12. Lingkungan & Konfigurasi

- Script Properties/`SPREADSHEET_ID` → environment/production di Worker + Supabase.
- Kunci Gemini `GEMINI_API_KEY` → secret Worker.
- Timezone tetap Asia/Jakarta.