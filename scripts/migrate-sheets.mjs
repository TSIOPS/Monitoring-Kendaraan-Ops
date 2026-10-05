// Migrasi data dari export Google Sheets (.xlsx) ke tabel Supabase (spec §6).
//
// Jalankan:
//   node scripts/migrate-sheets.mjs <file.xlsx>           # dry-run: baca, ubah, validasi, tulis laporan
//   node scripts/migrate-sheets.mjs <file.xlsx> --apply   # tulis ke Supabase (upsert, aman diulang)
//
// Kredensial dibaca dari .dev.vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
// Laporan ditulis ke migrasi/laporan-migrasi.json (folder di-gitignore).
//
// Aturan konversi:
// - Sel tanggal Excel adalah jam dinding WIB. Kolom tanggal-saja menjadi YYYY-MM-DD,
//   kolom stempel waktu menjadi ISO UTC (sama seperti yang ditulis aplikasi).
// - Kolom yang tidak ada di db/schema.sql dibuang dan dicatat di laporan.
// - Supir dengan ID ganda: baris kedua diberi ID baru `<id>-B`, rujukan jalur
//   dipetakan ulang berdasarkan nama supir.
// - Nomor kartu Flazz 15 digit berawalan 145 dipulihkan menjadi 16 digit (0 di depan hilang di Sheets).

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import * as XLSX from 'xlsx';

const WIB_OFFSET_MS = 7 * 3600 * 1000;
const EXCEL_EPOCH_DAYS = 25569; // serial 25569 = 1970-01-01
const BATCH = 500;

// Urutan = urutan insert (master dulu, lalu transaksi). Penggunaan_BBM disisipkan
// sesuai urutan baris sheet agar kolom identity `seq` mengikuti urutan kronologis.
export const SHEETS = [
  ['Cabang', 'cabang'],
  ['BBM', 'bbm'],
  ['Pengguna', 'pengguna'],
  ['Kendaraan', 'kendaraan'],
  ['Supir', 'supir'],
  ['Flazz_Card', 'flazz_card'],
  ['Jalur_Pengiriman', 'jalur_pengiriman'],
  ['Penggunaan_BBM', 'penggunaan_bbm'],
  ['Pengisian_BBM', 'pengisian_bbm'],
  ['Foto_Evidence', 'foto_evidence'],
  ['Flazz_Usage', 'flazz_usage'],
  ['Flazz_TopUp', 'flazz_topup'],
  ['Flazz_Tol', 'flazz_tol'],
  ['Flazz_Reconciliation', 'flazz_reconciliation'],
  ['Audit_Log', 'audit_log'],
  ['Pengaturan', 'pengaturan'],
  ['Konfigurasi', 'konfigurasi'],
];

const ALIAS_KOLOM = { supir: { vehicle_id: 'default_vehicle_id' } };

const TANGGAL_SAJA = {
  '*': ['tanggal', 'tanggal_pajak', 'tanggal_pajak_5_tahunan', 'tanggal_kir'],
  flazz_topup: ['date'],
  flazz_tol: ['date'],
  flazz_reconciliation: ['date'],
};

export function parseSchema(sql) {
  const tables = {};
  for (const m of sql.matchAll(/create table if not exists (\w+) \(([\s\S]*?)\n\);/gi)) {
    const cols = {};
    let pk = '';
    for (const raw of m[2].split('\n')) {
      const line = raw.trim().replace(/,$/, '');
      const c = /^([a-z_0-9]+)\s+([a-z]+)/i.exec(line);
      if (!c || /^(primary|unique|constraint|foreign|check)$/i.test(c[1])) continue;
      if (/generated\s+always/i.test(line)) continue;
      cols[c[1]] = /^(numeric|bigint|integer|int|real|double)$/i.test(c[2]) ? 'num' : 'text';
      if (/primary key/i.test(line)) pk = c[1];
    }
    tables[m[1]] = { cols, pk };
  }
  return tables;
}

export function isTanggalSaja(tabel, kolom) {
  return TANGGAL_SAJA['*'].includes(kolom) || (TANGGAL_SAJA[tabel] || []).includes(kolom);
}

export function serialKeTanggal(serial) {
  const hari = Math.floor(serial + 1e-9) - EXCEL_EPOCH_DAYS;
  return new Date(hari * 86400000).toISOString().slice(0, 10);
}

export function serialKeIsoUtc(serial) {
  const wallMs = Math.round((serial - EXCEL_EPOCH_DAYS) * 86400000);
  return new Date(wallMs - WIB_OFFSET_MS).toISOString();
}

