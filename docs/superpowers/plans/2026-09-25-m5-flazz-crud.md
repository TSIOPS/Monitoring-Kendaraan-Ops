# M5 — CRUD Flazz & Rekonsiliasi Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Menambahkan CRUD Flazz penuh, ledger top-up/tol, reconciliation, adjust saldo, serta detach payment BBM dari laporan tanpa merusak integrasi M3.

**Architecture:** Domain Flazz dipisahkan ke `src/db/flazz.ts` dan `src/logic/flazz.ts`. `FlazzRepo` menjadi satu-satunya writer kartu, usage, dan saldo; `LaporanRepo` tetap menangani `penggunaan_bbm` dan `jalur_pengiriman`, sedangkan route M3 memakai `deps.flazz` untuk operasi Flazz. Route baru berada di `src/routes/flazz.ts`; detach berada di `src/routes/laporan.ts`.

**Tech Stack:** TypeScript strict, Hono, `@supabase/supabase-js`, Cloudflare KV, Vitest 2, repo in-memory di `tests/helpers.ts`.

## Global Constraints

- Tidak membuat tabel baru dan tidak mengubah schema SQL; gunakan `flazz_card`, `flazz_usage`, `flazz_topup`, `flazz_tol`, dan `flazz_reconciliation` yang sudah ada.
- Semua endpoint wajib `Authorization: Bearer <token>` dan memakai `requireUser`; role/cabang selalu diverifikasi server-side.
- `SUPERADMIN` dapat seluruh cabang; `PIC CABANG` hanya `flazz_card.branch_id = session.cabang`.
- Semua write menghasilkan audit; aksi Flazz memakai `modul = 'flazz'`, detach laporan memakai `modul = 'transaksi'`.
- `last_balance` hanya berubah melalui operasi Flazz; input update card tidak boleh mengubah saldo langsung.
- Penurunan saldo memakai conditional update/compare-and-swap. Perubahan ledger dan saldo memakai kompensasi bila tahap berikutnya gagal.
- M3 tidak membuat row `flazz_topup`/`flazz_tol` otomatis; top-up/tol dibuat melalui endpoint M5.
- Detach hanya payment BBM. Payment tol dan `flazz_card_id_toll` tidak diubah.
- `evidence_url` bersifat URL string; tidak ada upload file M5.
- Tanggal ledger/reconciliation baru harus `YYYY-MM-DD`; nominal harus finite dan tidak negatif.
- `npm run lint` tidak dijalankan karena tidak ada script lint di `package.json`; gate minimal `npm run typecheck` dan `npm test`.
- Jangan melakukan commit, deploy, atau perubahan secret kecuali diminta eksplisit oleh pengguna.

## File Map

**Create:**

- `src/logic/flazz.ts` — perhitungan murni, parsing nominal/tanggal, delta ledger, status card.
- `src/db/flazz.ts` — tipe row, `FlazzRepo`, error saldo, implementasi Supabase.
- `src/routes/flazz.ts` — endpoint card/ledger/reconciliation/adjust.
- `tests/logic/flazz.test.ts` — unit test logic Flazz.
- `tests/db/flazz-mem.test.ts` — test repo in-memory dan kompensasi.
- `tests/routes/flazz.test.ts` — integration test seluruh route Flazz.

**Modify:**

- `src/deps.ts` — menambahkan `flazz: FlazzRepo`.
- `src/app.ts` — membuat dan mendaftarkan `supabaseFlazzRepo` serta route `/api/flazz`.
- `src/db/laporan.ts` — menghapus ownership kartu/usage/saldo dan meng-export compatibility type bila diperlukan.
- `src/routes/laporan.ts` — memakai `deps.flazz` untuk seluruh operasi Flazz dan menambahkan detach.
- `tests/helpers.ts` — menambahkan `memFlazz`, state bersama, dan wiring `AppDeps`.
- `tests/db/laporan-mem.test.ts` — mempertahankan test laporan/Jalur; test kartu/usage dipindah ke `flazz-mem.test.ts`.
- `tests/routes/laporan.test.ts` — memakai repo Flazz bersama dan menambah regression detach.
- `README.md` — status M5 dan tabel API Flazz.

