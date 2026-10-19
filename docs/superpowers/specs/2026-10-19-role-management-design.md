# Role MANAGEMENT (monitoring, read-only) — Desain

Tanggal: 2026-10-19

## Tujuan
Menambah role ketiga, `MANAGEMENT`, untuk manajer/direksi yang perlu **memantau semua cabang** tanpa bisa
mengubah data apa pun.

## Ringkasan hak akses

| Kemampuan | SUPERADMIN | MANAGEMENT | PIC CABANG |
|---|---|---|---|
| Cakupan data baca | semua cabang (+ filter) | **semua cabang (+ filter)** | cabangnya |
| Tambah/ubah/hapus data apa pun | ya | **tidak** | cabangnya |
| Dashboard, History, Galeri, Performa, Rekap Pengeluaran | ya | **lihat** | ya |
| Perbandingan Pengeluaran | ya | **lihat** | tidak |
| Daftar & Ringkasan Jalur | ya | **lihat** | ya |
| Daftar Kartu & Riwayat Flazz | ya | **lihat** | ya |
| Data Master (kendaraan, supir, cabang, BBM) | kelola | **lihat** (tanpa daftar pengguna) | kelola cabangnya |
| Buat Jalur, Input Laporan, Top Up, Rekonsiliasi | ya | **tidak** (menu disembunyikan) | ya |
| Pengaturan, Audit Log, Kosongkan Data, kelola Pengguna | ya | **tidak** | tidak |
| Ganti password sendiri, notifikasi push | ya | ya | ya |

## Data
- Nilai role baru: `MANAGEMENT`. Kolom `pengguna.role` bertipe `text` tanpa constraint → **tanpa migrasi skema**.
- `kode_cabang` untuk MANAGEMENT disimpan kosong (`''`), sama seperti SUPERADMIN.
- Validasi `POST/PUT /api/master/pengguna` ([src/routes/master.ts](../../../src/routes/master.ts)) menerima
  `SUPERADMIN | MANAGEMENT | PIC CABANG`; cabang wajib hanya untuk PIC CABANG, dan dikosongkan untuk MANAGEMENT.
- Hanya SUPERADMIN yang dapat membuat/mengubah akun MANAGEMENT (aturan kelola pengguna yang ada).

## Server

### Modul baru `src/auth/peran.ts`
Fungsi murni, satu sumber kebenaran untuk role:
- `normalPeran(u)` → `String(u.role || '').toUpperCase()`
- `isSuper(u)` → SUPERADMIN
- `isManagement(u)` → MANAGEMENT
- `lihatSemuaCabang(u)` → SUPERADMIN atau MANAGEMENT
- `PERAN_VALID` → `['SUPERADMIN', 'MANAGEMENT', 'PIC CABANG']`

### Penjaga tulis terpusat (lapis 1)
Di `requireUser` ([src/auth/middleware.ts](../../../src/auth/middleware.ts)), setelah sesi valid: bila
`isManagement(user)` dan metode bukan `GET`/`HEAD`/`OPTIONS`, tolak **403**
`"Akses ditolak: akun MANAGEMENT hanya dapat melihat data."` (kode `FORBIDDEN`), **kecuali** path dalam daftar izin:
- `POST /api/password` (ganti password sendiri)
- `POST /api/push/langganan`, `POST /api/push/berhenti` (langganan notifikasi milik sendiri)

`POST /api/logout` dan `POST /api/login` tidak memakai `requireUser`, jadi tidak terpengaruh. `/api/admin/salin-foto`
memakai token migrasi, bukan sesi, jadi tidak terpengaruh.

Karena semua route ber-sesi melewati `requireUser`, route tulis yang ditambahkan nanti otomatis ikut terlindungi.

### Cakupan baca (route GET)
Di route GET, cek cakupan cabang `isSuper(u)` diganti `lihatSemuaCabang(u)` agar MANAGEMENT melihat semua cabang dan
boleh memakai filter `?cabang=`:
- `laporan`: `GET /`, `/performa`, `/rekap-pengeluaran`, `/:id`, `/prefill`, `/warnings`
- `dashboard` warnings
- `jalur`: `GET /`, `/drivers`, `/:id`
- `flazz`: `GET /card`, `/card/:id`, `/topup`, `/tol`, `/reconciliation`, `/reconciliation/preview`, `/dashboard`
- `push`: `tugasUntuk` (tugas hari ini semua cabang)
- `master GET /` (`getMasterPayload`): MANAGEMENT menerima kendaraan/supir/cabang/BBM semua cabang dalam bentuk payload
  SUPERADMIN, **tetapi `penggunaList` tetap kosong**.

