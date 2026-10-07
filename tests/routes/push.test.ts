import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import type { SessionUser } from '../../src/deps';
import type { JalurFull } from '../../src/logic/jalur';
import { ringkasTugas, teksTugas } from '../../src/logic/tugas';
import { hashEndpoint, kirimPush, vapidJwt } from '../../src/push/webpush';
import { kirimPengingatHarian } from '../../src/routes/push';
import { authHeaders, fakeEnv, loginAs, makeDeps, memJalur } from '../helpers';

const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic', role: 'PIC CABANG', cabang: 'CBG-A', exp: 1e15 };
const HARI = '2026-10-07';
const jalur = (o: Partial<JalurFull>): JalurFull => ({
  id: 'J-1', tanggal: HARI, driver_id: 'S-1', nama_driver: 'Agus', driver2_id: '', nama_driver2: '', vehicle_id: 'V-1', plat_nomor: 'D 1 A',
  nama_kendaraan: '', jenis_kendaraan: 'Mobil', rute_tujuan: 'x', kode_cabang: 'CBG-A', flazz_card_id: '', flazz_card_name: '',
  flazz_card_id_2: '', flazz_card_name_2: '', created_by: '', created_at: '', updated_at: '', is_deleted: '', status: 'BELUM_DIISI', laporan_id: '', ...o,
} as JalurFull);

async function kunciUji() {
  const k = (await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey('jwk', k.privateKey)) as JsonWebKey;
  const raw = new Uint8Array((await crypto.subtle.exportKey('raw', k.publicKey)) as ArrayBuffer);
  const publicKey = btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { pair: k, vapid: { publicKey, privateJwk: { kty: jwk.kty, crv: jwk.crv, d: jwk.d, x: jwk.x, y: jwk.y }, subject: 'https://contoh.test' } };
}

describe('ringkasTugas', () => {
  it('laporan belum = BELUM_DIISI; rekonsiliasi belum = ada kartu & belum SELESAI', () => {
    const r = ringkasTugas([
      jalur({ id: 'A' }),
      jalur({ id: 'B', flazz_card_id: 'FLZ-1', status: 'SUDAH_LAPORAN' }),
      jalur({ id: 'C', flazz_card_id: 'FLZ-2' }),
      jalur({ id: 'D', status: 'SUDAH_LAPORAN' }),
      jalur({ id: 'E', flazz_card_id: 'FLZ-3', status: 'SELESAI' }),
      jalur({ id: 'F', tanggal: '2026-10-06' }),
    ], HARI);
    expect([r.laporan, r.rekonsiliasi]).toEqual([2, 2]);
    expect(r.item.map((i) => i.jalur_id).sort()).toEqual(['A', 'B', 'C']);
    expect(teksTugas(r)).toBe('2 laporan & 2 rekonsiliasi belum selesai');
    expect(teksTugas({ laporan: 0, rekonsiliasi: 0 })).toBe('');
  });
});

describe('VAPID', () => {
  it('JWT ES256 dengan aud origin push service, dapat diverifikasi kunci publik', async () => {
    const { pair, vapid } = await kunciUji();
    const jwt = await vapidJwt('https://fcm.googleapis.com', vapid, 1_000_000);
    const [h, p, s] = jwt.split('.');
    const dec = (x: string) => JSON.parse(atob(x.replace(/-/g, '+').replace(/_/g, '/')));
    expect(dec(h!)).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(dec(p!)).toEqual({ aud: 'https://fcm.googleapis.com', exp: 1_000_000 + 43200, sub: 'https://contoh.test' });
    const sig = Uint8Array.from(atob(s!.replace(/-/g, '+').replace(/_/g, '/')), (ch) => ch.charCodeAt(0));
    const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pair.publicKey, sig, new TextEncoder().encode(`${h}.${p}`));
    expect(ok).toBe(true);
  });

  it('kirimPush: header VAPID & TTL; 410 berarti langganan dihapus', async () => {
    const { vapid } = await kunciUji();
    const panggil: Array<{ url: string; init: RequestInit }> = [];
    const fetcher = (async (url: string, init: RequestInit) => { panggil.push({ url, init }); return new Response(null, { status: 410 }); }) as unknown as typeof fetch;
    const r = await kirimPush('https://fcm.googleapis.com/fcm/send/abc', vapid, fetcher);
    expect(r).toEqual({ status: 410, hapus: true });
    const h = panggil[0]!.init.headers as Record<string, string>;
    expect(h.Authorization).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/);
    expect(h.TTL).toBe('3600');
  });
});

