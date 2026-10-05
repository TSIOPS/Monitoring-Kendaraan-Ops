import { getJumlahPeringatan, getUser, logout, onPeringatanChange } from './store.js';
import { post } from './api.js';
import { ensureSession, registerRoute, startRouter } from './router.js';
import { el } from './ui.js';
import { renderLogin } from './pages/login.js';

const NAV = [
  { hash: '#/transaksi', label: 'Transaksi', badge: true },
  { hash: '#/input', label: 'Input Laporan' },
  { hash: '#/jalur', label: 'Jalur' },
];

function renderTopbar(activeHash) {
  const slot = document.getElementById('topbar-slot');
  const user = getUser();
  if (!user) {
    slot.replaceChildren();
    return;
  }
  const warn = getJumlahPeringatan();
  const links = NAV.map((item) => {
    const label = item.badge && warn > 0 ? `${item.label} (${warn})` : item.label;
    return el('a', {
      class: `nav-link ${activeHash.startsWith(item.hash) ? 'active' : ''}`,
      href: item.hash,
      text: label,
    });
  });
  slot.replaceChildren(
    el('div', { class: 'topbar' }, [
      el('span', { class: 'brand', text: 'Monitoring Kendaraan' }),
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

registerRoute('#/transaksi', async () => {
  const mod = await import('./pages/transaksi.js');
  return { render: mod.renderTransaksi };
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

async function boot() {
  const user = await ensureSession();

  const hash = window.location.hash || '#/login';
  renderTopbar(hash);

  window.addEventListener('hashchange', () => renderTopbar(window.location.hash || '#/login'));
  onPeringatanChange(() => renderTopbar(window.location.hash || '#/login'));

  startRouter();

  if (!user) {
    window.location.hash = '#/login';
  }
}

boot();
