# Rincian Pengeluaran per Nota + Pengingat Unduh Excel + Notif Update — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin cabang mencatat setiap nota BBM/tol (jenis, nominal, dibayar, keterangan) dengan 2 foto gabungan; setelah tugas hari ini selesai diingatkan mengunduh Excel bulan berjalan; aplikasi memberi tahu bila ada versi baru.

**Architecture:** Spec: `docs/superpowers/specs/2026-10-21-rincian-pengeluaran-design.md`. Rincian disimpan sebagai kolom JSON `penggunaan_bbm.rincian`; fungsi murni `src/logic/rincian.ts` menjumlahkan rincian ke kolom slot lama (grup-1 + grup-2) sebelum logika POST/PUT yang ada berjalan — rekon, saldo, Perbandingan tidak berubah. Rekap memecah laporan per item rincian. Pengingat unduh = field `unduh_excel` di `/api/tugas-hari-ini` + KV penanda unduh. Notif update = binding `CF_VERSION_METADATA` + polling klien + `static/js/rilis.js`.

**Tech Stack:** Cloudflare Workers + Hono (TypeScript), Supabase (Postgres), vanilla JS frontend (`el()`), Vitest (env `node`), SheetJS.

**Aturan proyek (CLAUDE.md):** setiap task: tes dulu → kode → `npm test` + `npm run typecheck` hijau → centang task ini + entri CHANGELOG → commit (`feat(area): …` Bahasa Indonesia, akhiri dengan `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`) → `git push origin main`. Teks UI/identifier Bahasa Indonesia; tanpa `innerHTML`.

## Penyimpangan dari spec (diputuskan saat menyusun rencana)
- Slot tidak ditukar (spec §1 langkah 3): slot-1 boleh TUNAI dengan slot-2 kartu — semantik grup-2 sudah mendukung (kartu terisi → FLAZZ). Urutan slot = urutan kemunculan pertama.
- PUT dari klien lama (tanpa `rincian`) yang mengubah field pembayaran mengosongkan `rincian` (`[]`) agar rincian tidak basi; tampilan jatuh ke baris turunan slot.
- Endpoint versi: `GET /api/health/versi` (bukan `/api/versi`) — memakai router health publik yang ada.
- Rincian di History tampil sebagai `<details>` "Rincian (n)" di kolom Liter (tanpa pop-up).
- Pop-up "unduh Excel" dipicu dari `segarkanBanner` (sudah disegarkan setelah rekon lewat event `data-berubah`), jadi `flazz.js` tidak diubah.

## Peta file
| File | Tanggung jawab |
|---|---|
| `db/rincian-pengeluaran.sql` (baru), `db/schema.sql` | kolom `rincian jsonb` |
| `src/logic/rincian.ts` (baru) | normalisasi/validasi rincian, rincian→slot, slot→rincian |
| `src/logic/laporan.ts` | tipe `rincian` di `LaporanRow`/`RecentItem` |
| `src/routes/laporan.ts` | POST/PUT/Lepas Flazz memakai rincian |
| `src/logic/rekap.ts` | line per item rincian + `keterangan` |
| `src/logic/tugas.ts`, `src/routes/push.ts` | `jalur_hari_ini`, `unduh_excel`, `POST /api/rekap/unduh-harian` |
| `src/routes/health.ts`, `src/env.ts`, `wrangler.jsonc` | versi deploy |
| `static/js/rincian.js` (baru) | helper murni + komponen tabel rincian |
| `static/js/pages/input.js`, `edit.js` | form memakai tabel rincian |
| `static/js/pages/transaksi.js` | `<details>` rincian di History |
| `static/js/pages/rekap.js` | kolom Keterangan + `namaFileRekap` |
| `static/js/unduh-rekap.js` (baru), `static/js/notifikasi.js` | banner/pop-up unduh Excel |
| `static/js/versi.js` (baru), `static/js/rilis.js` (baru), `static/js/app.js`, `static/index.html`, `static/css/app.css` | banner versi baru + "Yang baru" |

---

### Task 1: Kolom `rincian` di database

**Files:**
- Create: `db/rincian-pengeluaran.sql`
- Modify: `db/schema.sql` (setelah blok `alter table penggunaan_bbm … biaya_toll_2`)
- Modify: `README.md` (tabel "SQL migrasi tertunda": status jadi "⏳ belum dijalankan")
- Test: `tests/schema.test.ts`

- [x] **Step 1: Tes gagal** — tambahkan di `tests/schema.test.ts` dalam `describe('db/schema.sql')`:
```ts
  it('penggunaan_bbm punya kolom rincian jsonb', () => {
    expect(sql).toMatch(/alter table penggunaan_bbm add column if not exists rincian jsonb not null default '\[\]'::jsonb;/i);
  });
```
- [x] **Step 2:** `npx vitest run tests/schema.test.ts` → FAIL.
- [x] **Step 3: Implementasi**

`db/rincian-pengeluaran.sql`:
```sql
-- Rincian pengeluaran per nota (spec 2026-10-21). Idempoten; jalankan di Supabase SQL editor sebelum deploy.
-- Item: {"jenis":"BBM"|"TOL","nominal":200000,"kartu":"<card_id>"|"","keterangan":"..."}; kartu kosong = tunai.
alter table penggunaan_bbm add column if not exists rincian jsonb not null default '[]'::jsonb;
```
`db/schema.sql` — tambahkan baris yang sama (beserta komentar satu baris) setelah `alter table penggunaan_bbm add column if not exists biaya_toll_2 …`.

README "SQL migrasi tertunda": ubah status baris `db/rincian-pengeluaran.sql` menjadi `⏳ belum dijalankan — jalankan sebelum deploy fitur rincian`.
- [x] **Step 4:** `npx vitest run tests/schema.test.ts` → PASS.
- [x] **Step 5:** `npm test && npm run typecheck`, centang, CHANGELOG (Fitur: kolom rincian), commit `feat(db): kolom rincian pengeluaran per nota`, push.

---

### Task 2: Logika murni rincian (`src/logic/rincian.ts`)

**Files:**
- Create: `src/logic/rincian.ts`
- Modify: `src/logic/laporan.ts` (tipe)
- Test: `tests/logic/rincian.test.ts`

- [x] **Step 1: Tes gagal** — `tests/logic/rincian.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { normalRincian, rincianKeSlot, slotKeRincian, rincianDariRow, MSG_RINCIAN_MAKS_BARIS } from '../../src/logic/rincian';
import type { LaporanRow } from '../../src/logic/laporan';

const B = (jenis: string, nominal: unknown, kartu = '', keterangan = '') => ({ jenis, nominal, kartu, keterangan });

describe('normalRincian', () => {
  it('membersihkan item valid: jenis huruf besar, nominal dibulatkan, keterangan dipangkas', () => {
    const r = normalRincian([B('bbm', '200000.4', ' FLZ-1 ', '  SPBU Cikampek  '), B('Tol', 15500)]);
    expect(r.galat).toEqual([]);
    expect(r.items).toEqual([
      { jenis: 'BBM', nominal: 200000, kartu: 'FLZ-1', keterangan: 'SPBU Cikampek' },
      { jenis: 'TOL', nominal: 15500, kartu: '', keterangan: '' },
    ]);
  });
  it('bukan array -> galat; > 30 baris -> galat', () => {
    expect(normalRincian('x').galat).toEqual(['Rincian pengeluaran tidak valid.']);
    expect(normalRincian(Array.from({ length: 31 }, () => B('BBM', 1))).galat).toEqual([MSG_RINCIAN_MAKS_BARIS]);
  });
  it('galat per baris: jenis, nominal <= 0 / bukan angka, keterangan > 100', () => {
    const r = normalRincian([B('SOLAR', 1), B('BBM', 0), B('TOL', 'abc'), B('BBM', 1, '', 'x'.repeat(101))]);
    expect(r.galat).toEqual([
      'Baris 1: jenis harus BBM atau Tol.',
      'Baris 2: nominal harus lebih dari 0.',
      'Baris 3: nominal harus lebih dari 0.',
      'Baris 4: keterangan maksimal 100 karakter.',
    ]);
  });
});

describe('rincianKeSlot', () => {
  it('kosong -> semua slot nol, metode tunai eksplisit', () => {
    expect(rincianKeSlot([])).toEqual({ slot: {
      metode_pembayaran: 'TUNAI', flazz_card_id: '', biaya_bbm: 0, metode_toll: 'TUNAI', flazz_card_id_toll: '', biaya_toll: 0,
      flazz_card_id_2: '', biaya_bbm_2: 0, flazz_card_id_toll_2: '', biaya_toll_2: 0,
    }, galat: [] });
  });
  it('satu kartu untuk BBM & tol; nominal sejenis dijumlah; kartu kanonis sama digabung', () => {
    const { slot, galat } = rincianKeSlot(normalRincian([B('BBM', 200000, 'FLZ-1'), B('TOL', 15500, 'FLZ-1'), B('TOL', 23000, 'FLZ1')]).items);
    expect(galat).toEqual([]);
    expect(slot).toMatchObject({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 200000, metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-1', biaya_toll: 38500, biaya_bbm_2: 0, biaya_toll_2: 0 });
  });
  it('dua sumber per jenis: urutan kemunculan; tunai di slot-2 = kartu kosong', () => {
    const { slot } = rincianKeSlot(normalRincian([B('BBM', 200000, 'FLZ-1'), B('BBM', 150000), B('TOL', 5000), B('TOL', 7000, 'FLZ-2')]).items);
    expect(slot).toMatchObject({
      metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 200000, flazz_card_id_2: '', biaya_bbm_2: 150000,
      metode_toll: 'TUNAI', flazz_card_id_toll: '', biaya_toll: 5000, flazz_card_id_toll_2: 'FLZ-2', biaya_toll_2: 7000,
    });
  });
  it('lebih dari 2 cara bayar per jenis -> galat dengan label kartu', () => {
    const { galat } = rincianKeSlot(normalRincian([B('BBM', 1, 'FLZ-1'), B('BBM', 1, 'FLZ-2'), B('BBM', 1)]).items, (id) => (id === 'FLZ-1' ? 'Etoll A' : 'Etoll B'));
    expect(galat).toEqual(['BBM dibayar dengan 3 cara (Etoll A, Etoll B, Tunai). Maksimal 2 cara per jenis — gabungkan atau pindahkan salah satu.']);
  });
});

const row = (o: Partial<LaporanRow>) => ({
  metode_pembayaran: 'TUNAI', flazz_card_id: '', biaya_bbm: 0, metode_toll: 'TUNAI', flazz_card_id_toll: '', biaya_toll: 0,
  flazz_card_id_2: '', biaya_bbm_2: 0, flazz_card_id_toll_2: '', biaya_toll_2: 0, ...o,
}) as LaporanRow;

describe('slotKeRincian & rincianDariRow', () => {
  it('laporan lama: 1 baris per slot bernominal, tol ikut kartu BBM bila metode_toll kosong', () => {
    expect(slotKeRincian(row({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 350000, metode_toll: '', biaya_toll: 42000, biaya_bbm_2: 50000 }))).toEqual([
      { jenis: 'BBM', nominal: 350000, kartu: 'FLZ-1', keterangan: '' },
      { jenis: 'TOL', nominal: 42000, kartu: 'FLZ-1', keterangan: '' },
      { jenis: 'BBM', nominal: 50000, kartu: '', keterangan: '' },
    ]);
  });
  it('rincianDariRow memakai kolom rincian bila ada, tandai lama bila tidak', () => {
    const it1 = { jenis: 'TOL' as const, nominal: 5000, kartu: '', keterangan: 'GT A' };
    expect(rincianDariRow(row({ biaya_toll: 5000, rincian: [it1] }))).toEqual({ items: [it1], lama: false });
    expect(rincianDariRow(row({ biaya_toll: 5000 }))).toEqual({ items: [{ jenis: 'TOL', nominal: 5000, kartu: '', keterangan: '' }], lama: true });
  });
});
```
- [x] **Step 2:** `npx vitest run tests/logic/rincian.test.ts` → FAIL (modul tidak ada).
- [x] **Step 3: Implementasi**

