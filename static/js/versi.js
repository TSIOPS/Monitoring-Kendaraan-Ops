import { el } from './ui.js';
import { getUser } from './store.js';
import { adaFormTerbuka } from './router.js';
import { RILIS } from './rilis.js';

export function versiBerubah(awal, terbaru) {
  return Boolean(awal && terbaru && awal !== terbaru);
}
export function perluTampilRilis(daftar, idTersimpan) {
  const t = daftar?.[0];
  return Boolean(t && t.id !== idTersimpan);
}

const KUNCI_RILIS = 'rilis-terakhir-dilihat';
const simpan = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* abaikan */ } } };

async function ambilVersi() {
  try {
    const res = await fetch('/api/health/versi', { cache: 'no-store' });
    return String((await res.json())?.versi || '');
  } catch {
    return '';
  }
}

let versiAwal = '';
async function cek() {
  const v = await ambilVersi();
  if (!versiAwal) { versiAwal = v; return; }
  if (!versiBerubah(versiAwal, v)) return;
  const slot = document.getElementById('banner-versi');
  if (!slot || slot.childElementCount) return;
  const muat = el('button', { type: 'button', class: 'btn btn-sm btn-primary ms-2', text: 'Muat ulang sekarang' });
  muat.addEventListener('click', () => location.reload());
  slot.replaceChildren(el('div', { class: 'banner-versi', role: 'status' }, [
    el('i', { class: 'bi bi-arrow-repeat me-2', 'aria-hidden': 'true' }), 'Versi baru aplikasi tersedia.', muat,
  ]));
}

// Pop-up "Yang baru" sekali per perangkat setelah login; ditunda saat form belum disimpan terbuka.
export function tampilkanRilisBila() {
  if (!getUser() || (location.hash || '#/login').startsWith('#/login') || adaFormTerbuka()) return;
  if (!perluTampilRilis(RILIS, simpan.get(KUNCI_RILIS))) return;
  const r = RILIS[0];
  simpan.set(KUNCI_RILIS, r.id);
  const tutup = () => latar.remove();
  const latar = el('div', { class: 'popup-latar', role: 'dialog', 'aria-modal': 'true', 'aria-label': r.judul }, [
    el('div', { class: 'popup-kotak' }, [
      el('div', { class: 'h5 fw-bold mb-2' }, [el('i', { class: 'bi bi-stars me-2', 'aria-hidden': 'true' }), r.judul]),
      el('ul', { class: 'mb-3' }, r.poin.map((p) => el('li', { text: p }))),
      el('div', { class: 'text-end' }, [el('button', { class: 'btn btn-primary', type: 'button', text: 'Mengerti', onclick: tutup })]),
    ]),
  ]);
  document.body.appendChild(latar);
}

export function mulaiCekVersi() {
  cek();
  setInterval(cek, 10 * 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) cek(); });
  window.addEventListener('hashchange', tampilkanRilisBila);
  tampilkanRilisBila();
}
