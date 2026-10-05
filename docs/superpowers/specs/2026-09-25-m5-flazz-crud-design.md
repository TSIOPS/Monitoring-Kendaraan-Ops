# M5 — CRUD Flazz & Rekonsiliasi Design

**Tanggal:** 2026-09-25  
**Status:** Draft — menunggu review pengguna  
**Proyek:** `D:\Monitoring Kendaraan Ops Cloud`

## 1. Latar Belakang

M3 sudah mengintegrasikan pembayaran Flazz ke transaksi BBM: lookup kartu,
penyesuaian saldo, usage, dan refund saat edit/delete laporan. Namun CRUD
Flazz penuh dan detach khusus `apiDeleteFlazzBBM` masih menjadi follow-up M5.

M5 membangun domain Flazz di atas tabel yang sudah tersedia:

- `flazz_card`
- `flazz_usage`
- `flazz_topup`
- `flazz_tol`
- `flazz_reconciliation`

Tidak ada tabel baru. M5 juga tidak mengubah alur upload foto transaksi.
Bukti top-up/tol/reconciliation pada M5 berupa `evidence_url`; upload file
khusus ditunda.

## 2. Keputusan Scope

Cakupan M5:

1. CRUD penuh untuk card, top-up, tol, dan reconciliation.
2. Read/list dengan filter sederhana tanpa pagination.
3. Adjust saldo kartu secara eksplisit.
4. Apply dan Ignore untuk reconciliation.
5. Detach Flazz dari payment BBM pada satu laporan tanpa menghapus laporan.
6. Audit semua write dan invalidasi cache master/dashboard.
7. SUPERADMIN dapat mengelola seluruh cabang; PIC CABANG hanya cabang sendiri.

Keputusan yang tidak diubah:

- Saldo kartu berubah karena create/update/delete top-up dan tol, adjust,
  apply reconciliation, serta save/edit/delete laporan M3.
- Laporan M3 tidak otomatis membuat baris `flazz_topup` atau `flazz_tol`;
  ledger dibuat melalui endpoint M5 agar tidak terjadi double-count.
- Detach `apiDeleteFlazzBBM` hanya melepas payment BBM; payment tol tidak diubah.
- `last_balance` tidak boleh diisi atau diedit langsung lewat request update card.

## 3. Arsitektur

### 3.1 Komponen

- `src/db/flazz.ts`
  - Definisikan `FlazzRepo` dan tipe row/domain data.
  - Implementasikan operasi card, top-up, tol, reconciliation, balance, dan usage
    dengan Supabase.
  - `adjustBalance` tetap memakai conditional update untuk penurunan saldo.
- `src/logic/flazz.ts`
  - Fungsi murni untuk normalisasi input, perhitungan delta, perhitungan
    reconciliation, validasi nominal, dan status ledger.
- `src/routes/flazz.ts`
  - `requireUser`, guard role/cabang, validasi HTTP, orkestrasi repo, audit,
    compensation saat gagal, dan invalidasi cache.
- `src/app.ts`
  - Mendaftarkan `/api/flazz` dan memberikan instance `FlazzRepo` yang sama ke
    dependency M3.
- `src/deps.ts`
  - Menambahkan `flazz: FlazzRepo` ke `AppDeps`.
- `src/db/laporan.ts` dan `src/routes/laporan.ts`
  - Tidak lagi memiliki sumber saldo/usage Flazz kedua. Operasi M3 yang
    membutuhkan kartu, saldo, atau usage memakai `deps.flazz`.
  - `LaporanRepo` tetap menjadi sumber data `penggunaan_bbm` dan
    `jalur_pengiriman`.

`flazz_card.last_balance` tetap berasal dari satu tabel PostgreSQL. Read master
yang sudah ada boleh membaca tabel yang sama, tetapi seluruh write saldo
Flazz hanya melalui `FlazzRepo`.

### 3.2 Bentuk data

`FlazzRepo` memakai bentuk data berikut:

- `FlazzCardRow`: seluruh kolom `flazz_card`, termasuk `card_type`,
  `card_role`, `notes`, `created_at`, dan `updated_at`.
- `FlazzTopupRow`: seluruh kolom `flazz_topup`.
- `FlazzTolRow`: seluruh kolom `flazz_tol`.
- `FlazzReconciliationRow`: seluruh kolom `flazz_reconciliation`.
- `FlazzUsageRow`: jenis data usage yang sudah dipakai M3.

ID server menggunakan prefix yang stabil:

- `FLZ-` untuk card
- `TOP-` untuk top-up
- `TOL-` untuk tol
- `REC-` untuk reconciliation

