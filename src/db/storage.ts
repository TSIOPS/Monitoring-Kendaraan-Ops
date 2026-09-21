import type { Env } from '../env';
import { getSupabase } from './client';

const BUCKET = 'settings';

export interface StorageUploadResult {
  url: string;
  key: string;
}

export interface UploadEvidenceOpts {
  branch: string;
  folder: 'KM_Awal' | 'KM_Akhir';
  bytes: Uint8Array;
  ext: string;
  contentType: string;
}

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

export async function uploadEvidenceStorage(env: Env, opts: UploadEvidenceOpts): Promise<StorageUploadResult> {
  const sb = getSupabase(env);
  await ensureFotoBucket(env);
  const key = `${safeBranch(opts.branch)}/${opts.folder}/${crypto.randomUUID()}.${opts.ext}`;
  const { error } = await sb.storage.from(FOTO_BUCKET).upload(key, opts.bytes, { contentType: opts.contentType });
  if (error) throw new Error(`Storage upload: ${error.message}`);
  const url = `${env.SUPABASE_URL}/storage/v1/object/public/${FOTO_BUCKET}/${key}`;
  return { url, key };
}

export async function deleteEvidenceStorage(env: Env, key: string): Promise<void> {
  if (!key) return;
  const sb = getSupabase(env);
  const { error } = await sb.storage.from(FOTO_BUCKET).remove([key]);
  if (error && !/not found/i.test(error.message ?? '')) throw new Error(`Storage delete: ${error.message}`);
}

export function extractStorageKey(url: string): string {
  const m = /\/object\/public\/[^/]+\/(.+)$/.exec(String(url || ''));
  return m?.[1] ?? '';
}