---

### Task 1: Logic Murni Flazz

**Files:**
- Create: `src/logic/flazz.ts`
- Test: `tests/logic/flazz.test.ts`

**Interfaces:**
- Produces:
  - `type FlazzLedgerKind = 'TOPUP' | 'TOL'`
  - `type FlazzLedgerAction = 'CREATE' | 'UPDATE' | 'DELETE'`
  - `type FlazzCardStatus = 'TERSEDIA' | 'SEDANG_DIGUNAKAN' | 'NONAKTIF'`
  - `interface FlazzReconciliationInput`
  - `interface FlazzReconciliationComputed`
  - `parseFlazzAmount(value: unknown, allowZero: boolean): number | null`
  - `isValidFlazzDate(value: unknown): boolean`
  - `isCardUsable(status: string): boolean`
  - `computeReconciliation(input: FlazzReconciliationInput): FlazzReconciliationComputed`
  - `ledgerBalanceDelta(kind: FlazzLedgerKind, action: FlazzLedgerAction, oldAmount: number, newAmount?: number): number`

- [ ] **Step 1: Write failing unit tests**

Create `tests/logic/flazz.test.ts` with these cases:

```ts
import { describe, expect, it } from 'vitest';
import {
  computeReconciliation,
  isCardUsable,
  isValidFlazzDate,
  ledgerBalanceDelta,
  parseFlazzAmount,
} from '../../src/logic/flazz';

describe('parseFlazzAmount', () => {
  it('menerima angka finite dan menolak nilai invalid', () => {
    expect(parseFlazzAmount('12500', false)).toBe(12500);
    expect(parseFlazzAmount(0, true)).toBe(0);
    expect(parseFlazzAmount(0, false)).toBeNull();
    expect(parseFlazzAmount(-1, true)).toBeNull();
    expect(parseFlazzAmount('abc', true)).toBeNull();
    expect(parseFlazzAmount(Infinity, true)).toBeNull();
  });
});

describe('isValidFlazzDate', () => {
  it('hanya menerima YYYY-MM-DD yang valid', () => {
    expect(isValidFlazzDate('2026-09-25')).toBe(true);
    expect(isValidFlazzDate('2026-02-30')).toBe(false);
    expect(isValidFlazzDate('25/09/2026')).toBe(false);
    expect(isValidFlazzDate('')).toBe(false);
  });
});

describe('isCardUsable', () => {
  it('hanya TERSEDIA dan SEDANG_DIGUNAKAN yang dapat dipakai', () => {
    expect(isCardUsable('TERSEDIA')).toBe(true);
    expect(isCardUsable('SEDANG_DIGUNAKAN')).toBe(true);
    expect(isCardUsable('NONAKTIF')).toBe(false);
  });
});

describe('computeReconciliation', () => {
  it('menghitung expense, saldo, dan difference', () => {
    expect(computeReconciliation({
      openingBalance: 100000,
      totalTopup: 50000,
      totalBbmFlazz: 40000,
      totalTol: 10000,
      actualBalance: 95000,
    })).toEqual({ totalExpense: 50000, flazzBalance: 100000, difference: -5000 });
  });
});

describe('ledgerBalanceDelta', () => {
  it('menghitung arah delta top-up dan tol', () => {
    expect(ledgerBalanceDelta('TOPUP', 'CREATE', 0, 50000)).toBe(50000);
    expect(ledgerBalanceDelta('TOPUP', 'UPDATE', 50000, 70000)).toBe(20000);
    expect(ledgerBalanceDelta('TOPUP', 'DELETE', 50000)).toBe(-50000);
    expect(ledgerBalanceDelta('TOL', 'CREATE', 0, 15000)).toBe(-15000);
    expect(ledgerBalanceDelta('TOL', 'UPDATE', 15000, 10000)).toBe(5000);
    expect(ledgerBalanceDelta('TOL', 'DELETE', 15000)).toBe(15000);
  });
});
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx vitest run tests/logic/flazz.test.ts`

Expected: FAIL because `src/logic/flazz.ts` does not exist.

- [ ] **Step 3: Implement the pure functions**

