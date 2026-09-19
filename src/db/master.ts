import type { Env } from '../env';
import { getSupabase } from './client';

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