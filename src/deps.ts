export interface KVStore {
  get(key: string, type: 'text'): Promise<string | null>;
  get(key: string, type: 'json'): Promise<unknown | null>;
  get(key: string): Promise<string | null>;
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
}

export interface AppDeps {
  kv: KVStore;
  findByUsername: (username: string) => Promise<UserRecord | null>;
  recordAudit: (entry: AuditEntry) => Promise<void>;
  now: () => number;
}