Implement `src/logic/flazz.ts` with no environment, database, KV, or storage access. `computeReconciliation` must use:

```ts
const totalExpense = input.totalBbmFlazz + input.totalTol;
const flazzBalance = input.openingBalance + input.totalTopup - totalExpense;
return {
  totalExpense,
  flazzBalance,
  difference: input.actualBalance - flazzBalance,
};
```

`ledgerBalanceDelta` must reject invalid amounts by returning `0` for pure callers; route validation remains responsible for returning `400` before using the result. Keep all date validation deterministic in UTC and avoid locale-dependent parsing.

- [ ] **Step 4: Run focused and type checks**

Run: `npx vitest run tests/logic/flazz.test.ts`  
Expected: all Flazz logic tests PASS.

Run: `npm run typecheck`  
Expected: PASS.

---

### Task 2: `FlazzRepo` Supabase dan `memFlazz`

**Files:**
- Create: `src/db/flazz.ts`
- Modify: `tests/helpers.ts`
- Create: `tests/db/flazz-mem.test.ts`
- Modify: `tests/db/laporan-mem.test.ts`

**Interfaces:**

`src/db/flazz.ts` must export these complete row shapes:

```ts
export interface FlazzCardRow {
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
  created_at: string;
  updated_at: string;
}

export interface FlazzTopupRow {
  id: string;
  date: string;
  card_id: string;
  amount: number;
  evidence_url: string;
  notes: string;
  created_by: string;
  created_at: string;
  is_deleted: string;
}

export interface FlazzTolRow {
  id: string;
  date: string;
  card_id: string;
  driver_id: string;
  vehicle_id: string;
  amount: number;
  evidence_url: string;
  notes: string;
  created_by: string;
  created_at: string;
  is_deleted: string;
}

export interface FlazzReconciliationRow {
  id: string;
  date: string;
  card_id: string;
  driver_id: string;
  vehicle_id: string;
  opening_balance: number;
  total_topup: number;
  total_bbm_flazz: number;
  total_tol: number;
  total_expense: number;
  flazz_balance: number;
  actual_balance: number;
  difference: number;
  reconciliation_status: string;
  notes: string;
  reconciled_by: string;
  reconciled_at: string;
  is_deleted: string;
}

export interface FlazzUsageRow {
  id: string;
  date: string;
  card_id: string;
  driver_id: string;
  vehicle_id: string;
  usage_type: string;
  primary_card_id: string;
  backup_card_id: string;
  reason: string;
  opening_balance: number;
  used_at: string;
  returned_at: string;
  status: string;
  created_by: string;
  created_at: string;
  ref_type: string;
  ref_id: string;
}
```

Export `FlazzListFilter`, `FlazzLedgerFilter`, patch types, `CreateUsageOpts`, `CardBalanceError`, and `FlazzRepo` with these method contracts:

```ts
export interface FlazzListFilter {
  branchId?: string;
  status?: string;
  q?: string;
}

export interface FlazzLedgerFilter {
  branchId?: string;
  cardId?: string;
  date?: string;
  isDeleted?: boolean;
}

export interface FlazzRepo {
  listCards(filter?: FlazzListFilter): Promise<FlazzCardRow[]>;
  findCardById(id: string): Promise<FlazzCardRow | null>;
  findCardByNumber(branchId: string, cardNumber: string): Promise<FlazzCardRow | null>;
  insertCard(data: NewFlazzCard): Promise<FlazzCardRow>;
  updateCard(id: string, patch: CardPatch): Promise<void>;
  setCardStatus(id: string, status: string): Promise<void>;
  listTopups(filter?: FlazzLedgerFilter): Promise<FlazzTopupRow[]>;
  findTopupById(id: string): Promise<FlazzTopupRow | null>;
  insertTopup(data: NewFlazzTopup): Promise<FlazzTopupRow>;
  updateTopup(id: string, patch: TopupPatch): Promise<void>;
  listTols(filter?: FlazzLedgerFilter): Promise<FlazzTolRow[]>;
  findTolById(id: string): Promise<FlazzTolRow | null>;
  insertTol(data: NewFlazzTol): Promise<FlazzTolRow>;
  updateTol(id: string, patch: TolPatch): Promise<void>;
  listReconciliations(filter?: FlazzLedgerFilter): Promise<FlazzReconciliationRow[]>;
  findReconciliationById(id: string): Promise<FlazzReconciliationRow | null>;
  insertReconciliation(data: NewFlazzReconciliation): Promise<FlazzReconciliationRow>;
  updateReconciliation(id: string, patch: ReconciliationPatch): Promise<void>;
  adjustBalance(cardId: string, delta: number): Promise<number>;
  setBalance(cardId: string, balance: number): Promise<void>;
  hasActiveUsage(cardId: string): Promise<boolean>;
  createUsage(opts: CreateUsageOpts): Promise<void>;
  adjustActiveUsageOpening(cardId: string, delta: number): Promise<void>;
  returnUsageForRef(refType: string, refId: string): Promise<void>;
  returnUsageForCardRef(refType: string, refId: string, cardId: string): Promise<void>;
  latestGivenAt(cardId: string): Promise<number | null>;
}
```

