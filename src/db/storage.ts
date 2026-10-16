import type { Env } from '../env';
import { getSupabase } from './client';

const BUCKET = 'settings';

export interface StorageUploadResult {
  url: string;
  key: string;
}

export interface UploadEvidenceOpts {
  branch: string;
  folder: 'KM_Awal' | 'KM_Akhir' | 'Struk_BBM' | 'Struk_Tol' | 'Flazz_TopUp' | 'Flazz_Recon';
  bytes: Uint8Array;
  ext: string;
  contentType: string;
  // Kunci objek tetap (mis. thumbnail turunan); tanpa ini dibuat UUID baru.
  key?: string;
}

// Nama objek unik/tidak berubah isinya, jadi browser boleh menyimpan cache 1 tahun
// (mengurangi egress Supabase saat daftar & galeri dibuka berulang).
const CACHE_FOTO = '31536000';

export async function ensureSettingsBucket(env: Env): Promise<void> {
  const sb = getSupabase(env);
  try {
    const { error } = await sb.storage.createBucket(BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message ?? '')) throw error;
  } catch (err) {
    const { data, error } = await sb.storage.getBucket(BUCKET);
    if (error) throw new Error(`Storage getBucket: ${error.message}`);
    if (data && !data.public) {
      await sb.storage.updateBucket(BUCKET, { public: true });
    }
  }
}

export async function uploadLogo(
  env: Env,
  bytes: Uint8Array,
  ext: string,
  contentType: string,
): Promise<StorageUploadResult> {
  const sb = getSupabase(env);
  await ensureSettingsBucket(env);
  const key = `logo.${ext}`;
  const { error } = await sb.storage.from(BUCKET).upload(key, bytes, { contentType, upsert: true });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  const url = `${env.SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${key}`;
  return { url, key };
}

export const FOTO_BUCKET = 'foto';

export async function ensureFotoBucket(env: Env): Promise<void> {
  const sb = getSupabase(env);
  try {
    const { error } = await sb.storage.createBucket(FOTO_BUCKET, { public: true });
    if (error && !/already exists/i.test(error.message ?? '')) throw error;
  } catch {
    const { data, error } = await sb.storage.getBucket(FOTO_BUCKET);
    if (error) throw new Error(`Storage getBucket: ${error.message}`);
    if (data && !data.public) {
      await sb.storage.updateBucket(FOTO_BUCKET, { public: true });
    }
  }
}

function safeBranch(branch: string): string {
  const b = String(branch || '').replace(/[^A-Za-z0-9_-]/g, '');
  return b || 'TANPA-CABANG';
}

// URL foto di R2: relatif terhadap aplikasi, disajikan route GET /foto/*.
export const R2_PREFIX = '/foto/';

export async function uploadEvidenceStorage(env: Env, opts: UploadEvidenceOpts): Promise<StorageUploadResult> {
  if (env.FOTO) {
    const key = opts.key || `${safeBranch(opts.branch)}/${opts.folder}/${crypto.randomUUID()}.${opts.ext}`;
    await env.FOTO.put(key, opts.bytes, { httpMetadata: { contentType: opts.contentType, cacheControl: `public, max-age=${CACHE_FOTO}, immutable` } });
    return { url: R2_PREFIX + key, key };
  }
  const sb = getSupabase(env);
  await ensureFotoBucket(env);
  const key = opts.key || `${safeBranch(opts.branch)}/${opts.folder}/${crypto.randomUUID()}.${opts.ext}`;
  const { error } = await sb.storage.from(FOTO_BUCKET).upload(key, opts.bytes, { contentType: opts.contentType, cacheControl: CACHE_FOTO, upsert: Boolean(opts.key) });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  const url = `${env.SUPABASE_URL}/storage/v1/object/public/${FOTO_BUCKET}/${key}`;
  return { url, key };
}

// Kunci objek sama di R2 & Supabase (hasil salin), jadi hapus di keduanya.
export async function deleteEvidenceStorage(env: Env, key: string): Promise<void> {
  if (!key) return;
  if (env.FOTO) await env.FOTO.delete(key);
  const sb = getSupabase(env);
  const { error } = await sb.storage.from(FOTO_BUCKET).remove([key]);
  if (error && !/not found/i.test(error.message ?? '')) throw new Error(`Storage delete: ${error.message}`);
}

export function extractStorageKey(url: string): string {
  const s = String(url || '').split('?')[0] ?? '';
  if (s.startsWith(R2_PREFIX)) return s.slice(R2_PREFIX.length);
  const m = /\/object\/public\/[^/]+\/(.+)$/.exec(s);
  return m?.[1] ?? '';
}
