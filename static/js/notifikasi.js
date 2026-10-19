import { get, post } from './api.js';
import { getUser } from './store.js';
import { bolehTulis } from './peran.js';
import { el } from './ui.js';
import { adaFormTerbuka } from './router.js';

// ── Helper murni (diuji) ────────────────────────────────────────────────────

// Menit sejak 00:00 WIB.
export function menitWib(d = new Date()) {
  const s = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

export const MENIT_PERINGATAN = 16 * 60 + 30; // 16:30 WIB (Senin-Jumat)

// Jam operasional: Senin-Jumat sampai 17:00, Sabtu & Minggu sampai 16:00 (WIB).
// Pengingat muncul 30 menit sebelum jam tutup.
export function hariWib(d = new Date()) {
  const n = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(n);
}
export function jamOperasional(d = new Date()) {
  const akhirPekan = [0, 6].includes(hariWib(d));
  return akhirPekan
    ? { tutup: 16 * 60, jam: '16:00', pengingat: '15:30', kata: 'jam empat sore' }
    : { tutup: 17 * 60, jam: '17:00', pengingat: '16:30', kata: 'jam lima sore' };
}
export function menitPeringatan(d = new Date()) {
  return jamOperasional(d).tutup - 30;
}

export function teksTugas(t) {
  const bagian = [];
  if (t?.laporan) bagian.push(`${t.laporan} laporan`);
  if (t?.rekonsiliasi) bagian.push(`${t.rekonsiliasi} rekonsiliasi`);
  if (!bagian.length) return '';
  return `${bagian.join(' & ')} belum selesai` + (t.tertunggak ? ` (${t.tertunggak} jalur dari hari sebelumnya)` : '');
}

// Teks banner tugas. Pengguna read-only (MANAGEMENT) hanya memantau: nada netral, tanpa perintah.
export function teksBanner(teks, akhir, jam, boleh = true) {
  if (!boleh) return `Pemantauan: hari ini ${teks} di cabang.`;
  return akhir ? `Segera selesaikan sebelum ${jam} — hari ini ${teks}.` : `Hari ini: ${teks}.`;
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
  const jo = jamOperasional();
  const boleh = bolehTulis(getUser()?.role);
  const akhir = menitWib() >= menitPeringatan();
  slot.replaceChildren(el('div', { class: `banner-tugas ${akhir ? 'banner-tugas-akhir' : ''}`, role: 'status' }, [
    el('i', { class: `bi ${akhir ? 'bi-alarm' : 'bi-info-circle'} me-2`, 'aria-hidden': 'true' }),
    el('span', { text: teksBanner(teks, akhir, jo.jam, boleh) }),
    el('a', { href: '#/jalur', class: 'ms-2 fw-bold', text: 'Lihat jalur' }),
  ]));
  // Pop-up sekali per hari, 30 menit sebelum jam tutup (16:30 hari kerja, 15:30 akhir pekan).
  const kunci = `tugas-popup:${cache.tanggal}`;
  // Form belum disimpan sedang terbuka: banner tetap tampil, pop-up ditunda (kunci belum
  // ditandai) sampai pindah halaman / form selesai.
  // Pop-up + alarm hanya untuk yang bertugas menyelesaikan; read-only cukup melihat banner.
  if (boleh && akhir && !simpan.get(kunci) && !adaFormTerbuka()) {
    simpan.set(kunci, '1');
    tampilPopup(teks, cache);
  }
}

// Nada pengingat (Web Audio, tanpa file): "ding-dong" naik tiga nada, diulang dua kali.
// Browser hanya mengizinkan suara setelah pengguna pernah mengetuk/klik halaman, jadi
// AudioContext dibuka pada interaksi pertama.
let audioCtx = null;
function bukaAudio() {
  try {
    audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { /* perangkat tanpa Web Audio */ }
}
if (typeof document !== 'undefined') {
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, bukaAudio, { passive: true }));
}

export const NADA_PENGINGAT = [[659, 0], [784, 0.22], [988, 0.44], [659, 1.1], [784, 1.32], [988, 1.54]];

// Kalimat yang diucapkan (bahasa Indonesia), dari ringkasan tugas hari ini.
export function kalimatPengingat(t, d = new Date()) {
  const bagian = [];
  if (t?.laporan) bagian.push(`${t.laporan} laporan`);
  if (t?.rekonsiliasi) bagian.push(`${t.rekonsiliasi} rekonsiliasi`);
  if (!bagian.length) return '';
  const tunggak = t.tertunggak ? `, termasuk ${t.tertunggak} jalur dari hari sebelumnya` : '';
  return `Perhatian. Masih ada ${bagian.join(' dan ')} yang belum selesai${tunggak}. Segera selesaikan sebelum ${jamOperasional(d).kata}.`;
}
export const KALIMAT_SEMUA_SELESAI = 'Semua laporan dan rekonsiliasi hari ini sudah selesai. Terima kasih.';