`src/logic/laporan.ts` — tambahkan tipe sebelum `export interface LaporanRow` dan field opsional di `LaporanRow` (setelah `biaya_toll_2: number;`):
```ts
export interface RincianItem { jenis: 'BBM' | 'TOL'; nominal: number; kartu: string; keterangan: string }
```
```ts
  // Rincian per nota (spec 2026-10-21); kosong/tidak ada = laporan lama, baca dari slot.
  rincian?: RincianItem[];
```

`src/logic/rincian.ts`:
```ts
// Logika MURNI rincian pengeluaran per nota (spec 2026-10-21-rincian-pengeluaran-design.md).
// Rincian dijumlahkan ke kolom slot lama (grup-1 + grup-2) sehingga rekon, saldo kartu, dan
// rekap tetap memakai logika yang sudah ada. Maks 2 cara bayar per jenis (batas slot).
import { canonicalCardId, cardGroups, num } from './laporan';
import type { LaporanRow, RincianItem } from './laporan';

export type { RincianItem };
export const MAKS_BARIS = 30;
export const MAKS_KETERANGAN = 100;
export const MSG_RINCIAN_TIDAK_VALID = 'Rincian pengeluaran tidak valid.';
export const MSG_RINCIAN_MAKS_BARIS = `Rincian pengeluaran maksimal ${MAKS_BARIS} baris.`;

export interface SlotPembayaran {
  metode_pembayaran: string; flazz_card_id: string; biaya_bbm: number;
  metode_toll: string; flazz_card_id_toll: string; biaya_toll: number;
  flazz_card_id_2: string; biaya_bbm_2: number; flazz_card_id_toll_2: string; biaya_toll_2: number;
}

export function normalRincian(raw: unknown): { items: RincianItem[]; galat: string[] } {
  if (!Array.isArray(raw)) return { items: [], galat: [MSG_RINCIAN_TIDAK_VALID] };
  if (raw.length > MAKS_BARIS) return { items: [], galat: [MSG_RINCIAN_MAKS_BARIS] };
  const items: RincianItem[] = [];
  const galat: string[] = [];
  raw.forEach((x, i) => {
    const o = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    const jenis = String(o.jenis ?? '').trim().toUpperCase();
    const nominal = Math.round(num(o.nominal));
    const keterangan = String(o.keterangan ?? '').trim();
    const n = i + 1;
    if (jenis !== 'BBM' && jenis !== 'TOL') galat.push(`Baris ${n}: jenis harus BBM atau Tol.`);
    if (!(nominal > 0)) galat.push(`Baris ${n}: nominal harus lebih dari 0.`);
    if (keterangan.length > MAKS_KETERANGAN) galat.push(`Baris ${n}: keterangan maksimal ${MAKS_KETERANGAN} karakter.`);
    items.push({ jenis: jenis as RincianItem['jenis'], nominal, kartu: String(o.kartu ?? '').trim(), keterangan });
  });
  return { items, galat };
}

// Sumber bayar per jenis, urut kemunculan pertama; kartu dibandingkan kanonis.
function sumberPer(items: RincianItem[], jenis: RincianItem['jenis']) {
  const map = new Map<string, { kartu: string; total: number }>();
  for (const it of items) {
    if (it.jenis !== jenis) continue;
    const key = it.kartu ? canonicalCardId(it.kartu) : 'TUNAI';
    const s = map.get(key) ?? { kartu: it.kartu, total: 0 };
    s.total += it.nominal;
    map.set(key, s);
  }
  return [...map.values()];
}

export function rincianKeSlot(items: RincianItem[], labelKartu: (id: string) => string = (id) => id): { slot: SlotPembayaran; galat: string[] } {
  const bbm = sumberPer(items, 'BBM');
  const tol = sumberPer(items, 'TOL');
  const galat: string[] = [];
  for (const [label, daftar] of [['BBM', bbm], ['Tol', tol]] as const) {
    if (daftar.length > 2) {
      const nama = daftar.map((s) => (s.kartu ? labelKartu(s.kartu) : 'Tunai')).join(', ');
      galat.push(`${label} dibayar dengan ${daftar.length} cara (${nama}). Maksimal 2 cara per jenis — gabungkan atau pindahkan salah satu.`);
    }
  }
  const [b1, b2] = bbm;
  const [t1, t2] = tol;
  return {
    galat,
    slot: {
      metode_pembayaran: b1?.kartu ? 'FLAZZ' : 'TUNAI', flazz_card_id: b1?.kartu ?? '', biaya_bbm: b1?.total ?? 0,
      metode_toll: t1?.kartu ? 'FLAZZ' : 'TUNAI', flazz_card_id_toll: t1?.kartu ?? '', biaya_toll: t1?.total ?? 0,
      flazz_card_id_2: b2?.kartu ?? '', biaya_bbm_2: b2?.total ?? 0,
      flazz_card_id_toll_2: t2?.kartu ?? '', biaya_toll_2: t2?.total ?? 0,
    },
  };
}

// Laporan lama (tanpa rincian): satu baris per slot bernominal, keterangan kosong.
export function slotKeRincian(row: LaporanRow): RincianItem[] {
  const out: RincianItem[] = [];
  for (const g of cardGroups(row)) {
    if (num(g.bBbm) > 0) out.push({ jenis: 'BBM', nominal: num(g.bBbm), kartu: g.mBbm === 'FLAZZ' ? g.cBbm : '', keterangan: '' });
    if (num(g.bTol) > 0) out.push({ jenis: 'TOL', nominal: num(g.bTol), kartu: g.mTol === 'FLAZZ' ? g.cTol : '', keterangan: '' });
  }
  return out;
}

export function rincianDariRow(row: LaporanRow): { items: RincianItem[]; lama: boolean } {
  const r = Array.isArray(row.rincian) ? row.rincian : [];
  return r.length ? { items: r, lama: false } : { items: slotKeRincian(row), lama: true };
}
```
- [x] **Step 4:** `npx vitest run tests/logic/rincian.test.ts` → PASS. (Bila uji slot-lama gagal karena urutan grup: `cardGroups` mengembalikan grup-1 lalu grup-2 → BBM1, TOL1, BBM2 sesuai harapan.)
- [x] **Step 5:** `npm test && npm run typecheck`, centang, CHANGELOG, commit `feat(laporan): logika rincian pengeluaran per nota`, push.

---

### Task 3: POST & PUT `/api/laporan` menerima `rincian`

**Files:**
- Modify: `src/routes/laporan.ts` (POST ±L201, PUT ±L466)
- Test: `tests/routes/laporan.test.ts`

- [x] **Step 1: Tes gagal** — tambahkan di `tests/routes/laporan.test.ts`:
```ts
describe('rincian pengeluaran', () => {
  const rinci = (items: unknown[]) => saveBody({ biaya_bbm: 999, biaya_toll: 999, metode_pembayaran: 'TUNAI', rincian: items });

  it('POST: rincian dijumlah ke slot, saldo kartu terpotong, rincian tersimpan', async () => {
    const { app, kv, lap, flz } = setup({ flazzCard: [flazzCard()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, rinci([
      { jenis: 'BBM', nominal: 100000, kartu: 'FLZ-1', keterangan: 'SPBU A' },
      { jenis: 'TOL', nominal: 15500, kartu: 'FLZ-1', keterangan: 'GT 1' },
      { jenis: 'TOL', nominal: 4500, kartu: 'FLZ-1', keterangan: 'GT 2' },
      { jenis: 'BBM', nominal: 20000, kartu: '', keterangan: 'SPBU B' },
    ]));
    expect(res.status).toBe(200);
    expect(lap.state.rows[0]).toMatchObject({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 100000, biaya_bbm_2: 20000, flazz_card_id_2: '', metode_toll: 'FLAZZ', biaya_toll: 20000 });
    expect(lap.state.rows[0]!.rincian).toHaveLength(4);
    expect(flz.state.cards[0]!.last_balance).toBe(500000 - 120000);
  });

  it('POST: 3 cara bayar BBM -> 400, galat baris -> 400', async () => {
    const { app, kv, lap } = setup({ flazzCard: [flazzCard(), flazzCard({ id: 'FLZ-2', card_name: 'Kartu B' })] });
    const tok = await loginAs(kv, PIC);
    const r1 = await post(app, '/api/laporan', tok, rinci([
      { jenis: 'BBM', nominal: 1, kartu: 'FLZ-1' }, { jenis: 'BBM', nominal: 1, kartu: 'FLZ-2' }, { jenis: 'BBM', nominal: 1, kartu: '' },
    ]));
    expect(r1.status).toBe(400);
    expect(((await r1.json()) as any).message).toContain('BBM dibayar dengan 3 cara (Kartu A, Kartu B, Tunai)');
    const r2 = await post(app, '/api/laporan', tok, rinci([{ jenis: 'TOL', nominal: 0 }]));
    expect(((await r2.json()) as any).message).toContain('Baris 1: nominal harus lebih dari 0.');
    expect(lap.state.rows).toHaveLength(0);
  });

  it('POST: rincian kosong = tanpa pengeluaran (foto struk tidak wajib)', async () => {
    const { app, kv, lap } = setup();
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, rinci([]));
    expect(res.status).toBe(200);
    expect(lap.state.rows[0]).toMatchObject({ biaya_bbm: 0, biaya_toll: 0, liter_bbm: 0, metode_pembayaran: '' });
  });

  it('PUT: ubah keterangan saja pada laporan terekon diterima (total kartu sama)', async () => {
    const { app, kv, lap, flz } = setup({
      rows: [{ transaction_id: 'TRX-1', tanggal: '2026-09-01', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 100000 }],
      flazzCard: [flazzCard()],
    });
    flz.state.recons.push({ id: 'R-1', card_id: 'FLZ-1', date: '2026-09-02', reconciled_at: '2026-09-02T10:00:00.000Z', is_deleted: '' } as any);
    const tok = await loginAs(kv, PIC);
    const ok = await put(app, '/api/laporan/TRX-1', tok, { rincian: [
      { jenis: 'BBM', nominal: 60000, kartu: 'FLZ-1', keterangan: 'SPBU A' }, { jenis: 'BBM', nominal: 40000, kartu: 'FLZ-1', keterangan: 'SPBU B' },
    ] });
    expect(ok.status).toBe(200);
    expect(lap.state.rows[0]!.rincian).toHaveLength(2);
    const tolak = await put(app, '/api/laporan/TRX-1', tok, { rincian: [{ jenis: 'BBM', nominal: 90000, kartu: 'FLZ-1' }] });
    expect(tolak.status).toBe(409);
  });

  it('PUT klien lama (tanpa rincian) yang mengubah biaya mengosongkan rincian', async () => {
    const { app, kv, lap } = setup({ rows: [{ transaction_id: 'TRX-1', rincian: [{ jenis: 'BBM', nominal: 100000, kartu: '', keterangan: 'x' }] }] });
    const tok = await loginAs(kv, PIC);
    await put(app, '/api/laporan/TRX-1', tok, { biaya_bbm: 90000 });
    expect(lap.state.rows[0]!.rincian).toEqual([]);
  });
});
```
Catatan: periksa nama state rekonsiliasi di `memFlazz` (`tests/helpers.ts`) — sesuaikan `flz.state.recons` bila namanya berbeda (mis. `reconciliations`), dan pastikan `laporanRow()` meneruskan `rincian` (ia memakai spread `...over`, jadi sudah).
- [x] **Step 2:** `npx vitest run tests/routes/laporan.test.ts -t rincian` → FAIL.
- [x] **Step 3: Implementasi** di `src/routes/laporan.ts`:

