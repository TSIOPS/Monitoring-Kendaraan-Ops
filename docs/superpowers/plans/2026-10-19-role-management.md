# Role MANAGEMENT (monitoring read-only) — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambah role `MANAGEMENT` yang bisa melihat data semua cabang tetapi tidak bisa mengubah apa pun.

**Architecture:** Modul `src/auth/peran.ts` jadi satu sumber kebenaran role di server. Penjaga tulis terpusat di
`requireUser` menolak semua metode non-GET dari MANAGEMENT (kecuali daftar izin). Route GET memakai
`lihatSemuaCabang()` untuk cakupan, sedangkan jalur tulis tetap memakai `isSuper()` (lapis kedua). Frontend punya
helper murni `static/js/peran.js` untuk menu, penjaga rute, dan tombol tulis.

**Tech Stack:** Cloudflare Workers + Hono (TypeScript), Supabase, vanilla JS ES modules, Vitest (env node).

**Spesifikasi:** [docs/superpowers/specs/2026-10-19-role-management-design.md](../specs/2026-10-19-role-management-design.md)

**Aturan proyek (CLAUDE.md):** tiap task = satu commit berisi kode + tes + centang rencana ini + entri CHANGELOG.
Sebelum commit: `npm test` dan `npm run typecheck` hijau. Pesan commit Bahasa Indonesia gaya `feat(area): …`,
diakhiri baris `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Peta file

| File | Status | Tanggung jawab |
|---|---|---|
| `src/auth/peran.ts` | baru | helper role server (murni) |
| `src/auth/middleware.ts` | ubah | penjaga tulis MANAGEMENT |
| `src/routes/laporan.ts` | ubah | cakupan baca laporan + dashboard |
| `src/logic/warnings.ts` | ubah | cakupan peringatan |
| `src/routes/flazz.ts` | ubah | cakupan baca Flazz |
| `src/routes/jalur.ts` | ubah | cakupan baca jalur |
| `src/routes/push.ts` | ubah | cakupan tugas hari ini |
| `src/logic/master.ts` | ubah | payload master (tanpa pengguna) |
| `src/routes/master.ts` | ubah | validasi role pengguna |
| `static/js/peran.js` | baru | helper role frontend (murni) |
| `static/js/app.js` | ubah | menu per role |
| `static/js/router.js` | ubah | alihkan rute terlarang |
| `static/js/pages/{dashboard,transaksi,jalur,flazz,master,performa,rekap,perbandingan}.js` | ubah | filter cabang & sembunyikan tombol tulis |
| `tests/auth/peran.test.ts` | baru | |
| `tests/routes/management.test.ts` | baru | penjaga tulis + cakupan baca |
| `tests/frontend/peran-helpers.test.ts` | baru | |
| `tests/frontend/master-helpers.test.ts` | ubah | bodyPengguna MANAGEMENT |

---

### Task 1: Helper role server `src/auth/peran.ts`

**Files:**
- Create: `src/auth/peran.ts`
- Test: `tests/auth/peran.test.ts`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// tests/auth/peran.test.ts
import { describe, expect, it } from 'vitest';
import { isManagement, isSuper, lihatSemuaCabang, normalPeran, PERAN_VALID } from '../../src/auth/peran';

describe('peran', () => {
  it('normalPeran: huruf besar & tanpa spasi tepi', () => {
    expect(normalPeran({ role: ' management ' })).toBe('MANAGEMENT');
    expect(normalPeran({ role: undefined })).toBe('');
  });
  it('isSuper / isManagement', () => {
    expect(isSuper({ role: 'SUPERADMIN' })).toBe(true);
    expect(isSuper({ role: 'MANAGEMENT' })).toBe(false);
    expect(isManagement({ role: 'management' })).toBe(true);
    expect(isManagement({ role: 'PIC CABANG' })).toBe(false);
  });
  it('lihatSemuaCabang: SUPERADMIN dan MANAGEMENT saja', () => {
    expect(lihatSemuaCabang({ role: 'SUPERADMIN' })).toBe(true);
    expect(lihatSemuaCabang({ role: 'MANAGEMENT' })).toBe(true);
    expect(lihatSemuaCabang({ role: 'PIC CABANG' })).toBe(false);
    expect(lihatSemuaCabang({ role: '' })).toBe(false);
  });
  it('PERAN_VALID', () => {
    expect(PERAN_VALID).toEqual(['SUPERADMIN', 'MANAGEMENT', 'PIC CABANG']);
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/auth/peran.test.ts`
Expected: FAIL (`Failed to resolve import "../../src/auth/peran"`)

- [ ] **Step 3: Implementasi**

```ts
// src/auth/peran.ts
// Satu sumber kebenaran role. MANAGEMENT = pemantau: lihat semua cabang, tidak bisa menulis.
export const PERAN_VALID = ['SUPERADMIN', 'MANAGEMENT', 'PIC CABANG'] as const;

type BerPeran = { role?: unknown };

export function normalPeran(u: BerPeran): string {
  return String(u.role ?? '').trim().toUpperCase();
}
export function isSuper(u: BerPeran): boolean {
  return normalPeran(u) === 'SUPERADMIN';
}
export function isManagement(u: BerPeran): boolean {
  return normalPeran(u) === 'MANAGEMENT';
}
// Cakupan BACA semua cabang. Jangan dipakai untuk cek tulis — tulis tetap isSuper().
export function lihatSemuaCabang(u: BerPeran): boolean {
  return isSuper(u) || isManagement(u);
}
```

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `npx vitest run tests/auth/peran.test.ts` → PASS

- [ ] **Step 5: Centang task ini, tambah entri CHANGELOG (Fitur), commit**

```bash
git add src/auth/peran.ts tests/auth/peran.test.ts docs/superpowers/plans/2026-10-19-role-management.md CHANGELOG.md
git commit -m "feat(auth): helper role terpusat termasuk MANAGEMENT"
```

---

### Task 2: Penjaga tulis MANAGEMENT di `requireUser`

**Files:**
- Modify: `src/auth/middleware.ts`
- Test: `tests/routes/management.test.ts` (baru)

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// tests/routes/management.test.ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, laporanRow, loginAs, makeDeps, memFlazz, memJalur, memLaporan, memMaster, VEHICLE_ROW } from '../helpers';
import type { SessionUser } from '../../src/deps';
import type { FlazzCardRow } from '../../src/db/flazz';
import type { JalurFull } from '../../src/logic/jalur';

const MGR: SessionUser = { user_id: 'U-M', username: 'mgr', nama: 'Manajer', role: 'MANAGEMENT', cabang: '', exp: 1e15 };
const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic A', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

