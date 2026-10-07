import { getJumlahPeringatan, getUser, logout, onPeringatanChange } from './store.js';
import { get, post } from './api.js';
import { ensureSession, registerRoute, startRouter } from './router.js';
import { el } from './ui.js';
import { renderLogin } from './pages/login.js';
import { daftarkanServiceWorker, mulaiBanner } from './notifikasi.js';

// Sidebar mengikuti GAS: grup dapat dilipat; Pengaturan hanya SUPERADMIN.
// juga: rute lain yang ikut menyalakan item (mis. halaman edit).
const NAV = [
  { hash: '#/dashboard', label: 'Dashboard', ikon: 'bi-speedometer2', badge: true },
  {
    label: 'Jalur Pengiriman',
    items: [
      { hash: '#/jalur/buat', label: 'Buat Jalur', ikon: 'bi-calendar-plus' },
      { hash: '#/jalur', label: 'Daftar Jalur', ikon: 'bi-list-ul', juga: ['#/jalur/edit'] },
      { hash: '#/jalur/ringkasan', label: 'Ringkasan Jalur', ikon: 'bi-clipboard-data' },
    ],
  },
  {
    label: 'Laporan Operasional Kendaraan',
    items: [
      { hash: '#/input', label: 'Input Laporan', ikon: 'bi-pencil-square' },
      { hash: '#/history', label: 'History Laporan', ikon: 'bi-clock-history', juga: ['#/edit', '#/transaksi'] },
      { hash: '#/galeri', label: 'Galeri Foto', ikon: 'bi-images' },
      { hash: '#/performa', label: 'Performa Kendaraan', ikon: 'bi-graph-up' },
      { hash: '#/rekap', label: 'Rekap Pengeluaran', ikon: 'bi-cash-stack' },
    ],
  },
  {
    label: 'Kartu Flazz',
    items: [
      { hash: '#/flazz/topup', label: 'Top Up', ikon: 'bi-plus-circle' },
      { hash: '#/flazz/rekon', label: 'Rekonsiliasi', ikon: 'bi-check2-all' },
      { hash: '#/flazz', label: 'Daftar Kartu', ikon: 'bi-credit-card-2-front' },
      { hash: '#/flazz/riwayat', label: 'Riwayat', ikon: 'bi-journal-text' },
    ],
  },
  {
    label: 'Konfigurasi',
    items: [
      { hash: '#/master', label: 'Data Master', ikon: 'bi-database' },
      { hash: '#/pengaturan', label: 'Pengaturan', ikon: 'bi-sliders', superOnly: true },
    ],
  },
];

// Thumbnail yang belum dibuat (404) diganti foto penuh dari data-full, sekali saja.
document.addEventListener('error', (ev) => {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement)) return;
  const full = img.dataset.full;
  if (full && img.src !== full) {
    delete img.dataset.full;
    img.src = full;
  }
}, true);

// Pengaturan publik (nama aplikasi, footer); dimuat sekali saat boot dan setelah disimpan.
let pengaturan = { app_name: '', company_name: '', footer_text: '' };

function renderFooter() {
  const slot = document.getElementById('footer-slot');
  if (!slot) return;
  const teks = String(pengaturan.footer_text || '').trim();
  slot.replaceChildren(...(teks ? [el('div', { class: 'app-footer', text: teks })] : []));
}

async function muatPengaturan() {
  try {
    const s = await get('/api/settings');
    pengaturan = { app_name: s.app_name || '', company_name: s.company_name || '', footer_text: s.footer_text || '' };
  } catch {
    // Opsional: tanpa pengaturan, nama bawaan dipakai dan footer disembunyikan.
  }
  renderFooter();
  renderTopbar(window.location.hash || '#/login');
}

export function navUntuk(role) {
  return NAV.map((item) => {
    if (!item.items) return item;
    return { ...item, items: item.items.filter((it) => !it.superOnly || role === 'SUPERADMIN') };
  }).filter((item) => !item.items || item.items.length);
}

// Item aktif: hash sama persis, atau hash termasuk daftar "juga" (awalan rute).
export function itemAktif(activeHash, item) {
  const h = String(activeHash || '').split('?')[0];
  return h === item.hash || (item.juga || []).some((j) => h === j || h.startsWith(j + '/'));
}

const simpan = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* abaikan */ } },
};
const LAYAR_HP = () => window.matchMedia('(max-width: 991.98px)').matches;
// Akordeon: hanya satu grup terbuka. Default = grup berisi halaman aktif; grup yang dibuka
// manual bertahan sampai pindah ke halaman di grup lain.
let grupDibuka = '';