Import: `import * as R from '../logic/rincian';`

Helper (di atas `laporanRoutes`, dekat `assertBelumDirekon`):
```ts
// Rincian per nota -> field slot lama di payload (p dimutasi). Kembalikan item bersih atau null bila
// klien tidak mengirim rincian (klien lama). Galat validasi -> 400.
function terapkanRincian(p: Record<string, unknown>, labelKartu: (id: string) => string): R.RincianItem[] | null {
  if (p.rincian === undefined) return null;
  const { items, galat } = R.normalRincian(p.rincian);
  const { slot, galat: galatSlot } = R.rincianKeSlot(items, labelKartu);
  const semua = [...galat, ...(galat.length ? [] : galatSlot)];
  if (semua.length) throw new HttpError(400, semua.join(' '), 'BAD_REQUEST');
  Object.assign(p, slot);
  return items;
}
```

POST — tepat setelah `const p = await readJson(c);`:
```ts
    const kartuNama = (await loadCards(deps)).cardMap;
    const rincian = terapkanRincian(p, (id) => kartuNama.get(L.canonicalCardId(id))?.card_name || id);
```
dan pada objek `row: LaporanInsert` tambahkan `rincian: rincian ?? [],` setelah `biaya_toll_2`.

PUT — tepat setelah `const p = await readJson(c);`:
```ts
    const kartuNama = (await loadCards(deps)).cardMap;
    const rincian = terapkanRincian(p, (id) => kartuNama.get(L.canonicalCardId(id))?.card_name || id);
```
dan setelah objek `patch` dibuat (sebelum `if (p.km_awal !== undefined …`):
```ts
    const KOLOM_BAYAR = ['metode_pembayaran', 'flazz_card_id', 'biaya_bbm', 'metode_toll', 'flazz_card_id_toll', 'biaya_toll', 'flazz_card_id_2', 'biaya_bbm_2', 'flazz_card_id_toll_2', 'biaya_toll_2'];
    // Klien lama mengubah pembayaran tanpa rincian -> rincian dikosongkan agar tidak basi.
    if (rincian) patch.rincian = rincian;
    else if (KOLOM_BAYAR.some((k) => p[k] !== undefined)) patch.rincian = [];
```
Pada PUT, slot dari rincian selalu mengirim `metode_pembayaran` & `flazz_card_id` eksplisit; bila `metode_pembayaran === 'TUNAI'` dan `biaya_bbm === 0`, patch yang ada sudah menyimpan `''` (aturan `(newBiaya > 0 || newMetode === 'FLAZZ') ? newMetode : ''`).
- [x] **Step 4:** `npx vitest run tests/routes/laporan.test.ts` → PASS (semua, termasuk tes lama).
- [x] **Step 5:** `npm test && npm run typecheck`, centang, CHANGELOG, commit `feat(laporan): simpan & edit rincian pengeluaran per nota`, push.

**Catatan implementasi:** fixture rekon memakai `flz.state.reconciliations` (nama state di `memFlazz`) dengan baris `FlazzReconciliationRow` lengkap (`is_deleted: '0'`); tes PUT terekon juga memastikan `biaya_bbm` tak berubah setelah 409. Ditambah tes "PUT tanpa field pembayaran mempertahankan rincian". `KOLOM_BAYAR` dijadikan konstanta modul (bukan di dalam handler). Galat slot (3 cara bayar) hanya dilaporkan bila tidak ada galat baris.

---

### Task 4: Lepas Flazz ikut mengubah rincian + `rincian` di daftar transaksi

**Files:**
- Modify: `src/routes/laporan.ts` (DELETE `/:id/flazz`), `src/logic/laporan.ts` (`RecentItem`, `buildRecentList`)
- Test: `tests/routes/laporan.test.ts`, `tests/logic/laporan.test.ts`

- [x] **Step 1: Tes gagal**
`tests/routes/laporan.test.ts` (dalam `describe('rincian pengeluaran')`):
```ts
  it('Lepas Flazz: baris BBM kartu itu jadi tunai, baris tol tetap', async () => {
    const { app, kv, lap } = setup({
      rows: [{ transaction_id: 'TRX-1', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 100000, metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-1', biaya_toll: 5000,
        rincian: [{ jenis: 'BBM', nominal: 100000, kartu: 'FLZ-1', keterangan: 'A' }, { jenis: 'TOL', nominal: 5000, kartu: 'FLZ-1', keterangan: 'B' }] }],
      flazzCard: [flazzCard()],
    });
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/laporan/TRX-1/flazz', { method: 'DELETE', headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    expect(lap.state.rows[0]!.rincian).toEqual([
      { jenis: 'BBM', nominal: 100000, kartu: '', keterangan: 'A' }, { jenis: 'TOL', nominal: 5000, kartu: 'FLZ-1', keterangan: 'B' },
    ]);
  });
```
`tests/logic/laporan.test.ts` — tes `buildRecentList` memuat `rincian` & `rincian_lama` (pakai fixture yang sudah ada di file itu; tambahkan satu `it`):
```ts
  it('buildRecentList menyertakan rincian (laporan lama: turunan slot, rincian_lama true)', () => {
    const [a] = buildRecentList([laporanRow({ biaya_bbm: 50000 })], new Map(), new Map(), new Map());
    expect(a!.rincian).toEqual([{ jenis: 'BBM', nominal: 50000, kartu: '', keterangan: '' }]);
    expect(a!.rincian_lama).toBe(true);
  });
```
(Impor `laporanRow` dari `../helpers` bila belum.)
- [x] **Step 2:** jalankan kedua file tes → FAIL.
- [x] **Step 3: Implementasi**

DELETE `/:id/flazz` — setelah `if (lepas2) { … }` dan sebelum `await deps.laporan.update(id, patch);`:
```ts
    if (Array.isArray(old.rincian) && old.rincian.length) {
      const dilepas = [lepas1 ? cardBbm : '', lepas2 ? cardBbm2 : ''].filter(Boolean).map((x) => L.canonicalCardId(x));
      patch.rincian = old.rincian.map((it) => (it.jenis === 'BBM' && it.kartu && dilepas.includes(L.canonicalCardId(it.kartu)) ? { ...it, kartu: '' } : it));
    }
```
dan pada rollback `deps.laporan.update(id, { … })` tambahkan `rincian: old.rincian ?? []`.

`src/logic/laporan.ts`: di `RecentItem` tambahkan
```ts
  rincian: RincianItem[];
  // true = laporan lama tanpa rincian; baris diturunkan dari slot.
  rincian_lama: boolean;
```
dan di `buildRecentList` sebelum `result.push({`:
```ts
    const rc = rincianDariRow(row);
```
lalu di objek push: `rincian: rc.items, rincian_lama: rc.lama,`. Import `rincianDariRow` dari `./rincian` (impor sirkular aman: `rincian.ts` hanya memakai fungsi `laporan.ts` saat dipanggil, bukan saat modul dimuat).
- [x] **Step 4:** tes → PASS.
- [x] **Step 5:** `npm test && npm run typecheck`, centang, CHANGELOG, commit `feat(laporan): lepas Flazz memperbarui rincian; rincian di daftar transaksi`, push.

---

> Catatan: tes `buildRecentList` memakai fixture `row` lokal di `tests/logic/laporan.test.ts` (bukan `laporanRow`). Impor sirkular `laporan.ts` <-> `rincian.ts` berjalan baik di vitest dan tsc.

### Task 5: Rekap per nota + kolom Keterangan

**Files:**
- Modify: `src/logic/rekap.ts`, `static/js/pages/rekap.js`
- Test: `tests/logic/rekap.test.ts`, `tests/frontend/rekap-helpers.test.ts`

