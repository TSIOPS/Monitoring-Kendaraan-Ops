# M4 — Dashboard & Warnings Design

**Tanggal:** 2026-09-25
**Status:** Disetujui (brainstorming) — lihat `docs/superpowers/plans/2026-09-25-m4-dashboard-warnings.md`
**Proyek:** `D:\Monitoring Kendaraan Ops Cloud` (port Cloudflare Workers + Supabase dari GAS)

## 1. Latar Belakang

M1 (fondasi/auth), M2 (data master + audit + settings), dan M3 (laporan/transaksi
BBM) selesai. Milestone berikutnya sesuai roadmap (plan M2 baris 2230, spec M3
baris 32) adalah **Dashboard & Warnings**. GAS source (`WarningsCore.js`) tidak
tersedia untuk dibaca; aturan warnings disusun baru dari keputusan bersama.

Tidak ada perubahan schema SQL — semua input sudah ada di tabel `kendaraan`:
- `tanggal_pajak`, `tanggal_pajak_5_tahunan`, `tanggal_kir` (basis tanggal)
- `km_terakhir_ganti_oli`, `interval_ganti_oli_km` (basis KM, + odo terakhir dari
  `penggunaan_bbm`)

## 2. Arsitektur

Mengikuti pola M2/M3: **logic murni → repo → route → cache**.

```
src/logic/warnings.ts         # BARU: semua aturan murni (tanpa env/DB/KV)
src/logic/master-cache.ts     # EDIT: warningsCacheKey + invalidateDashwarn
src/routes/laporan.ts         # EDIT: dashboard GET '/' + compute warnings + cache 300
                              #   + save/edit/delete laporan panggil invalidateDashwarn
src/routes/master.ts          # EDIT: reset-oli panggil invalidateDashwarn
tests/logic/warnings.test.ts  # BARU
tests/routes/laporan.test.ts  # EDIT: uji warnings/PIC-scope/cache/invalidasi
tests/routes/master.test.ts   # EDIT: reset-oli invalidasi dashwarn
```

Fungsi murni `src/logic/warnings.ts`:
- `buildOdoMap(rows)` — odo terakhir per kendaraan: `parseFloat(km_akhir_confirmed)`
  dari baris `seq` tertinggi; hanya dictatat bila `> 0`
- `daysUntil(dateStr, today)` — hari tersisa (negatif = lewat); `null` bila
  kosong/tidak valid
- `computeWarnings({ kendaraan: KendaraanRow[], user, odoMap, today })` —
  menyaring sendiri kendaraan `status = 'Aktif'` dan scope cabang (PIC: cabang
  sendiri; SUPERADMIN: semua), lalu menghasilkan `WarningItem[]` deterministik
  (route cukup meneruskan seluruh kendaraan dari `listAll()` + user scope)

## 3. Aturan Warning

| Kategori | Sumber | Ambang warning | Skip bila |
|---|---|---|---|
| `OLI` | `odoSekarang`, `km_terakhir_ganti_oli`, `interval_ganti_oli_km` | sisa `≤ 50 km` dari target `km_terakhir + interval` | `km_terakhir_ganti_oli <= 0` atau odo tidak tersedia |

Bila `interval_ganti_oli_km <= 0`, dipakai fallback `defaultOilIntervalKm(jenis)`
dari `src/logic/master.ts` (motor = 3000, selain motor = 5000) — konsisten dengan
saat insert kendaraan.
| `PAJAK` | `tanggal_pajak` | `≤ 30 hari` dari jatuh tempo | kolom kosong / tanggal tidak valid |
| `PAJAK_5_TAHUNAN` | `tanggal_pajak_5_tahunan` | `≤ 30 hari` | kolom kosong / tanggal tidak valid |
| `KIR` | `tanggal_kir` | `≤ 30 hari` | kolom kosong / tanggal tidak valid |

Severity:
- `KRITIS` — sudah lewat (oli `sisa < 0`; pajak/KIR `sisa_hari < 0`)
- `PERHATIAN` — mendekati (oli `0 <= sisa <= 50`; pajak/KIR `0 <= sisa_hari <= 30`)

Hanya kendaraan ber-`status = 'Aktif'` dan dalam scope cabang user
(PIC: cabangnya sendiri; SUPERADMIN: semua). Kendaraan tanpa kategori yang
memenuhi ambang tidak menghasilkan item.

## 4. Bentuk Output

