import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import type { UserRecord } from '../src/deps';
import { hashPassword } from '../src/auth/password';
import { fakeEnv, makeDeps } from './helpers';

const PIC_USER: UserRecord = {
  user_id: 'U-1',
  username: 'picjkt',
  password: '',
  nama: 'PIC Jakarta',
  role: 'PIC CABANG',
  kode_cabang: 'CBG-JKT',
  status: 'Aktif',
};

async function login(app: ReturnType<typeof buildApp>, username: string, password: string) {
  const res = await app.request('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  return { res, body: (await res.json()) as any };
}

describe('auth routes', () => {
  it('login sukses mengembalikan token dan user', async () => {
    const cryptoHash = await hashPassword('rahasia123');
    const { deps } = makeDeps({ findByUsername: async (u) => (u === 'picjkt' ? { ...PIC_USER, password: cryptoHash } : null) });
    const app = buildApp(fakeEnv(), deps);
    const { res, body } = await login(app, 'picjkt', 'rahasia123');
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.token).toBe('string');
    expect(body.user).toMatchObject({ user_id: 'U-1', role: 'PIC CABANG', cabang: 'CBG-JKT' });
  });

  it('login salah password => gagal, tercatat audit LOGIN_GAGAL', async () => {
    const cryptoHash = await hashPassword('rahasia123');
    const { deps, audits } = makeDeps({ findByUsername: async (u) => (u === 'picjkt' ? { ...PIC_USER, password: cryptoHash } : null) });
    const app = buildApp(fakeEnv(), deps);
    const { res } = await login(app, 'picjkt', 'salah');
    expect(res.status).toBe(401);
    expect(audits.some((a) => a.action === 'LOGIN_GAGAL')).toBe(true);
  });

  it('login user Non-Aktif ditolak', async () => {
    const cryptoHash = await hashPassword('rahasia123');
    const { deps } = makeDeps({
      findByUsername: async () => ({ ...PIC_USER, password: cryptoHash, status: 'Non-Aktif' }),
    });
    const app = buildApp(fakeEnv(), deps);
    const { res } = await login(app, 'picjkt', 'rahasia123');
    expect(res.status).toBe(401);
  });

  it('login melebihi rate limit diblokir', async () => {
    const { deps } = makeDeps({ findByUsername: async () => null });
    const app = buildApp(fakeEnv(), deps);
    for (let i = 0; i < 5; i++) await login(app, 'picjkt', 'x');
    const { res, body } = await login(app, 'picjkt', 'x');
    expect(res.status).toBe(429);
    expect(body.success).toBe(false);
    expect(body.error).toBe('RATE_LIMIT');
  });

  it('variasi penulisan username tidak menambah jatah percobaan untuk akun yang sama', async () => {
    const cryptoHash = await hashPassword('rahasia123');
    const { deps } = makeDeps({ findByUsername: async () => ({ ...PIC_USER, password: cryptoHash }) });
    const app = buildApp(fakeEnv(), deps);
    const variasi = ['picjkt', 'picjk_', 'pic_kt', '_icjkt', 'p_cjkt'];
    for (const v of variasi) await login(app, v, 'salah');
    const { res, body } = await login(app, 'pi_jkt', 'salah');
    expect(res.status).toBe(429);
    expect(body.error).toBe('RATE_LIMIT');
  });

  it('akun terkunci tetap terkunci walau password benar sampai jendela habis', async () => {
    const cryptoHash = await hashPassword('rahasia123');
    const { deps } = makeDeps({ findByUsername: async () => ({ ...PIC_USER, password: cryptoHash }) });
    const app = buildApp(fakeEnv(), deps);
    for (let i = 0; i < 5; i++) await login(app, `v${i}`, 'salah');
    const { res } = await login(app, 'picjkt', 'rahasia123');
    expect(res.status).toBe(429);
  });

  it('username dengan karakter wildcard ditolak sebagai kredensial salah', async () => {
    const { deps } = makeDeps({ findByUsername: async () => null });
    const app = buildApp(fakeEnv(), deps);
    const { res } = await login(app, '%', 'x');
    expect(res.status).toBe(401);
  });

  it('rate limit per IP: 30 percobaan dengan username berbeda boleh, ke-31 diblokir', async () => {
    const { deps } = makeDeps({ findByUsername: async () => null });
    const app = buildApp(fakeEnv(), deps);
    const dariIp = (username: string) => app.request('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '1.2.3.4' },
      body: JSON.stringify({ username, password: 'x' }),
    });
    for (let i = 0; i < 30; i++) expect((await dariIp(`user${i}`)).status).toBe(401);
    const res = await dariIp('user-baru');
    expect(res.status).toBe(429);
    expect(((await res.json()) as any).error).toBe('RATE_LIMIT');
  });

  it('GET /api/session valid dengan Bearer token', async () => {
    const cryptoHash = await hashPassword('rahasia123');
    const { deps } = makeDeps({ findByUsername: async (u) => (u === 'picjkt' ? { ...PIC_USER, password: cryptoHash } : null) });
    const app = buildApp(fakeEnv(), deps);
    const { body } = await login(app, 'picjkt', 'rahasia123');
    const res = await app.request('/api/session', {
      method: 'GET',
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(res.status).toBe(200);
    const data = (await res.json()) as { user?: { username?: string } };
    expect(data?.user?.username).toBe('picjkt');
  });

  it('GET /api/session tanpa token => 401', async () => {
    const { deps } = makeDeps();
    const app = buildApp(fakeEnv(), deps);
    const res = await app.request('/api/session', { method: 'GET' });
    expect(res.status).toBe(401);
  });

  it('logout membatalkan session', async () => {
    const cryptoHash = await hashPassword('rahasia123');
    const { deps } = makeDeps({ findByUsername: async (u) => (u === 'picjkt' ? { ...PIC_USER, password: cryptoHash } : null) });
    const app = buildApp(fakeEnv(), deps);
    const { body } = await login(app, 'picjkt', 'rahasia123');
    await app.request('/api/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${body.token}` },
    });
    const res = await app.request('/api/session', {
      method: 'GET',
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(res.status).toBe(401);
  });
});