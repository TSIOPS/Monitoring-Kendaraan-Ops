import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { hashPassword, verifyPassword } from '../../src/auth/password';
import type { SessionUser } from '../../src/deps';
import { authHeaders, fakeEnv, loginAs, makeDeps, memMaster } from '../helpers';

const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };

async function siap() {
  const master = memMaster({
    pengguna: [{ user_id: 'U-P', username: 'pic', password: await hashPassword('lama123'), nama: 'Pic', role: 'PIC CABANG', kode_cabang: 'CBG-A', status: 'Aktif' }],
  });
  const { deps, kv, audits } = makeDeps({ master: master.repo });
  const app = buildApp(fakeEnv() as any, deps);
  const tok = await loginAs(kv, PIC);
  const ganti = (body: unknown) => app.request('/api/password', {
    method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { master, audits, ganti };
}

describe('POST /api/password (ganti password sendiri)', () => {
  it('berhasil: password tersimpan sebagai hash baru, audit GANTI_PASSWORD', async () => {
    const { master, audits, ganti } = await siap();
    const res = await ganti({ password_lama: 'lama123', password_baru: 'baru4567' });
    expect(res.status).toBe(200);
    const akun = master.state.pengguna[0]!;
    expect(await verifyPassword('baru4567', akun.password)).toBe(true);
    expect(await verifyPassword('lama123', akun.password)).toBe(false);
    expect(audits.some((a) => a.action === 'GANTI_PASSWORD')).toBe(true);
  });

  it('password lama salah -> 403 (sesi tidak dihapus), password tidak berubah', async () => {
    const { master, ganti } = await siap();
    const res = await ganti({ password_lama: 'salah', password_baru: 'baru4567' });
    expect(res.status).toBe(403);
    expect(await verifyPassword('lama123', master.state.pengguna[0]!.password)).toBe(true);
  });

  it('password baru terlalu pendek atau sama dengan lama -> 400', async () => {
    const { ganti } = await siap();
    expect((await ganti({ password_lama: 'lama123', password_baru: '123' })).status).toBe(400);
    expect((await ganti({ password_lama: 'lama123', password_baru: 'lama123' })).status).toBe(400);
  });
});

describe('keamanan sesi & hash', () => {
  it('login dengan hash lama mengganti hash ke PBKDF2', async () => {
    const { iteratedHash } = await import('../../src/auth/password');
    const { memMaster, makeDeps, fakeEnv } = await import('../helpers');
    const { buildApp } = await import('../../src/app');
    const salt = 'abcd1234abcd1234';
    const lama = `${salt}$10$${await iteratedHash(salt, 'rahasia1', 10)}`;
    const m = memMaster({ pengguna: [{ user_id: 'U-9', username: 'budi', nama: 'Budi', role: 'PIC CABANG', kode_cabang: 'CBG-A', status: 'Aktif', password: lama }] });
    const { deps } = makeDeps({ master: m.repo, findByUsername: async (u: string) => (m.state.pengguna.find((p) => p.username === u) as any) ?? null });
    const app = buildApp(fakeEnv() as any, deps);
    const res = await app.request('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'budi', password: 'rahasia1' }) });
    expect(res.status).toBe(200);
    expect(m.state.pengguna[0]!.password.startsWith('pbkdf2$')).toBe(true);
  });

  it('cabutSesiPengguna mencabut sesi lain, sesi yang sedang dipakai tetap', async () => {
    const { createSession, resolveSession, cabutSesiPengguna } = await import('../../src/auth/sessions');
    const { makeDeps } = await import('../helpers');
    const { kv } = makeDeps();
    const u = { user_id: 'U-1', username: 'a', nama: 'A', role: 'PIC CABANG', cabang: 'X', exp: 0 };
    const t1 = await createSession(kv, u);
    const t2 = await createSession(kv, u);
    expect(await cabutSesiPengguna(kv, 'U-1', t2)).toBe(1);
    expect(await resolveSession(kv, t1)).toBeNull();
    expect(await resolveSession(kv, t2)).not.toBeNull();
  });
});
