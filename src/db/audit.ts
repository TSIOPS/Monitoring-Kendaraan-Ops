import type { Env } from '../env';
import type { AuditEntry } from '../deps';
import { getSupabase } from './client';

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
      ip: '',
    });
  };
}