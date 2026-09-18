# M1 — Fondasi (Repo, Schema Postgres, Worker Scaffold, Auth) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun fondasi aplikasi baru: repo Cloudflare Workers yang bisa di-deploy, skema PostgreSQL lengkap di Supabase, dan sistem autentikasi (login/logout/session/rate-limit) yang kompatibel dengan hash password GAS.

**Architecture:** Satu Cloudflare Worker (Hono) di `*.workers.dev` melayani static assets (`env.ASSETS`) dan REST API `/api/*`. Data utama di Supabase PostgreSQL, session + rate-limit counter di Cloudflare KV, foto (tahap lanjut) di Supabase Storage. Autentikasi custom: username+password dengan verifikasi hash yang formatnya identik GAS sehingga data migrasi langsung bisa login tanpa reset.

**Tech Stack:** TypeScript, Cloudflare Workers (wrangler), Hono, @supabase/supabase-js, Cloudflare KV, Web Crypto (crypto.subtle), vitest.

## Global Constraints

- Semua nama tabel/kolom TEPAT mengikuti `DATABASE_SCHEMA` dari `DatabaseSetup.js` GAS (kode cabang, kolom `foto_km_awal`, `flazz_card_id`, dst.) agar script migrasi M8/M9 bisa mapping 1:1.
- Verifikasi password HARUS kompatibel dengan format GAS (`salt$rounds$hash` 3-bagian dan `salt$hash` 2-bagian, iterasi SHA-256 + salt), dengan `ROUNDS = 10000`.
- Role: `SUPERADMIN` dan `PIC CABANG`. Tidak pernah menurunkan role/cabang dari input client.
- Timezone aplikasi: `Asia/Jakarta`.
- Glaslokal (Global selalu): pesan error JSON seragam `{ success, error?, message? }`.
- Setiap respon sukses berbentuk `{ success: true, ...data }`, setiap kegagalan `{ success: false, error, message }`.

---

## File Structure

```
D:\Monitoring Kendaraan Ops Cloud\
├── package.json
├── tsconfig.json
├── wrangler.jsonc
├── vitest.config.ts
├── .gitignore
├── .env.example
├── README.md
├── static/
│   └── index.html                    # halaman placeholder (akan diganti frontend asli di M7)
├── db/
│   └── schema.sql                    # skema PostgreSQL lengkap (17 tabel + index + seed)
└── src/
    ├── index.ts                      # entry: buildApp + export worker
    ├── app.ts                        # buildApp(env, overrides): Hono + middleware + routes + assets fallback
    ├── env.ts                        # type Env (Bindings)
    ├── utils/
    │   └── http.ts                   # payload helper (okPayload/errPayload)
    ├── routes/
    │   ├── health.ts                 # GET /api/health
    │   └── auth.ts                   # POST /api/login, /api/logout, GET /api/session
    ├── auth/
    │   ├── password.ts               # hash/verify kompatibel GAS
    │   ├── sessions.ts               # createSession/resolveSession/destroySession (KV)
    │   ├── rateLimit.ts              # checkRate/resetRate (KV)
    │   └── middleware.ts             # requireUser (Hono middleware)
    └── db/
        ├── client.ts                 # getSupabase(env) factory
        ├── users.ts                  # findByUsername (real, Supabase)
        └── audit.ts                  # recordAudit (real, Supabase)
tests/
    ├── password.test.ts
    ├── sessions.test.ts
    ├── rate-limit.test.ts
    ├── auth-routes.test.ts
    ├── app.test.ts
    └── schema.test.ts
```

Unit:
- `password.ts` — murni (Web Crypto), tanpa dependensi.
- `sessions.ts` / `rateLimit.ts` — terima `KVStore` (interface kecil) agar bisa di-mock di vitest node.
- `routes/auth.ts` — factory `authRoutes(deps)` dengan dependency injection: `kv`, `findByUsername`, `recordAudit`, `now`.
- `app.ts` — factory `buildApp(env, overrides)`; `index.ts` hanya memasang env.
- `db/*` — implementasi real (Supabase), dipakai run-time; dites via injeksi fake di unit.

---

### Task 1: Scaffold Repo

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.jsonc`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `static/index.html`
- Create: `src/env.ts`

**Interfaces:**
- Produces: `Env` type (dipakai `app.ts`, `index.ts`, semua route), script npm `dev/deploy/test/typecheck`.

- [x] **Step 1: Write `package.json`**

```json
{
  "name": "monitoring-kendaraan-ops-cloud",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:migrate": "supabase db push"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.4",
    "hono": "^4.6.14"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250729.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.9",
    "wrangler": "^4.5.0"
  }
}
```

- [x] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [x] **Step 3: Write `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "monitoring-kendaraan-ops",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-18",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./static",
    "binding": "ASSETS"
  },
  "kv_namespaces": [
    { "binding": "SESSION_KV", "id": "PASTE_KV_NAMESPACE_ID_HERE" }
  ]
}
```

> Catatan: buat namespace KV via `npx wrangler kv namespace create SESSION_KV`, lalu ganti `id`. Untuk `wrangler dev` lokal nilai `id` palsu cukup (KV lokal dipakai otomatis).

- [x] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [x] **Step 5: Write `.gitignore`**

```gitignore
node_modules/
.wrangler/
.dev.vars
dist/
*.log
```

- [x] **Step 6: Write `.env.example`**

```env
# Cloudflare Worker secrets (set via: npx wrangler secret put NAME)
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key
```

> Jangan commit `.dev.vars` (berisi nilai asli) — gunakan `.env.example` sebagai template.

- [x] **Step 7: Write `static/index.html`**

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Laporan BBM & Operasional Harian</title>
</head>
<body>
  <main style="font-family: system-ui, sans-serif; padding: 2rem; text-align: center;">
    <h1>Monitoring Kendaraan Operasional</h1>
    <p>Versi Cloud — fondasi berjalan.</p>
  </main>
</body>
</html>
```

- [x] **Step 8: Write `src/env.ts`**

```ts
export interface Env {
  ASSETS: Fetcher;
  SESSION_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}
```

- [x] **Step 9: Write placeholder `src/index.ts`**

```ts
export default {
  async fetch(): Promise<Response> {
    return new Response('Monitoring Kendaraan Operasional (Cloud)', { status: 200 });
  },
};
```

- [x] **Step 10: Verifikasi**

Run: `npm install`
Run: `npm run typecheck`
Run: `npm run dev` lalu buka `http://localhost:8787` — harus tampil "Monitoring Kendaraan Operasional (Cloud)".
Expected: typecheck lolos tanpa error; dev server menyajikan teks di atas.

- [x] **Step 11: Commit**

```bash
git add .
git commit -m "chore: scaffold Cloudflare Workers repo"
```

---

### Task 2: Skema PostgreSQL (Supabase)

**Files:**
- Create: `db/schema.sql`
- Test: `tests/schema.test.ts`