`CardPatch`, `TopupPatch`, `TolPatch`, and `ReconciliationPatch` must allow only editable fields from the spec. `NewFlazz*` types must not allow client-supplied `id`, `created_at`, or `is_deleted`; the repository generates IDs and server metadata.

- [ ] **Step 1: Write failing memory-repository tests**

Create `tests/db/flazz-mem.test.ts` with tests for:

```ts
const card = (over: Partial<FlazzCardRow> = {}): FlazzCardRow => ({
  id: 'FLZ-1',
  card_number: '123',
  card_name: 'Kartu A',
  card_type: '',
  card_role: '',
  branch_id: 'CBG-A',
  driver_id: '',
  default_driver_id: 'DRV-1',
  last_balance: 100000,
  status: 'TERSEDIA',
  notes: '',
  created_at: '2026-09-01T00:00:00.000Z',
  updated_at: '2026-09-01T00:00:00.000Z',
  ...over,
});
```

The tests must assert:

- `adjustBalance` rejects a negative resulting balance with `CardBalanceError` and leaves the card unchanged.
- positive `adjustBalance` returns the new balance.
- `createUsage` changes card status to `SEDANG_DIGUNAKAN`; `returnUsageForRef` restores it when no active usage remains.
- `returnUsageForCardRef` returns only the requested card.
- top-up/tol insert, update, and soft-delete preserve `is_deleted` and update balance through the same delta rules.
- reconciliation insert/update stores server-computed fields and supports `UNRECONCILED`, `APPLIED`, and `IGNORED`.
- injected repository failures allow route-level compensation tests later.

- [ ] **Step 2: Run the focused memory test and verify it fails**

Run: `npx vitest run tests/db/flazz-mem.test.ts`

Expected: FAIL because `memFlazz` and `src/db/flazz.ts` do not exist.

- [ ] **Step 3: Implement the Supabase repository**

Implement `supabaseFlazzRepo(env: Env)` using `getSupabase(env)` and the existing `fail(kind)` style from `src/db/laporan.ts`.

Required behavior:

- `listCards` applies `branchId`, `status`, and case-insensitive `q` filters over `card_number` and `card_name`.
- Ledger lists derive branch scope through their card IDs; they must not trust a client branch value.
- Ledger lists default to `is_deleted = '0'` and only include `is_deleted = '1'` when `isDeleted === true`.
- IDs use `FLZ-`, `TOP-`, `TOL-`, and `REC-`; `created_by`, `created_at`, and `updated_at` are server values.
- Negative balance uses read-balance + `.eq('last_balance', currentBalance)` retry loop, as M3 does, and throws `CardBalanceError` when the conditional update loses the race.
- `returnUsageForRef` returns all active usage rows for a report; `returnUsageForCardRef` returns only rows matching the requested card and restores card status only when no active usage remains for that card.
- `createUsage` uses the card's current balance as `opening_balance`, sets `status = 'DIBERIKAN'`, and updates card status/driver exactly as the current M3 behavior requires.

- [ ] **Step 4: Implement `memFlazz` in the test helper**

In `tests/helpers.ts`:

