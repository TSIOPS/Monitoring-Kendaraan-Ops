# M3 â€” Laporan / Transaksi BBM Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mem-port alur **Laporan Harian / Transaksi BBM** GAS (`saveTransactionEndOfDayUnlocked`, `editDailyTransactionUnlocked`, `deleteDailyTransactionUnlocked`, `getLastLaporanPrefill`, `getPerformaSummary`, `getRecentTransactions`, `getMonthlySummary`) ke Worker â€” perilaku, efek samping Flazz/Jalur, dan **pesan verbatim GAS** 1:1, agar frontend M7 bisa disambungkan tanpa mengubah bentuk data.

**Architecture:** Tiga lapis mengikuti M2. `src/logic/laporan.ts` = fungsi murni (PaymentLogic, estimasi odo, efisiensi 7-trip, mapping baris, ringkasan bulanan, pesan). `src/db/laporan.ts` = `LaporanRepo` + `supabaseLaporanRepo(env)` (penggunaan_bbm / flazz_card / flazz_usage / jalur_pengiriman). `src/routes/laporan.ts` = orkestrasi guard â†’ logic â†’ repo â†’ audit â†’ invalidate; dashboard route di `src/routes/laporan.ts` (`dashboardRoutes`) di-mount `/api/dashboard`. Penurunan saldo Flazz memakai conditional `UPDATE ... WHERE last_balance = <old>` (satu titik atomicity ekstra).

**Tech Stack:** Hono, @supabase/supabase-js, Cloudflare KV, Supabase Storage (bucket `foto`), Web Crypto (`crypto.randomUUID`), vitest.

## Global Constraints

- **Pesan error/sukses GAS verbatim** (lihat tabel Global Strings). Jangan mengarang pesan baru; jangan menerjemahkan.
- **`kode_cabang` transaksi selalu dari master kendaraan**, bukan dari body. `user_id`/`nama_pengguna` dari session.
- **Guard server-side**: SUPERADMIN penuh; PIC CABANG hanya cabangnya. 403 pesan persis:
  - save (`assertOwnWarehouse`): `Akses ditolak: Anda hanya dapat mengelola data warehouse <cabang>.`
  - edit/hapus (`assertTransactionAccess`): `Akses ditolak: Anda hanya dapat mengelola transaksi warehouse <cabang>.`
  - kartu Flazz (`assertFlazzAccess`): `Akses ditolak: Anda hanya dapat mengelola kartu warehouse <cabang>.`
- **Kolom DB = nama kolom GAS**, dipakai apa adanya (0â€“31). `km_awal_confirmed`/`km_akhir_confirmed` menyimpan **KM efektif** (setelah estimasi); `ocr_km_awal`/`ocr_km_akhir` menyimpan echo client.
- **Urutan baris** memakai kolom `seq bigint generated always as identity` (menggantikan urutan baris spreadsheet). Semua "baris terakhir"/"200 terakhir" memakai `seq desc`.
- **Konkurensi**: tanpa lock global. Potong saldo Flazz selalu conditional; kegagalan potong saat save â†’ hapus baris yang baru diinsert + balas 409 (bukan ditelan seperti GAS). Refund/kenaikan saldo tidak perlu conditional.
- **Cache**: `performa` & `monthly` di KV TTL **300 dtk**, key `perf:<role>:<cabang>` & `monthly:<role>:<cabang>`. Save/edit/delete yang menyentuh Flazz â†’ `bumpMasterRev`. Riwayat & prefill **selalu** hitung langsung.
- **`adjustMonthlySummary` GAS dihilangkan** â€” ringkasan bulanan dihitung ulang dari tabel saat dashboard diminta.
- Response sukses `{ success: true, ... }`; gagal `{ success: false, error, message }` via `HttpError`.
- **Id baru**: `newId(prefix)` (dari `routes/master.ts`) = `prefix${Date.now()}-${4-hex}`. `transaction_id` = `TRX-...`; usage = `USE-...`.
- **Foto**: bucket Storage `foto`, key `<kode-cabang>/KM_Awal|<KM_Akhir>/<uuid>.<ext>`; mime whitelist `jpeg/png/webp/heic/heif`, maks 10 MB. Thumbnail = rewrite `/object/public/` â†’ `/render/image/public/` + `?width=200`.
- **`foto_evidence` tidak dipakai** (sama GAS). `struk_bbm`/`struk_toll` hanya diisi bila klien mengirim (biasanya kosong).
- Setiap task diakhiri `npm run typecheck` + `npx vitest run` hijau, lalu commit.

## Global Strings (verbatim GAS)

| Konteks | String |
|---|---|
| Gate jalur 409 | `Anda harus membuat Jalur Pengiriman terlebih dahulu (status BELUM DIISI) untuk kendaraan dan supir ini pada tanggal tersebut sebelum menginput laporan harian.` |
| Duplikat 409 | `Laporan sudah pernah disimpan. Untuk menghindari data ganda, tidak disimpan ulang. Silakan cek Riwayat Transaksi.` |
| Odo: standar kosong 400 | `KM tidak terbaca tapi estimasi tidak tersedia: Standar KM/L kendaraan belum diisi di Master Kendaraan. Harap isi dulu atau input KM asli.` |
| Odo: liter kosong 400 | `KM tidak terbaca tapi estimasi tidak tersedia: liter BBM kosong. Pastikan "Ada struk BBM?" = Ya, total biaya terisi, dan Master BBM punya harga per liter. Harap input KM asli jika ingin lanjut.` |
| Kartu tak ditemukan 409 | `Kartu Flazz untuk <label.join(' + ')> (ID: <cid>) tidak ditemukan. Pilih ulang kartu Flazz yang valid sebelum menyimpan laporan.` |
| Saldo kurang 409 | `Saldo kartu Flazz (<nameâ€–cid>) tidak mencukupi untuk <label.join(' + ')> . Saldo: Rp <fmt(bal)>, Total pengeluaran: Rp <fmt(total)>. Silakan top up Flazz terlebih dahulu.` |
| Edit saldo kurang 409 | `Saldo kartu tidak mencukupi untuk koreksi ini (sisa Rp <fmt(bal)>). Lakukan Top Up atau selesaikan Rekonsiliasi terlebih dahulu.` |
| Edit/hapus 404 | `Transaksi tidak ditemukan.` |
| Edit 400 | `Pilih kartu Flazz terlebih dahulu.` |
| Edit 400 | `Kartu tujuan tidak ditemukan.` |
| Edit 400 | `Pilih kartu Flazz untuk pembayaran tol.` |
| Edit sukses | `Transaksi BBM berhasil diperbarui.` |
| Hapus sukses | `Transaksi BBM dihapus.` |
| Upload 422 | `Upload foto KM awal gagal: <err>` / `Upload foto KM akhir gagal: <err>` |
| Odo warning | `SELISIH ODO: KM akhir terakhir <fmt(prevKmAkhir)> (<tgl>), KM awal <fmt(kmAwalBaru)>, selisih <fmt(selisih)> KM - indikasi pemakaian di luar jam kerja` |
| Efisiensi label | `Rata-rata 7 Trip` + (` âš  termasuk estimasi` bila ada estimasi) |

`fmt` = format angka id-ID deterministik: ribuan `.`, desimal `,` (fungsi `formatIdNumber`). `tgl` = `dd/MM/yyyy` (fungsi `formatDateId`).

## File Structure (tambahan/perubahan)

```
D:\Monitoring Kendaraan Ops Cloud\
â”œâ”€â”€ README.md                         # EDIT: tabel API + status M3
â”œâ”€â”€ db/
â”‚   â””â”€â”€ schema.sql                    # EDIT: seq identity + 3 index
â”œâ”€â”€ src/
â”‚   â”œâ”€â”€ deps.ts                       # EDIT: AppDeps + laporan/uploadEvidence/deleteEvidence
â”‚   â”œâ”€â”€ app.ts                        # EDIT: repo default + mount /api/laporan & /api/dashboard
â”‚   â”œâ”€â”€ logic/
â”‚   â”‚   â”œâ”€â”€ laporan.ts                # CREATE: semua fungsi murni M3
â”‚   â”‚   â””â”€â”€ master-cache.ts           # EDIT: performaCacheKey/monthlyCacheKey/invalidateLaporanCaches
â”‚   â”œâ”€â”€ db/
â”‚   â”‚   â”œâ”€â”€ laporan.ts                # CREATE: tipe + LaporanRepo + supabaseLaporanRepo
â”‚   â”‚   â””â”€â”€ storage.ts                # EDIT: bucket foto + upload/delete evidence
â”‚   â””â”€â”€ routes/
â”‚       â””â”€â”€ laporan.ts                # CREATE: laporanRoutes + dashboardRoutes
â”œâ”€â”€ tests/
â”‚   â”œâ”€â”€ helpers.ts                    # EDIT: memLaporan/memStorage/laporanRow + makeDeps
â”‚   â”œâ”€â”€ logic/laporan.test.ts         # CREATE (Task 2 & 3)
â”‚   â”œâ”€â”€ db/laporan-mem.test.ts        # CREATE (Task 4)
â”‚   â””â”€â”€ routes/laporan.test.ts        # CREATE (Task 5â€“8)
â””â”€â”€ scripts/
    â””â”€â”€ apply-schema.mjs              # (existing, dipakai untuk kolom/index baru)
```

Unit interfaces:
- `logic/laporan.ts` â€” murni (tanpa env/DB). Port 1:1 `PaymentLogic.js`, estimasi odo, `hitungEfisiensi7Riwayat`, mapping, ringkasan bulanan, pesan.
- `db/laporan.ts` â€” `LaporanRepo` (interface) + `supabaseLaporanRepo(env)`; dites via `memLaporan`.
- `routes/laporan.ts` â€” `app*(deps)` DI. Bisnis-rule GAS di sini (guard, validasi, audit, invalidate, pesan).
- `tests/helpers.ts` â€” `memLaporan` (in-memory 4 tabel), `memStorage` (fake upload/delete), `laporanRow()`.

---

## Task 1: Skema â€” kolom `seq` + index

**Files:**
- Edit: `db/schema.sql`

**Produces:** `penggunaan_bbm.seq` (identity) untuk urutan "baris terakhir", dan 3 index yang dipakai query gate/riwayat.

- [x] **Step 1: Tambah kolom `seq` di `db/schema.sql`**

Di dalam `create table if not exists penggunaan_bbm (...)` tambahkan kolom `seq` sebagai baris **terakhir** definisi kolom (sebelum `);`):

```diff
   km_sumber text not null default '',
   metode_toll text not null default '',
-  flazz_card_id_toll text not null default ''
+  flazz_card_id_toll text not null default '',
+  seq bigint generated always as identity
 );
```

Lalu tepat **setelah** blok `create table ... penggunaan_bbm (...)` selesai, tambahkan (untuk database yang sudah ada, `create table if not exists` tidak menambah kolom):

```sql
alter table penggunaan_bbm add column if not exists seq bigint generated always as identity;
```

- [x] **Step 2: Tambah 3 index**

Di blok `-- INDEX` (dekat baris 258), tambahkan:

```sql
create index if not exists idx_penggunaan_vehicle on penggunaan_bbm (vehicle_id);
create index if not exists idx_flazz_usage_ref on flazz_usage (ref_type, ref_id);
create index if not exists idx_jalur_gate on jalur_pengiriman (tanggal, vehicle_id, kode_cabang);
```

- [x] **Step 3: Terapkan + verifikasi**

```powershell
$env:SB_DB_PASSWORD='<DB_PASSWORD>'; npm run apply-schema
$env:SB_DB_PASSWORD='<DB_PASSWORD>'; npm run verify-schema
# lintasan manual kolom seq (opsional):
$env:SB_DB_PASSWORD='<DB_PASSWORD>'; node -e "const pg=require('pg');const c=new pg.Client({host:'db.jscpogjdquwcbglavurd.supabase.co',port:5432,user:'postgres',database:'postgres',password:process.env.SB_DB_PASSWORD,ssl:{rejectUnauthorized:false}});(async()=>{await c.connect();const r=await c.query(\"select column_name,is_identity from information_schema.columns where table_name='penggunaan_bbm' and column_name='seq'\").then(x=>x.rows);console.log(r);await c.end()})()"
```

Harapan: `seq | YES`.

- [x] **Step 4: Commit**

```bash
git add db/schema.sql
git commit -m "feat(db): M3 penggunaan_bbm.seq identity + index gate/riwayat"
```

---

## Task 2: `src/logic/laporan.ts` bagian 1 â€” PaymentLogic, estimasi odo, efisiensi, pesan

**Files:**
- Create: `src/logic/laporan.ts`
- Create: `tests/logic/laporan.test.ts`

**Produces:** tipe `LaporanRow`/`LaporanInsert` + seluruh fungsi murni inti (payment, odo, efisiensi, formatter, pesan). Bagian mapping/riwayat menyusul di Task 3.

- [x] **Step 1: Tulis `src/logic/laporan.ts` (bagian 1)**

