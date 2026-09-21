# M3 — Laporan / Transaksi BBM (Daily Transaction) Design

**Tanggal:** 2026-09-21
**Status:** Selesai diimplementasikan (M3) — lihat `docs/superpowers/plans/2026-09-21-m3-laporan-transaksi-bbm.md`
**Proyek:** `D:\Monitoring Kendaraan Ops Cloud` (port Cloudflare Workers + Supabase dari GAS)

## 1. Latar Belakang & Sumber

M2 (data master + audit + pengaturan) selesai. Milestone berikutnya adalah modul
**laporan harian / transaksi BBM** (`penggunaan_bbm`), digali langsung dari alur
script GAS (bukan daftar milestone README):

- `src/Code.js` — wrapper API: `getLastLaporanPrefill`, `processDailyImages`,
  `saveDailyTransaction`, `apiEditDailyTransaction`, `apiDeleteDailyTransaction`,
  `getPerformaData`, `getDashboardData`.
- `src/SpreadsheetOps.js` — inti logika: `saveTransactionEndOfDayUnlocked`,
  `editDailyTransactionUnlocked`, `deleteDailyTransactionUnlocked`,
  `isDuplicateTransaction`, `getLastTransactionForVehicle`,
  `currentOdoPerVehicle`, `lastKmSumberPerVehicle`, `getRecentTransactions`,
  `getPerformaSummary`, `hitungEfisiensi7Riwayat`, `buildOdoWarning`.
- `src/PaymentLogic.js` — logika murni pembayaran: `resolveTollMethod`,
  `resolveTollCard`, `distinctFlazzCards`, `flazzCardCharge`, `flazzEditDelta`,
  `parseEditAmount`, `parseEditMethod`.
- `src/SummaryOps.js` — ringkasan bulanan (sheet `Dashboard`).
- `src/JalurOps.js` & `src/FlazzOps.js` — gate & efek samping yang dipakai alur transaksi.
- `src/js.html` — alur klien: prefill → upload foto → save → riwayat/dashboard.

Keputusan kunci dari brainstorming:
- **Cakupan = alur transaksi penuh** sesuai script: CRUD laporan (save 2-langkah,
  edit, hapus) + prefill + performa + riwayat transaksi + ringkasan bulanan,
  **plus** efek samping Flazz (saldo & usage) dan gate/status Jalur yang dibutuhkan
  transaksi. Yang **ditunda**: warnings dashboard (M4), CRUD Flazz penuh & delet
  spesifik Flazz `apiDeleteFlazzBBM` (M5), CRUD Jalur penuh (M7), fuel-detect,
  backup/admin, migrasi data (M8), frontend.
- **Model upload foto 2-langkah** persis GAS: `POST /api/laporan/photos` dulu,
  lalu `POST /api/laporan` dengan `serverData.files`.
- **Pendekatan A + C-parsial**: lapisan repo–logic–route di TS dengan in-memory
  repo untuk test; satu titik atomicity ekstra — potong saldo Flazz pakai
  conditional `UPDATE`.

## 2. API Surface

Semua endpoint `Authorization: Bearer <token>` → `requireUser`. Konvensi respons
M2 (`okPayload` / `errPayload`); **pesan error GAS dipertahankan kata-per-kata**
agar transisi frontend nanti tidak mengubah isi string. Guard peran/cabang
selalu di server-side.

| Metode | Path | Port GAS | Fungsi |
|---|---|---|---|
| POST | `/api/laporan/photos` | `processDailyImages` | upload 2 foto odometer (base64 → Storage) → `{ success, files: { odo_awal, odo_akhir }, km_awal, km_akhir }` |
| POST | `/api/laporan` | `saveDailyTransaction` | simpan transaksi (gate jalur → gate Flazz → cek duplikat → insert → potong saldo/usage → flip jalur → audit) |
| PUT | `/api/laporan/:id` | `apiEditDailyTransaction` | koreksi (semantik full-form, delta Flazz, adjust usage, re-link jalur, ganti foto opsional, audit) |
| DELETE | `/api/laporan/:id` | `apiDeleteDailyTransaction` | hapus (refund Flazz, return usage, release jalur, audit) |
| GET | `/api/laporan/prefill` | `getLastLaporanPrefill` | prefill transaksi terakhir yang memenuhi syarat |
| GET | `/api/laporan/performa` | `getPerformaData` | performa 7-trip per kendaraan |
| GET | `/api/dashboard` | `getDashboardData` | `{ transactions: riwayat, monthly: ringkasan bulanan }` |

