// Impor data kas kecil dari Excel lama (kas <cabang>.xlsb) ke Supabase.
//   node scripts/impor-kas-kecil.mjs "D:/test/run/kas Karawang.xlsb" KWG            -> DRY-RUN (hanya laporan, tidak menulis)
//   node scripts/impor-kas-kecil.mjs "D:/test/run/kas Karawang.xlsb" KWG --apply    -> tulis ke database
// Opsi: --tanpa-saldo (jangan atur saldo awal) | --timpa-saldo (timpa saldo awal yang sudah ada).
// Aman dijalankan berulang: baris dengan nomor yang sudah ada dilewati (tidak ditimpa).
// Prasyarat --apply: db/kas-kecil.sql sudah dijalankan. Dry-run tidak memerlukan koneksi database.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');

const [, , berkas, kode, ...opsi] = process.argv;
if (!berkas || !kode) {
  console.error('Pemakaian: node scripts/impor-kas-kecil.mjs <berkas.xlsb> <KODE_CABANG> [--apply] [--tanpa-saldo] [--timpa-saldo]');
  process.exit(1);
}
const apply = opsi.includes('--apply');

// ── Baca Excel ──────────────────────────────────────────────────────────────
const wb = XLSX.read(readFileSync(berkas), { type: 'buffer', cellFormula: false });
const sheet = (n) => {
  if (!wb.Sheets[n]) throw new Error(`Sheet "${n}" tidak ada di ${berkas}`);
  const akhir = XLSX.utils.decode_range(wb.Sheets[n]['!ref'] || 'A1').e.r;
  if (akhir > 100000) throw new Error(`Sheet "${n}" terlalu besar (${akhir} baris).`);
  return XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, range: { s: { r: 3, c: 0 }, e: { r: akhir, c: 30 } }, defval: '' });
};
const KUNCI_PECAHAN = { 11: '100000', 12: '50000', 13: '20000', 14: '10000', 15: '5000', 16: '2000', 17: '1000', 18: 'K1000', 19: '500', 20: '200', 21: '100', 22: '50' };
const str = (v) => String(v ?? '').trim();
const angka = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const tanggal = (serial) => (typeof serial === 'number' && serial > 40000 ? new Date(Math.round((serial - 25569) * 86400000)).toISOString().slice(0, 10) : '');
const jam = (v) => {
  if (typeof v === 'number') { const d = Math.round(v * 86400); return [Math.floor(d / 3600), Math.floor((d % 3600) / 60), d % 60].map((x) => String(x).padStart(2, '0')).join(':'); }
  const m = /^(\d{1,2})[.:](\d{2})[.:](\d{2})/.exec(str(v));
  return m ? `${m[1].padStart(2, '0')}:${m[2]}:${m[3]}` : '00:00:00';
};
const pecahan = (r) => {
  const out = {};
  for (const [c, k] of Object.entries(KUNCI_PECAHAN)) { const n = Math.floor(angka(r[c])); if (n > 0) out[k] = n; }
  return out;
};