// Tombol ☰: laptop = sembunyikan/tampilkan sidebar (diingat); HP = panel geser.
function toggleSidebar() {
  if (LAYAR_HP()) {
    document.body.classList.toggle('sidebar-buka');
  } else {
    const tutup = !document.body.classList.contains('sidebar-tutup');
    document.body.classList.toggle('sidebar-tutup', tutup);
    simpan.set('sidebar-tutup', tutup ? '1' : '0');
  }
}
document.getElementById('sidebar-latar')?.addEventListener('click', () => document.body.classList.remove('sidebar-buka'));
window.addEventListener('hashchange', () => document.body.classList.remove('sidebar-buka'));
if (simpan.get('sidebar-tutup') === '1') document.body.classList.add('sidebar-tutup');

function linkSidebar(item, activeHash, warn) {
  const on = itemAktif(activeHash, item);
  return el('a', { class: `side-link ${on ? 'active' : ''}`, href: item.hash, 'aria-current': on ? 'page' : null }, [
    el('i', { class: `bi ${item.ikon} side-ikon`, 'aria-hidden': 'true' }),
    el('span', { class: 'side-teks', text: item.label }),
    item.badge && warn > 0 ? el('span', { class: 'badge rounded-pill text-bg-danger ms-auto', text: String(warn) }) : null,
  ]);
}

function grupSidebar(group, activeHash, warn) {
  const buka = grupDibuka === group.label;
  const isi = el('div', { class: 'side-grup-isi' }, group.items.map((it) => linkSidebar(it, activeHash, warn)));
  const kepala = el('button', { type: 'button', class: 'side-grup-kepala', 'aria-expanded': String(buka) }, [
    el('span', { text: group.label }),
    el('i', { class: 'bi bi-chevron-down side-chevron', 'aria-hidden': 'true' }),
  ]);
  const wrap = el('div', { class: `side-grup ${buka ? 'buka' : ''}`, 'data-grup': group.label }, [kepala, isi]);
  kepala.addEventListener('click', () => {
    const jadiBuka = !wrap.classList.contains('buka');
    grupDibuka = jadiBuka ? group.label : '';
    document.querySelectorAll('.side-grup').forEach((g) => {
      const on = g.dataset.grup === grupDibuka;
      g.classList.toggle('buka', on);
      g.querySelector('.side-grup-kepala')?.setAttribute('aria-expanded', String(on));
    });
  });
  return wrap;
}

// Tinggi header dipakai CSS agar sidebar menempel tepat di bawah header yang beku.
function sinkronTinggiHeader() {
  const slot = document.getElementById('topbar-slot');
  document.documentElement.style.setProperty('--tinggi-topbar', slot && slot.offsetHeight ? slot.offsetHeight + 'px' : '58px');
}
window.addEventListener('resize', sinkronTinggiHeader);

function renderTopbar(activeHash) {
  const slot = document.getElementById('topbar-slot');
  const sidebar = document.getElementById('sidebar-slot');
  const user = getUser();
  document.body.classList.toggle('tanpa-sidebar', !user);
  if (!user) {
    slot.replaceChildren();
    sidebar?.replaceChildren();
    return;
  }
  const warn = getJumlahPeringatan();
  const navs = navUntuk(user.role);
  // Pindah ke halaman di grup lain -> grup itu yang terbuka, grup lain tertutup.
  const grupAktif = navs.find((it) => it.items && it.items.some((x) => itemAktif(activeHash, x)));
  if (grupAktif) grupDibuka = grupAktif.label;
  else if (navs.some((it) => !it.items && itemAktif(activeHash, it))) grupDibuka = '';
  sidebar?.replaceChildren(el('nav', { class: 'side-nav' }, navs.map((item) => (item.items ? grupSidebar(item, activeHash, warn) : linkSidebar(item, activeHash, warn)))));

  const tombolMenu = el('button', { type: 'button', class: 'btn btn-outline-secondary btn-sm btn-menu', title: 'Tampilkan/sembunyikan menu', 'aria-label': 'Tampilkan/sembunyikan menu' }, [el('i', { class: 'bi bi-list', 'aria-hidden': 'true' })]);
  tombolMenu.addEventListener('click', toggleSidebar);
  slot.replaceChildren(
    el('div', { class: 'topbar' }, [
      tombolMenu,
      // Nama perusahaan (besar) di atas nama aplikasi (kecil).
      el('div', { class: 'brand' }, [
        pengaturan.company_name ? el('div', { class: 'brand-company', text: pengaturan.company_name }) : null,
        el('div', { class: 'brand-title', text: pengaturan.app_name || 'Monitoring Kendaraan' }),
      ]),
      el('a', {
        class: 'user-info text-decoration-none',
        href: '#/password',
        title: 'Ganti password',
        text: `${user.nama || user.username} · ${user.role}${user.cabang ? ' · ' + user.cabang : ''}`,
      }),
      el('a', { class: 'btn btn-outline-secondary btn-sm', href: '#/password', title: 'Ganti password', 'aria-label': 'Ganti password' }, [el('i', { class: 'bi bi-key', 'aria-hidden': 'true' })]),
      el('button', { class: 'btn btn-outline-secondary btn-sm', id: 'btn-logout', text: 'Keluar' }),
    ]),
  );
  const btn = document.getElementById('btn-logout');
  sinkronTinggiHeader();
  btn.addEventListener('click', async () => {
    try {
      await post('/api/logout', {});
    } catch (err) {
      console.warn('logout ke server gagal, session lokal tetap dibersihkan:', err.message);
    }
    logout();
  });
}

