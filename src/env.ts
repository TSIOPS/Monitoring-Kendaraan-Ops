export interface Env {
  ASSETS: Fetcher;
  SESSION_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  // Saklar tombol "Kosongkan Data" (cutover). Hanya aktif bila bernilai "true".
  ENABLE_RESET_DATA?: string;
  // Web Push (VAPID): kunci publik (vars) & kunci privat JWK (secret).
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
  VAPID_SUBJECT?: string;
}