- [x] **Step 1: Tes gagal**
`tests/logic/rekap.test.ts`:
```ts
  it('laporan berincian: 1 line per nota dengan keterangan; laporan lama diberi keterangan penanda', () => {
    const rows = [
      laporanRow({ transaction_id: 'TRX-1', tanggal: '2026-10-05', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 300, metode_toll: 'TUNAI', biaya_toll: 50,
        rincian: [{ jenis: 'BBM', nominal: 100, kartu: 'FLZ-1', keterangan: 'SPBU A' }, { jenis: 'BBM', nominal: 200, kartu: 'FLZ-1', keterangan: 'SPBU B' }, { jenis: 'TOL', nominal: 50, kartu: '', keterangan: 'GT' }] }),
      laporanRow({ transaction_id: 'TRX-2', tanggal: '2026-10-05', biaya_bbm: 70 }),
    ];
    const lines = rekapPengeluaran({ rows, tols: [{ id: 'T-1', date: '2026-10-05', card_id: 'FLZ-1', driver_id: 'x', vehicle_id: 'V-1', amount: 9, notes: 'tol manual' }], cards: [{ id: 'FLZ-1', card_name: 'E1', branch_id: 'CBG-A' }], platByVehicle: new Map(), dari: '2026-10-01', sampai: '2026-10-31', cabang: '' });
    expect(lines.map((l) => [l.ref, l.jenis, l.metode, l.amount, l.keterangan])).toEqual(expect.arrayContaining([
      ['TRX-1', 'BBM', 'ETOLL', 100, 'SPBU A'], ['TRX-1', 'BBM', 'ETOLL', 200, 'SPBU B'], ['TRX-1', 'TOL', 'TUNAI', 50, 'GT'],
      ['TRX-2', 'BBM', 'TUNAI', 70, '(total, tanpa rincian)'], ['T-1', 'TOL', 'ETOLL', 9, 'tol manual'],
    ]));
    expect(lines).toHaveLength(5);
  });
```
(Impor `laporanRow` dari `../helpers` bila belum.)

`tests/frontend/rekap-helpers.test.ts` — perbarui tes Excel: fixture `L` mendapat `keterangan: ''`, ganti harapan baris Detail menjadi
```ts
    expect(XLSX.utils.sheet_to_json(det, { header: 1 })[1]).toEqual([1, '01/10/2026', 'WHO BANDUNG (BDG)', 'D 1 A', 'Agus', 'BBM', 'Etoll', 'E toll 1', 200000, '-', 'Laporan harian', 'TRX-1']);
    expect(det['!autofilter']!.ref).toBe('A1:L5');
```
dan tambahkan:
```ts
  it('nama file rekap: rentang + kode warehouse', () => {
    expect(namaFileRekap('2026-10-01', '2026-10-21', 'CKR')).toBe('rekap-pengeluaran-2026-10-01_2026-10-21-CKR.xlsx');
    expect(namaFileRekap('2026-10-01', '2026-10-21', '')).toBe('rekap-pengeluaran-2026-10-01_2026-10-21.xlsx');
  });
```
(tambahkan `namaFileRekap` ke impor).
- [x] **Step 2:** kedua file tes → FAIL.
- [x] **Step 3: Implementasi**

`src/logic/rekap.ts`:
- `RekapLine` tambah `keterangan: string;`; `RekapTol` tambah `notes?: string;`.
- Import `rincianDariRow` dari `./rincian`; konstanta `export const KET_TANPA_RINCIAN = '(total, tanpa rincian)';`.
- Ganti loop `for (const g of cardGroups(r)) { … }` dengan:
```ts
    const { items, lama } = rincianDariRow(r);
    for (const it of items) {
      if (!(num(it.nominal) > 0)) continue;
      const cid = String(it.kartu || '');
      out.push({
        ...base, jenis: it.jenis, metode: cid ? 'ETOLL' : 'TUNAI',
        card_id: cid ? (kartuById.get(canonicalCardId(cid))?.id ?? cid) : '', kartu: cid ? labelKartu(cid) : '',
        amount: num(it.nominal), keterangan: lama ? KET_TANPA_RINCIAN : String(it.keterangan ?? ''),
      });
    }
```
  (Hapus impor `cardGroups` bila tidak terpakai lagi.) Pada tol manual tambahkan `keterangan: String(t.notes ?? '')`.

`static/js/pages/rekap.js`:
```js
export function namaFileRekap(dari, sampai, kodeWh) {
  return `rekap-pengeluaran-${dari}_${sampai}${kodeWh ? '-' + kodeWh : ''}.xlsx`;
}
```
- Sheet Detail: header `[..., 'Nominal (Rp)', 'Keterangan', 'Sumber', 'Referensi']`, baris `..., Number(l.amount) || 0, t(l.keterangan) || '-', l.sumber === 'TOL_MANUAL' ? …`, baris TOTAL `['', '', '', '', '', '', '', 'TOTAL', r.total, '', '', '']`. `angka: { kolom: [8] }` tetap.
- Tabel Detail di layar: tambah header `'Keterangan'` setelah `'Nominal'` (indeks kolom kanan tetap 7) dan sel `el('td', { class: 'small text-muted', text: l.keterangan || '-' })`.
- Tombol unduh memakai `namaFileRekap(d, s, kodeWh)`.
- [x] **Step 4:** tes → PASS.
- [x] **Step 5:** `npm test && npm run typecheck`, centang, CHANGELOG, commit `feat(rekap): detail per nota dan kolom keterangan`, push.

---

> Catatan: tes logika memakai fixture `row` lokal di `tests/logic/rekap.test.ts` (bukan `laporanRow`) dan `...dasar`; `RekapTol.notes` sudah terisi dari `FlazzTolRow.notes` lewat rute yang ada (tanpa perubahan rute).

---

### Task 6: Helper & komponen tabel rincian (`static/js/rincian.js`)

**Files:**
- Create: `static/js/rincian.js`
- Test: `tests/frontend/rincian-helpers.test.ts`

- [x] **Step 1: Tes gagal** — `tests/frontend/rincian-helpers.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { ringkasRincian, validasiRincian, bersihkanRincian } from '../../static/js/rincian.js';

const B = (jenis: string, nominal: unknown, kartu = '', keterangan = '') => ({ jenis, nominal, kartu, keterangan });

describe('rincian (klien)', () => {
  it('bersihkanRincian membuang baris kosong total (nominal & keterangan kosong)', () => {
    expect(bersihkanRincian([B('BBM', ''), B('TOL', '5000', '', ' GT ')])).toEqual([{ jenis: 'TOL', nominal: 5000, kartu: '', keterangan: 'GT' }]);
  });
  it('ringkasan total BBM, tol, dan per kartu', () => {
    const r = ringkasRincian([B('BBM', 200000, 'FLZ-1'), B('TOL', 15500, 'FLZ-1'), B('BBM', 50000)]);
    expect(r).toEqual({ bbm: 250000, tol: 15500, perKartu: { 'FLZ-1': 215500 }, jumlah: 3 });
  });
  it('validasi sama dengan server: nominal, keterangan, maks 30, maks 2 cara bayar', () => {
    expect(validasiRincian([B('BBM', 0)])).toEqual(['Baris 1: nominal harus lebih dari 0.']);
    expect(validasiRincian([B('TOL', 1, '', 'x'.repeat(101))])).toEqual(['Baris 1: keterangan maksimal 100 karakter.']);
    expect(validasiRincian(Array.from({ length: 31 }, () => B('BBM', 1)))).toEqual(['Rincian pengeluaran maksimal 30 baris.']);
    expect(validasiRincian([B('TOL', 1, 'A'), B('TOL', 1, 'B'), B('TOL', 1)], (id: string) => `Etoll ${id}`))
      .toEqual(['Tol dibayar dengan 3 cara (Etoll A, Etoll B, Tunai). Maksimal 2 cara per jenis — gabungkan atau pindahkan salah satu.']);
  });
});
```
- [x] **Step 2:** `npx vitest run tests/frontend/rincian-helpers.test.ts` → FAIL.
- [x] **Step 3: Implementasi** `static/js/rincian.js`:
```js
import { el, fmtNum, bantuRupiah } from './ui.js';

// Rincian pengeluaran per nota (spec 2026-10-21). Validasi sama dengan server (src/logic/rincian.ts).
export const MAKS_BARIS = 30;
export const MAKS_KETERANGAN = 100;
const kanonis = (id) => String(id ?? '').trim().replace(/-/g, '');

// Baris yang nominal & keterangannya kosong dianggap belum diisi dan dibuang.
export function bersihkanRincian(rows) {
  return (rows || [])
    .filter((r) => String(r.nominal ?? '').trim() !== '' || String(r.keterangan ?? '').trim() !== '')
    .map((r) => ({ jenis: String(r.jenis || 'BBM').toUpperCase(), nominal: Math.round(Number(r.nominal) || 0), kartu: String(r.kartu || '').trim(), keterangan: String(r.keterangan || '').trim() }));
}

export function ringkasRincian(items) {
  const perKartu = {};
  let bbm = 0;
  let tol = 0;
  for (const it of items || []) {
    const n = Number(it.nominal) || 0;
    if (it.jenis === 'BBM') bbm += n; else tol += n;
    if (it.kartu) perKartu[it.kartu] = (perKartu[it.kartu] || 0) + n;
  }
  return { bbm, tol, perKartu, jumlah: (items || []).length };
}

export function validasiRincian(items, labelKartu = (id) => id) {
  const list = items || [];
  if (list.length > MAKS_BARIS) return [`Rincian pengeluaran maksimal ${MAKS_BARIS} baris.`];
  const err = [];
  list.forEach((it, i) => {
    if (it.jenis !== 'BBM' && it.jenis !== 'TOL') err.push(`Baris ${i + 1}: jenis harus BBM atau Tol.`);
    if (!(Number(it.nominal) > 0)) err.push(`Baris ${i + 1}: nominal harus lebih dari 0.`);
    if (String(it.keterangan || '').length > MAKS_KETERANGAN) err.push(`Baris ${i + 1}: keterangan maksimal ${MAKS_KETERANGAN} karakter.`);
  });
  if (err.length) return err;
  for (const [jenis, label] of [['BBM', 'BBM'], ['TOL', 'Tol']]) {
    const sumber = new Map();
    for (const it of list) if (it.jenis === jenis) sumber.set(it.kartu ? kanonis(it.kartu) : 'TUNAI', it.kartu);
    if (sumber.size > 2) {
      const nama = [...sumber.values()].map((k) => (k ? labelKartu(k) : 'Tunai')).join(', ');
      err.push(`${label} dibayar dengan ${sumber.size} cara (${nama}). Maksimal 2 cara per jenis — gabungkan atau pindahkan salah satu.`);
    }
  }
  return err;
}

// Komponen tabel rincian. opsiKartu: [{ value, label }]; awal: item rincian.
// onUbah() dipanggil setiap isi berubah (untuk liter & ringkasan di halaman).
export function tabelRincian({ opsiKartu = [], awal = [], onUbah = () => {} } = {}) {
  let kartu = opsiKartu;
  const badan = el('div', { class: 'rincian-baris-wrap' });
  const ringkas = el('div', { class: 'form-text mb-2', 'aria-live': 'polite' });
  const tambah = el('button', { type: 'button', class: 'btn btn-outline-primary btn-sm mb-2', text: '+ Tambah baris' });

  const isiBayar = (sel, nilai) => {
    sel.replaceChildren(el('option', { value: '', text: 'Tunai' }), ...kartu.map((k) => el('option', { value: String(k.value), text: String(k.label) })));
    if (nilai && !kartu.some((k) => String(k.value) === String(nilai))) sel.appendChild(el('option', { value: String(nilai), text: `${nilai} (tidak ada di jalur)` }));
    sel.value = String(nilai || '');
  };

  function baris(it = { jenis: 'BBM', nominal: '', kartu: '', keterangan: '' }) {
    const jenis = el('select', { class: 'form-select', 'aria-label': 'Jenis' }, [el('option', { value: 'BBM', text: 'BBM' }), el('option', { value: 'TOL', text: 'Tol' })]);
    jenis.value = it.jenis === 'TOL' ? 'TOL' : 'BBM';
    const nominal = el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', min: '1', placeholder: 'Nominal', 'aria-label': 'Nominal (Rp)', value: String(it.nominal ?? '') });
    const bayar = el('select', { class: 'form-select', 'aria-label': 'Dibayar' });
    isiBayar(bayar, it.kartu);
    const ket = el('input', { class: 'form-control', maxlength: String(MAKS_KETERANGAN), placeholder: 'SPBU / gerbang tol (opsional)', 'aria-label': 'Keterangan', value: String(it.keterangan ?? '') });
    const hapus = el('button', { type: 'button', class: 'btn btn-outline-danger', title: 'Hapus baris', 'aria-label': 'Hapus baris' }, [el('i', { class: 'bi bi-trash', 'aria-hidden': 'true' })]);
    const r = el('div', { class: 'rincian-baris row g-2 mb-2 align-items-start' }, [
      el('div', { class: 'col-4 col-md-2' }, [jenis]),
      el('div', { class: 'col-8 col-md-3' }, [nominal, bantuRupiah(nominal)]),
      el('div', { class: 'col-6 col-md-3' }, [bayar]),
      el('div', { class: 'col-6 col-md-3' }, [ket]),
      el('div', { class: 'col-12 col-md-1 text-end' }, [hapus]),
    ]);
    r._ambil = () => ({ jenis: jenis.value, nominal: nominal.value, kartu: bayar.value, keterangan: ket.value });
    r._bayar = bayar;
    hapus.addEventListener('click', () => { r.remove(); perbarui(); badan.dispatchEvent(new Event('change', { bubbles: true })); });
    return r;
  }

  const semuaBaris = () => [...badan.querySelectorAll('.rincian-baris')];
  const ambil = () => bersihkanRincian(semuaBaris().map((r) => r._ambil()));
  function perbarui() {
    const s = ringkasRincian(ambil());
    const labelKartu = (id) => kartu.find((k) => String(k.value) === id)?.label || id;
    ringkas.replaceChildren(
      `Total BBM Rp ${fmtNum(s.bbm)} · Total tol Rp ${fmtNum(s.tol)}`,
      ...Object.entries(s.perKartu).map(([id, n]) => el('div', { text: `${labelKartu(id)}: terpakai Rp ${fmtNum(n)}` })),
    );
    tambah.disabled = semuaBaris().length >= MAKS_BARIS;
    onUbah();
  }
  tambah.addEventListener('click', () => { badan.appendChild(baris()); perbarui(); semuaBaris().at(-1)?.querySelector('input')?.focus(); });
  badan.addEventListener('input', perbarui);
  badan.addEventListener('change', perbarui);

  for (const it of awal) badan.appendChild(baris(it));
  if (!awal.length) badan.appendChild(baris());
  perbarui();

  return {
    elemen: el('div', {}, [badan, tambah, ringkas]),
    ambil,
    isi(items) { badan.replaceChildren(...(items.length ? items : [undefined]).map((x) => baris(x))); perbarui(); },
    setKartu(list) { kartu = list; for (const r of semuaBaris()) isiBayar(r._bayar, r._bayar.value); perbarui(); },
  };
}
```
Catatan: `bantuRupiah` diimpor dari `ui.js` (sudah dipakai input.js). Komponen tidak dites (butuh DOM); diuji manual di Task 8/13.
- [x] **Step 4:** tes → PASS.
- [x] **Step 5:** `npm test && npm run typecheck`, centang, CHANGELOG, commit `feat(ui): helper dan komponen tabel rincian pengeluaran`, push.