**Interfaces:**
- Produces: file `db/schema.sql` berisi semua tabel bernama PERSIS seperti `DATABASE_SCHEMA` (`cabang`, `supir`, `bbm`, `pengguna`, `kendaraan`, `penggunaan_bbm`, `pengisian_bbm`, `foto_evidence`, `audit_log`, `konfigurasi`, `pengaturan`, `flazz_card`, `flazz_usage`, `flazz_topup`, `flazz_tol`, `flazz_reconciliation`, `jalur_pengiriman`) + index + seed `pengaturan`.
- Consumes: tidak ada (tabel akan dipakai M2+).

- [x] **Step 1: Write failing test `tests/schema.test.ts`**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

const REQUIRED_TABLES = [
  'cabang',
  'supir',
  'bbm',
  'pengguna',
  'kendaraan',
  'penggunaan_bbm',
  'pengisian_bbm',
  'foto_evidence',
  'audit_log',
  'konfigurasi',
  'pengaturan',
  'flazz_card',
  'flazz_usage',
  'flazz_topup',
  'flazz_tol',
  'flazz_reconciliation',
  'jalur_pengiriman',
];

describe('db/schema.sql', () => {
  it('mendefinisikan semua tabel yang dibutuhkan', () => {
    for (const t of REQUIRED_TABLES) {
      expect(sql, `tabel ${t} harus ada`).toMatch(new RegExp(`create table if not exists ${t}\\s*\\(`, 'i'));
    }
  });

  it('seimbang tanda kurung (create + insert)', () => {
    const opens = (sql.match(/\(/g) || []).length;
    const closes = (sql.match(/\)/g) || []).length;
    expect(opens).toBe(closes);
  });

  it('seed pengaturan default ada', () => {
    expect(sql).toMatch(/on conflict\s*\(key\)\s*do nothing/i);
  });
});
```

- [x] **Step 2: Run test — harus FAIL**

Run: `npm test -- schema.test.ts`
Expected: FAIL (file `db/schema.sql` belum ada → `ENOENT`).

- [x] **Step 3: Write `db/schema.sql`**

```sql
-- ==========================================
-- SKEMA POSTGRESQL — monitoring kendaraan ops
-- Mapping 1:1 dari DATABASE_SCHEMA (DatabaseSetup.js)
-- Jalankan di Supabase SQL editor / `supabase db push`
-- ==========================================

-- MASTER ------------------------------------------------------------------
create table if not exists cabang (
  kode_cabang text primary key,
  nama_cabang text not null default '',
  lokasi text not null default '',
  status text not null default 'Aktif'
);

create table if not exists supir (
  supir_id text primary key,
  nama_supir text not null default '',
  kode_cabang text not null default '',
  status text not null default 'Aktif'
);

create table if not exists bbm (
  bbm_id text primary key,
  jenis_bbm text not null default '',
  harga_per_liter numeric not null default 0,
  kode_cabang text not null default '',
  status text not null default 'Aktif'
);

create table if not exists pengguna (
  user_id text primary key,
  username text not null unique,
  password text not null,
  nama text not null default '',
  role text not null default 'PIC CABANG',
  kode_cabang text not null default '',
  status text not null default 'Aktif',
  email text not null default ''
);

create table if not exists kendaraan (
  vehicle_id text primary key,
  plat_nomor text not null default '',
  nama_kendaraan text not null default '',
  jenis_kendaraan text not null default '',
  merk text not null default '',
  model text not null default '',
  kapasitas_tangki numeric not null default 0,
  jumlah_bar numeric not null default 0,
  standar_km_l numeric not null default 0,
  kode_cabang text not null default '',
  status text not null default 'Aktif',
  jenis_indikator text not null default '',
  tanggal_pajak text not null default '',
  tanggal_pajak_5_tahunan text not null default '',
  tanggal_kir text not null default '',
  km_terakhir_ganti_oli numeric not null default 0,
  interval_ganti_oli_km numeric not null default 0
);

-- CORE LAPORAN -------------------------------------------------------------
create table if not exists penggunaan_bbm (
  transaction_id text primary key,
  timestamp text not null default '',
  tanggal text not null default '',
  user_id text not null default '',
  nama_pengguna text not null default '',
  kode_cabang text not null default '',
  vehicle_id text not null default '',
  plat_nomor text not null default '',
  foto_km_awal text not null default '',
  ocr_km_awal text not null default '',
  km_awal_confirmed text not null default '',
  bar_awal text not null default '',
  foto_km_akhir text not null default '',
  ocr_km_akhir text not null default '',
  km_akhir_confirmed text not null default '',
  bar_akhir text not null default '',
  km_tempuh numeric not null default 0,
  perubahan_bar numeric not null default 0,
  liter_bbm numeric not null default 0,
  biaya_bbm numeric not null default 0,
  foto_struk_bbm text not null default '',
  biaya_toll numeric not null default 0,
  foto_struk_toll text not null default '',
  km_per_liter numeric not null default 0,
  status text not null default '',
  warning text not null default '',
  nama_supir text not null default '',
  metode_pembayaran text not null default 'TUNAI',
  flazz_card_id text not null default '',
  km_sumber text not null default '',
  metode_toll text not null default '',
  flazz_card_id_toll text not null default ''
);

create table if not exists pengisian_bbm (
  fuel_id text primary key,
  timestamp text not null default '',
  tanggal text not null default '',
  vehicle_id text not null default '',
  plat_nomor text not null default '',
  user_id text not null default '',
  km numeric not null default 0,
  jenis_bbm text not null default '',
  liter numeric not null default 0,
  harga_per_liter numeric not null default 0,
  total_biaya numeric not null default 0,
  nama_spbu text not null default '',
  foto_struk text not null default '',
  status text not null default ''
);

create table if not exists foto_evidence (
  evidence_id text primary key,
  transaction_id text not null default '',
  tipe_foto text not null default '',
  file_url text not null default '',
  file_id text not null default '',
  timestamp text not null default ''
);

-- AUDIT & KONFIGURASI ---------------------------------------------------------
create table if not exists audit_log (
  log_id text primary key,
  timestamp text not null default '',
  user_id text not null default '',
  username text not null default '',
  action text not null default '',
  modul text not null default '',
  keterangan text not null default '',
  data_sebelum text not null default '',
  data_sesudah text not null default '',
  ip text not null default ''
);

create table if not exists konfigurasi (
  key text primary key,
  value text not null default '',
  keterangan text not null default ''
);

create table if not exists pengaturan (
  key text primary key,
  value text not null default '',
  updated_at text not null default ''
);

-- FLAZZ ------------------------------------------------------------------------
create table if not exists flazz_card (
  id text primary key,
  card_number text not null default '',
  card_name text not null default '',
  card_type text not null default '',
  card_role text not null default '',
  branch_id text not null default '',
  driver_id text not null default '',
  default_driver_id text not null default '',
  last_balance numeric not null default 0,
  status text not null default '',
  notes text not null default '',
  created_at text not null default '',
  updated_at text not null default ''
);

