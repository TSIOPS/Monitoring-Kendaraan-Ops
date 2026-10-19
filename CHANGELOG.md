# Changelog

Semua perubahan penting dicatat di sini (terbaru di atas). Format: tanggal — kategori — ringkasan — file utama.

## 2026-10-19
- **Keamanan** — Username di lookup login kini dinetralkan dari wildcard ILIKE (`_`/`` di-escape, `%`/`*` ditolak) sehingga `admi_`, `admin%`, `%` tidak lagi cocok ke akun yang sama — `src/utils/keamanan.ts`, `src/db/users.ts`, `src/db/master.ts`
- **Dokumentasi** — Menambah aturan kerja proyek (`CLAUDE.md`), changelog ini, dan rencana perbaikan hasil
  review keamanan & UX (`docs/superpowers/plans/2026-10-19-perbaikan-keamanan-ux.md`), termasuk aturan wajib commit setiap perubahan. Belum ada perubahan kode.
