import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, post, request } from '../../static/js/api.js';
import { setToken, clearSession } from '../../static/js/store.js';

class MemoryStorage {
  private map = new Map<string, string>();
  getItem(key: string) {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  setItem(key: string, value: string) {
    this.map.set(key, String(value));
  }
  removeItem(key: string) {
    this.map.delete(key);
  }
  clear() {
    this.map.clear();
  }
}

function stubFetch(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl);
  vi.stubGlobal('fetch', spy);
  return spy;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(() => {
  vi.stubGlobal('localStorage', new MemoryStorage());
});

afterEach(() => {
  clearSession();
  vi.unstubAllGlobals();
});

describe('request', () => {
  it('mengembalikan field di luar success pada respons sukses', async () => {
    stubFetch(async () => json({ success: true, token: 'T1', user: { nama: 'Budi' } }));
    const data = await request('POST', '/api/login', { username: 'budi' });
    expect(data.token).toBe('T1');
    expect(data.user).toEqual({ nama: 'Budi' });
  });

  it('melempar ApiError dengan pesan server pada respons gagal', async () => {
    stubFetch(async () => json({ success: false, error: 'BAD_CREDENTIALS', message: 'Username atau password salah.' }, 401));
    await expect(request('POST', '/api/login', {})).rejects.toThrowError('Username atau password salah.');
  });

  it('menyertakan status dan error pada ApiError', async () => {
    stubFetch(async () => json({ success: false, error: 'RATE_LIMIT', message: 'Terlalu banyak percobaan.' }, 429));
    const err = await request('POST', '/api/login', {}).catch((e) => e as ApiError);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(429);
    expect(err.error).toBe('RATE_LIMIT');
  });

  it('mengirim header Authorization bila token tersedia', async () => {
    const spy = stubFetch(async () => json({ success: true }));
    setToken('T9');
    await request('GET', '/api/laporan');
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer T9');
  });

  it('menghapus session saat server membalas 401', async () => {
    stubFetch(async () => json({ success: false, error: 'UNAUTHORIZED', message: 'Sesi habis.' }, 401));
    setToken('T9');
    await request('GET', '/api/laporan').catch(() => undefined);
    expect(localStorage.getItem('m6.token')).toBeNull();
  });

  it('melempar pesan ramah pengguna saat jaringan gagal', async () => {
    stubFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const err = await request('GET', '/api/laporan').catch((e) => e as ApiError);
    expect(err.message).toBe('Tidak dapat terhubung ke server. Periksa koneksi Anda.');
  });

  it('menghapus session bila respons bukan JSON', async () => {
    stubFetch(async () => new Response('<html>502</html>', { status: 502 }));
    setToken('T9');
    await request('GET', '/api/laporan').catch(() => undefined);
    expect(localStorage.getItem('m6.token')).toBeNull();
  });
});

describe('post', () => {
  it('meneruskan body sebagai JSON', async () => {
    const spy = stubFetch(async () => json({ success: true, ok: 1 }));
    await post('/api/laporan', { vehicle_id: 'V-1' });
    const init = spy.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ vehicle_id: 'V-1' });
  });
});
