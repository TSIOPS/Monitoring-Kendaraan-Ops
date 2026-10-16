import { Hono } from 'hono';
import type { Env } from '../env';
import { FOTO_BUCKET } from '../db/storage';

// GET /foto/<kunci>: foto bukti dari Cloudflare R2 (tanpa biaya egress). Bila belum ada di
// R2 (foto lama yang belum disalin), diambil dari Supabase Storage lalu disalin ke R2
// (baca-sekaligus-salin), sehingga URL /foto/... selalu bisa dipakai selama migrasi.
// Publik seperti bucket Supabase sebelumnya: kunci memuat UUID acak, tidak bisa ditebak.

const CACHE = 'public, max-age=31536000, immutable';
const KUNCI_SAH = /^[A-Za-z0-9_\-./]+$/;

export function kunciAman(k: string): boolean {
  return !!k && KUNCI_SAH.test(k) && !k.split('/').some((s) => s === '..' || s === '.' || s === '');
}

async function ambilSupabase(env: Env, key: string): Promise<Response | null> {
  const res = await fetch(`${env.SUPABASE_URL}/storage/v1/object/public/${FOTO_BUCKET}/${key}`);
  return res.ok ? res : null;
}

export function fotoRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();

  app.get('/*', async (c) => {
    const key = decodeURIComponent(c.req.path.replace(/^\/foto\//, ''));
    if (!kunciAman(key)) return c.text('Not found', 404);
    const env = c.env;
    if (env.FOTO) {
      const obj = await env.FOTO.get(key);
      if (obj) {
        const h = new Headers();
        obj.writeHttpMetadata(h);
        h.set('Cache-Control', CACHE);
        h.set('ETag', obj.httpEtag);
        return new Response(obj.body, { headers: h });
      }
    }
    const src = await ambilSupabase(env, key);
    if (!src) return c.text('Not found', 404);
    const bytes = new Uint8Array(await src.arrayBuffer());
    const contentType = src.headers.get('Content-Type') || 'image/jpeg';
    if (env.FOTO) {
      c.executionCtx.waitUntil(env.FOTO.put(key, bytes, { httpMetadata: { contentType, cacheControl: CACHE } }));
    }
    return new Response(bytes, { headers: { 'Content-Type': contentType, 'Cache-Control': CACHE } });
  });

  return app;
}

// POST /api/admin/salin-foto  { keys: string[] }  header X-Migrasi-Token = secret MIGRASI_TOKEN.
// Menyalin foto lama Supabase -> R2 (yang sudah ada dilewati). Tidak menghapus apa pun.
export function salinFotoRoutes(): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.post('/salin-foto', async (c) => {
    const env = c.env;
    const token = env.MIGRASI_TOKEN || '';
    if (!token || c.req.header('X-Migrasi-Token') !== token) return c.json({ success: false, message: 'Tidak diizinkan.' }, 403);
    if (!env.FOTO) return c.json({ success: false, message: 'Binding R2 FOTO belum ada.' }, 500);
    const body = (await c.req.json().catch(() => ({}))) as { keys?: unknown };
    const keys = Array.isArray(body.keys) ? body.keys.map(String).filter(kunciAman).slice(0, 50) : [];
    const hasil = { disalin: 0, sudahAda: 0, gagal: [] as string[] };
    for (const key of keys) {
      if (await env.FOTO.head(key)) { hasil.sudahAda++; continue; }
      const src = await ambilSupabase(env, key);
      if (!src) { hasil.gagal.push(key); continue; }
      await env.FOTO.put(key, await src.arrayBuffer(), { httpMetadata: { contentType: src.headers.get('Content-Type') || 'image/jpeg', cacheControl: CACHE } });
      hasil.disalin++;
    }
    return c.json({ success: true, ...hasil });
  });
  return app;
}
