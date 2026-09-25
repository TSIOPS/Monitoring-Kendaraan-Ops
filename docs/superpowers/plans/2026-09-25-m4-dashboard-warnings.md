# M4 — Dashboard & Warnings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Perluas `GET /api/dashboard` agar mengembalikan `warnings` (peringatan ganti oli, pajak tahunan, pajak 5 tahunan, KIR) dengan aturan murni di `src/logic/warnings.ts`, lengkap dengan cache `dashwarn:*` TTL 300 dtk dan invalidasi.

**Architecture:** Mengikuti pola M2/M3 — logic murni (`src/logic/warnings.ts`) tanpa env/DB/KV, dipakai oleh handler dashboard di `src/routes/laporan.ts`; cache KV `dashwarn:<role>:<cabang>` TTL 300 dengan `invalidateDashwarn` (pola identik `invalidateLaporanCaches`) di save/edit/delete laporan + reset-oli. Output `{ transactions, monthly, warnings }` backward-compatible. **Tidak ada perubahan schema SQL.**

**Tech Stack:** Hono, @supabase/supabase-js, Cloudflare KV, Vitest (repo in-memory `tests/helpers.ts`), TypeScript.

## Global Constraints

- **Tanpa perubahan schema SQL.** Semua input sudah ada di tabel `kendaraan` (`tanggal_pajak`, `tanggal_pajak_5_tahunan`, `tanggal_kir`, `km_terakhir_ganti_oli`, `interval_ganti_oli_km`) dan `penggunaan_bbm` (odo).
- Ambang warning: OLI `sisa ≤ 50 km`; PAJAK/PAJAK_5_TAHUNAN/KIR `sisa_hari ≤ 30 hari` (lewat → tetap muncul, `KRITIS`).
- Skip OLI bila `km_terakhir_ganti_oli <= 0` **atau** odo kendaraan tidak tersedia. Bila `interval_ganti_oli_km <= 0`, fallback `defaultOilIntervalKm(jenis)` (motor = 3000, selain motor = 5000).
- Skip PAJAK/PAJAK_5_TAHUNAN/KIR bila kolom kosong atau tanggal tidak valid.
- Severity: `KRITIS` bila lewat (`sisa < 0` / `sisa_hari < 0`), `PERHATIAN` bila `0 <= sisa <= 50` / `0 <= sisa_hari <= 30`.
- Hanya kendaraan `status = 'Aktif'` dan dalam scope cabang user (PIC: cabang sendiri; SUPERADMIN: semua) — filter dilakukan di `computeWarnings`.
- Cache key `warningsCacheKey(role, cabang)` = `dashwarn:<role>:<cabang>`; TTL **300 dtk**; baca `kv.get(key, 'json')` sebelum hitung.
- `invalidateDashwarn(kv, role, cabang)` menghapus `dashwarn:<role>:<cabang>` **dan** `dashwarn:SUPERADMIN:` — dipanggil di save, edit, delete laporan, dan reset-oli.
- Format angka `formatIdNumber` (ribuan `.`, desimal `,`); tanggal display `formatDateId` (`dd/MM/yyyy`). Pesan harus verbatim sesuai contoh spec M4 §4.
- Sort deterministik: severity `KRITIS` dulu → `sisa` (km/hari) terkecil → `kategori` (`OLI` < `PAJAK` < `PAJAK_5_TAHUNAN` < `KIR`) → `kode_cabang` → `plat_nomor`.
- Wawasan 100% UTC: `today = new Date()` (Workers UTC), pembanding tanggal pakai `Date.UTC`.
- Gate tiap task: `npm run typecheck` **dan** `npx vitest run` hijau, lalu commit (gaya repo: *conventional commits*, pesan bahasa Indonesia dicampur singkat).
- Pesan error/pesan sukses tidak diubah di tugas ini kecuali yang disebut eksplisit.

---

### Task 1: Engine Warnings Murni `src/logic/warnings.ts` + Unit Test

**Files:**
- Create: `src/logic/warnings.ts`
- Test: `tests/logic/warnings.test.ts`

**Interfaces:**
- Consumes:
  - `LaporanRow` (type, `src/logic/laporan.ts:4`) — gunakan `km_akhir_confirmed`, `vehicle_id`, `seq?`.
  - `formatIdNumber` (`src/logic/laporan.ts:332`) dan `formatDateId` (`src/logic/laporan.ts:351`).
  - `defaultOilIntervalKm(jenis: string | undefined | null): number` (`src/logic/master.ts:16`).
- Produces (dipakai Task 2/3 & route):
  - `type WarningCategory = 'OLI' | 'PAJAK' | 'PAJAK_5_TAHUNAN' | 'KIR'`
  - `type WarningSeverity = 'KRITIS' | 'PERHATIAN'`
  - `interface WarningItem` — `{ kategori: WarningCategory; severity: WarningSeverity; vehicle_id: string; plat_nomor: string; kode_cabang: string; nama_cabang: string; pesan: string; km_sekarang?: number; km_target?: number; sisa_km?: number; tanggal_jatuh_tempo?: string; sisa_hari?: number; }`
  - `interface WarningVehicle` — `{ vehicle_id: string; plat_nomor: string; kode_cabang: string; status: string; jenis_kendaraan: string; tanggal_pajak: string; tanggal_pajak_5_tahunan: string; tanggal_kir: string; km_terakhir_ganti_oli: number; interval_ganti_oli_km: number; }`
  - `interface WarningInput` — `{ kendaraan: WarningVehicle[]; user: { role: string; cabang: string }; odoMap: Record<string, number>; cabangNama?: Map<string, string>; today: Date; }`
  - `export const OLI_SISA_AMBANG = 50`
  - `export const TANGGAL_SISA_AMBANG = 30`
  - `export function buildOdoMap(rows: LaporanRow[]): Record<string, number>`
  - `export function daysUntil(dateStr: string | null | undefined, today: Date): number | null`
  - `export function buildOliPesan(sisaKm: number): string`
  - `export function buildTanggalPesan(kategori: Exclude<WarningCategory, 'OLI'>, due: string, sisaHari: number): string`
  - `export function computeWarnings(input: WarningInput): WarningItem[]`