```ts
// Logika MURNI laporan/transaksi BBM. Port 1:1 PaymentLogic.js + SpreadsheetOps.js.
// Tanpa I/O: tidak menyentuh env, Supabase, KV, atau Storage.

export interface LaporanRow {
  seq?: number;
  transaction_id: string;
  timestamp: string;
  tanggal: string;
  user_id: string;
  nama_pengguna: string;
  kode_cabang: string;
  vehicle_id: string;
  plat_nomor: string;
  foto_km_awal: string;
  ocr_km_awal: string;
  km_awal_confirmed: string;
  bar_awal: string;
  foto_km_akhir: string;
  ocr_km_akhir: string;
  km_akhir_confirmed: string;
  bar_akhir: string;
  km_tempuh: number;
  perubahan_bar: number;
  liter_bbm: number;
  biaya_bbm: number;
  foto_struk_bbm: string;
  biaya_toll: number;
  foto_struk_toll: string;
  km_per_liter: number;
  status: string;
  warning: string;
  nama_supir: string;
  metode_pembayaran: string;
  flazz_card_id: string;
  km_sumber: string;
  metode_toll: string;
  flazz_card_id_toll: string;
}
export type LaporanInsert = Omit<LaporanRow, 'seq'>;

export interface PaymentState {
  metodeBbm: string;
  cardBbm: string;
  biayaBbm: number;
  metodeTol: string;
  cardTol: string;
  biayaTol: number;
}
type AnyPayment = Partial<PaymentState> & Partial<LaporanRow>;

export const num = (v: unknown): number => {
  const n = parseFloat(String(v ?? ''));
  return isNaN(n) ? 0 : n;
};
const numOrNull = (v: unknown): number | null => {
  const n = parseFloat(String(v ?? ''));
  return isNaN(n) ? null : n;
};

// â”€â”€ PaymentLogic (port PaymentLogic.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function canonicalCardId(v: unknown): string {
  return String(v ?? '').trim().replace(/-/g, '');
}

export function cardFields(row: AnyPayment | null | undefined) {
  if (!row) return { mBbm: '', cBbm: '', bBbm: 0, mTol: '', cTol: '', bTol: 0 };
  return {
    mBbm: row.metode_pembayaran !== undefined ? row.metode_pembayaran : (row.metodeBbm ?? ''),
    cBbm: row.flazz_card_id !== undefined ? row.flazz_card_id : (row.cardBbm ?? ''),
    bBbm: num(row.biaya_bbm !== undefined ? row.biaya_bbm : row.biayaBbm),
    mTol: row.metode_toll !== undefined ? row.metode_toll : (row.metodeTol ?? ''),
    cTol: row.flazz_card_id_toll !== undefined ? row.flazz_card_id_toll : (row.cardTol ?? ''),
    bTol: num(row.biaya_toll !== undefined ? row.biaya_toll : row.biayaTol),
  };
}

export function flazzBbmShare(row: AnyPayment | null | undefined, cardId: string | null | undefined): number {
  if (!row || cardId == null) return 0;
  const f = cardFields(row);
  if (String(f.mBbm) !== 'FLAZZ') return 0;
  if (canonicalCardId(f.cBbm) !== canonicalCardId(cardId)) return 0;
  return num(f.bBbm);
}

export function flazzTolShare(row: AnyPayment | null | undefined, cardId: string | null | undefined): number {
  if (!row || cardId == null) return 0;
  const f = cardFields(row);
  if (String(f.mTol) !== 'FLAZZ') return 0;
  if (canonicalCardId(f.cTol) !== canonicalCardId(cardId)) return 0;
  return num(f.bTol);
}

export function flazzShareForCard(row: AnyPayment | null | undefined, cardId: string | null | undefined): number {
  return flazzBbmShare(row, cardId) + flazzTolShare(row, cardId);
}

export function isFlazzRowForCard(row: AnyPayment | null | undefined, cardId: string | null | undefined): boolean {
  if (!row || cardId == null) return false;
  const f = cardFields(row);
  const bbm = String(f.mBbm) === 'FLAZZ' && canonicalCardId(f.cBbm) === canonicalCardId(cardId);
  const tol = String(f.mTol) === 'FLAZZ' && canonicalCardId(f.cTol) === canonicalCardId(cardId);
  return bbm || tol;
}

export function distinctFlazzCards(metodeBbm: unknown, cardBbm: unknown, metodeTol: unknown, cardTol: unknown): string[] {
  const out: string[] = [];
  const push = (card: unknown) => {
    const c = String(card ?? '').trim();
    if (c && out.indexOf(c) === -1) out.push(c);
  };
  if (String(metodeBbm) === 'FLAZZ') push(cardBbm);
  if (String(metodeTol) === 'FLAZZ') push(cardTol);
  return out;
}

export function flazzCardCharge(state: AnyPayment | null | undefined, cardId: string | null | undefined): number {
  if (!state || cardId == null) return 0;
  const f = cardFields(state);
  let total = 0;
  if (String(f.mBbm) === 'FLAZZ' && canonicalCardId(f.cBbm) === canonicalCardId(cardId)) total += num(f.bBbm);
  if (String(f.mTol) === 'FLAZZ' && canonicalCardId(f.cTol) === canonicalCardId(cardId)) total += num(f.bTol);
  return total;
}

export function flazzEditDelta(oldState: AnyPayment, nextState: AnyPayment, cardId: string | null | undefined): number {
  if (cardId == null) return 0;
  return flazzCardCharge(oldState, cardId) - flazzCardCharge(nextState, cardId);
}

export function parseEditAmount(payloadValue: unknown, oldValue: number): number {
  if (payloadValue === undefined || payloadValue === null) return oldValue;
  return num(payloadValue);
}

export function parseEditMethod(payloadValue: unknown, oldValue: string): string {
  if (payloadValue === undefined || payloadValue === null) return oldValue;
  return String(payloadValue).trim();
}

export function resolveTollMethod(explicitValue: unknown, bbmMethod: unknown, explicitCard: unknown): string {
  if (explicitValue !== undefined && explicitValue !== null && String(explicitValue) !== '') return String(explicitValue);
  if (String(bbmMethod) === 'FLAZZ') return 'FLAZZ';
  if (explicitCard !== undefined && explicitCard !== null && String(explicitCard).trim() !== '') return 'FLAZZ';
  return 'TUNAI';
}

export function resolveTollCard(explicitCard: unknown, tollMethod: unknown, bbmMethod: unknown, bbmCard: unknown): string {
  if (String(tollMethod) !== 'FLAZZ') return '';
  const c = String(explicitCard ?? '').trim();
  if (c) return c;
  if (String(bbmMethod) === 'FLAZZ') return String(bbmCard ?? '').trim();
  return '';
}

export interface FlazzCheck {
  cardId: string;
  label: string[];
  total: number;
}

export function buildFlazzChecks(
  bbmMethod: string, bbmCard: string, biayaBbm: number,
  tolMethod: string, tolCard: string, biayaTol: number,
): FlazzCheck[] {
  const map = new Map<string, FlazzCheck>();
  const add = (cardId: string, label: string, amount: number) => {
    if (!cardId || amount <= 0) return;
    let e = map.get(cardId);
    if (!e) { e = { cardId, label: [], total: 0 }; map.set(cardId, e); }
    e.label.push(label);
    e.total += amount;
  };
  if (bbmMethod === 'FLAZZ') add(bbmCard, 'BBM', biayaBbm);
  if (tolMethod === 'FLAZZ') add(tolCard, 'tol', biayaTol);
  return [...map.values()];
}

// â”€â”€ Odometer & efisiensi (port SpreadsheetOps.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export class OdoEstimateError extends Error {}

export const MSG_ODO_NO_STANDAR =
  'KM tidak terbaca tapi estimasi tidak tersedia: Standar KM/L kendaraan belum diisi di Master Kendaraan. Harap isi dulu atau input KM asli.';
export const MSG_ODO_NO_LITER =
  'KM tidak terbaca tapi estimasi tidak tersedia: liter BBM kosong. Pastikan "Ada struk BBM?" = Ya, total biaya terisi, dan Master BBM punya harga per liter. Harap input KM asli jika ingin lanjut.';

export interface OdoEstimateInput {
  kmAwal: number;
  kmAkhir: number;
  kmAwalBroken: boolean;
  kmAkhirBroken: boolean;
  kmTanpaEstimasi: boolean;
  standarKmL: number;
  literKonsumsi: number;
  prevKmAkhir: number | null;
}
export interface OdoEstimate {
  kmAwal: number;
  kmAkhir: number;
  kmTempuh: number;
  kmSumber: 'AKTUAL' | 'ESTIMASI';
}

export function estimateOdo(i: OdoEstimateInput): OdoEstimate {
  let kmAwal = i.kmAwal;
  let kmAkhir = i.kmAkhir;
  let kmTempuh = kmAkhir - kmAwal;
  let kmSumber: 'AKTUAL' | 'ESTIMASI' = 'AKTUAL';
  if (i.kmAwalBroken || i.kmAkhirBroken) {
    const estAvailable = i.standarKmL > 0 && i.literKonsumsi > 0;
    if (estAvailable) {
      const estKm = Math.round(i.literKonsumsi * i.standarKmL);
      if (i.kmAwalBroken && i.kmAkhirBroken) {
        const anchor = i.prevKmAkhir !== null && i.prevKmAkhir > 0 ? i.prevKmAkhir : 0;
        kmAwal = anchor;
        kmAkhir = anchor + estKm;
      } else if (i.kmAkhirBroken) {
        kmAkhir = kmAwal + estKm;
      } else {
        kmAwal = kmAkhir - estKm;
        if (kmAwal < 0) kmAwal = 0;
      }
      kmTempuh = estKm;
      kmSumber = 'ESTIMASI';
    } else if (i.kmTanpaEstimasi) {
      const anchor = i.prevKmAkhir !== null && i.prevKmAkhir > 0 ? i.prevKmAkhir : 0;
      if (kmAwal <= 0) kmAwal = anchor;
      if (kmAkhir <= 0) kmAkhir = anchor;
      kmTempuh = Math.max(0, kmAkhir - kmAwal);
      kmSumber = 'ESTIMASI';
    } else if (i.standarKmL <= 0) {
      throw new OdoEstimateError(MSG_ODO_NO_STANDAR);
    } else {
      throw new OdoEstimateError(MSG_ODO_NO_LITER);
    }
  }
  return { kmAwal, kmAkhir, kmTempuh, kmSumber };
}

export function literPerBarFor(kapasitas: number, jumlahBar: number): number {
  return kapasitas > 0 && jumlahBar > 0 ? kapasitas / jumlahBar : 0;
}

export function computeLiterKonsumsi(liter: number, barAwal: number, barAkhir: number, literPerBar: number): number {
  let lk = liter + (barAwal - barAkhir) * literPerBar;
  if (lk <= 0) lk = liter;
  return lk;
}

export function computeEfisiensi(kmTempuh: number, literKonsumsi: number): string {
  return literKonsumsi > 0 ? (kmTempuh / literKonsumsi).toFixed(2) : '';
}

export function storeMetodeBbm(biayaBbm: number, metode: string): string {
  return num(biayaBbm) > 0 ? metode || 'TUNAI' : '';
}

export function buildOdoWarning(kmAwalBaru: number, prevKmAkhir: number, prevTanggal: string): string {
  const selisih = kmAwalBaru - prevKmAkhir;
  const tgl = formatDateId(prevTanggal);
  return 'SELISIH ODO: KM akhir terakhir ' + formatIdNumber(prevKmAkhir) +
    ' (' + tgl + '), KM awal ' + formatIdNumber(kmAwalBaru) +
    ', selisih ' + formatIdNumber(selisih) +
    ' KM - indikasi pemakaian di luar jam kerja';
}

export interface Efisiensi7 {
  efisiensi: string;
  label: string;
  isDataCukup: boolean;
  adaEstimasi: boolean;
  totalKm: number;
  totalBeli: number;
  totalKonsumsi: number;
  tglMulai: string;
  tglSelesai: string;
  supir: string;
}

const EMPTY_EF7: Efisiensi7 = {
  efisiensi: '', label: '', isDataCukup: false, adaEstimasi: false,
  totalKm: 0, totalBeli: 0, totalKonsumsi: 0, tglMulai: '', tglSelesai: '', supir: '-',
};

export function hitungEfisiensi7Riwayat(trxs: LaporanRow[], currIdx: number, literPerBar: number): Efisiensi7 {
  if (!trxs || currIdx < 0) return { ...EMPTY_EF7 };
  const recentRows = trxs.slice(Math.max(0, currIdx - 6), currIdx + 1);
  const isDataCukup = recentRows.length === 7;
  let totalKm = 0;
  let totalBeli = 0;
  let adaEstimasi = false;
  for (const r of recentRows) {
    totalKm += num(r.km_tempuh);
    totalBeli += num(r.liter_bbm);
    if (String(r.km_sumber) === 'ESTIMASI') adaEstimasi = true;
  }
  const first = recentRows[0];
  const last = recentRows[recentRows.length - 1];
  if (!first || !last) return { ...EMPTY_EF7 };
  const barAwalPertama = num(first.bar_awal);
  const barAkhirTerakhir = num(last.bar_akhir);
  let totalKonsumsi = totalBeli + (barAwalPertama - barAkhirTerakhir) * literPerBar;
  if (totalKonsumsi <= 0) totalKonsumsi = totalBeli;
  const efisiensi = totalKonsumsi > 0 && totalKm > 0 ? (totalKm / totalKonsumsi).toFixed(2) : '';
  const label = efisiensi ? 'Rata-rata 7 Trip' + (adaEstimasi ? ' âš  termasuk estimasi' : '') : '';
  return {
    efisiensi, label, isDataCukup, adaEstimasi, totalKm, totalBeli, totalKonsumsi,
    tglMulai: first.tanggal, tglSelesai: last.tanggal, supir: last.nama_supir || '-',
  };
}

export function classifyEfisiensiStatus(efisiensi: string, standar: number): string {
  const val = parseFloat(efisiensi);
  if (val > 0 && standar > 0) {
    if (val < standar) return 'Di bawah standar';
    if (val <= standar * 1.3) return 'Sesuai standar';
    return 'Di atas standar';
  }
  return '';
}

export function shouldAdjustUsageOpeningAt(txTsMs: number | null, sinceMs: number | null): boolean {
  if (txTsMs == null) return true;
  if (sinceMs == null) return true;
  return !(txTsMs > sinceMs);
}

export function shouldAutoCreateUsageOnEdit(wasFlazz: boolean, isFlazz: boolean): boolean {
  return !wasFlazz && isFlazz;
}

// â”€â”€ Formatter & pesan â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export function formatIdNumber(n: number): string {
  let v = n;
  if (!isFinite(v)) v = 0;
  const neg = v < 0;
  const abs = Math.abs(v);
  const parts = abs.toString().split('.');
  const intPart = parts[0] ?? '0';
  const decPart = parts[1];
  const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const out = decPart ? `${withDots},${decPart}` : withDots;
  return neg ? '-' + out : out;
}

function parseDateLike(v: string | Date): Date {
  if (v instanceof Date) return v;
  const s = String(v);
  return new Date(s.length <= 10 ? s + 'T00:00:00Z' : s);
}

export function formatDateId(v: string | Date | null | undefined): string {
  if (v == null || v === '') return '-';
  const d = parseDateLike(v as string | Date);
  if (isNaN(d.getTime())) return String(v);
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${d.getUTCFullYear()}`;
}

export function periodKey(dateOrStr: string | Date | null | undefined): string {
  if (!dateOrStr) return '';
  const d = parseDateLike(dateOrStr as string | Date);
  if (isNaN(d.getTime())) return '';
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
}

export function toYyyyMmDd(d: Date): string {
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
}

export function parseTimestampMs(v: string | null | undefined): number | null {
  if (v == null || v === '') return null;
  const t = new Date(String(v)).getTime();
  return isNaN(t) ? null : t;
}

export function parseTanggalMs(v: string | null | undefined): number {
  if (!v) return 0;
  const t = parseDateLike(String(v)).getTime();
  return isNaN(t) ? 0 : t;
}

export const MSG_JALUR_GATE =
  'Anda harus membuat Jalur Pengiriman terlebih dahulu (status BELUM DIISI) untuk kendaraan dan supir ini pada tanggal tersebut sebelum menginput laporan harian.';
export const MSG_DUPLICATE =
  'Laporan sudah pernah disimpan. Untuk menghindari data ganda, tidak disimpan ulang. Silakan cek Riwayat Transaksi.';
export const MSG_TRX_NOT_FOUND = 'Transaksi tidak ditemukan.';
export const MSG_PICK_FLAZZ = 'Pilih kartu Flazz terlebih dahulu.';
export const MSG_CARD_TARGET_NOT_FOUND = 'Kartu tujuan tidak ditemukan.';
export const MSG_PICK_FLAZZ_TOLL = 'Pilih kartu Flazz untuk pembayaran tol.';
export const MSG_EDIT_SUCCESS = 'Transaksi BBM berhasil diperbarui.';
export const MSG_DELETE_SUCCESS = 'Transaksi BBM dihapus.';

export function msgCardNotFound(labels: string[], cid: string): string {
  return 'Kartu Flazz untuk ' + labels.join(' + ') + ' (ID: ' + cid +
    ') tidak ditemukan. Pilih ulang kartu Flazz yang valid sebelum menyimpan laporan.';
}

export function msgInsufficient(nameOrId: string, labels: string[], balance: number, total: number): string {
  return 'Saldo kartu Flazz (' + nameOrId + ') tidak mencukupi untuk ' + labels.join(' + ') +
    '. Saldo: Rp ' + formatIdNumber(balance) + ', Total pengeluaran: Rp ' + formatIdNumber(total) +
    '. Silakan top up Flazz terlebih dahulu.';
}

export function msgEditInsufficient(balance: number): string {
  return 'Saldo kartu tidak mencukupi untuk koreksi ini (sisa Rp ' + formatIdNumber(balance) +
    '). Lakukan Top Up atau selesaikan Rekonsiliasi terlebih dahulu.';
}
```

- [x] **Step 2: Tulis `tests/logic/laporan.test.ts` (bagian 1)**

```ts
import { describe, expect, it } from 'vitest';
import {
  LaporanRow, buildFlazzChecks, buildOdoWarning, classifyEfisiensiStatus, computeEfisiensi,
  computeLiterKonsumsi, distinctFlazzCards, estimateOdo, flazzCardCharge, flazzEditDelta,
  formatDateId, formatIdNumber, hitungEfisiensi7Riwayat, literPerBarFor, msgCardNotFound,
  msgEditInsufficient, msgInsufficient, OdoEstimateError, MSG_ODO_NO_LITER, MSG_ODO_NO_STANDAR,
  parseEditAmount, parseEditMethod, resolveTollCard, resolveTollMethod, shouldAdjustUsageOpeningAt,
  shouldAutoCreateUsageOnEdit, storeMetodeBbm,
} from '../../src/logic/laporan';

const row = (over: Partial<LaporanRow> = {}): LaporanRow => ({
  transaction_id: 'TRX-1', timestamp: '2026-09-01T01:00:00.000Z', tanggal: '2026-09-01',
  user_id: 'U-1', nama_pengguna: 'Budi', kode_cabang: 'CBG-A', vehicle_id: 'V-1', plat_nomor: 'B 1 A',
  foto_km_awal: '', ocr_km_awal: '', km_awal_confirmed: '100', bar_awal: '8',
  foto_km_akhir: '', ocr_km_akhir: '', km_akhir_confirmed: '200', bar_akhir: '4',
  km_tempuh: 100, perubahan_bar: 4, liter_bbm: 10, biaya_bbm: 100000,
  foto_struk_bbm: '', biaya_toll: 0, foto_struk_toll: '', km_per_liter: 10,
  status: 'COMPLETED', warning: '', nama_supir: 'Supir A', metode_pembayaran: 'TUNAI',
  flazz_card_id: '', km_sumber: 'AKTUAL', metode_toll: 'TUNAI', flazz_card_id_toll: '',
  ...over,
});

describe('PaymentLogic', () => {
  it('resolveTollMethod: eksplisit > BBM FLAZZ > kartu tol terisi > TUNAI', () => {
    expect(resolveTollMethod('TUNAI', 'FLAZZ', '')).toBe('TUNAI');
    expect(resolveTollMethod('', 'FLAZZ', '')).toBe('FLAZZ');
    expect(resolveTollMethod(undefined, 'TUNAI', 'FLZ-1')).toBe('FLAZZ');
    expect(resolveTollMethod(undefined, 'TUNAI', '')).toBe('TUNAI');
  });

  it('resolveTollCard: hanya saat tol FLAZZ; fallback kartu BBM', () => {
    expect(resolveTollCard('FLZ-9', 'TUNAI', 'FLAZZ', 'FLZ-1')).toBe('');
    expect(resolveTollCard('FLZ-9', 'FLAZZ', 'FLAZZ', 'FLZ-1')).toBe('FLZ-9');
    expect(resolveTollCard('', 'FLAZZ', 'FLAZZ', 'FLZ-1')).toBe('FLZ-1');
  });

  it('flazzCardCharge & flazzEditDelta menjumlahkan BBM+tol per kartu', () => {
    const st = { metodeBbm: 'FLAZZ', cardBbm: 'FLZ-1', biayaBbm: 50000, metodeTol: 'FLAZZ', cardTol: 'FLZ-1', biayaTol: 20000 };
    expect(flazzCardCharge(st, 'FLZ-1')).toBe(70000);
    expect(flazzCardCharge(st, 'FLZ-2')).toBe(0);
    const next = { ...st, biayaBbm: 30000 };
    expect(flazzEditDelta(st, next, 'FLZ-1')).toBe(20000);
    expect(flazzEditDelta(st, { metodeBbm: 'TUNAI', cardBbm: '', biayaBbm: 0, metodeTol: 'TUNAI', cardTol: '', biayaTol: 0 }, 'FLZ-1')).toBe(70000);
  });

  it('distinctFlazzCards & buildFlazzChecks', () => {
    expect(distinctFlazzCards('FLAZZ', 'FLZ-1', 'FLAZZ', 'FLZ-1')).toEqual(['FLZ-1']);
    expect(distinctFlazzCards('FLAZZ', 'FLZ-1', 'FLAZZ', 'FLZ-2')).toEqual(['FLZ-1', 'FLZ-2']);
    const checks = buildFlazzChecks('FLAZZ', 'FLZ-1', 50000, 'FLAZZ', 'FLZ-1', 20000);
    expect(checks).toEqual([{ cardId: 'FLZ-1', label: ['BBM', 'tol'], total: 70000 }]);
  });

  it('parseEditAmount/Method: undefined = pertahankan, "" = 0/kosong', () => {
    expect(parseEditAmount(undefined, 10)).toBe(10);
    expect(parseEditAmount('', 10)).toBe(0);
    expect(parseEditAmount('5', 10)).toBe(5);
    expect(parseEditMethod(undefined, 'FLAZZ')).toBe('FLAZZ');
    expect(parseEditMethod('', 'FLAZZ')).toBe('');
  });
});

describe('estimasi odo', () => {
  const base = { kmAwal: 0, kmAkhir: 0, kmAwalBroken: true, kmAkhirBroken: false, kmTanpaEstimasi: false, standarKmL: 10, literKonsumsi: 5, prevKmAkhir: null as number | null };

  it('akhir rusak -> km_akhir = km_awal + estKm', () => {
    const r = estimateOdo({ ...base, kmAwalBroken: false, kmAkhirBroken: true, kmAwal: 100, kmAkhir: 0 });
    expect(r).toEqual({ kmAwal: 100, kmAkhir: 150, kmTempuh: 50, kmSumber: 'ESTIMASI' });
  });

  it('awal rusak -> km_awal = km_akhir - estKm (clamp 0)', () => {
    expect(estimateOdo({ ...base, kmAwal: 0, kmAkhir: 150, kmAwalBroken: true, kmAkhirBroken: false }).kmAwal).toBe(100);
    expect(estimateOdo({ ...base, kmAwal: 0, kmAkhir: 20 }).kmAwal).toBe(0);
  });

  it('keduanya rusak -> anchor prev', () => {
    const r = estimateOdo({ ...base, kmAwalBroken: true, kmAkhirBroken: true, prevKmAkhir: 900 });
    expect(r).toEqual({ kmAwal: 900, kmAkhir: 950, kmTempuh: 50, kmSumber: 'ESTIMASI' });
  });

  it('km_tanpa_estimasi -> isi sisi kosong dengan anchor', () => {
    const r = estimateOdo({ ...base, kmAwal: 0, kmAkhir: 0, kmTanpaEstimasi: true, standarKmL: 0, literKonsumsi: 0, prevKmAkhir: 700 });
    expect(r).toEqual({ kmAwal: 700, kmAkhir: 700, kmTempuh: 0, kmSumber: 'ESTIMASI' });
  });

  it('tanpa estimasi -> throw pesan GAS sesuai sebab', () => {
    expect(() => estimateOdo({ ...base, standarKmL: 0 })).toThrow(OdoEstimateError);
    expect(() => estimateOdo({ ...base, standarKmL: 0 })).toThrow(MSG_ODO_NO_STANDAR);
    expect(() => estimateOdo({ ...base, standarKmL: 10, literKonsumsi: 0 })).toThrow(MSG_ODO_NO_LITER);
  });

  it('tidak rusak -> AKTUAL', () => {
    expect(estimateOdo({ ...base, kmAwalBroken: false, kmAkhirBroken: false, kmAwal: 10, kmAkhir: 60 }))
      .toEqual({ kmAwal: 10, kmAkhir: 60, kmTempuh: 50, kmSumber: 'AKTUAL' });
  });
});