export function keAngka(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  let s = String(v).trim();
  if (s === '') return 0;
  if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function keTeks(v) {
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

// Hanya nomor yang kehilangan 0 di depan yang diubah; format lain (mis. berspasi) dibiarkan apa adanya.
export function pulihkanNomorKartu(nomor) {
  const asli = String(nomor);
  return /^145\d{12}$/.test(asli.replace(/\s/g, '')) ? '0' + asli.trim() : asli;
}

function selKosong(cell) {
  return !cell || cell.v === null || cell.v === undefined || (typeof cell.v === 'string' && cell.v.trim() === '');
}

export function nilaiSel(cell, tabel, kolom, tipe, masalah) {
  if (selKosong(cell)) return tipe === 'num' ? 0 : '';
  if (cell.t === 'n' && cell.z && XLSX.SSF.is_date(cell.z)) {
    if (tipe === 'num') return cell.v;
    return isTanggalSaja(tabel, kolom) ? serialKeTanggal(cell.v) : serialKeIsoUtc(cell.v);
  }
  if (tipe === 'num') {
    const n = keAngka(cell.v);
    if (n === null) {
      masalah.push({ tabel, kolom, jenis: 'bukan-angka', pola: String(cell.v).replace(/\d/g, '9').slice(0, 30) });
      return 0;
    }
    return n;
  }
  return keTeks(cell.v);
}

// Baca satu sheet menjadi { header, rows: [{kolom: nilai}], dibuang: {kolom: [pk...]} }.
export function bacaSheet(ws, tabel, schema, masalah) {
  const def = schema[tabel];
  const alias = ALIAS_KOLOM[tabel] || {};
  const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1');
  const kolomSheet = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const h = ws[XLSX.utils.encode_cell({ r: range.s.r, c })];
    kolomSheet.push({ c, nama: h ? String(h.v).trim() : '' });
  }
  const dipakai = kolomSheet
    .map((k) => ({ ...k, kolom: alias[k.nama] || k.nama }))
    .filter((k) => k.kolom && def.cols[k.kolom]);
  const dibuangKolom = kolomSheet.filter((k) => k.nama && !def.cols[alias[k.nama] || k.nama]);
  const pkKol = dipakai.find((k) => k.kolom === def.pk);

  const rows = [];
  const dibuang = {};
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const sel = (c) => ws[XLSX.utils.encode_cell({ r, c })];
    if (kolomSheet.every((k) => selKosong(sel(k.c)))) continue;
    const row = {};
    for (const k of dipakai) row[k.kolom] = nilaiSel(sel(k.c), tabel, k.kolom, def.cols[k.kolom], masalah);
    for (const k of dibuangKolom) {
      const s = sel(k.c);
      if (selKosong(s) || s.v === 0) continue;
      (dibuang[k.nama] ||= []).push(pkKol ? row[pkKol.kolom] : `baris ${r + 1}`);
    }
    rows.push(row);
  }
  return { rows, dibuang, pk: def.pk };
}

// Supir dengan ID ganda: baris kedua dst. diberi ID baru, dikembalikan sebagai peta untuk jalur.
export function pisahkanSupirGanda(rows) {
  const dilihat = new Set();
  const remap = [];
  for (const row of rows) {
    if (!dilihat.has(row.supir_id)) {
      dilihat.add(row.supir_id);
      continue;
    }
    let akhiran = 'B';
    while (dilihat.has(`${row.supir_id}-${akhiran}`)) akhiran = String.fromCharCode(akhiran.charCodeAt(0) + 1);
    const baru = `${row.supir_id}-${akhiran}`;
    remap.push({ lama: row.supir_id, baru, nama: row.nama_supir });
    row.supir_id = baru;
    dilihat.add(baru);
  }
  return remap;
}

export function terapkanRemapJalur(rows, remap) {
  let n = 0;
  for (const m of remap) {
    for (const row of rows) {
      if (row.driver_id === m.lama && row.nama_driver === m.nama) { row.driver_id = m.baru; n++; }
      if (row.driver2_id === m.lama && row.nama_driver2 === m.nama) { row.driver2_id = m.baru; n++; }
    }
  }
  return n;
}

export function cariPkGanda(rows, pk) {
  const hitung = new Map();
  for (const r of rows) hitung.set(r[pk], (hitung.get(r[pk]) || 0) + 1);
  return [...hitung].filter(([, n]) => n > 1).map(([id]) => id);
}

