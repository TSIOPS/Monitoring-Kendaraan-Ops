# Monitoring Kendaraan Operasional — Versi Cloud

Migrasi dari Google Apps Script ke **Cloudflare Workers + Supabase** (lihat
`docs/superpowers/specs/2026-09-18-migrasi-supabase-cloudflare-design.md`).

## Arsitektur
Satu Worker di `*.workers.dev`: static assets + REST API `/api/*`. PostgreSQL di
Supabase, session & rate-limit di Cloudflare KV, foto di Supabase Storage.

## Prasyarat
- Node 18+, `npm i`
- Akun Cloudflare (wrangler login) + akun Supabase
- Namespace KV: `npx wrangler kv namespace create SESSION_KV` lalu tempel `id`
  ke `wrangler.jsonc` → `kv_namespaces[0].id`.

## Setup
1. Apply `db/schema.sql` di Supabase SQL editor. (termasuk RLS; untuk database lama jalankan `db/rls.sql`).
2. `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`
3. Tambah `SUPABASE_URL` di section `vars` `wrangler.jsonc` (atau `.dev.vars` lokal).
4. `npm run dev` untuk lokal; `npm run deploy` untuk rilis.

## Checklist deploy (WAJIB dibaca sebelum `npm run deploy`)
1. `git pull origin main` lalu `npm install`.
2. `npm test` dan `npm run typecheck` harus hijau.
3. **Jalankan SQL migrasi yang masih tertunda** (tabel di bawah) di Supabase SQL editor **sebelum** deploy,
   lalu pindahkan barisnya ke bagian "Sudah dijalankan" dan commit.
4. `npm run deploy`.

### SQL migrasi tertunda
| File | Untuk fitur | Status |
|---|---|---|
| `db/kas-kecil.sql` (5 tabel kas kecil + seed jenis) — **wajib dijalankan SEBELUM deploy fitur kas kecil** (backup harian memuat tabelnya) | Kas Kecil (belum di-deploy) |

### Sudah dijalankan di production
| File | Tanggal |
|---|---|
| `db/rincian-pengeluaran.sql` (kolom `penggunaan_bbm.rincian`) | 2026-10-21 |

## Perintah
| Script | Fungsi |
|---|---|
| `npm run dev` | wrangler dev lokal |
| `npm run deploy` | deploy ke *.workers.dev |
| `npm test` | vitest |
| `npm run typecheck` | tsc --noEmit |
| `node scripts/impor-kas-kecil.mjs <berkas.xlsb> <KODE>` | Impor kas kecil dari Excel lama. Tanpa `--apply` = dry-run (hanya laporan + cek saldo); `--apply` menulis ke DB (butuh `db/kas-kecil.sql` sudah dijalankan). Opsi: `--tanpa-saldo`, `--timpa-saldo` |

## Kas Kecil (BELUM DI-DEPLOY — tunggu pemilik repo menyatakan siap)
Modul pengganti Excel kas kecil per warehouse: Kas Keluar & Penyelesaian (nomor KK/KM/BO/BP format Excel), Laporan Harian, Summary bulanan, Pembanding dengan aplikasi (BBM tunai ↔ Bensin Delivery, Top Up Flazz ↔ Pengisian ETOLL, Tol tunai ↔ Uang Muka Delivery), BA Cash Opname, cetak 4 dokumen, Excel. Menu **Kas Kecil**; API `/api/kaskecil/*`. Hak akses: PIC = warehouse sendiri (tulis), MANAGEMENT = baca semua, SUPERADMIN = semua + master jenis + saldo awal. Spesifikasi: `docs/superpowers/specs/2026-10-23-kas-kecil-design.md`. Urutan rilis: (1) jalankan `db/kas-kecil.sql`, (2) impor data lama per cabang (dry-run dulu), (3) deploy, (4) tambah entri `rilis.js`.

## Role pengguna
| Role | Cakupan data | Bisa mengubah data | Khusus |
|---|---|---|---|
| `SUPERADMIN` | semua warehouse (+ filter) | ya, semua | kelola pengguna, pengaturan, kosongkan data, Audit Log, hapus rekonsiliasi |
| `MANAGEMENT` | semua warehouse (+ filter) | **tidak** (hanya lihat) | Perbandingan Pengeluaran; Data Master tanpa daftar pengguna |
| `PIC CABANG` | warehouse sendiri | ya, warehouse sendiri | wajib punya warehouse |

