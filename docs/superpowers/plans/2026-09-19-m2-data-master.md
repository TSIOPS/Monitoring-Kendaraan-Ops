# M2 — Data Master, Audit Log & Pengaturan Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mem-port blok Data Master GAS (`getMasterData`, CRUD Cabang/Kendaraan/Supir/BBM/Pengguna, `resetOilChange`), Audit Log (tulis di semua aksi + endpoint baca), dan Pengaturan/Logo (`getAppSettings`, `saveAppSettings`, `uploadLogo`) ke Worker — perilaku & payload 1:1 dengan GAS agar frontend M7 bisa disambungkan tanpa mengubah bentuk data.

**Architecture:** Route `GET /api/master` merangkai payload master yang ter-cache di KV (revisi-based, TTL 30 dtk sesuai spec). CRUD master menulis ke Supabase, mencatat audit, lalu membatalkan cache master. Settings disimpan di tabel `pengaturan`; logo diunggah ke Supabase Storage (bucket `settings`, key `logo.<ext>`) dan URL publik ditulis ke `pengaturan.logo_url`.

**Tech Stack:** Hono, @supabase/supabase-js, Cloudflare KV, Web Crypto (crypto.randomUUID), vitest. (Tidak ada library PHP/GAS.)

## Global Constraints

- Payload `GET /api/master` **persis** dengan GAS `getMasterData` (nama field & bentuk tiap item) — lihat `Code.js:200` dan `SpreadsheetOps.js` (`getActiveVehicles:63`, `getActiveDrivers:1429`, `getCabangList:47`, `getActiveBBM:1489`, `getActiveBBMForCabang:1503`, `getAllUsers:1756`, `getFlazzCards:176`).
- Pesan sukses & error **verbatim** dari GAS (mis. `'Cabang Berhasil Ditambahkan'`, `'Kode cabang "X" sudah terpakai.'`).
- Guard akses replika GAS: cabang/BBM/pengguna = SUPERADMIN only; kendaraan/supir = `assertMasterAccess` + `assertOwnWarehouse` untuk PIC; reset-oli = `assertMasterAccess` + `assertOwnWarehouse`. Pesan persis (`assertSuperadminOnly:1363`, `assertOwnWarehouse:1369`).
- Soft-delete (status `Non-Aktif`), bukan hapus fisik — untuk semua master.
- `rol`/`cabang` diambil dari session (server-derived), **tidak pernah** dari body.
- Master cache di KV: key berbasis revision counter (`master-rev`), TTL **30 dtk** (keputusan spec §4; GAS 120 dtk tidak diikuti).
- Setiap respon sukses `{ success: true, ... }`; kegagalan `{ success: false, error, message }` via `HttpError` baru (status sesuai).
- Id baru memakai random-suffix `prefix${Date.now()}-${4-hex}` (GAS `Date.now()` polos berisiko bentrok di Worker konkuren).

---

## File Structure (tambahan/perubahan)

```
D:\Monitoring Kendaraan Ops Cloud\
├── README.md                        # edit: tabel API + M2
├── db/
│   └── schema.sql                    # EDIT: supir + kolom default_vehicle_id
├── src/
│   ├── deps.ts                       # EDIT: AppDeps + master/settings; AuditEntry.ip
│   ├── app.ts                        # EDIT: repos default, onError HttpError, mount router baru
│   ├── db/
│   │   ├── master.ts                 # CREATE: tipe + MasterRepo + supabaseMasterRepo
│   │   ├── settings.ts               # CREATE: SettingsRepo + supabaseSettingsRepo
│   │   └── audit.ts                  # EDIT: ip dari entry
│   ├── logic/
│   │   ├── master.ts                 # CREATE: getMasterPayload/pure (+ defaultOilIntervalKm)
│   │   └── master-cache.ts           # CREATE: getMasterRev/bumpMasterRev/masterCacheKey
│   ├── routes/
│   │   ├── master.ts                 # CREATE: CRUD + getMasterData + reset-oli
│   │   ├── settings.ts               # CREATE: GET/PUT /api/settings, POST /api/settings/logo
│   │   └── audit.ts                  # CREATE: GET /api/audit (SUPERADMIN)
│   └── utils/
│       └── http.ts                   # EDIT: HttpError, reqIp
├── scripts/
│   └── apply-schema.mjs              # (existing, dipakai utk kolom baru)
tests/
    ├── helpers.ts                    # CREATE: memKV/memMaster/memSettings/makeDeps/login helpers
    ├── logic/master-payload.test.ts  # CREATE (Task 1)
    ├── routes/master.test.ts         # CREATE (Task 3)
    ├── routes/master-read.test.ts    # CREATE (Task 4)
    ├── routes/settings.test.ts       # CREATE (Task 5)
    ├── routes/audit.test.ts          # CREATE (Task 6)
    ├── app.test.ts                   # EDIT: pakai helpers
    └── auth-routes.test.ts           # EDIT: pakai helpers
```

Unit interfaces:
- `db/master.ts` — `MasterRepo` (interface) + `supabaseMasterRepo(env)` (implementasi real). Murni dipakai run-time; dites via mem-repo.
- `logic/master.ts` — murni (tidak sentuh env/DB): konversi `MasterAllRaw` → payload GAS, BBM merge, filter role/cabang.
- `logic/master-cache.ts` — murni di atas `KVStore`.
- `routes/*.ts` — `app*(deps)` DI. Bisnis-rule GAS ditulis di sini (validasi, guard, audit, pesan).
- `tests/helpers.ts` — memKV, memMaster, memSettings, `makeDeps`, `login` (isi session KV langsung), `authHeaders`.

---

## Task 1: Payload master (logika murni) + kolom `supir.default_vehicle_id`

**Files:**
- Edit: `db/schema.sql`
- Create: `src/db/master.ts` (**hanya bagian tipe** — `MasterRepo` di Task 2)
- Create: `src/logic/master.ts`
- Create: `tests/logic/master-payload.test.ts`

**Produces:** tipe data master + `getMasterPayload(raw, user, lastKmSumber?)` yang benar 1:1; kolom supir siap dipakai.

- [ ] **Step 1: Tambah kolom `default_vehicle_id` di `db/schema.sql`**

GAS `insertSupir` menulis 5 kolom: `[id, nama, cabang, status, default_vehicle_id]` (SpreadsheetOps:1463) dan `getActiveDrivers` membaca `row[4]`. Schema saat ini belum punya kolom itu.

```diff
 create table if not exists supir (
   supir_id text primary key,
   nama_supir text not null default '',
   kode_cabang text not null default '',
-  status text not null default 'Aktif'
+  status text not null default 'Aktif',
+  default_vehicle_id text not null default ''
 );
```

- [ ] **Step 2: Terapkan ke Supabase + verifikasi**

```powershell
$env:SB_DB_PASSWORD='<DB_PASSWORD>'; npm run apply-schema
$env:SB_DB_PASSWORD='<DB_PASSWORD>'; npm run verify-schema
# lintasan manual (opsional):
$env:SB_DB_PASSWORD='<DB_PASSWORD>'; node -e "const pg=require('pg');const c=new pg.Client({host:'db.jscpogjdquwcbglavurd.supabase.co',port:5432,user:'postgres',database:'postgres',password:process.env.SB_DB_PASSWORD,ssl:{rejectUnauthorized:false}});(async()=>{await c.connect();const r=await c.query(\"select column_name from information_schema.columns where table_name='supir'\").then(x=>x.rows.map(r=>r.column_name));console.log(r);await c.end()})()"
```

- [ ] **Step 3: Tulis tipe data master di `src/db/master.ts`** (bagian 1 dari file; `MasterRepo` ditambahkan di Task 2)

```ts
// Bagian ini ditulis di Task 1; MasterRepo + supabaseMasterRepo menyusul di Task 2.
export interface MasterCabang {
  kode_cabang: string;
  nama_cabang: string;
  lokasi: string;
  status: string;
}
export interface MasterSupir {
  supir_id: string;
  nama_supir: string;
  kode_cabang: string;
  default_vehicle_id: string;
  status: string;
}
export interface MasterBbm {
  bbm_id: string;
  jenis_bbm: string;
  harga_per_liter: number;
  kode_cabang: string;
  status: string;
}
export interface MasterKendaraan {
  vehicle_id: string;
  plat_nomor: string;
  nama_kendaraan: string;
  jenis_kendaraan: string;
  merk: string;
  model: string;
  kapasitas_tangki: number;
  jumlah_bar: number;
  standar_km_l: number;
  kode_cabang: string;
  status: string;
  jenis_indikator: string;
  tanggal_pajak: string;
  tanggal_pajak_5_tahunan: string;
  tanggal_kir: string;
  km_terakhir_ganti_oli: number;
  interval_ganti_oli_km: number;
}
export interface MasterPengguna {
  user_id: string;
  username: string;
  nama: string;
  role: string;
  kode_cabang: string;
  status: string;
}
export interface MasterPenggunaWithPassword extends MasterPengguna {
  password: string;
}
export interface MasterFlazzCard {
  id: string;
  card_number: string;
  card_name: string;
  card_type: string;
  card_role: string;
  branch_id: string;
  driver_id: string;
  default_driver_id: string;
  last_balance: number;
  status: string;
  notes: string;
}
export interface MasterAllRaw {
  cabang: MasterCabang[];
  supir: MasterSupir[];
  bbm: MasterBbm[];
  kendaraan: MasterKendaraan[];
  pengguna: MasterPengguna[];
  flazzCard: MasterFlazzCard[];
}
```

- [ ] **Step 4: Tulis `src/logic/master.ts`**