describe('liter konsumsi, efisiensi, warning, formatter', () => {
  it('literPerBarFor & computeLiterKonsumsi (clamp)', () => {
    expect(literPerBarFor(50, 8)).toBe(6.25);
    expect(literPerBarFor(0, 8)).toBe(0);
    expect(computeLiterKonsumsi(10, 8, 4, 6.25)).toBe(35);
    expect(computeLiterKonsumsi(10, 0, 8, 6.25)).toBe(10);
  });

  it('computeEfisiensi & classify', () => {
    expect(computeEfisiensi(100, 10)).toBe('10.00');
    expect(computeEfisiensi(100, 0)).toBe('');
    expect(classifyEfisiensiStatus('10', 12)).toBe('Di bawah standar');
    expect(classifyEfisiensiStatus('12', 12)).toBe('Sesuai standar');
    expect(classifyEfisiensiStatus('16', 12)).toBe('Di atas standar');
    expect(classifyEfisiensiStatus('', 12)).toBe('');
  });

  it('storeMetodeBbm', () => {
    expect(storeMetodeBbm(50000, 'FLAZZ')).toBe('FLAZZ');
    expect(storeMetodeBbm(0, 'FLAZZ')).toBe('');
    expect(storeMetodeBbm(50000, '')).toBe('TUNAI');
  });

  it('buildOdoWarning verbatim', () => {
    expect(buildOdoWarning(1500, 1400, '2026-09-20'))
      .toBe('SELISIH ODO: KM akhir terakhir 1.400 (20/09/2026), KM awal 1.500, selisih 100 KM - indikasi pemakaian di luar jam kerja');
  });

  it('formatIdNumber & formatDateId', () => {
    expect(formatIdNumber(1234567)).toBe('1.234.567');
    expect(formatIdNumber(0)).toBe('0');
    expect(formatDateId('2026-09-21')).toBe('21/09/2026');
    expect(formatDateId('')).toBe('-');
  });
});

describe('hitungEfisiensi7Riwayat', () => {
  const mk = (i: number, over: Partial<LaporanRow> = {}) => row({
    transaction_id: 'TRX-' + i, tanggal: `2026-09-${String(i).padStart(2, '0')}`,
    km_tempuh: 100, liter_bbm: 10, bar_awal: '8', bar_akhir: '4', km_sumber: 'AKTUAL', ...over,
  });

  it('butuh 7 baris; slice aman untuk currIdx < 6', () => {
    const trxs = Array.from({ length: 7 }, (_, i) => mk(i + 1));
    expect(hitungEfisiensi7Riwayat(trxs, 6, 0).isDataCukup).toBe(true);
    expect(hitungEfisiensi7Riwayat(trxs, 5, 0).isDataCukup).toBe(false);
    expect(hitungEfisiensi7Riwayat(trxs, 0, 0).efisiensi).toBe('10.00');
    expect(hitungEfisiensi7Riwayat([], 0, 0).isDataCukup).toBe(false);
  });

  it('label âš  bila ada estimasi; total konsumsi memperhitungkan bar', () => {
    const trxs = Array.from({ length: 7 }, (_, i) => mk(i + 1));
    trxs[6] = { ...trxs[6]!, km_sumber: 'ESTIMASI' };
    const r = hitungEfisiensi7Riwayat(trxs, 6, 6.25);
    // totalBeli 70, bar 8->4 => +25 => 95 ; totalKm 700
    expect(r.totalBeli).toBe(70);
    expect(r.totalKonsumsi).toBe(95);
    expect(r.efisiensi).toBe((700 / 95).toFixed(2));
    expect(r.label).toBe('Rata-rata 7 Trip âš  termasuk estimasi');
    expect(r.supir).toBe('Supir A');
  });

  it('total konsumsi <= 0 -> fallback totalBeli; km 0 -> efisiensi kosong', () => {
    const trxs = Array.from({ length: 7 }, (_, i) => mk(i + 1, { bar_akhir: '28', liter_bbm: 10 }));
    expect(hitungEfisiensi7Riwayat(trxs, 6, 6.25).totalKonsumsi).toBe(70);
    const zeroKm = Array.from({ length: 7 }, (_, i) => mk(i + 1, { km_tempuh: 0 }));
    expect(hitungEfisiensi7Riwayat(zeroKm, 6, 0).efisiensi).toBe('');
    expect(hitungEfisiensi7Riwayat(zeroKm, 6, 0).label).toBe('');
  });
});

describe('helper usage & pesan', () => {
  it('shouldAdjustUsageOpeningAt & shouldAutoCreateUsageOnEdit', () => {
    expect(shouldAdjustUsageOpeningAt(null, 100)).toBe(true);
    expect(shouldAdjustUsageOpeningAt(50, null)).toBe(true);
    expect(shouldAdjustUsageOpeningAt(50, 100)).toBe(true);
    expect(shouldAdjustUsageOpeningAt(150, 100)).toBe(false);
    expect(shouldAutoCreateUsageOnEdit(false, true)).toBe(true);
    expect(shouldAutoCreateUsageOnEdit(true, true)).toBe(false);
  });

  it('pesan verbatim', () => {
    expect(msgCardNotFound(['BBM', 'tol'], 'FLZ-1'))
      .toBe('Kartu Flazz untuk BBM + tol (ID: FLZ-1) tidak ditemukan. Pilih ulang kartu Flazz yang valid sebelum menyimpan laporan.');
    expect(msgInsufficient('Kartu A', ['BBM'], 10000, 25000))
      .toBe('Saldo kartu Flazz (Kartu A) tidak mencukupi untuk BBM. Saldo: Rp 10.000, Total pengeluaran: Rp 25.000. Silakan top up Flazz terlebih dahulu.');
    expect(msgEditInsufficient(5000))
      .toBe('Saldo kartu tidak mencukupi untuk koreksi ini (sisa Rp 5.000). Lakukan Top Up atau selesaikan Rekonsiliasi terlebih dahulu.');
  });
});
```

- [x] **Step 3: Jalankan**

```powershell
npm run typecheck
npx vitest run tests/logic/laporan.test.ts
```

Harapan: hijau.

- [x] **Step 4: Commit**

```bash
git add src/logic/laporan.ts tests/logic/laporan.test.ts
git commit -m "feat(logic): M3 payment/odo/efisiensi murni + tests"
```

---

## Task 3: `src/logic/laporan.ts` bagian 2 â€” mapping prefill/riwayat/performa/monthly

**Files:**
- Edit: `src/logic/laporan.ts`
- Edit: `tests/logic/laporan.test.ts`

**Produces:** `isDuplicateRow`, `supabaseThumb`, `resolveCanonicalCardId`, `mapPrefillRow`, `buildRecentList`, `buildPerformaList`, `groupMonthly` + tipe output.

- [x] **Step 1: Tambahkan ke `src/logic/laporan.ts`**

```ts
// â”€â”€ Mapping baris (port SpreadsheetOps.js) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export interface DuplicateKey {
  vehicle_id: string;
  tanggal: string;
  km_awal: string;
  km_akhir: string;
  liter: string;
  biaya_bbm: string;
  biaya_toll: string;
}

export function isDuplicateRow(row: LaporanRow, key: DuplicateKey): boolean {
  return String(row.vehicle_id) === key.vehicle_id &&
    String(row.tanggal) === key.tanggal &&
    String(row.km_awal_confirmed) === key.km_awal &&
    String(row.km_akhir_confirmed) === key.km_akhir &&
    String(num(row.liter_bbm)) === key.liter &&
    String(num(row.biaya_bbm)) === key.biaya_bbm &&
    String(num(row.biaya_toll)) === key.biaya_toll;
}

export function resolveCanonicalCardId(rawId: unknown, cardMap?: Map<string, string>): string {
  if (rawId == null || rawId === '') return '';
  const raw = String(rawId);
  if (cardMap) {
    const found = cardMap.get(canonicalCardId(raw));
    if (found) return found;
  }
  return raw;
}

export function supabaseThumb(url: string): string {
  if (!url) return '';
  const clean = String(url).split('?')[0] ?? '';
  if (clean.includes('/storage/v1/object/public/')) {
    return clean.replace('/storage/v1/object/public/', '/storage/v1/render/image/public/') + '?width=200';
  }
  return clean + '?width=200';
}

export interface Prefill {
  vehicle_id: string;
  plat_nomor: string;
  nama_supir: string;
  tanggal: string;
  bar_awal: string;
  bar_akhir: string;
  biaya_bbm: number;
  liter_bbm: number;
  metode_pembayaran: string;
  flazz_card_id: string;
  metode_toll: string;
  flazz_card_id_toll: string;
}

export function mapPrefillRow(row: LaporanRow, cardMap: Map<string, string>): Prefill {
  const metodeToll = resolveTollMethod(row.metode_toll, row.metode_pembayaran, row.flazz_card_id_toll);
  const cardToll = resolveTollCard(row.flazz_card_id_toll, metodeToll, row.metode_pembayaran, row.flazz_card_id);
  return {
    vehicle_id: row.vehicle_id,
    plat_nomor: row.plat_nomor,
    nama_supir: row.nama_supir || '',
    tanggal: String(row.tanggal || '').substring(0, 10),
    bar_awal: row.bar_awal,
    bar_akhir: row.bar_akhir,
    biaya_bbm: num(row.biaya_bbm),
    liter_bbm: num(row.liter_bbm),
    metode_pembayaran: row.metode_pembayaran || 'TUNAI',
    flazz_card_id: resolveCanonicalCardId(row.flazz_card_id, cardMap),
    metode_toll: metodeToll,
    flazz_card_id_toll: resolveCanonicalCardId(cardToll, cardMap),
  };
}

export interface KendaraanInfo { kapasitas: number; jumlah_bar: number; standar: number; }
export type KendaraanMap = Map<string, KendaraanInfo>;
export type CabangNamaMap = Map<string, string>;
export type CardMap = Map<string, string>;

function groupByVehicleSorted(rows: LaporanRow[]): Map<string, LaporanRow[]> {
  const groups = new Map<string, LaporanRow[]>();
  for (const r of rows) {
    if (!r.vehicle_id) continue;
    const arr = groups.get(r.vehicle_id);
    if (arr) arr.push(r);
    else groups.set(r.vehicle_id, [r]);
  }
  for (const arr of groups.values()) {
    arr.sort((a, b) => {
      const tA = parseTanggalMs(a.tanggal);
      const tB = parseTanggalMs(b.tanggal);
      if (tA === tB) return (parseTimestampMs(a.timestamp) ?? 0) - (parseTimestampMs(b.timestamp) ?? 0);
      return tA - tB;
    });
  }
  return groups;
}

export interface PerformaItem {
  periode: string;
  timestamp: number;
  cabang: string;
  vehicle: string;
  supir: string;
  total_km: number;
  total_beli: number;
  total_konsumsi: number;
  efisiensi: string;
  status_efisiensi: string;
}

export function buildPerformaList(rows: LaporanRow[], kendaraanMap: KendaraanMap, cabangNamaMap: CabangNamaMap): PerformaItem[] {
  const groups = groupByVehicleSorted(rows);
  const result: PerformaItem[] = [];
  for (const [vid, trxs] of groups) {
    const k = kendaraanMap.get(vid) ?? { kapasitas: 0, jumlah_bar: 0, standar: 0 };
    const literPerBar = literPerBarFor(k.kapasitas, k.jumlah_bar);
    for (let i = 0; i < trxs.length; i++) {
      if ((i + 1) % 7 !== 0) continue;
      const roll = hitungEfisiensi7Riwayat(trxs, i, literPerBar);
      if (!roll.isDataCukup) continue;
      const r = trxs[i];
      if (!r) continue;
      result.push({
        periode: formatDateId(roll.tglMulai) + ' s/d ' + formatDateId(roll.tglSelesai),
        timestamp: parseTanggalMs(roll.tglSelesai),
        cabang: cabangNamaMap.get(r.kode_cabang) ?? r.kode_cabang,
        vehicle: r.plat_nomor,
        supir: roll.supir,
        total_km: roll.totalKm,
        total_beli: roll.totalBeli,
        total_konsumsi: Math.round(roll.totalKonsumsi * 100) / 100,
        efisiensi: roll.efisiensi,
        status_efisiensi: classifyEfisiensiStatus(roll.efisiensi, k.standar),
      });
    }
  }
  result.sort((a, b) => b.timestamp - a.timestamp);
  return result;
}

export interface RecentItem {
  tanggal: string;
  timestamp: number;
  sub_timestamp: number;
  user: string;
  cabang: string;
  kode_cabang: string;
  vehicle_id: string;
  vehicle: string;
  bar_awal: number;
  bar_akhir: number;
  km_tempuh: number;
  isi_bbm: number;
  liter: number;
  toll: number;
  efisiensi: string;
  status_efisiensi: string;
  efisiensi_label: string;
  warning: string;
  supir: string;
  transaction_id: string;
  biaya_bbm: number;
  metode_pembayaran: string;
  flazz_card_id: string;
  metode_toll: string;
  flazz_card_id_toll: string;
  km_awal: number;
  km_akhir: number;
  km_sumber: string;
  foto_odo_awal: string;
  foto_odo_akhir: string;
  foto_struk_bbm: string;
  foto_struk_toll: string;
  foto_odo_awal_thumb: string;
  foto_odo_akhir_thumb: string;
  foto_struk_bbm_thumb: string;
  foto_struk_toll_thumb: string;
}

export function buildRecentList(rows: LaporanRow[], kendaraanMap: KendaraanMap, cabangNamaMap: CabangNamaMap, cardMap: CardMap): RecentItem[] {
  const groups = groupByVehicleSorted(rows);
  const rowIdx = new Map<LaporanRow, number>();
  for (const arr of groups.values()) arr.forEach((r, i) => rowIdx.set(r, i));

  const result: RecentItem[] = [];
  const start = rows.length > 200 ? rows.length - 200 : 0;
  for (let i = rows.length - 1; i >= start; i--) {
    const row = rows[i];
    if (!row) continue;
    const k = kendaraanMap.get(row.vehicle_id) ?? { kapasitas: 0, jumlah_bar: 0, standar: 0 };
    const literPerBar = literPerBarFor(k.kapasitas, k.jumlah_bar);
    const literBeli = num(row.liter_bbm);
    const barAwal = num(row.bar_awal);
    const barAkhir = num(row.bar_akhir);
    const literKonsumsi = computeLiterKonsumsi(literBeli, barAwal, barAkhir, literPerBar);
    const trxs = groups.get(row.vehicle_id) ?? [];
    const currIdx = rowIdx.get(row) ?? -1;
    const roll = hitungEfisiensi7Riwayat(trxs, currIdx, literPerBar);
    let efisiensi = roll.efisiensi;
    let label = roll.label;
    let statusEfisiensi: string;
    if (!roll.isDataCukup) {
      statusEfisiensi = 'Data Belum Cukup';
      efisiensi = '';
      label = '';
    } else {
      statusEfisiensi = classifyEfisiensiStatus(efisiensi, k.standar);
    }

    let dynamicWarning = '';
    if (currIdx > 0) {
      const prev = trxs[currIdx - 1];
      const prevKmAkhir = prev ? numOrNull(prev.km_akhir_confirmed) : null;
      const currKmAwal = numOrNull(row.km_awal_confirmed);
      if (prev && prevKmAkhir !== null && currKmAwal !== null && prevKmAkhir !== currKmAwal) {
        dynamicWarning = buildOdoWarning(currKmAwal, prevKmAkhir, prev.tanggal);
      }
    }

    const metodeToll = resolveTollMethod(row.metode_toll, row.metode_pembayaran, row.flazz_card_id_toll);
    result.push({
      tanggal: formatDateId(row.tanggal),
      timestamp: parseTanggalMs(row.tanggal),
      sub_timestamp: parseTimestampMs(row.timestamp) ?? 0,
      user: row.nama_pengguna,
      cabang: cabangNamaMap.get(row.kode_cabang) ?? row.kode_cabang,
      kode_cabang: row.kode_cabang,
      vehicle_id: row.vehicle_id,
      vehicle: row.plat_nomor,
      bar_awal: barAwal,
      bar_akhir: barAkhir,
      km_tempuh: num(row.km_tempuh),
      isi_bbm: literBeli,
      liter: Math.round(literKonsumsi * 100) / 100,
      toll: row.biaya_toll,
      efisiensi,
      status_efisiensi: statusEfisiensi,
      efisiensi_label: label,
      warning: dynamicWarning,
      supir: row.nama_supir || '-',
      transaction_id: row.transaction_id,
      biaya_bbm: num(row.biaya_bbm),
      metode_pembayaran: num(row.biaya_bbm) > 0 ? (row.metode_pembayaran || 'TUNAI') : (row.metode_pembayaran || ''),
      flazz_card_id: resolveCanonicalCardId(row.flazz_card_id, cardMap),
      metode_toll: metodeToll,
      flazz_card_id_toll: resolveCanonicalCardId(resolveTollCard(row.flazz_card_id_toll, metodeToll, row.metode_pembayaran, row.flazz_card_id), cardMap),
      km_awal: num(row.km_awal_confirmed),
      km_akhir: num(row.km_akhir_confirmed),
      km_sumber: row.km_sumber ? String(row.km_sumber) : 'AKTUAL',
      foto_odo_awal: row.foto_km_awal,
      foto_odo_akhir: row.foto_km_akhir,
      foto_struk_bbm: row.foto_struk_bbm,
      foto_struk_toll: row.foto_struk_toll,
      foto_odo_awal_thumb: supabaseThumb(row.foto_km_awal),
      foto_odo_akhir_thumb: supabaseThumb(row.foto_km_akhir),
      foto_struk_bbm_thumb: supabaseThumb(row.foto_struk_bbm),
      foto_struk_toll_thumb: supabaseThumb(row.foto_struk_toll),
    });
  }

  result.sort((a, b) => {
    if (b.timestamp === a.timestamp) return b.sub_timestamp - a.sub_timestamp;
    return b.timestamp - a.timestamp;
  });
  return result;
}

export interface MonthlyItem {
  cabang: string;
  periode: string;
  total_transaksi: number;
  total_liter: number;
  total_biaya_bbm: number;
  total_toll: number;
}

export function groupMonthly(rows: LaporanRow[], periode: string): MonthlyItem[] {
  const map = new Map<string, MonthlyItem>();
  for (const r of rows) {
    if (periodKey(r.tanggal) !== periode) continue;
    let m = map.get(r.kode_cabang);
    if (!m) {
      m = { cabang: r.kode_cabang, periode, total_transaksi: 0, total_liter: 0, total_biaya_bbm: 0, total_toll: 0 };
      map.set(r.kode_cabang, m);
    }
    m.total_transaksi += 1;
    m.total_liter += num(r.liter_bbm);
    m.total_biaya_bbm += num(r.biaya_bbm);
    m.total_toll += num(r.biaya_toll);
  }
  const out = [...map.values()].map((m) => ({
    ...m,
    total_liter: Math.round(m.total_liter * 100) / 100,
    total_biaya_bbm: Math.round(m.total_biaya_bbm * 100) / 100,
    total_toll: Math.round(m.total_toll * 100) / 100,
  }));
  out.sort((a, b) => a.cabang.localeCompare(b.cabang));
  return out;
}
```

- [x] **Step 2: Tambahkan test ke `tests/logic/laporan.test.ts`**

```ts
import {
  buildPerformaList, buildRecentList, groupMonthly, isDuplicateRow, mapPrefillRow, supabaseThumb,
} from '../../src/logic/laporan';