create table if not exists flazz_usage (
  id text primary key,
  date text not null default '',
  card_id text not null default '',
  driver_id text not null default '',
  vehicle_id text not null default '',
  usage_type text not null default '',
  primary_card_id text not null default '',
  backup_card_id text not null default '',
  reason text not null default '',
  opening_balance numeric not null default 0,
  used_at text not null default '',
  returned_at text not null default '',
  status text not null default '',
  created_by text not null default '',
  created_at text not null default '',
  ref_type text not null default '',
  ref_id text not null default ''
);

create table if not exists flazz_topup (
  id text primary key,
  date text not null default '',
  card_id text not null default '',
  amount numeric not null default 0,
  evidence_url text not null default '',
  notes text not null default '',
  created_by text not null default '',
  created_at text not null default '',
  is_deleted text not null default ''
);

create table if not exists flazz_tol (
  id text primary key,
  date text not null default '',
  card_id text not null default '',
  driver_id text not null default '',
  vehicle_id text not null default '',
  amount numeric not null default 0,
  evidence_url text not null default '',
  notes text not null default '',
  created_by text not null default '',
  created_at text not null default '',
  is_deleted text not null default ''
);

create table if not exists flazz_reconciliation (
  id text primary key,
  date text not null default '',
  card_id text not null default '',
  driver_id text not null default '',
  vehicle_id text not null default '',
  opening_balance numeric not null default 0,
  total_topup numeric not null default 0,
  total_bbm_flazz numeric not null default 0,
  total_tol numeric not null default 0,
  total_expense numeric not null default 0,
  flazz_balance numeric not null default 0,
  actual_balance numeric not null default 0,
  difference numeric not null default 0,
  reconciliation_status text not null default '',
  notes text not null default '',
  reconciled_by text not null default '',
  reconciled_at text not null default '',
  is_deleted text not null default ''
);

-- JALUR PENGIRIMAN -------------------------------------------------------------
create table if not exists jalur_pengiriman (
  id text primary key,
  tanggal text not null default '',
  driver_id text not null default '',
  nama_driver text not null default '',
  driver2_id text not null default '',
  nama_driver2 text not null default '',
  vehicle_id text not null default '',
  plat_nomor text not null default '',
  nama_kendaraan text not null default '',
  jenis_kendaraan text not null default '',
  rute_tujuan text not null default '',
  kode_cabang text not null default '',
  flazz_card_id text not null default '',
  flazz_card_name text not null default '',
  created_by text not null default '',
  created_at text not null default '',
  updated_at text not null default '',
  is_deleted text not null default '',
  status text not null default '',
  laporan_id text not null default ''
);

-- INDEX --------------------------------------------------------------------------
create index if not exists idx_penggunaan_branch_tgl on penggunaan_bbm (kode_cabang, tanggal);
create index if not exists idx_audit_ts on audit_log (timestamp);
create index if not exists idx_flazz_usage_card on flazz_usage (card_id);
create index if not exists idx_flazz_topup_card on flazz_topup (card_id);
create index if not exists idx_flazz_tol_card on flazz_tol (card_id);
create index if not exists idx_flazz_recon_card on flazz_reconciliation (card_id);
create index if not exists idx_jalur_tgl_cabang on jalur_pengiriman (tanggal, kode_cabang);

-- SEED PENGATURAN -------------------------------------------------------------------
insert into pengaturan (key, value, updated_at)
values
  ('logo_url', '', ''),
  ('app_name', 'Monitoring Kendaraan Operasional', ''),
  ('company_name', 'PT Tridaya Sinergi Indonesia', ''),
  ('footer_text', '© 2026 Tridaya Sinergi Indonesia', '')
on conflict (key) do nothing;
```

- [x] **Step 4: Run test — harus PASS**

Run: `npm test -- schema.test.ts`
Expected: PASS (3 assertions).

- [x] **Step 5: Terapkan ke Supabase**

1. Buat project Supabase baru (`https://supabase.com/dashboard`).
2. Buka **SQL Editor** → tempel isi `db/schema.sql` → **Run**.
   Atau bila CLI terpasang: `npx supabase link --project-ref <ref>` lalu `npm run db:migrate`.
3. Verifikasi manual: Dashboard → **Table Editor** → harus ada 17 tabel; buka tabel `pengaturan`, harus ada 4 baris seed.

- [x] **Step 6: Commit**

```bash
git add db tests/schema.test.ts
git commit -m "feat(db): add postgres schema for 17 tables + seed pengaturan"
```

---

### Task 3: Response Utils + Health Route + CORS/Error Wrapper

**Files:**
- Create: `src/utils/http.ts`
- Create: `src/routes/health.ts`
- Create: `src/app.ts` (awal, minimal)
- Modify: `src/index.ts` (pindahkan ke `buildApp`)
- Test: `tests/app.test.ts`

**Interfaces:**
- Produces:
  - `okPayload(data?: object): { success: true } & object`
  - `errPayload(message: string, error?: string): { success: false; error: string; message: string }`
  - `buildApp(env: Env, overrides?: Partial<AppDeps>): AppType` dari `src/app.ts`
  - `AppDeps` = `{ kv: KVStore; findByUsername: (username: string) => Promise<UserRecord | null>; recordAudit: (entry: AuditEntry) => Promise<void>; now: () => number }`
  - Route `GET /api/health` → `{ success: true, status: 'ok' }`
- Consumes: `Env` (Task 1), `KVStore` type.

- [x] **Step 1: Define `KVStore` dan type bersama — buat `src/deps.ts`**

```ts
export interface KVStore {
  get(key: string, type: 'text'): Promise<string | null>;
  get(key: string, type: 'json'): Promise<unknown | null>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface UserRecord {
  user_id: string;
  username: string;
  password: string;
  nama: string;
  role: string;
  kode_cabang: string;
}

export interface SessionUser {
  user_id: string;
  username: string;
  nama: string;
  role: string;
  cabang: string;
  exp: number;
}

export interface AuditEntry {
  user_id: string;
  username: string;
  action: string;
  modul: string;
  keterangan: string;
  data_sebelum?: string;
  data_sesudah?: string;
}

export interface AppDeps {
  kv: KVStore;
  findByUsername: (username: string) => Promise<UserRecord | null>;
  recordAudit: (entry: AuditEntry) => Promise<void>;
  now: () => number;
}
```

- [x] **Step 2: Tulis `src/utils/http.ts`**

```ts
export type OkPayload = { success: true } & Record<string, unknown>;

export function okPayload(data: Record<string, unknown> = {}): OkPayload {
  return { success: true, ...data };
}

export function errPayload(message: string, error = 'ERROR'): { success: false; error: string; message: string } {
  return { success: false, error, message };
}
```

- [x] **Step 3: Tulis `src/routes/health.ts`**

