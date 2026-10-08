// Filter Audit Log (halaman Audit Log SUPERADMIN). Tanggal filter = tanggal WIB.
import type { AuditRow } from '../deps';

export const AKSI_LOGIN = ['LOGIN', 'LOGIN_GAGAL', 'LOGOUT'];
export const AUDIT_LIMIT_DEFAULT = 500;
export const AUDIT_LIMIT_MAKS = 2000;

export interface AuditFilter {
  username?: string;
  modul?: string;
  action?: string;
  // Batas waktu ISO UTC: dariIso <= timestamp < sampaiIso.
  dariIso?: string;
  sampaiIso?: string;
  tanpaLogin?: boolean;
}

const TGL = /^\d{4}-\d{2}-\d{2}$/;

// 'YYYY-MM-DD' WIB -> awal hari itu dalam ISO UTC (WIB = UTC+7).
export function awalHariWibIso(tgl: string): string {
  return new Date(Date.parse(`${tgl}T00:00:00+07:00`)).toISOString();
}

export function filterDariQuery(q: Record<string, string | undefined>): AuditFilter {
  const f: AuditFilter = {};
  const s = (v: string | undefined) => String(v ?? '').trim();
  if (s(q.username)) f.username = s(q.username);
  if (s(q.modul)) f.modul = s(q.modul);
  if (s(q.action)) f.action = s(q.action).toUpperCase();
  if (TGL.test(s(q.dari))) f.dariIso = awalHariWibIso(s(q.dari));
  if (TGL.test(s(q.sampai))) {
    const besok = new Date(Date.parse(`${s(q.sampai)}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
    f.sampaiIso = awalHariWibIso(besok);
  }
  f.tanpaLogin = s(q.login) !== '1';
  return f;
}

export function cocokAudit(r: AuditRow, f: AuditFilter = {}): boolean {
  if (f.username && r.username !== f.username) return false;
  if (f.modul && r.modul !== f.modul) return false;
  if (f.action && r.action !== f.action) return false;
  if (f.dariIso && !(r.timestamp >= f.dariIso)) return false;
  if (f.sampaiIso && !(r.timestamp < f.sampaiIso)) return false;
  if (f.tanpaLogin && AKSI_LOGIN.includes(r.action)) return false;
  return true;
}
