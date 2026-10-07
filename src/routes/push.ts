import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppDeps, SessionUser } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { HttpError, okPayload } from '../utils/http';
import { todayWib } from '../logic/jalur';
import { ringkasTugas, teksTugas } from '../logic/tugas';
import { hashEndpoint, kirimPush, type VapidKunci } from '../push/webpush';

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

// Langganan disimpan di KV: push:<hash endpoint> -> data langganan; pushu:<user_id> -> daftar hash.
export interface Langganan { endpoint: string; user_id: string; username: string; role: string; cabang: string; created_at: string }
const kunciSub = (h: string) => `push:${h}`;
const kunciUser = (id: string) => `pushu:${id}`;
const kunciTes = (h: string) => `pushtes:${h}`;

export function vapidDariEnv(env: Env | undefined): VapidKunci | null {
  if (!env?.VAPID_PUBLIC_KEY || !env?.VAPID_PRIVATE_JWK) return null;
  try {
    return { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT || 'https://monitoring.kendaraanoprtsi.workers.dev' };
  } catch {
    return null;
  }
}

const isSuper = (u: Pick<SessionUser, 'role'>) => String(u.role).toUpperCase() === 'SUPERADMIN';

// Tugas hari ini dalam cakupan pengguna (PIC: cabangnya; SUPERADMIN: semua).
export async function tugasUntuk(deps: AppDeps, u: Pick<SessionUser, 'role' | 'cabang'>, tanggal = todayWib()) {
  const cabang = isSuper(u) ? '' : String(u.cabang || '');
  if (!isSuper(u) && !cabang) return ringkasTugas([], tanggal);
  const rows = await deps.jalur.listForDate(tanggal, cabang || null);
  return ringkasTugas(rows, tanggal, cabang);
}

export function pushRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/tugas-hari-ini', requireUser(deps), async (c: Ctx) => {
    return c.json(okPayload({ ...(await tugasUntuk(deps, c.get('user'))) }));
  });

  app.get('/push/kunci', (c) => {
    const v = vapidDariEnv(c.env as Env);
    return c.json(okPayload({ aktif: Boolean(v), publicKey: v?.publicKey ?? '' }));
  });

  app.post('/push/langganan', requireUser(deps), async (c: Ctx) => {
    const u = c.get('user');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const endpoint = String(body.endpoint ?? '');
    if (!/^https:\/\/[^\s]+$/.test(endpoint) || endpoint.length > 1000) throw new HttpError(400, 'Langganan notifikasi tidak valid.', 'BAD_REQUEST');
    const h = await hashEndpoint(endpoint);
    const data: Langganan = { endpoint, user_id: u.user_id, username: u.username, role: u.role, cabang: u.cabang || '', created_at: new Date().toISOString() };
    await deps.kv.put(kunciSub(h), JSON.stringify(data));
    const daftar = ((await deps.kv.get(kunciUser(u.user_id), 'json')) as string[] | null) ?? [];
    if (!daftar.includes(h)) await deps.kv.put(kunciUser(u.user_id), JSON.stringify([...daftar, h].slice(-10)));
    return c.json(okPayload({ msg: 'Notifikasi aktif di perangkat ini.' }));
  });

  app.post('/push/berhenti', requireUser(deps), async (c: Ctx) => {
    const u = c.get('user');
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const h = await hashEndpoint(String(body.endpoint ?? ''));
    const sub = (await deps.kv.get(kunciSub(h), 'json')) as Langganan | null;
    if (sub && sub.user_id === u.user_id) await deps.kv.delete(kunciSub(h));
    const daftar = ((await deps.kv.get(kunciUser(u.user_id), 'json')) as string[] | null) ?? [];
    await deps.kv.put(kunciUser(u.user_id), JSON.stringify(daftar.filter((x) => x !== h)));
    return c.json(okPayload({ msg: 'Notifikasi dimatikan di perangkat ini.' }));
  });

  // Kirim notifikasi uji ke semua perangkat milik pengguna ini.
  app.post('/push/tes', requireUser(deps), async (c: Ctx) => {
    const u = c.get('user');
    const v = vapidDariEnv(c.env as Env);
    if (!v) throw new HttpError(503, 'Notifikasi belum dikonfigurasi di server.', 'UNAVAILABLE');
    const daftar = ((await deps.kv.get(kunciUser(u.user_id), 'json')) as string[] | null) ?? [];
    let terkirim = 0;
    for (const h of daftar) {
      const sub = (await deps.kv.get(kunciSub(h), 'json')) as Langganan | null;
      if (!sub) continue;
      await deps.kv.put(kunciTes(h), '1', { expirationTtl: 120 });
      const r = await kirimPush(sub.endpoint, v);
      if (r.hapus) await deps.kv.delete(kunciSub(h));
      else if (r.status < 300) terkirim++;
    }
    if (!terkirim) throw new HttpError(404, 'Belum ada perangkat yang aktif. Tekan "Aktifkan notifikasi" dulu di perangkat ini.', 'NOT_FOUND');
    return c.json(okPayload({ msg: `Notifikasi uji dikirim ke ${terkirim} perangkat.` }));
  });

  // Dipanggil service worker setelah menerima push (tanpa sesi; endpoint langganan = kunci rahasia).
  app.get('/push/ringkasan', async (c) => {
    const endpoint = String(c.req.query('endpoint') ?? '');
    const h = await hashEndpoint(endpoint);
    const sub = (await deps.kv.get(kunciSub(h), 'json')) as Langganan | null;
    if (!sub || sub.endpoint !== endpoint) return c.json(okPayload({ judul: 'Monitoring Kendaraan', isi: 'Buka aplikasi untuk melihat tugas hari ini.', url: '/#/dashboard' }));
    const tes = await deps.kv.get(kunciTes(h));
    const t = await tugasUntuk(deps, { role: sub.role, cabang: sub.cabang });
    const ringkas = teksTugas(t);
    if (tes) {
      await deps.kv.delete(kunciTes(h));
      return c.json(okPayload({ judul: '✅ Tes notifikasi berhasil', isi: ringkas ? `Hari ini: ${ringkas}.` : 'Tidak ada laporan/rekonsiliasi tertunda hari ini.', url: '/#/dashboard' }));
    }
    return c.json(okPayload({
      judul: '⚠️ Selesaikan sebelum 17:00',
      isi: ringkas ? `Hari ini ${ringkas}. Segera input laporan / rekonsiliasi.` : 'Semua laporan & rekonsiliasi hari ini sudah selesai.',
      url: '/#/dashboard',
    }));
  });

  return app;
}