// ── Master jenis (dari seed db/kas-kecil.sql; tidak perlu koneksi DB) ───────
const seed = readFileSync(new URL('../db/kas-kecil.sql', import.meta.url), 'utf8');
const norm = (s) => str(s).toLowerCase().replace(/\s+/g, ' ');
const jenisByNama = new Map();
for (const m of seed.matchAll(/\('(KJ-\d+)', '([^']*)', '((?:[^']|'')*)', '([^']*)', '([^']*)', (true|false)/g)) {
  jenisByNama.set(norm(m[3].replace(/''/g, "'")), { id: m[1], kode_akun: m[2], nama: m[3].replace(/''/g, "'"), tanpa: m[6] === 'true' });
}
jenisByNama.set('setor tunai kas kecil', jenisByNama.get('setoran tunai kas kecil'));

// ── Susun baris ─────────────────────────────────────────────────────────────
const rowsKeluar = sheet('List Kas Keluar').filter((r) => str(r[4]).startsWith('KK-'));
const rowsMasuk = sheet('List Kas Masuk').filter((r) => str(r[4]).startsWith('KK-'));
const masukByKK = new Map(rowsMasuk.map((r) => [str(r[4]), r]));
const peringatan = [];

const keluar = [];
const masuk = [];
const idKeluar = new Set(rowsKeluar.map((r) => str(r[4])));
for (const r of rowsKeluar) {
  const id = str(r[4]);
  const nama = str(r[10]);
  const j = jenisByNama.get(norm(nama));
  if (!j) peringatan.push(`Jenis tidak dikenal "${nama || '(kosong)'}" pada ${id} (jumlah ${angka(r[23])}) — diimpor tanpa jenis_id.`);
  const m = masukByKK.get(id);
  const kembali = m ? angka(m[24]) : 0;
  const nomorKM = m ? str(m[6]) : '';
  const tutup = str(r[27]) === 'Closed' || Boolean(j?.tanpa);
  const row = {
    id, kode_cabang: kode, tanggal: tanggal(r[2]), jam: jam(r[3]), no_referensi: str(r[5]), penerima: str(r[7]), admin: str(r[25]),
    jenis_id: j?.id ?? '', kode_akun: str(r[9]) || j?.kode_akun || '', jenis: nama, pecahan: pecahan(r), jumlah: angka(r[23]),
    keterangan: str(r[26]).slice(0, 300), status: tutup ? 'Closed' : 'Open', no_kas_masuk: '', created_by: 'impor', created_at: new Date().toISOString(), is_deleted: '',
  };
  if (!row.tanggal) { peringatan.push(`Tanggal kosong pada ${id} — dilewati.`); continue; }
  if (m && (kembali > 0 || nomorKM)) {
    row.status = 'Closed'; // punya penyelesaian = selesai
    const idKM = nomorKM || id.replace(/^KK-/, 'KM-');
    row.no_kas_masuk = idKM;
    masuk.push({
      id: idKM, kode_cabang: kode, tanggal: tanggal(m[2]) || row.tanggal, jam: jam(m[3]), no_kas_keluar: id, no_referensi: row.no_referensi, penerima: row.penerima,
      admin: str(m[25]) || row.admin, jenis_id: row.jenis_id, kode_akun: row.kode_akun, jenis: nama, pecahan: pecahan(m), jumlah: kembali, keterangan: '',
      created_by: 'impor', created_at: new Date().toISOString(), is_deleted: '',
    });
  }
  keluar.push(row);
}
// KM tanpa KK di daftar keluar = tambah saldo.
for (const r of rowsMasuk) {
  if (idKeluar.has(str(r[4]))) continue;
  peringatan.push(`Kas masuk ${str(r[6]) || str(r[4])} tidak punya kas keluar di daftar — diimpor sebagai Tambah Saldo (${angka(r[24])}).`);
  if (angka(r[24]) > 0 && str(r[6])) {
    masuk.push({
      id: str(r[6]), kode_cabang: kode, tanggal: tanggal(r[2]), jam: jam(r[3]), no_kas_keluar: '', no_referensi: str(r[5]), penerima: str(r[7]), admin: str(r[25]),
      jenis_id: jenisByNama.get('tambah saldo')?.id ?? '', kode_akun: '', jenis: 'Tambah Saldo', pecahan: pecahan(r), jumlah: angka(r[24]), keterangan: '',
      created_by: 'impor', created_at: new Date().toISOString(), is_deleted: '',
    });
  }
}

// ── Saldo: cocokkan dengan "Laporan Kas Kecil" ──────────────────────────────
const lap = XLSX.utils.sheet_to_json(wb.Sheets['Laporan Kas Kecil'], { header: 1, range: { s: { r: 0, c: 0 }, e: { r: 12, c: 14 } }, defval: '' });
const tglLaporan = tanggal(lap[1]?.[11]);
const saldoAwalHari = angka(lap[10]?.[11]); // L11 = saldo awal pada tanggal laporan
const saldoAkhirFile = angka(lap[6]?.[5]); // F7
const sum = (a, f) => a.reduce((n, x) => n + f(x), 0);
const sebelum = (a) => a.filter((x) => x.tanggal < tglLaporan);
const bersihSebelum = sum(sebelum(masuk), (x) => x.jumlah) - sum(sebelum(keluar), (x) => x.jumlah);
const tglMulai = [...keluar, ...masuk].map((x) => x.tanggal).sort()[0] ?? tglLaporan;
const saldoAwalImpor = saldoAwalHari - bersihSebelum; // saldo pada tglMulai agar saldo di tglLaporan sama dengan Excel
const saldoAkhirHitung = saldoAwalImpor
  + sum(masuk.filter((x) => x.tanggal <= tglLaporan), (x) => x.jumlah) - sum(keluar.filter((x) => x.tanggal <= tglLaporan), (x) => x.jumlah);

console.log(`\n== Impor kas kecil ${kode} dari ${berkas} (${apply ? 'APPLY' : 'DRY-RUN'}) ==`);
console.log(`Kas keluar : ${keluar.length} baris, total Rp ${sum(keluar, (x) => x.jumlah).toLocaleString('id-ID')} (Open: ${keluar.filter((x) => x.status === 'Open').length})`);
console.log(`Kas masuk  : ${masuk.length} baris, total Rp ${sum(masuk, (x) => x.jumlah).toLocaleString('id-ID')}`);
console.log(`Rentang    : ${tglMulai} s.d. ${[...keluar, ...masuk].map((x) => x.tanggal).sort().at(-1) ?? '-'}`);
console.log(`Saldo awal diusulkan: Rp ${saldoAwalImpor.toLocaleString('id-ID')} per ${tglMulai}`);
console.log(`Cek saldo tanggal ${tglLaporan}: hitung Rp ${saldoAkhirHitung.toLocaleString('id-ID')} vs Excel Rp ${saldoAkhirFile.toLocaleString('id-ID')} -> ${saldoAkhirHitung === saldoAkhirFile ? 'SESUAI' : 'BEDA (periksa sebelum --apply)'}`);
if (peringatan.length) { console.log(`\nPeringatan (${peringatan.length}):`); peringatan.slice(0, 40).forEach((p) => console.log(' -', p)); }
if (!apply) { console.log('\nDry-run selesai. Tambahkan --apply untuk menulis ke database.'); process.exit(0); }

// ── Tulis ke Supabase ───────────────────────────────────────────────────────
const env = {};
for (const line of readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' };
async function sisip(tabel, rows) {
  let baru = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${tabel}`, { method: 'POST', headers: { ...h, Prefer: 'resolution=ignore-duplicates,return=representation' }, body: JSON.stringify(rows.slice(i, i + 200)) });
    if (!res.ok) throw new Error(`${tabel}: ${res.status} ${await res.text()}`);
    baru += (await res.json()).length;
  }
  console.log(`${tabel}: ${baru} baru, ${rows.length - baru} sudah ada (dilewati).`);
}
await sisip('kas_keluar', keluar);
await sisip('kas_masuk', masuk);
if (!opsi.includes('--tanpa-saldo')) {
  const ada = await (await fetch(`${env.SUPABASE_URL}/rest/v1/kas_saldo_awal?kode_cabang=eq.${encodeURIComponent(kode)}&select=*`, { headers: h })).json();
  if (ada.length && !opsi.includes('--timpa-saldo')) console.log('Saldo awal sudah ada — tidak ditimpa (pakai --timpa-saldo bila perlu).');
  else {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/kas_saldo_awal?on_conflict=kode_cabang`, { method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify({ kode_cabang: kode, tanggal: tglMulai, jumlah: saldoAwalImpor }) });
    if (!res.ok) throw new Error(`kas_saldo_awal: ${res.status} ${await res.text()}`);
    console.log(`Saldo awal diatur: Rp ${saldoAwalImpor.toLocaleString('id-ID')} per ${tglMulai}.`);
  }
}
console.log('Selesai.');