Response foto menyampaikan `files.odo_awal/odo_akhir` (URL publik Storage) dan
`km_awal/km_akhir` (echo client) — kontrak yang sama dengan `processDailyImages`.
`struk_bbm`/`struk_toll` tidak pernah diisi klien saat ini (sama seperti GAS;
tetap disediakan di payload `serverData.files` bila ada).

## 3. Data Model & Perubahan Schema

- **Tabel ada, tidak ada tabel baru.** `penggunaan_bbm`, `flazz_card`,
  `flazz_usage`, `jalur_pengiriman` sudah di `db/schema.sql`.
- **Kolom `seq bigint generated always as identity`** pada `penggunaan_bbm`
  (menggantikan "urutan baris spreadsheet" GAS; Postgres tak punya urutan bawa'an;
  menghindari masalah data lama ber-`timestamp` kosong yang tercatat di plan M2).
  Kunci untuk: `lastTransactionForVehicle`, `currentOdoPerVehicle`, cek duplikat
  (200 baris terakhir), prefill.
- **Index tambahan:**
  - `idx_penggunaan_vehicle on penggunaan_bbm (vehicle_id)`
  - `idx_flazz_usage_ref on flazz_usage (ref_type, ref_id)`
  - `idx_jalur_gate on jalur_pengiriman (tanggal, vehicle_id, kode_cabang)`
- **Ringkasan bulanan tidak ditabelkan.** Sheet `Dashboard` GAS sudah dihapus
  (design spec §3: "query langsung + cache KV"). `monthly` dihitung
  `group by kode_cabang, bulan(tanggal)` di `GET /api/dashboard`. Efek samping
  `adjustMonthlySummary` pada save/edit/delete **dihilangkan**.
- **Bucket Storage baru `foto`** (path `<kode-cabang>/KM_Awal` &
  `<kode-cabang>/KM_Akhir`), terpisah dari bucket `settings`. URL disimpan inline
  di kolom foto `penggunaan_bbm`. `foto_evidence` dibiarkan tak dipakai (sama GAS).

## 4. Komponen & Arsitektur

Tiga lapis (pola M2):

- **`src/db/laporan.ts`** — `LaporanRepo` + `supabaseLaporanRepo(env)`:
  - `penggunaan_bbm`: `findById`, `lastForVehicle`, `recentRows`,
    `rowsInScope`, `duplicateCandidates`, `insert`, `update`, `delete`.
  - `flazz_card`: `findById` (balance/name/status/branch), `adjustBalance(cardId, delta)`
    dengan **conditional `UPDATE ... SET last_balance = last_balance ± d
    WHERE last_balance >= d`** bila menurun, `setBalance`.
  - `flazz_usage`: `hasActiveUsage`, `createUsage`, `adjustActiveUsageOpening`,
    `returnUsageForRef`, `latestGivenAt`.
  - `jalur_pengiriman`: `findByCriteria`, `setStatus`, `release`.
- **`src/logic/laporan.ts`** — **fungsi murni (tanpa I/O)**, port 1:1:
  - PaymentLogic: `resolveTollMethod`, `resolveTollCard`, `distinctFlazzCards`,
    `flazzCardCharge`, `flazzEditDelta`, `parseEditAmount`, `parseEditMethod`.
  - Estimasi KM rusak (3 kasus + pesan error GAS), `buildOdoWarning`,
    perhitungan `literKonsumsi`/`efisiensi`, `storeMetodeBbm`.
  - `hitungEfisiensi7Riwayat` + klasifikasi status performa,
    mapping baris recent/prefill.