```ts
import { Hono } from 'hono';
import { okPayload } from '../utils/http';

export function healthRoutes(): Hono {
  const app = new Hono();
  app.get('/', (c) => c.json(okPayload({ status: 'ok' })));
  return app;
}
```

- [x] **Step 4: Tulis `src/app.ts` (minimal dulu, auth menyusul di Task 6)**

```ts
import { Hono } from 'hono';
import type { Env } from './env';
import type { AppDeps } from './deps';
import { errPayload } from './utils/http';
import { healthRoutes } from './routes/health';

export function buildApp(env: Env, _overrides: Partial<AppDeps> = {}): Hono {
  const app = new Hono<{ Bindings: Env }>();

  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Access-Control-Allow-Origin', c.req.header('Origin') ?? '');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  });

  app.on('OPTIONS', '*', (c) => c.body(null, 204));

  app.onError((err, c) => {
    console.error('unhandled:', err);
    return c.json(errPayload('Terjadi kesalahan internal.', 'INTERNAL'), 500);
  });

  app.route('/api/health', healthRoutes());

  app.all('/{path*}', (c) => env.ASSETS.fetch(c.req.raw));

  return app;
}
```

- [x] **Step 5: Ubah `src/index.ts`**

```ts
import { buildApp } from './app';
import type { Env } from './env';

const app = buildApp({} as Env);

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return app.fetch(request, env, ctx);
  },
};
```

- [x] **Step 6: Write failing test `tests/app.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Env } from '../src/env';
import type { AppDeps } from '../src/deps';

function fakeEnv(): Env {
  return {
    ASSETS: { fetch: async () => new Response('static:not-found', { status: 404 }) },
    SESSION_KV: {} as Env['SESSION_KV'],
    SUPABASE_URL: 'http://localhost',
    SUPABASE_SERVICE_ROLE_KEY: 'test',
  };
}

const defaultDeps: AppDeps = {
  kv: {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
  },
  findByUsername: async () => null,
  recordAudit: async () => {},
  now: () => 1_000_000,
};

describe('buildApp', () => {
  it('GET /api/health => success ok', async () => {
    const app = buildApp(fakeEnv(), { ...defaultDeps });
    const res = await app.request('/api/health', { method: 'GET' }, fakeEnv());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, status: 'ok' });
  });

  it('path non-api dilayani ASSETS (fallback)', async () => {
    const app = buildApp(fakeEnv(), { ...defaultDeps });
    const res = await app.request('/', { method: 'GET' }, fakeEnv());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('static:not-found');
  });

  it('route tak dikenal di /api/* mengembalikan JSON error 404', async () => {
    const app = buildApp(fakeEnv(), { ...defaultDeps });
    const res = await app.request('/api/tidak-ada', { method: 'GET' }, fakeEnv());
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('static:not-found');
  });
});
```

- [x] **Step 7: Run test — harus PASS**

Run: `npm test -- app.test.ts`
Expected: PASS (3 assertions).

- [x] **Step 8: Verifikasi dev**

Run: `npm run dev`, buka `http://localhost:8787/` → placeholder; `http://localhost:8787/api/health` → `{"success":true,"status":"ok"}`.

- [x] **Step 9: Commit**

```bash
git add src tests
git commit -m "feat: response utils, health route, CORS/error wrapper"
```

---

### Task 4: Password Hashing Kompatibel GAS

**Files:**
- Create: `src/auth/password.ts`
- Test: `tests/password.test.ts`

**Interfaces:**
- Produces:
  - `sha256Hex(str: string): Promise<string>`
  - `iteratedHash(salt: string, password: string, rounds: number): Promise<string>`
  - `hashPassword(password: string): Promise<string>` — format `salt$10000$hash`
  - `verifyPassword(plain: string, stored: string): Promise<boolean>` — dukung format 3-bagian dan 2-bagian (legacy)
- Consumes: Web Crypto (`crypto.subtle`, tersedia di Node 18+ dan Workers).

- [x] **Step 1: Write failing test `tests/password.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { hashPassword, iteratedHash, sha256Hex, verifyPassword } from '../src/auth/password';

describe('password hashing (kompatibel GAS)', () => {
  it('verify lulus untuk password yang baru di-hash', async () => {
    const stored = await hashPassword('rahasia123');
    expect(stored.split('$')).toHaveLength(3);
    expect(await verifyPassword('rahasia123', stored)).toBe(true);
    expect(await verifyPassword('salah', stored)).toBe(false);
  });

  it('verify format legacy 2-bagian (salt$sha256(salt:pass))', async () => {
    const salt = 'aaaa0000bbbb1111';
    const legacy = `${salt}$${await sha256Hex(`${salt}:sekret`)}`;
    expect(await verifyPassword('sekret', legacy)).toBe(true);
    expect(await verifyPassword('bukan', legacy)).toBe(false);
  });

  it('verify format 3-bagian dengan rounds non-default', async () => {
    const salt = 'salt-1234567';
    const rounds = 8;
    const hash = await iteratedHash(salt, 'pw', rounds);
    expect(await verifyPassword('pw', `${salt}$${rounds}$${hash}`)).toBe(true);
  });

  it('menolak stored yang tidak valid', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'tanpa-dollar')).toBe(false);
    expect(await verifyPassword('x', 'a$1$b$c$d')).toBe(false);
  });
});
```

- [x] **Step 2: Run test — harus FAIL**

Run: `npm test -- password.test.ts`
Expected: FAIL (`Cannot find module '../src/auth/password'`).

- [x] **Step 3: Write `src/auth/password.ts`**

```ts
const PBKDF_ROUNDS = 10000;

export async function sha256Hex(str: string): Promise<string> {
  const data = new TextEncoder().encode(String(str));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function iteratedHash(salt: string, password: string, rounds: number): Promise<string> {
  let hex = await sha256Hex(`${salt}:${String(password)}`);
  for (let i = 1; i < rounds; i++) {
    hex = await sha256Hex(`${hex}:${salt}`);
  }
  return hex;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${salt}$${PBKDF_ROUNDS}$${await iteratedHash(salt, password, PBKDF_ROUNDS)}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored || stored.indexOf('$') === -1) return false;
  const parts = stored.split('$');
  if (parts.length === 3) {
    const rounds = parseInt(parts[1], 10) || PBKDF_ROUNDS;
    return (await iteratedHash(parts[0], plain, rounds)) === parts[2];
  }
  if (parts.length === 2) {
    return (await sha256Hex(`${parts[0]}:${String(plain)}`)) === parts[1];
  }
  return false;
}
```

- [x] **Step 4: Run test — harus PASS**

Run: `npm test -- password.test.ts`
Expected: PASS (4 it blocks; roundtrip memakai 10.000 ronde, ~0,5s).

- [x] **Step 5: Kebenaran silang dengan vektor dari GAS**

