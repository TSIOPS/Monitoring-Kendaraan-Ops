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

// ── Mapping baris (port SpreadsheetOps.js) ──────────────────────────────────
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