- **`src/routes/laporan.ts`** — `laporanRoutes(deps)` + dashboard ditambahkan di
  `src/app.ts`. Orkestrasi end-to-end: guard → logic → repo → audit → invalidate.

**Dependensi:** `deps.ts` + `laporan: LaporanRepo`. `storage.ts` +
`uploadEvidence` / `deleteEvidence` (mime whitelist `jpeg/png/webp/heic/heif`,
max 10 MB, nama acak, path folder). `logic/master-cache.ts` +
`performaCacheKey`, `invalidatePerforma`. `kendaraan` lookup mengulang pakai
`deps.master.findKendaraanById`.

## 5. Alur Data

### Save — `POST /api/laporan` (port `saveTransactionEndOfDayUnlocked`)

1. Load `kendaraan` → `plat_nomor`, `kode_cabang`, `kapasitas`, `jumlah_bar`,
   `standar_km_l`, `is_jarum`. Cabang **dari master kendaraan**, bukan client.
2. PIC (non-SUPERADMIN): cabang kendaraan harus = cabang sesi, else 403.
3. **Gate Jalur**: `findByCriteria({tanggal, vehicle_id, nama_driver, kode_cabang})`
   harus ada & `status === 'BELUM_DIISI'`, else 409 pesan GAS.
4. `is_jarum` → `jumlah_bar = 100`; `literPerBar`; `literKonsumsi = liter +
   (bar_awal - bar_akhir) * literPerBar` (clamp bila ≤ 0 → `liter`).
5. `prevTrx = lastForVehicle`; estimasi KM rusak (kasus awal/akhir/keduanya rusak,
   `km_tanpa_estimasi`, dua pesan error bila estimasi tak tersedia).
6. `efisiensi = km_tempuh/literKonsumsi` (2 desimal, '' bila nol) &
   `buildOdoWarning` bila `prevTrx.km_akhir !== km_awal`.
7. Resolusi tol efektif (`resolveTollMethod`/`resolveTollCard`).
8. **Gate saldo Flazz** per kartu (gabungan BBM+tol per kartu; kartu tak ada →
   409 "tidak ditemukan"; saldo < total → 409 "tidak mencukupi", pesan GAS).
9. `storeMetodeBbm` (`biaya_bbm > 0 ? (metode || 'TUNAI') : ''`).
10. **Cek duplikat**: kunci `(vehicle_id, tanggal, km_awal, km_akhir, liter,
    biaya_bbm, biaya_toll)` terhadap 200 baris terakhir (`seq desc limit 200`)
    → match → 409 "Laporan sudah pernah disimpan…".
11. `insert` baris (kolom 1:1 GAS; `km_sumber`, `metode_toll`, `flazz_card_id_toll`,
    status `COMPLETED`, warning).
12. Per kartu terlibat: `recordFlazzExpense` BBM & TOL (potong saldo, dipisah
    nominalnya) + `createUsage` (`used_at` = timestamp trx; skip bila sudah
    `DIBERIKAN` atau kartu `NONAKTIF`). Bila conditional potong saldo gagal
    (0 baris, race) → **hapus baris yang baru diinsert, balas 409** —
    bukan ditelan seperti GAS.
13. `setStatus(matchedJalur.id, 'SUDAH_LAPORAN', trx_id)`.
14. `audit CREATE` (`{cabang, vehicle, km_tempuh, liter, biaya}`).
15. `invalidatePerforma`; bila `usedFlazz` → `bumpMasterRev`.

### Edit — `PUT /api/laporan/:id` (port `editDailyTransactionUnlocked`)

1. Load baris, capture old state (metode, kartu, toll, biaya, tol, liter,
   nama, cabang, tanggal, vehicle).
2. Infer old toll method/card (kolom kosong + BBM Flazz → tol ikut kartu BBM).
3. `assertTransactionAccess` (cabang dari kartu Flazz bila ber-Flazz, else dari
   kendaraan); PIC cabang beda → 403.
