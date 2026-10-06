import type { Env } from '../env';
import { getSupabase } from './client';

// Tabel yang dikosongkan saat cutover (diisi ulang dari export GAS).
// "pengguna" dan "pengaturan" sengaja TIDAK ikut: SUPERADMIN tetap bisa login,
// logo/nama aplikasi tetap; keduanya diperbarui oleh migrate-sheets (upsert).
export const TABEL_RESET: ReadonlyArray<readonly [string, string]> = [
  ['penggunaan_bbm', 'transaction_id'],
  ['pengisian_bbm', 'fuel_id'],
  ['foto_evidence', 'evidence_id'],
  ['jalur_pengiriman', 'id'],
  ['flazz_usage', 'id'],
  ['flazz_topup', 'id'],
  ['flazz_tol', 'id'],
  ['flazz_reconciliation', 'id'],
  ['flazz_card', 'id'],
  ['kendaraan', 'vehicle_id'],
  ['supir', 'supir_id'],
  ['bbm', 'bbm_id'],
  ['cabang', 'kode_cabang'],
  ['konfigurasi', 'key'],
  ['audit_log', 'log_id'],
];

// PostgREST menolak DELETE tanpa filter; "pk is not null" mencakup semua baris.
export async function resetDataDb(env: Env): Promise<Record<string, number>> {
  const sb = getSupabase(env);
  const hasil: Record<string, number> = {};
  for (const [tabel, pk] of TABEL_RESET) {
    const { error, count } = await sb.from(tabel).delete({ count: 'exact' }).not(pk, 'is', null);
    if (error) throw new Error(`Kosongkan ${tabel}: ${error.message}`);
    hasil[tabel] = count ?? 0;
  }
  return hasil;
}
