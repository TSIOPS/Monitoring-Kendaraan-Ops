# Changelog

Semua perubahan penting dicatat di sini (terbaru di atas). Format: tanggal — kategori — ringkasan — file utama.

## 2026-10-19
- **Keamanan** — Sesi kini sliding: diperpanjang 12 jam penuh saat dipakai setelah lewat separuh umur (ditulis ulang maks sekali per 6 jam), daftar token pengguna ikut diperpanjang sehingga pencabutan sesi tetap berfungsi — `src/auth/sessions.ts`
- **UX** — Kirim ulang laporan setelah respons hilang kini dijawab 409 `SUDAH_DILAPORKAN` dengan pesan jelas dan tautan ke Riwayat Transaksi, bukan pesan "buat jalur dulu" yang memicu jalur & laporan ganda — `src/logic/laporan.ts`, `src/routes/laporan.ts`, `static/js/pages/input.js`
- **UX** — Klien API: respons non-JSON (mis. halaman 502 Cloudflare) tidak lagi menghapus sesi; hanya 401 yang logout. Request kini punya timeout 30 dtk (unggah foto 120 dtk) dengan galat `TIMEOUT` yang jelas — `static/js/api.js`, `static/js/pages/input.js`
- **Keamanan** — Gerbang Fase 1: `/security-review` lolos (tidak ada temuan ≥8).
- **Keamanan** — Rate limit login kini berlapis: per string input, per akun hasil lookup (variasi penulisan username tidak memberi jatah baru; akun tetap terkunci walau password benar), dan per IP (30 percobaan/5 menit). Login sukses mereset counter input dan akun, bukan counter IP — `src/routes/auth.ts`
- **Keamanan** — Username di lookup login kini dinetralkan dari wildcard ILIKE (`_` dan backslash di-escape, `%`/`*` ditolak) sehingga `admi_`, `admin%`, `%` tidak lagi cocok ke akun yang sama — `src/utils/keamanan.ts`, `src/db/users.ts`, `src/db/master.ts`
- **Dokumentasi** — Menambah aturan kerja proyek (`CLAUDE.md`), changelog ini, dan rencana perbaikan hasil
  review keamanan & UX (`docs/superpowers/plans/2026-10-19-perbaikan-keamanan-ux.md`), termasuk aturan wajib commit setiap perubahan. Belum ada perubahan kode.