- Add `MemFlazzState` with `cards`, `usage`, `topups`, `tols`, and `reconciliations` arrays.
- Export `memFlazz(initial?: Partial<MemFlazzState>)` returning `{ state, repo }`.
- Keep all state mutations private to the returned `state` object so route tests can assert balances and soft-delete flags.
- Make `adjustBalance` throw `CardBalanceError` without mutating on insufficient funds.
- Make `returnUsageForCardRef` update only the matching card's usage.
- Update `makeDeps` to create `flazz`, expose `flazzState`, and return it alongside existing test state.

- [ ] **Step 5: Adapt the existing M3 memory tests**

In `tests/db/laporan-mem.test.ts`, keep transaction/Jalur tests and move the current card/usage cases to `tests/db/flazz-mem.test.ts`. Update imports so `CardBalanceError` and usage types come from `src/db/flazz`.

Run: `npx vitest run tests/db/flazz-mem.test.ts tests/db/laporan-mem.test.ts`

Expected: both files PASS.

Run: `npm run typecheck`

Expected: PASS.

---

### Task 3: Refactor Dependency M3 ke `FlazzRepo`

**Files:**
- Modify: `src/deps.ts`
- Modify: `src/app.ts`
- Modify: `src/db/laporan.ts`
- Modify: `src/routes/laporan.ts`
- Modify: `tests/helpers.ts`
- Modify: `tests/routes/laporan.test.ts`
- Modify: `tests/db/laporan-mem.test.ts`

**Interfaces:**

- `AppDeps` gains `flazz: FlazzRepo`.
- `buildApp` creates one `supabaseFlazzRepo(env)` and supplies it through `AppDeps.flazz`.
- `LaporanRepo` retains only transaction and Jalur methods. It may re-export `CardBalanceError` and row types temporarily for existing imports, but all Flazz calls move to `deps.flazz`.
- Every existing M3 call changes as follows: `deps.laporan.findAllCards()` → `deps.flazz.listCards()`, `deps.laporan.findFlazzCardById()` → `deps.flazz.findCardById()`, and all balance/usage methods move to `deps.flazz`.

- [ ] **Step 1: Add the dependency and wire the Supabase repo**

Modify `src/deps.ts` to import `FlazzRepo` and add `flazz: FlazzRepo` to `AppDeps`.

Modify `src/app.ts` to import `supabaseFlazzRepo`, instantiate it once in the default dependency object, and register `app.route('/api/flazz', flazzRoutes(deps))` only after Task 4 has created `flazzRoutes`; during this task use a temporary route registration placeholder only if required for compilation, then replace it in Task 4.

- [ ] **Step 2: Remove Flazz methods from `LaporanRepo` ownership**

In `src/db/laporan.ts`:

- Remove `FlazzCardRow`, `UsageRow`, `CreateUsageOpts`, and Flazz method declarations from `LaporanRepo`.
- Re-export those types and `CardBalanceError` from `src/db/flazz.ts` if existing test imports still need the old import path.
- Remove Supabase implementations for card balance/usage; keep transaction and Jalur methods unchanged.
- Keep `canonicalCardId` in `src/logic/laporan.ts` and reuse it in both domains.

- [ ] **Step 3: Redirect M3 routes to `deps.flazz`**

In `src/routes/laporan.ts`, replace every Flazz operation with the matching `deps.flazz` method, including `loadCards`, save rollback/refund, edit delta, usage creation/opening, and delete return usage. Do not change transaction logic, route paths, GAS messages, duplicate detection, or cache behavior.

- [ ] **Step 4: Share the memory state in M3 route tests**

In `tests/helpers.ts`, update `makeDeps` so a default `memLaporan` and `memFlazz` are independent repositories for reports and Flazz but are both returned to the test. In `tests/routes/laporan.test.ts`, change `setup` to accept `flazzCard`, create `memFlazz({ cards: init.flazzCard ?? [] })`, pass `flazz` to `buildApp`, and assert against `flazz.state` instead of `laporan.state`.

- [ ] **Step 5: Run the M3 regression suite before adding M5 routes**

Run: `npx vitest run tests/db/laporan-mem.test.ts tests/routes/laporan.test.ts tests/db/flazz-mem.test.ts`

