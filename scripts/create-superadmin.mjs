// Membuat akun SUPERADMIN pertama langsung di tabel `pengguna` Supabase.
// Dibutuhkan karena POST /api/master/pengguna hanya bisa dipakai oleh SUPERADMIN.
//
// Jalankan: node scripts/create-superadmin.mjs
// Kredensial Supabase dibaca dari .dev.vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
// Password diketik di terminal (tidak tampil) dan di-hash dengan format yang sama
// seperti src/auth/password.ts: salt$10000$hash.

import { readFileSync } from 'node:fs';
import { webcrypto as crypto } from 'node:crypto';
import readline from 'node:readline';

const PBKDF_ROUNDS = 10000;

function bacaDevVars() {
  const raw = readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
  }
  return env;
}

async function sha256Hex(str) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password) {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  let hex = await sha256Hex(`${salt}:${password}`);
  for (let i = 1; i < PBKDF_ROUNDS; i++) hex = await sha256Hex(`${hex}:${salt}`);
  return `${salt}$${PBKDF_ROUNDS}$${hex}`;
}

function tanya(rl, pertanyaan) {
  return new Promise((resolve) => rl.question(pertanyaan, (j) => resolve(j.trim())));
}

function tanyaRahasia(pertanyaan) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes(pertanyaan)) rl.output.write(s);
    };
    rl.question(pertanyaan, (j) => {
      rl.close();
      process.stdout.write('\n');
      resolve(j);
    });
  });
}

const env = bacaDevVars();
const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY wajib ada di .dev.vars.');
  process.exit(1);
}
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const username = await tanya(rl, 'Username: ');
const nama = (await tanya(rl, 'Nama lengkap: ')) || username;
rl.close();

if (!/^[A-Za-z0-9._-]{3,}$/.test(username)) {
  console.error('Username minimal 3 karakter, hanya huruf, angka, titik, garis bawah, atau strip.');
  process.exit(1);
}

const cek = await fetch(`${url}/rest/v1/pengguna?select=user_id&username=eq.${encodeURIComponent(username)}`, { headers });
if (!cek.ok) {
  console.error('Gagal memeriksa username:', cek.status, await cek.text());
  process.exit(1);
}
if ((await cek.json()).length) {
  console.error(`Username "${username}" sudah ada. Tidak ada yang diubah.`);
  process.exit(1);
}

const password = await tanyaRahasia('Password (min. 8 karakter): ');
const ulang = await tanyaRahasia('Ulangi password: ');
if (password.length < 8) {
  console.error('Password minimal 8 karakter.');
  process.exit(1);
}
if (password !== ulang) {
  console.error('Password tidak sama.');
  process.exit(1);
}

const row = {
  user_id: `U-${Date.now()}-${crypto.randomUUID().slice(0, 4)}`,
  username,
  password: await hashPassword(password),
  nama,
  role: 'SUPERADMIN',
  kode_cabang: '',
  status: 'Aktif',
};

const res = await fetch(`${url}/rest/v1/pengguna`, {
  method: 'POST',
  headers: { ...headers, Prefer: 'return=minimal' },
  body: JSON.stringify(row),
});
if (!res.ok) {
  console.error('Gagal membuat akun:', res.status, await res.text());
  process.exit(1);
}
console.log(`Akun SUPERADMIN "${username}" berhasil dibuat (user_id ${row.user_id}).`);