```ts
import type { MasterAllRaw } from '../db/master';

export interface MasterUserCtx {
  role: string;
  cabang: string;
}

export class MasterPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MasterPayloadError';
  }
}

// WarningsCore.js:61 — Motor lebih sering ganti oli daripada mobil.
export function defaultOilIntervalKm(jenis: string | undefined | null): number {
  return String(jenis || '').toLowerCase().indexOf('motor') !== -1 ? 3000 : 5000;
}

export interface MasterPayload {
  vehicles: Array<Record<string, unknown>>;
  drivers: Array<Record<string, unknown>>;
  cabangList: Array<Record<string, unknown>>;
  bbmList: Array<Record<string, unknown>>;
  flazzCards: Array<Record<string, unknown>>;
  penggunaList: Array<Record<string, unknown>>;
}

// Replika getMasterData (Code.js:200). TIDAK membaca DB — murni transformasi.
export function getMasterPayload(
  raw: MasterAllRaw,
  user: MasterUserCtx,
  lastKmSumber?: Record<string, string>,
): MasterPayload {
  const isSuper = user.role === 'SUPERADMIN';
  const lastSumber = lastKmSumber || {};

  const cabangList = isSuper
    ? raw.cabang
        .filter((c) => c.status === 'Aktif')
        .map((c) => ({ kode: c.kode_cabang, nama: c.nama_cabang }))
    : (() => {
        const mine = String(user.cabang || '');
        const own = raw.cabang.find((c) => String(c.kode_cabang) === mine && c.status === 'Aktif');
        return own ? [{ kode: own.kode_cabang, nama: own.nama_cabang }] : [{ kode: mine, nama: mine }];
      })();

  const vehicles = raw.kendaraan
    .filter((v) => v.status === 'Aktif')
    .filter((v) => isSuper || v.kode_cabang === user.cabang)
    .map((v) => {
      const jenis = v.jenis_kendaraan || 'Mobil';
      const indikator = v.jenis_indikator || 'DIGITAL_BAR';
      return {
        vehicle_id: v.vehicle_id,
        plat_nomor: v.plat_nomor,
        nama: v.nama_kendaraan,
        jenis,
        merk: v.merk,
        model: v.model,
        kapasitas_tangki: v.kapasitas_tangki,
        jumlah_bar: v.jumlah_bar,
        standar_km_l: v.standar_km_l,
        cabang: v.kode_cabang,
        jenis_indikator: indikator,
        tanggal_pajak: v.tanggal_pajak,
        tanggal_pajak_5_tahunan: v.tanggal_pajak_5_tahunan,
        tanggal_kir: v.tanggal_kir,
        km_terakhir_ganti_oli: v.km_terakhir_ganti_oli,
        interval_ganti_oli_km:
          v.interval_ganti_oli_km > 0 ? v.interval_ganti_oli_km : defaultOilIntervalKm(jenis),
        odo_estimasi_terakhir: indikator === 'ANALOG_JARUM' && lastSumber[String(v.vehicle_id)] === 'ESTIMASI',
      };
    });

  const drivers = raw.supir
    .filter((s) => s.status === 'Aktif')
    .filter((s) => isSuper || s.kode_cabang === user.cabang)
    .map((s) => ({ id: s.supir_id, nama: s.nama_supir, cabang: s.kode_cabang, default_vehicle_id: s.default_vehicle_id || '' }));

  const bbmList = isSuper
    ? raw.bbm
        .filter((b) => b.status === 'Aktif')
        .map((b) => ({ id: b.bbm_id, jenis: b.jenis_bbm, harga: b.harga_per_liter }))
    : (() => {
        const globals: Record<string, Record<string, unknown>> = {};
        const overrides: Record<string, Record<string, unknown>> = {};
        for (const b of raw.bbm) {
          if (String(b.status || '') !== 'Aktif') continue;
          const item = { bbm_id: b.bbm_id, jenis_bbm: b.jenis_bbm, harga_per_liter: b.harga_per_liter, kode_cabang: b.kode_cabang || '' };
          const key = String(b.bbm_id);
          if (b.kode_cabang) {
            if (String(b.kode_cabang) === String(user.cabang)) overrides[key] = item;
          } else {
            globals[key] = item;
          }
        }
        const merged: Record<string, Record<string, unknown>> = {};
        Object.keys(globals).forEach((k) => {
          const v = globals[k];
          if (v) merged[k] = v;
        });
        Object.keys(overrides).forEach((k) => {
          const v = overrides[k];
          if (v) merged[k] = v;
        });
        return Object.keys(merged).map((k) => merged[k]!);
      })();

  const flazzCards = (() => {
    const hasCabang = Boolean(user.cabang);
    const list = isSuper || hasCabang ? raw.flazzCard : [];
    return list
      .filter((card) => isSuper || String(card.branch_id) === String(user.cabang))
      .map((c) => ({ ...c }));
  })();

  const penggunaList = isSuper
    ? raw.pengguna.map((u) => ({
        user_id: u.user_id,
        username: u.username,
        nama: u.nama,
        role: u.role,
        cabang: u.kode_cabang,
        status: u.status,
      }))
    : [];

  return { vehicles, drivers, cabangList, bbmList, flazzCards, penggunaList };
}
```

- [ ] **Step 5: Tulis `tests/logic/master-payload.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import type { MasterAllRaw } from '../../src/db/master';
import { getMasterPayload } from '../../src/logic/master';

function sampleRaw(): MasterAllRaw {
  return {
    cabang: [
      { kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: 'Jkt', status: 'Aktif' },
      { kode_cabang: 'CBG-B', nama_cabang: 'Cabang B', lokasi: 'Sby', status: 'Aktif' },
      { kode_cabang: 'CBG-MATI', nama_cabang: 'Mati', lokasi: '', status: 'Non-Aktif' },
    ],
    supir: [
      { supir_id: 'DRV-1', nama_supir: 'Ali', kode_cabang: 'CBG-A', default_vehicle_id: 'V-1', status: 'Aktif' },
      { supir_id: 'DRV-2', nama_supir: 'Budi', kode_cabang: 'CBG-B', default_vehicle_id: '', status: 'Aktif' },
      { supir_id: 'DRV-3', nama_supir: 'Caca', kode_cabang: 'CBG-A', default_vehicle_id: '', status: 'Non-Aktif' },
    ],
    bbm: [
      { bbm_id: 'BBM-P', jenis_bbm: 'Pertalite', harga_per_liter: 10000, kode_cabang: '', status: 'Aktif' },
      { bbm_id: 'BBM-PX', jenis_bbm: 'Pertalite A', harga_per_liter: 10200, kode_cabang: 'CBG-A', status: 'Aktif' },
      { bbm_id: 'BBM-S', jenis_bbm: 'Solar', harga_per_liter: 12000, kode_cabang: '', status: 'Aktif' },
      { bbm_id: 'BBM-X', jenis_bbm: 'Mati', harga_per_liter: 1, kode_cabang: '', status: 'Non-Aktif' },
    ],
    kendaraan: [
      {
        vehicle_id: 'V-1', plat_nomor: 'B 1 A', nama_kendaraan: 'Corolla', jenis_kendaraan: 'Mobil',
        merk: 'Toyota', model: 'Altis', kapasitas_tangki: 50, jumlah_bar: 8, standar_km_l: 12,
        kode_cabang: 'CBG-A', status: 'Aktif', jenis_indikator: 'DIGITAL_BAR',
        tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '',
        km_terakhir_ganti_oli: 10000, interval_ganti_oli_km: 0,
      },
      {
        vehicle_id: 'V-2', plat_nomor: 'L 2 B', nama_kendaraan: 'Vario', jenis_kendaraan: 'Motor',
        merk: 'Honda', model: 'Vario', kapasitas_tangki: 5, jumlah_bar: 4, standar_km_l: 40,
        kode_cabang: 'CBG-B', status: 'Aktif', jenis_indikator: 'ANALOG_JARUM',
        tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '',
        km_terakhir_ganti_oli: 2000, interval_ganti_oli_km: 0,
      },
      {
        vehicle_id: 'V-3', plat_nomor: 'B 3 C', nama_kendaraan: 'Innova', jenis_kendaraan: 'Mobil',
        merk: 'Toyota', model: 'Innova', kapasitas_tangki: 55, jumlah_bar: 8, standar_km_l: 11,
        kode_cabang: 'CBG-A', status: 'Non-Aktif', jenis_indikator: 'DIGITAL_BAR',
        tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '',
        km_terakhir_ganti_oli: 0, interval_ganti_oli_km: 0,
      },
    ],
    pengguna: [
      { user_id: 'U-1', username: 'super', nama: 'Super', role: 'SUPERADMIN', kode_cabang: '', status: 'Aktif' },
      { user_id: 'U-2', username: 'pic', nama: 'Pic A', role: 'PIC CABANG', kode_cabang: 'CBG-A', status: 'Aktif' },
    ],
    flazzCard: [
      { id: 'FC-1', card_number: '111', card_name: 'Bca', card_type: 'BCA_FLAZZ', card_role: 'UTAMA', branch_id: 'CBG-A', driver_id: 'DRV-1', default_driver_id: '', last_balance: 0, status: '', notes: '' },
      { id: 'FC-2', card_number: '222', card_name: 'Bca2', card_type: 'BCA_FLAZZ', card_role: 'CADANGAN', branch_id: 'CBG-B', driver_id: 'DRV-2', default_driver_id: '', last_balance: 0, status: '', notes: '' },
    ],
  };
}

describe('getMasterPayload', () => {
  it('SUPERADMIN menerima semua master (Aktif saja) + bentuk GAS super', () => {
    const p = getMasterPayload(sampleRaw(), { role: 'SUPERADMIN', cabang: '' }, {});
    expect(p.cabangList).toEqual([
      { kode: 'CBG-A', nama: 'Cabang A' },
      { kode: 'CBG-B', nama: 'Cabang B' },
    ]);
    expect(p.vehicles.map((v: any) => v.vehicle_id)).toEqual(['V-1', 'V-2']);
    expect(p.vehicles[0]).toMatchObject({ plat_nomor: 'B 1 A', nama: 'Corolla', jenis: 'Mobil', cabang: 'CBG-A' });
    expect(p.drivers.map((d: any) => d.id)).toEqual(['DRV-1', 'DRV-2']);
    expect(p.bbmList).toEqual([
      { id: 'BBM-P', jenis: 'Pertalite', harga: 10000 },
      { id: 'BBM-PX', jenis: 'Pertalite A', harga: 10200 },
      { id: 'BBM-S', jenis: 'Solar', harga: 12000 },
    ]);
    expect(p.penggunaList.map((u: any) => u.username)).toEqual(['super', 'pic']);
    expect(p.penggunaList[0]).toHaveProperty('cabang');
    expect(p.flazzCards.map((f: any) => f.id)).toEqual(['FC-1', 'FC-2']);
  });

  it('PIC CABANG dibatasi warehouse sendiri; BBM override menang atas global', () => {
    const p = getMasterPayload(sampleRaw(), { role: 'PIC CABANG', cabang: 'CBG-A' }, {});
    expect(p.cabangList).toEqual([{ kode: 'CBG-A', nama: 'Cabang A' }]);
    expect(p.vehicles.map((v: any) => v.vehicle_id)).toEqual(['V-1']);
    expect(p.drivers.map((d: any) => d.id)).toEqual(['DRV-1']);
    // Urutan = GAS getActiveBBMForCabang: global dulu (urutan sheet), lalu override.
    expect(p.bbmList).toEqual([
      { bbm_id: 'BBM-P', jenis_bbm: 'Pertalite', harga_per_liter: 10000, kode_cabang: '' },
      { bbm_id: 'BBM-S', jenis_bbm: 'Solar', harga_per_liter: 12000, kode_cabang: '' },
      { bbm_id: 'BBM-PX', jenis_bbm: 'Pertalite A', harga_per_liter: 10200, kode_cabang: 'CBG-A' },
    ]);
    expect(p.penggunaList).toEqual([]);
    expect(p.flazzCards.map((f: any) => f.id)).toEqual(['FC-1']);
  });

  it('PIC cabang tidak dikenal: cabangList fallback ke kode', () => {
    const p = getMasterPayload(sampleRaw(), { role: 'PIC CABANG', cabang: 'CBG-Z' }, {});
    expect(p.cabangList).toEqual([{ kode: 'CBG-Z', nama: 'CBG-Z' }]);
    expect(p.vehicles).toEqual([]);
    expect(p.flazzCards).toEqual([]);
  });

  it('interval ganti oli fallback defaultOilIntervalKm; motor 3000 mobil 5000', () => {
    const p = getMasterPayload(sampleRaw(), { role: 'SUPERADMIN', cabang: '' }, {});
    expect(p.vehicles.find((v: any) => v.vehicle_id === 'V-1')?.interval_ganti_oli_km).toBe(5000);
    expect(p.vehicles.find((v: any) => v.vehicle_id === 'V-2')?.interval_ganti_oli_km).toBe(3000);
  });

  it('odo_estimasi_terakhir true hanya utk ANALOG_JARUM dgn sumber ESTIMASI', () => {
    const raw = sampleRaw();
    const v2 = raw.kendaraan.find((v) => v.vehicle_id === 'V-2')!;
    v2.jenis_indikator = 'ANALOG_JARUM';
    const p = getMasterPayload(raw, { role: 'SUPERADMIN', cabang: '' }, { 'V-2': 'ESTIMASI' });
    expect(p.vehicles.find((v: any) => v.vehicle_id === 'V-2')?.odo_estimasi_terakhir).toBe(true);
    const p2 = getMasterPayload(raw, { role: 'SUPERADMIN', cabang: '' }, { 'V-2': 'AKTUAL' });
    expect(p2.vehicles.find((v: any) => v.vehicle_id === 'V-2')?.odo_estimasi_terakhir).toBe(false);
  });
});
```

- [ ] **Step 6: Jalankan test + typecheck**

```powershell
npx vitest run tests/logic/master-payload.test.ts
npm run typecheck
# suite penuh tetap hijau:
npx vitest run
```

- [ ] **Step 7: Commit**

```powershell
git add db/schema.sql src/db/master.ts src/logic/master.ts tests/logic/master-payload.test.ts
git commit -m "feat(master): payload 1:1 GAS (getMasterPayload) + kolom supir.default_vehicle_id"
```

---

## Task 2: `MasterRepo` & `SettingsRepo` (Supabase + memory) + wiring deps + helpers

