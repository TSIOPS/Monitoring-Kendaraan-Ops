import { get, post } from '../api.js';
import { setToken, setUser } from '../store.js';
import { el } from '../ui.js';

export function renderLogin(view) {
  const username = el('input', { class: 'form-control', id: 'login-username', name: 'username', autocomplete: 'username' });
  const password = el('input', { class: 'form-control', id: 'login-password', type: 'password', name: 'password', autocomplete: 'current-password' });
  const alertBox = el('div', { id: 'login-alert', class: 'alert alert-danger d-none' });
  const submit = el('button', { class: 'btn btn-primary btn-lg w-100', type: 'submit', text: 'Masuk' });
  const lihat = el('button', { class: 'btn btn-outline-secondary', type: 'button', text: 'Lihat', 'aria-label': 'Tampilkan/Sembunyikan password' });
  lihat.addEventListener('click', () => {
    const tampil = password.type === 'password';
    password.type = tampil ? 'text' : 'password';
    lihat.textContent = tampil ? 'Sembunyi' : 'Lihat';
  });

  const logo = el('div', { class: 'login-logo mb-3' });
  const perusahaan = el('small', { class: 'text-muted d-block mb-1 fw-semibold', text: 'PT Tridaya Sinergi Indonesia' });
  const namaApp = el('h1', { class: 'h4 mb-1', text: 'Monitoring Kendaraan Operasional' });

  const form = el('form', { class: 'needs-validation', novalidate: 'novalidate' }, [
    el('div', { class: 'text-center mb-4' }, [logo, perusahaan, namaApp]),
    el('div', { class: 'mb-3' }, [el('label', { class: 'form-label', for: 'login-username', text: 'Username' }), username]),
    el('div', { class: 'mb-4' }, [el('label', { class: 'form-label', for: 'login-password', text: 'Password' }), el('div', { class: 'input-group' }, [password, lihat])]),
    alertBox,
    submit,
  ]);

  get('/api/settings').then((s) => {
    if (s.logo_url) logo.replaceChildren(el('img', { src: s.logo_url, alt: 'Logo', style: 'max-height:100px;max-width:200px' }));
    if (s.company_name) perusahaan.textContent = s.company_name;
    if (s.app_name) namaApp.textContent = s.app_name;
  }).catch(() => {
    // Pengaturan opsional; form login tetap bisa dipakai.
  });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('d-none');
    const u = username.value.trim();
    const p = password.value;
    if (!u || !p) {
      alertBox.textContent = 'Username dan password wajib diisi.';
      alertBox.classList.remove('d-none');
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Memproses';
    try {
      const data = await post('/api/login', { username: u, password: p });
      setToken(data.token);
      setUser(data.user);
      window.location.hash = '#/dashboard';
    } catch (err) {
      alertBox.textContent = err.message || 'Login gagal.';
      alertBox.classList.remove('d-none');
      password.value = '';
      submit.disabled = false;
      submit.textContent = 'Masuk';
    }
  });

  const wrap = el('div', { class: 'login-wrap' }, [el('div', { class: 'login-card' }, [form])]);
  view.replaceChildren(wrap);
  username.focus();
}
