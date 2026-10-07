import { get, post } from './api.js';
import { getUser } from './store.js';
import { el } from './ui.js';

// ── Helper murni (diuji) ────────────────────────────────────────────────────

// Menit sejak 00:00 WIB.
export function menitWib(d = new Date()) {
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export const MENIT_PERINGATAN = 16 * 60 + 30; // 16:30 WIB

export function teksTugas(t) {
  const bagian = [];
  if (t?.laporan) bagian.push(`${t.laporan} laporan`);
  if (t?.rekonsiliasi) bagian.push(`${t.rekonsiliasi} rekonsiliasi`);
  return bagian.length ? `${bagian.join(' & ')} belum selesai` : '';
}

// Applic. server key VAPID (base64url) -> Uint8Array untuk pushManager.subscribe.
export function kunciKeBytes(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function perluPasangDulu(ua = navigator.userAgent, standalone = window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone) {
  return /iPhone|iPad|iPod/i.test(ua) && !standalone;
}

// ── Banner tugas hari ini ───────────────────────────────────────────────────

const simpan = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* abaikan */ } } };
let terakhir = 0;
let cache = null;

export async function segarkanBanner(paksa = false) {
  const slot = document.getElementById('banner-slot');
  if (!slot) return;
  if (!getUser() || (window.location.hash || '#/login').startsWith('#/login')) { slot.replaceChildren(); return; }
  if (paksa || !cache || Date.now() - terakhir > 60_000) {
    try {
      cache = await get('/api/tugas-hari-ini');
      terakhir = Date.now();
    } catch {
      return;
    }
  }
  const teks = teksTugas(cache);
  if (!teks) { slot.replaceChildren(); return; }
  const akhir = menitWib() >= MENIT_PERINGATAN;
  slot.replaceChildren(el('div', { class: `banner-tugas ${akhir ? 'banner-tugas-akhir' : ''}`, role: 'status' }, [
    el('i', { class: `bi ${akhir ? 'bi-alarm' : 'bi-info-circle'} me-2`, 'aria-hidden': 'true' }),
    el('span', { text: akhir ? `Segera selesaikan sebelum 17:00 — hari ini ${teks}.` : `Hari ini: ${teks}.` }),
    el('a', { href: '#/jalur', class: 'ms-2 fw-bold', text: 'Lihat jalur' }),
  ]));
  // Pop-up sekali per hari setelah 16:30.
  const kunci = `tugas-popup:${cache.tanggal}`;
  if (akhir && !simpan.get(kunci)) {
    simpan.set(kunci, '1');
    tampilPopup(teks, cache);
  }
}

function tampilPopup(teks, t) {
  const tutup = () => latar.remove();
  const daftar = (t.item || []).slice(0, 8).map((i) => el('li', {}, [
    `${i.plat_nomor} — ${i.nama_driver}: `,
    el('strong', { text: i.perlu.map((p) => (p === 'LAPORAN' ? 'laporan' : 'rekonsiliasi')).join(' & ') }),
  ]));
  const latar = el('div', { class: 'popup-latar', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pengingat tugas' }, [
    el('div', { class: 'popup-kotak' }, [
      el('div', { class: 'h5 text-danger fw-bold mb-2' }, [el('i', { class: 'bi bi-alarm me-2', 'aria-hidden': 'true' }), 'Pengingat 16:30']),
      el('p', { class: 'mb-2', text: `Hari ini ${teks}. Jam operasional berakhir pukul 17:00.` }),
      daftar.length ? el('ul', { class: 'small mb-3' }, daftar) : null,
      el('div', { class: 'd-flex gap-2 justify-content-end' }, [
        el('button', { class: 'btn btn-outline-secondary', type: 'button', text: 'Tutup', onclick: tutup }),
        el('a', { class: 'btn btn-danger', href: '#/jalur', text: 'Lihat jalur', onclick: tutup }),
      ]),
    ]),
  ]);
  document.body.appendChild(latar);
}

export function mulaiBanner() {
  window.addEventListener('hashchange', () => segarkanBanner());
  setInterval(() => segarkanBanner(true), 5 * 60_000);
  segarkanBanner(true);
}

// ── Web Push ────────────────────────────────────────────────────────────────

export async function daftarkanServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.register('/sw.js');
  } catch {
    return null;
  }
}

export async function statusNotifikasi() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    return perluPasangDulu() ? 'pasang-dulu' : 'tidak-didukung';
  }
  if (Notification.permission === 'denied') return 'ditolak';
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  return sub ? 'aktif' : 'belum';
}

export async function aktifkanNotifikasi() {
  const { aktif, publicKey } = await get('/api/push/kunci');
  if (!aktif) throw new Error('Notifikasi belum dikonfigurasi di server.');
  const izin = await Notification.requestPermission();
  if (izin !== 'granted') throw new Error('Izin notifikasi ditolak. Aktifkan lewat pengaturan browser.');
  const reg = (await daftarkanServiceWorker()) || (await navigator.serviceWorker.ready);
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: kunciKeBytes(publicKey) }));
  await post('/api/push/langganan', { endpoint: sub.endpoint });
}

export async function matikanNotifikasi() {
  const reg = await navigator.serviceWorker.getRegistration('/sw.js');
  const sub = reg ? await reg.pushManager.getSubscription() : null;
  if (!sub) return;
  await post('/api/push/berhenti', { endpoint: sub.endpoint });
  await sub.unsubscribe();
}

export async function tesNotifikasi() {
  return post('/api/push/tes', {});
}
