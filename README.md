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

## Perintah
| Script | Fungsi |
|---|---|
| `npm run dev` | wrangler dev lokal |
| `npm run deploy` | deploy ke *.workers.dev |
| `npm test` | vitest |
| `npm run typecheck` | tsc --noEmit |

## Catatan keamanan
- Role/cabang tidak pernah dari client; dicek `requireUser`.
- Rate limit login 5x/5mnt per username (KV).
- Hash password format kompatibel GAS (tidak perlu reset saat migrasi).

## API (status M5 — fondasi + master + settings + audit + laporan + warnings + Flazz CRUD)
| Metode | Path | Akses | Keterangan |
|---|---|---|---|
| POST | `/api/login` | publik | login → session token (KV, 12 jam) |
| POST | `/api/logout` | token | hapus session |
| GET | `/api/health` | publik | health check |
| GET | `/api/master` | role+cabang | payload master (cache KV 30 dtk) |
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
| POST | `/api/laporan` | PIC/SUPERADMIN | simpan transaksi BBM (gate jalur & Flazz, potong saldo, usage, audit) |
| PUT | `/api/laporan/:id` | PIC/SUPERADMIN | koreksi transaksi (delta Flazz, ganti foto, re-link jalur) |
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
- **Pengingat 16:30 WIB** — banner tugas hari ini (kuning sepanjang hari, merah + pop-up mulai 16:30) dan Web Push (Cron `30 9 * * *` UTC). Langganan per perangkat di KV (`push:*`), aktifkan di Dashboard → Notifikasi HP. Kunci VAPID: publik di `wrangler.jsonc`, privat di secret `VAPID_PRIVATE_JWK`. iPhone: pasang ke Layar Utama dulu.
- **Pengaturan** (menu Admin, SUPERADMIN) — logo, nama aplikasi, nama perusahaan,
  footer. `PUT /api/settings` tanpa `logo_url` mempertahankan logo; URL logo
  diberi `?v=` agar logo baru tidak tertahan cache.
  (`GET /api/laporan/rekap-pengeluaran?dari=&sampai=&cabang=`).
  Berikutnya: cutover dari GAS.

Catatan M5: tidak ada perubahan schema dan tidak ada upload evidence. Field
bukti hanya `evidence_url` (URL http/https), sedangkan upload foto tetap hanya
untuk odometer melalui `/api/laporan/photos`.