// Suara bahasa Indonesia bila tersedia di perangkat (Google / Microsoft), selain itu suara bawaan.
export function pilihSuaraId(daftar) {
  const id = (daftar || []).filter((v) => /^id([-_]|$)/i.test(String(v.lang || '')));
  return id.find((v) => /google/i.test(v.name)) || id[0] || null;
}

// Chrome memuat daftar suara secara asinkron; panggil sekali agar siap saat dibutuhkan.
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.getVoices();
  window.speechSynthesis.addEventListener?.('voiceschanged', () => window.speechSynthesis.getVoices());
}

export function ucapkan(teks) {
  try {
    const ss = window.speechSynthesis;
    if (!ss || !teks) return false;
    const u = new SpeechSynthesisUtterance(teks);
    u.lang = 'id-ID';
    u.rate = 0.95;
    const suara = pilihSuaraId(ss.getVoices());
    if (suara) u.voice = suara;
    ss.cancel();
    ss.speak(u);
    return true;
  } catch {
    return false;
  }
}

// Nada "ding-dong" lalu kalimat diucapkan (bila ada).
export function bunyiPengingat(kalimat = '') {
  const nada = nadaPengingat();
  if (kalimat) setTimeout(() => ucapkan(kalimat), nada ? 2100 : 0);
  return nada || (kalimat ? Boolean(window.speechSynthesis) : false);
}

function nadaPengingat() {
  bukaAudio();
  if (!audioCtx) return false;
  const t0 = audioCtx.currentTime + 0.05;
  for (const [frek, mulai] of NADA_PENGINGAT) {
    const osc = audioCtx.createOscillator();
    const vol = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = frek;
    vol.gain.setValueAtTime(0.0001, t0 + mulai);
    vol.gain.exponentialRampToValueAtTime(0.35, t0 + mulai + 0.02);
    vol.gain.exponentialRampToValueAtTime(0.0001, t0 + mulai + 0.5);
    osc.connect(vol).connect(audioCtx.destination);
    osc.start(t0 + mulai);
    osc.stop(t0 + mulai + 0.55);
  }
  return true;
}

function tampilPopup(teks, t) {
  bunyiPengingat(kalimatPengingat(t));
  const tutup = () => latar.remove();
  const daftar = (t.item || []).slice(0, 8).map((i) => el('li', {}, [
    `${i.tanggal && t.tanggal && i.tanggal < t.tanggal ? `[${i.tanggal.slice(8, 10)}/${i.tanggal.slice(5, 7)}] ` : ''}${i.plat_nomor} — ${i.nama_driver}: `,
    el('strong', { text: i.perlu.map((p) => (p === 'LAPORAN' ? 'laporan' : 'rekonsiliasi')).join(' & ') }),
  ]));
  const latar = el('div', { class: 'popup-latar', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Pengingat tugas' }, [
    el('div', { class: 'popup-kotak' }, [
      el('div', { class: 'h5 text-danger fw-bold mb-2' }, [el('i', { class: 'bi bi-alarm me-2', 'aria-hidden': 'true' }), `Pengingat ${jamOperasional().pengingat}`]),
      el('p', { class: 'mb-2', text: `Hari ini ${teks}. Jam operasional berakhir pukul ${jamOperasional().jam}.` }),
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
  // Setelah simpan/hapus data (jalur, laporan, rekonsiliasi) hitungan tugas diambil ulang.
  let tunda = 0;
  window.addEventListener('data-berubah', () => { clearTimeout(tunda); tunda = setTimeout(() => segarkanBanner(true), 400); });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) segarkanBanner(true); });
  setInterval(() => segarkanBanner(true), 5 * 60_000);
  segarkanBanner(true);
}

// ── Web Push ────────────────────────────────────────────────────────────────

// Ambil tugas hari ini terbaru lalu bunyikan nada + kalimat dengan angka sebenarnya.
export async function bunyiTugasSekarang() {
  await segarkanBanner(true);
  return bunyiPengingat(kalimatPengingat(cache) || KALIMAT_SEMUA_SELESAI);
}

export async function daftarkanServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  // Push masuk saat aplikasi terbuka -> bunyikan nada pengingat.
  // Klik notifikasi saat aplikasi terbuka -> pindah lewat hashchange agar penjaga form ikut bertanya.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'bunyi-pengingat') { if (bolehTulis(getUser()?.role)) bunyiTugasSekarang(); }
    else if (e.data?.type === 'buka-url') {
      const hash = new URL(e.data.url, location.origin).hash || '#/dashboard';
      if (hash !== location.hash) location.hash = hash;
    }
  });
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