- [ ] **Step 1: Write the failing unit test**

Create `tests/logic/warnings.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LaporanRow } from '../../src/logic/laporan';
import type { WarningVehicle } from '../../src/logic/warnings';
import { buildOdoMap, computeWarnings, daysUntil } from '../../src/logic/warnings';

const TODAY = new Date('2026-09-25T00:00:00Z');

const vehicle = (over: Partial<WarningVehicle> = {}): WarningVehicle => ({
  vehicle_id: 'V-1', plat_nomor: 'B 1 A', kode_cabang: 'CBG-A', status: 'Aktif',
  jenis_kendaraan: 'Mobil',
  tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '',
  km_terakhir_ganti_oli: 10000, interval_ganti_oli_km: 5000,
  ...over,
});

function row(over: Partial<LaporanRow> = {}): LaporanRow {
  return {
    transaction_id: 'TRX-1', timestamp: '2026-09-01T01:00:00.000Z', tanggal: '2026-09-01',
    user_id: 'U-1', nama_pengguna: 'B', kode_cabang: 'CBG-A', vehicle_id: 'V-1', plat_nomor: 'B 1 A',
    foto_km_awal: '', ocr_km_awal: '', km_awal_confirmed: '100', bar_awal: '8',
    foto_km_akhir: '', ocr_km_akhir: '', km_akhir_confirmed: '1000', bar_akhir: '4',
    km_tempuh: 100, perubahan_bar: 4, liter_bbm: 10, biaya_bbm: 100000,
    foto_struk_bbm: '', biaya_toll: 0, foto_struk_toll: '', km_per_liter: 10,
    status: 'COMPLETED', warning: '', nama_supir: 'S', metode_pembayaran: 'TUNAI',
    flazz_card_id: '', km_sumber: 'AKTUAL', metode_toll: 'TUNAI', flazz_card_id_toll: '',
    seq: 1,
    ...over,
  };
}

const run = (kendaraan: WarningVehicle[], odoMap: Record<string, number>, today: Date = TODAY) =>
  computeWarnings({
    kendaraan,
    user: { role: 'SUPERADMIN', cabang: '' },
    odoMap,
    cabangNama: new Map([['CBG-A', 'Cabang A'], ['CBG-B', 'Cabang B']]),
    today,
  });

describe('buildOdoMap', () => {
  it('seq tertinggi menang; KM <= 0 diabaikan; tanpa baris tidak ada entri', () => {
    const map = buildOdoMap([
      row({ vehicle_id: 'V-1', km_akhir_confirmed: '12000', seq: 1 }),
      row({ vehicle_id: 'V-1', km_akhir_confirmed: '13000', seq: 2 }),
      row({ vehicle_id: 'V-1', km_akhir_confirmed: '14000', seq: 3 }),
      row({ vehicle_id: 'V-2', km_akhir_confirmed: '0', seq: 4 }),
      row({ vehicle_id: '', km_akhir_confirmed: '500', seq: 5 }),
    ]);
    expect(map).toEqual({ 'V-1': 14000 });
    expect(buildOdoMap([])).toEqual({});
  });
});

describe('daysUntil', () => {
  it('hitung sisa hari UTC; kosong/tidak valid -> null', () => {
    expect(daysUntil('2026-10-25', TODAY)).toBe(30);
    expect(daysUntil('2026-09-25', TODAY)).toBe(0);
    expect(daysUntil('2026-07-20', TODAY)).toBe(-67);
    expect(daysUntil('', TODAY)).toBeNull();
    expect(daysUntil('abc', TODAY)).toBeNull();
    expect(daysUntil(null, TODAY)).toBeNull();
  });
});

describe('computeWarnings — OLI', () => {
  it('mendekati -> PERHATIAN dengan pesan verbatim', () => {
    const items = run([vehicle()], { 'V-1': 14980 });
    expect(items).toEqual([
      {
        kategori: 'OLI', severity: 'PERHATIAN', vehicle_id: 'V-1', plat_nomor: 'B 1 A',
        kode_cabang: 'CBG-A', nama_cabang: 'Cabang A',
        pesan: 'Sebentar lagi ganti oli - sisa 20 km',
        km_sekarang: 14980, km_target: 15000, sisa_km: 20,
      },
    ]);
  });

  it('lewat -> KRITIS dengan pesan verbatim', () => {
    const items = run([vehicle()], { 'V-1': 15020 });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      severity: 'KRITIS',
      pesan: 'Wajib ganti oli - sudah lewat 20 km',
      km_sekarang: 15020, km_target: 15000, sisa_km: -20,
    });
  });

  it('sisa > 50 km -> tidak ada item', () => {
    expect(run([vehicle()], { 'V-1': 10000 })).toEqual([]);
  });

  it('km_terakhir_ganti_oli <= 0 -> skip', () => {
    expect(run([vehicle({ km_terakhir_ganti_oli: 0 })], { 'V-1': 14980 })).toEqual([]);
    expect(run([vehicle({ km_terakhir_ganti_oli: -5 })], { 'V-1': 14980 })).toEqual([]);
  });

  it('tanpa odo -> skip', () => {
    expect(run([vehicle()], {})).toEqual([]);
  });

  it('interval_ganti_oli_km <= 0 -> fallback defaultOilIntervalKm', () => {
    const mobil = run([vehicle({ interval_ganti_oli_km: 0 })], { 'V-1': 14980 });
    expect(mobil).toHaveLength(1);
    expect(mobil[0]).toMatchObject({ sisa_km: 20, km_target: 15000 });

    const motor = run(
      [vehicle({ jenis_kendaraan: 'Motor', interval_ganti_oli_km: 0, km_terakhir_ganti_oli: 1000 })],
      { 'V-1': 3980 },
    );
    expect(motor[0]).toMatchObject({ sisa_km: 20, km_target: 4000 });
  });

  it('interval > 0 dihormati', () => {
    const items = run([vehicle({ interval_ganti_oli_km: 2000 })], { 'V-1': 13000 });
    expect(items[0]).toMatchObject({ severity: 'KRITIS', sisa_km: -1000, km_target: 12000 });
  });
});

describe('computeWarnings — tanggal', () => {
  it('PAJAK mendekati -> PERHATIAN, pesan verbatim', () => {
    const items = run([vehicle({ tanggal_pajak: '2026-10-25' })], {});
    expect(items).toEqual([
      {
        kategori: 'PAJAK', severity: 'PERHATIAN', vehicle_id: 'V-1', plat_nomor: 'B 1 A',
        kode_cabang: 'CBG-A', nama_cabang: 'Cabang A',
        pesan: 'Pajak tahunan jatuh tempo 25/10/2026 (sisa 30 hari)',
        tanggal_jatuh_tempo: '2026-10-25', sisa_hari: 30,
      },
    ]);
  });

  it('PAJAK lewat -> KRITIS, pesan verbatim', () => {
    const items = run([vehicle({ tanggal_pajak: '2026-09-20' })], {});
    expect(items[0]).toMatchObject({
      kategori: 'PAJAK', severity: 'KRITIS',
      pesan: 'Pajak tahunan sudah lewat jatuh tempo 20/09/2026', sisa_hari: -5,
    });
  });

  it('label PAJAK_5_TAHUNAN dan KIR dengan pola pesan sama', () => {
    const items = run(
      [vehicle({ tanggal_pajak: '2026-09-26', tanggal_pajak_5_tahunan: '2026-09-27', tanggal_kir: '2026-09-28' })],
      {},
    );
    expect(items.map((i) => i.pesan)).toEqual([
      'Pajak tahunan jatuh tempo 26/09/2026 (sisa 1 hari)',
      'Pajak 5 tahunan jatuh tempo 27/09/2026 (sisa 2 hari)',
      'KIR jatuh tempo 28/09/2026 (sisa 3 hari)',
    ]);
  });

  it('tanggal kosong/tidak valid -> skip', () => {
    expect(run([vehicle()], {})).toEqual([]);
    expect(run([vehicle({ tanggal_pajak: 'abc', tanggal_kir: '2026/13/40' })], {})).toEqual([]);
  });
});

describe('computeWarnings — scope & sort', () => {
  it('kendaraan Non-Aktif tidak muncul', () => {
    expect(run([vehicle({ status: 'Non-Aktif', km_terakhir_ganti_oli: 5000 })], { 'V-1': 14980 })).toEqual([]);
  });

  it('PIC hanya melihat cabangnya sendiri', () => {
    const items = computeWarnings({
      kendaraan: [
        vehicle({ vehicle_id: 'V-A', kode_cabang: 'CBG-A' }),
        vehicle({ vehicle_id: 'V-B', kode_cabang: 'CBG-B' }),
      ],
      user: { role: 'PIC CABANG', cabang: 'CBG-A' },
      odoMap: { 'V-A': 14980, 'V-B': 14980 },
      cabangNama: new Map([['CBG-A', 'Cabang A'], ['CBG-B', 'Cabang B']]),
      today: TODAY,
    });
    expect(items.map((i) => i.vehicle_id)).toEqual(['V-A']);
  });

  it('urutan: KRITIS dulu, sisa terkecil duluan (paling lewat di depan)', () => {
    const items = computeWarnings({
      kendaraan: [
        vehicle({ vehicle_id: 'V-P', plat_nomor: 'B 9 P', tanggal_pajak: '2026-07-20' }),
        vehicle({ vehicle_id: 'V-O', plat_nomor: 'B 8 O' }),
      ],
      user: { role: 'SUPERADMIN', cabang: '' },
      odoMap: { 'V-O': 15020 },
      cabangNama: new Map([['CBG-A', 'Cabang A']]),
      today: TODAY,
    });
    expect(items.map((i) => i.vehicle_id)).toEqual(['V-P', 'V-O']);
  });

  it('tie-break plat_nomor saat sisa & kategori sama', () => {
    const items = run([
      vehicle({ vehicle_id: 'V-B', plat_nomor: 'B 2 B' }),
      vehicle({ vehicle_id: 'V-A', plat_nomor: 'B 1 A' }),
    ], { 'V-A': 14980, 'V-B': 14980 });
    expect(items.map((i) => i.vehicle_id)).toEqual(['V-A', 'V-B']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/logic/warnings.test.ts`
