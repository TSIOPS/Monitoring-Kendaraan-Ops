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