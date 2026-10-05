import type { Env } from '../env';
import { getSupabase } from './client';
import { canonicalCardId } from '../logic/laporan';

export interface FlazzCardRow {
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
  created_at: string;
  updated_at: string;
}

export interface FlazzTopupRow {
  id: string;
  date: string;
  card_id: string;
  amount: number;
  evidence_url: string;
  notes: string;
  created_by: string;
  created_at: string;
  is_deleted: string;
}

export interface FlazzTolRow {
  id: string;
  date: string;
  card_id: string;
  driver_id: string;
  vehicle_id: string;
  amount: number;
  evidence_url: string;
  notes: string;
  created_by: string;
  created_at: string;
  is_deleted: string;
}

export interface FlazzReconciliationRow {
  id: string;
  date: string;
  card_id: string;
  driver_id: string;
  vehicle_id: string;
  opening_balance: number;
  total_topup: number;
  total_bbm_flazz: number;
  total_tol: number;
  total_expense: number;
  flazz_balance: number;
  actual_balance: number;
  difference: number;
  reconciliation_status: string;
  notes: string;
  reconciled_by: string;
  reconciled_at: string;
  is_deleted: string;
}

export interface FlazzUsageRow {
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

export interface FlazzListFilter {
  branchId?: string;
  status?: string;
  q?: string;
}

export interface FlazzLedgerFilter {
  branchId?: string;
  cardId?: string;
  date?: string;
  isDeleted?: boolean;
}

export interface NewFlazzCard {
  card_number: string;
  card_name: string;
  card_type?: string;
  card_role?: string;
  branch_id: string;
  driver_id?: string;
  default_driver_id?: string;
  notes?: string;
  status?: string;
  last_balance?: number;
}

export interface CardPatch {
  card_number?: string;
  card_name?: string;
  card_type?: string;
  card_role?: string;
  driver_id?: string;
  default_driver_id?: string;
  notes?: string;
  status?: string;
}

export interface NewFlazzTopup {
  date: string;
  card_id: string;
  amount: number;
  evidence_url?: string;
  notes?: string;
  created_by: string;
}

export interface TopupPatch {
  date?: string;
  amount?: number;
  evidence_url?: string;
  notes?: string;
  is_deleted?: string;
}

export interface NewFlazzTol {
  date: string;
  card_id: string;
  driver_id?: string;
  vehicle_id?: string;
  amount: number;
  evidence_url?: string;
  notes?: string;
  created_by: string;
}

export interface TolPatch {
  date?: string;
  driver_id?: string;
  vehicle_id?: string;
  amount?: number;
  evidence_url?: string;
  notes?: string;
  is_deleted?: string;
}

export interface NewFlazzReconciliation {
  date: string;
  card_id: string;
  driver_id?: string;
  vehicle_id?: string;
  opening_balance: number;
  total_topup: number;
  total_bbm_flazz: number;
  total_tol: number;
  total_expense: number;
  flazz_balance: number;
  actual_balance: number;
  difference: number;
  reconciliation_status?: string;
  notes?: string;
  reconciled_by: string;
  reconciled_at?: string;
}

export interface ReconciliationPatch {
  date?: string;
  driver_id?: string;
  vehicle_id?: string;
  opening_balance?: number;
  total_topup?: number;
  total_bbm_flazz?: number;
  total_tol?: number;
  total_expense?: number;
  flazz_balance?: number;
  actual_balance?: number;
  difference?: number;
  reconciliation_status?: string;
  notes?: string;
  reconciled_by?: string;
  is_deleted?: string;
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

export interface FlazzRepo {
  listCards(filter?: FlazzListFilter): Promise<FlazzCardRow[]>;
  findCardById(id: string): Promise<FlazzCardRow | null>;
  findCardByNumber(branchId: string, cardNumber: string): Promise<FlazzCardRow | null>;
  insertCard(data: NewFlazzCard): Promise<FlazzCardRow>;
  updateCard(id: string, patch: CardPatch): Promise<void>;
  setCardStatus(id: string, status: string): Promise<void>;
  listTopups(filter?: FlazzLedgerFilter): Promise<FlazzTopupRow[]>;
  findTopupById(id: string): Promise<FlazzTopupRow | null>;
  insertTopup(data: NewFlazzTopup): Promise<FlazzTopupRow>;
  updateTopup(id: string, patch: TopupPatch): Promise<void>;
  listTols(filter?: FlazzLedgerFilter): Promise<FlazzTolRow[]>;
  findTolById(id: string): Promise<FlazzTolRow | null>;
  insertTol(data: NewFlazzTol): Promise<FlazzTolRow>;
  updateTol(id: string, patch: TolPatch): Promise<void>;
  listReconciliations(filter?: FlazzLedgerFilter): Promise<FlazzReconciliationRow[]>;
  findReconciliationById(id: string): Promise<FlazzReconciliationRow | null>;
  insertReconciliation(data: NewFlazzReconciliation): Promise<FlazzReconciliationRow>;
  updateReconciliation(id: string, patch: ReconciliationPatch): Promise<void>;
  adjustBalance(cardId: string, delta: number): Promise<number>;
  setBalance(cardId: string, balance: number): Promise<void>;
  hasActiveUsage(cardId: string): Promise<boolean>;
  createUsage(opts: CreateUsageOpts): Promise<void>;
  adjustActiveUsageOpening(cardId: string, delta: number): Promise<void>;
  returnUsageForRef(refType: string, refId: string): Promise<void>;
  returnUsageForCardRef(refType: string, refId: string, cardId: string): Promise<void>;
  // Kembalikan penyerahan kartu yang sedang aktif, apa pun asalnya (port returnFlazzUsage GAS).
  returnActiveUsageForCard(cardId: string): Promise<void>;
  latestGivenAt(cardId: string): Promise<number | null>;
}

export function supabaseFlazzRepo(env: Env): FlazzRepo {
  const sb = () => getSupabase(env);
  const fail = (kind: string) => (err: unknown): never => {
    throw new Error(`DB ${kind}: ${(err as Error)?.message ?? String(err)}`);
  };
  const nowIso = () => new Date().toISOString();
  const genId = (prefix: string) => `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`;

  async function readCard(cardId: string): Promise<FlazzCardRow | null> {
    const { data, error } = await sb().from('flazz_card').select('*').eq('id', cardId).maybeSingle();
    if (error) throw fail('findCardById')(error);
    return (data as unknown as FlazzCardRow | null) ?? null;
  }

  async function activeUsageRows(cardId: string): Promise<Array<{ id: string }>> {
    const { data, error } = await sb().from('flazz_usage')
      .select('id').eq('card_id', cardId).eq('status', 'DIBERIKAN');
    if (error) throw fail('hasActiveUsage')(error);
    return (data as Array<{ id: string }> | null) ?? [];
  }

  async function releaseCard(cardId: string): Promise<void> {
    if ((await activeUsageRows(cardId)).length > 0) return;
    const { data: card, error: readErr } = await sb().from('flazz_card')
      .select('id,status,default_driver_id').eq('id', cardId).maybeSingle();
    if (readErr) throw fail('releaseCard:read')(readErr);
    if (!card) return;
    const c = card as { id: string; status: string; default_driver_id: string };
    const { error } = await sb().from('flazz_card').update({
      status: c.status === 'SEDANG_DIGUNAKAN' ? 'TERSEDIA' : c.status,
      driver_id: c.default_driver_id || '', updated_at: nowIso(),
    }).eq('id', cardId);
    if (error) throw fail('releaseCard:update')(error);
  }

  async function cardIdsInBranch(branchId: string): Promise<string[]> {
    const { data, error } = await sb().from('flazz_card').select('id').eq('branch_id', branchId);
    if (error) throw fail('cardIdsInBranch')(error);
    return ((data as Array<{ id: string }> | null) ?? []).map((r) => r.id);
  }

  return {
    async listCards(filter) {
      let q = sb().from('flazz_card').select('*').order('card_number', { ascending: true });
      if (filter?.branchId) q = q.eq('branch_id', filter.branchId);
      if (filter?.status) q = q.eq('status', filter.status);
      const { data, error } = await q;
      if (error) throw fail('listCards')(error);
      const rows = (data as unknown as FlazzCardRow[] | null) ?? [];
      const needle = String(filter?.q ?? '').trim().toLowerCase();
      if (!needle) return rows;
      return rows.filter((c) =>
        String(c.card_number ?? '').toLowerCase().includes(needle) ||
        String(c.card_name ?? '').toLowerCase().includes(needle));
    },

    async findCardById(id) { return readCard(id); },

    async findCardByNumber(branchId, cardNumber) {
      const { data, error } = await sb().from('flazz_card')
        .select('*').eq('branch_id', branchId).eq('card_number', cardNumber).maybeSingle();
      if (error) throw fail('findCardByNumber')(error);
      return (data as unknown as FlazzCardRow | null) ?? null;
    },

    async insertCard(data) {
      const now = nowIso();
      const row: FlazzCardRow = {
        id: genId('FLZ'), card_number: data.card_number, card_name: data.card_name,
        card_type: data.card_type ?? '', card_role: data.card_role ?? '', branch_id: data.branch_id,
        driver_id: data.driver_id ?? '', default_driver_id: data.default_driver_id ?? '',
        last_balance: 0, status: data.status ?? 'TERSEDIA', notes: data.notes ?? '',
        created_at: now, updated_at: now,
      };
      const { error } = await sb().from('flazz_card').insert(row);
      if (error) throw fail('insertCard')(error);
      return row;
    },

    async updateCard(id, patch) {
      const { error } = await sb().from('flazz_card')
        .update({ ...patch, updated_at: nowIso() }).eq('id', id);
      if (error) throw fail('updateCard')(error);
    },

    async setCardStatus(id, status) {
      const { error } = await sb().from('flazz_card')
        .update({ status, updated_at: nowIso() }).eq('id', id);
      if (error) throw fail('setCardStatus')(error);
    },

    async listTopups(filter) {
      let q = sb().from('flazz_topup').select('*').eq('is_deleted', filter?.isDeleted === true ? '1' : '0');
      if (filter?.cardId) q = q.eq('card_id', filter.cardId);
      if (filter?.date) q = q.eq('date', filter.date);
      if (filter?.branchId) {
        const ids = await cardIdsInBranch(filter.branchId);
        if (!ids.length) return [];
        q = q.in('card_id', ids);
      }
      const { data, error } = await q.order('date', { ascending: false });
      if (error) throw fail('listTopups')(error);
      return (data as unknown as FlazzTopupRow[] | null) ?? [];
    },

    async findTopupById(id) {
      const { data, error } = await sb().from('flazz_topup').select('*').eq('id', id).maybeSingle();
      if (error) throw fail('findTopupById')(error);
      return (data as unknown as FlazzTopupRow | null) ?? null;
    },

    async insertTopup(data) {
      const row: FlazzTopupRow = {
        id: genId('TOP'), date: data.date, card_id: data.card_id, amount: data.amount,
        evidence_url: data.evidence_url ?? '', notes: data.notes ?? '', created_by: data.created_by,
        created_at: nowIso(), is_deleted: '0',
      };
      const { error } = await sb().from('flazz_topup').insert(row);
      if (error) throw fail('insertTopup')(error);
      return row;
    },

    async updateTopup(id, patch) {
      const { error } = await sb().from('flazz_topup').update(patch).eq('id', id);
      if (error) throw fail('updateTopup')(error);
    },

    async listTols(filter) {
      let q = sb().from('flazz_tol').select('*').eq('is_deleted', filter?.isDeleted === true ? '1' : '0');
      if (filter?.cardId) q = q.eq('card_id', filter.cardId);
      if (filter?.date) q = q.eq('date', filter.date);
      if (filter?.branchId) {
        const ids = await cardIdsInBranch(filter.branchId);
        if (!ids.length) return [];
        q = q.in('card_id', ids);
      }
      const { data, error } = await q.order('date', { ascending: false });
      if (error) throw fail('listTols')(error);
      return (data as unknown as FlazzTolRow[] | null) ?? [];
    },

    async findTolById(id) {
      const { data, error } = await sb().from('flazz_tol').select('*').eq('id', id).maybeSingle();
      if (error) throw fail('findTolById')(error);
      return (data as unknown as FlazzTolRow | null) ?? null;
    },

    async insertTol(data) {
      const row: FlazzTolRow = {
        id: genId('TOL'), date: data.date, card_id: data.card_id, driver_id: data.driver_id ?? '',
        vehicle_id: data.vehicle_id ?? '', amount: data.amount, evidence_url: data.evidence_url ?? '',
        notes: data.notes ?? '', created_by: data.created_by, created_at: nowIso(), is_deleted: '0',
      };
      const { error } = await sb().from('flazz_tol').insert(row);
      if (error) throw fail('insertTol')(error);
      return row;
    },

    async updateTol(id, patch) {
      const { error } = await sb().from('flazz_tol').update(patch).eq('id', id);
      if (error) throw fail('updateTol')(error);
    },

    async listReconciliations(filter) {
      let q = sb().from('flazz_reconciliation').select('*').eq('is_deleted', filter?.isDeleted === true ? '1' : '0');
      if (filter?.cardId) q = q.eq('card_id', filter.cardId);
      if (filter?.date) q = q.eq('date', filter.date);
      if (filter?.branchId) {
        const ids = await cardIdsInBranch(filter.branchId);
        if (!ids.length) return [];
        q = q.in('card_id', ids);
      }
      const { data, error } = await q.order('date', { ascending: false });
      if (error) throw fail('listReconciliations')(error);
      return (data as unknown as FlazzReconciliationRow[] | null) ?? [];
    },

    async findReconciliationById(id) {
      const { data, error } = await sb().from('flazz_reconciliation').select('*').eq('id', id).maybeSingle();
      if (error) throw fail('findReconciliationById')(error);
      return (data as unknown as FlazzReconciliationRow | null) ?? null;
    },

    async insertReconciliation(data) {
      const row: FlazzReconciliationRow = {
        id: genId('REC'), date: data.date, card_id: data.card_id, driver_id: data.driver_id ?? '',
        vehicle_id: data.vehicle_id ?? '', opening_balance: data.opening_balance, total_topup: data.total_topup,
        total_bbm_flazz: data.total_bbm_flazz, total_tol: data.total_tol, total_expense: data.total_expense,
        flazz_balance: data.flazz_balance, actual_balance: data.actual_balance, difference: data.difference,
        reconciliation_status: data.reconciliation_status ?? 'UNRECONCILED', notes: data.notes ?? '',
        reconciled_by: data.reconciled_by, reconciled_at: data.reconciled_at ?? nowIso(), is_deleted: '0',
      };
      const { error } = await sb().from('flazz_reconciliation').insert(row);
      if (error) throw fail('insertReconciliation')(error);
      return row;
    },

    async updateReconciliation(id, patch) {
      const { error } = await sb().from('flazz_reconciliation').update(patch).eq('id', id);
      if (error) throw fail('updateReconciliation')(error);
    },

    async adjustBalance(cardId, delta) {
      const target = await readCard(cardId);
      if (!target) throw new CardBalanceError(cardId, 0);
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
      const bal = Number(target.last_balance) || 0;
      const { error } = await sb().from('flazz_card')
        .update({ last_balance: bal + delta, updated_at: nowIso() }).eq('id', cardId);
      if (error) throw fail('adjustBalance:update')(error);
      return bal + delta;
    },

    async setBalance(cardId, balance) {
      const { error } = await sb().from('flazz_card')
        .update({ last_balance: balance, updated_at: nowIso() }).eq('id', cardId);
      if (error) throw fail('setBalance')(error);
    },

    async hasActiveUsage(cardId) {
      return (await activeUsageRows(cardId)).length > 0;
    },

    async createUsage(opts) {
      const card = await readCard(opts.cardId);
      const { error } = await sb().from('flazz_usage').insert({
        id: genId('USE'), date: opts.usedAt, card_id: card?.id ?? opts.cardId,
        driver_id: opts.driverName, vehicle_id: opts.vehicleId, usage_type: 'PRIMARY',
        opening_balance: Number(card?.last_balance) || 0, used_at: opts.usedAt, returned_at: '',
        status: 'DIBERIKAN', created_by: '', created_at: nowIso(),
        ref_type: opts.refType, ref_id: opts.refId,
      });
      if (error) throw fail('createUsage')(error);
      const patch: Record<string, unknown> = { status: 'SEDANG_DIGUNAKAN', updated_at: nowIso() };
      if (!card?.driver_id) patch.driver_id = opts.driverName;
      const { error: upErr } = await sb().from('flazz_card').update(patch).eq('id', card?.id ?? opts.cardId);
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
        .update({ status: 'DIKEMBALIKAN', returned_at: nowIso() })
        .eq('ref_type', refType).eq('ref_id', refId).eq('status', 'DIBERIKAN');
      if (upErr) throw fail('returnUsageForRef:update')(upErr);
      for (const cid of [...new Set(rows.map((r) => r.card_id))]) await releaseCard(cid);
    },

    async returnActiveUsageForCard(cardId) {
      const card = await readCard(cardId);
      const resolved = card?.id ?? cardId;
      if (!(await activeUsageRows(resolved)).length) return;
      const { error } = await sb().from('flazz_usage')
        .update({ status: 'DIKEMBALIKAN', returned_at: nowIso() })
        .eq('card_id', resolved).eq('status', 'DIBERIKAN');
      if (error) throw fail('returnActiveUsageForCard')(error);
      await releaseCard(resolved);
    },
    async returnUsageForCardRef(refType, refId, cardId) {
      const card = await readCard(cardId);
      const resolved = card?.id ?? cardId;
      const { data, error } = await sb().from('flazz_usage')
        .select('id').eq('ref_type', refType).eq('ref_id', refId).eq('card_id', resolved).eq('status', 'DIBERIKAN');
      if (error) throw fail('returnUsageForCardRef')(error);
      const rows = (data as Array<{ id: string }> | null) ?? [];
      if (!rows.length) return;
      const { error: upErr } = await sb().from('flazz_usage')
        .update({ status: 'DIKEMBALIKAN', returned_at: nowIso() })
        .eq('ref_type', refType).eq('ref_id', refId).eq('card_id', resolved).eq('status', 'DIBERIKAN');
      if (upErr) throw fail('returnUsageForCardRef:update')(upErr);
      await releaseCard(resolved);
    },

    async latestGivenAt(cardId) {
      const { data, error } = await sb().from('flazz_usage')
        .select('used_at,date,created_at').eq('card_id', cardId).eq('status', 'DIBERIKAN')
        .order('created_at', { ascending: false }).limit(1);
      if (error) throw fail('latestGivenAt')(error);
      const row = (data as Array<{ used_at: string; date: string }> | null)?.[0];
      if (!row) return null;
      const t = new Date(row.used_at || row.date).getTime();
      return isNaN(t) ? null : t;
    },
  };
}