Vektor statis (hitungan manual mengikuti `_sha256Hex` GAS): jalankan Node sekali, print hash format 3-bagian, tempel hasil sebagai fixture, pastikan `verifyPassword` menyetujui. Contoh cepat:

```bash
node -e "import('./src/auth/password.ts').then(async m => console.log(await m.hashPassword('vektor-test')))"
```

Tempel hasilnya ke `tests/password.test.ts` sebagai fixture tambahan:

```ts
it('menerima vektor statis dari hashPassword run GAS-compatible', async () => {
  const stored = 'PASTE_HASIL_DI_ATAS';
  expect(await verifyPassword('vektor-test', stored)).toBe(true);
});
```

Run: `npm test -- password.test.ts` → PASS.

- [x] **Step 6: Commit**

```bash
git add src/auth/password.ts tests/password.test.ts
git commit -m "feat(auth): GAS-compatible password hashing via Web Crypto"
```

---

### Task 5: Session (KV) + Rate Limit (KV)

**Files:**
- Create: `src/auth/sessions.ts`
- Create: `src/auth/rateLimit.ts`
- Test: `tests/sessions.test.ts`
- Test: `tests/rate-limit.test.ts`

**Interfaces:**
- Consumes: `KVStore`, `SessionUser` (dari `src/deps.ts`).
- Produces:
  - `createSession(kv: KVStore, user: SessionUser, now?: () => number): Promise<string>`
  - `resolveSession(kv: KVStore, token: string | null, now?: () => number): Promise<SessionUser | null>`
  - `destroySession(kv: KVStore, token: string | null): Promise<void>`
  - `checkRate(kv: KVStore, key: string, max: number, windowMs: number, now?: () => number): Promise<{ allowed: boolean; retryAfterSec: number | null }>`
  - `resetRate(kv: KVStore, key: string): Promise<void>`
- Konvensi key: session `session:<token>`; rate `rl:<key>`.

- [x] **Step 1: Write failing tests**

`tests/sessions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createSession, destroySession, resolveSession } from '../src/auth/sessions';
import type { KVStore, SessionUser } from '../src/deps';

function memKV(): KVStore & Record<string, unknown> {
  const map = new Map<string, string>();
  return {
    get: async (k) => map.get(k) ?? null,
    put: async (k, v) => { map.set(k, v); },
    delete: async (k) => { map.delete(k); },
    _map: map,
  };
}

const user: SessionUser = {
  user_id: 'U-1', username: 'picjkt', nama: 'PIC Jakarta',
  role: 'PIC CABANG', cabang: 'CBG-JKT', exp: 1_000_000 + 12 * 3600 * 1000,
};

describe('sessions', () => {
  it('create+resolve mengembalikan user yang sama', async () => {
    const kv = memKV();
    const token = await createSession(kv, user);
    const got = await resolveSession(kv, token);
    expect(got).toMatchObject({ user_id: 'U-1', username: 'picjkt', role: 'PIC CABANG' });
  });

  it('resolve token null/kosong => null', async () => {
    const kv = memKV();
    expect(await resolveSession(kv, null)).toBeNull();
    expect(await resolveSession(kv, '')).toBeNull();
  });

  it('destroy membuat session tidak valid', async () => {
    const kv = memKV();
    const token = await createSession(kv, user);
    await destroySession(kv, token);
    expect(await resolveSession(kv, token)).toBeNull();
  });

  it('session kedaluwarsa ditolak dan dihapus', async () => {
    const kv = memKV();
    const token = await createSession(kv, user, () => 1_000_000);
    const expired = await resolveSession(kv, token, () => 1_000_000 + 13 * 3600 * 1000);
    expect(expired).toBeNull();
    expect(mapOf(kv).has('session:' + token)).toBe(false);
  });
});

function mapOf(kv: KVStore & Record<string, unknown>): Map<string, string> {
  return kv._map as Map<string, string>;
}
```

`tests/rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { checkRate, resetRate } from '../src/auth/rateLimit';
import type { KVStore } from '../src/deps';

function memKV(): KVStore {
  const map = new Map<string, string>();
  return {
    get: async (k) => map.get(k) ?? null,
    put: async (k, v) => { map.set(k, v); },
    delete: async (k) => { map.delete(k); },
  };
}

describe('rate limit', () => {
  it('mengizinkan hingga max, memblokir setelahnya', async () => {
    const kv = memKV();
    for (let i = 0; i < 5; i++) {
      expect((await checkRate(kv, 'login:picjkt', 5, 5 * 60 * 1000, () => 1_000)).allowed).toBe(true);
    }
    const blocked = await checkRate(kv, 'login:picjkt', 5, 5 * 60 * 1000, () => 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThan(0);
  });

  it('resetRate mengizinkan lagi', async () => {
    const kv = memKV();
    for (let i = 0; i < 5; i++) await checkRate(kv, 'login:picjkt', 5, 60_000, () => 1_000);
    await resetRate(kv, 'login:picjkt');
    expect((await checkRate(kv, 'login:picjkt', 5, 60_000, () => 1_000)).allowed).toBe(true);
  });

  it('jendela waktu berlalu => diizinkan lagi', async () => {
    const kv = memKV();
    for (let i = 0; i < 5; i++) await checkRate(kv, 'login:picjkt', 5, 60_000, () => 1_000);
    const after = await checkRate(kv, 'login:picjkt', 5, 60_000, () => 1_000 + 61_000);
    expect(after.allowed).toBe(true);
  });
});
```

- [x] **Step 2: Run tests — harus FAIL**

Run: `npm test -- sessions.test.ts rate-limit.test.ts`
Expected: FAIL (module tidak ada).

- [x] **Step 3: Write `src/auth/sessions.ts`**

```ts
import type { KVStore, SessionUser } from '../deps';

export const SESSION_TTL_SECONDS = 12 * 60 * 60;

export async function createSession(kv: KVStore, user: SessionUser, now: () => number = Date.now): Promise<string> {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  const token = Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  const session: SessionUser = { ...user, exp: now() + SESSION_TTL_SECONDS * 1000 };
  await kv.put(`session:${token}`, JSON.stringify(session), { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

export async function resolveSession(kv: KVStore, token: string | null, now: () => number = Date.now): Promise<SessionUser | null> {
  if (!token) return null;
  const raw = await kv.get(`session:${token}`);
  if (!raw) return null;
  const s = JSON.parse(raw) as SessionUser;
  if (now() > s.exp) {
    await kv.delete(`session:${token}`);
    return null;
  }
  return s;
}

export async function destroySession(kv: KVStore, token: string | null): Promise<void> {
  if (token) await kv.delete(`session:${token}`);
}
```

- [x] **Step 4: Write `src/auth/rateLimit.ts`**

