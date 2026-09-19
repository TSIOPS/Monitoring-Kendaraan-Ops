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