**Files:**
- Edit: `src/deps.ts`
- Edit: `src/db/master.ts` (tambah `MasterRepo` + `supabaseMasterRepo`)
- Create: `src/db/settings.ts`
- Create: `tests/helpers.ts`
- Edit: `src/app.ts` (repo default dari env)
- Edit: `tests/app.test.ts`, `tests/auth-routes.test.ts` (pakai helpers)

**Produces:** repos real (Supabase) + in-memory untuk test; `AppDeps` kebawa `master` & `settings`; test lama refactor tanpa ubah behavior.

- [ ] **Step 1: Perluas `src/deps.ts`**

```diff
 export interface AuditEntry {
   user_id: string;
   username: string;
   action: string;
   modul: string;
   keterangan: string;
   data_sebelum?: string;
   data_sesudah?: string;
+  ip?: string;
 }

+import type { MasterRepo } from './db/master';
+import type { SettingsRepo } from './db/settings';
+
 export interface AppDeps {
   kv: KVStore;
   findByUsername: (username: string) => Promise<UserRecord | null>;
   recordAudit: (entry: AuditEntry) => Promise<void>;
   now: () => number;
+  master: MasterRepo;
+  settings: SettingsRepo;
 }
```
(Catat: impor di atas diletakkan di baris teratas file, sebelum `export interface KVStore`.)

- [ ] **Step 2: Tambah `MasterRepo` + `supabaseMasterRepo` di `src/db/master.ts`**

```ts
import type { Env } from '../env';
import { getSupabase } from './client';

export interface MasterRepo {
  listAll(): Promise<MasterAllRaw>;
  findCabangByKode(kode: string): Promise<MasterCabang | null>;
  insertCabang(data: { kode_cabang: string; nama_cabang: string; lokasi: string }): Promise<void>;
  updateCabang(kode_cabang: string, data: { nama_cabang: string; lokasi: string }): Promise<void>;
  setCabangStatus(kode_cabang: string, status: string): Promise<void>;
  listCabangRefs(kode: string): Promise<string[]>;
  findKendaraanById(vehicle_id: string): Promise<MasterKendaraan | null>;
  insertKendaraan(v: MasterKendaraan): Promise<void>;
  updateKendaraan(v: MasterKendaraan): Promise<void>;
  setKendaraanStatus(vehicle_id: string, status: string): Promise<void>;
  findSupirById(supir_id: string): Promise<MasterSupir | null>;
  insertSupir(s: MasterSupir): Promise<void>;
  updateSupir(s: MasterSupir): Promise<void>;
  setSupirStatus(supir_id: string, status: string): Promise<void>;
  findBbmById(bbm_id: string): Promise<MasterBbm | null>;
  insertBbm(b: MasterBbm): Promise<void>;
  updateBbm(b: MasterBbm): Promise<void>;
  setBbmStatus(bbm_id: string, status: string): Promise<void>;
  findPenggunaByUsername(username: string): Promise<MasterPenggunaWithPassword | null>;
  findPenggunaById(user_id: string): Promise<MasterPenggunaWithPassword | null>;
  countActiveSuperadmin(): Promise<number>;
  insertPengguna(u: MasterPenggunaWithPassword): Promise<void>;
  updatePengguna(u: MasterPenggunaWithPassword): Promise<void>;
  setPenggunaStatus(user_id: string, status: string): Promise<void>;
  currentOdoPerVehicle(): Promise<Record<string, number>>;
}

const CABANG_REF_TABLES: Array<{ table: string; column: string; label: string }> = [
  { table: 'kendaraan', column: 'kode_cabang', label: 'Kendaraan' },
  { table: 'supir', column: 'kode_cabang', label: 'Supir' },
  { table: 'bbm', column: 'kode_cabang', label: 'BBM' },
  { table: 'pengguna', column: 'kode_cabang', label: 'Pengguna' },
  { table: 'penggunaan_bbm', column: 'kode_cabang', label: 'Penggunaan_BBM' },
  { table: 'jalur_pengiriman', column: 'kode_cabang', label: 'Jalur_Pengiriman' },
  { table: 'flazz_card', column: 'branch_id', label: 'Flazz_Card' },
];

export function supabaseMasterRepo(env: Env): MasterRepo {
  const sb = () => getSupabase(env);
  const fail = (kind: string) => (err: unknown): never => {
    throw new Error(`DB ${kind}: ${(err as Error)?.message ?? String(err)}`);
  };

  return {
    async listAll() {
      const [cabang, supir, bbm, kendaraan, pengguna, flazzCard] = await Promise.all([
        sb().from('cabang').select('*').then(r => { if (r.error) throw r.error; return r.data as unknown as MasterCabang[]; }),
        sb().from('supir').select('*').then(r => { if (r.error) throw r.error; return r.data as unknown as MasterSupir[]; }),
        sb().from('bbm').select('*').then(r => { if (r.error) throw r.error; return r.data as unknown as MasterBbm[]; }),
        sb().from('kendaraan').select('*').then(r => { if (r.error) throw r.error; return r.data as unknown as MasterKendaraan[]; }),
        sb().from('pengguna')
          .select('user_id, username, nama, role, kode_cabang, status')
          .then(r => { if (r.error) throw r.error; return r.data as unknown as MasterPengguna[]; }),
        sb().from('flazz_card').select('*').then(r => { if (r.error) throw r.error; return r.data as unknown as MasterFlazzCard[]; }),
      ]);
      return { cabang, supir, bbm, kendaraan, pengguna, flazzCard };
    },

    async findCabangByKode(kode) {
      const { data, error } = await sb().from('cabang').select('*').eq('kode_cabang', kode).maybeSingle();
      if (error) throw fail('findCabangByKode')(error);
      return (data as MasterCabang | null) ?? null;
    },

    async insertCabang(data) {
      const { error } = await sb().from('cabang').insert(data);
      if (error) throw fail('insertCabang')(error);
    },

    async updateCabang(kode_cabang, data) {
      const { error } = await sb().from('cabang').update(data).eq('kode_cabang', kode_cabang);
      if (error) throw fail('updateCabang')(error);
    },

    async setCabangStatus(kode_cabang, status) {
      const { error } = await sb().from('cabang').update({ status }).eq('kode_cabang', kode_cabang);
      if (error) throw fail('setCabangStatus')(error);
    },

    async listCabangRefs(kode) {
      const found: string[] = [];
      for (const ref of CABANG_REF_TABLES) {
        const { count, error } = await sb().from(ref.table).select('*', { count: 'exact', head: true }).eq(ref.column, kode);
        if (error) continue;
        if ((count ?? 0) > 0) found.push(ref.label);
      }
      return found;
    },

    async findKendaraanById(vehicle_id) {
      const { data, error } = await sb().from('kendaraan').select('*').eq('vehicle_id', vehicle_id).maybeSingle();
      if (error) throw fail('findKendaraanById')(error);
      return (data as MasterKendaraan | null) ?? null;
    },

    async insertKendaraan(v) {
      const { error } = await sb().from('kendaraan').insert(v);
      if (error) throw fail('insertKendaraan')(error);
    },

    async updateKendaraan(v) {
      const { vehicle_id, ...rest } = v;
      const { error } = await sb().from('kendaraan').update(rest).eq('vehicle_id', vehicle_id);
      if (error) throw fail('updateKendaraan')(error);
    },

    async setKendaraanStatus(vehicle_id, status) {
      const { error } = await sb().from('kendaraan').update({ status }).eq('vehicle_id', vehicle_id);
      if (error) throw fail('setKendaraanStatus')(error);
    },

    async findSupirById(supir_id) {
      const { data, error } = await sb().from('supir').select('*').eq('supir_id', supir_id).maybeSingle();
      if (error) throw fail('findSupirById')(error);
      return (data as MasterSupir | null) ?? null;
    },

    async insertSupir(s) {
      const { error } = await sb().from('supir').insert(s);
      if (error) throw fail('insertSupir')(error);
    },

    async updateSupir(s) {
      const { supir_id, ...rest } = s;
      const { error } = await sb().from('supir').update(rest).eq('supir_id', supir_id);
      if (error) throw fail('updateSupir')(error);
    },

    async setSupirStatus(supir_id, status) {
      const { error } = await sb().from('supir').update({ status }).eq('supir_id', supir_id);
      if (error) throw fail('setSupirStatus')(error);
    },

    async findBbmById(bbm_id) {
      const { data, error } = await sb().from('bbm').select('*').eq('bbm_id', bbm_id).maybeSingle();
      if (error) throw fail('findBbmById')(error);
      return (data as MasterBbm | null) ?? null;
    },

    async insertBbm(b) {
      const { error } = await sb().from('bbm').insert(b);
      if (error) throw fail('insertBbm')(error);
    },

    async updateBbm(b) {
      const { bbm_id, ...rest } = b;
      const { error } = await sb().from('bbm').update(rest).eq('bbm_id', bbm_id);
      if (error) throw fail('updateBbm')(error);
    },

    async setBbmStatus(bbm_id, status) {
      const { error } = await sb().from('bbm').update({ status }).eq('bbm_id', bbm_id);
      if (error) throw fail('setBbmStatus')(error);
    },

    async findPenggunaByUsername(username) {
      const { data, error } = await sb().from('pengguna')
        .select('user_id, username, password, nama, role, kode_cabang, status')
        .ilike('username', username).limit(1).maybeSingle();
      if (error) throw fail('findPenggunaByUsername')(error);
      return (data as MasterPenggunaWithPassword | null) ?? null;
    },

    async findPenggunaById(user_id) {
      const { data, error } = await sb().from('pengguna')
        .select('user_id, username, password, nama, role, kode_cabang, status')
        .eq('user_id', user_id).maybeSingle();
      if (error) throw fail('findPenggunaById')(error);
      return (data as MasterPenggunaWithPassword | null) ?? null;
    },

    async countActiveSuperadmin() {
      const { count, error } = await sb().from('pengguna')
        .select('*', { count: 'exact', head: true })
        .eq('role', 'SUPERADMIN').eq('status', 'Aktif');
      if (error) throw fail('countActiveSuperadmin')(error);
      return count ?? 0;
    },

    async insertPengguna(u) {
      const { error } = await sb().from('pengguna').insert(u);
      if (error) throw fail('insertPengguna')(error);
    },

    async updatePengguna(u) {
      const { user_id, ...rest } = u;
      const { error } = await sb().from('pengguna').update(rest).eq('user_id', user_id);
      if (error) throw fail('updatePengguna')(error);
    },

    async setPenggunaStatus(user_id, status) {
      const { error } = await sb().from('pengguna').update({ status }).eq('user_id', user_id);
      if (error) throw fail('setPenggunaStatus')(error);
    },

    async currentOdoPerVehicle() {
      // Replika GAS: baris terakhir per kendaraan menang atas baris sebelumnya.
      const { data, error } = await sb().from('penggunaan_bbm')
        .select('vehicle_id, km_akhir_confirmed')
        .order('timestamp', { ascending: true });
      if (error) throw fail('currentOdoPerVehicle')(error);
      const out: Record<string, number> = {};
      for (const r of data ?? []) {
        const km = Number(r.km_akhir_confirmed);
        if (r.vehicle_id && !isNaN(km)) out[String(r.vehicle_id)] = km;
      }
      return out;
    },
  };
}
```

- [ ] **Step 3: Tulis `src/db/settings.ts`**

```ts
import type { Env } from '../env';
import { getSupabase } from './client';

export const SETTINGS_DEFAULTS: Record<string, string> = {
  logo_url: '',
  app_name: 'Monitoring Kendaraan Operasional',
  company_name: 'PT Tridaya Sinergi Indonesia',
  footer_text: '© 2026 Tridaya Sinergi Indonesia',
};

export interface SettingsRepo {
  getAll(): Promise<Record<string, string>>;
  setMany(updates: Record<string, string>): Promise<void>;
}

export function supabaseSettingsRepo(env: Env): SettingsRepo {
  const sb = () => getSupabase(env);
  return {
    async getAll() {
      const { data, error } = await sb().from('pengaturan').select('key, value');
      if (error) throw new Error(`DB settings.getAll: ${error.message}`);
      const out: Record<string, string> = { ...SETTINGS_DEFAULTS };
      for (const r of data ?? []) out[String(r.key)] = String(r.value ?? '');
      return out;
    },
    async setMany(updates) {
      const rows = Object.entries(updates).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
      const { error } = await sb().from('pengaturan').upsert(rows, { onConflict: 'key' });
      if (error) throw new Error(`DB settings.setMany: ${error.message}`);
    },
  };
}
```