describe('mapping', () => {
  it('isDuplicateRow membandingkan string efektif', () => {
    const r = row({ km_awal_confirmed: '100', km_akhir_confirmed: '200', liter_bbm: 10, biaya_bbm: 100000, biaya_toll: 0 });
    expect(isDuplicateRow(r, { vehicle_id: 'V-1', tanggal: '2026-09-01', km_awal: '100', km_akhir: '200', liter: '10', biaya_bbm: '100000', biaya_toll: '0' })).toBe(true);
    expect(isDuplicateRow(r, { vehicle_id: 'V-1', tanggal: '2026-09-01', km_awal: '100', km_akhir: '200', liter: '11', biaya_bbm: '100000', biaya_toll: '0' })).toBe(false);
  });

  it('supabaseThumb menulis ulang ke render endpoint', () => {
    expect(supabaseThumb('https://x.supabase.co/storage/v1/object/public/foto/CBG-A/KM_Awal/a.jpg'))
      .toBe('https://x.supabase.co/storage/v1/render/image/public/foto/CBG-A/KM_Awal/a.jpg?width=200');
    expect(supabaseThumb('')).toBe('');
  });

  it('mapPrefillRow meresolusi tol & kartu kanonik', () => {
    const cardMap = new Map([['FLZ1', 'FLZ-1']]);
    const r = row({ flazz_card_id: 'FLZ1', metode_pembayaran: 'FLAZZ', metode_toll: '', flazz_card_id_toll: '' });
    const p = mapPrefillRow(r, cardMap);
    expect(p.flazz_card_id).toBe('FLZ-1');
    expect(p.metode_toll).toBe('FLAZZ');
    expect(p.flazz_card_id_toll).toBe('FLZ-1');
    expect(p.tanggal).toBe('2026-09-01');
  });
});

describe('buildPerformaList (window non-overlap)', () => {
  const mk = (i: number, vid = 'V-1') => row({ transaction_id: 'TRX-' + i, vehicle_id: vid, plat_nomor: vid === 'V-1' ? 'B 1 A' : 'B 2 B', tanggal: `2026-09-${String(i).padStart(2, '0')}`, km_tempuh: 100, liter_bbm: 10, bar_awal: '8', bar_akhir: '4' });
  const kmap = new Map([['V-1', { kapasitas: 50, jumlah_bar: 8, standar: 10 }], ['V-2', { kapasitas: 50, jumlah_bar: 8, standar: 10 }]]);
  const cmap = new Map([['CBG-A', 'Cabang A']]);

  it('hanya tiap kelipatan 7 dan butuh 7 baris', () => {
    const rows = Array.from({ length: 14 }, (_, i) => mk(i + 1));
    const out = buildPerformaList(rows, kmap, cmap);
    expect(out).toHaveLength(2); // i=6 dan i=13
    expect(out[0]!.periode).toContain(' s/d ');
    expect(out[0]!.cabang).toBe('Cabang A');
    expect(out[0]!.status_efisiensi).toBeDefined();
  });

  it('6 baris -> tidak ada output', () => {
    expect(buildPerformaList(Array.from({ length: 6 }, (_, i) => mk(i + 1)), kmap, cmap)).toHaveLength(0);
  });
});

describe('buildRecentList', () => {
  const kmap = new Map([['V-1', { kapasitas: 50, jumlah_bar: 8, standar: 10 }]]);
  const cmap = new Map([['CBG-A', 'Cabang A']]);
  const cards = new Map([['FLZ1', 'FLZ-1']]);
  const mk = (i: number, over: Partial<LaporanRow> = {}) => row({
    transaction_id: 'TRX-' + i, tanggal: `2026-09-${String(i).padStart(2, '0')}`,
    timestamp: `2026-09-${String(i).padStart(2, '0')}T0${i % 10}:00:00.000Z`,
    km_awal_confirmed: String(100 * i), km_akhir_confirmed: String(100 * i + 100),
    km_tempuh: 100, liter_bbm: 10, bar_awal: '8', bar_akhir: '4', ...over,
  });

  it('Data Belum Cukup bila < 7 riwayat; warning dinamis dari prev', () => {
    const rows = [mk(1), mk(2, { km_awal_confirmed: '250' }), mk(3)];
    const out = buildRecentList(rows, kmap, cmap, cards);
    const t2 = out.find((x) => x.transaction_id === 'TRX-2')!;
    expect(t2.status_efisiensi).toBe('Data Belum Cukup');
    expect(t2.efisiensi).toBe('');
    expect(t2.warning).toBe('SELISIH ODO: KM akhir terakhir 200 (01/09/2026), KM awal 250, selisih 50 KM - indikasi pemakaian di luar jam kerja');
  });

  it('sort timestamp desc lalu sub_timestamp desc; thumb diisi', () => {
    const rows = [mk(1), mk(2), mk(3, { foto_km_awal: 'https://x/storage/v1/object/public/foto/a.jpg' })];
    const out = buildRecentList(rows, kmap, cmap, cards);
    expect(out[0]!.transaction_id).toBe('TRX-3');
    expect(out[0]!.foto_odo_awal_thumb).toContain('/render/image/public/');
    expect(out[2]!.transaction_id).toBe('TRX-1');
  });

  it('hanya memproses 200 baris terakhir', () => {
    const rows = Array.from({ length: 205 }, (_, i) => mk((i % 28) + 1));
    expect(buildRecentList(rows, kmap, cmap, cards).length).toBeLessThanOrEqual(201);
  });
});

describe('groupMonthly', () => {
  it('group per cabang, 2 desimal, urut cabang', () => {
    const rows = [
      row({ kode_cabang: 'CBG-B', tanggal: '2026-09-02', liter_bbm: 10.555, biaya_bbm: 100, biaya_toll: 5 }),
      row({ kode_cabang: 'CBG-A', tanggal: '2026-09-01', liter_bbm: 5, biaya_bbm: 50, biaya_toll: 0 }),
      row({ kode_cabang: 'CBG-A', tanggal: '2026-09-03', liter_bbm: 5, biaya_bbm: 50, biaya_toll: 0 }),
      row({ kode_cabang: 'CBG-A', tanggal: '2026-08-31', liter_bbm: 99, biaya_bbm: 99, biaya_toll: 0 }),
    ];
    const out = groupMonthly(rows, '2026-09');
    expect(out.map((m) => m.cabang)).toEqual(['CBG-A', 'CBG-B']);
    expect(out[0]).toMatchObject({ total_transaksi: 2, total_liter: 10, total_biaya_bbm: 100, total_toll: 0 });
    expect(out[1]).toMatchObject({ total_transaksi: 1, total_liter: 10.56, total_biaya_bbm: 100, total_toll: 5 });
  });
});
```

- [x] **Step 3: Jalankan**

```powershell
npm run typecheck
npx vitest run tests/logic/laporan.test.ts
```

- [x] **Step 4: Commit**

```bash
git add src/logic/laporan.ts tests/logic/laporan.test.ts
git commit -m "feat(logic): M3 mapping prefill/riwayat/performa/monthly + tests"
```

---

## Task 4: `src/db/laporan.ts` + `memLaporan` + wiring deps/helpers

**Files:**
- Create: `src/db/laporan.ts`
- Edit: `tests/helpers.ts`
- Create: `tests/db/laporan-mem.test.ts`

**Produces:** `LaporanRepo` + `supabaseLaporanRepo(env)` + `CardBalanceError`; `memLaporan`/`memStorage`/`laporanRow` di helpers; `AppDeps.laporan` ter-wire.

- [x] **Step 1: Tulis `src/db/laporan.ts`**

```ts
import type { Env } from '../env';
import { getSupabase } from './client';
import type { LaporanInsert, LaporanRow } from '../logic/laporan';
import { canonicalCardId } from '../logic/laporan';

export type { LaporanInsert, LaporanRow };

export interface FlazzCardRow {
  id: string;
  card_number: string;
  card_name: string;
  branch_id: string;
  driver_id: string;
  default_driver_id: string;
  last_balance: number;
  status: string;
}

export interface UsageRow {
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

export interface JalurRow {
  id: string;
  tanggal: string;
  nama_driver: string;
  vehicle_id: string;
  kode_cabang: string;
  status: string;
  laporan_id: string;
  is_deleted?: string;
  created_at?: string;
}

export interface JalurCriteria {
  tanggal: string;
  vehicle_id: string;
  nama_driver: string;
  kode_cabang: string;
}

export interface CreateUsageOpts {
  cardId: string;
  driverName: string;
  vehicleId: string;
  refType: string;
  refId: string;
  usedAt: string;
}

export class CardBalanceError extends Error {
  cardId: string;
  balance: number;
  constructor(cardId: string, balance: number) {
    super('Saldo kartu tidak mencukupi');
    this.cardId = cardId;
    this.balance = balance;
  }
}

export interface LaporanRepo {
  findById(transaction_id: string): Promise<LaporanRow | null>;
  lastForVehicle(vehicle_id: string): Promise<{ km_akhir: number | null; tanggal: string } | null>;
  recentRows(cabang: string, limit: number): Promise<LaporanRow[]>;
  rowsInScope(cabang: string, limit: number): Promise<LaporanRow[]>;
  duplicateCandidates(cabang: string, limit: number): Promise<LaporanRow[]>;
  rowsInMonth(cabang: string, periode: string): Promise<LaporanRow[]>;
  insert(row: LaporanInsert): Promise<void>;
  update(transaction_id: string, patch: Partial<LaporanInsert>): Promise<void>;
  delete(transaction_id: string): Promise<void>;
  findAllCards(): Promise<FlazzCardRow[]>;
  findFlazzCardById(id: string): Promise<FlazzCardRow | null>;
  adjustBalance(cardId: string, delta: number): Promise<number>;
  setBalance(cardId: string, balance: number): Promise<void>;
  hasActiveUsage(cardId: string): Promise<boolean>;
  createUsage(opts: CreateUsageOpts): Promise<void>;
  adjustActiveUsageOpening(cardId: string, delta: number): Promise<void>;
  returnUsageForRef(refType: string, refId: string): Promise<void>;
  latestGivenAt(cardId: string): Promise<number | null>;
  findJalurByCriteria(criteria: JalurCriteria): Promise<JalurRow | null>;
  setJalurStatus(jalurId: string, status: string, laporanId: string): Promise<void>;
  releaseJalurReport(laporanId: string): Promise<void>;
}

export function supabaseLaporanRepo(env: Env): LaporanRepo {
  const sb = () => getSupabase(env);
  const fail = (kind: string) => (err: unknown): never => {
    throw new Error(`DB ${kind}: ${(err as Error)?.message ?? String(err)}`);
  };
  const nowIso = () => new Date().toISOString();

  async function rowsInScope(cabang: string, limit: number): Promise<LaporanRow[]> {
    let q = sb().from('penggunaan_bbm').select('*').order('seq', { ascending: false }).limit(limit);
    if (cabang) q = q.eq('kode_cabang', cabang);
    const { data, error } = await q;
    if (error) throw fail('rowsInScope')(error);
    return (data as unknown as LaporanRow[]).slice().reverse();
  }

  async function latestGiven(cardId: string): Promise<number | null> {
    const { data, error } = await sb().from('flazz_usage')
      .select('used_at,date,created_at')
      .eq('card_id', cardId).eq('status', 'DIBERIKAN')
      .order('created_at', { ascending: false }).limit(1);
    if (error) throw fail('latestGivenAt')(error);
    const row = (data as Array<{ used_at: string; date: string }> | null)?.[0];
    if (!row) return null;
    const t = new Date(row.used_at || row.date).getTime();
    return isNaN(t) ? null : t;
  }

  return {
    async findById(id) {
      const { data, error } = await sb().from('penggunaan_bbm').select('*').eq('transaction_id', id).maybeSingle();
      if (error) throw fail('findById')(error);
      return (data as unknown as LaporanRow | null) ?? null;
    },

    async lastForVehicle(vehicle_id) {
      const { data, error } = await sb().from('penggunaan_bbm')
        .select('km_akhir_confirmed,tanggal').eq('vehicle_id', vehicle_id)
        .order('seq', { ascending: false }).limit(1).maybeSingle();
      if (error) throw fail('lastForVehicle')(error);
      if (!data) return null;
      const v = parseFloat(String((data as { km_akhir_confirmed: string }).km_akhir_confirmed));
      return { km_akhir: isNaN(v) ? null : v, tanggal: String((data as { tanggal: string }).tanggal) };
    },

    recentRows(cabang, limit) { return rowsInScope(cabang, limit); },
    rowsInScope(cabang, limit) { return rowsInScope(cabang, limit); },
    duplicateCandidates(cabang, limit) { return rowsInScope(cabang, limit); },

    async rowsInMonth(cabang, periode) {
      let q = sb().from('penggunaan_bbm').select('*').like('tanggal', periode + '-%');
      if (cabang) q = q.eq('kode_cabang', cabang);
      const { data, error } = await q;
      if (error) throw fail('rowsInMonth')(error);
      return data as unknown as LaporanRow[];
    },

    async insert(row) {
      const { error } = await sb().from('penggunaan_bbm').insert(row);
      if (error) throw fail('insert')(error);
    },

    async update(id, patch) {
      const { error } = await sb().from('penggunaan_bbm').update(patch).eq('transaction_id', id);
      if (error) throw fail('update')(error);
    },

    async delete(id) {
      const { error } = await sb().from('penggunaan_bbm').delete().eq('transaction_id', id);
      if (error) throw fail('delete')(error);
    },

    async findAllCards() {
      const { data, error } = await sb().from('flazz_card')
        .select('id,card_number,card_name,branch_id,driver_id,default_driver_id,last_balance,status');
      if (error) throw fail('findAllCards')(error);
      return data as unknown as FlazzCardRow[];
    },

    async findFlazzCardById(id) {
      const cards = await this.findAllCards();
      return cards.find((c) => canonicalCardId(c.id) === canonicalCardId(id)) ?? null;
    },

    async adjustBalance(cardId, delta) {
      if (delta < 0) {
        const amount = -delta;
        for (let attempt = 0; attempt < 5; attempt++) {
          const { data: card, error: readErr } = await sb().from('flazz_card')
            .select('id,last_balance').eq('id', cardId).maybeSingle();
          if (readErr) throw fail('adjustBalance:read')(readErr);
          if (!card) throw new CardBalanceError(cardId, 0);
          const bal = Number((card as { last_balance: number }).last_balance) || 0;
          if (bal < amount) throw new CardBalanceError(cardId, bal);
          const { data: updated, error: upErr } = await sb().from('flazz_card')
            .update({ last_balance: bal - amount, updated_at: nowIso() })
            .eq('id', cardId).eq('last_balance', bal).select('id');
          if (upErr) throw fail('adjustBalance:update')(upErr);
          if (updated && updated.length) return bal - amount;
        }
        throw new CardBalanceError(cardId, 0);
      }
      const { data: card, error: readErr } = await sb().from('flazz_card')
        .select('last_balance').eq('id', cardId).maybeSingle();
      if (readErr) throw fail('adjustBalance:read')(readErr);
      if (!card) throw new CardBalanceError(cardId, 0);
      const bal = Number((card as { last_balance: number }).last_balance) || 0;
      const { error } = await sb().from('flazz_card')
        .update({ last_balance: bal + delta, updated_at: nowIso() }).eq('id', cardId);
      if (error) throw fail('adjustBalance:update')(error);
      return bal + delta;
    },

    async setBalance(cardId, balance) {
      const { error } = await sb().from('flazz_card').update({ last_balance: balance, updated_at: nowIso() }).eq('id', cardId);
      if (error) throw fail('setBalance')(error);
    },

    async hasActiveUsage(cardId) {
      const { count, error } = await sb().from('flazz_usage')
        .select('id', { count: 'exact', head: true }).eq('card_id', cardId).eq('status', 'DIBERIKAN');
      if (error) throw fail('hasActiveUsage')(error);
      return (count ?? 0) > 0;
    },

    async createUsage(opts) {
      const { data: card } = await sb().from('flazz_card').select('id,last_balance,driver_id').eq('id', opts.cardId).maybeSingle();
      const c = card as { id: string; last_balance: number; driver_id: string } | null;
      const id = 'USE-' + Date.now() + '-' + crypto.randomUUID().slice(0, 4);
      const { error } = await sb().from('flazz_usage').insert({
        id, date: opts.usedAt, card_id: c?.id ?? opts.cardId, driver_id: opts.driverName,
        vehicle_id: opts.vehicleId, usage_type: 'PRIMARY', opening_balance: Number(c?.last_balance) || 0,
        used_at: opts.usedAt, returned_at: '', status: 'DIBERIKAN', created_by: '', created_at: nowIso(),
        ref_type: opts.refType, ref_id: opts.refId,
      });
      if (error) throw fail('createUsage')(error);
      const patch: Record<string, unknown> = { status: 'SEDANG_DIGUNAKAN', updated_at: nowIso() };
      if (!c?.driver_id) patch.driver_id = opts.driverName;
      const { error: upErr } = await sb().from('flazz_card').update(patch).eq('id', c?.id ?? opts.cardId);
      if (upErr) throw fail('createUsage:card')(upErr);
    },

    async adjustActiveUsageOpening(cardId, delta) {
      if (!delta) return;
      const { data, error } = await sb().from('flazz_usage')
        .select('id,opening_balance').eq('card_id', cardId).eq('status', 'DIBERIKAN')
        .order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw fail('adjustActiveUsageOpening')(error);
      if (!data) return;
      const u = data as { id: string; opening_balance: number };
      const { error: upErr } = await sb().from('flazz_usage')
        .update({ opening_balance: (Number(u.opening_balance) || 0) + delta }).eq('id', u.id);
      if (upErr) throw fail('adjustActiveUsageOpening:update')(upErr);
    },

    async returnUsageForRef(refType, refId) {
      const { data, error } = await sb().from('flazz_usage')
        .select('id,card_id').eq('ref_type', refType).eq('ref_id', refId).eq('status', 'DIBERIKAN');
      if (error) throw fail('returnUsageForRef')(error);
      const rows = (data as Array<{ id: string; card_id: string }> | null) ?? [];
      if (!rows.length) return;
      const { error: upErr } = await sb().from('flazz_usage')
        .update({ status: 'DIKEMBALIKAN', returned_at: nowIso() }).eq('ref_type', refType).eq('ref_id', refId).eq('status', 'DIBERIKAN');
      if (upErr) throw fail('returnUsageForRef:update')(upErr);
      const affected = [...new Set(rows.map((r) => r.card_id))];
      for (const cid of affected) {
        if (await this.hasActiveUsage(cid)) continue;
        const { data: card } = await sb().from('flazz_card').select('id,status,default_driver_id').eq('id', cid).maybeSingle();
        if (!card) continue;
        const cc = card as { id: string; status: string; default_driver_id: string };
        const { error: cErr } = await sb().from('flazz_card').update({
          status: cc.status === 'SEDANG_DIGUNAKAN' ? 'TERSEDIA' : cc.status,
          driver_id: cc.default_driver_id || '', updated_at: nowIso(),
        }).eq('id', cid);
        if (cErr) throw fail('returnUsageForRef:card')(cErr);
      }
    },

    latestGivenAt(cardId) { return latestGiven(cardId); },

    async findJalurByCriteria(criteria) {
      let q = sb().from('jalur_pengiriman').select('*').or('is_deleted.is.null,is_deleted.neq.1');
      if (criteria.tanggal) q = q.like('tanggal', String(criteria.tanggal).substring(0, 10) + '%');
      if (criteria.vehicle_id) q = q.eq('vehicle_id', criteria.vehicle_id);
      if (criteria.nama_driver) q = q.eq('nama_driver', criteria.nama_driver);
      if (criteria.kode_cabang) q = q.eq('kode_cabang', criteria.kode_cabang);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(1).maybeSingle();
      if (error) throw fail('findJalurByCriteria')(error);
      if (!data) return null;
      const j = data as unknown as JalurRow;
      return { ...j, status: j.status || 'BELUM_DIISI' };
    },

    async setJalurStatus(jalurId, status, laporanId) {
      const { error } = await sb().from('jalur_pengiriman')
        .update({ status, laporan_id: laporanId, updated_at: nowIso() }).eq('id', jalurId);
      if (error) throw fail('setJalurStatus')(error);
    },

    async releaseJalurReport(laporanId) {
      const { data, error } = await sb().from('jalur_pengiriman')
        .select('id,status').eq('laporan_id', laporanId);
      if (error) throw fail('releaseJalurReport')(error);
      const rows = (data as Array<{ id: string; status: string }> | null) ?? [];
      for (const j of rows) {
        const patch: Record<string, unknown> = { laporan_id: '', updated_at: nowIso() };
        if (j.status === 'SUDAH_LAPORAN') patch.status = 'BELUM_DIISI';
        const { error: upErr } = await sb().from('jalur_pengiriman').update(patch).eq('id', j.id);
        if (upErr) throw fail('releaseJalurReport:update')(upErr);
      }
    },
  };
}
```

- [x] **Step 2: Tambahkan `memLaporan`, `memStorage`, `laporanRow` ke `tests/helpers.ts`**

Tambahkan import di atas:

```ts
import type { LaporanInsert, LaporanRepo, LaporanRow, FlazzCardRow, UsageRow, JalurRow } from '../src/db/laporan';
import { CardBalanceError } from '../src/db/laporan';
import { canonicalCardId } from '../src/logic/laporan';
import type { UploadEvidenceOpts, StorageUploadResult } from '../src/db/storage';
import type { Env } from '../src/env';
```

Lalu tambahkan fungsi berikut (setelah `memMaster`):

```ts
export interface MemLaporanState {
  rows: LaporanRow[];
  flazzCard: FlazzCardRow[];
  flazzUsage: UsageRow[];
  jalur: JalurRow[];
  seq: number;
}

export function laporanRow(over: Partial<LaporanRow> = {}): LaporanRow {
  return {
    transaction_id: 'TRX-1', timestamp: '2026-09-01T01:00:00.000Z', tanggal: '2026-09-01',
    user_id: 'U-1', nama_pengguna: 'Budi', kode_cabang: 'CBG-A', vehicle_id: 'V-1', plat_nomor: 'B 1 A',
    foto_km_awal: '', ocr_km_awal: '', km_awal_confirmed: '100', bar_awal: '8',
    foto_km_akhir: '', ocr_km_akhir: '', km_akhir_confirmed: '200', bar_akhir: '4',
    km_tempuh: 100, perubahan_bar: 4, liter_bbm: 10, biaya_bbm: 100000,
    foto_struk_bbm: '', biaya_toll: 0, foto_struk_toll: '', km_per_liter: 10,
    status: 'COMPLETED', warning: '', nama_supir: 'Supir A', metode_pembayaran: 'TUNAI',
    flazz_card_id: '', km_sumber: 'AKTUAL', metode_toll: 'TUNAI', flazz_card_id_toll: '',
    ...over,
  };
}

export function memLaporan(initial?: Partial<MemLaporanState>) {
  const state: MemLaporanState = {
    rows: clone(initial?.rows ?? []).map((r, i) => ({ ...r, seq: r.seq ?? i + 1 })),
    flazzCard: clone(initial?.flazzCard ?? []),
    flazzUsage: clone(initial?.flazzUsage ?? []),
    jalur: clone(initial?.jalur ?? []),
    seq: initial?.seq ?? (initial?.rows?.length ?? 0),
  };
  const scoped = (cabang: string, limit: number): LaporanRow[] => {
    const filtered = (cabang ? state.rows.filter((r) => String(r.kode_cabang) === cabang) : [...state.rows])
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
    return filtered.slice(Math.max(0, filtered.length - limit));
  };
  const cardByCanonical = (id: string) => state.flazzCard.find((c) => canonicalCardId(c.id) === canonicalCardId(id));
  const repo: LaporanRepo = {
    async findById(id) { return clone(state.rows.find((r) => r.transaction_id === id) ?? null); },
    async lastForVehicle(vehicle_id) {
      const list = state.rows.filter((r) => r.vehicle_id === vehicle_id).sort((a, b) => (b.seq ?? 0) - (a.seq ?? 0));
      const r = list[0];
      if (!r) return null;
      const km = parseFloat(String(r.km_akhir_confirmed));
      return { km_akhir: isNaN(km) ? null : km, tanggal: r.tanggal };
    },
    async recentRows(cabang, limit) { return clone(scoped(cabang, limit)); },
    async rowsInScope(cabang, limit) { return clone(scoped(cabang, limit)); },
    async duplicateCandidates(cabang, limit) { return clone(scoped(cabang, limit)); },
    async rowsInMonth(cabang, periode) {
      return clone(state.rows.filter((r) => (!cabang || String(r.kode_cabang) === cabang) && String(r.tanggal).startsWith(periode + '-')));
    },
    async insert(row: LaporanInsert) {
      state.seq += 1;
      state.rows.push({ ...clone(row), seq: state.seq });
    },
    async update(id, patch) {
      const r = state.rows.find((x) => x.transaction_id === id);
      if (r) Object.assign(r, clone(patch));
    },
    async delete(id) {
      const i = state.rows.findIndex((x) => x.transaction_id === id);
      if (i > -1) state.rows.splice(i, 1);
    },
    async findAllCards() { return clone(state.flazzCard); },
    async findFlazzCardById(id) { const c = cardByCanonical(id); return c ? clone(c) : null; },
    async adjustBalance(cardId, delta) {
      const card = cardByCanonical(cardId);
      if (!card) throw new CardBalanceError(cardId, 0);
      if (delta < 0 && card.last_balance < -delta) throw new CardBalanceError(card.id, card.last_balance);
      card.last_balance = card.last_balance + delta;
      return card.last_balance;
    },
    async setBalance(cardId, balance) { const c = cardByCanonical(cardId); if (c) c.last_balance = balance; },
    async hasActiveUsage(cardId) { return state.flazzUsage.some((u) => canonicalCardId(u.card_id) === canonicalCardId(cardId) && u.status === 'DIBERIKAN'); },
    async createUsage(opts) {
      const card = cardByCanonical(opts.cardId);
      state.flazzUsage.push({
        id: 'USE-' + (state.flazzUsage.length + 1), date: opts.usedAt, card_id: card?.id ?? opts.cardId,
        driver_id: opts.driverName, vehicle_id: opts.vehicleId, usage_type: 'PRIMARY', primary_card_id: '',
        backup_card_id: '', reason: '', opening_balance: card?.last_balance ?? 0, used_at: opts.usedAt,
        returned_at: '', status: 'DIBERIKAN', created_by: '', created_at: '2026-01-01T00:00:00.000Z',
        ref_type: opts.refType, ref_id: opts.refId,
      });
      if (card) { card.status = 'SEDANG_DIGUNAKAN'; if (!card.driver_id) card.driver_id = opts.driverName; }
    },
    async adjustActiveUsageOpening(cardId, delta) {
      const list = state.flazzUsage
        .filter((u) => canonicalCardId(u.card_id) === canonicalCardId(cardId) && u.status === 'DIBERIKAN')
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const u = list[0];
      if (u) u.opening_balance = u.opening_balance + delta;
    },
    async returnUsageForRef(refType, refId) {
      const affected: string[] = [];
      for (const u of state.flazzUsage) {
        if (u.ref_type === refType && u.ref_id === refId && u.status === 'DIBERIKAN') {
          u.status = 'DIKEMBALIKAN';
          u.returned_at = '2026-01-02T00:00:00.000Z';
          if (affected.indexOf(u.card_id) === -1) affected.push(u.card_id);
        }
      }
      for (const cid of affected) {
        if (state.flazzUsage.some((u) => canonicalCardId(u.card_id) === canonicalCardId(cid) && u.status === 'DIBERIKAN')) continue;
        const card = cardByCanonical(cid);
        if (card) {
          if (card.status === 'SEDANG_DIGUNAKAN') card.status = 'TERSEDIA';
          card.driver_id = card.default_driver_id || '';
        }
      }
    },
    async latestGivenAt(cardId) {
      const list = state.flazzUsage
        .filter((u) => canonicalCardId(u.card_id) === canonicalCardId(cardId) && u.status === 'DIBERIKAN')
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
      const u = list[0];
      if (!u) return null;
      const t = new Date(u.used_at || u.date).getTime();
      return isNaN(t) ? null : t;
    },
    async findJalurByCriteria(criteria) {
      let best: JalurRow | null = null;
      for (const j of state.jalur) {
        if (String(j.is_deleted) === '1') continue;
        if (criteria.tanggal && String(j.tanggal).substring(0, 10) !== String(criteria.tanggal).substring(0, 10)) continue;
        if (criteria.vehicle_id && String(j.vehicle_id) !== criteria.vehicle_id) continue;
        if (criteria.nama_driver && String(j.nama_driver || '') !== criteria.nama_driver) continue;
        if (criteria.kode_cabang && String(j.kode_cabang || '') !== criteria.kode_cabang) continue;
        best = j;
      }
      return best ? { ...clone(best), status: best.status || 'BELUM_DIISI' } : null;
    },
    async setJalurStatus(jalurId, status, laporanId) {
      const j = state.jalur.find((x) => x.id === jalurId);
      if (j) { j.status = status; j.laporan_id = laporanId; }
    },
    async releaseJalurReport(laporanId) {
      for (const j of state.jalur) {
        if (String(j.laporan_id || '') !== String(laporanId)) continue;
        j.laporan_id = '';
        if (j.status === 'SUDAH_LAPORAN') j.status = 'BELUM_DIISI';
      }
    },
  };
  return { state, repo };
}

export function memStorage() {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    uploadEvidence: async (_env: Env, opts: UploadEvidenceOpts): Promise<StorageUploadResult> => {
      const key = `${opts.branch}/${opts.folder}/${crypto.randomUUID()}.${opts.ext}`;
      files.set(key, opts.bytes);
      return { url: `http://storage.local/storage/v1/object/public/foto/${key}`, key };
    },
    deleteEvidence: async (_env: Env, key: string): Promise<void> => {
      files.delete(key);
    },
  };
}
```

Perbarui `makeDeps`:

```ts
export function makeDeps(over: Partial<AppDeps> = {}) {
  const kv = memKV();
  const audits: Array<Record<string, unknown>> = [];
  const { state: masterState, repo: master } = memMaster();
  const { values: settingsValues, repo: settings } = memSettings();
  const { state: laporanState, repo: laporan } = memLaporan();
  const storage = memStorage();
  const deps: AppDeps = {
    kv,
    findByUsername: async () => null,
    recordAudit: async (e) => { audits.push({ ...e }); },
    auditList: async () => [],
    now: () => 1_000_000,
    master,
    settings,
    laporan,
    uploadEvidence: storage.uploadEvidence,
    deleteEvidence: storage.deleteEvidence,
    ...over,
  };
  return { kv, audits, deps, masterState, settingsValues, laporanState, storage };
}
```

- [x] **Step 3: Wire `AppDeps` di `src/deps.ts`**

```ts
import type { MasterRepo } from './db/master';
import type { SettingsRepo } from './db/settings';
import type { LaporanRepo } from './db/laporan';
import type { StorageUploadResult, UploadEvidenceOpts } from './db/storage';
import type { Env } from './env';
```

Tambahkan ke `AppDeps`:

```ts
  laporan: LaporanRepo;
  uploadEvidence: (env: Env, opts: UploadEvidenceOpts) => Promise<StorageUploadResult>;
  deleteEvidence: (env: Env, key: string) => Promise<void>;
