# Retribusi & Parkir Delivery — Rencana Implementasi

> Spec: `docs/superpowers/specs/2026-11-07-retribusi-parkir-design.md`. **Belum disetujui — jangan mulai kode sebelum disetujui.**
> Tiap task: tes dulu (lihat gagal) → kode → `npm test && npm run typecheck` hijau → centang → CHANGELOG → commit → push `origin main` (aturan CLAUDE.md §4–5). Deploy hanya atas persetujuan pemilik; **jalankan SQL Task 1 di Supabase sebelum deploy** dan catat di README.

**Tujuan:** jenis pengeluaran `RETRIBUSI` dan `PARKIR` (tunai, banyak baris, foto opsional) di Input/Edit Laporan, terhitung di History, Rekap + Excel, Perbandingan, dan ringkasan bulanan.

**Arsitektur:** `rincian` JSONB tetap sumber data; slot pembayaran lama tidak berubah; total per jenis diturunkan dari rincian. Dua kolom foto baru. Tanpa kolom biaya baru.

**Gerbang review (CLAUDE.md §3):** keamanan (input rincian ke DB, upload foto) → `/security-review`; UI → `/ui-ux-pro-max`; struktur besar (>150 baris, skema DB) → `/code-review:code-review`. Dijalankan di Task 13.

## Peta file
| File | Perubahan |
|---|---|
| `db/retribusi-parkir.sql` (baru), `db/schema.sql` | 2 kolom foto |
| `tests/schema.test.ts` | tes kolom baru |
| `src/logic/rincian.ts`, `tests/logic/rincian.test.ts` | jenis baru, `totalPerJenis` |
| `src/logic/laporan.ts`, `tests/logic/laporan*.test.ts` | `RincianItem`, `LaporanRow`, `RecentItem`, `MonthlyItem`/`groupMonthly` |
| `src/routes/laporan.ts`, `tests/routes/laporan.test.ts` | simpan foto, POST/PUT/photos, cache bulanan |
| `src/db/storage.ts` | folder storage baru |
| `src/logic/master-cache.ts` | prefix `monthly2:` |
| `static/js/rincian.js`, `tests/frontend/rincian-helpers.test.ts` | 4 jenis, default Retribusi, kunci Tunai |
| `static/js/pages/input.js`, `edit.js` + tes helper | foto opsional, payload |
| `static/js/pages/transaksi.js`, `tests/frontend/transaksi-helpers.test.ts` | label, galeri foto, ringkasan bulanan |
| `src/logic/rekap.ts`, `tests/logic/rekap.test.ts` | tipe jenis |
| `src/routes/kaskecil.ts`, `tests/routes/kaskecil.test.ts` | saring BBM/TOL |
| `static/js/pages/rekap.js`, `tests/frontend/rekap-helpers.test.ts` | total, filter, Excel |
| `static/js/pages/perbandingan.js`, `tests/frontend/perbandingan-helpers.test.ts` | agregasi 3 mode + Excel |
| `static/js/rilis.js`, `tests/frontend/versi-helpers.test.ts`, `CHANGELOG.md`, `README.md` | dokumentasi & pop-up |

---
## FASE 1 — Data, Input/Edit, History

### Task 1: Kolom foto di database
- [x] **Tes gagal** (`tests/schema.test.ts`): `db/schema.sql` dan `db/retribusi-parkir.sql` memuat `foto_struk_retribusi` dan `foto_struk_parkir` (`text not null default ''`); file migrasi idempoten (`add column if not exists`).
- [x] **Implementasi:** `db/retribusi-parkir.sql`:
  ```sql
  alter table penggunaan_bbm add column if not exists foto_struk_retribusi text not null default '';
  alter table penggunaan_bbm add column if not exists foto_struk_parkir text not null default '';
  ```
  Tambahkan kolom yang sama di blok `penggunaan_bbm` pada `db/schema.sql` (setelah `foto_struk_toll`); perbarui komentar `rincian` (`BBM|TOL|RETRIBUSI|PARKIR`).
- [x] Tambahkan file ke tabel "SQL migrasi tertunda" di `README.md` (aturan CLAUDE.md §2.4).
- [x] `npm test && npm run typecheck`, CHANGELOG (Fitur), commit `feat(db): kolom foto bukti retribusi dan parkir`.

