import { Hono } from 'hono';
import type { AppDeps } from '../deps';
import { hashPassword, perluRehash, verifyPassword } from '../auth/password';
import { checkRate, resetRate } from '../auth/rateLimit';
import { cabutSesiPengguna, createSession, destroySession, resolveSession } from '../auth/sessions';
import { requireUser } from '../auth/middleware';
import { errPayload, okPayload, reqIp } from '../utils/http';

const LOGIN_MAX = 5;
const LOGIN_IP_MAX = 30;
const PASSWORD_MIN = 6;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;

export function authRoutes(deps: AppDeps): Hono {
  const app = new Hono();

  app.post('/login', async (c) => {
    const body = await c.req.json().catch(() => null);
    const ip = reqIp(c);
    const username = String((body as any)?.username ?? '').trim().toLowerCase();
    const password = String((body as any)?.password ?? '');
    if (!username || !password) {
      return c.json(errPayload('Username dan password wajib diisi.', 'BAD_REQUEST'), 400);
    }

    // Lapis 1: per string input (perilaku lama) + per IP, sebelum menyentuh DB.
    const rate = await checkRate(deps.kv, `login:${username}`, LOGIN_MAX, LOGIN_WINDOW_MS, deps.now);
    const rateIp = ip ? await checkRate(deps.kv, `login-ip:${ip}`, LOGIN_IP_MAX, LOGIN_WINDOW_MS, deps.now) : rate;
    const tolak = !rate.allowed ? rate : !rateIp.allowed ? rateIp : null;
    if (tolak) {
      return c.json(errPayload(`Terlalu banyak percobaan login. Tunggu ${tolak.retryAfterSec} detik.`, 'RATE_LIMIT'), 429);
    }

    const user = await deps.findByUsername(username);
    // Lapis 2: per akun hasil lookup — variasi penulisan username tidak memberi jatah baru.
    if (user) {
      const rateAkun = await checkRate(deps.kv, `login-akun:${user.user_id}`, LOGIN_MAX, LOGIN_WINDOW_MS, deps.now);
      if (!rateAkun.allowed) {
        return c.json(errPayload(`Terlalu banyak percobaan login. Tunggu ${rateAkun.retryAfterSec} detik.`, 'RATE_LIMIT'), 429);
      }
    }
    if (!user || user.status === 'Non-Aktif' || !(await verifyPassword(password, user.password))) {
      await deps.recordAudit({
        user_id: user?.user_id ?? '-',
        username,
        action: 'LOGIN_GAGAL',
        modul: 'auth',
        keterangan: 'Login gagal: kredensial tidak valid',
        ip,
      });
      return c.json(errPayload('Username atau password salah.', 'BAD_CREDENTIALS'), 401);
    }

    // Counter IP sengaja TIDAK di-reset: penyerang yang punya satu akun sah tidak boleh bisa
    // memulihkan jatah IP-nya dengan login berhasil di sela tebakan.
    await resetRate(deps.kv, `login:${username}`);
    await resetRate(deps.kv, `login-akun:${user.user_id}`);
    // Hash lama (warisan GAS) diganti PBKDF2 begitu password terbukti benar; gagal simpan tidak menggagalkan login.
    if (perluRehash(user.password)) {
      try {
        const akun = await deps.master.findPenggunaById(user.user_id);
        if (akun) await deps.master.updatePengguna({ ...akun, password: await hashPassword(password) });
      } catch (e) {
        console.warn('rehash password gagal:', (e as Error).message);
      }
    }
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
      ip,
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
        ip: reqIp(c),
      });
    }
    await destroySession(deps.kv, token);
    return c.json(okPayload());
  });

  // Ganti password sendiri (semua role). 403 (bukan 401) saat password lama salah,
  // agar klien tidak menghapus sesi yang masih sah.
  app.post('/password', requireUser(deps), async (c) => {
    const u = c.get('user');
    const rate = await checkRate(deps.kv, `pwd:${u.user_id}`, 5, 10 * 60 * 1000, deps.now);
    if (!rate.allowed) return c.json(errPayload(`Terlalu banyak percobaan. Tunggu ${rate.retryAfterSec} detik.`, 'RATE_LIMIT'), 429);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const lama = String(body.password_lama ?? '');
    const baru = String(body.password_baru ?? '');
    if (baru.length < PASSWORD_MIN) return c.json(errPayload(`Password baru minimal ${PASSWORD_MIN} karakter.`, 'BAD_REQUEST'), 400);
    if (baru === lama) return c.json(errPayload('Password baru harus berbeda dari password lama.', 'BAD_REQUEST'), 400);
    const akun = await deps.master.findPenggunaById(u.user_id);
    if (!akun || akun.status === 'Non-Aktif') return c.json(errPayload('Akun tidak ditemukan atau nonaktif.', 'FORBIDDEN'), 403);
    if (!(await verifyPassword(lama, akun.password))) {
      await deps.recordAudit({ user_id: u.user_id, username: u.username, action: 'GANTI_PASSWORD_GAGAL', modul: 'auth', keterangan: 'Password lama salah', ip: reqIp(c) });
      return c.json(errPayload('Password lama salah.', 'FORBIDDEN'), 403);
    }
    await deps.master.updatePengguna({ ...akun, password: await hashPassword(baru) });
    // Perangkat lain yang masih login dengan password lama dikeluarkan; sesi ini tetap.
    const auth = c.req.header('Authorization') ?? '';
    await cabutSesiPengguna(deps.kv, u.user_id, auth.startsWith('Bearer ') ? auth.slice(7).trim() : '');
    await resetRate(deps.kv, `pwd:${u.user_id}`);
    await deps.recordAudit({ user_id: u.user_id, username: u.username, action: 'GANTI_PASSWORD', modul: 'auth', keterangan: 'Ganti password sendiri', ip: reqIp(c) });
    return c.json(okPayload({ msg: 'Password berhasil diganti. Perangkat lain yang masih login otomatis dikeluarkan.' }));
  });

  app.get('/session', requireUser(deps), (c) => {
    const u = c.get('user');
    return c.json(okPayload({ user: u }));
  });

  return app;
}