- [ ] **Step 4: Update `src/app.ts` — repo default dari env**

```diff
 import { findByUsernameDb } from './db/users';
 import { recordAuditDb } from './db/audit';
+import { supabaseMasterRepo } from './db/master';
+import { supabaseSettingsRepo } from './db/settings';

   const deps: AppDeps = {
     kv: env.SESSION_KV,
     findByUsername: findByUsernameDb(env),
     recordAudit: recordAuditDb(env),
     now: () => Date.now(),
+    master: supabaseMasterRepo(env),
+    settings: supabaseSettingsRepo(env),
     ...overrides,
   };
```

- [ ] **Step 5: Tulis `tests/helpers.ts`**

```ts
import type { AppDeps, KVStore, SessionUser } from '../src/deps';
import type {
  MasterBbm,
  MasterCabang,
  MasterFlazzCard,
  MasterKendaraan,
  MasterPenggunaWithPassword,
  MasterRepo,
  MasterSupir,
} from '../src/db/master';
import type { SettingsRepo } from '../src/db/settings';

export function memKV(): KVStore {
  const map = new Map<string, string>();
  return {
    get: async (k, type) => {
      const v = map.get(k);
      if (v == null) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    put: async (k, v) => {
      map.set(k, v);
    },
    delete: async (k) => {
      map.delete(k);
    },
  };
}

export interface MemMasterState {
  cabang: MasterCabang[];
  supir: MasterSupir[];
  bbm: MasterBbm[];
  kendaraan: MasterKendaraan[];
  pengguna: MasterPenggunaWithPassword[];
  flazzCard: MasterFlazzCard[];
  penggunaan: Array<{ vehicle_id: string; km_akhir_confirmed: string; timestamp: string }>;
}

function clone<T>(t: T): T {
  return JSON.parse(JSON.stringify(t)) as T;
}

export function memMaster(initial?: Partial<MemMasterState>) {
  const state: MemMasterState = {
    cabang: clone(initial?.cabang ?? []),
    supir: clone(initial?.supir ?? []),
    bbm: clone(initial?.bbm ?? []),
    kendaraan: clone(initial?.kendaraan ?? []),
    pengguna: clone(initial?.pengguna ?? []),
    flazzCard: clone(initial?.flazzCard ?? []),
    penggunaan: clone(initial?.penggunaan ?? []),
  };
  const repo: MasterRepo = {
    async listAll() {
      return {
        cabang: clone(state.cabang),
        supir: clone(state.supir),
        bbm: clone(state.bbm),
        kendaraan: clone(state.kendaraan),
        pengguna: clone(state.pengguna).map(({ password: _p, ...u }) => u),
        flazzCard: clone(state.flazzCard),
      };
    },
    async findCabangByKode(kode) {
      return state.cabang.find((c) => c.kode_cabang === kode) ?? null;
    },
    async insertCabang(data) {
      state.cabang.push({ ...data, status: 'Aktif' });
    },
    async updateCabang(kode_cabang, data) {
      const c = state.cabang.find((x) => x.kode_cabang === kode_cabang);
      if (c) Object.assign(c, data);
    },
    async setCabangStatus(kode_cabang, status) {
      const c = state.cabang.find((x) => x.kode_cabang === kode_cabang);
      if (c) c.status = status;
    },
    async listCabangRefs(kode) {
      const found: string[] = [];
      if (state.kendaraan.some((x) => x.kode_cabang === kode)) found.push('Kendaraan');
      if (state.supir.some((x) => x.kode_cabang === kode)) found.push('Supir');
      if (state.bbm.some((x) => x.kode_cabang === kode)) found.push('BBM');
      if (state.pengguna.some((x) => x.kode_cabang === kode)) found.push('Pengguna');
      if (state.penggunaan.some((x) => x.vehicle_id === kode)) found.push('Penggunaan_BBM');
      if (state.flazzCard.some((x) => x.branch_id === kode)) found.push('Flazz_Card');
      return found;
    },
    async findKendaraanById(vehicle_id) {
      return state.kendaraan.find((v) => v.vehicle_id === vehicle_id) ?? null;
    },
    async insertKendaraan(v) {
      state.kendaraan.push(clone(v));
    },
    async updateKendaraan(v) {
      const i = state.kendaraan.findIndex((x) => x.vehicle_id === v.vehicle_id);
      if (i > -1) state.kendaraan[i] = clone(v);
    },
    async setKendaraanStatus(vehicle_id, status) {
      const v = state.kendaraan.find((x) => x.vehicle_id === vehicle_id);
      if (v) v.status = status;
    },
    async findSupirById(supir_id) {
      return state.supir.find((s) => s.supir_id === supir_id) ?? null;
    },
    async insertSupir(s) {
      state.supir.push(clone(s));
    },
    async updateSupir(s) {
      const i = state.supir.findIndex((x) => x.supir_id === s.supir_id);
      if (i > -1) state.supir[i] = clone(s);
    },
    async setSupirStatus(supir_id, status) {
      const s = state.supir.find((x) => x.supir_id === supir_id);
      if (s) s.status = status;
    },
    async findBbmById(bbm_id) {
      return state.bbm.find((b) => b.bbm_id === bbm_id) ?? null;
    },
    async insertBbm(b) {
      state.bbm.push(clone(b));
    },
    async updateBbm(b) {
      const i = state.bbm.findIndex((x) => x.bbm_id === b.bbm_id);
      if (i > -1) state.bbm[i] = clone(b);
    },
    async setBbmStatus(bbm_id, status) {
      const b = state.bbm.find((x) => x.bbm_id === bbm_id);
      if (b) b.status = status;
    },
    async findPenggunaByUsername(username) {
      return state.pengguna.find((u) => String(u.username).toLowerCase() === String(username).toLowerCase()) ?? null;
    },
    async findPenggunaById(user_id) {
      return state.pengguna.find((u) => u.user_id === user_id) ?? null;
    },
    async countActiveSuperadmin() {
      return state.pengguna.filter((u) => u.role === 'SUPERADMIN' && u.status === 'Aktif').length;
    },
    async insertPengguna(u) {
      state.pengguna.push(clone(u));
    },
    async updatePengguna(u) {
      const i = state.pengguna.findIndex((x) => x.user_id === u.user_id);
      if (i > -1) state.pengguna[i] = clone(u);
    },
    async setPenggunaStatus(user_id, status) {
      const u = state.pengguna.find((x) => x.user_id === user_id);
      if (u) u.status = status;
    },
    async currentOdoPerVehicle() {
      const out: Record<string, number> = {};
      for (const r of state.penggunaan) {
        const km = Number(r.km_akhir_confirmed);
        if (r.vehicle_id && !isNaN(km)) out[r.vehicle_id] = km;
      }
      return out;
    },
  };
  return { state, repo };
}

export function memSettings(initial?: Record<string, string>) {
  const values: Record<string, string> = { ...(initial ?? {}) };
  const repo: SettingsRepo = {
    async getAll() {
      return { ...values };
    },
    async setMany(updates) {
      Object.assign(values, updates);
    },
  };
  return { values, repo };
}

export function fakeEnv() {
  return {
    ASSETS: { fetch: async () => new Response('static:not-found', { status: 404 }) },
    SESSION_KV: {},
    SUPABASE_URL: 'http://localhost',
    SUPABASE_SERVICE_ROLE_KEY: 'test',
  } as any;
}

export function makeDeps(over: Partial<AppDeps> = {}) {
  const kv = memKV();
  const audits: Array<Record<string, unknown>> = [];
  const { state: masterState, repo: master } = memMaster();
  const { values: settingsValues, repo: settings } = memSettings();
  const deps: AppDeps = {
    kv,
    findByUsername: async () => null,
    recordAudit: async (e) => {
      audits.push({ ...e });
    },
    now: () => 1_000_000,
    master,
    settings,
    ...over,
  };
  return { kv, audits, deps, masterState, settingsValues };
}

export async function loginAs(kv: KVStore, user: SessionUser): Promise<string> {
  const token = 'tok-' + crypto.randomUUID().replace(/-/g, '').slice(0, 32);
  await kv.put('session:' + token, JSON.stringify({ ...user, exp: 1e15 }));
  return token;
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}
```

- [ ] **Step 6: Refactor `tests/app.test.ts` & `tests/auth-routes.test.ts` ke helpers**

`tests/app.test.ts`: ganti `fakeEnv()` lokal & `defaultDeps` dengan import helper.

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { fakeEnv, makeDeps } from './helpers';

describe('buildApp', () => {
  it('GET /api/health => success ok', async () => {
    const app = buildApp(fakeEnv() as any, makeDeps().deps);
    const res = await app.request('/api/health', { method: 'GET' }, fakeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: 'ok' });
  });
  // ... sisa test tetap sama, tapi pakai makeDeps().deps
});
```

`tests/auth-routes.test.ts`: hapus `memKV`/`makeDeps` lokal, ganti ke `makeDeps` dari helper (`{ kv, audits, deps }`), dan `login` helper tetap sama.

- [ ] **Step 7: Jalankan seluruh suite + typecheck**

```powershell
npx vitest run
npm run typecheck
```

- [ ] **Step 8: Commit**

```powershell
git add src/deps.ts src/db/master.ts src/db/settings.ts src/app.ts tests/helpers.ts tests/app.test.ts tests/auth-routes.test.ts
git commit -m "feat(db): MasterRepo & SettingsRepo (Supabase + in-memory), wiring deps + test helpers"
```

---

## Task 3: Master CRUD routes (+ reset-oli) — pesan & audit 1:1 GAS

**Files:**
- Edit: `src/utils/http.ts` (tambah `HttpError`, `reqIp`)
- Edit: `src/app.ts` (onError menangani `HttpError`; `recordAuditDb` pakai entry.ip)
- Edit: `src/db/audit.ts` (tulis `ip`)
- Edit: `src/routes/auth.ts` (audit login/logout sertakan ip — perbaikan kecil)
- Create: `src/logic/master-cache.ts` (getMasterRev/bumpMasterRev/masterCacheKey)
- Create: `src/routes/master.ts`
- Create: `tests/routes/master.test.ts`

**Produces:** `POST/PUT/DELETE /api/master/cabang`, `.../kendaraan`, `.../kendaraan/:id/reset-oli`, `.../supir`, `.../bbm`, `.../pengguna`, `.../pengguna/:id/activate` dengan guard, validasi, audit, dan pesan GAS.

- [ ] **Step 1: Tambah `HttpError` & `reqIp` di `src/utils/http.ts`**

```ts
export class HttpError extends Error {
  status: number;
  error: string;
  constructor(status: number, message: string, error = 'ERROR') {
    super(message);
    this.status = status;
    this.error = error;
  }
}

export function reqIp(c: { req: { header: (name: string) => string | undefined } }): string {
  return c.req.header('cf-connecting-ip') ?? '';
}
```

- [ ] **Step 2: `src/db/audit.ts` tulis `entry.ip`**

```diff
-      ip: '',
+      ip: entry.ip ?? '',
```

- [ ] **Step 3: `src/app.ts` onError tangani `HttpError`**

```diff
 import { errPayload } from './utils/http';
+import { HttpError } from './utils/http';

   app.onError((err, c) => {
+    if (err instanceof HttpError) {
+      return c.json(errPayload(err.message, err.error), err.status);
+    }
     console.error('unhandled:', err);
     return c.json(errPayload('Terjadi kesalahan internal.', 'INTERNAL'), 500);
   });
```

- [ ] **Step 4: `src/routes/auth.ts` — audit login/logout sertakan `reqIp`**

```diff
     const body = await c.req.json().catch(() => null);
+    const ip = reqIp(c);
     ...
       await deps.recordAudit({
         user_id: user?.user_id ?? '-',
         username,
         action: 'LOGIN_GAGAL',
         modul: 'auth',
         keterangan: 'Login gagal: kredensial tidak valid',
+        ip,
       });
