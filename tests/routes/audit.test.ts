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