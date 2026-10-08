import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, makeDeps, memAudit, loginAs } from '../helpers';
import type { AuditRow, SessionUser } from '../../src/deps';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

const ROWS: AuditRow[] = [
  { log_id: 'LOG-2', timestamp: '2026-09-19T01:00:00.000Z', user_id: 'U-S', username: 'super', action: 'CREATE', modul: 'master', keterangan: 'Cabang CBG-X', data_sebelum: '', data_sesudah: '{}', ip: '1.2.3.4' },
  { log_id: 'LOG-1', timestamp: '2026-09-19T00:00:00.000Z', user_id: 'U-S', username: 'super', action: 'LOGIN', modul: 'auth', keterangan: 'Login berhasil', data_sebelum: '', data_sesudah: '', ip: '1.2.3.4' },
];

describe('audit routes', () => {
  it('SUPERADMIN membaca audit terurut terbaru dulu, limit bekerja', async () => {
    const { deps, kv } = makeDeps({ ...memAudit(ROWS) });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, SUPER);
    const res = await app.request('/api/audit?limit=1', { headers: authHeaders(tok) });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.items.length).toBe(1);
    expect(body.items[0].log_id).toBe('LOG-2');
  });

  it('PIC ditolak 403', async () => {
    const { deps, kv } = makeDeps({ ...memAudit(ROWS) });
    const app = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(kv, PIC);
    const res = await app.request('/api/audit', { headers: authHeaders(tok) });
    expect(res.status).toBe(403);
  });

  it('tanpa token => 401', async () => {
    const { deps } = makeDeps();
    const app = buildApp(fakeEnv() as any, deps);
    const res = await app.request('/api/audit', { method: 'GET' });
    expect(res.status).toBe(401);
  });
});
describe('audit filter', () => {
  const R = (over: Partial<AuditRow>): AuditRow => ({ log_id: 'L', timestamp: '2026-10-08T01:00:00.000Z', user_id: 'U', username: 'snd_2', action: 'DETACH', modul: 'transaksi', keterangan: '', data_sebelum: '', data_sesudah: '', ip: '', ...over });
  const rows = [
    R({ log_id: 'A', timestamp: '2026-10-08T00:10:00.000Z' }),
    R({ log_id: 'B', timestamp: '2026-10-07T16:59:00.000Z', username: 'hajieko', action: 'CREATE', modul: 'flazz' }), // 07/10 23:59 WIB
    R({ log_id: 'C', timestamp: '2026-10-07T17:00:00.000Z', action: 'LOGIN', modul: 'auth' }), // 08/10 00:00 WIB
  ];
  const ambil = async (qs: string) => {
    const { deps, kv } = makeDeps({ ...memAudit(rows) });
    const app = buildApp(fakeEnv() as any, deps);
    const res = await app.request('/api/audit' + qs, { headers: authHeaders(await loginAs(kv, SUPER)) });
    return ((await res.json()) as any).items.map((x: AuditRow) => x.log_id);
  };
  it('login disembunyikan kecuali login=1', async () => {
    expect(await ambil('')).toEqual(['A', 'B']);
    expect(await ambil('?login=1')).toEqual(['A', 'B', 'C']);
  });
  it('filter pengguna, modul, aksi', async () => {
    expect(await ambil('?username=hajieko')).toEqual(['B']);
    expect(await ambil('?modul=transaksi&action=detach')).toEqual(['A']);
  });
  it('rentang tanggal memakai hari WIB', async () => {
    expect(await ambil('?dari=2026-10-08&sampai=2026-10-08&login=1')).toEqual(['A', 'C']);
    expect(await ambil('?dari=2026-10-07&sampai=2026-10-07')).toEqual(['B']);
  });
});
