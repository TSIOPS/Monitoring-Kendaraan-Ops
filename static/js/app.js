import { getJumlahPeringatan, getUser, logout, onPeringatanChange } from './store.js';
import { get, post } from './api.js';
import { ensureSession, registerRoute, startRouter } from './router.js';
import { el } from './ui.js';
import { renderLogin } from './pages/login.js';

// Grup menu mengikuti sidebar GAS ("Laporan Operasional Kendaraan").
const NAV = [
  { hash: '#/dashboard', label: 'Dashboard', badge: true },
  { hash: '#/jalur', label: 'Jalur' },
  {
    label: 'Laporan Operasional',
    items: [
      { hash: '#/input', label: 'Input Laporan' },
      { hash: '#/history', label: 'History Laporan' },
      { hash: '#/galeri', label: 'Galeri Foto' },
      { hash: '#/performa', label: 'Performa Kendaraan' },
      { hash: '#/rekap', label: 'Rekap Pengeluaran' },
    ],
  },
  { hash: '#/flazz', label: 'Flazz' },
  // Grup ADMIN seperti GAS; Pengaturan hanya SUPERADMIN (grup jadi link biasa bila tinggal satu).
  {
    label: 'Admin',
    items: [
      { hash: '#/master', label: 'Data Master' },
      { hash: '#/pengaturan', label: 'Pengaturan', superOnly: true },
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
let pengaturan = { app_name: '', footer_text: '' };

function renderFooter() {
  const slot = document.getElementById('footer-slot');
  if (!slot) return;
  const teks = String(pengaturan.footer_text || '').trim();
  slot.replaceChildren(...(teks ? [el('div', { class: 'app-footer', text: teks })] : []));
}

async function muatPengaturan() {
  try {
    const s = await get('/api/settings');
    pengaturan = { app_name: s.app_name || '', footer_text: s.footer_text || '' };
  } catch {
    // Opsional: tanpa pengaturan, nama bawaan dipakai dan footer disembunyikan.
  }
  renderFooter();
  renderTopbar(window.location.hash || '#/login');
}

export function navUntuk(role) {
  return NAV.map((item) => {
    if (!item.items) return item;
    const items = item.items.filter((it) => !it.superOnly || role === 'SUPERADMIN');
    return items.length === 1 ? items[0] : { ...item, items };
  });
}

function aktif(activeHash, hash) {
  return activeHash === hash || activeHash.startsWith(hash + '/');
}

function linkNav(item, activeHash, warn, kelas = 'nav-link') {
  const label = item.badge && warn > 0 ? `${item.label} (${warn})` : item.label;
  return el('a', { class: `${kelas} ${aktif(activeHash, item.hash) ? 'active' : ''}`, href: item.hash, text: label });
}

function grupNav(group, activeHash) {
  const adaAktif = group.items.some((it) => aktif(activeHash, it.hash) || (it.hash === '#/history' && aktif(activeHash, '#/edit')));
  const menu = el('div', { class: 'nav-menu' }, group.items.map((it) => linkNav(it, activeHash, 0, 'nav-menu-item')));
  const tombol = el('button', { type: 'button', class: `nav-link nav-group-toggle ${adaAktif ? 'active' : ''}`, 'aria-expanded': 'false', text: `${group.label} ▾` });
  const wrap = el('div', { class: 'nav-group' }, [tombol, menu]);
  tombol.addEventListener('click', (ev) => {
    ev.stopPropagation();
    const buka = !wrap.classList.contains('open');
    document.querySelectorAll('.nav-group.open').forEach((g) => g.classList.remove('open'));
    wrap.classList.toggle('open', buka);
    tombol.setAttribute('aria-expanded', String(buka));
  });
  return wrap;
}

document.addEventListener('click', () => {
  document.querySelectorAll('.nav-group.open').forEach((g) => g.classList.remove('open'));
});

function renderTopbar(activeHash) {
  const slot = document.getElementById('topbar-slot');
  const user = getUser();
  if (!user) {
    slot.replaceChildren();
    return;
  }
  const warn = getJumlahPeringatan();
  const links = navUntuk(user.role).map((item) => (item.items ? grupNav(item, activeHash) : linkNav(item, activeHash, warn)));
  slot.replaceChildren(
    el('div', { class: 'topbar' }, [
      el('span', { class: 'brand', text: pengaturan.app_name || 'Monitoring Kendaraan' }),
      ...links,
      el('span', {
        class: 'user-info',
        text: `${user.nama || user.username} · ${user.role}${user.cabang ? ' · ' + user.cabang : ''}`,
      }),
      el('button', { class: 'btn btn-outline-secondary btn-sm', id: 'btn-logout', text: 'Keluar' }),
    ]),
  );
  const btn = document.getElementById('btn-logout');
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

registerRoute('#/pengaturan', async () => {
  const mod = await import('./pages/pengaturan.js');
  return {
    render: (view) => mod.renderPengaturan(view, {
      onTersimpan: (s) => {
        pengaturan = { app_name: s.app_name || '', footer_text: s.footer_text || '' };
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

  if (!user) {
    window.location.hash = '#/login';
  }
}

boot();