const CABANG = [
  { kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: '', status: 'Aktif' },
  { kode_cabang: 'CBG-B', nama_cabang: 'Cabang B', lokasi: '', status: 'Aktif' },
];

const kartu = (over: Partial<FlazzCardRow> = {}): FlazzCardRow => ({
  id: 'FLZ-A', card_number: '0145', card_name: 'Kartu A', card_type: 'FLAZZ', card_role: 'UTAMA',
  branch_id: 'CBG-A', driver_id: '', default_driver_id: '', last_balance: 500000,
  status: 'TERSEDIA', notes: '', created_at: '', updated_at: '', ...over,
});

// Salin bentuk lengkap jalurRow dari tests/routes/jalur.test.ts:17-24.
const jalurRow = (over: Partial<JalurFull> = {}): JalurFull => ({
  id: 'J-1', tanggal: '2026-10-01', driver_id: 'S-1', nama_driver: 'Supir A', driver2_id: '', nama_driver2: '',
  vehicle_id: 'V-1', plat_nomor: 'B 1 A', nama_kendaraan: 'Corolla', jenis_kendaraan: 'Mobil', rute_tujuan: 'Gudang - Toko',
  kode_cabang: 'CBG-A', flazz_card_id: '', flazz_card_name: '', flazz_card_id_2: '', flazz_card_name_2: '',
  created_by: 'Pic A', created_at: '2026-10-01T00:00:00.000Z', updated_at: '', is_deleted: '', status: 'BELUM_DIISI', laporan_id: '',
  ...over,
} as JalurFull);

