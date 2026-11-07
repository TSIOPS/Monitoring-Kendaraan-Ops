# Retribusi & Parkir Delivery di Input Laporan — Desain

Tanggal: 2026-11-07 · Status: **menunggu persetujuan** (belum ada kode) · Rencana: `docs/superpowers/plans/2026-11-07-retribusi-parkir.md`

## Tujuan
PIC cabang dapat mencatat dua pengeluaran baru pada laporan harian, selain BBM dan Tol:
- **Retribusi** (jenis `RETRIBUSI`)
- **Parkir Delivery** (jenis `PARKIR`)

Keduanya ikut tampil dan terhitung di History, Rekap Pengeluaran + Excel, Perbandingan, dan ringkasan bulanan.

## Keputusan (dari pemilik repo)
| # | Keputusan |
|---|---|
| 1 | Dua jenis terpisah: Retribusi dan Parkir Delivery. |
| 2 | **Tunai saja.** Tidak menyentuh Flazz, saldo kartu, usage, atau rekonsiliasi. |
| 3 | Banyak baris per laporan (batas 30 baris rincian yang sudah ada berlaku untuk semua jenis). |
| 4 | Retribusi: nominal terisi otomatis **Rp 10.000** pada baris baru, bisa diubah. Parkir: nominal kosong, diisi manual. |
| 5 | Foto bukti **opsional**, satu foto per jenis per laporan (bukan wajib seperti struk BBM/tol). |
| 6 | Muncul di semua laporan (semua cabang/peran yang bisa input). |
| 7 | Masuk Total Pengeluaran di Rekap, Excel, Perbandingan, dan ringkasan bulanan. |
| 9 | **Retribusi dan Parkir Delivery ikut dibandingkan dengan Kas Kecil** (pembanding harian). Pemetaan: Retribusi ↔ kas keluar jenis "Biaya Retribusi"; Parkir Delivery ↔ "Biaya Parkir Untuk Delivery". **"Biaya Parkir ke Bank" bukan parkir delivery dan tidak ikut.** Pola nama jenis memakai regex seperti BBM/Tol (`/retribusi/i`, `/parkir untuk delivery/i`). |
| 8 | Pendekatan data **A**: kolom `rincian` (JSONB) tetap sumber data; total dihitung dari rincian. Tidak ada kolom slot `biaya_retribusi`/`biaya_parkir`. Pendekatan B (kolom slot baru) ditolak. |

## Alur data
- `penggunaan_bbm.rincian` sudah memuat item `{jenis, nominal, kartu, keterangan}`. `jenis` diperluas: `BBM | TOL | RETRIBUSI | PARKIR`.
- Server memaksa `kartu = ''` (tunai) untuk `RETRIBUSI`/`PARKIR`, apa pun kiriman klien.
- `rincianKeSlot` **mengabaikan** jenis baru: kolom slot lama (`biaya_bbm`, `biaya_toll`, kartu 1/2) tidak berubah, sehingga saldo Flazz, rekonsiliasi, liter, dan efisiensi tetap sama.
- Total Retribusi/Parkir **diturunkan** dari rincian (helper `totalPerJenis(items)`), dipakai oleh History, ringkasan bulanan, rekap, dan perbandingan.
- Laporan lama (tanpa rincian atau hanya BBM/Tol) tidak berubah: total Retribusi/Parkir = 0.
- Foto: dua kolom teks baru `foto_struk_retribusi`, `foto_struk_parkir` di `penggunaan_bbm` (satu-satunya migrasi SQL). Upload memakai jalur yang sama dengan struk BBM/tol (`SLOT_STRUK`), folder storage `Struk_Retribusi` / `Struk_Parkir`.

## UI
- **Input & Edit Laporan:** tabel rincian punya 4 pilihan Jenis (BBM, Tol, Retribusi, Parkir Delivery). Memilih Retribusi pada baris dengan nominal kosong mengisi 10.000. Untuk Retribusi/Parkir kolom "Dibayar" dikunci "Tunai" (nonaktif). Ringkasan di bawah tabel menampilkan Total Retribusi dan Total Parkir bila ada.
- Dua input foto opsional "Foto bukti retribusi" dan "Foto bukti parkir delivery" di bawah foto struk BBM/tol; di Edit ada pratinjau seperti struk lain. Tidak ada validasi wajib foto.
- **History:** baris rincian memakai label jenis baru; foto bukti baru ikut di galeri; ringkasan bulanan menambah Retribusi, Parkir, dan Total Pengeluaran.
- **Rekap Pengeluaran:** filter jenis + kolom jenis memuat 4 jenis; kartu ringkasan dan sheet Excel menambah baris/kolom Retribusi dan Parkir (semuanya metode TUNAI).
- **Perbandingan:** komponen Retribusi dan Parkir ditambahkan ke total & kolom Tunai (harian, rentang, dan bulanan, termasuk Excel).