```

> `StorageUploadResult`/`UploadEvidenceOpts` baru ada setelah Step 4 Task 5. Agar Task 4 tetap hijau, tambahkan dulu tipe `UploadEvidenceOpts` di `src/db/storage.ts` pada Task ini (implementasi upload menyusul Task 5):

```ts
export interface UploadEvidenceOpts {
  branch: string;
  folder: 'KM_Awal' | 'KM_Akhir';
  bytes: Uint8Array;
  ext: string;
  contentType: string;
}
```

- [x] **Step 4: Tulis `tests/db/laporan-mem.test.ts`**

```ts
import { describe, expect, it } from 'vitest';
import { CardBalanceError } from '../../src/db/laporan';
import { memLaporan, laporanRow } from '../helpers';

const card = (over = {}) => ({
  id: 'FLZ-1', card_number: '123', card_name: 'Kartu A', branch_id: 'CBG-A', driver_id: '',
  default_driver_id: 'D-1', last_balance: 100000, status: 'TERSEDIA', ...over,
});

describe('memLaporan', () => {
  it('insert memberi seq naik; rowsInScope urut naik & dibatasi', async () => {
    const { state, repo } = memLaporan();
    await repo.insert(laporanRow({ transaction_id: 'TRX-1' }));
    await repo.insert(laporanRow({ transaction_id: 'TRX-2' }));
    await repo.insert(laporanRow({ transaction_id: 'TRX-3' }));
    expect(state.rows.map((r) => r.seq)).toEqual([1, 2, 3]);
    const rows = await repo.rowsInScope('', 2);
    expect(rows.map((r) => r.transaction_id)).toEqual(['TRX-2', 'TRX-3']);
  });

  it('lastForVehicle mengambil seq terbesar', async () => {
    const { repo } = memLaporan({ rows: [laporanRow({ transaction_id: 'A', km_akhir_confirmed: '100' }), laporanRow({ transaction_id: 'B', km_akhir_confirmed: '250' })] });
    expect(await repo.lastForVehicle('V-1')).toEqual({ km_akhir: 250, tanggal: '2026-09-01' });
    expect(await repo.lastForVehicle('V-9')).toBeNull();
  });

  it('rowsInMonth filter prefix tanggal', async () => {
    const { repo } = memLaporan({ rows: [laporanRow({ transaction_id: 'A', tanggal: '2026-09-30' }), laporanRow({ transaction_id: 'B', tanggal: '2026-10-01' })] });
    expect((await repo.rowsInMonth('', '2026-09')).map((r) => r.transaction_id)).toEqual(['A']);
  });

  it('adjustBalance menurun dengan guard, menaik bebas', async () => {
    const { repo } = memLaporan({ flazzCard: [card()] });
    expect(await repo.adjustBalance('FLZ-1', -40000)).toBe(60000);
    await expect(repo.adjustBalance('FLZ-1', -70000)).rejects.toBeInstanceOf(CardBalanceError);
    expect(await repo.adjustBalance('FLZ-1', 10000)).toBe(70000);
  });

  it('createUsage/returnUsageForRef mengubah status kartu', async () => {
    const { state, repo } = memLaporan({ flazzCard: [card()] });
    await repo.createUsage({ cardId: 'FLZ-1', driverName: 'Supir A', vehicleId: 'V-1', refType: 'TRX', refId: 'TRX-1', usedAt: '2026-09-01T00:00:00.000Z' });
    expect(state.flazzCard[0]!.status).toBe('SEDANG_DIGUNAKAN');
    expect(state.flazzCard[0]!.driver_id).toBe('Supir A');
    expect(await repo.hasActiveUsage('FLZ-1')).toBe(true);
    await repo.returnUsageForRef('TRX', 'TRX-1');
    expect(await repo.hasActiveUsage('FLZ-1')).toBe(false);
    expect(state.flazzCard[0]!.status).toBe('TERSEDIA');
    expect(state.flazzCard[0]!.driver_id).toBe('D-1');
  });

  it('findJalurByCriteria mengabaikan is_deleted dan mengembalikan match terakhir', async () => {
    const { repo } = memLaporan({ jalur: [
      { id: 'J-1', tanggal: '2026-09-01', nama_driver: 'S', vehicle_id: 'V-1', kode_cabang: 'CBG-A', status: 'BELUM_DIISI', laporan_id: '' },
      { id: 'J-2', tanggal: '2026-09-01', nama_driver: 'S', vehicle_id: 'V-1', kode_cabang: 'CBG-A', status: 'BELUM_DIISI', laporan_id: '' },
      { id: 'J-3', tanggal: '2026-09-01', nama_driver: 'S', vehicle_id: 'V-1', kode_cabang: 'CBG-A', status: 'BELUM_DIISI', laporan_id: '', is_deleted: '1' },
    ] });
    const j = await repo.findJalurByCriteria({ tanggal: '2026-09-01', vehicle_id: 'V-1', nama_driver: 'S', kode_cabang: 'CBG-A' });
    expect(j?.id).toBe('J-2');
  });

  it('setJalurStatus & releaseJalurReport', async () => {
    const { state, repo } = memLaporan({ jalur: [{ id: 'J-1', tanggal: '2026-09-01', nama_driver: 'S', vehicle_id: 'V-1', kode_cabang: 'CBG-A', status: 'BELUM_DIISI', laporan_id: '' }] });
    await repo.setJalurStatus('J-1', 'SUDAH_LAPORAN', 'TRX-1');
    expect(state.jalur[0]).toMatchObject({ status: 'SUDAH_LAPORAN', laporan_id: 'TRX-1' });
    await repo.releaseJalurReport('TRX-1');
    expect(state.jalur[0]).toMatchObject({ status: 'BELUM_DIISI', laporan_id: '' });
  });
});
```

- [x] **Step 5: Jalankan**

```powershell
npm run typecheck
npx vitest run
```

- [x] **Step 6: Commit**

```bash
git add src/db/laporan.ts src/deps.ts src/db/storage.ts tests/helpers.ts tests/db/laporan-mem.test.ts
git commit -m "feat(db): M3 LaporanRepo supabase + memLaporan + wiring deps"
```

---

## Task 5: Storage `foto` + cache keys + `app.ts` + route save/photos

**Files:**
- Edit: `src/db/storage.ts`
- Edit: `src/logic/master-cache.ts`
- Edit: `src/app.ts`
- Create: `src/routes/laporan.ts`
- Create: `tests/routes/laporan.test.ts`

**Produces:** bucket `foto` + `uploadEvidenceStorage`/`deleteEvidenceStorage`/`extractStorageKey`; `performaCacheKey`/`monthlyCacheKey`/`invalidateLaporanCaches`; mount `/api/laporan`; `POST /photos` + `POST /` (save).

- [x] **Step 1: Tambahkan ke `src/db/storage.ts`**

```ts
export const FOTO_BUCKET = 'foto';

export async function ensureFotoBucket(env: Env): Promise<void> {
  const sb = getSupabase(env);
  try {
    const { error } = await sb.storage.createBucket(FOTO_BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message ?? '')) throw error;
  } catch {
    const { data, error } = await sb.storage.getBucket(FOTO_BUCKET);
    if (error) throw new Error(`Storage getBucket: ${error.message}`);
    if (data && !data.public) {
      await sb.storage.updateBucket(FOTO_BUCKET, { public: true });
    }
  }
}

function safeBranch(branch: string): string {
  const b = String(branch || '').replace(/[^A-Za-z0-9_-]/g, '');
  return b || 'TANPA-CABANG';
}

export async function uploadEvidenceStorage(env: Env, opts: UploadEvidenceOpts): Promise<StorageUploadResult> {
  const sb = getSupabase(env);
  await ensureFotoBucket(env);
  const key = `${safeBranch(opts.branch)}/${opts.folder}/${crypto.randomUUID()}.${opts.ext}`;
  const { error } = await sb.storage.from(FOTO_BUCKET).upload(key, opts.bytes, { contentType: opts.contentType });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  const url = `${env.SUPABASE_URL}/storage/v1/object/public/${FOTO_BUCKET}/${key}`;
  return { url, key };
}

export async function deleteEvidenceStorage(env: Env, key: string): Promise<void> {
  if (!key) return;
  const sb = getSupabase(env);
  const { error } = await sb.storage.from(FOTO_BUCKET).remove([key]);
  if (error && !/not found/i.test(error.message ?? '')) throw new Error(`Storage delete: ${error.message}`);
}

export function extractStorageKey(url: string): string {
  const m = /\/object\/public\/[^/]+\/(.+)$/.exec(String(url || ''));
  return m?.[1] ?? '';
}
```

- [x] **Step 2: Tambahkan ke `src/logic/master-cache.ts`**

```ts
export function performaCacheKey(role: string, cabang: string): string {
  return `perf:${role || ''}:${cabang || ''}`;
}