### Task 2: Logika murni rincian (`src/logic/rincian.ts`)
- [x] **Tes gagal** (`tests/logic/rincian.test.ts`):
  - `normalRincian` menerima `RETRIBUSI`/`PARKIR` (huruf kecil juga) dan memaksa `kartu: ''` walau dikirim kartu.
  - Jenis lain (mis. `LAIN`) → galat `Baris n: jenis harus BBM, Tol, Retribusi, atau Parkir Delivery.`
  - `rincianKeSlot` mengabaikan Retribusi/Parkir (slot identik dengan input tanpa baris itu; tidak memicu galat "maksimal 2 cara").
  - `totalPerJenis(items)` → `{ BBM, TOL, RETRIBUSI, PARKIR }`.
  - 31 baris campuran tetap ditolak.
- [x] **Implementasi:** `RincianItem.jenis` (di `src/logic/laporan.ts`) menjadi `'BBM' | 'TOL' | 'RETRIBUSI' | 'PARKIR'`; konstanta `JENIS_RINCIAN`, `JENIS_TUNAI_SAJA = ['RETRIBUSI','PARKIR']`; `normalRincian` memakainya; `rincianKeSlot` hanya memakai `sumberPer` BBM/TOL (sudah begitu — tambah tes pengunci); export `totalPerJenis`.
- [x] `npm test && npm run typecheck`, CHANGELOG, commit `feat(laporan): jenis retribusi dan parkir di logika rincian`.

### Task 3: Server simpan foto & rincian (`src/routes/laporan.ts`, `src/db/storage.ts`)
- [x] **Tes gagal** (`tests/routes/laporan.test.ts`):
  - POST `/api/laporan/photos` dengan `foto_struk_retribusi`/`foto_struk_parkir` mengembalikan `files.struk_retribusi`/`files.struk_parkir`; tanpa foto → `''` dan **tidak** diwajibkan.
  - POST `/api/laporan` dengan rincian BBM + Retribusi + Parkir: slot lama (`biaya_bbm`, `biaya_toll`, `metode_*`) tidak terpengaruh, `rincian` tersimpan lengkap, kartu Retribusi/Parkir `''`, saldo Flazz tidak berubah; `foto_struk_retribusi`/`foto_struk_parkir` tersimpan.
  - Laporan hanya berisi Retribusi (tanpa BBM/Tol) sukses dan tidak meminta struk BBM/tol.
  - PUT: tambah/hapus baris Retribusi memperbarui `rincian` tanpa mengubah saldo kartu; ganti foto lewat `files`.
- [x] **Implementasi:**
  - `src/db/storage.ts`: union `folder` + `'Struk_Retribusi' | 'Struk_Parkir'`.
  - `SLOT_STRUK` (laporan.ts ~165) + `{ slot:'struk_retribusi', folder:'Struk_Retribusi', label:'bukti retribusi' }`, `{ slot:'struk_parkir', folder:'Struk_Parkir', label:'bukti parkir' }`; `files` default di `/photos` ditambah dua slot.
  - Insert POST: `foto_struk_retribusi`, `foto_struk_parkir` dari `sfiles`.
  - Loop foto di PUT (~680): ganti ternary dua-cabang `s.slot === 'struk_bbm' ? … : …` dengan peta `slot → kolom` (4 slot) agar slot baru tidak menimpa `foto_struk_toll`.
  - `LaporanRow` + `LaporanInsert` ditambah dua kolom foto.
- [x] `npm test && npm run typecheck`, CHANGELOG, commit `feat(laporan): simpan rincian retribusi/parkir dan foto bukti opsional`. **Gerbang:** `/security-review` setelah Task 3 (upload & input DB).

### Task 4: History & ringkasan bulanan (server)
- [x] **Tes gagal** (`tests/logic/laporan.test.ts`, `laporan-grup2.test.ts`, route bulanan): `buildRecentList` memuat `total_retribusi`, `total_parkir`, `foto_struk_retribusi(+_thumb)`, `foto_struk_parkir(+_thumb)`; `groupMonthly` menambah `total_retribusi`, `total_parkir` dan `total_pengeluaran` (= BBM + Tol + Retribusi + Parkir); laporan lama → 0; cache bulanan memakai kunci `monthly2:`.
- [x] **Implementasi:** `RecentItem`, `MonthlyItem`, `groupMonthly` (`totalPerJenis(rincianDariRow(r).items)`), `monthlyCacheKey` → prefix `monthly2:` (perbarui tes yang mengunci kunci lama di `tests/logic/master-cache` / route).
- [x] `npm test && npm run typecheck`, CHANGELOG, commit `feat(laporan): total retribusi/parkir di history dan ringkasan bulanan`.