registerRoute('#/login', async () => ({ render: renderLogin }), { guard: false });

registerRoute('#/dashboard', async () => {
  const mod = await import('./pages/dashboard.js');
  return { render: mod.renderDashboard };
});

const historyPage = async () => {
  const mod = await import('./pages/transaksi.js');
  return { render: mod.renderHistory };
};
registerRoute('#/history', historyPage);
// Alamat lama (bookmark) tetap membuka History Laporan.
registerRoute('#/transaksi', historyPage);

registerRoute('#/galeri', async () => {
  const mod = await import('./pages/galeri.js');
  return { render: mod.renderGaleri };
});

registerRoute('#/rekap', async () => {
  const mod = await import('./pages/rekap.js');
  return { render: mod.renderRekap };
});

registerRoute('#/performa', async () => {
  const mod = await import('./pages/performa.js');
  return { render: mod.renderPerforma };
});

registerRoute('#/input', async () => {
  const mod = await import('./pages/input.js');
  return { render: mod.renderInput };
});

registerRoute('#/edit/:id', async () => {
  const mod = await import('./pages/edit.js');
  return { render: mod.renderEdit };
});

const jalurPage = (name) => async () => {
  const mod = await import('./pages/jalur.js');
  return { render: mod[name] };
};
registerRoute('#/jalur', jalurPage('renderJalurList'));
registerRoute('#/jalur/buat', jalurPage('renderJalurBuat'));
registerRoute('#/jalur/ringkasan', jalurPage('renderJalurRingkasan'));
registerRoute('#/jalur/edit/:id', jalurPage('renderJalurEdit'));

registerRoute('#/password', async () => {
  const mod = await import('./pages/password.js');
  return { render: mod.renderPassword };
});

registerRoute('#/pengaturan', async () => {
  const mod = await import('./pages/pengaturan.js');
  return {
    render: (view) => mod.renderPengaturan(view, {
      onTersimpan: (s) => {
        pengaturan = { app_name: s.app_name || '', company_name: s.company_name || '', footer_text: s.footer_text || '' };
        renderFooter();
        renderTopbar(window.location.hash || '#/login');
      },
    }),
  };
});

registerRoute('#/master', async () => {
  const mod = await import('./pages/master.js');
  return { render: mod.renderMaster };
});

const flazzPage = (name) => async () => {
  const mod = await import('./pages/flazz.js');
  return { render: mod[name] };
};
registerRoute('#/flazz', flazzPage('renderFlazzList'));
registerRoute('#/flazz/topup', flazzPage('renderFlazzTopup'));
registerRoute('#/flazz/rekon', flazzPage('renderFlazzRekon'));
registerRoute('#/flazz/riwayat', flazzPage('renderFlazzRiwayat'));

async function boot() {
  const user = await ensureSession();

  const hash = window.location.hash || '#/login';
  renderTopbar(hash);

  window.addEventListener('hashchange', () => renderTopbar(window.location.hash || '#/login'));
  onPeringatanChange(() => renderTopbar(window.location.hash || '#/login'));

  startRouter();
  muatPengaturan();
  // Banner tugas hari ini (kuning sepanjang hari, merah + pop-up mulai 16:30) & service worker push.
  mulaiBanner();
  daftarkanServiceWorker();

  if (!user) {
    window.location.hash = '#/login';
  }
}

boot();
