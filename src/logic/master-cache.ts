import type { KVStore } from '../deps';

export async function getMasterRev(kv: KVStore): Promise<string> {
  const rev = await kv.get('master-rev');
  return rev == null ? '0' : String(rev);
}

export async function bumpMasterRev(kv: KVStore): Promise<void> {
  const cur = Number(await getMasterRev(kv));
  await kv.put('master-rev', String(cur + 1));
}

export function masterCacheKey(rev: string, role: string, cabang: string): string {
  return `master:${rev}:${role}:${cabang}`;
}

export function performaCacheKey(role: string, cabang: string): string {
  return `perf:${role || ''}:${cabang || ''}`;
}

export function monthlyCacheKey(role: string, cabang: string): string {
  return `monthly:${role || ''}:${cabang || ''}`;
}

export function warningsCacheKey(role: string, cabang: string): string {
  return `dashwarn:${role || ''}:${cabang || ''}`;
}

export async function invalidateLaporanCaches(kv: KVStore, role: string, cabang: string): Promise<void> {
  const scopes: Array<[string, string]> = [[role || '', cabang || ''], ['SUPERADMIN', '']];
  for (const [r, cb] of scopes) {
    await kv.delete(performaCacheKey(r, cb));
    await kv.delete(monthlyCacheKey(r, cb));
  }
}