### Task 5: Helper tabel rincian di frontend (`static/js/rincian.js`)
- [x] **Tes gagal** (`tests/frontend/rincian-helpers.test.ts`):
  - `bersihkanRincian` mempertahankan jenis baru dan memaksa `kartu: ''` untuk Retribusi/Parkir.
  - `validasiRincian` menerima 4 jenis; pesan jenis tidak valid sama dengan server; batas "2 cara bayar" hanya untuk BBM/Tol.
  - `ringkasRincian` mengembalikan `{ bbm, tol, retribusi, parkir, perKartu, jumlah }` dan Retribusi/Parkir **tidak** masuk `perKartu`.
  - `nominalBawaan('RETRIBUSI') === 10000`, lainnya `''`.
- [x] **Implementasi:** konstanta `JENIS` (`value`, `label`: BBM, Tol, Retribusi, Parkir Delivery), `NOMINAL_RETRIBUSI = 10000`; `baris()` memakai 4 opsi; saat jenis diubah ke Retribusi dan nominal kosong → isi 10.000; saat jenis Retribusi/Parkir kolom Dibayar di-set "Tunai" + `disabled` (nilai tetap `''`); ringkasan menampilkan Retribusi/Parkir hanya bila > 0. Baris default tetap BBM.
- [x] `npm test && npm run typecheck`, CHANGELOG (UX), commit `feat(ui): tabel rincian mendukung retribusi dan parkir delivery`.

### Task 6: Input Laporan (`static/js/pages/input.js`)
- [x] **Tes gagal** (`tests/frontend/input-helpers.test.ts`): payload `rincian` memuat jenis baru; validasi **tidak** meminta foto untuk Retribusi/Parkir; laporan hanya-Retribusi lolos validasi (tanpa struk BBM/tol).
- [x] **Implementasi:** dua input foto opsional (`fotoRetribusi`, `fotoParkir`) di bawah foto struk tol, dengan teks bantu "Opsional"; ikut kompres + `unggah` ke `/api/laporan/photos` dan simpan di `serverData.files`; kirim ke POST.
- [x] `npm test && npm run typecheck`, CHANGELOG (UX), commit `feat(input): retribusi dan parkir delivery di input laporan`.

### Task 7: Edit Laporan (`static/js/pages/edit.js`)
- [x] **Tes gagal** (`tests/frontend/edit-helpers.test.ts`): `rincianBerubah` mendeteksi perubahan baris Retribusi/Parkir; body edit mengirim `rincian` hanya bila berubah; foto baru dikirim hanya bila dipilih.
- [x] **Implementasi:** input foto opsional + pratinjau (pola `pratinjauFoto`) untuk dua slot; loop upload (~257) ditambah dua slot.
- [x] `npm test && npm run typecheck`, CHANGELOG, commit `feat(edit): edit retribusi dan parkir delivery`.

### Task 8: History frontend (`static/js/pages/transaksi.js`)
- [x] **Tes gagal** (`tests/frontend/transaksi-helpers.test.ts`): `teksBarisRincian` memberi label "Retribusi"/"Parkir Delivery" dan "Tunai"; ringkasan bulanan menjumlah `total_retribusi`, `total_parkir`, `total_pengeluaran` (nilai `undefined` dari cache lama dianggap 0).
- [x] **Implementasi:** label jenis (hapus ternary `TOL ? 'Tol' : 'BBM'`), foto bukti baru di galeri laporan, kartu ringkasan bulanan.
- [x] `npm test && npm run typecheck`, CHANGELOG, commit `feat(history): tampilkan retribusi dan parkir delivery`.

> **Titik rilis opsional setelah Fase 1:** jalankan SQL → deploy. Rekap/Perbandingan belum memuat jenis baru (lihat Fase 2–3); lebih baik rilis Fase 1+2 bersama.