Catatan penyimpangan: tidak ada; kode sesuai rencana (labelKartu di `perbarui()` memakai daftar `kartu` terkini).

---

### Task 7: Input Laporan memakai tabel rincian

**Files:**
- Modify: `static/js/pages/input.js`
- Test: `tests/frontend/input-helpers.test.ts`

- [x] **Step 1: Tes gagal** — di `tests/frontend/input-helpers.test.ts`:
  - `DASAR`: hapus `biaya_bbm, biaya_toll, metode_pembayaran, flazz_card_id, metode_toll, flazz_card_id_toll`; tambah `rincian: [{ jenis: 'BBM', nominal: 120000, kartu: '', keterangan: '' }]`, `ada_struk_bbm: true`, `ada_struk_tol: true`.
  - Hapus tes lama metode/kartu/grup-2 (`metode_pembayaran: 'FLAZZ'`, `biaya_toll: '5000'… metode_toll`, `buildPayload mengirim field grup-2`, `buildPayload tanpa grup-2`, `validateForm menolak nominal grup-2…`, `validateForm menerima nominal grup-2…`) dan ganti dengan:
```ts
describe('validateForm + rincian', () => {
  it('galat rincian ikut', () => {
    expect(validateForm({ ...DASAR, rincian: [{ jenis: 'BBM', nominal: 0, kartu: '', keterangan: '' }] })).toContain('Baris 1: nominal harus lebih dari 0.');
  });
  it('struk wajib per jenis yang ada', () => {
    expect(validateForm({ ...DASAR, ada_struk_bbm: false })).toContain('Foto struk BBM wajib diupload karena ada biaya BBM.');
    expect(validateForm({ ...DASAR, rincian: [{ jenis: 'TOL', nominal: 5000, kartu: '', keterangan: '' }], ada_struk_tol: false, ada_struk_bbm: false }))
      .toEqual(['Foto struk / bukti tol wajib diupload karena ada biaya tol.']);
  });
  it('BBM tanpa jenis BBM ditolak', () => {
    expect(validateForm({ ...DASAR, harga_bbm: 0 })).toContain('Pilih jenis BBM agar liter terhitung.');
  });
});
describe('buildPayload + rincian', () => {
  it('mengirim rincian, tanpa field slot', () => {
    const p = buildPayload(DASAR, { files: {}, km_awal: '', km_akhir: '' });
    expect(p.rincian).toEqual(DASAR.rincian);
    expect(p).not.toHaveProperty('biaya_bbm');
    expect(p).not.toHaveProperty('flazz_card_id_2');
  });
});
```
  - Tes lama `buildPayload` yang mengharapkan `p.biaya_bbm === 120000` (±L107-110) dan `biaya BBM tanpa jenis BBM ditolak` (±L184) dihapus (digantikan di atas).
- [x] **Step 2:** `npx vitest run tests/frontend/input-helpers.test.ts` → FAIL.
- [x] **Step 3: Implementasi** `static/js/pages/input.js`:
  - Import: `import { tabelRincian, validasiRincian, ringkasRincian } from '../rincian.js';`
  - `validateForm`: hapus blok `biaya` (biaya BBM negatif), blok metode/kartu Flazz, blok grup-2; ganti blok struk/jenis dengan:
```js
  const rincian = v.rincian || [];
  err.push(...validasiRincian(rincian, v.label_kartu));
  const { bbm, tol } = ringkasRincian(rincian);
  // Bukti wajib (sama dengan server): struk BBM bila ada biaya BBM, bukti tol bila ada biaya tol.
  if (v.ada_struk_bbm === false && bbm > 0) err.push('Foto struk BBM wajib diupload karena ada biaya BBM.');
  if (v.ada_struk_tol === false && tol > 0) err.push('Foto struk / bukti tol wajib diupload karena ada biaya tol.');
  if (v.harga_bbm !== undefined && bbm > 0 && !(Number(v.harga_bbm) > 0)) err.push('Pilih jenis BBM agar liter terhitung.');
```
  - `buildPayload`: hapus field `biaya_bbm … biaya_toll_2` dan `metode_*`/`flazz_card_id*`; tambah `rincian: v.rincian || [],`.
  - `renderInput`: hapus `f.biaya_bbm, f.metode_pembayaran, f.flazz_card_id, f.biaya_toll, f.metode_toll, f.flazz_card_id_toll, f.biaya_bbm_2, f.flazz_card_id_2, f.biaya_toll_2, f.flazz_card_id_toll_2`, `grup2Wrap`, `grup2Toggle`, `bukaGrup2`, listener metode, dan `isiKartu`/`pilihKartu` untuk select kartu. Ganti dengan:
```js
  let kartuBoleh = cards;
  const tabel = tabelRincian({ opsiKartu: opsiKartu(cards), onUbah: () => hitungUlangLiter() });
  const hitungUlangLiter = () => { f.liter_bbm.value = hitungLiter(ringkasRincian(tabel.ambil()).bbm, hargaBbm()); };
  function isiKartu(daftar) { kartuBoleh = daftar; tabel.setKartu(opsiKartu(daftar)); }
```
    (deklarasikan `hitungUlangLiter` sebagai `function` agar bisa dipanggil sebelum didefinisikan, atau buat `tabel` setelah `hitungUlangLiter`; `f.jenis_bbm` tetap memicu `hitungUlangLiter`).
  - Seksi form: ganti seksi `'Pembelian BBM'`, `'Tol'`, `grup2Toggle`, `grup2Wrap` dengan:
