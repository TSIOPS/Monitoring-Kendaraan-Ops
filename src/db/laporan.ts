import type { Env } from '../env';
import { getSupabase } from './client';
import type { LaporanInsert, LaporanRow } from '../logic/laporan';

export type { LaporanInsert, LaporanRow };
export type {
  CardPatch,
  CreateUsageOpts,
  FlazzCardRow,
  FlazzReconciliationRow,
  FlazzTolRow,
  FlazzTopupRow,
  FlazzUsageRow,
} from './flazz';
export { CardBalanceError } from './flazz';

export interface JalurRow {
  id: string;
  tanggal: string;
  nama_driver: string;
  nama_driver2?: string;
  flazz_card_id?: string;
  flazz_card_id_2?: string;
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

export interface LaporanRepo {
  findById(transaction_id: string): Promise<LaporanRow | null>;
  lastForVehicle(vehicle_id: string): Promise<{ km_akhir: number | null; tanggal: string } | null>;
  recentRows(cabang: string, limit: number): Promise<LaporanRow[]>;
  rowsInScope(cabang: string, limit: number): Promise<LaporanRow[]>;
  duplicateCandidates(cabang: string, limit: number): Promise<LaporanRow[]>;
  rowsInMonth(cabang: string, periode: string): Promise<LaporanRow[]>;
  rowsBetween(cabang: string, dari: string, sampai: string): Promise<LaporanRow[]>;
  insert(row: LaporanInsert): Promise<void>;
  update(transaction_id: string, patch: Partial<LaporanInsert>): Promise<void>;
  delete(transaction_id: string): Promise<void>;
  findJalurByCriteria(criteria: JalurCriteria): Promise<JalurRow | null>;
  setJalurStatus(jalurId: string, status: string, laporanId: string): Promise<void>;
  releaseJalurReport(laporanId: string): Promise<void>;
  // M9: laporan yang menyebut salah satu kartu di kolom kartu mana pun (grup 1 & 2).
  rowsForCards(cardIds: string[]): Promise<LaporanRow[]>;
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

    // Rentang tanggal (YYYY-MM-DD, inklusif); dibaca per 1000 baris (batas PostgREST).
    async rowsBetween(cabang, dari, sampai) {
      const out: LaporanRow[] = [];
      for (let from = 0; ; from += 1000) {
        let q = sb().from('penggunaan_bbm').select('*').order('seq', { ascending: true }).range(from, from + 999);
        if (dari) q = q.gte('tanggal', dari);
        if (sampai) q = q.lte('tanggal', sampai);
        if (cabang) q = q.eq('kode_cabang', cabang);
        const { data, error } = await q;
        if (error) throw fail('rowsBetween')(error);
        const page = data as unknown as LaporanRow[];
        out.push(...page);
        if (page.length < 1000) return out;
      }
    },

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

    async rowsForCards(cardIds) {
      // Varian id: master (FLZ-...) dan kanonik (tanpa '-') untuk baris lama.
      const ids = [...new Set(cardIds.flatMap((c) => [String(c), String(c).replace(/-/g, '')]).filter(Boolean))];
      if (!ids.length) return [];
      const list = '(' + ids.map((v) => '"' + v.replace(/"/g, '') + '"').join(',') + ')';
      const cols = ['flazz_card_id', 'flazz_card_id_toll', 'flazz_card_id_2', 'flazz_card_id_toll_2'];
      const out: LaporanRow[] = [];
      for (let from = 0; ; from += 1000) {
        const { data, error } = await sb().from('penggunaan_bbm').select('*')
          .or(cols.map((c) => `${c}.in.${list}`).join(','))
          .order('seq', { ascending: true }).range(from, from + 999);
        if (error) throw fail('rowsForCards')(error);
        const page = (data as LaporanRow[] | null) ?? [];
        out.push(...page);
        if (page.length < 1000) return out;
      }
    },

    async releaseJalurReport(laporanId) {
      const { data, error } = await sb().from('jalur_pengiriman')
        .select('id,status').eq('laporan_id', laporanId);
      if (error) throw fail('releaseJalurReport')(error);
      const rows = (data as Array<{ id: string; status: string }> | null) ?? [];
      for (const j of rows) {
        const patch: Record<string, unknown> = { laporan_id: '', updated_at: nowIso() };
        if (j.status === 'SUDAH_LAPORAN' || j.status === 'SELESAI') patch.status = 'BELUM_DIISI';
        const { error: upErr } = await sb().from('jalur_pengiriman').update(patch).eq('id', j.id);
        if (upErr) throw fail('releaseJalurReport:update')(upErr);
      }
    },
  };
}