Akun `MANAGEMENT` dibuat SUPERADMIN lewat Data Master → Pengguna (warehouse otomatis kosong). Helper role ada di
`src/auth/peran.ts` (server) dan `static/js/peran.js` (frontend).

## Catatan keamanan
- Role/cabang tidak pernah dari client; dicek `requireUser`.
- `MANAGEMENT` read-only: semua metode non-GET dari sesi MANAGEMENT ditolak 403 di `requireUser`, kecuali
  `/api/password` dan `/api/push/{langganan,berhenti,tes}` (milik akun sendiri). Cakupan baca memakai
  `lihatSemuaCabang()`, cek tulis tetap `isSuper()`/cek cabang.
- Rate limit login (KV): 5x/5mnt per input username, per akun hasil lookup, dan 30x/5mnt per IP; username berisi wildcard (`%`, `*`) ditolak dan `_` diperlakukan literal.
- Hash password format kompatibel GAS (tidak perlu reset saat migrasi).
- Sesi sliding 12 jam: diperpanjang saat dipakai hanya selama token masih terdaftar di daftar sesi pengguna (`sessu:`, belum dicabut), dan maksimal 7 hari sejak login; setelah itu wajib login ulang.

## API (status M5 — fondasi + master + settings + audit + laporan + warnings + Flazz CRUD)
| Metode | Path | Akses | Keterangan |
|---|---|---|---|
| POST | `/api/login` | publik | login → session token (KV, 12 jam) |
| POST | `/api/logout` | token | hapus session |
| GET | `/api/health` | publik | health check |
| GET | `/api/health/versi` | publik | id versi deploy (binding `CF_VERSION_METADATA`, `Cache-Control: no-store`); dipoll klien untuk banner "Versi baru tersedia" |
| GET | `/api/master` | role+cabang (MANAGEMENT: semua cabang, tanpa daftar pengguna) | payload master (cache KV 30 dtk) |
| POST/PUT/DELETE | `/api/master/cabang` | PIC (cabang sendiri), SUPERADMIN semua | CRUD cabang (soft-delete) |
| POST/PUT/DELETE | `/api/master/kendaraan` | PIC (cabang sendiri), SUPERADMIN semua | CRUD kendaraan |
| POST/PUT/DELETE | `/api/master/supir` | PIC (cabang sendiri), SUPERADMIN semua | CRUD supir |
| POST/PUT/DELETE | `/api/master/bbm` | SUPERADMIN | CRUD BBM |
| POST/PUT/DELETE/… | `/api/master/pengguna` | SUPERADMIN | kelola pengguna + `/activate` |
| POST | `/api/master/kendaraan/:id/reset-oli` | PIC/SUPERADMIN | baseline ganti oli ke KM terbaru |
| GET/PUT | `/api/settings` | GET publik, PUT SUPERADMIN | pengaturan aplikasi |
| POST | `/api/settings/logo` | SUPERADMIN | upload logo (base64 → Supabase Storage) |
| GET | `/api/audit` | SUPERADMIN | daftar audit (`?limit=` 1–500, desc) |
| POST | `/api/laporan/photos` | PIC/SUPERADMIN | unggah 2 foto odometer (base64 → bucket `foto`) |
| POST | `/api/laporan` | PIC/SUPERADMIN | simpan transaksi BBM (gate jalur & Flazz, potong saldo, usage, audit); field `rincian` (nota BBM/tol per baris: `jenis`, `nominal`, `kartu`, `keterangan`) dijumlah ke kolom slot lama |
| PUT | `/api/laporan/:id` | PIC/SUPERADMIN | koreksi transaksi (delta Flazz, ganti foto, re-link jalur); `rincian` opsional — tanpa `rincian` & tanpa field pembayaran, pembayaran lama dipertahankan |
| DELETE | `/api/laporan/:id` | PIC/SUPERADMIN | hapus transaksi (refund Flazz, return usage, release jalur) |
| DELETE | `/api/laporan/:id/flazz` | PIC/SUPERADMIN | detach payment BBM Flazz (refund `biaya_bbm`, field tol tidak berubah) |
| GET/POST/PUT/DELETE | `/api/flazz/card[/:id]` | PIC (cabang sendiri), SUPERADMIN semua | CRUD kartu Flazz (saldo hanya lewat operasi Flazz) |
| GET/POST/PUT/DELETE | `/api/flazz/topup[/:id]` | PIC (cabang sendiri), SUPERADMIN semua | top up (soft-delete; saldo mengikuti delta) |
| GET/POST/PUT/DELETE | `/api/flazz/tol[/:id]` | PIC (cabang sendiri), SUPERADMIN semua | tol via Flazz (soft-delete; saldo mengikuti delta) |
| GET/POST/PUT/DELETE | `/api/flazz/reconciliation[/:id]` | PIC (cabang sendiri), SUPERADMIN semua | rekonsiliasi kartu (total dihitung server) |
| POST | `/api/flazz/card/:id/adjust` | PIC (cabang sendiri), SUPERADMIN semua | penyesuaian saldo (butuh `delta` + `reason`) |
| POST | `/api/flazz/reconciliation/:id/apply` | PIC (cabang sendiri), SUPERADMIN semua | terapkan rekonsiliasi (set saldo ke `actual_balance`) |
| POST | `/api/flazz/reconciliation/:id/ignore` | PIC (cabang sendiri), SUPERADMIN semua | tandai rekonsiliasi diabaikan (tanpa ubah saldo) |
| GET | `/api/laporan/prefill` | PIC/SUPERADMIN | prefill dari transaksi terakhir yang memenuhi syarat |
| GET | `/api/laporan/performa` | PIC/SUPERADMIN | performa 7-trip per kendaraan (cache 300 dtk) |
| GET | `/api/dashboard` | PIC/SUPERADMIN | riwayat transaksi + ringkasan bulanan + warnings OLI/pajak/KIR (cache 300 dtk) |
| GET | `/api/dashboard/warnings` | PIC/SUPERADMIN | Peringatan Dini dashboard (cache 300 dtk, `?fresh=1` baca ulang) |

