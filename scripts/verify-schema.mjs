import pg from 'pg';

const c = new pg.Client({
  host: process.env.SB_DB_HOST,
  port: Number(process.env.SB_DB_PORT ?? 5432),
  user: process.env.SB_DB_USER,
  password: process.env.SB_DB_PASSWORD,
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const t = await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`);
console.log('TABLES:', t.rows.map((r) => r.tablename).join(', '));
const s = await c.query('SELECT count(*)::int AS n FROM pengaturan');
console.log('pengaturan rows:', s.rows[0].n);
await c.end();