Expected: FAIL — `Cannot find module '../../src/logic/warnings'`

- [ ] **Step 3: Write minimal implementation**

Create `src/logic/warnings.ts`:

```ts
import { formatDateId, formatIdNumber } from './laporan';
import type { LaporanRow } from './laporan';
import { defaultOilIntervalKm } from './master';

export type WarningCategory = 'OLI' | 'PAJAK' | 'PAJAK_5_TAHUNAN' | 'KIR';
export type WarningSeverity = 'KRITIS' | 'PERHATIAN';

export interface WarningItem {
  kategori: WarningCategory;
  severity: WarningSeverity;
  vehicle_id: string;
  plat_nomor: string;
  kode_cabang: string;
  nama_cabang: string;
  pesan: string;
  km_sekarang?: number;
  km_target?: number;
  sisa_km?: number;
  tanggal_jatuh_tempo?: string;
  sisa_hari?: number;
}

export interface WarningVehicle {
  vehicle_id: string;
  plat_nomor: string;
  kode_cabang: string;
  status: string;
  jenis_kendaraan: string;
  tanggal_pajak: string;
  tanggal_pajak_5_tahunan: string;
  tanggal_kir: string;
  km_terakhir_ganti_oli: number;
  interval_ganti_oli_km: number;
}

export interface WarningInput {
  kendaraan: WarningVehicle[];
  user: { role: string; cabang: string };
  odoMap: Record<string, number>;
  cabangNama?: Map<string, string>;
  today: Date;
}

export const OLI_SISA_AMBANG = 50;
export const TANGGAL_SISA_AMBANG = 30;
const DAY_MS = 86400000;

const CATEGORY_LABEL: Record<Exclude<WarningCategory, 'OLI'>, string> = {
  PAJAK: 'Pajak tahunan',
  PAJAK_5_TAHUNAN: 'Pajak 5 tahunan',
  KIR: 'KIR',
};
const SEV_RANK: Record<WarningSeverity, number> = { KRITIS: 0, PERHATIAN: 1 };
const CAT_RANK: Record<WarningCategory, number> = { OLI: 0, PAJAK: 1, PAJAK_5_TAHUNAN: 2, KIR: 3 };

const toNum = (v: unknown): number => {
  const n = parseFloat(String(v ?? ''));
  return isNaN(n) ? 0 : n;
};

export function buildOdoMap(rows: LaporanRow[]): Record<string, number> {
  const out: Record<string, number> = {};
  const maxSeq: Record<string, number> = {};
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!r) continue;
    const vehicleId = String(r.vehicle_id ?? '');
    if (!vehicleId) continue;
    const km = toNum(r.km_akhir_confirmed);
    if (km <= 0) continue;
    const seq = typeof r.seq === 'number' ? r.seq : i;
    if ((maxSeq[vehicleId] ?? -1) <= seq) {
      maxSeq[vehicleId] = seq;
      out[vehicleId] = km;
    }
  }
  return out;
}

export function daysUntil(dateStr: string | null | undefined, today: Date): number | null {
  const s = String(dateStr ?? '').trim();
  if (!s) return null;
  const d = new Date(s.length <= 10 ? s + 'T00:00:00Z' : s);
  if (isNaN(d.getTime())) return null;
  const todayMid = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((d.getTime() - todayMid) / DAY_MS);
}

export function buildOliPesan(sisaKm: number): string {
  if (sisaKm < 0) return 'Wajib ganti oli - sudah lewat ' + formatIdNumber(-sisaKm) + ' km';
  return 'Sebentar lagi ganti oli - sisa ' + formatIdNumber(sisaKm) + ' km';
}

export function buildTanggalPesan(kategori: Exclude<WarningCategory, 'OLI'>, due: string, sisaHari: number): string {
  const label = CATEGORY_LABEL[kategori];
  const tgl = formatDateId(due);
  if (sisaHari < 0) return label + ' sudah lewat jatuh tempo ' + tgl;
  return label + ' jatuh tempo ' + tgl + ' (sisa ' + formatIdNumber(sisaHari) + ' hari)';
}

export function computeWarnings(input: WarningInput): WarningItem[] {
  const role = String(input.user.role || '').toUpperCase();
  const isSuper = role === 'SUPERADMIN';
  const cabangUser = String(input.user.cabang ?? '');
  const cabangNama = input.cabangNama ?? new Map<string, string>();
  const items: WarningItem[] = [];

  for (const v of input.kendaraan) {
    if (String(v.status || '') !== 'Aktif') continue;
    if (!isSuper && String(v.kode_cabang ?? '') !== cabangUser) continue;

    const odo = toNum(input.odoMap[v.vehicle_id]);
    if (odo > 0 && toNum(v.km_terakhir_ganti_oli) > 0) {
      const interval = toNum(v.interval_ganti_oli_km) > 0
        ? toNum(v.interval_ganti_oli_km)
        : defaultOilIntervalKm(v.jenis_kendaraan);
      const base = toNum(v.km_terakhir_ganti_oli);
      const target = base + interval;
      const sisa = target - odo;
      if (sisa <= OLI_SISA_AMBANG) {
        items.push({
          kategori: 'OLI',
          severity: sisa < 0 ? 'KRITIS' : 'PERHATIAN',
          vehicle_id: v.vehicle_id,
          plat_nomor: v.plat_nomor,
          kode_cabang: v.kode_cabang,
          nama_cabang: cabangNama.get(v.kode_cabang) ?? v.kode_cabang,
          pesan: buildOliPesan(sisa),
          km_sekarang: odo,
          km_target: target,
          sisa_km: sisa,
        });
      }
    }

    const dateSources: Array<{ kategori: Exclude<WarningCategory, 'OLI'>; field: string }> = [
      { kategori: 'PAJAK', field: v.tanggal_pajak },
      { kategori: 'PAJAK_5_TAHUNAN', field: v.tanggal_pajak_5_tahunan },
      { kategori: 'KIR', field: v.tanggal_kir },
    ];
    for (const src of dateSources) {
      const sisaHari = daysUntil(src.field, input.today);
      if (sisaHari === null || sisaHari > TANGGAL_SISA_AMBANG) continue;
      items.push({
        kategori: src.kategori,
        severity: sisaHari < 0 ? 'KRITIS' : 'PERHATIAN',
        vehicle_id: v.vehicle_id,
        plat_nomor: v.plat_nomor,
        kode_cabang: v.kode_cabang,
        nama_cabang: cabangNama.get(v.kode_cabang) ?? v.kode_cabang,
        pesan: buildTanggalPesan(src.kategori, src.field, sisaHari),
        tanggal_jatuh_tempo: src.field,
        sisa_hari: sisaHari,
      });
    }
  }

  const remOf = (i: WarningItem): number => i.sisa_km ?? i.sisa_hari ?? 0;
  items.sort((a, b) =>
    SEV_RANK[a.severity] - SEV_RANK[b.severity] ||
    remOf(a) - remOf(b) ||
    CAT_RANK[a.kategori] - CAT_RANK[b.kategori] ||
    String(a.kode_cabang).localeCompare(String(b.kode_cabang)) ||
    String(a.plat_nomor).localeCompare(String(b.plat_nomor)),
  );
  return items;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/logic/warnings.test.ts`
