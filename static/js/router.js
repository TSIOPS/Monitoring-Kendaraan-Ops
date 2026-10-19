import { isLoggedIn, setUser, clearSession } from './store.js';
import { get } from './api.js';

const routes = [];
let params = {};
let penjagaKeluar = null;
let hashAktif = '';
let abaikanHashBerikut = false;

// Halaman dengan form memasang penjaga: fungsi yang mengembalikan pesan konfirmasi
// bila ada isian belum disimpan ('' = aman). Dilepas otomatis setiap ganti halaman.
export function pasangPenjagaKeluar(fn) {
  penjagaKeluar = fn;
}

export function putuskanKeluar(penjaga, tanya = (m) => window.confirm(m)) {
  const pesan = penjaga ? penjaga() : '';
  return !pesan || tanya(pesan);
}

export function bolehTinggalkanHalaman() {
  return putuskanKeluar(penjagaKeluar);
}

// Ada form berisi isian belum disimpan di halaman aktif (dipakai untuk menunda pop-up).
export function adaFormTerbuka() {
  return Boolean(penjagaKeluar && penjagaKeluar());
}

const KUNCI_TUJUAN = 'tujuan-login';

// Hanya hash rute internal ('#/...') yang diterima — mencegah open redirect.
export function tujuanSetelahLogin(simpanan) {
  const s = String(simpanan || '');
  return /^#\/[\w\-/%.]*$/.test(s) && s !== '#/login' ? s : '#/dashboard';
}

// Ke halaman login sambil mengingat rute yang sedang dibuka (per tab).
function keLogin(hashSekarang) {
  try { if (hashSekarang && hashSekarang !== '#/login') sessionStorage.setItem(KUNCI_TUJUAN, hashSekarang); } catch { /* abaikan */ }
  window.location.hash = '#/login';
}

export function ambilTujuanLogin() {
  let s = '';
  try { s = sessionStorage.getItem(KUNCI_TUJUAN) || ''; sessionStorage.removeItem(KUNCI_TUJUAN); } catch { /* abaikan */ }
  return tujuanSetelahLogin(s);
}

export function registerRoute(pattern, loader, options = {}) {
  const names = [];
  // matchRoute membuang '#' dari hash, jadi pola juga harus tanpa '#'.
  const regexSrc = pattern
    .replace(/^#/, '')
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/:(\w+)/g, (_, name) => {
      names.push(name);
      return '([^/]+)';
    });
  routes.push({ regex: new RegExp(`^${regexSrc}$`), loader, names, guard: options.guard !== false });
}

export function getRouteParam(name) {
  return params[name] ?? '';
}

export function matchRoute(hash) {
  const path = (hash || '#/login').replace(/^#/, '');
  return routes.find((r) => r.regex.test(path)) || null;
}

// Galat khas modul ES beda versi / modul baru gagal diunduh setelah deploy.
export function perluMuatUlang(err) {
  const m = String(err?.message || '');
  return /does not provide an export named|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i.test(m);
}

async function run(hash) {
  const view = document.getElementById('view');
  if (!view) return;
  penjagaKeluar = null;
  hashAktif = hash;

  const found = matchRoute(hash);
  if (!found) {
    if (hash === '#/dashboard') {
      // Hash sama tidak memicu hashchange; tanpa ini layar tetap kosong.
      const box = document.createElement('div');
      box.className = 'alert alert-danger';
      box.textContent = 'Halaman tidak ditemukan.';
      view.replaceChildren(box);
      return;
    }
    window.location.hash = '#/dashboard';
    return;
  }

  if (found.guard && !isLoggedIn()) {
    keLogin(hash);
    return;
  }

  const path = (hash || '#/login').replace(/^#/, '');
  const m = found.regex.exec(path);
  params = {};
  found.names.forEach((name, i) => {
    params[name] = decodeURIComponent(m[i + 1] || '');
  });

  view.replaceChildren();
  try {
    const page = await found.loader();
    await page.render(view);
    try { sessionStorage.removeItem('muat-ulang-versi'); } catch { /* abaikan */ }
  } catch (err) {
    // Aplikasi versi baru sudah dipasang saat halaman ini masih terbuka: modul lama di memori
    // tidak cocok dengan modul halaman yang baru. Muat ulang sekali agar semua modul seragam.
    if (perluMuatUlang(err)) {
      const kunci = 'muat-ulang-versi';
      let sudah = null;
      try { sudah = sessionStorage.getItem(kunci); } catch { /* abaikan */ }
      if (sudah !== hash) {
        try { sessionStorage.setItem(kunci, hash); } catch { /* abaikan */ }
        window.location.reload();
        return;
      }
    }
    const box = document.createElement('div');
    box.className = 'alert alert-danger';
    box.textContent = perluMuatUlang(err) ? 'Aplikasi baru saja diperbarui. Tekan Ctrl+F5 (atau tutup & buka lagi aplikasinya) untuk memuat versi terbaru.' : (err.message || 'Halaman gagal dimuat.');
    view.replaceChildren(box);
  }
}

// Hash sama = gambar ulang halaman aktif atas permintaan halaman itu sendiri, tidak lewat
// penjaga; hash berbeda lewat hashchange sehingga penjaga ikut bertanya.
export function navigate(hash) {
  if (window.location.hash === hash) {
    run(hash);
  } else {
    window.location.hash = hash;
  }
}

export function startRouter() {
  window.addEventListener('hashchange', () => {
    if (abaikanHashBerikut) { abaikanHashBerikut = false; return; }
    if (!putuskanKeluar(penjagaKeluar)) {
      abaikanHashBerikut = true;
      window.location.hash = hashAktif; // batal pindah: kembalikan hash, halaman tidak digambar ulang
      return;
    }
    run(window.location.hash);
  });
  window.addEventListener('beforeunload', (ev) => {
    if (penjagaKeluar && penjagaKeluar()) { ev.preventDefault(); ev.returnValue = ''; }
  });
  run(window.location.hash);
}

export async function ensureSession() {
  if (!isLoggedIn()) {
    keLogin(window.location.hash);
    return null;
  }
  try {
    const data = await get('/api/session');
    const user = data.user || null;
    if (user) setUser(user);
    return user;
  } catch (err) {
    if (err.status === 401) clearSession();
    keLogin(window.location.hash);
    return null;
  }
}
