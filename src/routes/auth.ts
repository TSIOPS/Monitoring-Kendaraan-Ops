import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import { verifyPassword } from '../auth/password';
import { checkRate, resetRate } from '../auth/rateLimit';
import { createSession, destroySession, resolveSession } from '../auth/sessions';
import { requireUser } from '../auth/middleware';
import { errPayload, okPayload } from '../utils/http';

const LOGIN_MAX = 5;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

export function authRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post('/login', async (c) => {
    const body = await c.req.json().catch(() => null);
    const username = String((body as any)?.username ?? '').trim().toLowerCase();
    const password = String((body as any)?.password ?? '');
    if (!username || !password) {
      return c.json(errPayload('Username dan password wajib diisi.', 'BAD_REQUEST'), 400);
    }

    const rate = await checkRate(deps.kv, `login:${username}`, LOGIN_MAX, LOGIN_WINDOW_MS, deps.now);
    if (!rate.allowed) {
      return c.json(errPayload(`Terlalu banyak percobaan login. Tunggu ${rate.retryAfterSec} detik.`, 'RATE_LIMIT'), 429);
    }

    const user = await deps.findByUsername(username);
    if (!user || user.status === 'Non-Aktif' || !(await verifyPassword(password, user.password))) {
      await deps.recordAudit({
        user_id: user?.user_id ?? '-',
        username,
        action: 'LOGIN_GAGAL',
        modul: 'auth',
        keterangan: 'Login gagal: kredensial tidak valid',
      });
      return c.json(errPayload('Username atau password salah.', 'BAD_CREDENTIALS'), 401);
    }

    await resetRate(deps.kv, `login:${username}`);
    const sessionUser = {
      user_id: user.user_id,
      username: user.username,
      nama: user.nama || user.username,
      role: user.role,
      cabang: user.kode_cabang || '',
      exp: deps.now(),
    };
    const token = await createSession(deps.kv, sessionUser, deps.now);
    await deps.recordAudit({
      user_id: user.user_id,
      username: user.username,
      action: 'LOGIN',
      modul: 'auth',
      keterangan: `Login berhasil role=${user.role} cabang=${user.kode_cabang || '-'}`,
    });

    return c.json(
      okPayload({
        token,
        user: {
          user_id: user.user_id,
          username: user.username,
          nama: user.nama || user.username,
          role: user.role,
          cabang: user.kode_cabang || '',
        },
      }),
    );
  });

  app.post('/logout', async (c) => {
    const auth = c.req.header('Authorization') ?? '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : null;
    const u = await resolveSession(deps.kv, token, deps.now);
    if (u) {
      await deps.recordAudit({
        user_id: u.user_id,
        username: u.username,
        action: 'LOGOUT',
        modul: 'auth',
        keterangan: 'Logout',
      });
    }
    await destroySession(deps.kv, token);
    return c.json(okPayload());
  });

  app.get('/session', requireUser(deps), (c) => {
    const u = c.get('user');
    return c.json(okPayload({ user: u }));
  });

  return app;
}