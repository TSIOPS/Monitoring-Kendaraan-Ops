import type { AppDeps, AuditRow, KVStore, SessionUser } from '../src/deps';
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
import type { LaporanInsert, LaporanRepo, LaporanRow, FlazzCardRow, UsageRow, JalurRow } from '../src/db/laporan';
import { CardBalanceError } from '../src/db/laporan';
import { canonicalCardId } from '../src/logic/laporan';
import type { UploadEvidenceOpts, StorageUploadResult } from '../src/db/storage';
import type { Env } from '../src/env';

export const VEHICLE_ROW: MasterKendaraan = {
  vehicle_id: 'V-1', plat_nomor: 'B 1 A', nama_kendaraan: 'Corolla', jenis_kendaraan: 'Mobil',
  merk: 'Toyota', model: 'Altis', kapasitas_tangki: 50, jumlah_bar: 8, standar_km_l: 12,
  kode_cabang: 'CBG-A', status: 'Aktif', jenis_indikator: 'DIGITAL_BAR',
  tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '',
  km_terakhir_ganti_oli: 10000, interval_ganti_oli_km: 0,
};

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

export function memAudit(rows: AuditRow[] = []) {
  const auditList = async (limit: number) => rows.slice(0, limit);
  return { rows, auditList };
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
  const { state: laporanState, repo: laporan } = memLaporan();
  const storage = memStorage();
  const deps: AppDeps = {
    kv,
    findByUsername: async () => null,
    recordAudit: async (e) => {
      audits.push({ ...e });
    },
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

export async function loginAs(kv: KVStore, user: SessionUser): Promise<string> {
  const token = 'tok-' + crypto.randomUUID().replace(/-/g, '').slice(0, 32);
  await kv.put('session:' + token, JSON.stringify({ ...user, exp: 1e15 }));
  return token;
}

export function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}