Cek pada jalur **tulis** tetap memakai `isSuper` (lapis 2): seandainya penjaga tulis terlewati, MANAGEMENT
diperlakukan seperti PIC tanpa cabang, dan cek yang sudah ada menolaknya.

### Tetap khusus SUPERADMIN
`GET /api/audit`, `GET /api/settings/reset-status`, `penggunaList`, dan semua endpoint tulis pengaturan.
`GET /api/settings` (nama aplikasi/footer publik) tetap terbuka seperti sekarang.

### Cache
Kunci cache master/performa sudah memuat `role` → cache MANAGEMENT terpisah dari SUPERADMIN/PIC. Tidak ada perubahan.

## Frontend

- Helper role murni ber-`export` (mis. di `static/js/peran.js`): `isSuper`, `isManagement`, `lihatSemuaCabang`,
  `bolehTulis` (= bukan MANAGEMENT); halaman memakai helper ini, bukan perbandingan string sendiri.
- `navUntuk(role)` ([static/js/app.js](../../../static/js/app.js)): flag `superOnly` diganti `peran: [...]` per item.
  - MANAGEMENT melihat: Dashboard, Daftar Jalur, Ringkasan Jalur, History Laporan, Galeri Foto, Performa,
    Rekap Pengeluaran, Perbandingan Pengeluaran, Daftar Kartu, Riwayat Flazz, Data Master.
  - Disembunyikan untuk MANAGEMENT: Buat Jalur, Input Laporan, Top Up, Rekonsiliasi, Pengaturan, Audit Log.
- Router: MANAGEMENT yang membuka rute input/edit lewat URL (`#/jalur/buat`, `#/jalur/edit`, `#/input`, `#/edit`,
  `#/flazz/topup`, `#/flazz/rekon`, `#/pengaturan`, `#/audit`) dialihkan ke `#/dashboard`.
- Halaman dengan filter warehouse (dashboard, performa, rekap, jalur, flazz, transaksi) menampilkan filter untuk
  MANAGEMENT juga (`lihatSemuaCabang`).
- Perbandingan Pengeluaran: penjaga halaman menerima SUPERADMIN dan MANAGEMENT.
- Tombol tulis (tambah/ubah/hapus/reset oli/edit transaksi/hapus pembayaran) disembunyikan bila `!bolehTulis`.
  Data Master untuk MANAGEMENT tidak menampilkan tab Pengguna.
- Form Pengguna: opsi role ditambah `MANAGEMENT`; isian Warehouse tidak wajib dan dikosongkan untuk MANAGEMENT
  (sama seperti SUPERADMIN).
- Profil/menu pengguna menampilkan `MANAGEMENT` tanpa kode cabang.

## Penanganan galat
- Upaya tulis oleh MANAGEMENT → 403 dengan pesan di atas; frontend menampilkannya lewat toast galat yang ada.
- Role tidak dikenal tetap ditolak seperti sekarang (`Role tidak valid`).

## Pengujian (TDD)
- `tests/auth/peran.test.ts`: helper role (termasuk huruf kecil/spasi).
- Middleware: MANAGEMENT → 403 untuk POST/PUT/PATCH/DELETE di beberapa route; GET lolos; daftar izin lolos;
  SUPERADMIN/PIC tidak berubah.
- Route: MANAGEMENT pada `GET /api/laporan`, `/api/jalur`, `/api/flazz/card` menerima data semua cabang dan
  menghormati `?cabang=`.
- MANAGEMENT ditolak di `GET /api/audit` dan `/api/settings/reset-status`; `penggunaList` kosong di `GET /api/master`.
- `master/pengguna`: membuat MANAGEMENT tanpa cabang berhasil; cabang dikosongkan.
- Frontend (env node): `navUntuk('MANAGEMENT')`, helper `peran.js`, daftar rute terlarang router.

## Di luar cakupan
- Akses MANAGEMENT ke sebagian cabang saja (manajer area).
- Aksi persetujuan (approve) oleh MANAGEMENT.
- Kebijakan RLS Supabase: Worker memakai service role, jadi tidak ada perubahan di `db/rls.sql`.

## Gerbang review
`/security-review` (middleware & cek role), `/ui-ux-pro-max` (menu, halaman), `/code-review:code-review`
(modul baru, lintas file).
