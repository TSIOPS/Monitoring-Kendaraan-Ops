import type { Env } from '../env';
import { getSupabase } from './client';

export const SETTINGS_DEFAULTS: Record<string, string> = {
  logo_url: '',
  app_name: 'Monitoring Kendaraan Operasional',
  company_name: 'PT Tridaya Sinergi Indonesia',
  footer_text: '© 2026 Tridaya Sinergi Indonesia',
};

export interface SettingsRepo {
  getAll(): Promise<Record<string, string>>;
  setMany(updates: Record<string, string>): Promise<void>;
}

export function supabaseSettingsRepo(env: Env): SettingsRepo {
  const sb = () => getSupabase(env);
  return {
    async getAll() {
      const { data, error } = await sb().from('pengaturan').select('key, value');
      if (error) throw new Error(`DB settings.getAll: ${error.message}`);
      const out: Record<string, string> = { ...SETTINGS_DEFAULTS };
      for (const r of data ?? []) out[String(r.key)] = String(r.value ?? '');
      return out;
    },
    async setMany(updates) {
      const rows = Object.entries(updates).map(([key, value]) => ({ key, value, updated_at: new Date().toISOString() }));
      const { error } = await sb().from('pengaturan').upsert(rows, { onConflict: 'key' });
      if (error) throw new Error(`DB settings.setMany: ${error.message}`);
    },
  };
}