...
     await deps.recordAudit({
       user_id: user.user_id,
       username: user.username,
       action: 'LOGIN',
       modul: 'auth',
       keterangan: `Login berhasil role=${user.role} cabang=${user.kode_cabang || '-'}`,
+      ip,
     });
```
(`logout` juga: tambahkan `ip: reqIp(c)`.)

- [ ] **Step 5: Tulis `src/logic/master-cache.ts`** (dibuat di sini karena `bumpMasterRev` dipakai CRUD Task 3; `getMasterRev`/`masterCacheKey` jadi milik GET di Task 4)

```ts
import type { KVStore } from '../deps';

export async function getMasterRev(kv: KVStore): Promise<string> {
  const rev = await kv.get('master-rev');
  return rev == null ? '0' : String(rev);
}

export async function bumpMasterRev(kv: KVStore): Promise<void> {
  const cur = Number(await getMasterRev(kv));
  await kv.put('master-rev', String(cur + 1));
}

export function masterCacheKey(rev: string, role: string, cabang: string): string {
  return `master:${rev}:${role}:${cabang}`;
}
```

- [ ] **Step 6: Tulis `src/routes/master.ts`** (CRUD lengkap; `GET /api/master` menyusul di Task 4)

```ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { SessionUser } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { hashPassword } from '../auth/password';
import { errPayload, HttpError, okPayload, reqIp } from '../utils/http';
import { bumpMasterRev } from '../logic/master-cache';
import { defaultOilIntervalKm } from '../logic/master';
import type { AppDeps } from '../deps';

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

function isSuper(u: SessionUser): boolean {
  return u.role === 'SUPERADMIN';
}
function needSuper(u: SessionUser, action: string): void {
  if (!isSuper(u)) throw new HttpError(403, 'Akses ditolak: hanya SUPERADMIN yang dapat ' + action + '.', 'FORBIDDEN');
}
function needOwn(u: SessionUser, cabang: string | undefined | null): void {
  const cabangUser = String(u.cabang || '');
  if (!cabangUser || String(cabang ?? '') !== cabangUser) {
    throw new HttpError(403, 'Akses ditolak: Anda hanya dapat mengelola data warehouse ' + cabangUser + '.', 'FORBIDDEN');
  }
}

