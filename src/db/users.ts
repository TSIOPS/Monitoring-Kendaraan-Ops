import type { Env } from '../env';
import type { UserRecord } from '../deps';
import { getSupabase } from './client';

export function findByUsernameDb(env: Env) {
  return async (username: string): Promise<UserRecord | null> => {
    const { data, error } = await getSupabase(env)
      .from('pengguna')
      .select('user_id, username, password, nama, role, kode_cabang, status')
      .ilike('username', username)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`DB findByUsername: ${error.message}`);
    return data as UserRecord | null;
  };
}