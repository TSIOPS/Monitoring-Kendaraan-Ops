import type { Env } from '../env';
import { getSupabase } from './client';
import type { JalurFull } from '../logic/jalur';

// Repo CRUD jalur pengiriman (M8). Gate laporan tetap memakai LaporanRepo.findJalurByCriteria.
export interface JalurRepo {
  listRange(from: string, to: string, cabang: string | null): Promise<JalurFull[]>;
  listForDate(tanggal: string, cabang: string | null): Promise<JalurFull[]>;
  listForVehicles(vehicleIds: string[]): Promise<JalurFull[]>;
  listForDrivers(driverIds: string[]): Promise<JalurFull[]>;
  listForCards(cardIds: string[]): Promise<JalurFull[]>;
  findById(id: string): Promise<JalurFull | null>;
  insertMany(rows: JalurFull[]): Promise<void>;
  update(id: string, patch: Partial<JalurFull>): Promise<void>;
  delete(id: string): Promise<void>;
}

const NOT_DELETED = 'is_deleted.is.null,is_deleted.neq.1';

export function supabaseJalurRepo(env: Env): JalurRepo {
  const sb = () => getSupabase(env);
  const fail = (kind: string) => (err: unknown): never => {
    throw new Error(`DB jalur ${kind}: ${(err as Error)?.message ?? String(err)}`);
  };
  const rows = (data: unknown) => (data as JalurFull[] | null) ?? [];
  // PostgREST membatasi panjang URL; filter `in` dipecah per 100 nilai.
  const chunks = <T>(arr: T[], n = 100): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };
  const inList = (vals: string[]) => '(' + vals.map((v) => '"' + v.replace(/"/g, '\\"') + '"').join(',') + ')';

  return {
    async listRange(from, to, cabang) {
      let q = sb().from('jalur_pengiriman').select('*').or(NOT_DELETED).gte('tanggal', from).lte('tanggal', to + '￿');
      if (cabang) q = q.eq('kode_cabang', cabang);
      const { data, error } = await q;
      if (error) throw fail('listRange')(error);
      return rows(data);
    },
    async listForDate(tanggal, cabang) {
      let q = sb().from('jalur_pengiriman').select('*').or(NOT_DELETED).like('tanggal', tanggal + '%');
      if (cabang) q = q.eq('kode_cabang', cabang);
      const { data, error } = await q;
      if (error) throw fail('listForDate')(error);
      return rows(data);
    },
    async listForDrivers(driverIds) {
      const out: JalurFull[] = [];
      for (const part of chunks([...new Set(driverIds.filter(Boolean))])) {
        const daftar = part.map((x) => '"' + String(x).replace(/"/g, '') + '"').join(',');
        const { data, error } = await sb().from('jalur_pengiriman').select('*').or(NOT_DELETED)
          .or(`driver_id.in.(${daftar}),driver2_id.in.(${daftar})`);
        if (error) throw fail('listForDrivers')(error);
        out.push(...rows(data));
      }
      return out;
    },
    async listForVehicles(vehicleIds) {
      const out: JalurFull[] = [];
      for (const part of chunks([...new Set(vehicleIds)])) {
        const { data, error } = await sb().from('jalur_pengiriman').select('*').or(NOT_DELETED).in('vehicle_id', part);
        if (error) throw fail('listForVehicles')(error);
        out.push(...rows(data));
      }
      return out;
    },
    async listForCards(cardIds) {
      const out: JalurFull[] = [];
      for (const part of chunks([...new Set(cardIds.filter(Boolean))])) {
        const { data, error } = await sb().from('jalur_pengiriman').select('*')
          .or(`flazz_card_id.in.${inList(part)},flazz_card_id_2.in.${inList(part)}`);
        if (error) throw fail('listForCards')(error);
        out.push(...rows(data));
      }
      return out;
    },
    async findById(id) {
      const { data, error } = await sb().from('jalur_pengiriman').select('*').eq('id', id).maybeSingle();
      if (error) throw fail('findById')(error);
      return (data as JalurFull | null) ?? null;
    },
    async insertMany(list) {
      if (!list.length) return;
      const { error } = await sb().from('jalur_pengiriman').insert(list);
      if (error) throw fail('insertMany')(error);
    },
    async update(id, patch) {
      const { error } = await sb().from('jalur_pengiriman').update(patch).eq('id', id);
      if (error) throw fail('update')(error);
    },
    async delete(id) {
      const { error } = await sb().from('jalur_pengiriman').delete().eq('id', id);
      if (error) throw fail('delete')(error);
    },
  };
}
