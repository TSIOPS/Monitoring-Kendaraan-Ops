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
