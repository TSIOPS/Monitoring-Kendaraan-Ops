import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppDeps } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { errPayload, HttpError, okPayload } from '../utils/http';
import { uploadLogo } from '../db/storage';
import { SETTINGS_DEFAULTS } from '../db/settings';

const MAX_LOGO_BYTES = 10 * 1024 * 1024;

const IMAGE_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

export function settingsRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/', async (c) => {
    const s = await deps.settings.getAll();
    return c.json(okPayload({
      logo_url: s.logo_url ?? '',
      app_name: s.app_name ?? SETTINGS_DEFAULTS.app_name,
      company_name: s.company_name ?? SETTINGS_DEFAULTS.company_name,
      footer_text: s.footer_text ?? '',
    }));
  });

  app.put('/', requireUser(deps), async (c) => {
    const u = c.get('user');
    if (u.role !== 'SUPERADMIN') throw new HttpError(403, 'Akses ditolak: hanya SUPERADMIN yang dapat mengubah pengaturan aplikasi.', 'FORBIDDEN');
    let body: Record<string, string> = {};
    try {
      body = await c.req.json();
    } catch {
      body = {};
    }
    const updates: Record<string, string> = {
      logo_url: String(body?.logo_url ?? '') || '',
      app_name: String(body?.app_name ?? '') || 'Monitoring Kendaraan Operasional',
      company_name: String(body?.company_name ?? '') || 'PT Tridaya Sinergi Indonesia',
      footer_text: String(body?.footer_text ?? '') || '',
    };
    await deps.settings.setMany(updates);
    await deps.recordAudit({
      user_id: u.user_id,
      username: u.username,
      action: 'EDIT',
      modul: 'pengaturan',
      keterangan: 'Ubah pengaturan aplikasi',
      data_sesudah: JSON.stringify(updates),
    });
    return c.json(okPayload({ msg: 'Pengaturan berhasil disimpan' }));
  });

  app.post('/logo', requireUser(deps), async (c) => {
    const u = c.get('user');
    if (u.role !== 'SUPERADMIN') throw new HttpError(403, 'Akses ditolak: hanya SUPERADMIN yang dapat mengunggah logo aplikasi.', 'FORBIDDEN');
    try {
      const body = await c.req.json().catch(() => null);
      const base64Data = String((body as any)?.base64Data ?? '');
      const fileName = String((body as any)?.fileName ?? '');
      const b64 = base64Data.split(',')[1] ?? base64Data;
      if (!b64) throw new Error('Data base64 tidak valid');
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      if (bytes.length > MAX_LOGO_BYTES) throw new Error('Ukuran file melebihi 10MB');
      const m = /\.([a-z0-9]+)$/i.exec(fileName);
      const rawExt = (m?.[1] ?? 'png').toLowerCase();
      const ext = IMAGE_EXT[rawExt] ? rawExt : 'png';
      const contentType = IMAGE_EXT[ext] ?? 'image/png';
      const { url } = await uploadLogo(c.env as Env, bytes, ext, contentType);
      await deps.settings.setMany({ logo_url: url });
      await deps.recordAudit({
        user_id: u.user_id,
        username: u.username,
        action: 'EDIT',
        modul: 'pengaturan',
        keterangan: 'Unggah logo aplikasi',
        data_sesudah: JSON.stringify({ logo_url: url }),
      });
      return c.json(okPayload({ success: true, url, msg: 'Logo berhasil diunggah' }));
    } catch (e) {
      return c.json(errPayload('Gagal upload logo: ' + (e as Error).message, 'BAD_REQUEST'), 400);
    }
  });

  return app;
}
