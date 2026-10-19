import type { Env } from '../env';
import type { UserRecord } from '../deps';
import { getSupabase } from './client';
import { polaUsername } from '../utils/keamanan';

export function findByUsernameDb(env: Env) {
  return async (username: string): Promise<UserRecord | null> => {
    const pola = polaUsername(username);
    if (pola === null) return null;
    const { data, error } = await getSupabase(env)
      .from('pengguna')
      .select('user_id, username, password, nama, role, kode_cabang, status')
      .ilike('username', pola)
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`DB findByUsername: ${error.message}`);
    return data as UserRecord | null;
  };
}