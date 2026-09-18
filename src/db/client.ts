import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Env } from '../env';

const clients = new WeakMap<Env, SupabaseClient>();

export function getSupabase(env: Env): SupabaseClient {
  let client = clients.get(env);
  if (!client) {
    client = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    clients.set(env, client);
  }
  return client;
}