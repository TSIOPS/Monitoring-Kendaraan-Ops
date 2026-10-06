export interface Env {
  ASSETS: Fetcher;
  SESSION_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  // Saklar tombol "Kosongkan Data" (cutover). Hanya aktif bila bernilai "true".
  ENABLE_RESET_DATA?: string;
}