export function setup() {
  const master = memMaster({
    cabang: CABANG,
    kendaraan: [VEHICLE_ROW, { ...VEHICLE_ROW, vehicle_id: 'V-9', plat_nomor: 'D 9 Z', kode_cabang: 'CBG-B' }],
    supir: [{ supir_id: 'S-1', nama_supir: 'Supir A', kode_cabang: 'CBG-A', default_vehicle_id: '', status: 'Aktif' }],
    pengguna: [{ user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', kode_cabang: '', status: 'Aktif', password: '' }],
  });
  const lap = memLaporan({
    rows: [laporanRow({ transaction_id: 'TRX-A' }), laporanRow({ transaction_id: 'TRX-B', kode_cabang: 'CBG-B', vehicle_id: 'V-9', plat_nomor: 'D 9 Z' })],
    jalur: [jalurRow(), jalurRow({ id: 'J-B', kode_cabang: 'CBG-B', vehicle_id: 'V-9' })] as any,
  });
  const jalur = memJalur(lap.state.jalur);
  const flz = memFlazz({ cards: [kartu(), kartu({ id: 'FLZ-B', card_number: '0999', branch_id: 'CBG-B' })] });
  const out = makeDeps({ master: master.repo, laporan: lap.repo, jalur: jalur.repo, flazz: flz.repo });
  const app = buildApp(fakeEnv() as any, out.deps);
  return { app, ...out };
}

const req = (app: ReturnType<typeof buildApp>, method: string, path: string, tok: string, body?: unknown) =>
  app.request(path, { method, headers: { ...authHeaders(tok), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

describe('penjaga tulis MANAGEMENT', () => {
  const TULIS: Array<[string, string]> = [
    ['POST', '/api/master/kendaraan'],
    ['PUT', '/api/master/supir'],
    ['DELETE', '/api/jalur/J-1'],
    ['POST', '/api/laporan'],
    ['DELETE', '/api/laporan/TRX-A'],
    ['POST', '/api/flazz/topup'],
    ['PUT', '/api/settings'],
    ['POST', '/api/settings/reset-data'],
  ];
  for (const [method, path] of TULIS) {
    it(`${method} ${path} -> 403 dengan pesan read-only`, async () => {
      const { app, kv, audits } = setup();
      const res = await req(app, method, path, await loginAs(kv, MGR), {});
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ success: false, error: 'FORBIDDEN', message: 'Akses ditolak: akun MANAGEMENT hanya dapat melihat data.' });
      expect(audits).toEqual([]);
    });
  }

  it('daftar izin tidak diblokir penjaga (ganti password sendiri)', async () => {
    const { app, kv } = setup();
    // /api/password sendiri membalas 403 bila password lama salah — jadi yang dicek pesannya, bukan status.
    const res = await req(app, 'POST', '/api/password', await loginAs(kv, MGR), { lama: 'x', baru: 'y' });
    const body = await res.json() as any;
    expect(body.message ?? '').not.toContain('hanya dapat melihat data');
  });

  it('daftar izin: push/langganan dan push/berhenti tidak ditolak penjaga', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, MGR);
    for (const p of ['/api/push/langganan', '/api/push/berhenti', '/api/push/tes']) {
      const body = await (await req(app, 'POST', p, tok, {})).json() as any;
      expect(body.message ?? '').not.toContain('hanya dapat melihat data');
    }
  });

  it('GET tetap lolos', async () => {
    const { app, kv } = setup();
    const res = await req(app, 'GET', '/api/master', await loginAs(kv, MGR));
    expect(res.status).toBe(200);
  });

  it('SUPERADMIN dan PIC tidak terpengaruh penjaga', async () => {
    const { app, kv } = setup();
    for (const u of [SUPER, PIC]) {
      const body = await (await req(app, 'DELETE', '/api/laporan/TIDAK-ADA', await loginAs(kv, u))).json() as any;
      expect(body.message ?? '').not.toContain('hanya dapat melihat data');
    }
  });
});
```

Catatan: bila `memJalur`/`jalurRow` butuh field lain, salin persis dari `tests/routes/jalur.test.ts:17-24`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/routes/management.test.ts`
Expected: FAIL — status bukan 403 / pesan berbeda.

- [ ] **Step 3: Implementasi di `src/auth/middleware.ts`**

```ts
import type { MiddlewareHandler } from 'hono';
import type { Env } from '../env';
import type { AppDeps, SessionUser } from '../deps';
import { resolveSession } from './sessions';
import { errPayload } from '../utils/http';
import { isManagement } from './peran';

export interface AuthVars {
  user: SessionUser;
}

const METODE_BACA = new Set(['GET', 'HEAD', 'OPTIONS']);
// Tulis yang tetap boleh untuk MANAGEMENT: hanya milik akunnya sendiri.
const IZIN_TULIS_MANAGEMENT = new Set(['/api/password', '/api/push/langganan', '/api/push/berhenti', '/api/push/tes']);
export const MSG_MANAGEMENT_READONLY = 'Akses ditolak: akun MANAGEMENT hanya dapat melihat data.';

export function bolehTulisManagement(method: string, path: string): boolean {
  return METODE_BACA.has(method.toUpperCase()) || IZIN_TULIS_MANAGEMENT.has(path.replace(/\/+$/, ''));
}

export function requireUser(deps: Pick<AppDeps, 'kv' | 'now'>): MiddlewareHandler<{ Bindings: Env; Variables: AuthVars }> {
  return async (c, next) => {
    const auth = c.req.header('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    const user = await resolveSession(deps.kv, token, deps.now);
    if (!user) {
      return c.json(errPayload('Akses ditolak: sesi tidak valid. Silakan login kembali.', 'UNAUTHORIZED'), 401);
    }
    // Lapis 1: MANAGEMENT read-only untuk SEMUA route ber-sesi, termasuk route baru di masa depan.
    if (isManagement(user) && !bolehTulisManagement(c.req.method, c.req.path)) {
      return c.json(errPayload(MSG_MANAGEMENT_READONLY, 'FORBIDDEN'), 403);
    }
    c.set('user', user);
    await next();
  };
}
```

Pastikan semua route tulis memang memakai `requireUser` (via `app.use('*', requireUser(deps))` atau per-route):
`grep -n "requireUser\|app.use" src/routes/*.ts`. Route tanpa sesi (`/api/login`, `/api/logout`, `/api/admin/*`,
`/api/push/kunci`, `/api/push/ringkasan`) tidak terpengaruh dan memang tidak memakai sesi pengguna.

- [ ] **Step 4: Jalankan, pastikan lolos**

Run: `npx vitest run tests/routes/management.test.ts` → PASS. Lalu `npm test` (semua tetap hijau).

- [ ] **Step 5: Centang, CHANGELOG (Keamanan), commit**

```bash
git add src/auth/middleware.ts tests/routes/management.test.ts docs/superpowers/plans/2026-10-19-role-management.md CHANGELOG.md
git commit -m "feat(auth): penjaga tulis terpusat untuk role MANAGEMENT"
```

---

### Task 3: Cakupan baca laporan, dashboard, dan peringatan

**Files:**
- Modify: `src/routes/laporan.ts` (hapus `isSuper` lokal baris 34-36; ubah baris ~407, 423, 443-444, 461, 861, 871, 925)
- Modify: `src/logic/warnings.ts:104` dan `:221`
- Test: `tests/routes/management.test.ts`

- [ ] **Step 1: Tambah tes yang gagal** (di akhir `tests/routes/management.test.ts`)

```ts
describe('MANAGEMENT membaca laporan semua cabang', () => {
  it('GET /api/dashboard berisi transaksi semua cabang; ?cabang= menyaring', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, MGR);
    const semua = await (await req(app, 'GET', '/api/dashboard', tok)).json() as any;
    expect(semua.transactions.map((t: any) => t.transaction_id).sort()).toEqual(['TRX-A', 'TRX-B']);
    const b = await (await req(app, 'GET', '/api/dashboard?cabang=CBG-B', tok)).json() as any;
    expect(b.transactions.map((t: any) => t.transaction_id)).toEqual(['TRX-B']);
  });

  it('GET /api/laporan/:id cabang mana pun -> 200', async () => {
    const { app, kv } = setup();
    const res = await req(app, 'GET', '/api/laporan/TRX-B', await loginAs(kv, MGR));
    expect(res.status).toBe(200);
  });

  it('PIC tetap ditolak membaca laporan cabang lain', async () => {
    const { app, kv } = setup();
    const res = await req(app, 'GET', '/api/laporan/TRX-B', await loginAs(kv, PIC));
    expect(res.status).toBe(403);
  });

  it('rekap-pengeluaran memakai ?cabang= untuk MANAGEMENT', async () => {
    const { app, kv, deps } = setup();
    const dipanggil: string[] = [];
    const asli = deps.laporan.rowsBetween.bind(deps.laporan);
    deps.laporan.rowsBetween = async (cab, d, s) => { dipanggil.push(cab); return asli(cab, d, s); };
    const tok = await loginAs(kv, MGR);
    const res = await req(app, 'GET', '/api/laporan/rekap-pengeluaran?dari=2026-09-01&sampai=2026-09-30&cabang=CBG-B', tok);
    expect(res.status).toBe(200);
    expect(dipanggil).toEqual(['CBG-B']);
  });

  it('performa dan warnings mencakup semua cabang (rowsInScope dipanggil dengan cabang kosong)', async () => {
    const { app, kv, deps } = setup();
    const dipanggil: string[] = [];
    const asli = deps.laporan.rowsInScope.bind(deps.laporan);
    deps.laporan.rowsInScope = async (cab, lim) => { dipanggil.push(cab); return asli(cab, lim); };
    const tok = await loginAs(kv, MGR);
    expect((await req(app, 'GET', '/api/laporan/performa', tok)).status).toBe(200);
    expect((await req(app, 'GET', '/api/dashboard/warnings', tok)).status).toBe(200);
    expect(dipanggil.every((c) => c === '')).toBe(true);
    expect(dipanggil.length).toBeGreaterThan(0);
  });
});
```

Dan unit tes `computeWarnings` di `tests/logic/warnings.test.ts` (tambahkan):

```ts
it('MANAGEMENT melihat peringatan kendaraan semua cabang', () => {
  // Pakai fixture kendaraan yang sudah ada di file ini; tambahkan satu kendaraan kode_cabang 'CBG-B'.
  const pic = computeWarnings({ ...INPUT_DASAR, user: { role: 'PIC CABANG', cabang: 'CBG-A' } });
  const mgr = computeWarnings({ ...INPUT_DASAR, user: { role: 'MANAGEMENT', cabang: '' } });
  const sup = computeWarnings({ ...INPUT_DASAR, user: { role: 'SUPERADMIN', cabang: '' } });
  expect(mgr).toEqual(sup);
  expect(mgr.length).toBeGreaterThan(pic.length);
});
```

`INPUT_DASAR` = input `computeWarnings` yang sudah dipakai di file itu dengan minimal satu kendaraan CBG-A dan satu
CBG-B yang sama-sama memicu peringatan (mis. pajak lewat). Bila file belum punya konstanta seperti itu, buat di
atas `describe`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/routes/management.test.ts tests/logic/warnings.test.ts` → FAIL (MANAGEMENT hanya melihat
cabang kosong / 403 pada `/api/laporan/TRX-B`).

- [ ] **Step 3: Implementasi**

`src/routes/laporan.ts` — impor dan ganti helper lokal:

```ts
import { isSuper, lihatSemuaCabang } from '../auth/peran';
```

Hapus fungsi lokal `isSuper` (baris 34-36). `roleOf` tetap (dipakai kunci cache). Lalu:

```ts
// GET /prefill (≈407), GET /performa (≈423), GET / dashboard (≈861), GET /warnings (≈925):
const cabang = lihatSemuaCabang(u) ? '' : u.cabang;

// GET /rekap-pengeluaran (≈443-444):
const cabang = lihatSemuaCabang(u) ? String(c.req.query('cabang') ?? '') : u.cabang;
if (!lihatSemuaCabang(u) && !cabang) return c.json(okPayload({ lines: [] }));

// GET / dashboard filter (≈871):
const fCabang = lihatSemuaCabang(u) ? String(c.req.query('cabang') ?? '') : '';

// GET /:id (≈461) — hanya baca; assertTransactionAccess tetap untuk jalur tulis:
if (!lihatSemuaCabang(u)) assertTransactionAccess(u, row.kode_cabang);
```

Semua pemakaian `isSuper(u)` lain di file ini (jalur tulis: baris 64, 67, 212, 213, dst.) **tidak diubah**.

`src/logic/warnings.ts`:

```ts
import { lihatSemuaCabang } from '../auth/peran';
// baris 104
const isSuper = lihatSemuaCabang(input.user);
// baris 221
const isSuper = lihatSemuaCabang(input.user);
```

(ganti nama variabel lokal menjadi `semua` pada kedua fungsi beserta pemakaiannya agar tidak menyesatkan.)

- [ ] **Step 4: Jalankan** `npx vitest run tests/routes/management.test.ts tests/logic/warnings.test.ts` → PASS; `npm test` → hijau; `npm run typecheck` → bersih.

- [ ] **Step 5: Centang, CHANGELOG (Fitur), commit**

```bash
git add src/routes/laporan.ts src/logic/warnings.ts tests/routes/management.test.ts tests/logic/warnings.test.ts docs/superpowers/plans/2026-10-19-role-management.md CHANGELOG.md
git commit -m "feat(laporan): MANAGEMENT membaca laporan & peringatan semua cabang"
```

---

### Task 4: Cakupan baca Flazz, jalur, dan tugas push

**Files:**
- Modify: `src/routes/flazz.ts` (baris 27-47, 142-156, 265-270, 374-379, 476-481, 508-511, 585)
- Modify: `src/routes/jalur.ts` (baris 19-20, 59-62, 124, 156, 166)
- Modify: `src/routes/push.ts` (baris 29-35, 134)
- Test: `tests/routes/management.test.ts`

- [ ] **Step 1: Tambah tes yang gagal**

```ts
import { tugasUntuk } from '../../src/routes/push';

describe('MANAGEMENT membaca Flazz, jalur, tugas semua cabang', () => {
  it('GET /api/flazz/card semua cabang, ?branch_id= menyaring, /card/:id cabang lain 200', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, MGR);
    const semua = await (await req(app, 'GET', '/api/flazz/card', tok)).json() as any;
    expect(semua.cards.map((k: any) => k.id).sort()).toEqual(['FLZ-A', 'FLZ-B']);
    const b = await (await req(app, 'GET', '/api/flazz/card?branch_id=CBG-B', tok)).json() as any;
    expect(b.cards.map((k: any) => k.id)).toEqual(['FLZ-B']);
    expect((await req(app, 'GET', '/api/flazz/card/FLZ-B', tok)).status).toBe(200);
  });

  it('GET /api/flazz/dashboard memuat kartu semua cabang', async () => {
    const { app, kv, deps } = setup();
    let filter: unknown = 'belum';
    const asli = deps.flazz.listCards.bind(deps.flazz);
    deps.flazz.listCards = async (f?: any) => { if (filter === 'belum') filter = f; return asli(f); };
    expect((await req(app, 'GET', '/api/flazz/dashboard', await loginAs(kv, MGR))).status).toBe(200);
    expect(filter).toBeUndefined();
  });

  it('PIC tetap ditolak membaca kartu cabang lain', async () => {
    const { app, kv } = setup();
    expect((await req(app, 'GET', '/api/flazz/card/FLZ-B', await loginAs(kv, PIC))).status).toBe(403);
  });

  it('GET /api/jalur semua cabang; /api/jalur/:id cabang lain 200', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, MGR);
    const body = await (await req(app, 'GET', '/api/jalur?tanggal=2026-10-01&tanggal_akhir=2026-10-31', tok)).json() as any;
    expect(body.list.map((j: any) => j.id).sort()).toEqual(['J-1', 'J-B']);
    expect((await req(app, 'GET', '/api/jalur/J-B', tok)).status).toBe(200);
  });

  it('tugasUntuk MANAGEMENT membaca semua cabang (cabang null)', async () => {
    const { deps } = setup();
    let cabangArg: unknown = 'belum';
    const asli = deps.jalur.listRange.bind(deps.jalur);
    deps.jalur.listRange = async (a: string, b: string, cab: string | null) => { cabangArg = cab; return asli(a, b, cab); };
    await tugasUntuk(deps, { role: 'MANAGEMENT', cabang: '' }, '2026-10-01');
    expect(cabangArg).toBeNull();
  });
});
```

(Pindahkan baris `import { tugasUntuk } …` ke blok impor di atas file.)

- [ ] **Step 2: Jalankan, pastikan gagal** — `npx vitest run tests/routes/management.test.ts` → FAIL.

- [ ] **Step 3: Implementasi**

`src/routes/flazz.ts`:

```ts
import { isSuper, lihatSemuaCabang, normalPeran } from '../auth/peran';
// hapus fungsi lokal roleOf/isSuper (baris 27-33); ganti pemakaian roleOf(u) (bila ada) dengan normalPeran(u).