Expected: PASS — seluruh `it`-block hijau.

- [ ] **Step 5: Gate + Commit**

```bash
git add src/logic/warnings.ts tests/logic/warnings.test.ts
npx vitest run tests/logic/warnings.test.ts
git commit -m "feat(warnings): engine aturan OLI/pajak/KIR murni + unit test"
```

---

### Task 2: Dashboard `warnings` + Cache KV

**Files:**
- Modify: `src/logic/master-cache.ts:17-23` (tambah `warningsCacheKey` setelah `monthlyCacheKey`)
- Modify: `src/routes/laporan.ts:9` (import `warningsCacheKey`), `src/routes/laporan.ts:560-577` (handler dashboard)
- Test: `tests/routes/laporan.test.ts` (describe `GET /api/dashboard`); import `warningsCacheKey` di baris 5

**Interfaces:**
- Consumes: `computeWarnings`, `buildOdoMap`, type `WarningItem`, interface `WarningVehicle` dari `src/logic/warnings.ts` (Task 1); `warningsCacheKey(role, cabang)` (task ini); `roleOf(u)`, `isSuper(u)`, `kendaraanInfoMap(all)`, `cabangNamaMapOf(all)` (sudah ada di `src/routes/laporan.ts`); `okPayload` (`src/utils/http.ts`).
- Produces (dipakai Task 3 & spec):
  - `export function warningsCacheKey(role: string, cabang: string): string` → `` `dashwarn:${role || ''}:${cabang || ''}` ``
  - `GET /api/dashboard` kini mengembalikan `{ transactions, monthly, warnings }`; `warnings` dibaca KV `dashwarn:<role>:<cabang>` TTL 300, dihitung ulang bila miss.