4. `parseEditMethod`/`parseEditAmount` ('' → batal/0; `undefined` → pertahankan).
5. Resolusi kartu baru dengan guard server (Flazz tanpa kartu → "Pilih kartu…";
   ganti kartu harus ada di master & boleh diakses).
6. `distinctFlazzCards(old) + distinctFlazzCards(new)`; `flazzEditDelta` negatif
   dan saldo tak cukup → 409 pesan GAS.
7. Update kolom payment, `liter_bbm`, `nama_supir`, `km_awal/akhir` (recompute
   `km_tempuh`, jika KM diedit → paksa `km_sumber = 'AKTUAL'`), `bar_awal/akhir`,
   `tanggal`.
8. Reconcile saldo per kartu `delta != 0` → `adjustBalance`; bila
   `shouldAdjustUsageOpeningAt(card, txStampMs)` → `adjustActiveUsageOpening`.
9. `createUsage` hanya saat transisi non-Flazz → Flazz
   (`shouldAutoCreateUsageOnEdit`).
10. Ganti foto opsional: upload baru → hapus lama (`extractId` + `deleteEvidence`).
11. Jalur: bila `tanggal`/`nama` berubah → `release` dulu; re-link via
    `findByCriteria` + `setStatus('SUDAH_LAPORAN')` bila bukan `SELESAI`.
12. `audit EDIT` (sebelum/sesudah pay state). Tidak menulis timestamp baru.
13. `invalidatePerforma` + `invalidateMaster` (bump rev).

### Delete — `DELETE /api/laporan/:id` (port `deleteDailyTransactionUnlocked`)

1. Load baris, capture pay state (+ liter/cabang/tanggal).
2. Infer old toll method/card; `assertTransactionAccess`.
3. Hard delete baris.
4. Per kartu terlibat: refund `+charge` via `adjustBalance`, `adjustActiveUsageOpening`
   bila `shouldAdjustUsageOpeningAt`, dan `returnUsageForRef('TRX', id)`.
5. `releaseJalurReport(id)`.
6. `audit DELETE` (sebelum data).
7. `invalidatePerforma` + `invalidateMaster`.

### Baca

- **`GET /api/laporan/prefill`** — baris terakhir memenuhi syarat
  (`seq desc`; PIC scope cabang; `vehicle_id` non-empty) → objek
  `{ vehicle_id, plat_nomor, nama_supir, tanggal, bar_awal, bar_akhir,
  biaya_bbm, liter_bbm, metode_pembayaran, flazz_card_id, metode_toll,
  flazz_card_id_toll }` (resolusi tol via `resolveTollMethod`/`resolveTollCard`,
  kartu via `resolveCanonicalCardId` = strip `-`). Tak ada → `pref: null`.
  GAS mengembalikan `{ error, pref: null }` pada exception; dipetakan ke HTTP error.
- **`GET /api/laporan/performa`** — baris scope cabang → grup per kendaraan,
  sort `(tanggal, timestamp)` → window 7-trip **non-overlap** (`(i+1)%7===0`) →
  `hitungEfisiensi7Riwayat` → klasifikasi status (`Di bawah/Sesuai/Di atas
  standar`) vs `standar_km_l` → output bentuk GAS (`periode, timestamp, cabang,
  vehicle, supir, total_km, total_beli, total_konsumsi, efisiensi,
  status_efisiensi`) → sort `timestamp` desc. Cache KV 300 dtk.
- **`GET /api/dashboard`** — `transactions`: 200 baris terakhir scope cabang →
  grup per kendaraan → sort → `hitungEfisiensi7Riwayat` **rolling** + warning
  odo **dinamis** (`buildOdoWarning` dari prev baris kendaraan) → bentuk baris GAS
  (incl. `foto_*_thumb` via transformasi image Supabase `?width=200`) → sort
  `(tanggal, sub_timestamp)` desc. `monthly`: `group by cabang, bulan(tanggal)`
  periode berjalan → `{cabang, periode, total_transaksi, total_liter,
  total_biaya_bbm, total_toll}`; SUPER semua cabang, PIC cabang sendiri; cache KV 300 dtk.