// Cakupan BACA: SUPERADMIN & MANAGEMENT boleh semua cabang (dengan filter opsional).
function scopeBaca(u: SessionUser, requested?: unknown): string {
  if (lihatSemuaCabang(u)) return String(requested ?? '').trim();
  return scopeBranch(u, requested);
}
```

Di dalam `flazzRoutes`, tepat setelah `requireCard`:

```ts
  // Versi baca dari requireCard: MANAGEMENT boleh melihat kartu cabang mana pun.
  const requireCardBaca = async (id: string, u: SessionUser): Promise<FlazzCardRow> => {
    const card = await deps.flazz.findCardById(id);
    if (!card) throw new HttpError(404, 'Kartu Flazz tidak ditemukan.', 'NOT_FOUND');
    if (!lihatSemuaCabang(u)) assertBranch(u, card.branch_id);
    return card;
  };
```

Ganti hanya di route **GET**:
- `GET /card`, `GET /topup`, `GET /tol`, `GET /reconciliation`: `scopeBranch(u, c.req.query('branch_id'))` → `scopeBaca(u, c.req.query('branch_id'))`
- `GET /card/:id`, `GET /reconciliation/preview`: `requireCard(` → `requireCardBaca(`
- `GET /dashboard` (≈585): `isSuper(u) ? await deps.flazz.listCards() : …` → `lihatSemuaCabang(u) ? await deps.flazz.listCards() : …`

`POST /card` (`scopeBranch(u, b.branch_id)`) dan cek hapus rekonsiliasi (`isSuper`) **tidak diubah**.

`src/routes/jalur.ts`:

```ts
import { isSuper, lihatSemuaCabang, normalPeran } from '../auth/peran';
// hapus const roleOf/isSuper lokal (baris 19-20); roleOf(u) → normalPeran(u) di assertMasterAccess,
// dan tambahkan MANAGEMENT tidak perlu di sini (assertMasterAccess hanya dipanggil di route tulis).

function scopeCabang(u: SessionUser, query: string | undefined): string | null {
  if (lihatSemuaCabang(u)) return str(query) || null;
  return str(u.cabang);
}
// GET / (≈124) dan GET /drivers (≈156):
if (!lihatSemuaCabang(u) && !cabang) return …;   // isi return tetap seperti sekarang
// GET /:id (≈166):
if (!lihatSemuaCabang(u)) assertOwnWarehouse(u, j.kode_cabang, 'Jadwal pengiriman');
```

`src/routes/push.ts`:

```ts
import { lihatSemuaCabang } from '../auth/peran';
// hapus const isSuper lokal (baris 29)
export async function tugasUntuk(deps: AppDeps, u: Pick<SessionUser, 'role' | 'cabang'>, tanggal = todayWib()) {
  const semua = lihatSemuaCabang(u);
  const cabang = semua ? '' : String(u.cabang || '');
  if (!semua && !cabang) return ringkasTugas([], tanggal);
  const rows = await deps.jalur.listRange(awalRentangTugas(tanggal), tanggal, cabang || null);
  return ringkasTugas(rows, tanggal, cabang);
}
// baris ≈134:
const kunci = lihatSemuaCabang(s) ? '*' : s.cabang;
```

- [ ] **Step 4: Jalankan** test file → PASS; `npm test` hijau; `npm run typecheck` bersih.

- [ ] **Step 5: Centang, CHANGELOG (Fitur), commit**

```bash
git add src/routes/flazz.ts src/routes/jalur.ts src/routes/push.ts tests/routes/management.test.ts docs/superpowers/plans/2026-10-19-role-management.md CHANGELOG.md
git commit -m "feat(flazz,jalur): MANAGEMENT membaca kartu, jalur, dan tugas semua cabang"
```

---

### Task 5: Payload master + validasi role pengguna

**Files:**
- Modify: `src/logic/master.ts:36-134`
- Modify: `src/routes/master.ts:22-27, 286-296, 309-327`
- Test: `tests/routes/management.test.ts`

- [ ] **Step 1: Tambah tes yang gagal**

```ts
describe('master untuk MANAGEMENT', () => {
  it('GET /api/master: semua cabang, kendaraan semua cabang, tanpa daftar pengguna', async () => {
    const { app, kv } = setup();
    const body = await (await req(app, 'GET', '/api/master', await loginAs(kv, MGR))).json() as any;
    expect(body.cabangList.map((c: any) => c.kode).sort()).toEqual(['CBG-A', 'CBG-B']);
    expect(body.vehicles.map((v: any) => v.vehicle_id).sort()).toEqual(['V-1', 'V-9']);
    expect(body.penggunaList).toEqual([]);
  });

  it('GET /api/audit dan /api/settings/reset-status tetap 403', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, MGR);
    expect((await req(app, 'GET', '/api/audit', tok)).status).toBe(403);
    expect((await req(app, 'GET', '/api/settings/reset-status', tok)).status).toBe(403);
  });

  it('SUPERADMIN membuat akun MANAGEMENT; cabang dikosongkan', async () => {
    const { app, kv, masterState } = setup();
    const tok = await loginAs(kv, SUPER);
    const res = await req(app, 'POST', '/api/master/pengguna', tok, { username: 'mgr', nama: 'Manajer', password: 'Rahasia#2026', role: 'MANAGEMENT', cabang: 'CBG-A' });
    expect(res.status).toBe(200);
    expect(masterState.pengguna.find((p) => p.username === 'mgr')).toMatchObject({ role: 'MANAGEMENT', kode_cabang: '' });
  });

  it('PUT pengguna ke MANAGEMENT tanpa cabang diterima', async () => {
    const { app, kv, masterState } = setup();
    const tok = await loginAs(kv, SUPER);
    await req(app, 'POST', '/api/master/pengguna', tok, { username: 'pic2', nama: 'Pic 2', password: 'Rahasia#2026', role: 'PIC CABANG', cabang: 'CBG-A' });
    const id = masterState.pengguna.find((p) => p.username === 'pic2')!.user_id;
    const res = await req(app, 'PUT', '/api/master/pengguna', tok, { user_id: id, username: 'pic2', nama: 'Pic 2', role: 'MANAGEMENT', cabang: '' });
    expect(res.status).toBe(200);
    expect(masterState.pengguna.find((p) => p.user_id === id)).toMatchObject({ role: 'MANAGEMENT', kode_cabang: '' });
  });

  it('role lain tetap ditolak', async () => {
    const { app, kv } = setup();
    const res = await req(app, 'POST', '/api/master/pengguna', await loginAs(kv, SUPER), { username: 'x', nama: 'X', password: 'Rahasia#2026', role: 'DIREKTUR', cabang: '' });
    expect(res.status).toBe(400);
  });
});
```

Bila `makeDeps` tidak mengembalikan `masterState` untuk repo master yang dioper lewat `over`, ubah `setup()` agar
mengembalikan `masterState: master.state` dari `memMaster(...)` dan pakai itu.

- [ ] **Step 2: Jalankan, pastikan gagal** → FAIL (cabangList hanya kosong; role MANAGEMENT ditolak 400).

- [ ] **Step 3: Implementasi**

`src/logic/master.ts`:

```ts
import { isSuper as superUser, lihatSemuaCabang } from '../auth/peran';
// baris 36:
const isSuper = lihatSemuaCabang(user); // cakupan baca: SUPERADMIN & MANAGEMENT
// …semua pemakaian `isSuper` di fungsi tetap, KECUALI penggunaList:
const penggunaList = superUser(user)
  ? raw.pengguna.map(/* sama seperti sekarang */)
  : [];