```js
    seksi('Pengeluaran BBM & Tol', [
      el('div', { class: 'form-text mb-2', text: 'Isi satu baris per nota. Dibayar: kartu etoll yang dibawa di jalur, atau Tunai. Maks. 2 cara bayar per jenis.' }),
      tabel.elemen,
      el('div', { class: 'row' }, [
        el('div', { class: 'col-md-6' }, [baris('Jenis BBM', f.jenis_bbm)]),
        el('div', { class: 'col-md-6' }, [baris('Liter BBM', satuan(f.liter_bbm, '', 'L'), 'Otomatis: total BBM ÷ harga per liter')]),
      ]),
      el('div', { class: 'row' }, [
        el('div', { class: 'col-md-6' }, [baris('Foto struk BBM (gabungan semua struk)', el('div', {}, [fotoStrukBbm, pratinjauFoto(fotoStrukBbm)]), 'Wajib bila ada baris BBM. Susun semua struk lalu foto sekaligus.')]),
        el('div', { class: 'col-md-6' }, [baris('Foto bukti tol (gabungan semua bukti)', el('div', {}, [fotoStrukTol, pratinjauFoto(fotoStrukTol)]), 'Wajib bila ada baris tol. E-toll tanpa struk: foto cetak cek pengeluaran kartu.')]),
      ]),
    ]),
```
  - `onSupirChange`: hapus pengisian metode/kartu tol/grup-2; cukup `isiKartu(kartuJalur(cards, adaJalur ? jalur : null));`.
  - Draft: `FIELD_DRAFT = ['tanggal', 'km_awal', 'km_akhir', 'bar_awal', 'bar_akhir', 'jenis_bbm']`; `ambilNilai` tambah `v.rincian = tabel.ambil();`; `FIELD_BERDEFAULT = ['tanggal', 'jenis_bbm']`; `terapkanDraft`: hapus dispatch biaya & `bukaGrup2`, tambah `if (Array.isArray(v.rincian)) tabel.isi(v.rincian);` sebelum `hitungUlangLiter()`. (Draft lama berisi `biaya_bbm` dsb. diabaikan karena field-nya tidak ada lagi di `f` — loop `FIELD_DRAFT` hanya membaca kunci yang tersisa.)
  - Submit `values`: hapus field pembayaran lama; tambah
```js
      rincian: tabel.ambil(),
      label_kartu: (id) => opsiKartu(kartuBoleh).find((k) => String(k.value) === id)?.label || id,
```
- [x] **Step 4:** `npx vitest run tests/frontend/input-helpers.test.ts` → PASS; `npm test && npm run typecheck`.
- [x] **Step 5: Cek manual** (ditunda ke deploy — `.dev.vars` tidak tersedia) `npm run dev` (butuh `.dev.vars`), buka Input Laporan: tambah/hapus baris, total & liter berubah, pilihan "Dibayar" berisi kartu jalur, galat 3 cara bayar muncul, simpan sukses. Bila `.dev.vars` tidak tersedia, catat "cek manual ditunda ke deploy" di CHANGELOG.
- [x] **Step 6:** centang, CHANGELOG (UX), commit `feat(input): pengeluaran diisi per nota`, push.


Catatan penyimpangan:
- `tabel` dibuat setelah `function hitungUlangLiter`; `onUbah` memakai penjaga `if (tabel)` karena `perbarui()` dipanggil di dalam `tabelRincian()` sebelum `tabel` terisi.
- Draft hanya menyimpan `rincian` bila tabel tidak kosong (`[]` dihitung "sudah ada isi" oleh `simpanDraft`, sehingga form kosong akan tersimpan sebagai draft).
- Tes tambahan: galat 3 cara bayar memakai `label_kartu`; tes "bukti wajib di form" disesuaikan ke `rincian`.
- Import `bantuRupiah` dihapus dari input.js (kini hanya dipakai di `rincian.js`).
- Gerbang review (/ui-ux-pro-max, /code-review) dijalankan di Task 13 sesuai rencana.

---

### Task 8: Edit Laporan memakai tabel rincian

**Files:**
- Modify: `static/js/pages/edit.js`
- Test: `tests/frontend/edit-helpers.test.ts`

- [x] **Step 1: Tes gagal** — `tests/frontend/edit-helpers.test.ts`:
  - `NILAI`: hapus field pembayaran lama, tambah `rincian: [{ jenis: 'BBM', nominal: 100000, kartu: '', keterangan: '' }]`.
  - Ganti harapan `validateEdit({ ...NILAI, metode_pembayaran: 'FLAZZ' })` dengan
```ts
    expect(validateEdit({ ...NILAI, rincian: [{ jenis: 'BBM', nominal: -1, kartu: '', keterangan: '' }] })).toContain('Baris 1: nominal harus lebih dari 0.');
```
  - Ganti `toMatchObject({ …, biaya_bbm_2: 0 })` pada tes `bodyEdit` dengan `toMatchObject({ tanggal: '2026-10-05', nama_supir: 'Supir A', bar_awal: 8, bar_akhir: 4, liter_bbm: 10, rincian: NILAI.rincian })` dan tambah `expect(b).not.toHaveProperty('biaya_bbm');`.
- [x] **Step 2:** tes → FAIL.
- [x] **Step 3: Implementasi** `static/js/pages/edit.js`:
  - Import `tabelRincian, validasiRincian, ringkasRincian` dari `'../rincian.js'`.
  - `validateEdit`: ganti baris Flazz dengan `err.push(...validasiRincian(v.rincian || [], v.label_kartu));`.
  - `bodyEdit`: hapus `metode_pembayaran … biaya_toll_2`; tambah `rincian: v.rincian || [],`.
  - `renderEdit`: hapus select/inputs pembayaran lama & grup-2; buat
```js
  const tabel = tabelRincian({ opsiKartu: opsiKartu(cards), awal: Array.isArray(trx.rincian) ? trx.rincian : [], onUbah: () => hitungUlangLiter() });
  function hitungUlangLiter() {
    const total = ringkasRincian(tabel.ambil()).bbm;
    const harga = bbmOpsi.find((o) => o.value === jenisBbm.value)?.harga || 0;
    if (!(total > 0)) liter.value = '0';
    else if (harga > 0) liter.value = hitungLiter(total, harga);
  }
```
    `jenisBbm.value = tebakJenisBbm(bbmOpsi, Number(trx.total_bbm || 0), trx.isi_bbm) || …` (total_bbm = BBM grup-1+2 dari `RecentItem`).
  - Bagian form "Pembayaran" + "Kartu ke-2" diganti:
```js
    el('h3', { class: 'h6 mt-2', text: 'Pengeluaran BBM & Tol' }),
    trx.rincian_lama ? el('div', { class: 'form-text mb-2', text: 'Laporan lama: total dipecah otomatis menjadi baris. Boleh dirinci per nota.' }) : null,
    tabel.elemen,
    el('div', { class: 'row' }, [kol(6, baris('Jenis BBM', jenisBbm))]),
```
  - Submit `values`: ganti field pembayaran dengan `rincian: tabel.ambil(), label_kartu: (id) => opsiKartu(cards).find((k) => String(k.value) === id)?.label || id,`.
  - Label foto struk diubah "(gabungan semua struk)" seperti Input.
- [x] **Step 4:** tes → PASS; `npm test && npm run typecheck`.
- [x] **Step 5:** cek manual (ditunda ke deploy — `.dev.vars` tidak tersedia) edit laporan lama (baris turunan tampil) & laporan baru; centang, CHANGELOG, commit `feat(edit): edit pengeluaran per nota`, push.

Catatan penyimpangan:
- Sama dengan Task 7: `tabel` dibuat setelah `function hitungUlangLiter` dengan penjaga `if (tabel)` di `onUbah`, sehingga liter tersimpan (`isi_bbm`) tidak ditimpa saat form dimuat.
- `total_bbm` di `RecentItem` sudah grup-1 + grup-2 (`rowBbmTotal`), jadi dipakai langsung untuk `tebakJenisBbm`.
- Ditambah petunjuk "Isi satu baris per nota…" di atas tabel dan hint liter "Otomatis: total BBM ÷ harga per liter" (selaras Input); import `bantuRupiah` dihapus dari edit.js.
- Kartu pilihan = semua `master.flazzCards` (seperti edit lama); kartu tersimpan yang tidak ada di daftar tampil "(tidak ada di jalur)" oleh komponen.

---

### Task 9: Rincian di History Laporan

**Files:**
- Modify: `static/js/pages/transaksi.js`
- Test: `tests/frontend/transaksi-helpers.test.ts` (baru)

- [x] **Step 1: Tes gagal**
```ts
import { describe, expect, it } from 'vitest';
import { teksBarisRincian } from '../../static/js/pages/transaksi.js';

describe('teksBarisRincian', () => {
  it('format satu nota: jenis, nominal, dibayar, keterangan', () => {
    const label = (id: string) => (id === 'FLZ-1' ? 'Etoll A' : id);
    expect(teksBarisRincian({ jenis: 'BBM', nominal: 200000, kartu: 'FLZ-1', keterangan: 'SPBU A' }, label)).toBe('BBM · Rp 200.000 · Etoll A · SPBU A');
    expect(teksBarisRincian({ jenis: 'TOL', nominal: 5000, kartu: '', keterangan: '' }, label)).toBe('Tol · Rp 5.000 · Tunai');
  });
});
```
- [x] **Step 2:** tes → FAIL.
- [x] **Step 3: Implementasi** `static/js/pages/transaksi.js`:
```js
export function teksBarisRincian(it, labelKartu = (id) => id) {
  return [it.jenis === 'TOL' ? 'Tol' : 'BBM', `Rp ${fmtNum(it.nominal)}`, it.kartu ? labelKartu(it.kartu) : 'Tunai', it.keterangan].filter(Boolean).join(' · ');
}

function rincianRingkas(r) {
  const items = Array.isArray(r.rincian) ? r.rincian : [];
  if (!items.length) return null;
  return el('details', { class: 'small mt-1 text-start' }, [
    el('summary', { text: `Rincian (${items.length})${r.rincian_lama ? ' — total, tanpa rincian' : ''}` }),
    el('ul', { class: 'mb-0 ps-3' }, items.map((it) => el('li', { text: teksBarisRincian(it) }))),
  ]);
}
```
  dan di `barisTabel`, sel liter: tambahkan `rincianRingkas(r)` setelah badge `2 kartu`. (Label kartu memakai id; nama kartu tersedia di halaman Flazz — cukup untuk pemeriksaan cepat.)
- [x] **Step 4:** tes → PASS; `npm test && npm run typecheck`.
- [x] **Step 5:** centang, CHANGELOG, commit `feat(history): tampilkan rincian per nota`, push.

> Catatan: tes memakai `fmtNum` asli (id-ID, titik ribuan) sesuai harapan; tanpa penyimpangan. Cek manual UI ditunda ke deploy.

---

### Task 10: Server — status unduh Excel harian

**Files:**
- Modify: `src/logic/tugas.ts`, `src/routes/push.ts`
- Test: `tests/routes/push.test.ts`