Waktu server disimpan sebagai ISO timestamp. `created_by` dan `created_at`
diisi server; `updated_at` diperbarui server pada setiap write. Cabang tidak
percaya dari body request; cabang efektif diambil dari
`flazz_card.branch_id`.

## 4. API

Semua endpoint wajib `Authorization: Bearer <token>`. Semua response memakai
`okPayload`/`errPayload` yang sudah digunakan project. List ledger secara
default hanya mengembalikan row yang belum soft-delete; `is_deleted=1` harus
diminta eksplisit dan tetap tunduk pada guard cabang.

### 4.1 Card

| Metode | Path | Fungsi |
|---|---|---|
| GET | `/api/flazz/card` | List card; filter `branch_id`, `status`, `q` (nomor atau nama) |
| GET | `/api/flazz/card/:id` | Detail card |
| POST | `/api/flazz/card` | Create card |
| PUT | `/api/flazz/card/:id` | Update metadata card |
| DELETE | `/api/flazz/card/:id` | Nonaktifkan card (`NONAKTIF`) |

Create menerima `card_number`, `card_name`, `card_type`, `card_role`,
`branch_id`, `default_driver_id`, dan `notes`. `card_number`, `card_name`, dan
`branch_id` wajib diisi. `card_type` dan `card_role` boleh kosong. `last_balance`
selalu dimulai `0`, status awal `TERSEDIA`, dan `driver_id` kosong.
`branch_id` harus merujuk cabang yang ada dan nomor kartu harus unik dalam
cabang yang sama.

Update boleh mengubah metadata card dan, jika bukan `SEDANG_DIGUNAKAN`,
status manual antara `TERSEDIA` dan `NONAKTIF`. Update tidak boleh mengubah
`id`, `branch_id`, `last_balance`, atau memaksa status `SEDANG_DIGUNAKAN`.
Delete adalah soft state transition dan ditolak `409` jika usage aktif.
Delete card yang sudah `NONAKTIF` bersifat idempotent dan tetap sukses.

### 4.2 Top-up

| Metode | Path | Fungsi |
|---|---|---|
| GET | `/api/flazz/topup` | List top-up; filter `branch_id`, `card_id`, `date`, `is_deleted` |
| GET | `/api/flazz/topup/:id` | Detail top-up |
| POST | `/api/flazz/topup` | Catat top-up dan tambah saldo |
| PUT | `/api/flazz/topup/:id` | Update tanggal/nominal/evidence/catatan |
| DELETE | `/api/flazz/topup/:id` | Soft-delete dan kurangi saldo |

Create menerima `card_id`, `date`, `amount`, `evidence_url` opsional, dan
`notes` opsional. `card_id` wajib, `amount` harus lebih besar dari nol dan
`date` wajib dalam format `YYYY-MM-DD`. `card_id` tidak dapat dipindahkan
saat update. Create menambah saldo kartu.
Update menghitung `newAmount - oldAmount`; delete mengurangi saldo sebesar
nominal awal. Jika saldo tidak cukup untuk pengurangan, response `409` dan
row tetap aktif. Delete tidak mengubah row fisik menjadi terhapus dan selalu
menulis `is_deleted = '1'`.

### 4.3 Tol

| Metode | Path | Fungsi |
|---|---|---|
| GET | `/api/flazz/tol` | List tol; filter `branch_id`, `card_id`, `date`, `is_deleted` |
| GET | `/api/flazz/tol/:id` | Detail tol |
| POST | `/api/flazz/tol` | Catat tol dan kurangi saldo |
| PUT | `/api/flazz/tol/:id` | Update tanggal/nominal/evidence/catatan |
| DELETE | `/api/flazz/tol/:id` | Soft-delete dan kembalikan saldo |

`amount` harus lebih besar dari nol, `date` wajib dalam format `YYYY-MM-DD`,
dan `card_id` tidak dapat dipindahkan saat update. `driver_id` dan
`vehicle_id` opsional; bila diisi, keduanya harus ada dan berada pada cabang
kartu. `evidence_url` dan `notes` hanya menyimpan string URL/catatan, tanpa
upload file. Create/update/delete mengikuti delta nominal yang sama seperti
top-up, dengan create/delete mengubah saldo secara terbalik. Nominal yang dapat
mengembalikan saldo tidak boleh membuat saldo negatif; kondisi tersebut
menghasilkan `409` tanpa perubahan data.

### 4.4 Reconciliation

