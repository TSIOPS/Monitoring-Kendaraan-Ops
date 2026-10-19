import { clearSession, getToken } from './store.js';

export class ApiError extends Error {
  constructor(message, status, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.error = code;
  }
}

const JARINGAN_GAGAL = 'Tidak dapat terhubung ke server. Periksa koneksi Anda.';
const RESPON_GAGAL = 'Server memberi jawaban yang tidak dapat dibaca. Coba lagi.';

function headerToken() {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

const WAKTU_HABIS = 'Server tidak merespons. Periksa sinyal lalu coba lagi.';
// Unggah foto (base64 besar) di sinyal lemah butuh waktu lebih lama.
export const BATAS_WAKTU_MS = 30_000;
export const BATAS_WAKTU_FOTO_MS = 120_000;

export async function request(method, path, body, { timeoutMs = BATAS_WAKTU_MS } = {}) {
  const ctrl = new AbortController();
  const init = { method, headers: headerToken(), signal: ctrl.signal };
  if (body !== undefined) init.body = JSON.stringify(body);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') throw new ApiError(WAKTU_HABIS, 0, 'TIMEOUT');
    throw new ApiError(JARINGAN_GAGAL, 0, 'NETWORK');
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // Batas waktu habis saat body masih dibaca (sinyal lemah): laporkan sebagai TIMEOUT.
    if (ctrl.signal.aborted) throw new ApiError(WAKTU_HABIS, 0, 'TIMEOUT');
    // Halaman error proxy/Cloudflare/captive portal: bukan tanda sesi tidak sah — sesi dipertahankan.
    throw new ApiError(RESPON_GAGAL, res.status, 'BAD_RESPONSE');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok || payload?.success === false) {
    if (res.status === 401) clearSession();
    throw new ApiError(
      String(payload?.message || RESPON_GAGAL),
      res.status,
      String(payload?.error || 'ERROR'),
    );
  }

  // Perubahan data (simpan/hapus) memberi tahu komponen lain, mis. banner tugas, agar segar.
  if (method !== 'GET' && typeof window !== 'undefined') window.dispatchEvent(new Event('data-berubah'));
  const { success, ...data } = payload;
  return data;
}

export function get(path) {
  return request('GET', path);
}

export function post(path, body, opsi) {
  return request('POST', path, body, opsi);
}

export function put(path, body) {
  return request('PUT', path, body);
}

export function del(path) {
  return request('DELETE', path);
}