- [x] **Step 1: Tes gagal** — di `tests/routes/push.test.ts`:
```ts
import { kunciUnduhRekap, perluUnduhExcel } from '../../src/logic/tugas';

describe('pengingat unduh Excel', () => {
  it('perluUnduhExcel: ada jalur hari ini, semua tugas hari ini selesai, belum unduh', () => {
    const selesai = ringkasTugas([jalur({ status: 'SUDAH_LAPORAN' }), jalur({ id: 'B', flazz_card_id: 'F', status: 'SELESAI' })], HARI);
    expect(selesai.jalur_hari_ini).toBe(2);
    expect(perluUnduhExcel(selesai, false)).toBe(true);
    expect(perluUnduhExcel(selesai, true)).toBe(false);
    expect(perluUnduhExcel(ringkasTugas([jalur({})], HARI), false)).toBe(false);
    expect(perluUnduhExcel(ringkasTugas([], HARI), false)).toBe(false);
    // Tertunggak hari lain tidak menghalangi pengingat hari ini.
    expect(perluUnduhExcel(ringkasTugas([jalur({ status: 'SUDAH_LAPORAN' }), jalur({ id: 'L', tanggal: '2026-10-06' })], HARI), false)).toBe(true);
    expect(kunciUnduhRekap('CBG-A', HARI)).toBe('unduh-rekap:CBG-A:2026-10-07');
  });

  it('GET tugas-hari-ini: unduh_excel true untuk PIC, false setelah POST unduh-harian (audit tercatat)', async () => {
    const hari = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const jl = memJalur([jalur({ tanggal: hari, status: 'SUDAH_LAPORAN' })] as any);
    const { deps, kv, audits } = makeDeps({ jalur: jl.repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, PIC);
    const t1 = (await (await app.request('/api/tugas-hari-ini', { headers: authHeaders(tok) })).json()) as any;
    expect(t1.unduh_excel).toBe(true);
    const res = await app.request('/api/rekap/unduh-harian', { method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(200);
    expect(audits.at(-1)).toMatchObject({ action: 'UNDUH_HARIAN', modul: 'rekap' });
    const t2 = (await (await app.request('/api/tugas-hari-ini', { headers: authHeaders(tok) })).json()) as any;
    expect(t2.unduh_excel).toBe(false);
  });

  it('POST unduh-harian: SUPERADMIN 403', async () => {
    const { deps, kv } = makeDeps({ jalur: memJalur([]).repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, { ...PIC, role: 'SUPERADMIN', cabang: '' });
    const res = await app.request('/api/rekap/unduh-harian', { method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' }, body: '{}' });
    expect(res.status).toBe(403);
  });
});
```
(Pastikan `makeDeps` mengembalikan `audits`; sudah dipakai di `tests/routes/laporan.test.ts`.)
- [x] **Step 2:** tes → FAIL.
- [x] **Step 3: Implementasi**

`src/logic/tugas.ts`:
- `RingkasanTugas` tambah `jalur_hari_ini: number;`.
- Di `ringkasTugas`, hitung `let jalurHariIni = 0;` dan di loop setelah filter cabang: `if (t === hari) jalurHariIni++;`; kembalikan `jalur_hari_ini: jalurHariIni`.
- Tambah:
```ts
// Pengingat unduh Excel (spec 2026-10-21 §3): semua tugas HARI INI selesai & belum diunduh.
export const TTL_UNDUH_REKAP = 8 * 86_400;
export const kunciUnduhRekap = (cabang: string, tanggal: string) => `unduh-rekap:${cabang}:${tgl10(tanggal)}`;
export function perluUnduhExcel(r: RingkasanTugas, sudahUnduh: boolean): boolean {
  return r.jalur_hari_ini > 0 && !r.item.some((i) => i.tanggal === r.tanggal) && !sudahUnduh;
}
```
`src/routes/push.ts`:
- Import `isSuper` dari `'../auth/peran'` dan `kunciUnduhRekap, perluUnduhExcel, TTL_UNDUH_REKAP` dari `'../logic/tugas'`.
- Ganti handler `/tugas-hari-ini`:
```ts
  app.get('/tugas-hari-ini', requireUser(deps), async (c: Ctx) => {
    const u = c.get('user');
    const t = await tugasUntuk(deps, u);
    const pic = !lihatSemuaCabang(u) && !isSuper(u) && !!u.cabang;
    const sudah = pic ? (await deps.kv.get(kunciUnduhRekap(u.cabang, t.tanggal))) !== null : true;
    return c.json(okPayload({ ...t, unduh_excel: pic && perluUnduhExcel(t, sudah) }));
  });

  // Penanda Excel rekap harian sudah diunduh (PIC CABANG, cabang dari sesi).
  app.post('/rekap/unduh-harian', requireUser(deps), async (c: Ctx) => {
    const u = c.get('user');
    if (lihatSemuaCabang(u) || isSuper(u) || !u.cabang) throw new HttpError(403, 'Hanya untuk akun PIC CABANG.', 'FORBIDDEN');
    const tanggal = todayWib();
    await deps.kv.put(kunciUnduhRekap(u.cabang, tanggal), new Date().toISOString(), { expirationTtl: TTL_UNDUH_REKAP });
    await deps.recordAudit({ user_id: u.user_id, username: u.username, action: 'UNDUH_HARIAN', modul: 'rekap', keterangan: `Unduh Excel rekap ${u.cabang} s.d. ${tanggal}` });
    return c.json(okPayload({}));
  });
```
  (Periksa signature `deps.recordAudit` di `src/deps.ts`; field `data_sebelum/data_sesudah` opsional.)
- [x] **Step 4:** tes → PASS; `npm test && npm run typecheck`.
- [x] **Step 5:** centang, CHANGELOG (Fitur), commit `feat(tugas): status & penanda unduh Excel rekap harian`, push.

> Catatan: tidak ada penyimpangan dari rencana; `ringkasTugas` hanya dipakai di `tugasUntuk` (push ringkasan & cron tidak terpengaruh).

---

### Task 11: Klien — banner & pop-up unduh Excel

**Files:**
- Create: `static/js/unduh-rekap.js`
- Modify: `static/js/notifikasi.js`
- Test: `tests/frontend/notifikasi-helpers.test.ts`

- [x] **Step 1: Tes gagal** — tambahkan:
```ts
import { teksUnduhExcel } from '../../static/js/notifikasi.js';
import { EMAIL_KIRIM_REKAP, rentangUnduhHarian } from '../../static/js/unduh-rekap.js';

describe('pengingat unduh Excel', () => {
  it('teks menyebut email tujuan', () => {
    expect(EMAIL_KIRIM_REKAP).toBe('ceocrew01@gmail.com');
    expect(teksUnduhExcel()).toBe('Tugas hari ini selesai. Unduh Excel rekap pengeluaran bulan ini, lalu kirim ke ceocrew01@gmail.com bersama Excel laporan lainnya.');
  });
  it('rentang = tanggal 1 bulan berjalan s.d. hari ini', () => {
    expect(rentangUnduhHarian('2026-10-21')).toEqual({ dari: '2026-10-01', sampai: '2026-10-21' });
  });
});
```
- [x] **Step 2:** tes → FAIL.
- [x] **Step 3: Implementasi**

`static/js/unduh-rekap.js`:
```js
import { get, post } from './api.js';
import { getUser } from './store.js';
import { awalBulan, bukuExcel, muatSheetJS, namaFileRekap, susunExcel } from './pages/rekap.js';

// Alamat tujuan kiriman Excel rekap harian (spec 2026-10-21 §3). Ubah di sini bila berganti.
export const EMAIL_KIRIM_REKAP = 'ceocrew01@gmail.com';

export function rentangUnduhHarian(hariIni) {
  return { dari: awalBulan(hariIni), sampai: String(hariIni).slice(0, 10) };
}

// Unduh rekap cabang PIC bulan berjalan lalu tandai sudah diunduh di server.
export async function unduhRekapHarian(hariIni) {
  const cabang = String(getUser()?.cabang || '');
  const { dari, sampai } = rentangUnduhHarian(hariIni);
  const { lines = [] } = await get(`/api/laporan/rekap-pengeluaran?${new URLSearchParams({ dari, sampai })}`);
  const XLSX = await muatSheetJS();
  XLSX.writeFile(bukuExcel(XLSX, susunExcel(lines, { dari, sampai, warehouse: cabang })), namaFileRekap(dari, sampai, cabang));
  await post('/api/rekap/unduh-harian', {});
}
```
`static/js/notifikasi.js`:
- Import `import { EMAIL_KIRIM_REKAP, unduhRekapHarian } from './unduh-rekap.js';` dan `toast` dari `./ui.js`.
- Helper murni:
```js
export function teksUnduhExcel(email = EMAIL_KIRIM_REKAP) {
  return `Tugas hari ini selesai. Unduh Excel rekap pengeluaran bulan ini, lalu kirim ke ${email} bersama Excel laporan lainnya.`;
}
```
- Di `segarkanBanner`, ganti `if (!teks) { slot.replaceChildren(); return; }` dengan:
```js
  if (!teks) {
    if (cache.unduh_excel && bolehTulis(getUser()?.role)) { tampilBannerUnduh(slot, cache.tanggal); return; }
    slot.replaceChildren();
    return;
  }
```
- Tambah:
```js
function tombolUnduh(tanggal, kelas, setelah = () => {}) {
  const b = el('button', { type: 'button', class: kelas }, [el('i', { class: 'bi bi-download me-1', 'aria-hidden': 'true' }), 'Unduh Excel']);
  b.addEventListener('click', async () => {
    b.disabled = true;
    try {
      await unduhRekapHarian(tanggal);
      toast('Excel terunduh. Kirim ke ' + EMAIL_KIRIM_REKAP + '.', 'success');
      setelah();
      await segarkanBanner(true);
    } catch (err) {
      toast(err.message || 'Gagal mengunduh Excel.', 'error');
      b.disabled = false;
    }
  });
  return b;
}

function tampilBannerUnduh(slot, tanggal) {
  slot.replaceChildren(el('div', { class: 'banner-tugas banner-tugas-akhir', role: 'status' }, [
    el('i', { class: 'bi bi-file-earmark-excel me-2', 'aria-hidden': 'true' }),
    el('span', { text: teksUnduhExcel() }),
    tombolUnduh(tanggal, 'btn btn-sm btn-danger ms-2'),
  ]));
  // Pop-up sekali per hari per perangkat; ditunda bila form belum disimpan sedang terbuka.
  const kunci = `unduh-popup:${tanggal}`;
  if (simpan.get(kunci) || adaFormTerbuka()) return;
  simpan.set(kunci, '1');
  const tutup = () => latar.remove();
  const latar = el('div', { class: 'popup-latar', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Unduh Excel rekap' }, [
    el('div', { class: 'popup-kotak' }, [
      el('div', { class: 'h5 text-success fw-bold mb-2' }, [el('i', { class: 'bi bi-check-circle me-2', 'aria-hidden': 'true' }), 'Rekon hari ini selesai']),
      el('p', { class: 'mb-3', text: teksUnduhExcel() }),
      el('div', { class: 'd-flex gap-2 justify-content-end' }, [
        el('button', { class: 'btn btn-outline-secondary', type: 'button', text: 'Nanti', onclick: tutup }),
        tombolUnduh(tanggal, 'btn btn-success', tutup),
      ]),
    ]),
  ]);
  document.body.appendChild(latar);
}
```
- [x] **Step 4:** tes → PASS; `npm test && npm run typecheck`.
- [x] **Step 5:** cek manual (dev): setelah rekon terakhir pop-up muncul, unduh menghasilkan `rekap-pengeluaran-<dari>_<sampai>-<cabang>.xlsx`, banner hilang. Centang, CHANGELOG (UX), commit `feat(notifikasi): pengingat unduh Excel rekap setelah rekon`, push.