`WarningItem`:
```ts
{
  kategori: 'OLI' | 'PAJAK' | 'PAJAK_5_TAHUNAN' | 'KIR',
  severity: 'KRITIS' | 'PERHATIAN',
  vehicle_id: string,
  plat_nomor: string,
  kode_cabang: string,
  nama_cabang: string,
  pesan: string,
  // khusus OLI:
  km_sekarang?: number,
  km_target?: number,
  sisa_km?: number,
  // khusus PAJAK/PAJAK_5_TAHUNAN/KIR:
  tanggal_jatuh_tempo?: string,   // YYYY-MM-DD
  sisa_hari?: number,
}
```

Format angka `formatIdNumber` (ribuan `.`, desimal `,`), tanggal display
`formatDateId` (`dd/MM/yyyy`). Pesan deterministik, contoh:

- OLI mendekati: `'Sebentar lagi ganti oli - sisa 40 km'`
- OLI lewat: `'Wajib ganti oli - sudah lewat 20 km'`
- PAJAK mendekati: `'Pajak tahunan jatuh tempo 25/10/2026 (sisa 30 hari)'`
- PAJAK lewat: `'Pajak tahunan sudah lewat jatuh tempo 20/07/2026'`
- (pola sama untuk `PAJAK_5_TAHUNAN` — `'Pajak 5 tahunan ...'`, dan `KIR` — `'KIR ...'`)

Urutan deterministik: severity `KRITIS` dulu → `sisa` (km/hari) terkecil →
`kategori` → `kode_cabang` → `plat_nomor`.

## 5. API / Dashboard

`GET /api/dashboard` diperluas menjadi:
```json
{ "transactions": [...], "monthly": [...], "warnings": [...] }
```
Backward-compatible — field lama tidak berubah, `warnings` field baru. Tidak ada
endpoint baru.

Warnings dihitung dari data yang sudah diambil handler:
- `deps.master.listAll()` → seluruh kendaraan (filter Aktif + scope cabang
  dilakukan oleh `computeWarnings` di logic)
- `recentRows(cabang, 2000)` (sudah ada) → `buildOdoMap`
- `today` = `new Date()` (UTC)

## 6. Cache & Invalidation

- Key: `warningsCacheKey(role, cabang)` = `dashwarn:<role>:<cabang>`
- TTL **300 dtk**, `kv.put` saat dihitung ulang; baca `kv.get(key, 'json')`
  sebelum hitung
- `invalidateDashwarn(kv, role, cabang)` menghapus `dashwarn:<role>:<cabang>`
  dan `dashwarn:SUPERADMIN:` (pola sama `invalidateLaporanCaches`)
- Dipanggil di:
  - `POST /api/laporan` (save)
  - `PUT /api/laporan/:id` (edit)
  - `DELETE /api/laporan/:id` (hapus)
  - `POST /api/master/kendaraan/:id/reset-oli`

`transactions` selalu segar; hanya `warnings` dan `monthly` dari cache.

## 7. Pengujian

**Unit (`tests/logic/warnings.test.ts`):**
- `buildOdoMap` (seq tertinggi menang, tanpa baris → tanpa entri)
- OLI: `sisa<=50` → PERHATIAN; `sisa<0` → KRITIS; `sisa>50` → tidak ada; `km_terakhir<=0` → skip; tanpa odo → skip; `interval<=0` → fallback `defaultOilIntervalKm`
- Pajak/KIR: `<=30` hari → PERHATIAN; lewat → KRITIS; kosong/tidak valid → skip
- `daysUntil`, pesan verbatim-deterministik, sort

**Route (`tests/routes/laporan.test.ts` edit):**
- `/api/dashboard` → `warnings` berisi item OLI yang sesuai
- Kendaraan Non-Aktif / cabang lain tidak muncul (PIC scope)
- Panggilan kedua setelah state berubah → `warnings` identik (cache 300), `transactions` berubah
- Save laporan → key `dashwarn:*` terhapus
- 401 tanpa token (existing)

**Route (`tests/routes/master.test.ts` edit):**
- `reset-oli` → key `dashwarn:*` terhapus

**Gate:** tiap task diakhiri `npm run typecheck` + `npx vitest run` hijau, lalu commit.

## 8. File Structure (tambahan/perubahan)

```
src/logic/warnings.ts               # BARU
src/logic/master-cache.ts           # EDIT (warningsCacheKey, invalidateDashwarn)
src/routes/laporan.ts               # EDIT (dashboard warnings + invalidate)
src/routes/master.ts                # EDIT (reset-oli invalidate)
tests/logic/warnings.test.ts        # BARU
tests/routes/laporan.test.ts        # EDIT
tests/routes/master.test.ts         # EDIT
README.md                           # EDIT: tabel API M4 + status
docs/superpowers/specs/2026-09-25-m4-dashboard-warnings-design.md   # ini
```