export function monthlyCacheKey(role: string, cabang: string): string {
  return `monthly:${role || ''}:${cabang || ''}`;
}

export async function invalidateLaporanCaches(kv: KVStore, role: string, cabang: string): Promise<void> {
  const scopes: Array<[string, string]> = [[role || '', cabang || ''], ['SUPERADMIN', '']];
  for (const [r, cb] of scopes) {
    await kv.delete(performaCacheKey(r, cb));
    await kv.delete(monthlyCacheKey(r, cb));
  }
}
```

- [x] **Step 3: Wire `src/app.ts`**

```diff
 import { supabaseSettingsRepo } from './db/settings';
+import { supabaseLaporanRepo } from './db/laporan';
+import { uploadEvidenceStorage, deleteEvidenceStorage } from './db/storage';
+import { laporanRoutes, dashboardRoutes } from './routes/laporan';
```

```diff
     master: supabaseMasterRepo(env),
     settings: supabaseSettingsRepo(env),
+    laporan: supabaseLaporanRepo(env),
+    uploadEvidence: uploadEvidenceStorage,
+    deleteEvidence: deleteEvidenceStorage,
     ...overrides,
```

```diff
   app.route('/api/audit', auditRoutes(deps));
+  app.route('/api/laporan', laporanRoutes(deps));
+  app.route('/api/dashboard', dashboardRoutes(deps));
```

- [x] **Step 4: Tulis `src/routes/laporan.ts` (save + photos)**

```ts
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppDeps, SessionUser } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { HttpError, okPayload } from '../utils/http';
import { newId, jsonSnip } from './master';
import { bumpMasterRev, invalidateLaporanCaches } from '../logic/master-cache';
import { CardBalanceError } from '../db/laporan';
import type { FlazzCardRow, LaporanInsert } from '../db/laporan';
import * as L from '../logic/laporan';

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;

const EVIDENCE_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', heic: 'image/heic', heif: 'image/heif',
};

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

function roleOf(u: SessionUser): string {
  return String(u.role || '').toUpperCase();
}
function isSuper(u: SessionUser): boolean {
  return roleOf(u) === 'SUPERADMIN';
}
function deny(kind: string, cabang: string): never {
  throw new HttpError(403, 'Akses ditolak: Anda hanya dapat mengelola ' + kind + ' warehouse ' + cabang + '.', 'FORBIDDEN');
}
function assertOwnWarehouse(u: SessionUser, cabang: string): void {
  if (!isSuper(u) && String(u.cabang || '') !== String(cabang || '')) deny('data', u.cabang);
}
function assertTransactionAccess(u: SessionUser, cabang: string): void {
  if (!isSuper(u) && String(u.cabang || '') !== String(cabang || '')) deny('transaksi', u.cabang);
}
function assertFlazzAccess(u: SessionUser, cabang: string): void {
  if (!isSuper(u) && String(u.cabang || '') !== String(cabang || '')) deny('kartu', u.cabang);
}

async function readJson(c: Ctx): Promise<Record<string, any>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' ? b : {};
  } catch {
    return {};
  }
}

function decodeBase64(dataUri: unknown): Uint8Array {
  const raw = String(dataUri ?? '');
  const b64 = raw.split(',')[1] ?? raw;
  if (!b64) throw new Error('Data base64 tidak valid');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  if (bytes.length > MAX_EVIDENCE_BYTES) throw new Error('Ukuran file melebihi 10MB');
  return bytes;
}

function extOf(fileName: unknown): { ext: string; contentType: string } {
  const m = /\.([a-z0-9]+)$/i.exec(String(fileName || ''));
  const raw = (m?.[1] ?? 'jpg').toLowerCase();
  const ext = EVIDENCE_EXT[raw] ? raw : 'jpg';
  return { ext, contentType: EVIDENCE_EXT[ext] ?? 'image/jpeg' };
}

async function loadCards(deps: AppDeps): Promise<{ cards: FlazzCardRow[]; cardMap: Map<string, FlazzCardRow> }> {
  const cards = await deps.laporan.findAllCards();
  const cardMap = new Map(cards.map((c) => [L.canonicalCardId(c.id), c]));
  return { cards, cardMap };
}

export function laporanRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // â”€â”€ POST /api/laporan/photos (port processDailyImages) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.post('/photos', requireUser(deps), async (c) => {
    const u = c.get('user');
    const body = await readJson(c);
    const files: Record<string, string> = { odo_awal: '', odo_akhir: '' };
    if (body.foto_odo_awal) {
      try {
        const bytes = decodeBase64(body.foto_odo_awal);
        const { ext, contentType } = extOf(body.foto_odo_awal_name);
        const up = await deps.uploadEvidence(c.env as Env, { branch: u.cabang, folder: 'KM_Awal', bytes, ext, contentType });
        files.odo_awal = up.url;
      } catch (e) {
        throw new HttpError(422, 'Upload foto KM awal gagal: ' + (e as Error).message, 'UNPROCESSABLE');
      }
    }
    if (body.foto_odo_akhir) {
      try {
        const bytes = decodeBase64(body.foto_odo_akhir);
        const { ext, contentType } = extOf(body.foto_odo_akhir_name);
        const up = await deps.uploadEvidence(c.env as Env, { branch: u.cabang, folder: 'KM_Akhir', bytes, ext, contentType });
        files.odo_akhir = up.url;
      } catch (e) {
        throw new HttpError(422, 'Upload foto KM akhir gagal: ' + (e as Error).message, 'UNPROCESSABLE');
      }
    }
    return c.json(okPayload({
      files,
      km_awal: L.num(body.km_awal_val),
      km_akhir: L.num(body.km_akhir_val),
    }));
  });

  // â”€â”€ POST /api/laporan (port saveTransactionEndOfDayUnlocked) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.post('/', requireUser(deps), async (c) => {
    const u = c.get('user');
    const p = await readJson(c);

    const vehicleId = String(p.vehicle_id ?? '').trim();
    const kendaraan = await deps.master.findKendaraanById(vehicleId);
    if (!kendaraan) throw new HttpError(404, 'Kendaraan tidak ditemukan', 'NOT_FOUND');
    const trxCabang = kendaraan.kode_cabang || u.cabang;
    assertOwnWarehouse(u, trxCabang);

    const isJarum = String(kendaraan.jenis_indikator) === 'ANALOG_JARUM';
    const jumlahBar = isJarum ? 100 : L.num(kendaraan.jumlah_bar);
    const standarKmL = L.num(kendaraan.standar_km_l);
    const literPerBar = L.literPerBarFor(L.num(kendaraan.kapasitas_tangki), jumlahBar);

    const barAwal = L.num(p.bar_awal);
    const barAkhir = L.num(p.bar_akhir);
    const liter = L.num(p.liter_bbm);
    const literKonsumsi = L.computeLiterKonsumsi(liter, barAwal, barAkhir, literPerBar);

    const matchedJalur = await deps.laporan.findJalurByCriteria({
      tanggal: String(p.tanggal ?? ''),
      vehicle_id: vehicleId,
      nama_driver: String(p.nama_supir ?? ''),
      kode_cabang: trxCabang,
    });
    if (!matchedJalur || matchedJalur.status !== 'BELUM_DIISI') {
      throw new HttpError(409, L.MSG_JALUR_GATE, 'CONFLICT');
    }

    const prevTrx = await deps.laporan.lastForVehicle(vehicleId);
    let odo;
    try {
      odo = L.estimateOdo({
        kmAwal: L.num(p.km_awal_confirmed),
        kmAkhir: L.num(p.km_akhir_confirmed),
        kmAwalBroken: !!p.km_awal_broken,
        kmAkhirBroken: !!p.km_akhir_broken,
        kmTanpaEstimasi: !!p.km_tanpa_estimasi,
        standarKmL,
        literKonsumsi,
        prevKmAkhir: prevTrx ? prevTrx.km_akhir : null,
      });
    } catch (e) {
      if (e instanceof L.OdoEstimateError) throw new HttpError(400, e.message, 'BAD_REQUEST');
      throw e;
    }

    const efisiensi = L.computeEfisiensi(odo.kmTempuh, literKonsumsi);
    let warning = '';
    if (prevTrx && prevTrx.km_akhir !== null && odo.kmAwal !== prevTrx.km_akhir) {
      warning = L.buildOdoWarning(odo.kmAwal, prevTrx.km_akhir, prevTrx.tanggal);
    }

    const metodeBbm = String(p.metode_pembayaran ?? '');
    const cardBbm = String(p.flazz_card_id ?? '');
    const biayaBbm = L.num(p.biaya_bbm);
    const biayaTol = L.num(p.biaya_toll);
    const effMetodeToll = L.resolveTollMethod(p.metode_toll, metodeBbm, p.flazz_card_id_toll);
    const effCardToll = L.resolveTollCard(p.flazz_card_id_toll, effMetodeToll, metodeBbm, cardBbm);

    const { cardMap } = await loadCards(deps);
    const checks = L.buildFlazzChecks(metodeBbm, cardBbm, biayaBbm, effMetodeToll, effCardToll, biayaTol)
      .map((chk) => ({ ...chk, cardId: cardMap.get(L.canonicalCardId(chk.cardId))?.id ?? chk.cardId }));
    for (const chk of checks) {
      const info = cardMap.get(L.canonicalCardId(chk.cardId));
      if (!info) throw new HttpError(409, L.msgCardNotFound(chk.label, chk.cardId), 'CONFLICT');
      if (L.num(info.last_balance) < chk.total) {
        throw new HttpError(409, L.msgInsufficient(info.card_name || chk.cardId, chk.label, L.num(info.last_balance), chk.total), 'CONFLICT');
      }
    }

    const storeMetodeBbm = L.storeMetodeBbm(biayaBbm, metodeBbm);
    const serverData = p.serverData && typeof p.serverData === 'object' ? p.serverData : {};
    const sfiles = serverData.files && typeof serverData.files === 'object' ? serverData.files : {};

    const dupKey: L.DuplicateKey = {
      vehicle_id: vehicleId,
      tanggal: String(p.tanggal ?? ''),
      km_awal: String(odo.kmAwal),
      km_akhir: String(odo.kmAkhir),
      liter: String(liter),
      biaya_bbm: String(biayaBbm),
      biaya_toll: String(biayaTol),
    };
    const candidates = await deps.laporan.duplicateCandidates(trxCabang, 200);
    if (candidates.some((r) => L.isDuplicateRow(r, dupKey))) {
      throw new HttpError(409, L.MSG_DUPLICATE, 'CONFLICT');
    }

    const trxTs = new Date();
    const transaction_id = newId('TRX-');
    const row: LaporanInsert = {
      transaction_id,
      timestamp: trxTs.toISOString(),
      tanggal: String(p.tanggal ?? ''),
      user_id: u.user_id,
      nama_pengguna: u.nama || u.username,
      kode_cabang: trxCabang,
      vehicle_id: vehicleId,
      plat_nomor: kendaraan.plat_nomor,
      foto_km_awal: String(sfiles.odo_awal ?? ''),
      ocr_km_awal: String(serverData.km_awal ?? p.km_awal_val ?? ''),
      km_awal_confirmed: String(odo.kmAwal),
      bar_awal: String(barAwal),
      foto_km_akhir: String(sfiles.odo_akhir ?? ''),
      ocr_km_akhir: String(serverData.km_akhir ?? p.km_akhir_val ?? ''),
      km_akhir_confirmed: String(odo.kmAkhir),
      bar_akhir: String(barAkhir),
      km_tempuh: odo.kmTempuh,
      perubahan_bar: barAwal - barAkhir,
      liter_bbm: liter,
      biaya_bbm: biayaBbm,
      foto_struk_bbm: String(sfiles.struk_bbm ?? ''),
      biaya_toll: biayaTol,
      foto_struk_toll: String(sfiles.struk_toll ?? ''),
      km_per_liter: L.num(efisiensi),
      status: 'COMPLETED',
      warning,
      nama_supir: String(p.nama_supir ?? ''),
      metode_pembayaran: storeMetodeBbm,
      flazz_card_id: cardBbm,
      km_sumber: odo.kmSumber,
      metode_toll: effMetodeToll,
      flazz_card_id_toll: effCardToll,
    };
    await deps.laporan.insert(row);

    const usedFlazz = storeMetodeBbm === 'FLAZZ' || effMetodeToll === 'FLAZZ';
    if (checks.length) {
      const charged: Array<{ cardId: string; amount: number }> = [];
      try {
        for (const chk of checks) {
          await deps.laporan.adjustBalance(chk.cardId, -chk.total);
          charged.push({ cardId: chk.cardId, amount: chk.total });
        }
      } catch (e) {
        for (const cc of charged) {
          try { await deps.laporan.adjustBalance(cc.cardId, cc.amount); } catch { /* refund best-effort */ }
        }
        try { await deps.laporan.delete(transaction_id); } catch { /* rollback best-effort */ }
        if (e instanceof CardBalanceError) {
          const chk = checks.find((x) => L.canonicalCardId(x.cardId) === L.canonicalCardId(e.cardId));
          const info = cardMap.get(L.canonicalCardId(e.cardId));
          throw new HttpError(409, L.msgInsufficient(info?.card_name || e.cardId, chk?.label ?? [], e.balance, chk?.total ?? 0), 'CONFLICT');
        }
        throw new HttpError(409, (e as Error).message, 'CONFLICT');
      }
      for (const chk of checks) {
        const info = cardMap.get(L.canonicalCardId(chk.cardId));
        if (info && String(info.status) === 'NONAKTIF') continue;
        if (await deps.laporan.hasActiveUsage(chk.cardId)) continue;
        await deps.laporan.createUsage({
          cardId: chk.cardId, driverName: String(p.nama_supir ?? ''), vehicleId,
          refType: 'TRX', refId: transaction_id, usedAt: trxTs.toISOString(),
        });
      }
    }

    await deps.laporan.setJalurStatus(matchedJalur.id, 'SUDAH_LAPORAN', transaction_id);
    await deps.recordAudit({
      user_id: u.user_id, username: u.username, action: 'CREATE', modul: 'transaksi',
      keterangan: 'TRX ' + transaction_id,
      data_sesudah: jsonSnip({ cabang: trxCabang, vehicle: kendaraan.plat_nomor, km_tempuh: odo.kmTempuh, liter, biaya: biayaBbm }),
    });
    await invalidateLaporanCaches(deps.kv, roleOf(u), u.cabang);
    if (usedFlazz) await bumpMasterRev(deps.kv);

    return c.json(okPayload({ transaction_id }));
  });

  // Route baca (prefill/performa) ditambahkan di Task 6; edit/hapus di Task 7.
  return app;
}

export function dashboardRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  void deps;
  // GET / ditambahkan di Task 6.
  return app;
}
```

- [x] **Step 5: Tulis `tests/routes/laporan.test.ts` (bagian save + photos)**

```ts
import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, loginAs, laporanRow, makeDeps, memLaporan, memMaster, VEHICLE_ROW } from '../helpers';
import type { SessionUser } from '../../src/deps';
import type { FlazzCardRow, JalurRow } from '../../src/db/laporan';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

const flazzCard = (over: Partial<FlazzCardRow> = {}): FlazzCardRow => ({
  id: 'FLZ-1', card_number: '123', card_name: 'Kartu A', branch_id: 'CBG-A',
  driver_id: '', default_driver_id: 'D-1', last_balance: 500000, status: 'TERSEDIA', ...over,
});

const jalurRow = (over: Partial<JalurRow> = {}): JalurRow => ({
  id: 'J-1', tanggal: '2026-09-21', nama_driver: 'Supir A', vehicle_id: 'V-1',
  kode_cabang: 'CBG-A', status: 'BELUM_DIISI', laporan_id: '', ...over,
});

const saveBody = (over: Record<string, unknown> = {}) => ({
  vehicle_id: 'V-1', tanggal: '2026-09-21', nama_supir: 'Supir A',
  km_awal_confirmed: '1000', km_akhir_confirmed: '1100',
  km_awal_broken: false, km_akhir_broken: false, km_tanpa_estimasi: false,
  bar_awal: '8', bar_akhir: '4', liter_bbm: 10, biaya_bbm: 120000, biaya_toll: 0,
  metode_pembayaran: 'TUNAI', flazz_card_id: '', metode_toll: '', flazz_card_id_toll: '',
  serverData: { files: { odo_awal: 'https://x/storage/v1/object/public/foto/a.jpg', odo_akhir: '' }, km_awal: '1000', km_akhir: '1100' },
  ...over,
});

function setup(init: { jalur?: JalurRow[]; flazzCard?: FlazzCardRow[]; rows?: Parameters<typeof laporanRow>[0][] } = {}) {
  const master = memMaster({ cabang: [{ kode_cabang: 'CBG-A', nama_cabang: 'Cabang A', lokasi: '', status: 'Aktif' }], kendaraan: [VEHICLE_ROW] });
  const lap = memLaporan({
    jalur: init.jalur ?? [jalurRow()],
    flazzCard: init.flazzCard ?? [],
    rows: (init.rows ?? []).map((r) => laporanRow(r)),
  });
  const { deps, kv, audits, storage } = makeDeps({ master: master.repo, laporan: lap.repo });
  const app = buildApp(fakeEnv() as any, deps);
  return { app, kv, audits, master, lap, storage };
}

