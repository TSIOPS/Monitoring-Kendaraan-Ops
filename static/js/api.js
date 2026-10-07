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

export async function request(method, path, body) {
  const init = { method, headers: headerToken() };
  if (body !== undefined) init.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(path, init);
  } catch {
    throw new ApiError(JARINGAN_GAGAL, 0, 'NETWORK');
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    clearSession();
    throw new ApiError(RESPON_GAGAL, res.status, 'BAD_RESPONSE');
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

export function post(path, body) {
  return request('POST', path, body);
}

export function put(path, body) {
  return request('PUT', path, body);
}

export function del(path) {
  return request('DELETE', path);
}