M3 (laporan/transaksi BBM), M4 (dashboard & warnings), dan M5 (Flazz CRUD: kartu,
top-up, tol, rekonsiliasi, adjust saldo, detach payment BBM) **selesai** —
lihat `docs/superpowers/plans/2026-09-21-m3-laporan-transaksi-bbm.md`,
`docs/superpowers/plans/2026-09-25-m4-dashboard-warnings.md`, dan
`docs/superpowers/plans/2026-09-25-m5-flazz-crud.md`. Regresi M3/M4 tetap hijau.

- **M6** — Frontend vanilla JS + Bootstrap 5 (login, transaksi + dashboard,
  input laporan dengan upload foto, edit transaksi) **selesai** - 2026-10-05.
  Native ES modules di `static/` tanpa build step; lihat
  `docs/superpowers/plans/2026-10-05-m6-frontend.md`. Tanggal default form
  input selalu WIB (`Asia/Jakarta`).
- **Migrasi data** dari export Google Sheets: `node scripts/migrate-sheets.mjs <file.xlsx>`
  (dry-run) lalu `--apply` (upsert, aman diulang; verifikasi jumlah baris + hash
  password). Taruh file export di `migrasi/` (di-gitignore).
- **Migrasi foto** Drive -> Supabase Storage: `node scripts/migrate-photos.mjs`
  (dry-run) lalu `--apply`. Jalankan SETELAH migrasi data; aman diulang (nama
  objek tetap per ID Drive). Lalu `node scripts/buat-thumbnail.mjs --apply`
  untuk thumbnail (±320 px di `foto/thumb/…`, karena transformasi gambar Supabase
  tidak aktif). Foto baru: kompresi 1280 px/70% (setara GAS) + thumbnail dibuat
  klien saat unggah; tampilan jatuh ke foto penuh bila thumbnail belum ada.
- **M7** — Pembayaran dua kartu (grup-2: `flazz_card_id_2`, `biaya_bbm_2`,
  `flazz_card_id_toll_2`, `biaya_toll_2`) port dari GAS terbaru **selesai** -
  2026-10-05; lihat `docs/superpowers/specs/2026-10-05-m7-dua-kartu-design.md`.
