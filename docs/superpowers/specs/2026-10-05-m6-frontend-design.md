# M6 Frontend — Desain

**Status:** Disetujui
**Tanggal:** 2026-10-05
**Milestone:** M6 (setelah M5 Flazz CRUD selesai)

---

## 1. Konteks & Tujuan

Migrasi dari Google Apps Script ke Cloudflare Workers + Supabase sudah
memfondoasi backend penuh (M1–M5). Semua endpoint hidup di
`https://monitoring.kendaraanoprtsi.workers.dev`, tetapi tidak ada antarmuka
yang memakainya: `static/index.html` masih halaman placeholder 405 byte.
Aplikasi belum dapat dipakai — tidak ada login, tidak ada input laporan.

M6 membangun frontend dari nol. File UI GAS yang asli tidak tersedia, jadi
tidak ada yang bisa di-reuse; seluruh UI ditulis baru.

### Prinsip utama

**UI tetap tipis di atas API.** Backend sudah mengisolasi logika di
`src/logic/`. Frontend meniru pola itu. Tidak ada perhitungan bisnis di
klien: perhitungan liter, KM ideal, efisiensi, warnings, dan deteksi duplikat
semuanya sudah ada di server. Yang ada di klien hanya tiga hal — ambil data,
render, kirim input.

Halaman yang dibangun di M6:

| Halaman | Endpoint yang dipakai |
|---|---|
| Login | `POST /api/auth/login`, `GET /api/auth/session`, `POST /api/auth/logout` |
| Transaksi + dashboard | `GET /api/laporan` |
| Input laporan | `GET /api/master`, `GET /api/laporan/prefill`, `POST /api/laporan/photos`, `POST /api/laporan` |
| Edit laporan | `GET /api/master`, `PUT /api/laporan/:id` |
| Aksi baris | `DELETE /api/laporan/:id`, `DELETE /api/laporan/:id/flazz` |

Tidak dibangun di M6: master CRUD (Superadmin), Flazz, settings, audit.
Endpoint-nya sudah ada dan tidak berubah.

---

## 2. Keputusan Arsitektur

### Stack

Vanilla JS + Bootstrap 5, **tanpa build step**. Seluruh pekerjaan M6 berada di
`static/`. Nol perubahan di `src/`, `db/`, dan `scripts/`. `npm run dev` dan
`wrangler deploy` tetap sesederhana sekarang.

Alasan: backend sudah Production-ready dan ter-deploy; M6 tidak boleh
menambah failure mode baru. Tanpa build step berarti tidak ada artefak yang
bisa stale di produksi.

### Struktur file

```
static/
  index.html          shell tunggal: navbar + <main id="view">
  css/app.css         tema, layout, tabel, form, badge
  js/
    store.js          fondasi: token, user, state  (TIDAK mengimpor api/ui)
    api.js            wrapper fetch: header Authorization, unwrap payload, error
    ui.js             esc(), el(), tabel, toast, spinner, format angka/tanggal
    router.js         hash routing + dynamic import
    app.js            entry: boot, deteksi session, pasang router
    pages/
      login.js
      transaksi.js    tabel + dashboard ringkas
      input.js        form input laporan (mode tambah)
      edit.js         form edit (mode ubah)
```

### Modul satu arah (anti circular import)

```
store.js  ←  api.js  ←  router.js, pages/*.js
   ↑                      ↑
   └──────  ui.js  ───────┘
```

`store.js` berdiri sendiri. `api.js` menggabungkan request, header
`Authorization`, dan pemetaan payload; saat 401 ia memanggil aksi reset
session di store lalu melempar. `ui.js` murni presentasi, tidak tahu HTTP.

Aturan yang ditegakkan lewat konvensi, bukan tooling:

- `store.js` tidak pernah mengimpor `api.js` atau `ui.js`.
- Semua `import` di bagian atas file, bukan di tengah fungsi.
- Satu file satu tanggung jawab.
- Modul yang "lebih tinggi" tidak boleh diimpor oleh modul yang "lebih rendah".

JS statis tidak punya type checking maupun deteksi circular import; keduanya
hanya gagal saat runtime di perangkat user. Karena itu disiplin ini masuk spec.

### Routing

Hash-based: `#/transaksi`, `#/input`, `#/edit/:id`. Hash tidak pernah
dikirim ke server, jadi Cloudflare Assets menyajikan file statis apa adanya
tanpa aturan rewrite di `wrangler.jsonc`. Path-based membutuhkan rewrite yang
bisa salah konfigurasi.

Halaman dimuat dengan dynamic `import()` saat dibutuhkan. Konsekuensi yang
diterima: satu request tambahan saat pindah halaman.

### Penyimpanan token

`localStorage` dengan kunci `m6.token` dan `m6.user`. Dipilih karena API yang
ada membaca header `Authorization: Bearer`, bukan cookie — memakai cookie
httpOnly menuntut perubahan backend yang sudah disetujui selesai.

Konsekuensi yang diterima: token dapat dibaca JavaScript, sehingga
ketahanan terhadap XSS penting. `esc()` wajib dipakai saat menyisipkan data
ke `innerHTML`.