Expected: all existing M3 transaction, refund, usage, and Jalur tests PASS with the new dependency ownership.

Run: `npm run typecheck`

Expected: PASS.

---

### Task 4: Route Card, Ledger, dan Adjust

**Files:**
- Create: `src/routes/flazz.ts`
- Modify: `src/app.ts`
- Create: `tests/routes/flazz.test.ts`

**Interfaces:**

`flazzRoutes(deps: AppDeps)` uses these helpers:

```ts
type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

function readJson(c: Ctx): Promise<Record<string, any>>;
function roleOf(u: SessionUser): string;
function assertBranch(u: SessionUser, branchId: string): void;
function audit(c: Ctx, entry: Omit<Parameters<AppDeps['recordAudit']>[0], 'user_id' | 'username' | 'ip'>): Promise<void>;
```

The route must use `deps.master.findCabangByKode`, `findSupirById`, and `findKendaraanById` for reference validation. It must not accept a branch from a top-up/tol/reconciliation body as authoritative.

- [ ] **Step 1: Write failing card route tests**

Add tests for:

- missing auth → `401`;
- SUPERADMIN create card in `CBG-A` → `200`, generated `FLZ-` ID, balance `0`, status `TERSEDIA`, audit `CREATE`;
- PIC create in own branch → `200`;
- PIC create in another branch → `403`;
- duplicate `(branch_id, card_number)` → `409`;
- update cannot change `last_balance` or `branch_id` → `400`;
- delete with active usage → `409`;
- delete an inactive card twice → both `200`;
- list applies `branch_id` and `q` filters without cross-branch leakage.

- [ ] **Step 2: Write failing top-up/tol/adjust route tests**

Add tests for:

- top-up create increments card balance and records `created_by`/audit;
- top-up update adjusts only the delta;
- top-up delete soft-deletes and decrements balance;
- tol create decrements balance, insufficient balance → `409`, and no ledger row remains;
- tol update and delete adjust by the correct signed delta;
- `POST /api/flazz/card/:id/adjust` rejects zero delta, missing reason, and negative resulting balance;
- PIC cannot read or write another branch;
- every successful write bumps `master-rev` and invalidates the relevant warning cache when usage/status changes;
- a failed second-stage operation compensates the first-stage balance/ledger mutation.

- [ ] **Step 3: Run route tests and verify they fail**

Run: `npx vitest run tests/routes/flazz.test.ts`

Expected: FAIL because `src/routes/flazz.ts` is not present.

- [ ] **Step 4: Implement card routes**

Implement these paths in `src/routes/flazz.ts`:

- `GET /card`, `GET /card/:id`
- `POST /card`
- `PUT /card/:id`
- `DELETE /card/:id`

For create, validate required fields, branch existence, duplicate card number, and server metadata. For update, load the card, enforce branch access, allow only the patch fields from `FlazzRepo`, and reject attempts to write `id`, `branch_id`, `last_balance`, or `SEDANG_DIGUNAKAN`. For delete, reject active usage and set `status = 'NONAKTIF'`; already inactive is idempotent. Audit only after the write succeeds.

- [ ] **Step 5: Implement top-up routes**

Implement `GET/POST/PUT/DELETE` for `/topup`. Validate `card_id`, `YYYY-MM-DD`, positive amount, card usability, and branch access. Use this mutation order:

1. For create, call `adjustBalance(cardId, +amount)` and compensate with `-amount` if insert fails.
2. For update, calculate `ledgerBalanceDelta('TOPUP', 'UPDATE', oldAmount, newAmount)`, adjust first, and reverse the delta if update fails.
3. For delete, adjust `-oldAmount` first, then set `is_deleted = '1'`; restore the balance if the soft-delete write fails.
4. Audit, `bumpMasterRev`, and invalidate warning cache only after success.

- [ ] **Step 6: Implement tol routes and adjust route**

Implement the same signed-delta flow for `/tol`: create is negative, update is `old - new`, and delete is positive. Reject any operation that would make the card balance negative. Implement `/card/:id/adjust` with `delta` and required `reason`; adjust the balance, update active usage opening using the M3 timestamp rule, and reverse the balance if the usage update fails.

