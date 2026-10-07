// Cadangkan semua tabel Supabase ke migrasi/cadangan-<waktu>/<tabel>.json (baca saja).
//   node scripts/cadangan-db.mjs
// Folder migrasi/ di-gitignore (berisi data pribadi & hash password).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const TABEL = ['cabang', 'supir', 'bbm', 'pengguna', 'kendaraan', 'penggunaan_bbm', 'pengisian_bbm', 'foto_evidence', 'audit_log',
  'konfigurasi', 'pengaturan', 'flazz_card', 'flazz_usage', 'flazz_topup', 'flazz_tol', 'flazz_reconciliation', 'jalur_pengiriman'];

const env = {};
for (const line of readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').split(/\r?\n/)) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
  if (m) env[m[1]] = m[2].trim().replace(/^"|"$/g, '');
}
const h = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` };
const waktu = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = new URL(`../migrasi/cadangan-${waktu}/`, import.meta.url);
mkdirSync(dir, { recursive: true });

let total = 0;
for (const t of TABEL) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${t}?select=*`, { headers: { ...h, Range: `${from}-${from + 999}` } });
    if (!res.ok) throw new Error(`${t}: ${res.status} ${await res.text()}`);
    const page = await res.json();
    rows.push(...page);
    if (page.length < 1000) break;
  }
  writeFileSync(new URL(`${t}.json`, dir), JSON.stringify(rows));
  total += rows.length;
  console.log(`${t.padEnd(22)} ${rows.length}`);
}
console.log(`Cadangan selesai: ${total} baris -> migrasi/cadangan-${waktu}/`);