export function siapkan(wb, schema) {
  const masalah = [];
  const hasil = {};
  const laporan = { tabel: {}, kolomDibuang: {}, perbaikan: [], masalah };

  for (const [sheet, tabel] of SHEETS) {
    if (!schema[tabel]) throw new Error(`Tabel ${tabel} tidak ada di db/schema.sql`);
    const ws = wb.Sheets[sheet];
    if (!ws) {
      laporan.tabel[tabel] = { sheet, baris: 0, catatan: 'sheet tidak ada' };
      hasil[tabel] = { rows: [], pk: schema[tabel].pk };
      continue;
    }
    hasil[tabel] = bacaSheet(ws, tabel, schema, masalah);
    if (Object.keys(hasil[tabel].dibuang).length) laporan.kolomDibuang[tabel] = hasil[tabel].dibuang;
  }

  const remap = pisahkanSupirGanda(hasil.supir.rows);
  for (const m of remap) laporan.perbaikan.push(`Supir ID ganda ${m.lama}: baris kedua menjadi ${m.baru}`);
  const nRemap = terapkanRemapJalur(hasil.jalur_pengiriman.rows, remap);
  if (remap.length) laporan.perbaikan.push(`Rujukan supir di jalur dipetakan ulang: ${nRemap}`);

  let nKartu = 0;
  for (const row of hasil.flazz_card.rows) {
    const pulih = pulihkanNomorKartu(row.card_number);
    if (pulih !== row.card_number) { row.card_number = pulih; nKartu++; }
  }
  if (nKartu) laporan.perbaikan.push(`Nomor kartu Flazz dipulihkan ke 16 digit: ${nKartu}`);

  for (const [tabel, { rows, pk }] of Object.entries(hasil)) {
    const ganda = cariPkGanda(rows, pk);
    if (ganda.length) masalah.push({ tabel, jenis: 'pk-ganda', jumlah: ganda.length, contoh: ganda.slice(0, 5) });
    const kosong = rows.filter((r) => r[pk] === '' || r[pk] === undefined).length;
    if (kosong) masalah.push({ tabel, jenis: 'pk-kosong', jumlah: kosong });
    const tahunAneh = rows.filter((r) => Object.values(r).some((v) => typeof v === 'string' && /^(1[0-8]\d\d|19[0-8]\d)-\d\d-\d\d/.test(v))).length;
    if (tahunAneh) masalah.push({ tabel, jenis: 'tanggal-sebelum-1990', jumlah: tahunAneh });
    laporan.tabel[tabel] = { ...(laporan.tabel[tabel] || {}), baris: rows.length };
  }
  return { hasil, laporan };
}

function bacaDevVars(path) {
  const env = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return env;
}

async function hitungBaris(url, headers, tabel) {
  const res = await fetch(`${url}/rest/v1/${tabel}?select=*`, { headers: { ...headers, Prefer: 'count=exact', Range: '0-0' } });
  if (!res.ok) throw new Error(`Hitung ${tabel} gagal: ${res.status} ${await res.text()}`);
  return Number((res.headers.get('content-range') || '*/0').split('/')[1]);
}

async function ambilKolom(url, headers, tabel, kolom) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${url}/rest/v1/${tabel}?select=${kolom}`, { headers: { ...headers, Range: `${from}-${from + 999}` } });
    if (!res.ok) throw new Error(`Baca ${tabel} gagal: ${res.status} ${await res.text()}`);
    const page = await res.json();
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

async function upsert(url, headers, tabel, pk, rows) {
  for (let i = 0; i < rows.length; i += BATCH) {
    const res = await fetch(`${url}/rest/v1/${tabel}?on_conflict=${pk}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(rows.slice(i, i + BATCH)),
    });
    if (!res.ok) throw new Error(`Upsert ${tabel} baris ${i}-${i + BATCH} gagal: ${res.status} ${await res.text()}`);
  }
}

