import type { Env } from './env';

// Backup harian database ke R2 privat (bucket monitoring-backup, tidak disajikan publik).
// Isi: backup/<YYYY-MM-DD>/<tabel>-<halaman>.json (1.000 baris/halaman) + ringkasan.json. Disimpan 30 hari, lebih lama dihapus.
// Pulihkan: unduh file lewat dashboard Cloudflare (R2 → monitoring-backup) atau
//   npx wrangler r2 object get monitoring-backup/backup/<tanggal>/<tabel>-0.json --remote

export const TABEL_BACKUP = ['cabang', 'supir', 'bbm', 'pengguna', 'kendaraan', 'penggunaan_bbm', 'pengisian_bbm', 'foto_evidence',
  'audit_log', 'konfigurasi', 'pengaturan', 'flazz_card', 'flazz_usage', 'flazz_topup', 'flazz_tol', 'flazz_reconciliation', 'jalur_pengiriman',
  'kas_jenis', 'kas_keluar', 'kas_masuk', 'kas_saldo_awal', 'kas_opname'];
export const SIMPAN_HARI = 30;

// Tanggal WIB (YYYY-MM-DD) untuk nama folder.
export function tanggalWibDari(ms: number): string {
  return new Date(ms + 7 * 3600_000).toISOString().slice(0, 10);
}

// Folder backup yang sudah lewat masa simpan.
export function folderKedaluwarsa(folders: string[], hariIni: string, simpan = SIMPAN_HARI): string[] {
  const batas = new Date(Date.parse(hariIni + 'T00:00:00Z') - simpan * 86_400_000).toISOString().slice(0, 10);
  return folders.filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f) && f < batas);
}

// Jumlah total baris dari header Content-Range PostgREST ("0-999/5288" atau "*/0").
export function totalDariContentRange(v: string | null): number {
  const m = /\/(\d+)$/.exec(String(v || ''));
  return m ? Number(m[1]) : 0;
}

// Byte JSON per halaman disimpan apa adanya (<tabel>-<n>.json) tanpa diurai: hemat CPU
// (paket gratis Workers ~10 ms CPU per eksekusi).
async function salinTabel(env: Env, bucket: R2Bucket, folder: string, tabel: string): Promise<number> {
  const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, Prefer: 'count=exact' };
  let total = 0;
  for (let hal = 0, from = 0; ; hal++, from += 1000) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${tabel}?select=*`, { headers: { ...h, Range: `${from}-${from + 999}` } });
    if (!res.ok && res.status !== 206) throw new Error(`${tabel}: HTTP ${res.status}`);
    total = totalDariContentRange(res.headers.get('Content-Range'));
    await bucket.put(`${folder}/${tabel}-${hal}.json`, await res.arrayBuffer(), { httpMetadata: { contentType: 'application/json' } });
    if (from + 1000 >= total) return total;
  }
}

export async function jalankanBackup(env: Env, now = Date.now()): Promise<{ tanggal: string; baris: Record<string, number>; dihapus: string[] }> {
  const bucket = env.BACKUP;
  if (!bucket) throw new Error('Binding R2 BACKUP belum ada.');
  const tanggal = tanggalWibDari(now);
  const folder = `backup/${tanggal}`;
  const baris: Record<string, number> = {};
  for (const t of TABEL_BACKUP) baris[t] = await salinTabel(env, bucket, folder, t);
  await bucket.put(`${folder}/ringkasan.json`, JSON.stringify({ waktu: new Date(now).toISOString(), baris }), { httpMetadata: { contentType: 'application/json' } });

  // Hapus folder lebih lama dari masa simpan.
  const daftar = await bucket.list({ prefix: 'backup/', delimiter: '/' });
  const folders = (daftar.delimitedPrefixes || []).map((p) => p.replace(/^backup\//, '').replace(/\/$/, ''));
  const lama = folderKedaluwarsa(folders, tanggal);
  for (const f of lama) {
    const isi = await bucket.list({ prefix: `backup/${f}/` });
    for (const o of isi.objects) await bucket.delete(o.key);
  }
  return { tanggal, baris, dihapus: lama };
}
