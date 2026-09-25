import { readFileSync } from 'node:fs';
import pg from 'pg';

const { Client } = pg;

const ref = process.env.SB_DB_REF ?? 'jscpogjdquwcbglavurd';
const host = process.env.SB_DB_HOST ?? `aws-0-ap-south-1.pooler.supabase.com`;
const port = Number(process.env.SB_DB_PORT ?? 5432);
const user = process.env.SB_DB_USER ?? `postgres.${ref}`;
const database = process.env.SB_DB_NAME ?? 'postgres';
const password = process.env.SB_DB_PASSWORD ?? '';

if (!password) {
  console.error('Set env SB_DB_PASSWORD dulu sebelum menjalankan script.');
  process.exit(1);
}

const sql = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');

const client = new Client({ host, port, user, database, password, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();
  console.log(`Terhubung ke ${host}:${port}/${database}`);
  await client.query(sql);
  console.log('db/schema.sql berhasil dieksekusi.');
} catch (err) {
  console.error('Gagal menerapkan schema:', err);
  process.exitCode = 1;
} finally {
  await client.end();
}