### Upload foto

`<input type="file" accept="image/*" capture="environment">` — di HP membuka
kamera langsung. Klien resize ke lebar maksimal 1600px dan encode JPEG
quality 0.8 via `<canvas>`, lalu kirim base64 ke `POST /api/laporan/photos`.
Kompresi klien mencegah foto HP 4–8 MB (base64 menambah ±33%) membanjiri
request.

Foto di-upload **sebelum** `POST /api/laporan`. Jika upload gagal, seluruh
isi form tetap utuh. Jika `POST` gagal setelah upload sukses, mungkin ada file
yatim di Storage — harga yang jauh lebih murah daripada user kehilangan
isian. URL hasil upload disimpan di field hidden agar percobaan ulang tidak
meng-upload ulang.

---

## 3. Halaman

### 3.1 Login

`POST /api/auth/login` dengan `{username, password}`. Server membalas
`{token, user}`. both disimpan ke `localStorage`, lalu arahkan ke `#/transaksi`.

Rate limit 5 percobaan per 5 menit ditangani server (429). UI menampilkan
pesan itu apa adanya, termasuk sisa detik yang dikembalikan server.

### 3.2 Transaksi + dashboard

Satu `GET /api/laporan` mengisi tiga panel:

- **Dashboard ringkas** — dari `monthly`: kartu angka total transaksi, liter,
  biaya BBM, tol per cabang. Untuk PIC CABANG hanya cabangnya sendiri
  (sudah difilter server). Untuk SUPERADMIN tampil lintas cabang.
- **Warnings** — dari `warnings`: daftar badge berwarna menurut `severity`,
  dengan `pesan` dari server. Teks tidak ditulis ulang di klien.
- **Tabel transaksi** — dari `transactions` (maks 2000 baris, sudah
  dikelompokkan per kendaraan dan diurutkan dari `sub_timestamp` terbaru).

Kolom tabel: tanggal, kendaraan, supir, KM tempuh, liter, biaya, metode bayar,
efisiensi + badge status, aksi. `efisiensi_label` dan `status_efisiensi`
sudah dihitung server, jadi warna badge tidak dihitung klien.

Foto ditampilkan lewat field `*_thumb`, bukan URL penuh, karena tabel bisa
2000 baris.

Aksi baris:

| Aksi | Endpoint | Syarat tampil |
|---|---|---|
| Edit | `PUT /api/laporan/:id` (via `#/edit/:id`) | selalu |
| Hapus | `DELETE /api/laporan/:id` | selalu, dengan konfirmasi |
| Detach Flazz | `DELETE /api/laporan/:id/flazz` | hanya bila `flazz_card_id` terisi |

Detach menampilkan konfirmasi yang menjelaskan efeknya: payment BBM dilepas,
field tol tetap. Edit, Hapus, dan Detach semuanya menulis audit log di server.

### 3.3 Input laporan

Dua mode dipisah ke dua modul agarcabang tidak bertumpuk: `input.js` untuk
tambah, `edit.js` untuk ubah.

Alur isian:

1. **Kendaraan** — dropdown dari `GET /api/master` (seluruh master sudah
   di-cache server per role). Mengubah kendaraan memanggil
   `GET /api/laporan/prefill` untuk mengisi nilai default transaksi terakhir
   kendaraan itu: `bar_awal`, `bar_akhir`, `liter_bbm`, `biaya_bbm`, metode
   pembayaran, kartu, dan nama supir.
2. **Tanggal, supir, KM** — tanggal dan nama supir terisi dari prefill. KM
   awal dan KM akhir **tidak** ada di prefill; keduanya diisi user. Field
   `km_awal_broken` / `km_akhir_broken` diset saat user mencentang "meter
   mati". Saat estimasi diperlukan, server memakai `lastForVehicle` sebagai
   anchor secara internal — klien tidak pernah mengirim anchor itu.
3. **Bar dan liter** — jika kendaraan `jenis_indikator` = `ANALOG_JARUM`, bar
   terkunci di 100 dan tidak dapat diedit.
4. **Pembayaran** — TUNAI atau FLAZZ. FLAZZ wajib memilih kartu; server
   menolak tanpa kartu dengan pesan yang sudah disiapkan.
5. **Tol opsional** — metode tol terpisah; kartu tol terpisah bila FLAZZ.
6. **Foto odometer** — dua input (awal, akhir), sesuai alur §2.

**Aturan bisnis tidak diduplikasi di klien.** Estimasi odometer saat meter
mati dihitung server (`estimateOdo`); klien hanya mengirim flag. Bila server
menolak karena data tidak cukup, pesan `MSG_ODO_NO_LITER` atau
`MSG_ODO_NO_STANDAR` ditampilkan apa adanya.

Validasi sisi klien hanya yang murah: field wajib terisi dan nilai numerik.
Semua aturan lain diserahkan ke server.

### 3.4 Guard router