- [ ] **Step 1: Write the failing route test**

Edit `tests/routes/laporan.test.ts`:

Baris 5, ganti import menjadi:
```ts
import { monthlyCacheKey, performaCacheKey, warningsCacheKey } from '../../src/logic/master-cache';
```

Tambahkan helper persis setelah `setup(...)` (baris 32-42):
```ts
function warnSetup(init: { kendaraan?: typeof VEHICLE_ROW[]; rows?: Parameters<typeof laporanRow>[0][] } = {}) {
  const master = memMaster({
    cabang: [
      { kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: '', status: 'Aktif' },
      { kode_cabang: 'CBG-B', nama_cabang: 'Cabang B', lokasi: '', status: 'Aktif' },
    ],
    kendaraan: init.kendaraan ?? [VEHICLE_ROW],
  });
  const lap = memLaporan({ rows: (init.rows ?? []).map((r) => laporanRow(r)) });
  const { deps, kv } = makeDeps({ master: master.repo, laporan: lap.repo });
  const app = buildApp(fakeEnv() as any, deps);
  return { app, kv, master, lap };
}
```

Di dalam `describe('GET /api/dashboard', ...)` (baris 198-226), tambahkan test setelah `'PIC hanya melihat transaksi cabangnya'`:
```ts
  it('warnings: OLI PERHATIAN dari odo terakhir (sisa <= 50 km)', async () => {
    const { app, kv } = warnSetup({ rows: [{ transaction_id: 'TRX-1', km_akhir_confirmed: '14980' }] });
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/dashboard', { headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.warnings).toEqual([
      {
        kategori: 'OLI', severity: 'PERHATIAN', vehicle_id: 'V-1', plat_nomor: 'B 1 A',
        kode_cabang: 'CBG-A', nama_cabang: 'Cabang A',
        pesan: 'Sebentar lagi ganti oli - sisa 20 km',
        km_sekarang: 14980, km_target: 15000, sisa_km: 20,
      },
    ]);
  });

  it('warnings: OLI KRITIS saat odo melewati target', async () => {
    const { app, kv } = warnSetup({ rows: [{ transaction_id: 'TRX-1', km_akhir_confirmed: '15020' }] });
    const tok = await loginAs(kv, PIC);
    const body = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0]).toMatchObject({ severity: 'KRITIS', pesan: 'Wajib ganti oli - sudah lewat 20 km', sisa_km: -20 });
  });

  it('warnings: kendaraan Non-Aktif & cabang lain tidak muncul (PIC scope)', async () => {
    const { app, kv } = warnSetup({
      kendaraan: [
        VEHICLE_ROW,
        { ...VEHICLE_ROW, vehicle_id: 'V-2', plat_nomor: 'B 2 B', kode_cabang: 'CBG-B', status: 'Aktif' },
        { ...VEHICLE_ROW, vehicle_id: 'V-3', plat_nomor: 'B 3 C', kode_cabang: 'CBG-A', status: 'Non-Aktif' },
      ],
      rows: [{ transaction_id: 'TRX-1', km_akhir_confirmed: '14980' }],
    });
    const tok = await loginAs(kv, PIC);
    const body = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(body.warnings.map((w: any) => w.vehicle_id)).toEqual(['V-1']);
  });

  it('warnings: SUPERADMIN melihat semua cabang (urut kode_cabang)', async () => {
    const { app, kv } = warnSetup({
      kendaraan: [
        VEHICLE_ROW,
        { ...VEHICLE_ROW, vehicle_id: 'V-2', plat_nomor: 'B 2 B', kode_cabang: 'CBG-B', status: 'Aktif' },
      ],
      rows: [
        { transaction_id: 'TRX-1', km_akhir_confirmed: '14980' },
        { transaction_id: 'TRX-2', kode_cabang: 'CBG-B', vehicle_id: 'V-2', km_akhir_confirmed: '14980' },
      ],
    });
    const tok = await loginAs(kv, SUPER);
    const body = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(body.warnings.map((w: any) => w.vehicle_id)).toEqual(['V-1', 'V-2']);
    expect(body.warnings[1]).toMatchObject({ kode_cabang: 'CBG-B', nama_cabang: 'Cabang B' });
  });

  it('warnings memakai cache: perubahan state tidak terlihat pada panggilan kedua', async () => {
    const { app, kv, lap } = warnSetup({ rows: [{ transaction_id: 'TRX-1', km_akhir_confirmed: '14980' }] });
    const tok = await loginAs(kv, PIC);
    const b1 = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(b1.warnings).toHaveLength(1);
    expect(b1.warnings[0].severity).toBe('PERHATIAN');
    expect(await kv.get(warningsCacheKey('PIC CABANG', 'CBG-A'), 'json')).not.toBeNull();
    lap.state.rows.push(laporanRow({ transaction_id: 'TRX-2', km_akhir_confirmed: '15020' }));
    const b2 = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(b2.warnings).toHaveLength(1);
    expect(b2.warnings[0].severity).toBe('PERHATIAN');
    expect(b2.transactions).toHaveLength(2);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/routes/laporan.test.ts`