async function main() {
  const args = process.argv.slice(2);
  const file = args.find((a) => !a.startsWith('--'));
  const apply = args.includes('--apply');
  if (!file) {
    console.error('Pakai: node scripts/migrate-sheets.mjs <file.xlsx> [--apply]');
    process.exit(1);
  }

  const root = new URL('../', import.meta.url);
  const schema = parseSchema(readFileSync(new URL('db/schema.sql', root), 'utf8'));
  const wb = XLSX.read(readFileSync(file), { cellNF: true, cellDates: false });
  const { hasil, laporan } = siapkan(wb, schema);

  console.log(`Mode: ${apply ? 'APPLY (menulis ke Supabase)' : 'DRY-RUN (tidak menulis apa pun)'}`);
  console.log('\nBaris per tabel:');
  for (const [t, info] of Object.entries(laporan.tabel)) console.log(`  ${t.padEnd(22)} ${String(info.baris).padStart(5)}${info.catatan ? '  (' + info.catatan + ')' : ''}`);
  console.log('\nPerbaikan:');
  for (const p of laporan.perbaikan) console.log('  - ' + p);
  console.log('\nKolom dibuang (tidak ada di schema), baris yang berisi nilai:');
  for (const [t, cols] of Object.entries(laporan.kolomDibuang)) for (const [c, ids] of Object.entries(cols)) console.log(`  - ${t}.${c}: ${ids.length} baris -> ${ids.slice(0, 5).join(', ')}`);
  const blokir = laporan.masalah.filter((m) => m.jenis === 'pk-ganda' || m.jenis === 'pk-kosong');
  console.log(`\nMasalah: ${laporan.masalah.length ? '' : 'tidak ada'}`);
  for (const m of laporan.masalah) console.log('  - ' + JSON.stringify(m));

  mkdirSync(new URL('migrasi/', root), { recursive: true });
  const lapPath = new URL('migrasi/laporan-migrasi.json', root);

  if (blokir.length) {
    writeFileSync(lapPath, JSON.stringify(laporan, null, 2));
    console.error('\nDihentikan: ada primary key ganda/kosong. Lihat migrasi/laporan-migrasi.json.');
    process.exit(1);
  }

  const env = bacaDevVars(new URL('.dev.vars', root));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib ada di .dev.vars.');
  const url = env.SUPABASE_URL;
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
  console.log(`\nTarget: ${new URL(url).host}`);

  // PK yang sudah ada di DB, untuk menghitung jumlah akhir yang diharapkan.
  const adaSebelum = {};
  for (const [tabel, { pk }] of Object.entries(hasil)) {
    adaSebelum[tabel] = new Set((await ambilKolom(url, headers, tabel, pk)).map((r) => String(r[pk])));
  }

  if (!apply) {
    for (const [tabel, { rows, pk }] of Object.entries(hasil)) {
      const timpa = rows.filter((r) => adaSebelum[tabel].has(String(r[pk]))).length;
      if (adaSebelum[tabel].size) console.log(`  ${tabel}: ${adaSebelum[tabel].size} baris sudah ada di DB, ${timpa} akan ditimpa nilainya dari sheet`);
    }
    writeFileSync(lapPath, JSON.stringify(laporan, null, 2));
    console.log('\nDry-run selesai. Laporan: migrasi/laporan-migrasi.json. Jalankan ulang dengan --apply untuk menulis.');
    return;
  }

  for (const [tabel, { rows, pk }] of Object.entries(hasil)) {
    if (!rows.length) continue;
    process.stdout.write(`  upsert ${tabel} (${rows.length})... `);
    await upsert(url, headers, tabel, pk, rows);
    console.log('ok');
  }

  console.log('\nVerifikasi jumlah baris:');
  let gagal = 0;
  laporan.verifikasi = {};
  for (const [tabel, { rows, pk }] of Object.entries(hasil)) {
    const harapan = new Set([...adaSebelum[tabel], ...rows.map((r) => String(r[pk]))]).size;
    const aktual = await hitungBaris(url, headers, tabel);
    const ok = aktual === harapan;
    if (!ok) gagal++;
    laporan.verifikasi[tabel] = { harapan, aktual, ok };
    console.log(`  ${ok ? 'OK  ' : 'BEDA'} ${tabel.padEnd(22)} harapan=${harapan} aktual=${aktual}`);
  }

  const pwDb = new Map((await ambilKolom(url, headers, 'pengguna', 'user_id,password')).map((r) => [r.user_id, r.password]));
  const pwBeda = hasil.pengguna.rows.filter((r) => pwDb.get(r.user_id) !== r.password).length;
  laporan.verifikasi.password = { dicek: hasil.pengguna.rows.length, beda: pwBeda };
  console.log(`  ${pwBeda ? 'BEDA' : 'OK  '} hash password identik dengan sheet: ${hasil.pengguna.rows.length - pwBeda}/${hasil.pengguna.rows.length}`);
  if (pwBeda) gagal++;

  writeFileSync(lapPath, JSON.stringify(laporan, null, 2));
  console.log(gagal ? `\nSelesai dengan ${gagal} ketidakcocokan. Lihat migrasi/laporan-migrasi.json.` : '\nMigrasi selesai, semua verifikasi cocok.');
  if (gagal) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error('Migrasi gagal:', err.message);
    process.exit(1);
  });
}