// ── Pengingat terjadwal 16:30 WIB (Cron 09:30 UTC) ──────────────────────────
export interface KvDaftar { list(opts: { prefix: string; cursor?: string }): Promise<{ keys: Array<{ name: string }>; list_complete: boolean; cursor?: string }> }

export async function kirimPengingatHarian(deps: AppDeps, kvDaftar: KvDaftar, vapid: VapidKunci, fetcher: typeof fetch = fetch, tanggal = todayWib()) {
  const subs: Array<[string, Langganan]> = [];
  let cursor: string | undefined;
  do {
    const res = await kvDaftar.list({ prefix: 'push:', cursor });
    for (const k of res.keys) {
      const s = (await deps.kv.get(k.name, 'json')) as Langganan | null;
      if (s) subs.push([k.name, s]);
    }
    cursor = res.list_complete ? undefined : res.cursor;
  } while (cursor);

  const cache = new Map<string, number>();
  const hitung = async (s: Langganan) => {
    const kunci = isSuper(s) ? '*' : s.cabang;
    if (!cache.has(kunci)) {
      const t = await tugasUntuk(deps, { role: s.role, cabang: s.cabang }, tanggal);
      cache.set(kunci, t.laporan + t.rekonsiliasi);
    }
    return cache.get(kunci)!;
  };
  let terkirim = 0;
  let dihapus = 0;
  for (const [kunci, s] of subs) {
    if ((await hitung(s)) === 0) continue;
    try {
      const r = await kirimPush(s.endpoint, vapid, fetcher);
      if (r.hapus) { await deps.kv.delete(kunci); dihapus++; } else if (r.status < 300) terkirim++;
    } catch {
      // satu perangkat gagal tidak menghentikan yang lain
    }
  }
  return { langganan: subs.length, terkirim, dihapus };
}