Use Indonesian `HttpError` messages consistent with M3 for inactive card, missing card, and insufficient balance. Do not add comments to source files.

- [ ] **Step 7: Run focused route tests and typecheck**

Run: `npx vitest run tests/routes/flazz.test.ts tests/logic/flazz.test.ts`

Expected: all card, ledger, and adjust tests PASS.

Run: `npm run typecheck`

Expected: PASS.

---

### Task 5: Reconciliation Routes

**Files:**
- Modify: `src/routes/flazz.ts`
- Modify: `tests/routes/flazz.test.ts`
- Modify: `tests/logic/flazz.test.ts`

**Interfaces:**

- `POST /reconciliation` and `PUT /reconciliation/:id` call `computeReconciliation` from `src/logic/flazz.ts`.
- `POST /reconciliation/:id/apply` and `/ignore` require a non-deleted row and return `409` for the wrong status.
- `DELETE /reconciliation/:id` is soft-delete; it never changes card balance.

- [ ] **Step 1: Add failing reconciliation route tests**

Test the following matrix:

- create stores `total_expense`, `flazz_balance`, `difference`, and `UNRECONCILED` from server input;
- create/update reject negative or non-finite totals and invalid dates;
- update is allowed for `UNRECONCILED` and `IGNORED`, but not `APPLIED`;
- ignore changes only status and does not change card balance;
- apply changes card balance to `actual_balance`, updates usage opening only when the M3 timestamp rule requires it, and marks the row `APPLIED`;
- apply rejects an already applied or ignored row;
- deleting an applied row returns `409`; deleting an unapplied row sets `is_deleted = '1'`;
- PIC cannot access another branch's reconciliation;
- a failed status update after a successful balance apply compensates the balance.

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `npx vitest run tests/routes/flazz.test.ts tests/logic/flazz.test.ts -t "reconciliation|apply|ignore"`

Expected: FAIL because the reconciliation handlers are not implemented.

- [ ] **Step 3: Implement reconciliation create/update/list/delete**

Implement:

- `GET /reconciliation` and `GET /reconciliation/:id`;
- `POST /reconciliation` and `PUT /reconciliation/:id`;
- `DELETE /reconciliation/:id`.

Use the card's branch as the access scope, validate optional driver/vehicle references, and store all calculated fields from `computeReconciliation`. Set `reconciliation_status = 'UNRECONCILED'` on create; preserve `IGNORED` on an allowed update; never recalculate a row marked `APPLIED`.

- [ ] **Step 4: Implement apply and ignore**

For `apply`, load card and reconciliation, calculate `delta = actual_balance - card.last_balance`, call `adjustBalance` with that delta, update active usage opening under the M3 timestamp rule, and update the reconciliation row to `APPLIED` with `reconciled_by` and `reconciled_at`. If the row update fails, apply `-delta` as compensation.

For `ignore`, update only `reconciliation_status = 'IGNORED'` and the optional notes. Do not call `setBalance` or `adjustBalance`.

- [ ] **Step 5: Run reconciliation and full Flazz tests**

Run: `npx vitest run tests/routes/flazz.test.ts tests/logic/flazz.test.ts`

Expected: all Flazz route and logic tests PASS.

Run: `npm run typecheck`

Expected: PASS.

---

### Task 6: Detach `apiDeleteFlazzBBM` dan Regression M3

**Files:**
- Modify: `src/routes/laporan.ts`
- Modify: `tests/routes/laporan.test.ts`

**Interfaces:**

- Add `DELETE /api/laporan/:id/flazz` inside `laporanRoutes`, before the generic `DELETE /:id` handler.
- Use `deps.laporan.findById`, `deps.laporan.update`, and `deps.flazz.findCardById`, `adjustBalance`, and `returnUsageForCardRef`.
- Use the old report's stored `metode_toll` and `flazz_card_id_toll`; infer a missing toll card only to decide whether the BBM card remains active for toll, without materializing a new toll field.

- [ ] **Step 1: Add failing detach route tests**

Add tests for:

