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