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

// ── PaymentLogic (port PaymentLogic.js) ─────────────────────────────────────
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

// ── Odometer & efisiensi (port SpreadsheetOps.js) ───────────────────────────
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
  const label = efisiensi ? 'Rata-rata 7 Trip' + (adaEstimasi ? ' ⚠ termasuk estimasi' : '') : '';
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

// ── Formatter & pesan ───────────────────────────────────────────────────────
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