- **M8** — Jalur Pengiriman (API `/api/jalur` + halaman Daftar/Buat/Edit/Ringkasan,
  dua kartu etoll, gate jalur belum tuntas, status SELESAI dari rekonsiliasi;
  Input Laporan memilih supir dari jalur) **selesai** - 2026-10-06; lihat
  `docs/superpowers/specs/2026-10-06-m8-jalur-pengiriman-design.md`.
- **M9** — Halaman Flazz (List, Top Up, Pengembalian & Rekonsiliasi, Riwayat) dan
  rekonsiliasi diganti ke model GAS 1:1 (saldo sistem dihitung server, kartu
  kembali TERSEDIA, hapus hanya SUPERADMIN) **selesai** - 2026-10-06; lihat
  `docs/superpowers/specs/2026-10-06-m9-flazz-ui-rekonsiliasi-design.md`.
- **M10** — Halaman Data Master (kendaraan + reset oli, warehouse, supir, BBM,
  kartu Flazz, pengguna) **selesai** - 2026-10-06; lihat
  `docs/superpowers/specs/2026-10-06-m10-data-master-ui-design.md`.
- **M11** — Edit transaksi lengkap (tanggal, supir, KM, bar, liter, pembayaran,
  foto) **selesai** - 2026-10-06; lihat
  `docs/superpowers/specs/2026-10-06-m11-edit-transaksi-lengkap-design.md`.
- **M12** — Dashboard ala GAS (sapaan, akses cepat, Peringatan Dini: pajak/KIR,
  saldo etoll < Rp100.000, ganti oli, odometer estimasi via `GET /api/dashboard/warnings`;
  status kartu etoll; galeri terbaru) dan grup menu Laporan Operasional (Input
  Laporan, History Laporan, Galeri Foto, Performa Kendaraan) **selesai** - 2026-10-06.
- **Rekap Pengeluaran** (menu Laporan Operasional) — BBM & tol per metode bayar
  (etoll/tunai) dari laporan harian (termasuk kartu ke-2) + tol manual Flazz;
  per kartu etoll, per kendaraan, detail, unduh Excel (.xlsx, 4 sheet)
- **Kosongkan Data (cutover, SEMENTARA)** — panel "Zona Berbahaya" di Pengaturan,
  hanya muncul bila secret `ENABLE_RESET_DATA=true`. Nyalakan:
  `npx wrangler secret put ENABLE_RESET_DATA` (isi `true`); matikan setelah
  cutover: `npx wrangler secret delete ENABLE_RESET_DATA`. Butuh ketik
  `KOSONGKAN` + password SUPERADMIN; tabel `pengguna` & `pengaturan` tidak dihapus.
  Alternatif tanpa tombol: `db/reset.sql` di SQL Editor.
  Setelah migrasi: jalankan `db/backfill-driver2.sql` (Driver 2 laporan dari jalur).
- **Pengingat 16:30 WIB** — banner tugas hari ini (kuning sepanjang hari, merah + pop-up mulai 16:30) dan Web Push (Cron `30 9 * * *` UTC). Langganan per perangkat di KV (`push:*`), aktifkan di Dashboard → Reminder. Kunci VAPID: publik di `wrangler.jsonc`, privat di secret `VAPID_PRIVATE_JWK`. iPhone: pasang ke Layar Utama dulu.
- **Perbandingan Pengeluaran** (SUPERADMIN) — total BBM & tol per warehouse, dikelompokkan Cabang (Who) vs Gudang Pusat (Whp/kode GDG), subtotal, % total, rata-rata per kendaraan, grafik batang; sumber sama dengan Rekap Pengeluaran, warehouse nonaktif tidak dihitung.
  Tab **Bulan vs Bulan**: 3/6/12 bulan terakhir per warehouse, rata-rata (bulan penuh), selisih bulan berjalan vs tanggal yang sama bulan lalu, proyeksi linear akhir bulan; bulan awal tanpa data dipangkas. Kedua tab punya **Unduh Excel** (.xlsx).
