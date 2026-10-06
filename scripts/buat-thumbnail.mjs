// Buat thumbnail (±320 px, JPEG 60%) untuk foto lama di bucket "foto" yang belum punya
// salinan di thumb/. Foto baru sudah dibuatkan thumbnail oleh aplikasi saat diunggah.
//
//   node scripts/buat-thumbnail.mjs              # dry-run: hitung pekerjaan + uji 3 foto
//   node scripts/buat-thumbnail.mjs --apply      # unggah thumbnail
//   opsi: --concurrency=4  --limit=N
//
// Aman diulang: thumbnail yang sudah ada dilewati. Jalankan lagi setelah migrate-photos
// saat cutover.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const BUCKET = 'foto';
const THUMB_PREFIX = 'thumb/';
const LEBAR = 320;
const KUALITAS = 60;
const CACHE = '31536000';

export function thumbKeyOf(key) {
  const k = String(key || '').replace(/^\/+/, '');
  if (!k || k.startsWith(THUMB_PREFIX)) return k;
  return THUMB_PREFIX + k.replace(/\.[A-Za-z0-9]+$/, '') + '.jpg';
}

// Objek foto penuh yang belum punya thumbnail.
export function rencanaThumb(keys) {
  const ada = new Set(keys.filter((k) => k.startsWith(THUMB_PREFIX)));
  return keys.filter((k) => !k.startsWith(THUMB_PREFIX) && /\.(jpe?g|png|webp)$/i.test(k) && !ada.has(thumbKeyOf(k)));
}

export async function kecilkan(bytes) {
  return sharp(bytes).rotate().resize({ width: LEBAR, withoutEnlargement: true }).jpeg({ quality: KUALITAS, mozjpeg: true }).toBuffer();
}

function bacaDevVars(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return env;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const konkurensi = Number((args.find((a) => a.startsWith('--concurrency=')) || '').split('=')[1]) || 4;
  const limit = Number((args.find((a) => a.startsWith('--limit=')) || '').split('=')[1]) || 0;
  const env = bacaDevVars(new URL('../.dev.vars', import.meta.url));
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib ada di .dev.vars.');
  const h = { apikey: key, Authorization: `Bearer ${key}` };

  async function listAll(prefix = '') {
    const out = [];
    for (let offset = 0; ; offset += 1000) {
      const res = await fetch(`${url}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefix, limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } }),
      });
      const items = await res.json();
      if (!Array.isArray(items)) throw new Error(`list ${prefix}: ${JSON.stringify(items)}`);
      for (const it of items) {
        const path = prefix ? `${prefix}/${it.name}` : it.name;
        if (it.id === null) out.push(...(await listAll(path)));
        else out.push({ path, size: Number(it.metadata?.size || 0) });
      }
      if (items.length < 1000) return out;
    }
  }

  const objek = await listAll();
  let jobs = rencanaThumb(objek.map((o) => o.path));
  if (limit) jobs = jobs.slice(0, limit);
  const total = objek.filter((o) => !o.path.startsWith(THUMB_PREFIX)).reduce((n, o) => n + o.size, 0);
  console.log(`Mode: ${apply ? 'APPLY' : 'DRY-RUN'} | target ${new URL(url).host}`);
  console.log(`Foto penuh: ${objek.filter((o) => !o.path.startsWith(THUMB_PREFIX)).length} (${(total / 1048576).toFixed(1)} MB) | thumbnail ada: ${objek.filter((o) => o.path.startsWith(THUMB_PREFIX)).length} | perlu dibuat: ${jobs.length}`);

  const unduh = async (k) => {
    const res = await fetch(`${url}/storage/v1/object/public/${BUCKET}/${k.split('/').map(encodeURIComponent).join('/')}`);
    if (!res.ok) throw new Error(`unduh ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  };

  if (!apply) {
    for (const k of jobs.slice(0, 3)) {
      const asli = await unduh(k);
      const kecil = await kecilkan(asli);
      console.log(`  uji ${k}: ${(asli.length / 1024).toFixed(0)} KB -> ${(kecil.length / 1024).toFixed(0)} KB -> ${thumbKeyOf(k)}`);
    }
    console.log('Dry-run selesai, tidak ada yang ditulis. Jalankan ulang dengan --apply.');
    return;
  }

  const gagal = [];
  let selesai = 0;
  let byteThumb = 0;
  let idx = 0;
  const pekerja = async () => {
    while (idx < jobs.length) {
      const k = jobs[idx++];
      try {
        const kecil = await kecilkan(await unduh(k));
        const res = await fetch(`${url}/storage/v1/object/${BUCKET}/${thumbKeyOf(k).split('/').map(encodeURIComponent).join('/')}`, {
          method: 'POST', headers: { ...h, 'Content-Type': 'image/jpeg', 'x-upsert': 'true', 'cache-control': `max-age=${CACHE}` }, body: kecil,
        });
        if (!res.ok) throw new Error(`upload ${res.status} ${await res.text()}`);
        byteThumb += kecil.length;
      } catch (e) {
        gagal.push({ key: k, error: e.message });
      }
      selesai++;
      if (selesai % 100 === 0 || selesai === jobs.length) console.log(`  ${selesai}/${jobs.length} diproses, gagal ${gagal.length}`);
    }
  };
  await Promise.all(Array.from({ length: konkurensi }, pekerja));
  console.log(`Selesai: ${jobs.length - gagal.length} thumbnail (${(byteThumb / 1048576).toFixed(1)} MB total), gagal ${gagal.length}.`);
  if (gagal.length) {
    console.log('Gagal:', JSON.stringify(gagal.slice(0, 5)));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Buat thumbnail gagal:', err.message);
    process.exit(1);
  });
}