Expected: FAIL — `warningsCacheKey is not a function` (belum ada) dan `body.warnings` undefined (handler belum mengembalikannya).

- [ ] **Step 3: Add `warningsCacheKey`**

Edit `src/logic/master-cache.ts`, setelah `monthlyCacheKey` (baris 21-23):

```ts
export function warningsCacheKey(role: string, cabang: string): string {
  return `dashwarn:${role || ''}:${cabang || ''}`;
}
```

- [ ] **Step 4: Wire warning engine + cache ke dashboard**

Edit `src/routes/laporan.ts` baris 9 — ganti import master-cache menjadi:
```ts
import { bumpMasterRev, invalidateLaporanCaches, performaCacheKey, monthlyCacheKey, warningsCacheKey } from '../logic/master-cache';
```

Tambah import warnings (setelah `import * as L from '../logic/laporan';` baris 13):
```ts
import { buildOdoMap, computeWarnings } from '../logic/warnings';
import type { WarningItem, WarningVehicle } from '../logic/warnings';
```

Ganti body handler `app.get('/', requireUser(deps), ...)` di `dashboardRoutes` (baris 560-577) menjadi:

```ts
  app.get('/', requireUser(deps), async (c) => {
    const u = c.get('user');
    const cabang = isSuper(u) ? '' : u.cabang;
    const all = await deps.master.listAll();
    const cardIdMap = await loadCardIdMap(deps);
    const rows = await deps.laporan.recentRows(cabang, 2000);
    const transactions = L.buildRecentList(rows, kendaraanInfoMap(all), cabangNamaMapOf(all), cardIdMap);

    const periode = L.periodKey(new Date());
    const mkey = monthlyCacheKey(roleOf(u), cabang);
    let monthly = await deps.kv.get(mkey, 'json') as L.MonthlyItem[] | null;
    if (!monthly) {
      const monthRows = await deps.laporan.rowsInMonth(cabang, periode);
      monthly = L.groupMonthly(monthRows, periode);
      await deps.kv.put(mkey, JSON.stringify(monthly), { expirationTtl: 300 });
    }

    const wkey = warningsCacheKey(roleOf(u), cabang);
    let warnings = await deps.kv.get(wkey, 'json') as WarningItem[] | null;
    if (!warnings) {
      const kendaraan = all.kendaraan as WarningVehicle[];
      warnings = computeWarnings({
        kendaraan,
        user: { role: roleOf(u), cabang: u.cabang },
        odoMap: buildOdoMap(rows),
        cabangNama: cabangNamaMapOf(all),
        today: new Date(),
      });
      await deps.kv.put(wkey, JSON.stringify(warnings), { expirationTtl: 300 });
    }
    return c.json(okPayload({ transactions, monthly, warnings }));
  });
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/routes/laporan.test.ts`
Expected: PASS — semua test dashboard (lama + baru) hijau.

- [ ] **Step 6: Gate + Commit**

```bash
git add src/logic/master-cache.ts src/routes/laporan.ts tests/routes/laporan.test.ts
npm run typecheck
npx vitest run tests/routes/laporan.test.ts
git commit -m "feat(dashboard): field warnings + cache dashwarn TTL 300"
```