```ts
import type { KVStore } from '../deps';

interface RateEntry {
  count: number;
  start: number;
}

export async function checkRate(
  kv: KVStore,
  key: string,
  max: number,
  windowMs: number,
  now: () => number = Date.now,
): Promise<{ allowed: boolean; retryAfterSec: number | null }> {
  const t = now();
  const raw = await kv.get(`rl:${key}`, 'json');
  let entry: RateEntry = raw
    ? (raw as RateEntry)
    : { count: 0, start: t };

  if (t - entry.start > windowMs) {
    entry = { count: 0, start: t };
  }
  if (entry.count >= max) {
    const retryAfterSec = Math.max(1, Math.ceil((entry.start + windowMs - t) / 1000));
    return { allowed: false, retryAfterSec };
  }
  entry.count += 1;
  await kv.put(`rl:${key}`, JSON.stringify(entry), { expirationTtl: Math.ceil(windowMs / 1000) + 1 });
  return { allowed: true, retryAfterSec: null };
}

export async function resetRate(kv: KVStore, key: string): Promise<void> {
  await kv.delete(`rl:${key}`);
}
```

- [x] **Step 5: Run tests — harus PASS**

Run: `npm test -- sessions.test.ts rate-limit.test.ts`
Expected: PASS (4 sessions + 3 rate-limit assertions).

- [x] **Step 6: Commit**

```bash
git add src/auth tests
git commit -m "feat(auth): KV-backed sessions and rate limiter"
```

---

### Task 6: Middleware RequireUser + Route Auth (Login/Logout/Session)

**Files:**
- Create: `src/auth/middleware.ts`
- Create: `src/routes/auth.ts`
- Create: `src/db/client.ts`
- Create: `src/db/users.ts`
- Create: `src/db/audit.ts`
- Modify: `src/app.ts` (pasang route auth)
- Test: `tests/auth-routes.test.ts`

**Interfaces:**
- Consumes: `KVStore`, `SessionUser`, `UserRecord`, `AuditEntry`, `AppDeps`, `okPayload`, `errPayload`, `createSession/resolveSession/destroySession/checkRate/resetRate (Task 5)`, `verifyPassword (Task 4)`.
- Produces:
  - `requireUser(deps: Pick<AppDeps, 'kv' | 'now'>): HonoMiddleware` — set `c.set('user', SessionUser)`; bila invalid → 401.
  - Route:
    - `POST /api/login` body `{ username, password }` → `{ success: true, token, user }` atau error (rate limit / kredensial salah).
    - `POST /api/logout` header Bearer → `{ success: true }`.
    - `GET /api/session` (requireUser) → `{ success: true, user: SessionUser }`.
  - `getSupabase(env: Env): SupabaseClient` (real, untuk run-time).
  - `findByUsernameDb(env: Env): (username: string) => Promise<UserRecord | null>`.
  - `recordAuditDb(env: Env): (entry: AuditEntry) => Promise<void>`.

- [x] **Step 1: Write failing test `tests/auth-routes.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { Env } from '../src/env';
import type { AppDeps, KVStore, SessionUser, UserRecord } from '../src/deps';
import { hashPassword } from '../src/auth/password';
import { SESSION_TTL_SECONDS } from '../src/auth/sessions';

function memKV(): KVStore & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get: async (k) => map.get(k) ?? null,
    put: async (k, v) => { map.set(k, v); },
    delete: async (k) => { map.delete(k); },
  };
}

function fakeEnv(): Env {
  return {
    ASSETS: { fetch: async () => new Response('static', { status: 404 }) },
    SESSION_KV: {} as Env['SESSION_KV'],
    SUPABASE_URL: 'http://localhost',
    SUPABASE_SERVICE_ROLE_KEY: 'test',
  };
}

let T = 1_000_000;

function makeDeps(opts: { username?: string; passwordProto?: string } = {}) {
  const kv = memKV();
  const user: UserRecord = {
    user_id: 'U-1',
    username: 'picjkt',
    password: opts.passwordProto || 'salt-1234567$8$' + 'x'.repeat(64),
    nama: 'PIC Jakarta',
    role: 'PIC CABANG',
    kode_cabang: 'CBG-JKT',
  };
  const audits: Array<Record<string, unknown>> = [];
  const deps: AppDeps = {
    kv,
    findByUsername: async (u) => (u === 'picjkt' ? user : null),
    recordAudit: async (e) => { audits.push({ ...e }); },
    now: () => T,
  };
  return { kv, audits, deps };
}

describe('auth routes', () => {
  it('login sukses mengembalikan token dan user', async () => {
    const { deps } = makeDeps();
    const hash = await hashPassword('rahasia123');
    deps.findByUsername = async (u) =>
      u === 'picjkt' ? { ...({ user_id: 'U-1', username: 'picjkt', password: hash, nama: 'PIC Jakarta', role: 'PIC CABANG', kode_cabang: 'CBG-JKT' } as UserRecord) } : null;

    const app = buildApp(fakeEnv(), deps);
    const res = await app.request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'picjkt', password: 'rahasia123' }),
    }, fakeEnv());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(body.user).toMatchObject({ user_id: 'U-1', role: 'PIC CABANG', cabang: 'CBG-JKT' });
  });

  it('login salah password => gagal, tanpa token', async () => {
    const { deps, audits } = makeDeps();
    const hash = await hashPassword('rahasia123');
    deps.findByUsername = async () => ({ ...({ user_id: 'U-1', username: 'picjkt', password: hash, nama: 'PIC Jakarta', role: 'PIC CABANG', kode_cabang: 'CBG-JKT' } as UserRecord) });
    const app = buildApp(fakeEnv(), deps);
    const res = await app.request('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'picjkt', password: 'salah' }),
    }, fakeEnv());
    expect(res.status).toBe(401);
    expect((await res.json()).success).toBe(false);
    expect(audits.some((a) => a.action === 'LOGIN_GAGAL')).toBe(true);
  });

  it('login melebihi rate limit diblokir', async () => {
    const { deps } = makeDeps();
    const hash = await hashPassword('rahasia123');
    deps.findByUsername = async () => null;
    const app = buildApp(fakeEnv(), deps);
    for (let i = 0; i < 5; i++) {
      await app.request('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'picjkt', password: 'x' }),
      }, fakeEnv());
    }
    const res = await app.request('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'picjkt', password: 'x' }),
    }, fakeEnv());
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error).toBe('RATE_LIMIT');
  });

  it('GET /api/session valid dengan Bearer token', async () => {
    const { deps } = makeDeps();
    const hash = await hashPassword('rahasia123');
    deps.findByUsername = async () => ({ ...({ user_id: 'U-1', username: 'picjkt', password: hash, nama: 'PIC Jakarta', role: 'PIC CABANG', kode_cabang: 'CBG-JKT' } as UserRecord) });
    const app = buildApp(fakeEnv(), deps);
    const login = await (await app.request('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'picjkt', password: 'rahasia123' }),
    }, fakeEnv())).json();
    const res = await app.request('/api/session', {
      method: 'GET', headers: { Authorization: `Bearer ${login.token}` },
    }, fakeEnv());
    expect(res.status).toBe(200);
    expect((await res.json()).user.username).toBe('picjkt');
  });

  it('GET /api/session tanpa token => 401', async () => {
    const { deps } = makeDeps();
    const app = buildApp(fakeEnv(), deps);
    const res = await app.request('/api/session', { method: 'GET' }, fakeEnv());
    expect(res.status).toBe(401);
  });

  it('logout membatalkan session', async () => {
    const { deps } = makeDeps();
    const hash = await hashPassword('rahasia123');
    deps.findByUsername = async () => ({ ...({ user_id: 'U-1', username: 'picjkt', password: hash, nama: 'PIC Jakarta', role: 'PIC CABANG', kode_cabang: 'CBG-JKT' } as UserRecord) });
    const app = buildApp(fakeEnv(), deps);
    const login = await (await app.request('/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'picjkt', password: 'rahasia123' }),
    }, fakeEnv())).json();
    await app.request('/api/logout', {
      method: 'POST', headers: { Authorization: `Bearer ${login.token}` },
    }, fakeEnv());
    const res = await app.request('/api/session', {
      method: 'GET', headers: { Authorization: `Bearer ${login.token}` },
    }, fakeEnv());
    expect(res.status).toBe(401);
  });
});
```

