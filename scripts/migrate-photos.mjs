// Migrasi foto Google Drive -> Supabase Storage (spec §6, langkah 2).
//
// Jalankan SETELAH scripts/migrate-sheets.mjs:
//   node scripts/migrate-photos.mjs              # dry-run: hitung pekerjaan + uji unduh 3 foto
//   node scripts/migrate-photos.mjs --apply      # unggah + perbarui URL di database
//   opsi: --concurrency=4  --limit=N (uji sebagian)
//
// File Drive dari GAS dapat diunduh tanpa login (berbagi lewat link). Nama objek di
// Storage TETAP per ID Drive (`<cabang>/<folder>/gdrive-<id>.<ext>`), sehingga skrip aman
// diulang: migrasi data ulang saat cutover mengembalikan URL Drive, dan skrip ini cukup
// menimpa objek yang sama lalu memetakan URL lagi. Foto tidak dikompres ulang karena
// GAS sudah menyimpannya terkompresi (~80 KB).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const FOTO_BUCKET = 'foto';
const SETTINGS_BUCKET = 'settings';
const KOLOM_FOLDER = {
  foto_km_awal: 'KM_Awal',
  foto_km_akhir: 'KM_Akhir',
  foto_struk_bbm: 'Struk_BBM',
  foto_struk_toll: 'Struk_Tol',
};
const MAKS_BYTE = 10 * 1024 * 1024;

