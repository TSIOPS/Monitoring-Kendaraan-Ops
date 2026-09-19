import type { MasterRepo } from './db/master';
import type { SettingsRepo } from './db/settings';

export interface KVStore {
  get(key: string, type?: 'text' | 'json'): Promise<string | unknown | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface UserRecord {
  user_id: string;
  username: string;
  password: string;
  nama: string;
  role: string;
  kode_cabang: string;
  status: string;
}

export interface SessionUser {
  user_id: string;
  username: string;
  nama: string;
  role: string;
  cabang: string;
  exp: number;
}

export interface AuditEntry {
  user_id: string;
  username: string;
  action: string;
  modul: string;
  keterangan: string;
  data_sebelum?: string;
  data_sesudah?: string;
  ip?: string;
}

export interface AuditRow {
  log_id: string;
  timestamp: string;
  user_id: string;
  username: string;
  action: string;
  modul: string;
  keterangan: string;
  data_sebelum: string;
  data_sesudah: string;
  ip: string;
}

export interface AppDeps {
  kv: KVStore;
  findByUsername: (username: string) => Promise<UserRecord | null>;
  recordAudit: (entry: AuditEntry) => Promise<void>;
  auditList: (limit: number) => Promise<AuditRow[]>;
  now: () => number;
  master: MasterRepo;
  settings: SettingsRepo;
}