export function newId(prefix: string): string {
  return `${prefix}${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;
}
export function jsonSnip(v: unknown): string {
  if (v == null) return '';
  try {
    return JSON.stringify(v).substring(0, 2000);
  } catch {
    return '';
  }
}

export function masterRoutes(deps: AppDeps): Hono {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', requireUser(deps));

  const audit = (c: Ctx, entry: Omit<Parameters<AppDeps['recordAudit']>[0], 'user_id' | 'username' | 'ip'>) =>
    deps.recordAudit({
      ...entry,
      user_id: c.get('user').user_id,
      username: c.get('user').username,
      ip: reqIp(c),
    });

  // ── CABANG (SUPERADMIN only) ─────────────────────────────────────────────
  app.post('/cabang', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'mengelola master cabang');
    const body = await c.req.json().catch(() => null);
    const kode = String((body as any)?.kode ?? '').trim();
    const nama = String((body as any)?.nama ?? '').trim();
    const lokasi = String((body as any)?.lokasi ?? '').trim();
    if (!kode || !nama) return c.json(errPayload('Kode dan nama cabang wajib diisi.', 'BAD_REQUEST'), 400);
    if (await deps.master.findCabangByKode(kode)) {
      return c.json(errPayload(`Kode cabang "${kode}" sudah terpakai.`, 'CONFLICT'), 409);
    }
    await deps.master.insertCabang({ kode_cabang: kode, nama_cabang: nama, lokasi });
    await audit(c, { action: 'CREATE', modul: 'master', keterangan: 'Cabang ' + kode, data_sesudah: jsonSnip({ kode, nama, lokasi }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Cabang Berhasil Ditambahkan' }));
  });

  app.put('/cabang', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'memperbarui master cabang');
    const body = await c.req.json().catch(() => null);
    const editId = String((body as any)?.edit_id ?? '');
    const kode = String((body as any)?.kode ?? '').trim();
    const nama = String((body as any)?.nama ?? '').trim();
    const lokasi = String((body as any)?.lokasi ?? '').trim();
    if (String(kode) !== String(editId)) {
      return c.json(errPayload('Kode cabang tidak dapat diubah. Hanya nama/lokasi yang boleh diedit.', 'BAD_REQUEST'), 400);
    }
    if (!nama) return c.json(errPayload('Nama cabang wajib diisi.', 'BAD_REQUEST'), 400);
    const target = await deps.master.findCabangByKode(editId);
    if (!target) throw new HttpError(404, 'Cabang tidak ditemukan', 'NOT_FOUND');
    const dup = await deps.master.findCabangByKode(kode);
    if (dup && dup.kode_cabang !== editId) {
      return c.json(errPayload(`Kode cabang "${kode}" sudah terpakai oleh baris lain.`, 'CONFLICT'), 409);
    }
    await deps.master.updateCabang(editId, { nama_cabang: nama, lokasi });
    await audit(c, {
      action: 'EDIT', modul: 'master', keterangan: 'Cabang ' + editId,
      data_sebelum: jsonSnip({ kode: target.kode_cabang, nama: target.nama_cabang, lokasi: target.lokasi }),
      data_sesudah: jsonSnip({ kode, nama, lokasi }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Cabang Berhasil Diupdate' }));
  });

  app.delete('/cabang/:kode', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'menghapus master cabang');
    const kode = c.req.param('kode');
    const target = await deps.master.findCabangByKode(kode);
    if (!target) throw new HttpError(404, 'Cabang tidak ditemukan', 'NOT_FOUND');
    const refs = await deps.master.listCabangRefs(kode);
    if (refs.length > 0) {
      throw new HttpError(409, 'Cabang masih memiliki data terkait (' + refs.join(', ') + '). Hapus atau timpa data terkait terlebih dahulu.', 'CONFLICT');
    }
    await deps.master.setCabangStatus(kode, 'Non-Aktif');
    await audit(c, {
      action: 'DELETE', modul: 'master', keterangan: 'Cabang ' + kode,
      data_sebelum: jsonSnip({ kode: target.kode_cabang, nama: target.nama_cabang }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Cabang Berhasil Dihapus' }));
  });

  // ── KENDARAAN ────────────────────────────────────────────────────────────
  app.post('/kendaraan', async (c: Ctx) => {
    const u = c.get('user');
    const body = await json(c);
    if (!isSuper(u)) needOwn(u, (body as any)?.cabang);
    const id = newId('V-');
    const row = buildVehicleInsert(body, id);
    await deps.master.insertKendaraan(row);
    await audit(c, { action: 'CREATE', modul: 'master', keterangan: 'Kendaraan ' + id, data_sesudah: jsonSnip({ vehicle_id: id, plat: body?.plat, nama: body?.nama, cabang: body?.cabang }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Kendaraan Berhasil Ditambahkan' }));
  });

  app.put('/kendaraan', async (c: Ctx) => {
    const u = c.get('user');
    const body = await json(c);
    const editId = String((body as any)?.edit_id ?? '');
    const target = await deps.master.findKendaraanById(editId);
    if (!target) throw new HttpError(404, 'Kendaraan tidak ditemukan', 'NOT_FOUND');
    if (!isSuper(u)) {
      needOwn(u, target.kode_cabang);
      needOwn(u, (body as any)?.cabang);
    }
    const row = buildVehicleInsert(body, editId);
    await deps.master.updateKendaraan({ ...row, status: target.status });
    await audit(c, {
      action: 'EDIT', modul: 'master', keterangan: 'Kendaraan ' + editId,
      data_sebelum: jsonSnip({ plat: target.plat_nomor, nama: target.nama_kendaraan }),
      data_sesudah: jsonSnip({ plat: (body as any)?.plat, nama: (body as any)?.nama, cabang: (body as any)?.cabang }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Kendaraan Berhasil Diupdate' }));
  });

  app.delete('/kendaraan/:vehicleId', async (c: Ctx) => {
    const u = c.get('user');
    const vehicleId = c.req.param('vehicleId');
    const target = await deps.master.findKendaraanById(vehicleId);
    if (!target) return c.json(okPayload({ msg: 'Kendaraan tidak ditemukan' }));
    if (!isSuper(u)) needOwn(u, target.kode_cabang);
    await deps.master.setKendaraanStatus(vehicleId, 'Non-Aktif');
    await audit(c, {
      action: 'DELETE', modul: 'master', keterangan: 'Kendaraan ' + vehicleId,
      data_sebelum: jsonSnip({ plat: target.plat_nomor, nama: target.nama_kendaraan }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Kendaraan Berhasil Dihapus' }));
  });

  app.post('/kendaraan/:vehicleId/reset-oli', async (c: Ctx) => {
    const u = c.get('user');
    const vehicleId = c.req.param('vehicleId');
    const target = await deps.master.findKendaraanById(vehicleId);
    if (!target) throw new HttpError(404, 'Kendaraan tidak ditemukan', 'NOT_FOUND');
    if (!isSuper(u)) needOwn(u, target.kode_cabang);
    const odo = await deps.master.currentOdoPerVehicle();
    const km = odo[String(vehicleId)] != null ? odo[String(vehicleId)] : 0;
    const interval = target.interval_ganti_oli_km != null && String(target.interval_ganti_oli_km) !== ''
      ? target.interval_ganti_oli_km : 5000;
    const sebelum = { km_terakhir_ganti_oli: target.km_terakhir_ganti_oli, interval_ganti_oli_km: target.interval_ganti_oli_km != null && String(target.interval_ganti_oli_km) !== '' ? target.interval_ganti_oli_km : null };
    await deps.master.updateKendaraan({ ...target, km_terakhir_ganti_oli: km, interval_ganti_oli_km: interval });
    await audit(c, {
      action: 'GANTI_OLI', modul: 'kendaraan', keterangan: 'Kendaraan ' + vehicleId,
      data_sebelum: jsonSnip(sebelum), data_sesudah: jsonSnip({ km_terakhir_ganti_oli: km }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Baseline ganti oli diperbarui ke KM ' + km + '.', km }));
  });

  // ── SUPIR ────────────────────────────────────────────────────────────────
  app.post('/supir', async (c: Ctx) => {
    const u = c.get('user');
    const body = await json(c);
    if (!isSuper(u)) needOwn(u, (body as any)?.cabang);
    const id = newId('DRV-');
    await deps.master.insertSupir({ supir_id: id, nama_supir: String((body as any)?.nama ?? ''), kode_cabang: String((body as any)?.cabang ?? ''), default_vehicle_id: String((body as any)?.default_vehicle_id ?? ''), status: 'Aktif' });
    await audit(c, { action: 'CREATE', modul: 'master', keterangan: 'Supir ' + id, data_sesudah: jsonSnip({ id, nama: (body as any)?.nama, cabang: (body as any)?.cabang }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Supir Berhasil Ditambahkan' }));
  });

  app.put('/supir', async (c: Ctx) => {
    const u = c.get('user');
    const body = await json(c);
    const editId = String((body as any)?.edit_id ?? '');
    const target = await deps.master.findSupirById(editId);
    if (!target) throw new HttpError(404, 'Supir tidak ditemukan', 'NOT_FOUND');
    if (!isSuper(u)) {
      needOwn(u, target.kode_cabang);
      needOwn(u, (body as any)?.cabang);
    }
    await deps.master.updateSupir({ supir_id: editId, nama_supir: String((body as any)?.nama ?? ''), kode_cabang: String((body as any)?.cabang ?? ''), default_vehicle_id: String((body as any)?.default_vehicle_id ?? ''), status: target.status });
    await audit(c, {
      action: 'EDIT', modul: 'master', keterangan: 'Supir ' + editId,
      data_sebelum: jsonSnip({ nama: target.nama_supir, cabang: target.kode_cabang }),
      data_sesudah: jsonSnip({ nama: (body as any)?.nama, cabang: (body as any)?.cabang }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Supir Berhasil Diupdate' }));
  });

  app.delete('/supir/:id', async (c: Ctx) => {
    const u = c.get('user');
    const id = c.req.param('id');
    const target = await deps.master.findSupirById(id);
    if (!target) throw new HttpError(404, 'Supir tidak ditemukan', 'NOT_FOUND');
    if (!isSuper(u)) needOwn(u, target.kode_cabang);
    await deps.master.setSupirStatus(id, 'Non-Aktif');
    await audit(c, { action: 'DELETE', modul: 'master', keterangan: 'Supir ' + id, data_sebelum: jsonSnip({ nama: target.nama_supir, cabang: target.kode_cabang }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Supir Berhasil Dihapus' }));
  });

  // ── BBM (SUPERADMIN only) ────────────────────────────────────────────────
  app.post('/bbm', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'menambah master BBM');
    const body = await json(c);
    const id = newId('BBM-');
    await deps.master.insertBbm({ bbm_id: id, jenis_bbm: String((body as any)?.jenis ?? ''), harga_per_liter: Number((body as any)?.harga) || 0, kode_cabang: String((body as any)?.kode_cabang ?? ''), status: 'Aktif' });
    await audit(c, { action: 'CREATE', modul: 'master', keterangan: 'BBM ' + id, data_sesudah: jsonSnip({ id, jenis: (body as any)?.jenis, harga: (body as any)?.harga }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'BBM Berhasil Ditambahkan' }));
  });

  app.put('/bbm', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'memperbarui master BBM');
    const body = await json(c);
    const editId = String((body as any)?.edit_id ?? '');
    const target = await deps.master.findBbmById(editId);
    if (!target) throw new HttpError(404, 'BBM tidak ditemukan', 'NOT_FOUND');
    await deps.master.updateBbm({ bbm_id: editId, jenis_bbm: String((body as any)?.jenis ?? ''), harga_per_liter: Number((body as any)?.harga) || 0, kode_cabang: String((body as any)?.kode_cabang ?? ''), status: 'Aktif' });
    await audit(c, {
      action: 'EDIT', modul: 'master', keterangan: 'BBM ' + editId,
      data_sebelum: jsonSnip({ jenis: target.jenis_bbm, harga: target.harga_per_liter }),
      data_sesudah: jsonSnip({ jenis: (body as any)?.jenis, harga: (body as any)?.harga }),
    });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'BBM Berhasil Diupdate' }));
  });

  app.delete('/bbm/:id', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'menghapus master BBM');
    const id = c.req.param('id');
    const target = await deps.master.findBbmById(id);
    if (!target) throw new HttpError(404, 'BBM tidak ditemukan', 'NOT_FOUND');
    await deps.master.setBbmStatus(id, 'Non-Aktif');
    await audit(c, { action: 'DELETE', modul: 'master', keterangan: 'BBM ' + id, data_sebelum: jsonSnip({ jenis: target.jenis_bbm, harga: target.harga_per_liter }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'BBM Berhasil Dihapus' }));
  });

  // ── PENGGUNA (SUPERADMIN only) ───────────────────────────────────────────
  app.post('/pengguna', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'mengelola akun pengguna');
    const body = await json(c);
    const uname = String((body as any)?.username ?? '').trim();
    const nama = String((body as any)?.nama ?? '').trim();
    const password = String((body as any)?.password ?? '');
    const role = String((body as any)?.role ?? '');
    const cabang = String((body as any)?.cabang ?? '').trim();
    if (!uname) return c.json(errPayload('Username wajib diisi', 'BAD_REQUEST'), 400);
    if (!nama) return c.json(errPayload('Nama wajib diisi', 'BAD_REQUEST'), 400);
    if (!password) return c.json(errPayload('Password wajib diisi', 'BAD_REQUEST'), 400);
    if (role !== 'SUPERADMIN' && role !== 'PIC CABANG') return c.json(errPayload('Role tidak valid', 'BAD_REQUEST'), 400);
    if (role === 'PIC CABANG' && !cabang) return c.json(errPayload('Warehouse wajib diisi untuk PIC CABANG', 'BAD_REQUEST'), 400);
    if (await deps.master.findPenggunaByUsername(uname)) return c.json(errPayload('Username sudah terpakai', 'CONFLICT'), 409);
    const id = newId('U-');
    await deps.master.insertPengguna({ user_id: id, username: uname, password: await hashPassword(password), nama, role, kode_cabang: cabang, status: 'Aktif' });
    await audit(c, { action: 'CREATE', modul: 'pengguna', keterangan: 'Pengguna ' + uname, data_sesudah: jsonSnip({ user_id: id, username: uname, nama, role, cabang }) });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Pengguna Berhasil Ditambahkan' }));
  });

  app.put('/pengguna', async (c: Ctx) => {
    const u = c.get('user');
    needSuper(u, 'mengelola akun pengguna');
    const body = await json(c);
    const userId = String((body as any)?.user_id ?? '');
    const uname = String((body as any)?.username ?? '').trim();
    const nama = String((body as any)?.nama ?? '').trim();
    const role = String((body as any)?.role ?? '');
    const cabang = String((body as any)?.cabang ?? '').trim();
    const current = await deps.master.findPenggunaById(userId);
    if (!current) throw new HttpError(404, 'Pengguna tidak ditemukan', 'NOT_FOUND');
    if (!uname) return c.json(errPayload('Username wajib diisi', 'BAD_REQUEST'), 400);
    if (!nama) return c.json(errPayload('Nama wajib diisi', 'BAD_REQUEST'), 400);
    if (role !== 'SUPERADMIN' && role !== 'PIC CABANG') return c.json(errPayload('Role tidak valid', 'BAD_REQUEST'), 400);
    if (role === 'PIC CABANG' && !cabang) return c.json(errPayload('Warehouse wajib diisi untuk PIC CABANG', 'BAD_REQUEST'), 400);
    const dup = await deps.master.findPenggunaByUsername(uname);
    if (dup && dup.user_id !== userId) return c.json(errPayload('Username sudah terpakai', 'CONFLICT'), 409);
    if (String(u.username) === String(current.username) && current.role === 'SUPERADMIN' && role !== 'SUPERADMIN') {
      const active = await deps.master.countActiveSuperadmin();
      if (active <= 1) return c.json(errPayload('Tidak bisa menghapus peran SUPERADMIN terakhir', 'CONFLICT'), 409);
    }
    const password = String((body as any)?.password ?? '');
    const newPassword = password ? await hashPassword(password) : current.password;
    await deps.master.updatePengguna({ ...current, username: uname, password: newPassword, nama, role, kode_cabang: cabang });
    await audit(c, { action: 'EDIT', modul: 'pengguna', keterangan: 'Update user ' + userId });
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: 'Pengguna Berhasil Diupdate' }));
  });

  app.delete('/pengguna/:userId', async (c: Ctx) => {
    return setStatus(c, deps, 'Non-Aktif');
  });
  app.post('/pengguna/:userId/activate', async (c: Ctx) => {
    return setStatus(c, deps, 'Aktif');
  });

  return app;
}

async function json(c: Context<any>): Promise<any> {
  return c.req.json().catch(() => null);
}

function buildVehicleInsert(body: any, vehicleId: string) {
  return {
    vehicle_id: vehicleId,
    plat_nomor: String(body?.plat ?? ''),
    nama_kendaraan: String(body?.nama ?? ''),
    jenis_kendaraan: String(body?.jenis ?? 'Mobil'),
    merk: String(body?.merk ?? ''),
    model: String(body?.model ?? ''),
    kapasitas_tangki: Number(body?.kapasitas_tangki) || 0,
    jumlah_bar: Number(body?.jumlah_bar) || 0,
    standar_km_l: Number(body?.standar_km_l) || 0,
    kode_cabang: String(body?.cabang ?? ''),
    status: 'Aktif',
    jenis_indikator: String(body?.jenis_indikator || 'DIGITAL_BAR'),
    tanggal_pajak: String(body?.tanggal_pajak ?? ''),
    tanggal_pajak_5_tahunan: String(body?.tanggal_pajak_5_tahunan ?? ''),
    tanggal_kir: String(body?.tanggal_kir ?? ''),
    km_terakhir_ganti_oli: Number(body?.km_terakhir_ganti_oli) || 0,
    interval_ganti_oli_km: Number(body?.interval_ganti_oli_km) || defaultOilIntervalKm(body?.jenis),
  };
}

async function setStatus(c: Ctx, deps: AppDeps, status: string): Promise<Response> {
  const u = c.get('user');
  needSuper(u, 'mengelola status akun pengguna');
  const userId = c.req.param('userId');
  const current = await deps.master.findPenggunaById(userId);
  if (!current) throw new HttpError(404, 'Pengguna tidak ditemukan', 'NOT_FOUND');
  if (status === 'Non-Aktif' && String(u.username) === String(current.username)) {
    throw new HttpError(409, 'Tidak bisa menonaktifkan akun sendiri', 'CONFLICT');
  }
  if (status === 'Non-Aktif' && current.role === 'SUPERADMIN') {
    const active = await deps.master.countActiveSuperadmin();
    if (active <= 1) throw new HttpError(409, 'Tidak bisa menonaktifkan SUPERADMIN aktif terakhir', 'CONFLICT');
  }
  await deps.master.setPenggunaStatus(userId, status);
  await audit(c, { action: 'DELETE', modul: 'pengguna', keterangan: (status === 'Aktif' ? 'Aktifkan ' : 'Nonaktifkan ') + userId });
  await bumpMasterRev(deps.kv);
  const msg = status === 'Aktif' ? 'Pengguna Berhasil Diaktifkan Kembali' : 'Pengguna Berhasil Dinonaktifkan';
  return c.json(okPayload({ msg }));
}
```

Catatan: impor `AuthVars` & `Ctx` dipakai agar `c.get('user')` ter-*typ*. Jika TS keluh tentang helper `audit`, ganti tipe param menjadi `Context<{ Bindings: Env; Variables: AuthVars }>`.

- [ ] **Step 7: Mount router di `src/app.ts`**

```diff
 import { authRoutes } from './routes/auth';
+import { masterRoutes } from './routes/master';
 ...
   app.route('/api', authRoutes(deps));
+  app.route('/api', masterRoutes(deps));
```

- [ ] **Step 8: Tulis `tests/routes/master.test.ts`** (subset kunci: sukses, guard, pesan & audit; cabang+kendaraan+pengguna+nonaktif self+reset-oli)

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, makeDeps, memMaster, loginAs } from '../helpers';
import { hashPassword } from '../../src/auth/password';
import type { SessionUser } from '../../src/deps';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

function buildEnv() {
  const { deps, audits, kv, masterState } = makeDeps({ master: memMaster().repo });
  const app = buildApp(fakeEnv() as any, deps);
  return { app, audits, kv, masterState };
}