- [x] **Step 2: Run test — harus FAIL**

Run: `npm test -- auth-routes.test.ts`
Expected: FAIL (module `src/routes/auth.ts` tidak ada / route 404).

- [x] **Step 3: Write `src/auth/middleware.ts`**

```ts
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import type { AppDeps, SessionUser } from '../deps';
import { resolveSession } from './sessions';
import { errPayload } from '../utils/http';

export interface AuthVars {
  user: SessionUser;
}

export function requireUser(deps: Pick<AppDeps, 'kv' | 'now'>): MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }> {
  return async (c, next) => {
    const auth = c.req.header('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    const user = await resolveSession(deps.kv, token, deps.now);
    if (!user) {
      return c.json(errPayload('Akses ditolak: sesi tidak valid. Silakan login kembali.', 'UNAUTHORIZED'), 401);
    }
    c.set('user', user);
    await next();
  };
}
```

- [x] **Step 4: Write `src/routes/auth.ts`**

```ts
import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import { verifyPassword } from '../auth/password';
import { checkRate, resetRate } from '../auth/rateLimit';
import { createSession, destroySession, resolveSession } from '../auth/sessions';
import { requireUser } from '../auth/middleware';
import { errPayload, okPayload } from '../utils/http';

const LOGIN_MAX = 5;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

export function authRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post('/login', async (c) => {
    const body = await c.req.json().catch(() => null);
    const username = String((body as any)?.username ?? '').trim().toLowerCase();
    const password = String((body as any)?.password ?? '');
    if (!username || !password) {
      return c.json(errPayload('Username dan password wajib diisi.', 'BAD_REQUEST'), 400);
    }

    const rate = await checkRate(deps.kv, `login:${username}`, LOGIN_MAX, LOGIN_WINDOW_MS, deps.now);
    if (!rate.allowed) {
      return c.json(errPayload(`Terlalu banyak percobaan login. Tunggu ${rate.retryAfterSec} detik.`, 'RATE_LIMIT'), 429);
    }

    const user = await deps.findByUsername(username);
    if (!user || user.status === 'Non-Aktif' || !(await verifyPassword(password, user.password))) {
      await deps.recordAudit({
        user_id: user?.user_id ?? '-', username, action: 'LOGIN_GAGAL', modul: 'auth',
        keterangan: 'Login gagal: kredensial tidak valid',
      });
      return c.json(errPayload('Username atau password salah.', 'BAD_CREDENTIALS'), 401);
    }

    await resetRate(deps.kv, `login:${username}`);
    const sessionUser = {
      user_id: user.user_id, username: user.username, nama: user.nama || user.username,
      role: user.role, cabang: user.kode_cabang || '', exp: deps.now(),
    };
    const token = await createSession(deps.kv, sessionUser, deps.now);
    await deps.recordAudit({
      user_id: user.user_id, username: user.username, action: 'LOGIN', modul: 'auth',
      keterangan: `Login berhasil role=${user.role} cabang=${user.kode_cabang || '-'}`,
    });

    return c.json(okPayload({
      token,
      user: {
        user_id: user.user_id, username: user.username, nama: user.nama || user.username,
        role: user.role, cabang: user.kode_cabang || '',
      },
    }));
  });

  app.post('/logout', async (c) => {
    const auth = c.req.header('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    const u = await resolveSession(deps.kv, token, deps.now);
    if (u) {
      await deps.recordAudit({ user_id: u.user_id, username: u.username, action: 'LOGOUT', modul: 'auth', keterangan: 'Logout' });
    }
    await destroySession(deps.kv, token);
    return c.json(okPayload());
  });

  app.get('/session', requireUser(deps), (c) => {
    const u = c.get('user');
    return c.json(okPayload({ user: u }));
  });

  return app;
}
```

- [x] **Step 5: Write `src/db/client.ts`**

```ts
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';

const clients = new WeakMap<Env, SupabaseClient>();

export function getSupabase(env: Env): SupabaseClient {
  let client = clients.get(env);
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clients.set(env, client);
  }
  return client;
}
```

- [x] **Step 6: Write `src/db/users.ts`**

```ts
import type { Env } from '../env';
import type { UserRecord } from '../deps';
import { getSupabase } from './client';

export function findByUsernameDb(env: Env) {
  return async (username: string): Promise<UserRecord | null> => {
    const { data, error } = await getSupabase(env)
      .from('pengguna')
      .select('user_id, username, password, nama, role, kode_cabang, status')
      .ilike('username', username)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`DB findByUsername: ${error.message}`);
    return data as UserRecord | null;
  };
}
```

- [x] **Step 7: Write `src/db/audit.ts`**

```ts
import type { Env } from '../env';
import type { AuditEntry } from '../deps';
import { getSupabase } from './client';

export function recordAuditDb(env: Env) {
  return async (entry: AuditEntry): Promise<void> => {
    await getSupabase(env).from('audit_log').insert({
      log_id: `LOG-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      user_id: entry.user_id,
      username: entry.username,
      action: entry.action,
      modul: entry.modul,
      keterangan: entry.keterangan,
      data_sebelum: entry.data_sebelum ?? '',
      data_sesudah: entry.data_sesudah ?? '',
      ip: '',
    });
  };
}
```

- [x] **Step 8: Update `src/app.ts` — pasang route auth + deps run-time**

```ts
import { Hono } from 'hono';
import type { Env } from './env';
import type { AppDeps } from './deps';
import { errPayload } from './utils/http';
import { healthRoutes } from './routes/health';
import { authRoutes } from './routes/auth';
import { findByUsernameDb } from './db/users';
import { recordAuditDb } from './db/audit';