| Metode | Path | Fungsi |
|---|---|---|
| GET | `/api/flazz/reconciliation` | List snapshot; filter `branch_id`, `card_id`, `date`, `is_deleted` |
| GET | `/api/flazz/reconciliation/:id` | Detail snapshot |
| POST | `/api/flazz/reconciliation` | Buat snapshot hasil rekonsiliasi |
| PUT | `/api/flazz/reconciliation/:id` | Update snapshot sebelum apply |
| DELETE | `/api/flazz/reconciliation/:id` | Soft-delete snapshot |
| POST | `/api/flazz/reconciliation/:id/apply` | Terapkan `actual_balance` ke kartu |
| POST | `/api/flazz/reconciliation/:id/ignore` | Tandai selisih diabaikan |

Field input wajib untuk create/update adalah `card_id`, `date`,
`opening_balance`, `total_topup`, `total_bbm_flazz`, `total_tol`,
`actual_balance`, dan `notes` opsional. `driver_id` dan `vehicle_id` opsional
dan harus berada pada cabang kartu bila diisi. Semua nominal harus finite dan
tidak negatif; `card_id` dan `date` tidak dapat dipindahkan pada update. Field
terhitung disimpan oleh server:

```text
total_expense = total_bbm_flazz + total_tol
flazz_balance = opening_balance + total_topup - total_expense
difference    = actual_balance - flazz_balance
```

Create/update tidak mengubah saldo kartu. Update hanya boleh pada status
`UNRECONCILED` atau `IGNORED`. Status awal/akhir yang dipakai adalah
`UNRECONCILED`, `APPLIED`, atau `IGNORED`. `apply` hanya berlaku pada status
`UNRECONCILED`, mensyaratkan `actual_balance >= 0`, mengisi
`reconciled_by`/`reconciled_at`, dan mengikuti aturan timestamp opening usage
yang sama dengan M3, mengubah saldo kartu secara eksplisit, lalu menetapkan
status `APPLIED`.
`ignore` hanya berlaku pada status `UNRECONCILED`, menetapkan status `IGNORED`,
dan tidak mengubah saldo atau saldo perhitungan. Snapshot yang sudah `APPLIED`
tidak dapat diedit atau dihapus; koreksi dibuat dengan snapshot baru.

### 4.5 Adjust

`POST /api/flazz/card/:id/adjust` menerima:

```json
{ "delta": -25000, "reason": "Koreksi hasil rekap" }
```

`delta` tidak boleh nol dan `reason` wajib. Penurunan saldo tidak boleh
menghasilkan saldo negatif. Opening balance usage aktif mengikuti aturan
timestamp yang sama dengan M3: perubahan sebelum usage diberikan memengaruhi
opening, sedangkan perubahan setelah usage diberikan tidak menulis ulang
histori opening.

### 4.6 Detach BBM pada laporan

`DELETE /api/laporan/:id/flazz` hanya berlaku bila payment BBM laporan
memakai Flazz. Endpoint ini:

1. Load laporan dan kartu BBM; validasi akses cabang.
2. Simpan state payment lama.
3. Ubah `metode_pembayaran` menjadi `TUNAI` bila nominal BBM masih lebih
   besar dari nol, atau kosong bila nominalnya nol.
4. Kosongkan `flazz_card_id`; jangan mengubah `metode_toll` atau
   `flazz_card_id_toll`.
5. Kembalikan charge BBM ke kartu.
6. Kembalikan usage kartu BBM hanya bila kartu tersebut tidak masih dipakai
   untuk tol pada laporan yang sama.
7. Audit dan invalidate cache.

Jika laporan tidak memakai Flazz BBM, response `409` dengan pesan yang jelas.
Detach tidak menghapus laporan, foto, atau ledger top-up/tol.

## 5. Akses, Validasi, dan Status

### 5.1 Role dan cabang

- `SUPERADMIN`: dapat membaca dan menulis seluruh cabang.
- `PIC CABANG`: hanya dapat membaca dan menulis data dengan
  `flazz_card.branch_id = session.cabang`.
- Filter `branch_id` dari client tidak dapat memperluas akses PIC.
- Driver/vehicle yang diberikan pada tol diverifikasi terhadap cabang bila
  referensinya tersedia.
- Semua write melakukan `recordAudit` setelah operasi berhasil; data
  sebelum/sesudah dipotong dengan `jsonSnip`.

### 5.2 Validasi

- Semua ID yang ditulis harus ada.
- Card harus berstatus dapat dipakai untuk operasi saldo/ledger.
- Nominal harus angka finite, tidak negatif, dan sesuai aturan operasi.
- Tanggal ledger dan reconciliation yang baru wajib berformat `YYYY-MM-DD`;
  row legacy dengan tanggal kosong hanya dapat dibaca.