- **Audit Log** (SUPERADMIN, menu Konfigurasi) — semua aktivitas pengguna (tambah/ubah/hapus/Lepas Flazz/login) dengan filter pengguna, modul, aksi, rentang tanggal WIB; rincian perubahan per kolom (sebelum/sesudah) dan Unduh Excel. API `GET /api/audit?username=&modul=&action=&dari=&sampai=&login=1&limit=` (maks 2000).
- **Diinput oleh** — kolom & filter penginput di History Laporan, kolom "Dibuat oleh" di Daftar Jalur, "Dicatat oleh" di Riwayat Flazz (Top Up & Tol).
- **Kendaraan bersama** — kendaraan didaftarkan sekali di warehouse pemilik; SUPERADMIN mencentang "Dipakai juga oleh" (kolom `kendaraan.cabang_bersama`, `db/kendaraan-bersama.sql`). Warehouse pemakai bisa memakainya di Buat Jalur & Input Laporan; laporan/jalur distempel warehouse pemakai (rekap biaya ikut pemakai), sedangkan riwayat KM, selisih ODO, ganti oli, efisiensi 7 trip, dan gate jalur menyatu per kendaraan. Kendaraan yang dijadwalkan warehouse lain di tanggal sama (belum tuntas) diblokir.
- **Kunci rekonsiliasi** — laporan yang kartunya sudah direkonsiliasi: Lepas Flazz disembunyikan (History & Riwayat Flazz), tombol hapus terkunci; server tetap menolak (409).
- **Foto di Cloudflare R2** — bucket `monitoring-foto` (binding `FOTO`), URL `/foto/<kunci>` disajikan Worker (cache 1 tahun); foto yang belum ada di R2 diambil dari Supabase lalu disalin. Alamat lama diganti lewat `db/pindah-foto-r2.sql`.
- **Backup harian** — cron 02:00 WIB menyalin 17 tabel ke bucket privat `monitoring-backup` (`backup/<tanggal>/<tabel>-<n>.json`), disimpan 30 hari (`src/backup.ts`). Unduh: dashboard Cloudflare → R2 → monitoring-backup, atau `npx wrangler r2 object get monitoring-backup/backup/<tanggal>/<tabel>-0.json --remote`.
- **Keamanan** — password PBKDF2-SHA256 100.000 putaran (hash lama diganti otomatis saat login); ganti/reset password & nonaktifkan akun mencabut sesi; header CSP/anti-iframe/nosniff/HSTS (`src/utils/keamanan.ts` + `static/_headers`); tanpa CORS.
- **Pengaturan** (menu Konfigurasi, SUPERADMIN) — logo, nama aplikasi, nama perusahaan,
  footer. `PUT /api/settings` tanpa `logo_url` mempertahankan logo; URL logo
  diberi `?v=` agar logo baru tidak tertahan cache.
  (`GET /api/laporan/rekap-pengeluaran?dari=&sampai=&cabang=`).
  Berikutnya: cutover dari GAS.
- **Rincian pengeluaran per nota** — Input & Edit Laporan mengisi BBM/tol satu baris per nota (jenis, nominal maks. Rp 100.000.000, dibayar kartu jalur/Tunai — bawaan kartu 1 jalur, keterangan); maks. 30 baris dan 2 cara bayar per jenis. Disimpan di kolom `penggunaan_bbm.rincian` (`db/rincian-pengeluaran.sql`) dan dijumlah ke kolom slot lama, jadi saldo, rekon, dan Perbandingan tidak berubah. History menampilkan "Rincian (n)"; Rekap & Excel Detail satu baris per nota dengan kolom Keterangan.
- **Pemberitahuan versi baru** — klien memoll `GET /api/health/versi` (binding `CF_VERSION_METADATA`) dan menampilkan banner "Versi baru aplikasi tersedia" + Muat ulang; catatan "Yang baru" (`static/js/rilis.js`) tampil sekali per perangkat setelah login.
- **Pengingat unduh Excel** — `GET /api/tugas-hari-ini` memuat `jalur_hari_ini` dan `unduh_excel` (true untuk PIC CABANG bila semua tugas hari ini selesai dan Excel rekap belum diunduh); `POST /api/rekap/unduh-harian` (PIC CABANG saja; SUPERADMIN/MANAGEMENT 403) menandai sudah diunduh (penanda KV `unduh-rekap:<cabang>:<tanggal>`, TTL 8 hari) dan mencatat audit `UNDUH_HARIAN`.

Catatan M5: tidak ada perubahan schema dan tidak ada upload evidence. Field
bukti hanya `evidence_url` (URL http/https), sedangkan upload foto tetap hanya
untuk odometer melalui `/api/laporan/photos`.