async function post(app: ReturnType<typeof buildApp>, path: string, token: string, body: unknown) {
  return app.request(path, { method: 'POST', headers: { ...authHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

describe('POST /api/laporan (save)', () => {
  it('happy path: insert baris, flip jalur, audit CREATE, invalidate cache', async () => {
    const { app, kv, audits, lap } = setup();
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody());
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.success).toBe(true);
    expect(String(body.transaction_id)).toMatch(/^TRX-/);
    expect(lap.state.rows).toHaveLength(1);
    expect(lap.state.rows[0]).toMatchObject({ km_tempuh: 100, km_sumber: 'AKTUAL', kode_cabang: 'CBG-A', metode_pembayaran: 'TUNAI' });
    expect(lap.state.jalur[0]).toMatchObject({ status: 'SUDAH_LAPORAN', laporan_id: body.transaction_id });
    expect(audits[0]).toMatchObject({ action: 'CREATE', modul: 'transaksi', keterangan: 'TRX ' + body.transaction_id });
  });

  it('gate jalur 409 dengan pesan verbatim', async () => {
    const { app, kv } = setup({ jalur: [] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody());
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toBe('Anda harus membuat Jalur Pengiriman terlebih dahulu (status BELUM DIISI) untuk kendaraan dan supir ini pada tanggal tersebut sebelum menginput laporan harian.');
  });

  it('duplikat 409', async () => {
    const { app, kv } = setup({ rows: [{ tanggal: '2026-09-21', km_awal_confirmed: '1000', km_akhir_confirmed: '1100', liter_bbm: 10, biaya_bbm: 120000, biaya_toll: 0 }] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody());
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toContain('Laporan sudah pernah disimpan');
  });

  it('PIC lintas cabang 403', async () => {
    const { app, kv } = setup();
    const other: SessionUser = { ...PIC, cabang: 'CBG-B' };
    const tok = await loginAs(kv, other);
    const res = await post(app, '/api/laporan', tok, saveBody());
    expect(res.status).toBe(403);
    expect((await res.json() as any).message).toBe('Akses ditolak: Anda hanya dapat mengelola data warehouse CBG-B.');
  });

  it('odo rusak tanpa standar -> 400 pesan GAS', async () => {
    const master = memMaster({ kendaraan: [{ ...VEHICLE_ROW, standar_km_l: 0 }] });
    const lap = memLaporan({ jalur: [jalurRow()] });
    const { deps, kv } = makeDeps({ master: master.repo, laporan: lap.repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({ km_awal_broken: true }));
    expect(res.status).toBe(400);
    expect((await res.json() as any).message).toContain('Standar KM/L kendaraan belum diisi');
  });

  it('Flazz: potong saldo, create usage, bump master rev', async () => {
    const { app, kv, lap } = setup({ flazzCard: [flazzCard()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 120000 }));
    expect(res.status).toBe(200);
    expect(lap.state.flazzCard[0]!.last_balance).toBe(380000);
    expect(lap.state.flazzUsage).toHaveLength(1);
    expect(await kv.get('master-rev')).toBe('1');
  });

  it('Flazz saldo kurang -> 409, tidak ada baris tersimpan', async () => {
    const { app, kv, lap } = setup({ flazzCard: [flazzCard({ last_balance: 1000 })] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({ metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 120000 }));
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toContain('tidak mencukupi');
    expect(lap.state.rows).toHaveLength(0);
  });
});

describe('POST /api/laporan/photos', () => {
  it('mengunggah 2 foto dan mengembalikan URL + echo km', async () => {
    const { app, kv, storage } = setup();
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan/photos', tok, {
      foto_odo_awal: 'data:image/jpeg;base64,AAAA',
      foto_odo_awal_name: 'a.jpg',
      foto_odo_akhir: 'data:image/png;base64,BBBB',
      foto_odo_akhir_name: 'b.png',
      km_awal_val: '1000', km_akhir_val: '1100',
    });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.files.odo_awal).toContain('/object/public/foto/');
    expect(body.files.odo_akhir).toContain('/object/public/foto/');
    expect(body.km_awal).toBe(1000);
    expect(body.km_akhir).toBe(1100);
    expect(storage.files.size).toBe(2);
  });

  it('base64 tidak valid -> 422 pesan upload', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan/photos', tok, { foto_odo_awal: 'x', foto_odo_awal_name: 'a.jpg' });
    expect(res.status).toBe(422);
    expect((await res.json() as any).message).toContain('Upload foto KM awal gagal:');
  });
});
```

- [x] **Step 6: Jalankan**

```powershell
npm run typecheck
npx vitest run
```

- [x] **Step 7: Commit**

```bash
git add src/db/storage.ts src/logic/master-cache.ts src/app.ts src/routes/laporan.ts tests/routes/laporan.test.ts
git commit -m "feat(routes): M3 save laporan + upload foto + storage/cache wiring"
```

---

## Task 6: Route baca â€” prefill, performa, dashboard

**Files:**
- Edit: `src/routes/laporan.ts`
- Edit: `tests/routes/laporan.test.ts`

**Produces:** `GET /api/laporan/prefill`, `GET /api/laporan/performa` (cache `perf:` TTL 300), `GET /api/dashboard` (riwayat langsung + `monthly:` cache TTL 300).

- [x] **Step 1: Perluas import di `src/routes/laporan.ts`**

```diff
-import { bumpMasterRev, invalidateLaporanCaches } from '../logic/master-cache';
+import { bumpMasterRev, invalidateLaporanCaches, monthlyCacheKey, performaCacheKey } from '../logic/master-cache';
```

- [x] **Step 2: Tambahkan helper `loadCardIdMap` (setelah `loadCards`)**

```ts
async function loadCardIdMap(deps: AppDeps): Promise<Map<string, string>> {
  const cards = await deps.laporan.findAllCards();
  return new Map(cards.map((c) => [L.canonicalCardId(c.id), c.id]));
}

function kendaraanInfoMap(all: { kendaraan: Array<{ vehicle_id: string; kapasitas_tangki: number; jumlah_bar: number; standar_km_l: number }> }): L.KendaraanMap {
  return new Map(all.kendaraan.map((k) => [k.vehicle_id, {
    kapasitas: L.num(k.kapasitas_tangki),
    jumlah_bar: L.num(k.jumlah_bar),
    standar: L.num(k.standar_km_l),
  }]));
}

function cabangNamaMapOf(all: { cabang: Array<{ kode_cabang: string; nama_cabang: string }> }): L.CabangNamaMap {
  return new Map(all.cabang.map((c) => [c.kode_cabang, c.nama_cabang]));
}
```

- [x] **Step 3: Tambahkan `GET /prefill` dan `GET /performa` (sebelum `return app;` di `laporanRoutes`)**

```ts
  // â”€â”€ GET /api/laporan/prefill (port getLastLaporanPrefill) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get('/prefill', requireUser(deps), async (c) => {
    const u = c.get('user');
    const cabang = isSuper(u) ? '' : u.cabang;
    const rows = await deps.laporan.recentRows(cabang, 2000);
    const cardIdMap = await loadCardIdMap(deps);
    let pref: L.Prefill | null = null;
    for (let i = rows.length - 1; i >= 0; i--) {
      const row = rows[i];
      if (!row || !row.vehicle_id) continue;
      pref = L.mapPrefillRow(row, cardIdMap);
      break;
    }
    return c.json(okPayload({ pref }));
  });

  // â”€â”€ GET /api/laporan/performa (port getPerformaSummary) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get('/performa', requireUser(deps), async (c) => {
    const u = c.get('user');
    const cabang = isSuper(u) ? '' : u.cabang;
    const key = performaCacheKey(roleOf(u), cabang);
    const cached = await deps.kv.get(key, 'json');
    if (cached) return c.json(okPayload({ items: cached }));
    const rows = await deps.laporan.rowsInScope(cabang, 5000);
    const all = await deps.master.listAll();
    const items = L.buildPerformaList(rows, kendaraanInfoMap(all), cabangNamaMapOf(all));
    await deps.kv.put(key, JSON.stringify(items), { expirationTtl: 300 });
    return c.json(okPayload({ items }));
  });
```

- [x] **Step 4: Implementasikan `dashboardRoutes`**

```ts
export function dashboardRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  // â”€â”€ GET /api/dashboard (port getDashboardData) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
    return c.json(okPayload({ transactions, monthly }));
  });

  return app;
}
```

- [x] **Step 5: Tambahkan test baca ke `tests/routes/laporan.test.ts`**

```ts
import { periodKey } from '../../src/logic/laporan';

const PERIODE = periodKey(new Date());

function perfRows() {
  return Array.from({ length: 7 }, (_, i) => laporanRow({
    transaction_id: 'TRX-' + (i + 1),
    tanggal: `2026-09-${String(i + 1).padStart(2, '0')}`,
    timestamp: `2026-09-${String(i + 1).padStart(2, '0')}T01:00:00.000Z`,
    km_awal_confirmed: String(1000 + i * 100), km_akhir_confirmed: String(1100 + i * 100),
    km_tempuh: 100, liter_bbm: 10, bar_awal: '8', bar_akhir: '4',
  }));
}

describe('GET /api/laporan/prefill', () => {
  it('mengembalikan baris terakhir (resolusi tol & kartu)', async () => {
    const { app, kv } = setup({ rows: [
      { transaction_id: 'TRX-1', vehicle_id: 'V-1' },
      { transaction_id: 'TRX-2', vehicle_id: 'V-1', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ1', metode_toll: '', flazz_card_id_toll: '' },
    ], flazzCard: [flazzCard({ id: 'FLZ-1' })] });
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/laporan/prefill', { headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const pref = (await res.json() as any).pref;
    expect(pref.vehicle_id).toBe('V-1');
    expect(pref.metode_toll).toBe('FLAZZ');
    expect(pref.flazz_card_id).toBe('FLZ-1');
    expect(pref.flazz_card_id_toll).toBe('FLZ-1');
  });

  it('tanpa baris -> pref null', async () => {
    const { app, kv } = setup({ rows: [] });
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/laporan/prefill', { headers: authHeaders(tok) });
    expect((await res.json() as any).pref).toBeNull();
  });
});

describe('GET /api/laporan/performa', () => {
  it('window 7-trip + cache KV (state berubah tidak mengubah hasil kedua)', async () => {
    const { app, kv, lap } = setup({ rows: perfRows() });
    const tok = await loginAs(kv, PIC);
    const r1 = await app.request('/api/laporan/performa', { headers: authHeaders(tok) });
    const b1 = await r1.json() as any;
    expect(b1.items).toHaveLength(1);
    expect(b1.items[0].cabang).toBe('Cabang A');
    lap.state.rows.push(laporanRow({ transaction_id: 'TRX-X', tanggal: '2026-09-08' }));
    const r2 = await app.request('/api/laporan/performa', { headers: authHeaders(tok) });
    expect((await r2.json() as any).items).toHaveLength(1);
  });
});

describe('GET /api/dashboard', () => {
  it('transactions + monthly grouping periode berjalan', async () => {
    const rows = [
      laporanRow({ transaction_id: 'TRX-1', tanggal: PERIODE + '-05', liter_bbm: 10, biaya_bbm: 100000, biaya_toll: 5000 }),
      laporanRow({ transaction_id: 'TRX-2', tanggal: PERIODE + '-06', liter_bbm: 20, biaya_bbm: 200000, biaya_toll: 0 }),
    ];
    const { app, kv } = setup({ rows });
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/dashboard', { headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.transactions).toHaveLength(2);
    expect(body.monthly).toEqual([{
      cabang: 'CBG-A', periode: PERIODE, total_transaksi: 2,
      total_liter: 30, total_biaya_bbm: 300000, total_toll: 5000,
    }]);
  });

  it('PIC hanya melihat transaksi cabangnya', async () => {
    const { app, kv } = setup({ rows: [
      laporanRow({ transaction_id: 'TRX-A', kode_cabang: 'CBG-A', vehicle_id: 'V-1' }),
      laporanRow({ transaction_id: 'TRX-B', kode_cabang: 'CBG-B', vehicle_id: 'V-2', plat_nomor: 'B 2 B' }),
    ] });
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/dashboard', { headers: authHeaders(tok) });
    const body = await res.json() as any;
    expect(body.transactions.map((t: any) => t.transaction_id)).toEqual(['TRX-A']);
  });
});
```

- [x] **Step 6: Jalankan + commit**

```powershell
npm run typecheck
npx vitest run
```

```bash
git add src/routes/laporan.ts tests/routes/laporan.test.ts
git commit -m "feat(routes): M3 prefill/performa/dashboard + cache 300s"
```

---

## Task 7: Route edit & hapus

**Files:**
- Edit: `src/routes/laporan.ts`
- Edit: `tests/routes/laporan.test.ts`

**Produces:** `PUT /api/laporan/:id` (delta Flazz, adjust usage, ganti foto, re-link jalur) dan `DELETE /api/laporan/:id` (refund Flazz, return usage, release jalur).

- [x] **Step 1: Tambahkan import `extractStorageKey`**

```diff
 import { CardBalanceError } from '../db/laporan';
 import type { FlazzCardRow, LaporanInsert } from '../db/laporan';
+import { extractStorageKey } from '../db/storage';
 import * as L from '../logic/laporan';
```

- [x] **Step 2: Tambahkan `PUT /:id` (sebelum `return app;` di `laporanRoutes`)**

```ts
  // â”€â”€ PUT /api/laporan/:id (port editDailyTransactionUnlocked) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.put('/:id', requireUser(deps), async (c) => {
    const u = c.get('user');
    const id = c.req.param('id');
    const p = await readJson(c);

    const old = await deps.laporan.findById(id);
    if (!old) throw new HttpError(404, L.MSG_TRX_NOT_FOUND, 'NOT_FOUND');

    const f = L.cardFields(old);
    const oldMetode = String(f.mBbm ?? '');
    const oldCard = String(f.cBbm ?? '');
    const oldBiaya = L.num(f.bBbm);
    const oldToll = L.num(f.bTol);
    const oldLiter = L.num(old.liter_bbm);
    const oldNama = String(old.nama_supir ?? '');
    const oldMetodeToll = String(old.metode_toll ?? '') !== '' ? String(old.metode_toll) : (oldMetode === 'FLAZZ' ? 'FLAZZ' : 'TUNAI');
    const oldCardToll = (oldMetodeToll === 'FLAZZ' && !String(old.flazz_card_id_toll ?? '')) ? oldCard : String(old.flazz_card_id_toll ?? '');

    const { cardMap } = await loadCards(deps);
    const vehicleBranch = (await deps.master.findKendaraanById(old.vehicle_id))?.kode_cabang ?? old.kode_cabang;
    let branch = vehicleBranch;
    if (oldMetode === 'FLAZZ') branch = cardMap.get(L.canonicalCardId(oldCard))?.branch_id ?? vehicleBranch;
    else if (oldMetodeToll === 'FLAZZ' && oldCardToll) branch = cardMap.get(L.canonicalCardId(oldCardToll))?.branch_id ?? vehicleBranch;
    assertTransactionAccess(u, branch);

    const newMetode = L.parseEditMethod(p.metode_pembayaran, oldMetode);
    const newBiaya = L.parseEditAmount(p.biaya_bbm, oldBiaya);
    const newToll = L.parseEditAmount(p.biaya_toll, oldToll);

    const rawCard = (p.flazz_card_id !== undefined && p.flazz_card_id !== null) ? String(p.flazz_card_id).trim() : '';
    let newCard = '';
    if (newMetode === 'FLAZZ') {
      newCard = rawCard || (oldMetode === 'FLAZZ' ? oldCard : '');
      if (!newCard) throw new HttpError(400, L.MSG_PICK_FLAZZ, 'BAD_REQUEST');
      if (newCard !== oldCard) {
        const target = cardMap.get(L.canonicalCardId(newCard));
        if (!target) throw new HttpError(400, L.MSG_CARD_TARGET_NOT_FOUND, 'BAD_REQUEST');
        assertFlazzAccess(u, target.branch_id);
      }
    }

    const newMetodeToll = L.resolveTollMethod(p.metode_toll, newMetode, p.flazz_card_id_toll);
    const rawCardToll = (p.flazz_card_id_toll !== undefined && p.flazz_card_id_toll !== null) ? String(p.flazz_card_id_toll).trim() : '';
    let newCardToll = '';
    if (newMetodeToll === 'FLAZZ') {
      newCardToll = rawCardToll || (oldMetodeToll === 'FLAZZ' ? oldCardToll : '') || (newMetode === 'FLAZZ' ? newCard : '');
      if (!newCardToll) throw new HttpError(400, L.MSG_PICK_FLAZZ_TOLL, 'BAD_REQUEST');
      if (newCardToll !== oldCardToll) {
        const target = cardMap.get(L.canonicalCardId(newCardToll));
        if (!target) throw new HttpError(400, L.MSG_CARD_TARGET_NOT_FOUND, 'BAD_REQUEST');
        assertFlazzAccess(u, target.branch_id);
      }
    }

    const oldPayState = { metodeBbm: oldMetode, cardBbm: oldCard, biayaBbm: oldBiaya, metodeTol: oldMetodeToll, cardTol: oldCardToll, biayaTol: oldToll };
    const newPayState = { metodeBbm: newMetode, cardBbm: newCard, biayaBbm: newBiaya, metodeTol: newMetodeToll, cardTol: newCardToll, biayaTol: newToll };
    const involved = L.distinctFlazzCards(oldPayState.metodeBbm, oldPayState.cardBbm, oldPayState.metodeTol, oldPayState.cardTol)
      .concat(L.distinctFlazzCards(newPayState.metodeBbm, newPayState.cardBbm, newPayState.metodeTol, newPayState.cardTol))
      .filter((x, i, a) => a.indexOf(x) === i);

    for (const cardId of involved) {
      const delta = L.flazzEditDelta(oldPayState, newPayState, cardId);
      if (delta < 0) {
        const info = cardMap.get(L.canonicalCardId(cardId));
        const bal = info ? L.num(info.last_balance) : 0;
        if (bal + delta < 0) throw new HttpError(409, L.msgEditInsufficient(bal), 'CONFLICT');
      }
    }

    const newTgl = (p.tanggal !== undefined && p.tanggal !== '') ? String(p.tanggal) : String(old.tanggal);
    const newNama = (p.nama_supir !== undefined && p.nama_supir !== null && String(p.nama_supir) !== '') ? String(p.nama_supir) : oldNama;
    const newLiter = (p.liter_bbm !== undefined && p.liter_bbm !== null) ? L.num(p.liter_bbm) : oldLiter;
    const newBarAwal = p.bar_awal !== undefined ? L.num(p.bar_awal) : L.num(old.bar_awal);
    const newBarAkhir = p.bar_akhir !== undefined ? L.num(p.bar_akhir) : L.num(old.bar_akhir);
    const newKmAwal = p.km_awal !== undefined ? L.num(p.km_awal) : L.num(old.km_awal_confirmed);
    const newKmAkhir = p.km_akhir !== undefined ? L.num(p.km_akhir) : L.num(old.km_akhir_confirmed);

    const patch: Partial<LaporanInsert> = {
      metode_pembayaran: (newBiaya > 0 || newMetode === 'FLAZZ') ? newMetode : '',
      flazz_card_id: newCard,
      biaya_bbm: newBiaya,
      biaya_toll: newToll,
      metode_toll: newMetodeToll,
      flazz_card_id_toll: newCardToll,
      liter_bbm: newLiter,
      nama_supir: newNama,
      km_awal_confirmed: String(newKmAwal),
      km_akhir_confirmed: String(newKmAkhir),
      km_tempuh: newKmAkhir - newKmAwal,
      bar_awal: String(newBarAwal),
      bar_akhir: String(newBarAkhir),
      tanggal: newTgl,
    };
    if (p.km_awal !== undefined || p.km_akhir !== undefined) patch.km_sumber = 'AKTUAL';

    if (p.foto_odo_awal) {
      try {
        const bytes = decodeBase64(p.foto_odo_awal);
        const { ext, contentType } = extOf(p.foto_odo_awal_name ?? 'odo_awal.jpg');
        const up = await deps.uploadEvidence(c.env as Env, { branch: u.cabang, folder: 'KM_Awal', bytes, ext, contentType });
        const oldKey = extractStorageKey(String(old.foto_km_awal ?? ''));
        if (oldKey) await deps.deleteEvidence(c.env as Env, oldKey);
        patch.foto_km_awal = up.url;
      } catch (e) {
        throw new HttpError(422, 'Upload foto odometer awal gagal: ' + (e as Error).message, 'UNPROCESSABLE');
      }
    }
    if (p.foto_odo_akhir) {
      try {
        const bytes = decodeBase64(p.foto_odo_akhir);
        const { ext, contentType } = extOf(p.foto_odo_akhir_name ?? 'odo_akhir.jpg');
        const up = await deps.uploadEvidence(c.env as Env, { branch: u.cabang, folder: 'KM_Akhir', bytes, ext, contentType });
        const oldKey = extractStorageKey(String(old.foto_km_akhir ?? ''));
        if (oldKey) await deps.deleteEvidence(c.env as Env, oldKey);
        patch.foto_km_akhir = up.url;
      } catch (e) {
        throw new HttpError(422, 'Upload foto odometer akhir gagal: ' + (e as Error).message, 'UNPROCESSABLE');
      }
    }

    await deps.laporan.update(id, patch);

    const txStampMs = L.parseTimestampMs(old.timestamp) ?? L.parseTanggalMs(old.tanggal);
    for (const cardId of involved) {
      const delta = L.flazzEditDelta(oldPayState, newPayState, cardId);
      if (delta === 0) continue;
      const info = cardMap.get(L.canonicalCardId(cardId));
      const masterId = info?.id ?? cardId;
      try {
        await deps.laporan.adjustBalance(masterId, delta);
      } catch (e) {
        if (e instanceof CardBalanceError) {
          const bal = L.num((await deps.laporan.findFlazzCardById(masterId))?.last_balance ?? e.balance);
          throw new HttpError(409, L.msgEditInsufficient(bal), 'CONFLICT');
        }
        throw e;
      }
      if (L.shouldAdjustUsageOpeningAt(txStampMs, await deps.laporan.latestGivenAt(masterId))) {
        await deps.laporan.adjustActiveUsageOpening(masterId, delta);
      }
    }

    const wasBbmFlazz = oldMetode === 'FLAZZ' && !!oldCard;
    const isBbmFlazz = newMetode === 'FLAZZ' && !!newCard;
    const wasTolFlazz = oldMetodeToll === 'FLAZZ' && !!oldCardToll;
    const isTolFlazz = newMetodeToll === 'FLAZZ' && !!newCardToll;
    const newly: string[] = [];
    if (isBbmFlazz && L.shouldAutoCreateUsageOnEdit(wasBbmFlazz, isBbmFlazz)) newly.push(newCard);
    if (isTolFlazz && L.shouldAutoCreateUsageOnEdit(wasTolFlazz, isTolFlazz)) newly.push(newCardToll);
    for (const cardId of newly.filter((x, i, a) => a.indexOf(x) === i)) {
      const info = cardMap.get(L.canonicalCardId(cardId));
      const masterId = info?.id ?? cardId;
      if (await deps.laporan.hasActiveUsage(masterId)) continue;
      await deps.laporan.createUsage({ cardId: masterId, driverName: newNama, vehicleId: old.vehicle_id, refType: 'TRX', refId: id, usedAt: old.timestamp });
    }

    const linkChanged = String(newTgl) !== String(old.tanggal) || String(newNama) !== String(oldNama);
    if (linkChanged) await deps.laporan.releaseJalurReport(id);
    const matched = await deps.laporan.findJalurByCriteria({ tanggal: newTgl, vehicle_id: old.vehicle_id, nama_driver: newNama, kode_cabang: old.kode_cabang });
    if (matched && matched.status !== 'SELESAI') await deps.laporan.setJalurStatus(matched.id, 'SUDAH_LAPORAN', id);

    await deps.recordAudit({
      user_id: u.user_id, username: u.username, action: 'EDIT', modul: 'transaksi', keterangan: id,
      data_sebelum: jsonSnip({ metode_pembayaran: oldMetode, flazz_card_id: oldCard, biaya_bbm: oldBiaya, biaya_toll: oldToll, metode_toll: oldMetodeToll, flazz_card_id_toll: oldCardToll }),
      data_sesudah: jsonSnip({ metode_pembayaran: newMetode, flazz_card_id: newCard, biaya_bbm: newBiaya, biaya_toll: newToll, metode_toll: newMetodeToll, flazz_card_id_toll: newCardToll }),
    });
    await invalidateLaporanCaches(deps.kv, roleOf(u), u.cabang);
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: L.MSG_EDIT_SUCCESS }));
  });

  // â”€â”€ DELETE /api/laporan/:id (port deleteDailyTransactionUnlocked) â”€â”€â”€â”€â”€â”€â”€â”€
  app.delete('/:id', requireUser(deps), async (c) => {
    const u = c.get('user');
    const id = c.req.param('id');
    const old = await deps.laporan.findById(id);
    if (!old) throw new HttpError(404, L.MSG_TRX_NOT_FOUND, 'NOT_FOUND');

    const f = L.cardFields(old);
    const metodeBbm = String(f.mBbm ?? '');
    const cardBbm = String(f.cBbm ?? '');
    const biaya = L.num(f.bBbm);
    const toll = L.num(f.bTol);
    const metodeToll = String(old.metode_toll ?? '') !== '' ? String(old.metode_toll) : (metodeBbm === 'FLAZZ' ? 'FLAZZ' : 'TUNAI');
    const cardToll = (metodeToll === 'FLAZZ' && !String(old.flazz_card_id_toll ?? '')) ? cardBbm : String(old.flazz_card_id_toll ?? '');

    const { cardMap } = await loadCards(deps);
    const vehicleBranch = (await deps.master.findKendaraanById(old.vehicle_id))?.kode_cabang ?? old.kode_cabang;
    let branch = vehicleBranch;
    if (metodeBbm === 'FLAZZ') branch = cardMap.get(L.canonicalCardId(cardBbm))?.branch_id ?? vehicleBranch;
    else if (metodeToll === 'FLAZZ' && cardToll) branch = cardMap.get(L.canonicalCardId(cardToll))?.branch_id ?? vehicleBranch;
    assertTransactionAccess(u, branch);

    const payState = { metodeBbm, cardBbm, biayaBbm: biaya, metodeTol: metodeToll, cardTol: cardToll, biayaTol: toll };
    const cards = L.distinctFlazzCards(payState.metodeBbm, payState.cardBbm, payState.metodeTol, payState.cardTol);
    const txStampMs = L.parseTimestampMs(old.timestamp) ?? L.parseTanggalMs(old.tanggal);

    await deps.laporan.delete(id);

    for (const cardId of cards) {
      const info = cardMap.get(L.canonicalCardId(cardId));
      const masterId = info?.id ?? cardId;
      const delta = L.flazzCardCharge(payState, cardId);
      if (delta > 0) {
        await deps.laporan.adjustBalance(masterId, delta);
        if (L.shouldAdjustUsageOpeningAt(txStampMs, await deps.laporan.latestGivenAt(masterId))) {
          await deps.laporan.adjustActiveUsageOpening(masterId, delta);
        }
      }
      await deps.laporan.returnUsageForRef('TRX', id);
    }

    await deps.laporan.releaseJalurReport(id);
    await deps.recordAudit({
      user_id: u.user_id, username: u.username, action: 'DELETE', modul: 'transaksi', keterangan: id,
      data_sebelum: jsonSnip({ metode_pembayaran: metodeBbm, flazz_card_id: cardBbm, biaya_bbm: biaya, biaya_toll: toll, metode_toll: metodeToll, flazz_card_id_toll: cardToll, vehicle_id: old.vehicle_id, kode_cabang: old.kode_cabang, tanggal: old.tanggal }),
    });
    await invalidateLaporanCaches(deps.kv, roleOf(u), u.cabang);
    await bumpMasterRev(deps.kv);
    return c.json(okPayload({ msg: L.MSG_DELETE_SUCCESS }));
  });