describe('master routes', () => {
  it('cabang: tambah => 200 + msg; audit CREATE; cabang lain ditolak utk PIC', async () => {
    const { app, audits, kv } = buildEnv();
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/master/cabang', {
      method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kode: 'CBG-X', nama: 'Cabang X', lokasi: 'Jkt' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).msg).toBe('Cabang Berhasil Ditambahkan');
    expect(audits.some((a) => a.action === 'CREATE' && a.modul === 'master' && String(a.keterangan).includes('CBG-X'))).toBe(true);

    const tokPic = await loginAs(kv, PIC);
    const denied = await app.request('/api/master/cabang', {
      method: 'POST', headers: { ...authHeaders(tokPic), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kode: 'CBG-Y', nama: 'Y' }),
    });
    expect(denied.status).toBe(403);
  });

  it('kendaraan: tambah PIC utk cabang sendiri; update ke cabang lain ditolak', async () => {
    const { state, repo } = memMaster();
    const { app, kv } = makeDeps({ master: repo });
    const tok = await loginAs(kv, PIC);
    const add = await app.request('/api/master/kendaraan', {
      method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plat: 'B 123 CD', nama: 'Avanza', jenis: 'Mobil', cabang: 'CBG-A' }),
    });
    expect(add.status).toBe(200);
    expect(state.kendaraan.length).toBe(1);
    expect(state.kendaraan[0]).toMatchObject({ plat_nomor: 'B 123 CD', kode_cabang: 'CBG-A', interval_ganti_oli_km: 5000 });

    const bad = await app.request('/api/master/kendaraan', {
      method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plat: 'B 999 CD', nama: 'Beda', cabang: 'CBG-B' }),
    });
    expect(bad.status).toBe(403);
  });

  it('pengguna: tambah validasi; nonaktif akun sendiri ditolak; aktif-superadmin-terakhir ditolak', async () => {
    const { app, kv } = buildEnv();
    const tok = await loginAs(kv, SUPER);
    const insert = await app.request('/api/master/pengguna', {
      method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'op1', password: 'pw123456', nama: 'Op1', role: 'PIC CABANG', cabang: 'CBG-A' }),
    });
    expect(insert.status).toBe(200);

    const adminId = 'U-S';
    const self = await app.request('/api/master/pengguna/' + adminId, { method: 'DELETE', headers: authHeaders(tok) });
    expect(self.status).toBe(409);
    expect((await self.json() as any).message).toBe('Tidak bisa menonaktifkan akun sendiri');
  });

  it('reset-oli mengembalikan {msg,km} & audit GANTI_OLI; odo dari penggunaan_bbm', async () => {
    const { app, deps, kv } = buildEnv();
    const { repo } = memMaster({ kendaraan: [vehicleRow] });
    deps.master = repo;
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/master/kendaraan/V-1/reset-oli', { method: 'POST', headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.ok ? body.msg : body.message).toBeTruthy();
    expect(typeof body.km).toBe('number');
  });
});
```

Catatan teknis test:
- Add convenience di `tests/helpers.ts`:

```ts
export const VEHICLE_ROW = {
  vehicle_id: 'V-1', plat_nomor: 'B 1 A', nama_kendaraan: 'Corolla', jenis_kendaraan: 'Mobil',
  merk: 'Toyota', model: 'Altis', kapasitas_tangki: 50, jumlah_bar: 8, standar_km_l: 12,
  kode_cabang: 'CBG-A', status: 'Aktif', jenis_indikator: 'DIGITAL_BAR',
  tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '',
  km_terakhir_ganti_oli: 10000, interval_ganti_oli_km: 0,
};
```

- Insert/update di-assert langsung via `state` dari `memMaster()` (bukan lewat `GET /api/master`, yang baru ada di Task 4).

- [ ] **Step 9: Jalankan suite + typecheck** (pastikan test auth-routes lama tetap hijau)

```powershell
npx vitest run
npm run typecheck
```

- [ ] **Step 10: Commit**

```powershell
git add src/utils/http.ts src/db/audit.ts src/app.ts src/routes/auth.ts src/logic/master-cache.ts src/routes/master.ts tests/routes/master.test.ts
git commit -m "feat(master): CRUD cabang/kendaraan/supir/bbm/pengguna + reset-oli (guard, audit, pesan GAS)"
```

---

## Task 4: `GET /api/master` — aggregate + cache KV (rev-based)

**Files:**
- Edit: `src/routes/master.ts` (tambah handler `GET /`, import `getMasterRev`/`masterCacheKey`/`getMasterPayload`, dan `MASTER_CACHE_TTL`)
- Create: `tests/routes/master-read.test.ts`

**Produces:** `GET /api/master` (di bawah mount `/api/master`) dengan cache KV TTL 30 dtk (`src/logic/master-cache.ts` sudah dibuat di Task 3); setiap write master (Task 3) membatalkan cache via `bumpMasterRev`.

- [ ] **Step 1: Tambah handler di `src/routes/master.ts`** (sebelum `return app;` di dalam `masterRoutes`)

Tambahkan konstanta & impor baru:

```diff
 import { errPayload, HttpError, okPayload, reqIp } from '../utils/http';
-import { bumpMasterRev } from '../logic/master-cache';
-import { defaultOilIntervalKm } from '../logic/master';
+import { bumpMasterRev, getMasterRev, masterCacheKey } from '../logic/master-cache';
+import { defaultOilIntervalKm, getMasterPayload } from '../logic/master';
 import type { AppDeps } from '../deps';

+const MASTER_CACHE_TTL = 30;
 type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;
```

Lalu handler GET (di dalam `masterRoutes`, sebelum `return app;`):

```ts
  app.get('/', async (c: Ctx) => {
    const u = c.get('user');
    const rev = await getMasterRev(deps.kv);
    const ck = masterCacheKey(rev, u.role, u.cabang ?? '');
    const hit = await deps.kv.get(ck, 'json');
    if (hit) return c.json(okPayload(hit as Record<string, unknown>));

    const [raw, lastSumber] = await Promise.all([
      deps.master.listAll(),
      deps.master.currentOdoPerVehicle(),
    ]);
    const payload = getMasterPayload(raw, { role: u.role, cabang: u.cabang ?? '' }, lastSumber);
    await deps.kv.put(ck, JSON.stringify(payload), { expirationTtl: MASTER_CACHE_TTL });
    return c.json(okPayload(payload));
  });
```

- [ ] **Step 2: Tulis `tests/routes/master-read.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, makeDeps, loginAs, memMaster, VEHICLE_ROW } from '../helpers';
import type { SessionUser } from '../../src/deps';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

function seedState() {
  const { repo } = memMaster({
    cabang: [{ kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: 'Jkt', status: 'Aktif' }],
    kendaraan: [VEHICLE_ROW],
    bbm: [{ bbm_id: 'BBM-P', jenis_bbm: 'Pertalite', harga_per_liter: 10000, kode_cabang: '', status: 'Aktif' }],
  });
  return repo;
}

describe('GET /api/master', () => {
  it('SUPERADMIN menerima payload lengkap bentuk GAS', async () => {
    const { deps, kv } = makeDeps({ master: seedState() });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/master', { headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.vehicles[0]).toMatchObject({ vehicle_id: 'V-1', plat_nomor: 'B 1 A', nama: 'Corolla', cabang: 'CBG-A', interval_ganti_oli_km: 5000 });
    expect(body.cabangList).toEqual([{ kode: 'CBG-A', nama: 'Cabang A' }]);
    expect(body.bbmList).toEqual([{ id: 'BBM-P', jenis: 'Pertalite', harga: 10000 }]);
    expect(body.penggunaList).toEqual([]);
  });

  it('PIC hanya melihat data cabangnya; BBM bentuk merge', async () => {
    const { deps, kv } = makeDeps({ master: seedState() });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/master', { headers: authHeaders(tok) });
    const body = await res.json() as any;
    expect(body.vehicles.length).toBe(1);
    expect(body.cabangList).toEqual([{ kode: 'CBG-A', nama: 'Cabang A' }]);
    expect(body.bbmList[0]).toMatchObject({ bbm_id: 'BBM-P', jenis_bbm: 'Pertalite' });
  });

  it('tanpa token => 401', async () => {
    const { deps } = makeDeps();
    const app = buildApp(fakeEnv() as any, deps);
    const res = await app.request('/api/master', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('cache KV dipakai: payload kedua berasal dari cache (sumber listAll hanya 1x)', async () => {
    const { repo } = memMaster({ cabang: [
      { kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: '', status: 'Aktif' },
    ] });
    let calls = 0;
    const counted = { ...repo, listAll: async () => { calls++; return repo.listAll(); } };
    const { deps, kv } = makeDeps({ master: counted });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, SUPER);
    await app.request('/api/master', { headers: authHeaders(tok) });
    await app.request('/api/master', { headers: authHeaders(tok) });
    expect(calls).toBe(1);
  });

  it('setelah write+rev bump, cache tidak lagi terpakai (listAll dipanggil lagi)', async () => {
    const { repo } = memMaster({ cabang: [
      { kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: '', status: 'Aktif' },
    ] });
    let calls = 0;
    const counted = { ...repo, listAll: async () => { calls++; return repo.listAll(); } };
    const { deps, kv } = makeDeps({ master: counted });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, SUPER);
    await app.request('/api/master', { headers: authHeaders(tok) });
    expect(calls).toBe(1);
    await app.request('/api/master/cabang', {
      method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ kode: 'CBG-B', nama: 'Cabang B' }),
    });
    await app.request('/api/master', { headers: authHeaders(tok) });
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 3: Jalankan full suite + typecheck**

```powershell
npx vitest run
npm run typecheck
```

- [ ] **Step 4: Commit**

```powershell
git add src/routes/master.ts tests/routes/master-read.test.ts
git commit -m "feat(master): GET /api/master cache KV 30s (rev-based)"
```

---

## Task 5: Pengaturan + Logo (Supabase Storage)

**Files:**
- Create: `src/db/storage.ts`
- Create: `src/routes/settings.ts`
- Edit: `src/app.ts` (mount)
- Create: `tests/routes/settings.test.ts`

**Produces:** `GET /api/settings` (publik), `PUT /api/settings` (SUPERADMIN, msg `'Pengaturan berhasil disimpan'`), `POST /api/settings/logo` (SUPERADMIN; base64 → Storage bucket `settings` → URL publik; mirip GAS `DatabaseUploadLogo`).

- [ ] **Step 1: Tulis `src/db/storage.ts`**

```ts
import type { Env } from '../env';
import { getSupabase } from './client';

const BUCKET = 'settings';

export interface StorageUploadResult {
  url: string;
  key: string;
}

export async function ensureSettingsBucket(env: Env): Promise<void> {
  const sb = getSupabase(env);
  try {
    const { error } = await sb.storage.createBucket(BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message ?? '')) throw error;
  } catch (err) {
    // bucket kemungkinan sudah ada; cek keberadaan
    const { data, error } = await sb.storage.getBucket(BUCKET);
    if (error) throw new Error(`Storage getBucket: ${error.message}`);
    if (data && !data.public) {
      await sb.storage.updateBucket(BUCKET, { public: true });
    }
  }
}

export async function uploadLogo(env: Env, bytes: Uint8Array, ext: string, contentType: string): Promise<StorageUploadResult> {
  const sb = getSupabase(env);
  await ensureSettingsBucket(env);
  const key = `logo.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(key, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  const url = `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${key}`;
  return { url, key };
}
```

- [ ] **Step 2: Tulis `src/routes/settings.ts`**

```ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppDeps } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { errPayload, HttpError, okPayload } from '../utils/http';
import { uploadLogo } from '../db/storage';

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

const IMAGE_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};
const MAX_LOGO_BYTES = 10 * 1024 * 1024;

export function settingsRoutes(deps: AppDeps): Hono {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/', async (c) => {
    const s = await deps.settings.getAll();
    return c.json(okPayload({
      logo_url: s.logo_url ?? '',
      app_name: s.app_name ?? 'Monitoring Kendaraan Operasional',
      company_name: s.company_name ?? 'PT Tridaya Sinergi Indonesia',
      footer_text: s.footer_text ?? '',
    }));
  });

  app.put('/', requireUser(deps), async (c) => {
    const u = c.get('user');
    if (u.role !== 'SUPERADMIN') throw new HttpError(403, 'Akses ditolak: hanya SUPERADMIN yang dapat mengubah pengaturan aplikasi.', 'FORBIDDEN');
    const body = await c.req.json().catch(() => null);
    const updates: Record<string, string> = {
      logo_url: String((body as any)?.logo_url ?? '') || '',
      app_name: String((body as any)?.app_name ?? '') || 'Monitoring Kendaraan Operasional',
      company_name: String((body as any)?.company_name ?? '') || 'PT Tridaya Sinergi Indonesia',
      footer_text: String((body as any)?.footer_text ?? '') || '',
    };
    await deps.settings.setMany(updates);
    await deps.recordAudit({
      user_id: u.user_id, username: u.username, action: 'EDIT', modul: 'pengaturan',
      keterangan: 'Ubah pengaturan aplikasi', data_sesudah: JSON.stringify(updates),
    });
    return c.json(okPayload({ msg: 'Pengaturan berhasil disimpan' }));
  });

  app.post('/logo', requireUser(deps), async (c) => {
    const u = c.get('user');
    if (u.role !== 'SUPERADMIN') throw new HttpError(403, 'Akses ditolak: hanya SUPERADMIN yang dapat mengunggah logo aplikasi.', 'FORBIDDEN');
    try {
      const body = await c.req.json().catch(() => null);
      const base64Data = String((body as any)?.base64Data ?? '');
      const fileName = String((body as any)?.fileName ?? '');
      const b64 = base64Data.split(',')[1] ?? base64Data;
      if (!b64) throw new Error('Data base64 tidak valid');
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (bytes.length > MAX_LOGO_BYTES) throw new Error('Ukuran file melebihi 10MB');
      const m = /\.([a-z0-9]+)$/i.exec(fileName);
      const rawExt = (m ? m[1] : 'png').toLowerCase();
      const ext = IMAGE_EXT[rawExt] ? rawExt : 'png';
      const contentType = IMAGE_EXT[ext] ?? 'image/png';
      const { url } = await uploadLogo(c.env as Env, bytes, ext, contentType);
      await deps.settings.setMany({ logo_url: url });
      await deps.recordAudit({
        user_id: u.user_id, username: u.username, action: 'EDIT', modul: 'pengaturan',
        keterangan: 'Unggah logo aplikasi', data_sesudah: JSON.stringify({ logo_url: url }),
      });
      return c.json(okPayload({ success: true, url }));
    } catch (e) {
      return c.json({ success: false, msg: 'Gagal upload logo: ' + (e as Error).message }, 400);
    }
  });

  return app;
}
```

- [ ] **Step 3: Mount di `src/app.ts`**

```diff
 import { masterRoutes } from './routes/master';