describe('rute push & pengingat terjadwal', () => {
  function siap(rows: JalurFull[]) {
    const jl = memJalur(rows as any);
    const { deps, kv } = makeDeps({ jalur: jl.repo });
    const app = buildApp(fakeEnv() as any, deps);
    return { app, deps, kv };
  }

  it('GET /api/tugas-hari-ini memakai cabang PIC', async () => {
    const { app, kv } = siap([jalur({ tanggal: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) }), jalur({ id: 'X', kode_cabang: 'CBG-B', tanggal: new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10) })]);
    const tok = await loginAs(kv, PIC);
    const body = (await (await app.request('/api/tugas-hari-ini', { headers: authHeaders(tok) })).json()) as any;
    expect(body.laporan).toBe(1);
    expect(body.item.map((i: any) => i.kode_cabang)).toEqual(['CBG-A']);
  });

  it('langganan tersimpan; ringkasan untuk service worker sesuai cabang', async () => {
    const hari = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
    const { app, kv } = siap([jalur({ tanggal: hari, flazz_card_id: 'FLZ-1' })]);
    const tok = await loginAs(kv, PIC);
    const endpoint = 'https://fcm.googleapis.com/fcm/send/xyz';
    const res = await app.request('/api/push/langganan', { method: 'POST', headers: { ...authHeaders(tok), 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint }) });
    expect(res.status).toBe(200);
    expect(await kv.get('push:' + (await hashEndpoint(endpoint)), 'json')).toMatchObject({ endpoint, cabang: 'CBG-A', user_id: 'U-P' });
    const r = (await (await app.request('/api/push/ringkasan?endpoint=' + encodeURIComponent(endpoint))).json()) as any;
    expect(r.isi).toContain('1 laporan & 1 rekonsiliasi belum selesai');
  });

  it('pengingat 16:30: kirim hanya ke cabang yang punya tugas, hapus langganan kedaluwarsa', async () => {
    const { vapid } = await kunciUji();
    const { deps, kv } = siap([jalur({})]);
    await kv.put('push:a', JSON.stringify({ endpoint: 'https://push.test/a', user_id: 'U-1', username: 'a', role: 'PIC CABANG', cabang: 'CBG-A', created_at: '' }));
    await kv.put('push:b', JSON.stringify({ endpoint: 'https://push.test/b', user_id: 'U-2', username: 'b', role: 'PIC CABANG', cabang: 'CBG-B', created_at: '' }));
    await kv.put('push:c', JSON.stringify({ endpoint: 'https://push.test/c', user_id: 'U-3', username: 'c', role: 'PIC CABANG', cabang: 'CBG-A', created_at: '' }));
    const daftar = { list: async () => ({ keys: [{ name: 'push:a' }, { name: 'push:b' }, { name: 'push:c' }], list_complete: true }) };
    const dikirim: string[] = [];
    const fetcher = (async (url: string) => { dikirim.push(url); return new Response(null, { status: url.endsWith('/c') ? 410 : 201 }); }) as unknown as typeof fetch;
    const r = await kirimPengingatHarian(deps, daftar, vapid, fetcher, HARI);
    expect(dikirim.sort()).toEqual(['https://push.test/a', 'https://push.test/c']);
    expect(r).toEqual({ langganan: 3, terkirim: 1, dihapus: 1 });
    expect(await kv.get('push:c')).toBeNull();
  });
});