---
## FASE 2 — Rekap, Excel, pembanding Kas Kecil

### Task 9: Rekap server (`src/logic/rekap.ts`) dan pembanding Kas Kecil (`src/logic/kaskecil.ts`, `src/routes/kaskecil.ts`)
- [x] **Tes gagal:**
  - `tests/logic/rekap.test.ts`: `rekapPengeluaran` mengeluarkan baris `jenis: 'RETRIBUSI'|'PARKIR'` dengan `metode: 'TUNAI'`, `card_id: ''`, keterangan dari rincian.
  - `tests/logic/kaskecil.test.ts`: `pembandingHarian` menambah pasangan `retribusi` dan `parkir` (`app`/`kas`/`selisih`); Retribusi ↔ jenis "Biaya Retribusi", Parkir ↔ "Biaya Parkir Untuk Delivery"; **"Biaya Parkir ke Bank" tidak terhitung** di Parkir; `cocok` hanya true bila keempat pasangan (BBM, Top up, Tol, Retribusi, Parkir) selisih 0; uang kembali (KM tertaut) mengurangi sisi kas seperti jenis lain.
  - `tests/routes/kaskecil.test.ts`: endpoint pembanding mengisi `app.retribusiTunai`/`parkirTunai` dari laporan tunai, dan Retribusi/Parkir **tidak** masuk `tolTunai`/`bbmTunai`.
- [x] **Implementasi:** `JenisPengeluaran` diperluas; `AppHarian` + `retribusiTunai`, `parkirTunai`; `POLA_RETRIBUSI = /retribusi/i`, `POLA_PARKIR = /parkir untuk delivery/i`; `BarisBanding` + `retribusi`, `parkir`; `kaskecil.ts` (~486): peta jenis→kolom (`BBM`→bbmTunai, `TOL`→tolTunai, `RETRIBUSI`→retribusiTunai, `PARKIR`→parkirTunai).
- [x] `npm test && npm run typecheck`, CHANGELOG, commit `feat(rekap): baris retribusi/parkir dan pembanding kas kecil`.

### Task 9b: Tampilan & Excel pembanding Kas Kecil (`static/js/pages/kaskecil.js`, `static/js/kaskecil-helpers.js`)
- [x] **Tes gagal** (`tests/frontend/kaskecil-helpers.test.ts`): Excel pembanding memuat kolom Retribusi dan Parkir (app, kas, selisih) dengan baris TOTAL yang menjumlahkannya; jumlah kolom header = jumlah sel tiap baris; angka nol tampil "-" (aturan proyek).
- [x] **Implementasi:** tabel pembanding (~700–708) + dua kelompok kolom (Retribusi, Parkir); `sel()` dipakai ulang; Excel (~109–110) ditambah kolom yang sama. Label status "Cocok/Selisih" mengikuti `cocok` baru.
- [x] Verifikasi manual (dev/demo-lokal): satu laporan dengan Retribusi 10.000 + kas keluar "Biaya Retribusi" 10.000 pada tanggal sama → Cocok; ubah salah satu → Selisih.
- [x] `npm test && npm run typecheck`, CHANGELOG, commit `feat(kas-kecil): retribusi dan parkir delivery di pembanding harian`. Catatan: Kas Kecil masih tahap uji (hanya SUPERADMIN) — tidak membuka ke PIC.

### Task 10: Rekap frontend + Excel (`static/js/pages/rekap.js`)
- [x] **Tes gagal** (`tests/frontend/rekap-helpers.test.ts`): `kosongTotal`/`tambahkan` memiliki `retribusi` dan `parkir`; `totalTunai` ikut bertambah; ringkasan & sheet Excel memuat dua baris/kolom baru; label baris detail "Retribusi"/"Parkir Delivery"; filter jenis menerima 4 nilai.
- [x] **Implementasi:** ganti `else` (baris ~18) dengan peta jenis→kolom; filter jenis 4 opsi; label (~106, ~319); ringkasan (~94) menambah dua baris; Excel (sheet ringkasan + detail) memakai peta yang sama; `stripNol` tetap berlaku.
- [x] Verifikasi manual di dev: total Rekap = total History pada rentang uji.
- [x] `npm test && npm run typecheck`, CHANGELOG (UX), commit `feat(rekap): retribusi dan parkir delivery di rekap dan Excel`. **Gerbang:** `/ui-ux-pro-max` untuk Fase 1–2.

