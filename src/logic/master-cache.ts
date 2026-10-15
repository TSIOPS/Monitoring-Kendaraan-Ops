import type { KVStore } from '../deps';

// Satu nomor versi data ('master-rev') untuk semua cache KV. Setiap perubahan data cukup
// menaikkan versi (1 write, tanpa delete); cache lama otomatis tidak terbaca lagi karena
// kuncinya memuat versi, lalu kedaluwarsa sendiri (TTL). Menghemat kuota harian KV
// (gratis: 1.000 write & 1.000 delete per hari).

export async function getMasterRev(kv: KVStore): Promise<string> {
  const rev = await kv.get('master-rev');
  return rev == null ? '0' : String(rev);
}

export async function bumpMasterRev(kv: KVStore): Promise<void> {
  const cur = Number(await getMasterRev(kv));
  await kv.put('master-rev', String(cur + 1));
}

// TTL cache: lama karena kebenaran dijaga versi; batas atas agar data harian (sisa hari pajak) tetap segar.
export const CACHE_TTL_DETIK = 1800;

export function masterCacheKey(rev: string, role: string, cabang: string): string {
  return `master:${rev}:${role}:${cabang}`;
}

export function performaCacheKey(rev: string, role: string, cabang: string): string {
  return `perf:${rev}:${role || ''}:${cabang || ''}`;
}

export function monthlyCacheKey(rev: string, role: string, cabang: string): string {
  return `monthly:${rev}:${role || ''}:${cabang || ''}`;
}

export function warningsCacheKey(rev: string, role: string, cabang: string): string {
  return `dashwarn:${rev}:${role || ''}:${cabang || ''}`;
}

export function peringatanCacheKey(rev: string, role: string, cabang: string): string {
  return `peringatan:${rev}:${role || ''}:${cabang || ''}`;
}