```

- [x] **Step 3: Tambahkan test edit/hapus ke `tests/routes/laporan.test.ts`**

```ts
import type { UsageRow } from '../../src/db/laporan';

async function put(app: ReturnType<typeof buildApp>, path: string, token: string, body: unknown) {
  return app.request(path, { method: 'PUT', headers: { ...authHeaders(token), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}
async function del(app: ReturnType<typeof buildApp>, path: string, token: string) {
  return app.request(path, { method: 'DELETE', headers: authHeaders(token) });
}

describe('PUT /api/laporan/:id', () => {
  it('koreksi parsial biaya + KM, audit EDIT', async () => {
    const { app, kv, audits, lap } = setup({ rows: [{ transaction_id: 'TRX-1' }] });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { biaya_bbm: 90000, km_akhir: 1200 });
    expect(res.status).toBe(200);
    expect((await res.json() as any).msg).toBe('Transaksi BBM berhasil diperbarui.');
    expect(lap.state.rows[0]).toMatchObject({ biaya_bbm: 90000, km_akhir_confirmed: '1200', km_tempuh: 1100, km_sumber: 'AKTUAL' });
    expect(audits[0]).toMatchObject({ action: 'EDIT', modul: 'transaksi', keterangan: 'TRX-1' });
  });

  it('404 bila transaksi tidak ada', async () => {
    const { app, kv } = setup({ rows: [] });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-X', tok, { biaya_bbm: 1 });
    expect(res.status).toBe(404);
    expect((await res.json() as any).message).toBe('Transaksi tidak ditemukan.');
  });

  it('PIC lintas cabang 403 (cabang dari baris)', async () => {
    const master = memMaster({ cabang: [{ kode_cabang: 'CBG-B', nama_cabang: 'Cabang B', lokasi: '', status: 'Aktif' }], kendaraan: [{ ...VEHICLE_ROW, vehicle_id: 'V-2', kode_cabang: 'CBG-B' }] });
    const lap = memLaporan({ rows: [laporanRow({ transaction_id: 'TRX-1', vehicle_id: 'V-2', kode_cabang: 'CBG-B' })] });
    const { deps, kv } = makeDeps({ master: master.repo, laporan: lap.repo });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { biaya_bbm: 1 });
    expect(res.status).toBe(403);
    expect((await res.json() as any).message).toContain('transaksi warehouse');
  });

  it('TUNAI -> FLAZZ: potong saldo + create usage', async () => {
    const { app, kv, lap } = setup({ rows: [{ transaction_id: 'TRX-1', biaya_bbm: 120000 }], flazzCard: [flazzCard()] });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1' });
    expect(res.status).toBe(200);
    expect(lap.state.flazzCard[0]!.last_balance).toBe(380000);
    expect(lap.state.flazzUsage).toHaveLength(1);
  });

  it('saldo kurang -> 409 pesan koreksi', async () => {
    const { app, kv } = setup({ rows: [{ transaction_id: 'TRX-1' }], flazzCard: [flazzCard({ last_balance: 1000 })] });
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1' });
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toContain('Saldo kartu tidak mencukupi untuk koreksi ini (sisa Rp 1.000).');
  });

  it('ganti foto: upload baru + hapus lama', async () => {
    const { app, kv, storage, lap } = setup({ rows: [{ transaction_id: 'TRX-1', foto_km_awal: 'http://x/storage/v1/object/public/foto/CBG-A/KM_Awal/old.jpg' }] });
    storage.files.set('CBG-A/KM_Awal/old.jpg', new Uint8Array([1]));
    const tok = await loginAs(kv, PIC);
    const res = await put(app, '/api/laporan/TRX-1', tok, { foto_odo_awal: 'data:image/jpeg;base64,AAAA', foto_odo_awal_name: 'new.jpg' });
    expect(res.status).toBe(200);
    expect(storage.files.has('CBG-A/KM_Awal/old.jpg')).toBe(false);
    expect(lap.state.rows[0]!.foto_km_awal).toContain('/object/public/foto/');
  });
});

describe('DELETE /api/laporan/:id', () => {
  const usage = (over: Partial<UsageRow> = {}): UsageRow => ({
    id: 'USE-1', date: '2026-09-01', card_id: 'FLZ-1', driver_id: 'Supir A', vehicle_id: 'V-1',
    usage_type: 'PRIMARY', primary_card_id: '', backup_card_id: '', reason: '', opening_balance: 380000,
    used_at: '2026-09-01T01:00:00.000Z', returned_at: '', status: 'DIBERIKAN', created_by: '',
    created_at: '2026-09-01T01:00:00.000Z', ref_type: 'TRX', ref_id: 'TRX-1', ...over,
  });

  it('refund saldo, return usage, release jalur, audit DELETE', async () => {
    const { app, kv, audits, lap } = setup({
      rows: [{ transaction_id: 'TRX-1', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 120000 }],
      flazzCard: [flazzCard({ last_balance: 380000, status: 'SEDANG_DIGUNAKAN', driver_id: 'Supir A' })],
      jalur: [jalurRow({ status: 'SUDAH_LAPORAN', laporan_id: 'TRX-1' })],
    });
    lap.state.flazzUsage.push(usage());
    const tok = await loginAs(kv, PIC);
    const res = await del(app, '/api/laporan/TRX-1', tok);
    expect(res.status).toBe(200);
    expect((await res.json() as any).msg).toBe('Transaksi BBM dihapus.');
    expect(lap.state.rows).toHaveLength(0);
    expect(lap.state.flazzCard[0]!.last_balance).toBe(500000);
    expect(lap.state.flazzCard[0]!.status).toBe('TERSEDIA');
    expect(lap.state.flazzUsage[0]!.status).toBe('DIKEMBALIKAN');
    expect(lap.state.jalur[0]).toMatchObject({ status: 'BELUM_DIISI', laporan_id: '' });
    expect(audits[0]).toMatchObject({ action: 'DELETE', modul: 'transaksi' });
  });

  it('404 bila tidak ada', async () => {
    const { app, kv } = setup({ rows: [] });
    const tok = await loginAs(kv, PIC);
    const res = await del(app, '/api/laporan/TRX-X', tok);
    expect(res.status).toBe(404);
  });
});
```

- [x] **Step 4: Jalankan + commit**

```powershell
npm run typecheck
npx vitest run
```

```bash
git add src/routes/laporan.ts tests/routes/laporan.test.ts
git commit -m "feat(routes): M3 edit/hapus laporan + delta Flazz + re-link jalur"
```

---

## Task 8: Uji lintas-cutting + gate penuh

**Files:**
- Edit: `tests/routes/laporan.test.ts`

**Produces:** uji invalidasi cache, tol Flazz terpisah, gate status jalur, 401, audit snip, dan verifikasi gate penuh.

- [x] **Step 1: Tambahkan test lintas-cutting**

```ts
import { monthlyCacheKey, performaCacheKey } from '../../src/logic/master-cache';

describe('lintas-cutting', () => {
  it('save menghapus cache performa & monthly (scope PIC + SUPERADMIN)', async () => {
    const { app, kv } = setup();
    const keys = [
      performaCacheKey('PIC CABANG', 'CBG-A'), monthlyCacheKey('PIC CABANG', 'CBG-A'),
      performaCacheKey('SUPERADMIN', ''), monthlyCacheKey('SUPERADMIN', ''),
    ];
    for (const k of keys) await kv.put(k, 'x');
    const tok = await loginAs(kv, PIC);
    await post(app, '/api/laporan', tok, saveBody());
    for (const k of keys) expect(await kv.get(k)).toBeNull();
  });

  it('tol Flazz terpisah (BBM tunai): hanya kartu tol terpotong', async () => {
    const { app, kv, lap } = setup({ flazzCard: [flazzCard()] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody({
      biaya_bbm: 0, metode_pembayaran: 'TUNAI', flazz_card_id: '',
      metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-1', biaya_toll: 20000,
    }));
    expect(res.status).toBe(200);
    expect(lap.state.flazzCard[0]!.last_balance).toBe(480000);
    expect(lap.state.rows[0]).toMatchObject({ metode_pembayaran: '', metode_toll: 'FLAZZ', flazz_card_id_toll: 'FLZ-1' });
  });

  it('jalur berstatus SUDAH_LAPORAN -> 409 gate', async () => {
    const { app, kv } = setup({ jalur: [jalurRow({ status: 'SUDAH_LAPORAN', laporan_id: 'TRX-LAIN' })] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody());
    expect(res.status).toBe(409);
    expect((await res.json() as any).message).toContain('Jalur Pengiriman terlebih dahulu');
  });

  it('audit save memuat data_sesudah ringkas (<= 2000 char)', async () => {
    const { app, kv, audits } = setup();
    const tok = await loginAs(kv, PIC);
    await post(app, '/api/laporan', tok, saveBody());
    expect(String(audits[0]!.data_sesudah).length).toBeLessThanOrEqual(2000);
    expect(String(audits[0]!.data_sesudah)).toContain('CBG-A');
  });

  it('edit ber-Flazz menaikkan master rev', async () => {
    const { app, kv } = setup({ rows: [{ transaction_id: 'TRX-1', metode_pembayaran: 'FLAZZ', flazz_card_id: 'FLZ-1', biaya_bbm: 120000 }], flazzCard: [flazzCard()] });
    const tok = await loginAs(kv, PIC);
    await put(app, '/api/laporan/TRX-1', tok, { biaya_bbm: 100000 });
    expect(await kv.get('master-rev')).toBe('1');
  });

  it('dashboard monthly memakai cache: perubahan state tidak terlihat pada panggilan kedua', async () => {
    const { app, kv, lap } = setup({ rows: [laporanRow({ transaction_id: 'TRX-1', tanggal: PERIODE + '-05' })] });
    const tok = await loginAs(kv, PIC);
    const b1 = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(b1.monthly[0].total_transaksi).toBe(1);
    lap.state.rows.push(laporanRow({ transaction_id: 'TRX-2', tanggal: PERIODE + '-06' }));
    const b2 = await (await app.request('/api/dashboard', { headers: authHeaders(tok) })).json() as any;
    expect(b2.monthly[0].total_transaksi).toBe(1);
    expect(b2.transactions).toHaveLength(2);
  });

  it('tanpa token -> 401 pada /api/laporan dan /api/dashboard', async () => {
    const { app } = setup();
    expect((await app.request('/api/laporan/prefill')).status).toBe(401);
    expect((await app.request('/api/dashboard')).status).toBe(401);
  });
});
```

- [x] **Step 2: Gate penuh**

```powershell
npm run typecheck
npx vitest run
```

Harapan: seluruh suite hijau (logic + db + routes + M2 lama).

- [x] **Step 3: Commit**

```bash
git add tests/routes/laporan.test.ts
git commit -m "test(routes): M3 lintas-cutting cache/tol/audit/401"
```

---

## Task 9: Dokumentasi + status spec

**Files:**
- Edit: `README.md`
- Edit: `docs/superpowers/specs/2026-09-21-m3-laporan-transaksi-bbm-design.md`

**Produces:** tabel API M3 di README + status spec diperbarui.

- [x] **Step 1: Perbarui tabel API di `README.md`**

Tambahkan baris berikut pada tabel endpoint (setelah endpoint M2):

```markdown
| POST | `/api/laporan/photos` | Unggah 2 foto odometer (base64 â†’ bucket `foto`) |
| POST | `/api/laporan` | Simpan transaksi BBM (gate jalur & Flazz, potong saldo, usage, audit) |
| PUT | `/api/laporan/:id` | Koreksi transaksi (delta Flazz, ganti foto, re-link jalur) |
| DELETE | `/api/laporan/:id` | Hapus transaksi (refund Flazz, return usage, release jalur) |
| GET | `/api/laporan/prefill` | Prefill dari transaksi terakhir yang memenuhi syarat |
| GET | `/api/laporan/performa` | Performa 7-trip per kendaraan (cache 300 dtk) |
| GET | `/api/dashboard` | Riwayat transaksi + ringkasan bulanan (cache 300 dtk) |
```

- [x] **Step 2: Perbarui status di design spec**

Ubah baris `**Status:** Disetujui (bagian demi bagian)` menjadi:

```markdown
**Status:** Selesai diimplementasikan (M3) â€” lihat `docs/superpowers/plans/2026-09-21-m3-laporan-transaksi-bbm.md`
```

- [x] **Step 3: Gate penuh + commit**

```powershell
npm run typecheck
npx vitest run
```

```bash
git add README.md docs/superpowers/specs/2026-09-21-m3-laporan-transaksi-bbm-design.md
git commit -m "docs: M3 laporan/transaksi BBM API + status spec"
```

---

## Catatan Konsistensi (self-review)

- **Pesan GAS verbatim**: dipakai lewat konstanta `MSG_*` + `msg*()` di `src/logic/laporan.ts`; route tidak menulis string pesan sendiri (kecuali `'Kendaraan tidak ditemukan'` dan `'Upload foto ... gagal: '` yang memang tidak ada di GAS sebagai konstanta).
- **Cache**: key `perf:<role>:<cabang>` & `monthly:<role>:<cabang>`, TTL **300**; `invalidateLaporanCaches` menghapus scope PIC + `SUPERADMIN`/`''`. Riwayat & prefill tidak di-cache.
- **Flazz**: potong/refund selalu lewat `adjustBalance` (CAS `WHERE last_balance = old`); save gagal potong â†’ refund + hapus baris + 409.
- **Urutan**: semua "terakhir"/"200 terakhir" lewat `seq desc` (`rowsInScope`).
- **Mount**: `/api/laporan` (`laporanRoutes`) + `/api/dashboard` (`dashboardRoutes`) di `app.ts`.