export function driveId(url) {
  const s = String(url ?? '');
  if (!/^https?:\/\/(drive|docs)\.google\.com\//.test(s)) return '';
  const m = /\/d\/([-\w]{20,})/.exec(s) || /[?&]id=([-\w]{20,})/.exec(s);
  return m ? m[1] : '';
}

export function safeBranch(branch) {
  const b = String(branch || '').replace(/[^A-Za-z0-9_-]/g, '');
  return b || 'TANPA-CABANG';
}

export function jenisGambar(bytes) {
  const b = bytes.subarray(0, 12);
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', contentType: 'image/jpeg' };
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', contentType: 'image/png' };
  if (String.fromCharCode(...b.subarray(0, 4)) === 'RIFF' && String.fromCharCode(...b.subarray(8, 12)) === 'WEBP') return { ext: 'webp', contentType: 'image/webp' };
  return null;
}

export const keyFoto = (branch, folder, id, ext) => `${safeBranch(branch)}/${folder}/gdrive-${id}.${ext}`;

// Daftar pekerjaan dari baris laporan: satu per kolom foto yang masih menunjuk ke Drive.
export function rencanaFoto(rows) {
  const jobs = [];
  for (const r of rows) {
    for (const [kolom, folder] of Object.entries(KOLOM_FOLDER)) {
      const id = driveId(r[kolom]);
      if (id) jobs.push({ transaction_id: r.transaction_id, kode_cabang: r.kode_cabang, kolom, folder, driveId: id });
    }
  }
  return jobs;
}

function bacaDevVars(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return env;
}

async function unduh(id, percobaan = 3) {
  let terakhir;
  for (let i = 0; i < percobaan; i++) {
    try {
      const res = await fetch(`https://drive.google.com/uc?export=download&id=${id}`, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.length > MAKS_BYTE) throw new Error(`ukuran ${bytes.length} byte melebihi 10 MB`);
      const jenis = jenisGambar(bytes);
      if (!jenis) throw new Error('bukan gambar (file mungkin tidak dibagikan publik)');
      return { bytes, ...jenis };
    } catch (e) {
      terakhir = e;
      await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
    }
  }
  throw terakhir;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const konkurensi = Number((args.find((a) => a.startsWith('--concurrency=')) || '').split('=')[1]) || 4;
  const limit = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 0;

  const root = new URL('../', import.meta.url);
  const env = bacaDevVars(new URL('.dev.vars', root));
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib ada di .dev.vars.');
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  const rest = (p, init = {}) => fetch(`${url}/rest/v1/${p}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const upload = async (bucket, objectKey, bytes, contentType) => {
    const res = await fetch(`${url}/storage/v1/object/${bucket}/${objectKey}`, {
      method: 'POST', headers: { ...headers, 'Content-Type': contentType, 'x-upsert': 'true' }, body: bytes,
    });
    if (!res.ok) throw new Error(`upload ${res.status} ${await res.text()}`);
    return `${url}/storage/v1/object/public/${bucket}/${objectKey}`;
  };

  // Bucket publik dibuat bila belum ada (sama seperti ensureFotoBucket/ensureSettingsBucket aplikasi).
  const ensureBucket = async (id) => {
    const res = await fetch(`${url}/storage/v1/bucket`, {
      method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ id, name: id, public: true }),
    });
    if (!res.ok && !/already exists|Duplicate/i.test(await res.text())) throw new Error(`buat bucket ${id}: ${res.status}`);
  };

  const rows = [];
  for (let f = 0; ; f += 1000) {
    const res = await rest(`penggunaan_bbm?select=transaction_id,kode_cabang,${Object.keys(KOLOM_FOLDER).join(',')}`, { headers: { Range: `${f}-${f + 999}` } });
    if (!res.ok) throw new Error(`baca penggunaan_bbm: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  let jobs = rencanaFoto(rows);
  const logoRes = await rest('pengaturan?key=eq.logo_url&select=key,value');
  const logo = (await logoRes.json())[0];
  const logoId = driveId(logo?.value);
  if (limit) jobs = jobs.slice(0, limit);

  const perKolom = jobs.reduce((a, j) => ((a[j.kolom] = (a[j.kolom] || 0) + 1), a), {});
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'} | target ${new URL(url).host}`);
  console.log(`Foto laporan di Drive: ${jobs.length} ${JSON.stringify(perKolom)} | logo di Drive: ${logoId ? 'ya' : 'tidak'}`);

  if (!apply) {
    for (const j of jobs.slice(0, 3)) {
      try {
        const g = await unduh(j.driveId);
        console.log(`  uji unduh ${j.transaction_id}.${j.kolom}: ${g.contentType} ${g.bytes.length} byte -> ${keyFoto(j.kode_cabang, j.folder, j.driveId, g.ext)}`);
      } catch (e) {
        console.log(`  uji unduh ${j.transaction_id}.${j.kolom}: GAGAL ${e.message}`);
      }
    }
    console.log('Dry-run selesai, tidak ada yang ditulis. Jalankan ulang dengan --apply.');
    return;
  }

  await ensureBucket(FOTO_BUCKET);
  if (logoId) await ensureBucket(SETTINGS_BUCKET);

  const gagal = [];
  let selesai = 0;
  // Patch per transaksi setelah semua fotonya terunggah.
  const patch = new Map();
  let idx = 0;
  const pekerja = async () => {
    while (idx < jobs.length) {
      const j = jobs[idx++];
      try {
        const g = await unduh(j.driveId);
        const publik = await upload(FOTO_BUCKET, keyFoto(j.kode_cabang, j.folder, j.driveId, g.ext), g.bytes, g.contentType);
        const p = patch.get(j.transaction_id) || {};
        p[j.kolom] = publik;
        patch.set(j.transaction_id, p);
      } catch (e) {
        gagal.push({ transaction_id: j.transaction_id, kolom: j.kolom, driveId: j.driveId, error: e.message });
      }
      selesai++;
      if (selesai % 50 === 0 || selesai === jobs.length) process.stdout.write(`  ${selesai}/${jobs.length} diproses, gagal ${gagal.length}\n`);
    }
  };
  await Promise.all(Array.from({ length: konkurensi }, pekerja));

  let diperbarui = 0;
  for (const [trx, p] of patch) {
    const res = await rest(`penggunaan_bbm?transaction_id=eq.${encodeURIComponent(trx)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify(p),
    });
    if (!res.ok) gagal.push({ transaction_id: trx, kolom: Object.keys(p).join(','), error: `patch ${res.status} ${await res.text()}` });
    else diperbarui++;
  }

  let logoBaru = '';
  if (logoId) {
    try {
      const g = await unduh(logoId);
      logoBaru = await upload(SETTINGS_BUCKET, `logo.${g.ext}`, g.bytes, g.contentType);
      const res = await rest('pengaturan?key=eq.logo_url', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ value: logoBaru }),
      });
      if (!res.ok) throw new Error(`patch ${res.status}`);
    } catch (e) {
      gagal.push({ kolom: 'pengaturan.logo_url', driveId: logoId, error: e.message });
    }
  }

  const sisa = rencanaFoto(await (async () => {
    const out = [];
    for (let f = 0; ; f += 1000) {
      const page = await (await rest(`penggunaan_bbm?select=transaction_id,kode_cabang,${Object.keys(KOLOM_FOLDER).join(',')}`, { headers: { Range: `${f}-${f + 999}` } })).json();
      out.push(...page);
      if (page.length < 1000) return out;
    }
  })()).length;

  mkdirSync(new URL('migrasi/', root), { recursive: true });
  writeFileSync(new URL('migrasi/laporan-foto.json', root), JSON.stringify({ jobs: jobs.length, transaksiDiperbarui: diperbarui, logo: logoBaru, gagal, sisaDiDrive: sisa }, null, 2));
  console.log(`Selesai: ${jobs.length - gagal.filter((g) => g.transaction_id && !g.error.startsWith('patch')).length} foto terunggah, ${diperbarui} transaksi diperbarui, logo ${logoBaru ? 'dipindah' : '-'}, gagal ${gagal.length}, sisa URL Drive ${sisa}.`);
  if (gagal.length) {
    console.log('Gagal (lihat migrasi/laporan-foto.json):', JSON.stringify(gagal.slice(0, 5)));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Migrasi foto gagal:', err.message);
    process.exit(1);
  });
}