## Titik hard-code yang harus diubah (hasil pemetaan kode)
Banyak kode memakai pola "selain BBM berarti Tol" (`else`), sehingga jenis baru akan salah masuk Tol bila tidak diubah:
- `static/js/pages/rekap.js` `tambahkan()` (baris ~15–19), filter jenis (~228), label jenis (~106).
- `static/js/pages/perbandingan.js` `tambah()` (~17–25) dan tiga percabangan `l.jenis === 'TOL' ? … : …` (~168, ~245, plus agregasi rentang).
- `src/routes/kaskecil.ts` (~486–488): `else` menghitung semua selain BBM sebagai `tolTunai` → harus memisahkan 4 jenis. `src/logic/kaskecil.ts` `AppHarian`, `BarisBanding`, `pembandingHarian` ditambah pasangan `retribusi` dan `parkir`; `static/js/pages/kaskecil.js` (~700–708, tabel pembanding) dan `static/js/kaskecil-helpers.js` (~109–110, Excel) ditambah dua kelompok kolom.
- `static/js/pages/transaksi.js` `teksBarisRincian` (~146) dan ringkasan bulanan (~64–80).
- `src/logic/rekap.ts` `JenisPengeluaran`, `src/logic/laporan.ts` `RincianItem`, `groupMonthly`, `RecentItem`, `src/db/storage.ts` union `folder`.
- Cache ringkasan bulanan (`monthlyCacheKey`) harus berganti versi agar data lama di KV tidak menampilkan `undefined`.

## Pertanyaan terbuka (perlu keputusan sebelum Fase 2)
_(Tidak ada — pertanyaan sudah dijawab, lihat keputusan 9.)_

(Biaya per km tidak ada di aplikasi; efisiensi hanya dari liter BBM sehingga tidak terpengaruh. "Per kendaraan" di Perbandingan memakai total, yang otomatis memuat Retribusi/Parkir.)

## Risiko
| Risiko | Mitigasi |
|---|---|
| Jenis baru salah terhitung sebagai Tol di agregasi | Tes per agregasi (rekap, perbandingan ×3, kas kecil, bulanan) dengan satu baris tiap jenis. |
| Migrasi belum dijalankan sebelum deploy → insert gagal (kolom foto tak ada) | Urutan rilis: SQL → deploy; dicatat di README "SQL migrasi tertunda". |
| Klien lama (cache/service worker) mengirim rincian tanpa jenis baru | Aman: jenis lama tetap valid; versi baru memicu notif update. |
| Edit dari klien lama yang menghapus rincian (lihat `KOLOM_BAYAR`) | Retribusi/Parkir hilang bila rincian dikosongkan oleh klien lama; kecil kemungkinan, dicatat di CHANGELOG. |
| Cache bulanan lama | Ganti prefix kunci `monthly:` → `monthly2:`. |

## Fase dan ukuran
Perkiraan total ±20–22 file dan ±1.200–1.500 baris termasuk tes. Sedang–besar, tetapi bisa dicicil dan tiap fase bisa dirilis sendiri.

| Fase | Isi | File utama | Ukuran |
|---|---|---|---|
| 1 | Data, validasi, Input/Edit, foto opsional, History, ringkasan bulanan | `src/logic/rincian.ts`, `src/logic/laporan.ts`, `src/routes/laporan.ts`, `src/db/storage.ts`, `static/js/rincian.js`, `input.js`, `edit.js`, `transaksi.js`, `db/retribusi-parkir.sql`, `db/schema.sql` | sedang (±8–10 file) |
| 2 | Rekap + Excel + pembanding Kas Kecil (2 pasangan kolom baru) | `src/logic/rekap.ts`, `src/logic/kaskecil.ts`, `src/routes/kaskecil.ts`, `static/js/pages/rekap.js`, `static/js/pages/kaskecil.js`, `static/js/kaskecil-helpers.js` | sedang (±6 file) |
| 3 | Perbandingan (harian, rentang, bulanan, Excel) | `static/js/pages/perbandingan.js` | sedang (paling banyak percabangan) |

Fase 1 sudah bisa dipakai PIC (input + History); Rekap/Perbandingan sebelum Fase 2–3 hanya belum menampilkan jenis baru, tanpa merusak angka lama. **Namun** Fase 2 sebaiknya dirilis bersama atau tepat setelah Fase 1 agar total Rekap tidak berbeda dari yang diinput.

## Di luar cakupan
Flazz/saldo/rekonsiliasi, foto wajib, batas nominal khusus, pengaturan nominal default Retribusi (angka 10.000 ditetapkan di kode), Kas Kecil sebagai sumber.
