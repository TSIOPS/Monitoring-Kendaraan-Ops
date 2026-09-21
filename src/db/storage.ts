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