> Catatan: implementasi sesuai rencana. Cek manual (Step 5) ditunda ke deploy (`.dev.vars` tidak tersedia); gerbang UI/code-review di Task 13.

---

### Task 12: Notif versi baru + "Yang baru"

**Files:**
- Modify: `wrangler.jsonc`, `src/env.ts`, `src/routes/health.ts`, `static/index.html`, `static/js/app.js`, `static/css/app.css` (file CSS utama — cek nama di `static/css/`)
- Create: `static/js/versi.js`, `static/js/rilis.js`
- Test: `tests/app.test.ts` (atau `tests/routes/health.test.ts` baru), `tests/frontend/versi-helpers.test.ts`

- [x] **Step 1: Tes gagal**
`tests/routes/health.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { fakeEnv, makeDeps } from '../helpers';

describe('GET /api/health/versi', () => {
  it('mengembalikan id versi deploy tanpa cache', async () => {
    const app = buildApp({ ...(fakeEnv() as any), CF_VERSION_METADATA: { id: 'v-123' } }, makeDeps({}).deps);
    const res = await app.request('/api/health/versi', {}, { ...(fakeEnv() as any), CF_VERSION_METADATA: { id: 'v-123' } });
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(((await res.json()) as any).versi).toBe('v-123');
  });
  it('tanpa binding -> versi kosong', async () => {
    const app = buildApp(fakeEnv() as any, makeDeps({}).deps);
    expect(((await (await app.request('/api/health/versi', {}, fakeEnv() as any)).json()) as any).versi).toBe('');
  });
});
```
(Cek di `tests/app.test.ts` cara env diteruskan ke `app.request` — samakan polanya.)

`tests/frontend/versi-helpers.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { perluTampilRilis, versiBerubah } from '../../static/js/versi.js';
import { RILIS } from '../../static/js/rilis.js';

describe('versi & rilis', () => {
  it('versiBerubah hanya bila keduanya terisi dan berbeda', () => {
    expect(versiBerubah('a', 'b')).toBe(true);
    expect(versiBerubah('a', 'a')).toBe(false);
    expect(versiBerubah('', 'b')).toBe(false);
    expect(versiBerubah('a', '')).toBe(false);
  });
  it('perluTampilRilis bila id terbaru belum dilihat', () => {
    expect(perluTampilRilis([{ id: 'r2' }, { id: 'r1' }], 'r1')).toBe(true);
    expect(perluTampilRilis([{ id: 'r2' }], 'r2')).toBe(false);
    expect(perluTampilRilis([], null)).toBe(false);
  });
  it('catatan rilis terbaru = rincian pengeluaran', () => {
    expect(RILIS[0]!.id).toBe('2026-10-21-rincian');
    expect(RILIS[0]!.poin.length).toBeGreaterThan(0);
  });
});
```
- [x] **Step 2:** tes → FAIL.
- [x] **Step 3: Implementasi**

`wrangler.jsonc` — tambah sebelum `"triggers"`:
```jsonc
  // Id versi deploy untuk banner "Versi baru tersedia" (GET /api/health/versi).
  "version_metadata": { "binding": "CF_VERSION_METADATA" },
```
`src/env.ts` — tambah:
```ts
  // Metadata versi Worker (berubah setiap deploy).
  CF_VERSION_METADATA?: { id: string; tag?: string; timestamp?: string };
```
`src/routes/health.ts` — dalam `healthRoutes`:
```ts
  app.get('/versi', (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(okPayload({ versi: String((c.env as Env | undefined)?.CF_VERSION_METADATA?.id ?? '') }));
  });
```
`static/js/rilis.js`:
```js
// Catatan "Yang baru" (terbaru di atas). Tambahkan entri saat merilis perubahan yang terlihat pengguna.
export const RILIS = [
  {
    id: '2026-10-21-rincian',
    judul: 'Yang baru',
    poin: [
      'Pengeluaran BBM & tol kini diisi per nota (jenis, nominal, dibayar, keterangan). Foto struk tetap digabung: 1 foto BBM dan 1 foto tol.',
      'Setelah laporan & rekon hari ini selesai: unduh Excel rekap bulan ini lalu kirim ke ceocrew01@gmail.com.',
    ],
  },
];
```
`static/js/versi.js`:
```js
import { el } from './ui.js';
import { getUser } from './store.js';
import { adaFormTerbuka } from './router.js';
import { RILIS } from './rilis.js';

export function versiBerubah(awal, terbaru) {
  return Boolean(awal && terbaru && awal !== terbaru);
}
export function perluTampilRilis(daftar, idTersimpan) {
  const t = daftar?.[0];
  return Boolean(t && t.id !== idTersimpan);
}

const KUNCI_RILIS = 'rilis-terakhir-dilihat';
const simpan = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* abaikan */ } } };

async function ambilVersi() {
  try {
    const res = await fetch('/api/health/versi', { cache: 'no-store' });
    return String((await res.json())?.versi || '');
  } catch {
    return '';
  }
}

let versiAwal = '';
async function cek() {
  const v = await ambilVersi();
  if (!versiAwal) { versiAwal = v; return; }
  if (!versiBerubah(versiAwal, v)) return;
  const slot = document.getElementById('banner-versi');
  if (!slot || slot.childElementCount) return;
  const muat = el('button', { type: 'button', class: 'btn btn-sm btn-primary ms-2', text: 'Muat ulang sekarang' });
  muat.addEventListener('click', () => location.reload());
  slot.replaceChildren(el('div', { class: 'banner-versi', role: 'status' }, [
    el('i', { class: 'bi bi-arrow-repeat me-2', 'aria-hidden': 'true' }), 'Versi baru aplikasi tersedia.', muat,
  ]));
}

// Pop-up "Yang baru" sekali per perangkat setelah login; ditunda saat form belum disimpan terbuka.
export function tampilkanRilisBila() {
  if (!getUser() || (location.hash || '#/login').startsWith('#/login') || adaFormTerbuka()) return;
  if (!perluTampilRilis(RILIS, simpan.get(KUNCI_RILIS))) return;
  const r = RILIS[0];
  simpan.set(KUNCI_RILIS, r.id);
  const tutup = () => latar.remove();
  const latar = el('div', { class: 'popup-latar', role: 'dialog', 'aria-modal': 'true', 'aria-label': r.judul }, [
    el('div', { class: 'popup-kotak' }, [
      el('div', { class: 'h5 fw-bold mb-2' }, [el('i', { class: 'bi bi-stars me-2', 'aria-hidden': 'true' }), r.judul]),
      el('ul', { class: 'mb-3' }, r.poin.map((p) => el('li', { text: p }))),
      el('div', { class: 'text-end' }, [el('button', { class: 'btn btn-primary', type: 'button', text: 'Mengerti', onclick: tutup })]),
    ]),
  ]);
  document.body.appendChild(latar);
}

export function mulaiCekVersi() {
  cek();
  setInterval(cek, 10 * 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cek(); });
  window.addEventListener('hashchange', tampilkanRilisBila);
  tampilkanRilisBila();
}
```
`static/index.html` — tambah `<div id="banner-versi"></div>` tepat sebelum `<div id="banner-slot"></div>`.
`static/js/app.js` — import `mulaiCekVersi` dari `'./versi.js'` dan panggil `mulaiCekVersi();` setelah `mulaiLonceng();`.
CSS (file yang berisi `.banner-tugas`):
```css
.banner-versi {
  background: #e7f1ff;
  border-bottom: 1px solid #9ec5fe;
  color: #084298;
  padding: 0.5rem 1rem;
  font-size: 0.92rem;
  text-align: center;
}
```
- [x] **Step 4:** tes → PASS; `npm test && npm run typecheck`.
- [x] **Step 5:** CLAUDE.md §2 tambah butir: "Perubahan yang terlihat pengguna: tambahkan entri di `static/js/rilis.js` (id unik, 1–3 poin) agar muncul pop-up 'Yang baru'." README Arsitektur/catatan: endpoint `/api/health/versi` dan binding `CF_VERSION_METADATA`. Centang, CHANGELOG, commit `feat(app): pemberitahuan versi baru dan catatan Yang baru`, push.

> Catatan: Task 12 sesuai rencana. Tes `versi-helpers` tanpa `@ts-expect-error` (impor JS lain di repo juga tanpa). Cek manual browser tidak dilakukan (ditunda ke deploy).

---

### Task 13: Gerbang review, dokumentasi, verifikasi akhir

- [x] **Step 1:** `/security-review` (pemicu: endpoint `POST /api/rekap/unduh-harian`, input `rincian` ke DB). Perbaiki temuan atau catat alasan di CHANGELOG.
- [x] **Step 2:** `/ui-ux-pro-max` mode review (§1–§3 + §8 Forms) untuk `rincian.js`, `input.js`, `edit.js`, `transaksi.js`, `notifikasi.js`, `versi.js`. Perhatikan: target sentuh ≥ 44px tombol hapus baris, label/aria tiap kolom, tata letak 360px.
- [x] **Step 3:** `/code-review:code-review` (perubahan > 150 baris, kontrak API & skema berubah).
- [x] **Step 4:** README: tabel API (`rincian` di POST/PUT `/api/laporan`, `POST /api/rekap/unduh-harian`, `GET /api/health/versi`, field `unduh_excel`), bagian fitur (rincian per nota, pengingat unduh Excel, notif update). Spec: tambahkan bagian "Penyimpangan saat implementasi" (salin dari atas rencana ini).
- [x] **Step 5:** `npm test` dan `npm run typecheck` — tempel ringkasan output di catatan commit/CHANGELOG.
- [x] **Step 6:** centang semua, CHANGELOG, commit `docs(rincian): review, README, dan penutup rencana`, push.

> Catatan: review gabungan (security + code + UI) oleh subagent; temuan B1/B2/B3/C1/A1/A2/C2/B7/C6/B4 diperbaiki, sisanya ditunda (lihat CHANGELOG). Step 4: README (fitur + kolom API `rincian`) dan bagian "Penyimpangan saat implementasi" di spec. Step 5: `npm test` 61 file / 672 tes lulus, `npm run typecheck` tanpa galat.

- [ ] **Step 7 (rilis, di komputer kantor):** jalankan `db/rincian-pengeluaran.sql` di Supabase → pindahkan barisnya ke "Sudah dijalankan" di README → `npm run deploy`.