- `actual_balance` tidak boleh negatif.
- Card tidak dapat dinonaktifkan/diubah lintas cabang oleh PIC.
- Entity yang sudah soft-deleted tidak dapat diedit atau di-apply/delete
  ulang.

### 5.3 Error

- `400`: body tidak valid, field wajib hilang, atau tanggal/nominal invalid.
- `401`: token tidak valid.
- `403`: role atau cabang tidak berwenang.
- `404`: card/ledger/reconciliation/laporan tidak ditemukan.
- `409`: duplicate, card nonaktif, usage aktif, saldo tidak cukup, atau
  mencoba apply/delete reconciliation yang immutable.
- `500`: kegagalan internal; response tidak membocorkan detail database.

Pesan umum dan prefix GAS yang sudah digunakan M2/M3 dipertahankan. Error
baru Flazz boleh memakai pesan Indonesia yang konsisten dengan `HttpError`.

## 6. Atomicity, Cache, dan Audit

- Penurunan saldo memakai conditional update berdasarkan saldo yang dibaca;
  kegagalan karena race menjadi `409`.
- `apply` hanya menandai reconciliation `APPLIED` setelah perubahan saldo
  berhasil; kegagalan tidak meninggalkan status baru.
- Operasi yang mengubah ledger dan saldo melakukan kompensasi bila tahap
  kedua gagal: hapus/mengembalikan record ledger atau mengembalikan delta
  saldo. Repo in-memory test harus meniru perilaku ini.
- `bumpMasterRev` dipanggil pada perubahan saldo/status card atau ledger
  yang memengaruhi master.
- `invalidateDashwarn` dipanggil bila status/usage kartu berubah.
- Read list tidak diaudit.
- Audit action: `CREATE`, `EDIT`, `DELETE`, `ADJUST`, `APPLY`, dan `IGNORE`
  memakai `modul = 'flazz'`. `DETACH` memakai `modul = 'transaksi'` karena
  mengubah state laporan, dengan detail kartu dan saldo sebelum/sesudah.

Tidak ada transaksi global. Kompleksitas konkurensi harus dibatasi dengan
conditional update dan test race-adjusted, bukan dengan lock global.

## 7. Testing dan Acceptance

### 7.1 Unit logic

`tests/logic/flazz.test.ts` harus menguji:

- normalisasi nominal dan tanggal;
- delta top-up/tol pada create, update, delete;
- perhitungan seluruh field reconciliation;
- validasi saldo negatif;
- status apply/ignore.

### 7.2 Repository memory

`memFlazz` di `tests/helpers.ts` harus mendukung:

- card, top-up, tol, reconciliation, usage, dan status soft-delete;
- conditional `adjustBalance`;
- compensation failure;
- list dengan filter cabang/card/date.

Helper M3 harus memakai state Flazz yang sama dengan `LaporanRepo`/routes
supaya test save/edit/delete laporan tetap memverifikasi saldo dan usage.

### 7.3 Route

`tests/routes/flazz.test.ts` harus menguji:

- auth dan role/cabang isolation;
- card CRUD, deactivation, dan active-usage conflict;
- top-up/tol create, update, delete, dan saldo;
- reconciliation create/edit/apply/ignore/delete;
- adjust saldo dan usage opening;
- detach payment BBM tanpa mengubah tol;
- audit setiap aksi dan invalidasi cache;
- error malformed, not found, duplicate, inactive card, dan insufficient
  balance.

Regression M3 wajib tetap hijau untuk save/edit/delete laporan, termasuk
refund dan return usage.

### 7.4 Gate

- `npm run typecheck` harus hijau.
- `npm test` harus hijau.
- `npm run lint` harus dijalankan bila script lint tersedia di `package.json`.
- Tidak ada migration tabel baru; schema diverifikasi terhadap script yang
  berlaku.

## 8. Deliverables dan Urutan Kerja

1. `src/db/flazz.ts`, tipe domain, dan `FlazzRepo` Supabase.
2. `src/logic/flazz.ts` dan unit test perhitungan/validasi.
3. `memFlazz` di `tests/helpers.ts` dan adaptasi dependency M3.
4. `src/routes/flazz.ts`, route detach di `src/routes/laporan.ts`, wiring
   `AppDeps` dan `src/app.ts`.
5. `tests/routes/flazz.test.ts` dan regression M3.
6. Update README dan dokumentasi milestone M5 setelah seluruh gate hijau.

Tidak ada deploy dalam scope implementasi M5.