+import { settingsRoutes } from './routes/settings';
 ...
   app.route('/api', masterRoutes(deps));
+  app.route('/api/settings', settingsRoutes(deps));
```

- [ ] **Step 4: Tulis `tests/routes/settings.test.ts`** (stub storage via env/override bila perlu; uji GET default, PUT guard, PUT super, logo validate)

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, makeDeps, loginAs } from '../helpers';
import type { SessionUser } from '../../src/deps';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

describe('settings routes', () => {
  it('GET /api/settings publik mengembalikan default', async () => {
    const { deps } = makeDeps();
    const app = buildApp(fakeEnv() as any, deps);
    const res = await app.request('/api/settings', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(body.app_name).toBe('Monitoring Kendaraan Operasional');
  });

  it('PUT /api/settings: PIC ditolak (403)', async () => {
    const { deps, kv } = makeDeps();
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/settings', {
      method: 'PUT', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_name: 'X' }),
    });
    expect(res.status).toBe(403);
  });

  it('PUT /api/settings: SUPERADMIN simpan + tersimpan di repo', async () => {
    const { deps, kv, settingsValues } = makeDeps();
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/settings', {
      method: 'PUT', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_name: 'App Baru', company_name: 'PT X', footer_text: 'foot' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json() as any).msg).toBe('Pengaturan berhasil disimpan');
    expect(settingsValues.app_name).toBe('App Baru');
  });

  it('POST /api/settings/logo: base64 invalid => 400 success:false', async () => {
    const { deps, kv } = makeDeps();
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/settings/logo', {
      method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data: 'not-base64', fileName: 'logo.png' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json() as any;
    expect(body.success).toBe(false);
    expect(String(body.msg)).toContain('Gagal upload logo');
  });
});
```

Catatan storage di test: `POST /logo` sukses membutuhkan Supabase Storage real. Plan ini hanya menguji jalur gagal (& validasi) di unit; jalur sukses diuji saat verifikasi manual/deploy dengan bucket `settings` dibuat otomatis oleh `ensureSettingsBucket`. Alternatif unit: stub `uploadLogo` lewat override env — dapat dilakukan di Task 6 jika diperlukan.

- [ ] **Step 5: Jalankan suite + typecheck**

```powershell
npx vitest run
npm run typecheck
```

- [ ] **Step 6: Commit**

```powershell
git add src/db/storage.ts src/routes/settings.ts src/app.ts tests/routes/settings.test.ts
git commit -m "feat(settings): GET/PUT /api/settings + POST /api/settings/logo (Supabase Storage)"
```

---

## Task 6: Audit read + wiring final + verifikasi penuh + README + commit

**Files:**
- Create: `src/routes/audit.ts`
- Edit: `src/app.ts` (mount)
- Create: `tests/routes/audit.test.ts`
- Edit: `README.md` (tabel API + status M2)
- Edit: `docs/superpowers/specs/2026-09-18-migrasi-supabase-cloudflare-design.md` (isi bagian API master/settings/audit, centang checklist M2)

**Produces:** `GET /api/audit?limit=…` (SUPERADMIN, urut `timestamp` desc) — nilai tambah di atas GAS yang tak memiliki UI audit; wiring penuh M2 + verifikasi.

- [ ] **Step 1: Tulis `src/routes/audit.ts`**

```ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppDeps } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { errPayload, HttpError, okPayload } from '../utils/http';

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

export function auditRoutes(deps: AppDeps): Hono {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', requireUser(deps));

  app.get('/', async (c: Ctx) => {
    const u = c.get('user');
    if (u.role !== 'SUPERADMIN') throw new HttpError(403, 'Akses ditolak: hanya SUPERADMIN yang dapat melihat audit.', 'FORBIDDEN');
    const limit = Math.min(Math.max(Number(c.req.query('limit') ?? 100) || 100, 1), 500);
    const rows = await deps.auditList(limit);
    return c.json(okPayload({ items: rows }));
  });

  return app;
}
```

Tambahkan `auditList` ke `AppDeps` & `src/db/audit.ts`:

```diff
 // src/deps.ts
   recordAudit: (entry: AuditEntry) => Promise<void>;
+  auditList: (limit: number) => Promise<AuditRow[]>;
+  ip?: string;
 }
+export interface AuditRow {
+  log_id: string;
+  timestamp: string;
+  user_id: string;
+  username: string;
+  action: string;
+  modul: string;
+  keterangan: string;
+  data_sebelum: string;
+  data_sesudah: string;
+  ip: string;
+}
```

```ts
// src/db/audit.ts tambahan
export function auditListDb(env: Env) {
  return async (limit: number): Promise<AuditRow[]> => {
    const { data, error } = await getSupabase(env)
      .from('audit_log')
      .select('*')
      .order('timestamp', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`DB auditList: ${error.message}`);
    return (data ?? []) as unknown as AuditRow[];
  };
}
```

```diff
 // src/app.ts
 import { recordAuditDb } from './db/audit';
+import { auditListDb } from './db/audit';
 ...
     recordAudit: recordAuditDb(env),
+    auditList: auditListDb(env),
```

- [ ] **Step 2: Mount di `src/app.ts`**

```diff
 import { settingsRoutes } from './routes/settings';
+import { auditRoutes } from './routes/audit';
 ...
   app.route('/api/settings', settingsRoutes(deps));
+  app.route('/api/audit', auditRoutes(deps));
```

- [ ] **Step 3: Tulis `tests/routes/audit.test.ts`** (helper memAudit di `tests/helpers.ts`)

```ts
// tests/helpers.ts tambahan
import type { AuditRow } from '../src/deps';

export function memAudit(rows: AuditRow[] = []) {
  const auditList = async (limit: number) => rows.slice(0, limit);
  return { rows, auditList };
}
```

```ts
// tests/routes/audit.test.ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, makeDeps, memAudit, loginAs } from '../helpers';
import type { SessionUser } from '../../src/deps';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

const ROWS: any[] = [
  { log_id: 'LOG-2', timestamp: '2026-09-19T01:00:00.000Z', user_id: 'U-S', username: 'super', action: 'CREATE', modul: 'master', keterangan: 'Cabang CBG-X', data_sebelum: '', data_sesudah: '{}', ip: '1.2.3.4' },
  { log_id: 'LOG-1', timestamp: '2026-09-19T00:00:00.000Z', user_id: 'U-S', username: 'super', action: 'LOGIN', modul: 'auth', keterangan: 'Login berhasil', data_sebelum: '', data_sesudah: '', ip: '1.2.3.4' },
];

describe('audit routes', () => {
  it('SUPERADMIN membaca audit terurut terbaru dulu, limit bekerja', async () => {
    const { deps, kv } = makeDeps({ ...memAudit(ROWS) });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/audit?limit=1', { headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.items.length).toBe(1);
    expect(body.items[0].log_id).toBe('LOG-2');
  });

  it('PIC ditolak 403', async () => {
    const { deps, kv } = makeDeps({ ...memAudit(ROWS) });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/audit', { headers: authHeaders(tok) });
    expect(res.status).toBe(403);
  });

  it('tanpa token => 401', async () => {
    const { deps } = makeDeps();
    const app = buildApp(fakeEnv() as any, deps);
    const res = await app.request('/api/audit', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 4: Update `tests/helpers.ts` `makeDeps`** — sertakan `auditList`

```diff
   const deps: AppDeps = {
     kv,
     findByUsername: async () => null,
     recordAudit: async (e) => { audits.push({ ...e }); },
+    auditList: async () => [],
     now: () => 1_000_000,
     master,
     settings,
     ...over,
   };
```

- [ ] **Step 5: Update `README.md`** — tambah tabel API M2 (master CRUD, settings, audit) dan baris status M2.

- [ ] **Step 6: Update spec (centang M2) di `docs/superpowers/specs/2026-09-18-migrasi-supabase-cloudflare-design.md`** — isi §4 mapping master CRUD & settings/audit, tandai milestone M2.

- [ ] **Step 7: Verifikasi penuh**

```powershell
npx vitest run
npm run typecheck
npm run verify-schema
```

- [ ] **Step 8: Commit**

```powershell
git add src/routes/audit.ts src/db/audit.ts src/deps.ts src/app.ts tests/helpers.ts tests/routes/audit.test.ts README.md docs/superpowers/specs/2026-09-18-migrasi-supabase-cloudflare-design.md
git commit -m "feat(audit): GET /api/audit (SUPERADMIN) + wiring final M2, README & spec"
```

---

## Wrap-up

### Test commands
- `npx vitest run` — seluruh suite.
- `npm run typecheck` — TypeScript.
- `npm run verify-schema` / `npm run apply-schema` — skema DB.

### Expected test files after M2
```
tests/
  password.test.ts
  sessions.test.ts
  rate-limit.test.ts
  auth-routes.test.ts      # refactor ke helpers
  app.test.ts              # refactor ke helpers
  schema.test.ts
  helpers.ts               # BARU
  logic/master-payload.test.ts   # BARU
  routes/master.test.ts          # BARU
  routes/master-read.test.ts     # BARU
  routes/settings.test.ts        # BARU
  routes/audit.test.ts           # BARU
```

### Deploy opsional (setelah review)

```powershell
npx wrangler deploy
# verifikasi:
curl https://monitoring.kendaraanoprtsi.workers.dev/api/health
```

### Follow-ups yang akan tampil di milestone berikutnya (M3+)
- `GET /api/laporan/*` (M3) — `currentOdoPerVehicle`/`lastKmSumberPerVehicle` dipakai ulang untuk payload kendaraan `odo_estimasi_terakhir`.
- Dashboard & warnings (M4) — invalidation terpisah `invalidateDashwarn` (GAS `resetOilChange` & transaksi menyentuh cache dashwarn; M2 cukup `bumpMasterRev`).
- Flazz penuh (M5) — `flazzCards` sudah ada di payload master.
- Migrasi data (M8) — supir kini punya `default_vehicle_id`; ID pakai prefix+timestamp.

### Risks / notes
- `currentOdoPerVehicle` memakai `order('timestamp', ascending)`; pada DB berisi data lama ber-`timestamp` kosong urutan deterministik tidak dijamin. M3 akan memakai order berbasis baris nanti; untuk M2 tabel masih kosong sehingga aman.
- Konkurensi write tidak pakai transaction lintas-statement (tiap op adalah 1 statement Postgres: atomic). Audit ditulis *setelah* op sukses (mirip GAS).
- Cache master hanya menerapkan `expirationTtl` saat `kv.put`; memKV test mengabaikan TTL, jadi test cache memakai rev bump (bukan TTL) sebagai tanda invalidasi.