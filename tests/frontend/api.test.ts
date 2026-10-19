import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, pesanTimeoutSimpan, post, put, request } from '../../static/js/api.js';
import { setToken, clearSession, getToken } from '../../static/js/store.js';

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

  it('respons non-JSON (mis. halaman 502 Cloudflare) tidak menghapus sesi', async () => {
    setToken('T-LAMA');
    stubFetch(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const err = await request('GET', '/api/master').catch((e) => e as ApiError);
    expect(err.error).toBe('BAD_RESPONSE');
    expect(getToken()).toBe('T-LAMA');
  });

  it('401 tetap menghapus sesi', async () => {
    setToken('T-LAMA');
    stubFetch(async () => json({ success: false, error: 'UNAUTHORIZED', message: 'sesi tidak valid' }, 401));
    await request('GET', '/api/master').catch(() => null);
    expect(getToken()).toBe('');
  });

  it('request yang menggantung dibatalkan dengan galat TIMEOUT', async () => {
    vi.useFakeTimers();
    try {
      stubFetch((_u, init) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
      const p = request('GET', '/api/master').catch((e) => e as ApiError);
      await vi.advanceTimersByTimeAsync(31_000);
      const err = await p;
      expect(err.error).toBe('TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
  });

  it('timeout saat membaca body respons dilaporkan TIMEOUT, bukan BAD_RESPONSE', async () => {
    vi.useFakeTimers();
    try {
      stubFetch(async (_u, init) => ({
        ok: true,
        status: 200,
        json: () => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))),
      }) as unknown as Response);
      const p = request('GET', '/api/master').catch((e) => e as ApiError);
      await vi.advanceTimersByTimeAsync(31_000);
      const err = await p;
      expect(err.error).toBe('TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('pesanTimeoutSimpan', () => {
  it('menambahkan peringatan hanya untuk galat TIMEOUT', () => {
    const tambahan = ' Mungkin sudah tersimpan.';
    expect(pesanTimeoutSimpan(new ApiError('Server tidak merespons.', 0, 'TIMEOUT'), tambahan)).toBe('Server tidak merespons. Mungkin sudah tersimpan.');
    expect(pesanTimeoutSimpan(new ApiError('Saldo kurang.', 400, 'ERROR'), tambahan)).toBe('Saldo kurang.');
    expect(pesanTimeoutSimpan(new ApiError('Tidak dapat terhubung.', 0, 'NETWORK'), tambahan)).toBe('Tidak dapat terhubung.');
  });
});

describe('put', () => {
  it('meneruskan opsi batas waktu ke request', async () => {
    vi.useFakeTimers();
    try {
      stubFetch((_u, init) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
      let selesai = false;
      const p = put('/api/laporan/X', {}, { timeoutMs: 120_000 }).catch((e) => { selesai = true; return e as ApiError; });
      await vi.advanceTimersByTimeAsync(31_000);
      expect(selesai).toBe(false);
      await vi.advanceTimersByTimeAsync(90_000);
      expect((await p).error).toBe('TIMEOUT');
    } finally {
      vi.useRealTimers();
    }
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