## 6. Konkurensi, Error Handling, Caching

- **Konkurensi:** tanpa lock global. Op dibentuk dari statement atomik;
  penurunan saldo Flazz selalu conditional (`WHERE last_balance >= amount`).
  Kegagalan potong saldo saat save → rollback baris (delete) + 409. Refund selalu
  aman (kenaikan saldo). Tidak ada transaksi DB multi-statement (konsisten M2).
- **Error/status:** `errPayload`; `401` sesi invalid, `403` PIC lintas cabang /
  peran tidak berwenang, `404` transaksi tidak ditemukan (edit/hapus), `409`
  gate jalur / saldo Flazz / duplikat, `422` upload foto gagal, `400` badan tak
  valid. Pesan GAS dipertahankan.
- **Audit:** ditulis setelah op sukses (`CREATE`/`EDIT`/`DELETE` modul `transaksi`),
  payload `data_sebelum`/`data_sesudah` ringkas (maks 2000 char, pola `jsonSnip`).
- **Caching:** `performaCacheKey`/`invalidatePerforma` baru di
  `logic/master-cache.ts`. `performa` & `monthly` cache KV 300 dtk (key
  role+cabang). Save/edit/delete yang menyentuh Flazz → `bumpMasterRev`
  (refresh saldo di cache `/api/master`). Riwayat & prefill selalu hitung
  langsung.

## 7. Testing

- **Unit murni** `tests/logic/laporan.test.ts`: matriks `resolveTollMethod` /
  `resolveTollCard`; `flazzEditDelta` (refund/charge, detach); odo estimation
  (awal/akhir/keduanya rusak, `km_tanpa_estimasi`, error tanpa estimasi);
  `literKonsumsi` & efisiensi & `buildOdoWarning`; `hitungEfisiensi7Riwayat`
  (batas 7 baris, `adaEstimasi` label, slice negatif diindeks 0); klasifikasi
  status; mapping baris recent/prefill; `flazzCardCharge`.
- **Route** `tests/routes/laporan.test.ts` (deps in-memory + fake storage):
  save happy path + gate jalur 409 + gate saldo 409 + duplikat 409 + PIC lintas
  cabang 403; edit penuh/parsial/delta-flazz/ganti foto; delete refund + return
  usage + release jalur; prefill null/nilai + scope PIC; performa window;
  dashboard monthly grouping; audit tercatat benar; invalidasi dipanggil
  (performa + master bila Flazz).
- **Helpers:** `memLaporan` di `tests/helpers.ts` (state in-memory
  penggunaan_bbm/flazz_card/flazz_usage/jalur_pengiriman), di-wire ke
  `AppDeps.laporan`; fake storage untuk upload foto.
- **Gate:** `npm run typecheck` dan `npm test` harus hijau.

## 8. Deliverables & Urutan Kerja

1. **Skema**: kolom `seq` + index di `db/schema.sql` & `scripts/apply-schema.mjs`
   (juga `scripts/verify-schema.mjs` opsional).
2. **`src/logic/laporan.ts`** + `tests/logic/laporan.test.ts`.
3. **`src/db/laporan.ts`** + `memLaporan` di `tests/helpers.ts`.
4. **`src/routes/laporan.ts`** + `/api/dashboard` + wiring `deps`/`app.ts` +
   `storage.uploadEvidence` + `performaCacheKey`/`invalidatePerforma`.
5. **`tests/routes/laporan.test.ts`** + uji invalidasi.
6. Update **README** tabel API & status milestone di design spec ini.
7. `npm run typecheck` + `npm test` hijau; deploy opsional.

Opsional di luar scope: endpoint `apiDeleteFlazzBBM` (detach — M5), warnings
dashboard (M4), CRUD jalur (M7), fuel-detect, backup, migrasi data (M8),
frontend.