- BBM Flazz → detach refunds `biaya_bbm`, sets `metode_pembayaran` to `TUNAI` when cost is positive, clears `flazz_card_id`, and leaves toll fields unchanged;
- zero-cost BBM → detach clears payment method instead of writing `TUNAI`;
- same card used for BBM and toll → usage remains `DIBERIKAN` and card remains `SEDANG_DIGUNAKAN`;
- different card used for toll → only the BBM card usage is returned;
- non-Flazz or missing report → `404` or `409` as specified;
- PIC from another branch → `403`;
- failed report update or refund → old report/payment state is restored;
- audit action is `DETACH`, module is `transaksi`, and master/dashboard caches are invalidated.

- [ ] **Step 2: Run the detach tests and verify they fail**

Run: `npx vitest run tests/routes/laporan.test.ts -t "detach"`

Expected: FAIL because the route does not exist.

- [ ] **Step 3: Implement the detach handler**

The handler must:

1. Load report and derive old BBM card/payment state using existing M3 helpers.
2. Reject non-Flazz BBM with `409` and enforce branch access using the card branch.
3. Compute the new `metode_pembayaran` and patch `flazz_card_id` without changing toll fields.
4. Update the report, refund `biaya_bbm` with `deps.flazz.adjustBalance(cardId, +biaya_bbm)`, and restore the report patch if the refund fails.
5. Return usage only if the card is not still the card used for toll. Use `returnUsageForCardRef('TRX', id, cardId)` so a different toll card is not accidentally returned.
6. Audit, call `bumpMasterRev`, `invalidateLaporanCaches`, and `invalidateDashwarn`.

- [ ] **Step 4: Run M3 regression and detach tests**

Run: `npx vitest run tests/routes/laporan.test.ts tests/db/flazz-mem.test.ts`

Expected: all existing M3 tests plus detach tests PASS.

- [ ] **Step 5: Run the complete test suite**

Run: `npm test`

Expected: all existing and M5 tests PASS.

Run: `npm run typecheck`

Expected: PASS.

---

### Task 7: Documentation dan Final Verification

**Files:**
- Modify: `README.md`
- Read-only verification: `docs/superpowers/specs/2026-09-25-m5-flazz-crud-design.md`

**Interfaces:**

- README must state M5 is implemented and list the Flazz endpoints, role/cabang access, and no-evidence-upload behavior.
- No schema change or migration file is added.

- [ ] **Step 1: Update README status and API table**

Add rows for:

- `GET/POST/PUT/DELETE /api/flazz/card[/:id]`;
- `GET/POST/PUT/DELETE /api/flazz/topup[/:id]`;
- `GET/POST/PUT/DELETE /api/flazz/tol[/:id]`;
- `GET/POST/PUT/DELETE /api/flazz/reconciliation[/:id]`;
- `POST /api/flazz/card/:id/adjust`;
- `POST /api/flazz/reconciliation/:id/apply`;
- `POST /api/flazz/reconciliation/:id/ignore`;
- `DELETE /api/laporan/:id/flazz`.

Update the milestone line to reference the M5 plan and state that M3/M4 regression remains green.

- [ ] **Step 2: Run final gates**

Run: `npm run typecheck`  
Expected: PASS.

Run: `npm test`  
Expected: PASS.

Run: `git diff --check`  
Expected: no whitespace errors.

There is no `lint` script in `package.json`; do not invent a command. Do not run `npm run deploy`, `npm run apply-schema`, or `npm run verify-schema` without explicit user instruction and required credentials.

- [ ] **Step 3: Inspect final diff and status**

Run: `git status --short`  
Expected: only the M5 source, tests, README, spec, and plan files are changed; no generated secrets or dependencies are present.

Run: `git diff --stat`  
Expected: changes are limited to the M5 scope.

Do not commit until the user explicitly requests it.

## Execution Handoff

Plan lengkap dan disimpan di `docs/superpowers/plans/2026-09-25-m5-flazz-crud.md`.

Pilihan eksekusi:

1. **Subagent-Driven (recommended)** — dispatch subagent baru per task dengan review di antara task.
2. **Inline Execution** — menjalankan task di sesi ini dengan checkpoint `executing-plans`.

Pilih salah satu.