`app.js` memanggil `GET /api/auth/session` saat boot. Bila 401 atau tidak ada
token, hash dipaksa ke `#/login`. Guard yang sama berjalan pada setiap
perpindahan halaman, sehingga membuka `#/input` langsung tanpa session akan
kembali ke login.

---

## 4. Error Handling

`api.js` adalah satu-satunya modul yang bicara HTTP.

Bentuk payload Worker adalah `{success: true, ...data}` pada sukses dan
`{success: false, error, message}` pada gagal (`src/utils/http.ts`). Tidak
ada pembungkus `data`; field sukses ditaburkan di level atas. `api.js`
membaca `success` dan mengembalikan sisa payload sebagai objek data.

| Kondisi | Perlakuan |
|---|---|
| `{success:false, error, message}` | lempar objek dengan `error` dan `message` dari server |
| 401 | reset session di store, lempar; router mengarahkan ke login |
| 429 | tampilkan `message` apa adanya (termasuk sisa detik dari server) |
| jaringan mati / timeout | pesan dalam bahasa user, bukan dump error |

Halaman menangkap error dari `api.js` dan menampilkan `err.message` tanpa
mengubah teksnya. Server sudah menyediakan pesan spesifik yang memadai:
`MSG_PICK_FLAZZ`, `MSG_PICK_FLAZZ_TOLL`, `MSG_ODO_NO_LITER`,
`MSG_ODO_NO_STANDAR`, `MSG_CARD_TARGET_NOT_FOUND`, `MSG_DUPLICATE`,
`MSG_INSUFFICIENT`, `MSG_EDIT_INSUFFICIENT`, `MSG_TRX_NOT_FOUND`,
`MSG_JALUR_GATE`, `MSG_DELETE_SUCCESS`, `MSG_EDIT_SUCCESS`.

Tidak ada teks pesan yang ditulis ulang di frontend.

---

## 5. Testing

Prinsip sama seperti backend: logika murni diuji, I/O tidak.

### Unit (vitest)

| Target | Alasan |
|---|---|
| `ui.js`: `esc()`, format angka, format tanggal, pemangkasan | proteksi HTML injection dan format |
| helper form `input.js`: validasi wajib/numerik, building payload, checkbox meter mati | murni, tanpa DOM |
| helper `api.js`: pemetaan `{success,...data}` / `{success:false,error,message}`, penanganan 401 | diuji dengan stub `fetch` global |

Tidak ada jsdom atau testing-library. Menambahkannya hanya untuk menguji DOM
yang sebenarinya dilihat manusia tidak sebanding dengan bobot dependensinya.

### Tidak diuji unit

Fetch nyata, DOM rendering, navigasi router. Semua jalur error pada kode
harus eksplisit dan terbaca — tidak ada `catch` kosong, karena JS statis tidak
menangkap kesalahan diam-diam sampai ke produksi.

### Verifikasi manual (`npm run dev`)

1. Login sebagai PIC CABANG → dashboard hanya menampilkan cabangnya.
2. Input laporan lengkap dengan dua foto dari kamera → thumbnail muncul di
   tabel.
3. Simpan dengan meter mati → `km_sumber` = `ESTIMASI`.
4. Edit transaksi FLAZZ dengan nominal melebihi saldo → `MSG_INSUFFICIENT`
   tampil mentah.
5. Detach Flazz → field tol tetap, baris tidak hilang.
6. Logout, lalu buka `#/input` langsung → kembali ke login.

Poin 1 menguji filter cabang end-to-end, bagian paling rawan karena
menyangkut role. Poin 6 menguji guard router.

---

## 6. Pembagian Tugas

| # | Tugas | Keluaran | Bergantung |
|---|---|---|---|
| 1 | Shell, `store.js`, `api.js`, `ui.js`, router, login | bisa login/logout, guard jalan | — |
| 2 | Master read + dropdown kendaraan/supir/BBM di form | form terisi data master | 1 |
| 3 | `input.js` — form lengkap, upload foto, POST | transaksi tersimpan | 2 |
| 4 | `transaksi.js` — tabel + dashboard dari satu respons | UI harian lengkap | 1 |
| 5 | `edit.js` — mode edit, hapus, detach | koreksi transaksi | 3, 4 |
| 6 | Polish + verifikasi manual §5 | M6 selesai | 5 |

Tugas 1 tidak memblokir apa pun; 2–6 seluruhnya menunggu 1. Tidak ada
tugas yang menunggu migrasi atau perubahan backend.

---

## 7. Di Luar Scope

Tidak ada perubahan pada `src/`, `db/`, `scripts/`, atau `wrangler.jsonc`.

Tidak ada perubahan pada halaman master CRUD, Flazz, settings, dan audit —
endpoint-nya sudah ada dari M2–M5 dan tidak berubah.

Tidak ada upload file selain foto odometer, dan tidak ada perubahan pada
endpoint M5 lain di luar `/api/laporan/:id/flazz`.

State Form tidak disimpan otomatis di browser: transaksi yang belum di-save
hilang saat menutup tab. Ini keputusan sadar untuk menghindari
`localStorage` berisi data operasional sensitif; konsekuensinya diketahui.

Tidak ada service worker atau offline support.