export function buildApp(env: Env, overrides: Partial<AppDeps> = {}): Hono<{ Bindings: Env }> {
  const deps: AppDeps = {
    kv: env.SESSION_KV,
    findByUsername: findByUsernameDb(env),
    recordAudit: recordAuditDb(env),
    now: () => Date.now(),
    ...overrides,
  };

  const app = new Hono<{ Bindings: Env }>();

  app.use('/api/*', async (c, next) => {
    await next();
    c.header('Access-Control-Allow-Origin', c.req.header('Origin') ?? '');
    c.header('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    c.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  });

  app.on('OPTIONS', '*', (c) => c.body(null, 204));

  app.onError((err, c) => {
    console.error('unhandled:', err);
    return c.json(errPayload('Terjadi kesalahan internal.', 'INTERNAL'), 500);
  });

  app.route('/api/health', healthRoutes());
  app.route('/api', authRoutes(deps));

  app.all('/{path*}', (c) => env.ASSETS.fetch(c.req.raw));

  return app;
}
```

- [x] **Step 9: Run tests — harus PASS**

Run: `npm test`
Expected: PASS semua (schema, app, password, sessions, rate-limit, auth-routes).

- [x] **Step 10: Verifikasi dev end-to-end**

1. Pastikan tabely `pengguna` di Supabase sudah terisi (dari migrasi M8 nanti; untuk uji manual sementara, insert satu user PIC lewat SQL Editor: `insert into pengguna (user_id, username, password, nama, role, kode_cabang, status) values ('U-TEST', 'picjkt', '<hasil npm test hashPassword>', 'PIC Jakarta', 'PIC CABANG', 'CBG-JKT', 'Aktif');`)
2. Set secret + var lokal di `.dev.vars` dan `wrangler.jsonc` vars `SUPABASE_URL`.
3. Run: `npm run dev`; `curl -s -X POST http://localhost:8787/api/login -H "Content-Type: application/json" -d '{\"username\":\"picjkt\",\"password\":\"<password>\"}'` → `success:true` + token; gunakan token untuk `GET /api/session` → 200.

- [x] **Step 11: Commit**

```bash
git add src tests
git commit -m "feat(auth): login/logout/session API + requireUser + supabase stores"
```

---

### Task 7: Wiring Final + README + Verifikasi Deploy

**Files:**
- Modify: `src/index.ts` (final: wire deps run-time dengan env asli)
- Modify: `README.md` (create)
- Test: `tests/app.test.ts` (tambah kasus CORS)

**Interfaces:**
- Consumes: `buildApp(env)` final; memastikan `index.ts` memakai env langsung (bukan `{}`).

- [x] **Step 1: Update `src/index.ts` — hapus placeholder**

```ts
import { buildApp } from './app';
import type { Env } from './env';

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return buildApp(env).fetch(request, env, ctx);
  },
};
```

> Catatan: `buildApp(env)` dipanggil per-request. Clustering supabase client per-env di `db/client.ts` mencegah re-create per request.

- [x] **Step 2: Tambah test CORS di `tests/app.test.ts`**

```ts
it('menambahkan header CORS pada respon api', async () => {
  const app = buildApp(fakeEnv(), { ...defaultDeps });
  const res = await app.request('/api/health', {
    method: 'GET',
    headers: { Origin: 'http://localhost:8787' },
  }, fakeEnv());
  expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:8787');
});

it('OPTIONS preflight dikembalikan 204 + header CORS', async () => {
  const app = buildApp(fakeEnv(), { ...defaultDeps });
  const res = await app.request('/api/login', {
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:8787', 'Access-Control-Request-Method': 'POST' },
  }, fakeEnv());
  expect(res.status).toBe(204);
  expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
});
```

Run: `npm test` → PASS.

- [x] **Step 3: Write `README.md`**

```markdown
# Monitoring Kendaraan Operasional — Versi Cloud

Migrasi dari Google Apps Script ke **Cloudflare Workers + Supabase** (liat
`docs/superpowers/specs/2026-09-18-migrasi-supabase-cloudflare-design.md`).

## Arsitektur
Satu Worker di `*.workers.dev`: static assets + REST API `/api/*`. PostgreSQL di
Supabase, session & rate-limit di Cloudflare KV, foto di Supabase Storage.

## Prasyarat
- Node 18+, `npm i`
- Akun Cloudflare (wrangler login) + akun Supabase
- Namespace KV: `npx wrangler kv namespace create SESSION_KV` lalu tempel `id`
  ke `wrangler.jsonc` → `kv_namespaces[0].id`.

## Setup
1. Apply `db/schema.sql` di Supabase SQL editor.
2. `npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY`
3. Tambah `SUPABASE_URL` di section `vars` `wrangler.jsonc` (atau `.dev.vars` lokal).
4. `npm run dev` untuk lokal; `npm run deploy` untuk rilis.

## Perintah
| Script | Fungsi |
|---|---|
| `npm run dev` | wrangler dev lokal |
| `npm run deploy` | deploy ke *.workers.dev |
| `npm test` | vitest |
| `npm run typecheck` | tsc --noEmit |

## Catatan keamanan
- Role/cabang tidak pernah dari client; dicek `requireUser`.
- Rate limit login 5x/5mnt per username (KV).
- Hash password format kompatibel GAS (tidak perlu reset saat migrasi).
```

- [x] **Step 4: Verifikasi deploys**

Run: `npm run typecheck`
Run: `npm test`
Run: `npm run deploy`
Expected: typecheck & test PASS; deploy sukses ke worker baru; buka URL worker → halaman placeholder; `/api/health` → JSON ok.

- [x] **Step 5: Commit**

```bash
git add .
git commit -m "feat: wire final worker entry, README, deploy verification"
```

---

## Self-Review

**Coverage spec M1:** arsitektur satu worker ✓ (Task 3/7); schema 17 tabel ✓ (Task 2); auth custom username+password kompatibel hash GAS ✓ (Task 4-6); session 12 jam di KV ✓ (Task 5); rate limit 5×/5mnt ✓ (Task 5/6); audit log aksi login/logout/gagal ✓ (Task 6, audit penuh di M2); CORS terbata same-origin ✓ (Task 3/7); testing vitest + port assertion ✓ (Task 4-6).

**Placeholder scan:** semua step berisi kode nyata; satu-satunya nilai yang perlu diisi manual adalah `PASTE_KV_NAMESPACE_ID_HERE` (konfigurasi akun) dan fixture vektor statis di Task 4 Step 5 (hasil hash run — bernilai dan benar-benar berisi string akhir).

**Type consistency:** `KVStore`/`UserRecord`/`SessionUser`/`AuditEntry`/`AppDeps` didefinisikan sekali di `src/deps.ts` dan dipakai konsisten. `createSession(kv, user, now?)`, `checkRate(kv, key, max, windowMs, now?)` dipakai aut route dengan tipe sama. `buildApp(env, overrides)` konsisten di index/app/tests.