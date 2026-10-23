# Aturan Kerja Proyek — Monitoring Kendaraan Operasional

File ini dibaca otomatis oleh Claude Code di setiap sesi. Semua aturan di bawah **wajib** diikuti
untuk setiap perubahan kode di repo ini.

## 1. Alur kerja (superpowers)
- Mulai setiap tugas dengan skill `superpowers:using-superpowers`, lalu pilih skill proses yang cocok:
  - fitur/perubahan perilaku → `superpowers:brainstorming` → `superpowers:writing-plans`
  - bug → `superpowers:systematic-debugging`
  - implementasi → `superpowers:test-driven-development` (tes dulu, lihat gagal, baru kode)
  - sebelum menyatakan selesai → `superpowers:verification-before-completion`
- Rencana disimpan di `docs/superpowers/plans/YYYY-MM-DD-<nama>.md`, spesifikasi di `docs/superpowers/specs/`.
- Rencana perbaikan aktif: [docs/superpowers/plans/2026-10-19-perbaikan-keamanan-ux.md](docs/superpowers/plans/2026-10-19-perbaikan-keamanan-ux.md),
  [docs/superpowers/plans/2026-10-19-role-management.md](docs/superpowers/plans/2026-10-19-role-management.md) (selesai).
  [docs/superpowers/plans/2026-10-21-rincian-pengeluaran.md](docs/superpowers/plans/2026-10-21-rincian-pengeluaran.md) (aktif).

## 2. Setiap perubahan WAJIB memperbarui dokumentasi Markdown
Setelah perubahan apa pun (kode, skema DB, konfigurasi):
1. **Centang langkah** yang selesai (`- [x]`) di file rencana yang sedang dikerjakan, dan tambahkan catatan bila
   implementasinya menyimpang dari rencana.
2. **Tambahkan entri di [CHANGELOG.md](CHANGELOG.md)** (tanggal, kategori Keamanan/UX/Perbaikan/Fitur, ringkasan,
   file utama).
3. **Perbarui README.md** bila mengubah setup, perintah, variabel env, atau catatan keamanan.
4. **File SQL baru di `db/`** (migrasi skema/data) wajib ditambahkan ke tabel "SQL migrasi tertunda" di
   [README.md](README.md) bagian *Checklist deploy*, supaya tidak terlupa dijalankan sebelum deploy.
5. **Perubahan yang terlihat pengguna:** tambahkan entri di `static/js/rilis.js` (id unik, 1–3 poin) agar muncul pop-up "Yang baru".
6. **Perbarui file ini (CLAUDE.md)** bila aturan/kebiasaan proyek berubah.

## 3. Gerbang review wajib (jalankan sebelum commit)
| Jenis perubahan | Wajib jalankan | Contoh pemicu |
|---|---|---|
| **Keamanan** | `/security-review` | `src/auth/**`, login/sesi/password, rate limit, cek role/cabang, `src/utils/keamanan.ts`, `static/_headers`, upload/foto, query DB dengan input user, `db/rls.sql` |
| **UI / UX** | `/ui-ux-pro-max` (mode review, checklist §1–§3 + §8 Forms) | `static/css/**`, `static/js/pages/**`, `static/js/ui.js`, `router.js`, `sw.js`, teks/alur yang dilihat user |
| **Struktur kode cukup besar** | `/code-review:code-review` | modul/file baru, refactor lintas file, ≥ ~150 baris berubah, ubah kontrak API/route, ubah skema DB |

- Satu perubahan bisa memicu lebih dari satu gerbang — jalankan semuanya.
- Temuan dari review diperbaiki dulu (atau dicatat alasannya di CHANGELOG bila sengaja tidak diperbaiki), baru commit.

## 4. WAJIB commit setiap perubahan
- **Setiap perubahan yang selesai wajib langsung di-commit** — jangan menumpuk banyak perubahan tanpa commit,
  dan jangan mengakhiri tugas dengan working tree kotor.
- Satu commit = satu unit logis (satu task di rencana / satu perbaikan), **termasuk** pembaruan Markdown-nya
  (centang rencana + CHANGELOG) di commit yang sama.
- Urutan per perubahan: kode + tes → verifikasi (§5) → gerbang review (§3) bila terpicu → update MD (§2) → **commit**.
- Commit hanya setelah tes & typecheck hijau. Bila terpaksa commit dalam keadaan gagal, tulis `WIP:` di awal pesan
  dan jelaskan alasannya.
- **Kerja langsung di `main`** (permintaan pemilik repo, 2026-10-19): jangan buat branch fitur/PR; setiap commit
  yang sudah lolos §5 (dan gerbang §3 bila terpicu) **langsung di-push ke `origin main`**.
- Jangan push commit `WIP:` atau commit dengan tes/typecheck merah.

## 5. Verifikasi sebelum commit
```bash
npm test          # vitest — harus hijau semua
npm run typecheck # tsc --noEmit — tanpa error
```
Jangan klaim "selesai" tanpa output kedua perintah di atas.

## 6. Konvensi kode
- Bahasa: identifier, komentar, pesan error, dan teks UI dalam **Bahasa Indonesia** (ikuti gaya yang ada).
- Frontend vanilla JS: bangun DOM dengan `el()` dari `static/js/ui.js` (textContent) — **jangan** pakai `innerHTML`
  untuk data apa pun.
- Helper frontend yang perlu dites dibuat sebagai fungsi murni ber-`export` (tes berjalan di environment `node`,
  tanpa DOM) — lihat pola di `tests/frontend/*-helpers.test.ts`.
- Query DB lewat builder supabase-js (`eq`/`in`/…); **jangan** memasukkan input user ke pola `ilike`/`like`
  atau string filter `.or()` tanpa escape.
- Setiap cek akses di server: PIC CABANG dibatasi ke cabangnya; MANAGEMENT baca semua cabang tapi tidak bisa menulis
  (penjaga di `requireUser` — cakupan baca pakai `lihatSemuaCabang()`, cek tulis tetap `isSuper()`); SUPERADMIN-only
  untuk pengguna/pengaturan/reset/audit. Pakai helper `src/auth/peran.ts` / `static/js/peran.js`, jangan bandingkan
  string role langsung.
- **Kas Kecil** (spec `docs/superpowers/specs/2026-10-23-kas-kecil-design.md`, rencana `docs/superpowers/plans/2026-10-23-kas-kecil.md`): modul sudah di-deploy (2026-10-23) tetapi masih **tahap uji**: hanya SUPERADMIN. **Jangan buka ke PIC/MANAGEMENT** sebelum pemilik repo menyatakan siap. Entri `rilis.js` ditambahkan saat dibuka untuk PIC. Tahap uji: menu & API Kas Kecil hanya SUPERADMIN (`PERAN_KAS_KECIL` + `KAS_KECIL` di app.js); buka ke PIC hanya atas perintah pemilik.
- Commit kecil per tugas, pesan gaya `fix(area): …` / `feat(area): …` dalam Bahasa Indonesia.