```

(Ganti nama variabel lokal `isSuper` → `semua` di fungsi ini agar jelas.)

`src/routes/master.ts`:

```ts
import { isSuper as superUser, PERAN_VALID } from '../auth/peran';

function isSuper(u: SessionUser): boolean {
  return superUser(u);
}

// POST /pengguna & PUT /pengguna — ganti dua baris validasi role:
if (!(PERAN_VALID as readonly string[]).includes(role)) return c.json(errPayload('Role tidak valid', 'BAD_REQUEST'), 400);
if (role === 'PIC CABANG' && !cabang) return c.json(errPayload('Warehouse wajib diisi untuk PIC CABANG', 'BAD_REQUEST'), 400);
// Tepat setelahnya, normalisasi: hanya PIC yang terikat warehouse.
const kodeCabang = role === 'PIC CABANG' ? cabang : (role === 'MANAGEMENT' ? '' : cabang);
```

Pakai `kodeCabang` (bukan `cabang`) di `insertPengguna`/`updatePengguna`, di `jsonSnip` audit, dan di pembanding
pencabutan sesi (`cabang !== String(current.kode_cabang ?? '')` → `kodeCabang !== …`). SUPERADMIN tetap menyimpan
nilai yang dikirim klien seperti sekarang (perilaku lama tidak berubah).

- [ ] **Step 4: Jalankan** → PASS; `npm test` hijau; `npm run typecheck` bersih.

- [ ] **Step 5: Centang, CHANGELOG (Fitur), commit**

```bash
git add src/logic/master.ts src/routes/master.ts tests/routes/management.test.ts docs/superpowers/plans/2026-10-19-role-management.md CHANGELOG.md
git commit -m "feat(master): akun MANAGEMENT dan payload master read-only semua cabang"
```

---

### Task 6: Gerbang `/security-review` (server)

- [ ] **Step 1:** Jalankan `/security-review` atas perubahan Task 1–5. Fokus: tidak ada route tulis ber-sesi yang
  lolos tanpa `requireUser`; daftar izin tidak bisa disalahgunakan (path persis, tanpa awalan); cek baca tidak
  melemahkan cek tulis PIC.
- [ ] **Step 2:** Perbaiki temuan (TDD), atau catat alasan di CHANGELOG bila sengaja tidak diperbaiki.
- [ ] **Step 3:** `npm test` + `npm run typecheck` hijau → centang, CHANGELOG (Keamanan: "Gerbang security-review role MANAGEMENT"), commit
  `docs: gerbang security-review role MANAGEMENT`.

---

### Task 7: Helper role frontend `static/js/peran.js`

**Files:**
- Create: `static/js/peran.js`
- Test: `tests/frontend/peran-helpers.test.ts`

- [ ] **Step 1: Tulis tes yang gagal**

```ts
// tests/frontend/peran-helpers.test.ts
import { describe, expect, it } from 'vitest';
import { bolehTulis, isManagement, isSuper, lihatSemuaCabang, ruteDilarang, saringMenu } from '../../static/js/peran.js';

