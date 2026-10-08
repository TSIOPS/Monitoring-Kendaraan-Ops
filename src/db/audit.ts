import type { Env } from '../env';
import type { AuditEntry, AuditRow } from '../deps';
import { getSupabase } from './client';
import { AKSI_LOGIN } from '../logic/audit';
import type { AuditFilter } from '../logic/audit';

export function recordAuditDb(env: Env) {
  return async (entry: AuditEntry): Promise<void> => {
    await getSupabase(env).from('audit_log').insert({
      log_id: `LOG-${crypto.randomUUID()}`,
      timestamp: new Date().toISOString(),
      user_id: entry.user_id,
      username: entry.username,
      action: entry.action,
      modul: entry.modul,
      keterangan: entry.keterangan,
      data_sebelum: entry.data_sebelum ?? '',
      data_sesudah: entry.data_sesudah ?? '',
      ip: entry.ip ?? '',
    });
  };
}

export function auditListDb(env: Env) {
  return async (limit: number, f: AuditFilter = {}): Promise<AuditRow[]> => {
    let q = getSupabase(env).from('audit_log').select('*');
    if (f.username) q = q.eq('username', f.username);
    if (f.modul) q = q.eq('modul', f.modul);
    if (f.action) q = q.eq('action', f.action);
    if (f.dariIso) q = q.gte('timestamp', f.dariIso);
    if (f.sampaiIso) q = q.lt('timestamp', f.sampaiIso);
    if (f.tanpaLogin) q = q.not('action', 'in', `(${AKSI_LOGIN.join(',')})`);
    const { data, error } = await q.order('timestamp', { ascending: false }).limit(limit);
    if (error) throw new Error(`DB auditList: ${error.message}`);
    return (data ?? []) as unknown as AuditRow[];
  };
}