---

### Task 3: `invalidateDashwarn` + Wiring Save/Edit/Delete/Reset-Oli

**Files:**
- Modify: `src/logic/master-cache.ts` (tambah `invalidateDashwarn` setelah fungsi key)
- Modify: `src/routes/laporan.ts:294-295`, `:497-498`, `:548-549` (panggil `invalidateDashwarn`)
- Modify: `src/routes/master.ts:184` (reset-oli — panggil `invalidateDashwarn`)
- Test: `tests/routes/laporan.test.ts` (blok `lintas-cutting`), `tests/routes/master.test.ts`

**Interfaces:**
- Consumes: `warningsCacheKey` (Task 2); `deps.kv` dari `AppDeps`; `roleOf(u)`, `u.cabang` di routes.
- Produces:
  - `export async function invalidateDashwarn(kv: KVStore, role: string, cabang: string): Promise<void>` — hapus `dashwarn:<role>:<cabang>` dan `dashwarn:SUPERADMIN:` (struktur identik `invalidateLaporanCaches`).
  - Semua `POST/PUT/DELETE /api/laporan` dan `POST /api/master/kendaraan/:id/reset-oli` menghapus key dashwarn scope user + SUPERADMIN.

- [ ] **Step 1: Write the failing tests**

Edit `tests/routes/laporan.test.ts` — tambahkan di ujung blok `lintas-cutting` (setelah test `'dashboard monthly memakai cache...'`, baris 376-385):

```ts
  it('save menghapus cache dashwarn (scope PIC + SUPERADMIN)', async () => {
    const { app, kv } = setup();
    const keys = [
      warningsCacheKey('PIC CABANG', 'CBG-A'),
      warningsCacheKey('SUPERADMIN', ''),
    ];
    for (const k of keys) await kv.put(k, 'x');
    const tok = await loginAs(kv, PIC);
    await post(app, '/api/laporan', tok, saveBody());
    for (const k of keys) expect(await kv.get(k)).toBeNull();
  });

  it('edit menghapus cache dashwarn', async () => {
    const { app, kv } = setup({ rows: [{ transaction_id: 'TRX-1' }] });
    const key = warningsCacheKey('PIC CABANG', 'CBG-A');
    await kv.put(key, 'x');
    const tok = await loginAs(kv, PIC);
    await put(app, '/api/laporan/TRX-1', tok, { biaya_bbm: 90000 });
    expect(await kv.get(key)).toBeNull();
  });

  it('delete menghapus cache dashwarn', async () => {
    const { app, kv } = setup({ rows: [{ transaction_id: 'TRX-1' }] });
    const key = warningsCacheKey('PIC CABANG', 'CBG-A');
    await kv.put(key, 'x');
    const tok = await loginAs(kv, PIC);
    await del(app, '/api/laporan/TRX-1', tok);
    expect(await kv.get(key)).toBeNull();
  });
```

Edit `tests/routes/master.test.ts` — baris 3, tambah import:
```ts
import { warningsCacheKey } from '../../src/logic/master-cache';
```
Tambah test setelah `'reset-oli memakai km_akhir_confirmed terakhir (last-wins)'` (baris 98-114):

```ts
  it('reset-oli menghapus key dashwarn', async () => {
    const { state, repo } = memMaster({ kendaraan: [VEHICLE_ROW] });
    const { deps, kv } = makeDeps({ master: repo });
    const app = buildApp(fakeEnv() as any, deps);
    const key = warningsCacheKey('SUPERADMIN', '');
    await kv.put(key, 'x');
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/master/kendaraan/V-1/reset-oli', { method: 'POST', headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    expect(await kv.get(key)).toBeNull();
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/routes/laporan.test.ts tests/routes/master.test.ts`
Expected: FAIL — 4 test baru gagal (key dashwarn masih ada; `invalidateDashwarn` belum ada).

- [ ] **Step 3: Add `invalidateDashwarn`**

Edit `src/logic/master-cache.ts` — tambahkan di akhir file (setelah `invalidateLaporanCaches`, baris 25-31):

```ts
export async function invalidateDashwarn(kv: KVStore, role: string, cabang: string): Promise<void> {
  const scopes: Array<[string, string]> = [[role || '', cabang || ''], ['SUPERADMIN', '']];
  for (const [r, cb] of scopes) {
    await kv.delete(warningsCacheKey(r, cb));
  }
}
```

- [ ] **Step 4: Call `invalidateDashwarn` di save laporan**

Edit `src/routes/laporan.ts` baris 9 — ganti import menjadi:
```ts
import { bumpMasterRev, invalidateDashwarn, invalidateLaporanCaches, performaCacheKey, monthlyCacheKey, warningsCacheKey } from '../logic/master-cache';
```

Baris 294-295 (`POST /api/laporan`), ganti:
```ts
    await invalidateLaporanCaches(deps.kv, roleOf(u), u.cabang);
    if (usedFlazz) await bumpMasterRev(deps.kv);
```
menjadi:
```ts
    await invalidateLaporanCaches(deps.kv, roleOf(u), u.cabang);
    await invalidateDashwarn(deps.kv, roleOf(u), u.cabang);
    if (usedFlazz) await bumpMasterRev(deps.kv);
```

- [ ] **Step 5: Call `invalidateDashwarn` di edit & delete laporan**

Baris 497-498 (`PUT /api/laporan/:id`), ganti:
```ts
    await invalidateLaporanCaches(deps.kv, roleOf(u), u.cabang);
    await bumpMasterRev(deps.kv);
```
menjadi:
```ts
    await invalidateLaporanCaches(deps.kv, roleOf(u), u.cabang);
    await invalidateDashwarn(deps.kv, roleOf(u), u.cabang);
    await bumpMasterRev(deps.kv);
```