describe('helper peran frontend', () => {
  it('isSuper / isManagement / lihatSemuaCabang / bolehTulis', () => {
    expect(isSuper('SUPERADMIN')).toBe(true);
    expect(isManagement(' management ')).toBe(true);
    expect(lihatSemuaCabang('MANAGEMENT')).toBe(true);
    expect(lihatSemuaCabang('PIC CABANG')).toBe(false);
    expect(bolehTulis('MANAGEMENT')).toBe(false);
    expect(bolehTulis('PIC CABANG')).toBe(true);
    expect(bolehTulis(undefined)).toBe(true);
  });

  it('ruteDilarang: MANAGEMENT tidak boleh rute input/edit/pengaturan/audit', () => {
    for (const h of ['#/input', '#/edit/TRX-1', '#/jalur/buat', '#/jalur/edit/J-1', '#/flazz/topup', '#/flazz/rekon', '#/pengaturan', '#/audit']) {
      expect(ruteDilarang('MANAGEMENT', h)).toBe(true);
    }
    for (const h of ['#/dashboard', '#/history', '#/transaksi', '#/jalur', '#/jalur/ringkasan', '#/flazz', '#/flazz/riwayat', '#/master', '#/perbandingan', '#/rekap', '#/performa', '#/galeri', '#/password']) {
      expect(ruteDilarang('MANAGEMENT', h)).toBe(false);
    }
  });

  it('ruteDilarang: role lain tidak berubah', () => {
    expect(ruteDilarang('PIC CABANG', '#/input')).toBe(false);
    expect(ruteDilarang('SUPERADMIN', '#/audit')).toBe(false);
  });

  it('saringMenu memakai daftar peran per item dan membuang grup kosong', () => {
    const nav = [
      { hash: '#/dashboard', label: 'Dashboard' },
      { label: 'Grup', items: [{ hash: '#/a', label: 'A', peran: ['SUPERADMIN'] }, { hash: '#/b', label: 'B' }] },
      { label: 'Kosong', items: [{ hash: '#/c', label: 'C', peran: ['SUPERADMIN'] }] },
    ];
    expect(saringMenu(nav, 'MANAGEMENT')).toEqual([
      { hash: '#/dashboard', label: 'Dashboard' },
      { label: 'Grup', items: [{ hash: '#/b', label: 'B' }] },
    ]);
    expect(saringMenu(nav, 'superadmin')[2].items).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Jalankan** `npx vitest run tests/frontend/peran-helpers.test.ts` → FAIL (modul belum ada).

- [ ] **Step 3: Implementasi**

```js
// static/js/peran.js
// Helper role frontend (murni, bisa dites tanpa DOM). Server tetap penentu akses sebenarnya.
const norm = (role) => String(role ?? '').trim().toUpperCase();

export const isSuper = (role) => norm(role) === 'SUPERADMIN';
export const isManagement = (role) => norm(role) === 'MANAGEMENT';
export const lihatSemuaCabang = (role) => isSuper(role) || isManagement(role);
export const bolehTulis = (role) => !isManagement(role);

// Rute yang tidak relevan/terlarang untuk MANAGEMENT (read-only, bukan SUPERADMIN).
const RUTE_TERLARANG_MANAGEMENT = [
  /^\/input$/, /^\/edit\/.+$/, /^\/jalur\/buat$/, /^\/jalur\/edit\/.+$/,
  /^\/flazz\/topup$/, /^\/flazz\/rekon$/, /^\/pengaturan$/, /^\/audit$/,
];

export function ruteDilarang(role, hash) {
  if (!isManagement(role)) return false;
  const path = String(hash || '').replace(/^#/, '').split('?')[0];
  return RUTE_TERLARANG_MANAGEMENT.some((re) => re.test(path));
}

// Item tanpa `peran` terlihat semua role; grup tanpa item tersisa dibuang.
export function saringMenu(nav, role) {
  const r = norm(role);
  const boleh = (it) => !it.peran || it.peran.includes(r);
  return nav
    .map((item) => (item.items ? { ...item, items: item.items.filter(boleh) } : item))
    .filter((item) => (item.items ? item.items.length > 0 : boleh(item)));
}
```

- [ ] **Step 4: Jalankan** → PASS.

- [ ] **Step 5: Centang, CHANGELOG (Fitur), commit**

```bash
git add static/js/peran.js tests/frontend/peran-helpers.test.ts docs/superpowers/plans/2026-10-19-role-management.md CHANGELOG.md
git commit -m "feat(frontend): helper peran termasuk MANAGEMENT"
```

---

### Task 8: Menu sidebar & penjaga rute

**Files:**
- Modify: `static/js/app.js:9-87`
- Modify: `static/js/router.js:1, ≈140`

- [ ] **Step 1: Ubah `NAV` di `static/js/app.js`** — ganti `superOnly: true` dengan daftar `peran`:

```js
import { saringMenu } from './peran.js';

const TULIS = ['SUPERADMIN', 'PIC CABANG'];           // bukan MANAGEMENT
const PANTAU = ['SUPERADMIN', 'MANAGEMENT'];
const SUPER = ['SUPERADMIN'];
```

Item yang diberi `peran`:
- `#/jalur/buat` → `peran: TULIS`
- `#/input` → `peran: TULIS`
- `#/perbandingan` → `peran: PANTAU` (sebelumnya `superOnly`)
- `#/flazz/topup`, `#/flazz/rekon` → `peran: TULIS`
- `#/pengaturan`, `#/audit` → `peran: SUPER` (sebelumnya `superOnly`)

Item lain tanpa `peran`. Komentar baris 9 diganti: `// Sidebar mengikuti GAS: grup dapat dilipat; item ber-`peran` hanya untuk role tersebut.`

```js
export function navUntuk(role) {
  return saringMenu(NAV, role);
}
```

- [ ] **Step 2: Penjaga rute di `static/js/router.js`**

```js
import { getUser, isLoggedIn, setUser, clearSession } from './store.js';
import { ruteDilarang } from './peran.js';
```

Di `run(hash)`, tepat setelah blok `if (found.guard && !isLoggedIn()) { … }`:

```js
  // MANAGEMENT read-only: rute input/edit/pengaturan dialihkan ke Dashboard (server tetap menolak tulis).
  if (found.guard && ruteDilarang(getUser()?.role, hash)) {
    window.location.replace('#/dashboard');
    return;
  }
```

- [ ] **Step 3: Verifikasi** — `npm test` hijau (tes router lama tetap lolos; `ruteDilarang` sudah dites di Task 7),
  `npm run typecheck` bersih.

- [ ] **Step 4: Centang, CHANGELOG (UX), commit**

```bash
git add static/js/app.js static/js/router.js docs/superpowers/plans/2026-10-19-role-management.md CHANGELOG.md
git commit -m "feat(ui): menu dan rute sesuai role MANAGEMENT"
```

---

### Task 9: Halaman — filter cabang & sembunyikan tombol tulis

**Files:**
- Modify: `static/js/pages/dashboard.js`, `transaksi.js`, `jalur.js`, `flazz.js`, `master.js`, `performa.js`, `rekap.js`, `perbandingan.js`
- Test: `tests/frontend/master-helpers.test.ts`

- [ ] **Step 1: Tes yang gagal untuk form pengguna** (tambahkan di `tests/frontend/master-helpers.test.ts`)

Tambahkan `ROLE` ke impor yang sudah ada di baris 2 (`import { bodyKendaraan, bodyPengguna, fieldKosong, ROLE } from …`), lalu:

```ts
describe('pengguna MANAGEMENT', () => {
  it('opsi role memuat MANAGEMENT', () => {
    expect(ROLE.map(([v]) => v)).toEqual(['PIC CABANG', 'MANAGEMENT', 'SUPERADMIN']);
  });
  it('bodyPengguna: warehouse dikosongkan untuk MANAGEMENT', () => {
    expect(bodyPengguna({ username: ' m ', nama: ' M ', role: 'MANAGEMENT', cabang: 'CBG-A', password: 'x' }, false))
      .toMatchObject({ username: 'm', nama: 'M', role: 'MANAGEMENT', cabang: '' });
  });
});
```

Run: `npx vitest run tests/frontend/master-helpers.test.ts` → FAIL (`ROLE` tidak diekspor / cabang tidak kosong).

- [ ] **Step 2: `static/js/pages/master.js`**

```js
import { bolehTulis, isSuper as superRole, lihatSemuaCabang } from '../peran.js';

export const ROLE = [['PIC CABANG', 'PIC CABANG'], ['MANAGEMENT', 'MANAGEMENT'], ['SUPERADMIN', 'SUPERADMIN']];
const isSuper = () => superRole(getUser()?.role);
const lihatSemua = () => lihatSemuaCabang(getUser()?.role);
const tulis = () => bolehTulis(getUser()?.role);
```

- `bodyPengguna` (baris 46): `cabang: v.role === 'PIC CABANG' ? v.cabang : ''`
- field Warehouse pengguna (baris 172): `wajib: (v) => v.role === 'PIC CABANG'`
- tab Warehouse (94) & BBM (124): `boleh: lihatSemua()`; tab Pengguna (165) tetap `boleh: isSuper()`
- filter warehouse (353): `lihatSemua() ? el('div', …) : null`
- `gambar()`: bila `!tulis()` → tombol "Tambah …" tidak dirender, kolom header "Aksi" dan sel aksi tidak dirender:

```js
    const bolehUbah = tulis();
    const body = rows.map((r) => {
      const h = e.hapus(r);
      const bukanMilik = !isSuper() && e.cabangOf && String(e.cabangOf(r)) !== String(getUser()?.cabang || '');
      const sel = e.kolom.map(([, fn, kelas]) => el('td', { class: kelas ? kelas(r) : '', text: String(fn(r) ?? '-') }));
      if (!bolehUbah) return el('tr', {}, sel);
      return el('tr', {}, [...sel, /* sel aksi lama (bukanMilik ? … : grupAksi(…)) tanpa perubahan */]);
    });
    // header: [...e.kolom.map(([t]) => el('th', { text: t })), ...(bolehUbah ? [el('th', { text: 'Aksi' })] : [])]
    // tombol Tambah: bolehUbah ? el('button', …) : null
```

Run tes master-helpers → PASS.

- [ ] **Step 3: `static/js/pages/dashboard.js`**

```js
import { bolehTulis, isSuper as superRole, lihatSemuaCabang } from '../peran.js';
// baris 77:
const isSuper = superRole(user.role);
const semua = lihatSemuaCabang(user.role);
const tulis = bolehTulis(user.role);
```
- `badgeCabang(…, isSuper)` (108, 119, 142, 153) → `badgeCabang(…, semua)`; filter (166) `semua ? pilihCabang.value : ''`; (299) `if (semua && cabang.length > 1)`.
- `bisaReset` (126): `const bisaReset = tulis && (isSuper || (user.role === 'PIC CABANG' && String(r.cabang) === String(user.cabang)));`
- Akses Cepat (89-96): render `aksesCepat` hanya bila `tulis` (MANAGEMENT tidak melihat panel ini).
- Kartu saldo rendah (117): bila `!tulis` pakai `el('div', { class: 'list-group-item d-flex justify-content-between align-items-center' }, …)` alih-alih tautan ke `#/flazz/topup`.
- Tautan "Rekonsiliasi Flazz" di banner tugas (215): bila `!tulis`, tampilkan teks biasa `'Rekonsiliasi Flazz'` tanpa `<a>`.

- [ ] **Step 4: `static/js/pages/transaksi.js`**

```js
import { bolehTulis, lihatSemuaCabang } from '../peran.js';
```
- `selAksi(r)` dipanggil hanya bila `bolehTulis(getUser()?.role)`; header kolom "Aksi" juga hanya saat itu. Cari
  pemanggil `selAksi(` dan header `'Aksi'` di file ini, lalu bungkus keduanya dengan kondisi yang sama.
- baris 289: `const isSuper = lihatSemuaCabang(getUser()?.role);` (variabel ini hanya mengatur filter warehouse).

- [ ] **Step 5: `static/js/pages/jalur.js`**

```js
import { bolehTulis, lihatSemuaCabang } from '../peran.js';
const lihatSemua = () => lihatSemuaCabang(getUser()?.role);   // menggantikan const isSuper (baris 64)
const tulis = () => bolehTulis(getUser()?.role);
```
- Ganti seluruh `isSuper()` di file → `lihatSemua()` (MANAGEMENT tidak pernah mencapai form Buat/Edit karena router
  mengalihkannya, jadi perilaku SUPERADMIN/PIC tidak berubah).
- Daftar Jalur: tombol "Buat Jalur" (187) dan kolom Aksi (161 + header 'Aksi') hanya bila `tulis()`.

- [ ] **Step 6: `static/js/pages/flazz.js`**

```js
import { bolehTulis, lihatSemuaCabang } from '../peran.js';
const lihatSemua = () => lihatSemuaCabang(getUser()?.role);
const tulis = () => bolehTulis(getUser()?.role);
```
- `navFlazz` (132): item Top Up & Rekonsiliasi hanya bila `tulis()`.
- filter warehouse List (256) & Riwayat (593): `isSuper()` → `lihatSemua()`.
- Riwayat: kolom Aksi top up (523), tol (534), BBM/lepas (544) hanya bila `tulis()` (header 'Aksi' ikut).
  Hapus rekonsiliasi (557, 571) tetap `isSuper()`.

- [ ] **Step 7: `performa.js` (16), `rekap.js` (176), `perbandingan.js` (552)**

```js
import { lihatSemuaCabang } from '../peran.js';
// performa.js:16 dan rekap.js:176
const isSuper = lihatSemuaCabang(getUser()?.role);   // hanya mengatur filter warehouse
// perbandingan.js:552
if (!lihatSemuaCabang(getUser()?.role)) {
  view.replaceChildren(el('div', { class: 'alert alert-warning', text: 'Perbandingan antar warehouse hanya untuk SUPERADMIN dan MANAGEMENT.' }));
  return { ok: false };
}
```
Ganti nama variabel `isSuper` → `semua` di performa/rekap agar tidak menyesatkan.

- [ ] **Step 8: Verifikasi** — `npm test` hijau, `npm run typecheck` bersih, dan uji manual di `npm run dev`
  dengan akun MANAGEMENT (buat lewat Data Master oleh SUPERADMIN): menu, filter warehouse, tidak ada tombol
  tambah/ubah/hapus, `#/input` dialihkan ke Dashboard.

- [ ] **Step 9: Centang, CHANGELOG (UX), commit**

```bash
git add static/js/pages tests/frontend/master-helpers.test.ts docs/superpowers/plans/2026-10-19-role-management.md CHANGELOG.md
git commit -m "feat(ui): halaman read-only untuk role MANAGEMENT"
```

---

### Task 10: Gerbang `/ui-ux-pro-max` dan `/code-review:code-review`

- [ ] **Step 1:** `/ui-ux-pro-max` mode review (checklist §1–§3 + §8 Forms) atas Task 8–9.
- [ ] **Step 2:** `/code-review:code-review` atas seluruh perubahan cabang (modul baru, lintas file).
- [ ] **Step 3:** Perbaiki temuan (TDD) atau catat alasan di CHANGELOG.
- [ ] **Step 4:** `npm test` + `npm run typecheck` hijau → centang, CHANGELOG, commit `docs: gerbang ui-ux & code-review role MANAGEMENT`.

---

### Task 11: Dokumentasi

**Files:** `README.md`, `CLAUDE.md`, `CHANGELOG.md`

- [ ] **Step 1: README.md** — tambah bagian "Role pengguna" (SUPERADMIN / MANAGEMENT / PIC CABANG, ringkas seperti
  tabel di spesifikasi) dan catatan keamanan: "MANAGEMENT read-only; semua metode non-GET ditolak di `requireUser`
  kecuali `/api/password` dan `/api/push/{langganan,berhenti,tes}`". Di tabel API, tambahkan kolom akses MANAGEMENT
  pada baris `GET /api/master` ("semua cabang, tanpa pengguna").
- [ ] **Step 2: CLAUDE.md §6** — ganti butir cek akses menjadi:
  `- Setiap cek akses di server: PIC CABANG dibatasi ke cabangnya; MANAGEMENT baca semua cabang tapi tidak bisa menulis (penjaga di requireUser — cakupan baca pakai lihatSemuaCabang(), cek tulis tetap isSuper()); SUPERADMIN-only untuk pengguna/pengaturan/reset/audit.`
- [ ] **Step 3: CHANGELOG** — entri ringkasan fitur role MANAGEMENT (Fitur), file utama.
- [ ] **Step 4:** Commit `docs: role MANAGEMENT di README dan CLAUDE.md`.