---
## FASE 3 — Perbandingan

### Task 11: Agregasi Perbandingan (`static/js/pages/perbandingan.js`)
- [x] **Tes gagal** (`tests/frontend/perbandingan-helpers.test.ts`): untuk tiga mode (harian `tambah`, rentang `hitungRentang`, bulanan `hitungBulan`) satu baris tiap jenis (BBM/TOL/RETRIBUSI/PARKIR, tunai) menghasilkan: `retribusi`, `parkir` terpisah; `tunai` dan `total` mencakup keduanya; `etoll` tidak berubah; `%` dan `perKendaraan` dihitung dari total baru; rincian per hari memuat kolom baru.
- [x] **Implementasi:** satu helper `kolomJenis(l)` (jenis+metode → nama kolom) menggantikan tiga ternary (`l.jenis === 'TOL' ? … : …`) dan `tambah()` (~17–25); `kosong()`/`rinciKosong()` mendapat `retribusi`, `parkir`; turunan (`lengkapi`, `hitungTurunan`, `turunanBulan`) menjumlah ke `total`/`tunai`.
- [x] `npm test && npm run typecheck`, commit `feat(perbandingan): retribusi dan parkir delivery masuk total`.

### Task 12: Tampilan & Excel Perbandingan
- [x] **Tes gagal:** `susunExcel*` (harian, rentang, bulanan) memuat kolom Retribusi & Parkir dan baris rinci per hari; header & jumlah kolom konsisten dengan tampilan; angka nol tampil "-" sesuai aturan proyek.
- [x] **Implementasi:** header tabel kelompok (~452, ~605, ~737) + kolom Retribusi/Parkir; baris Excel (~272, ~293, ~330, ~346, ~389, ~401) memakai daftar kolom yang sama (satu sumber kebenaran agar tidak melenceng).
- [x] Verifikasi manual: unduh Excel, bandingkan total dengan Rekap untuk rentang yang sama.
- [x] `npm test && npm run typecheck`, CHANGELOG, commit `feat(perbandingan): kolom retribusi dan parkir di tampilan dan Excel`.

---
## PENUTUP

### Task 13: Review, dokumentasi, rilis
- [ ] `/security-review` (upload foto & input rincian), `/ui-ux-pro-max` (Input/Edit/History/Rekap/Perbandingan: target sentuh ≥ 44px, label/aria, 360px, kolom "Dibayar" nonaktif tetap terbaca), `/code-review:code-review` (>150 baris, skema DB). Perbaiki temuan atau catat alasan di CHANGELOG.
- [ ] `static/js/rilis.js`: entri `2026-11-07-retribusi-parkir` (≤3 poin: Retribusi & Parkir Delivery di Input Laporan; Retribusi otomatis Rp 10.000; foto opsional) + perbarui id yang dikunci `tests/frontend/versi-helpers.test.ts`.
- [ ] `README.md`: fitur (rincian 4 jenis), tabel API (`rincian` jenis baru; `files.struk_retribusi/parkir` di `/api/laporan/photos`), tabel SQL tertunda.
- [ ] `CLAUDE.md`: tambah plan di daftar rencana aktif; pindahkan ke "(selesai)" saat selesai.
- [ ] `npm test` dan `npm run typecheck` hijau; tempel ringkasan di CHANGELOG.
- [ ] **Rilis (atas persetujuan pemilik):** jalankan `db/retribusi-parkir.sql` di Supabase → pindahkan ke "Sudah dijalankan" di README → `npx wrangler deploy` → cek `/api/health/versi` dan Input Laporan (Retribusi otomatis 10.000, simpan, lihat di History/Rekap/Perbandingan).
- [ ] Commit `docs(retribusi-parkir): review, README, dan penutup rencana`, push.

## Rangkuman ukuran
14 task, ±20–22 file, ±1.200–1.500 baris termasuk tes. Fase 1 ±8–10 file, Fase 2 ±6, Fase 3 ±1–2. Risiko terbesar: Task 11–12 (percabangan jenis paling banyak di `perbandingan.js`) dan Task 3 (peta slot→kolom foto di PUT).