Baris 548-549 (`DELETE /api/laporan/:id`), ganti:
```ts
    await invalidateLaporanCaches(deps.kv, roleOf(u), u.cabang);
    await bumpMasterRev(deps.kv);
```
menjadi:
```ts
    await invalidateLaporanCaches(deps.kv, roleOf(u), u.cabang);
    await invalidateDashwarn(deps.kv, roleOf(u), u.cabang);
    await bumpMasterRev(deps.kv);
```

- [ ] **Step 6: Call `invalidateDashwarn` di reset-oli**

Edit `src/routes/master.ts` baris 9 — ganti import menjadi:
```ts
import { bumpMasterRev, getMasterRev, invalidateDashwarn, masterCacheKey } from '../logic/master-cache';
```

Baris 184, ganti:
```ts
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Baseline ganti oli diperbarui ke KM ' + km + '.', km }));
```
menjadi:
```ts
    await bumpMasterRev(deps.kv);
    await invalidateDashwarn(deps.kv, u.role, u.cabang);
    return c.json(okPayload({ msg: 'Baseline ganti oli diperbarui ke KM ' + km + '.', km }));
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `npx vitest run tests/routes/laporan.test.ts tests/routes/master.test.ts`
Expected: PASS — 4 test baru hijau, semua test lama tetap hijau.

- [ ] **Step 8: Gate + Commit**

```bash
git add src/logic/master-cache.ts src/routes/laporan.ts src/routes/master.ts tests/routes/laporan.test.ts tests/routes/master.test.ts
npm run typecheck
npx vitest run
git commit -m "feat(warnings): invalidateDashwarn di save/edit/delete laporan & reset-oli"
```

---

### Task 4: Dokumentasi + Gate Akhir

**Files:**
- Modify: `README.md:35` (header status), `README.md:57` (baris `/api/dashboard`), `README.md:59` (baris status M3)
- Modify: `docs/superpowers/specs/2026-09-25-m4-dashboard-warnings-design.md:4` (status → selesai)

**Interfaces:**
- Consumes: seluruh hasil Task 1-3.
- Produces: dokumentasi API & status milestone M4 final.

- [ ] **Step 1: Update README**

Edit `README.md` — baris 35:
```markdown
## API (status M4 — fondasi + master + settings + audit + laporan + warnings)
```

Baris 57, ganti:
```markdown
| GET | `/api/dashboard` | PIC/SUPERADMIN | riwayat transaksi + ringkasan bulanan + warnings OLI/pajak/KIR (cache 300 dtk) |
```

Baris 59, ganti:
```markdown
M3 (laporan/transaksi BBM) dan M4 (dashboard & warnings) **selesai** —
lihat `docs/superpowers/plans/2026-09-21-m3-laporan-transaksi-bbm.md` dan
`docs/superpowers/plans/2026-09-25-m4-dashboard-warnings.md`.
```

- [ ] **Step 2: Update spec status**

Edit `docs/superpowers/specs/2026-09-25-m4-dashboard-warnings-design.md` baris 4:
```markdown
**Status:** Selesai diimplementasikan (M4) — lihat `docs/superpowers/plans/2026-09-25-m4-dashboard-warnings.md`
```

- [ ] **Step 3: Gate akhir + Commit**

```bash
git add README.md docs/superpowers/specs/2026-09-25-m4-dashboard-warnings-design.md
npm run typecheck
npx vitest run
git commit -m "docs(README,spec): status M4 dashboard & warnings"
```

---

## Self-Review

**Coverage spec M4:** engine murni + unit test (Task 1) ✓; aturan OLI (sisa ≤ 50, skip km_terakhir ≤ 0 / tanpa odo, fallback interval motor vs mobil, KRITIS/PERHATIAN) ✓; aturan tanggal (≤ 30 hari, skip kosong/tidak valid, lewat KRITIS, label 3 kategori) ✓; filter status `Aktif` + scope cabang PIC/SUPERADMIN di `computeWarnings` ✓; bentuk `WarningItem` + `nama_cabang` + pesan deterministik `formatIdNumber`/`formatDateId` ✓; sort KRITIS→sisa→kategori→kode_cabang→plat_nomor ✓; dashboard `{ transactions, monthly, warnings }` backward-compatible (Task 2) ✓; cache `dashwarn:<role>:<cabang>` TTL 300 + baca `kv.get(json)` ✓; `invalidateDashwarn` hapus scope user + SUPERADMIN di save/edit/delete/reset-oli (Task 3) ✓; route test PIC scope + SUPERADMIN + non-aktif + cache & invalidasi ✓; README + spec status (Task 4) ✓; tanpa perubahan schema ✓; gate tiap task `typecheck` + `vitest` ✓.

**Placeholder scan:** tidak ada TBD/TODO; semua langkah berisi kode & command eksplisit.

**Type consistency:** `warningsCacheKey` didefinisikan Task 2 dan dipakai Task 3; `invalidateDashwarn` didefinisikan Task 3 baris 5-7 (bukan Task 2); `WarningItem`/`WarningVehicle`/`buildOdoMap`/`computeWarnings` dari Task 1 dipakai Task 2 dengan penamaan identik. `daysUntil` menerima `string | null | undefined` — test null `toBeNull` konsisten. Signature `invalidateDashwarn(kv, role, cabang)` dipakai `roleOf(u)` / `u.role` (keduanya `string`), `u.cabang` (`string`).