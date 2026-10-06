import { post } from '../api.js';
import { setToken, setUser } from '../store.js';
import { el } from '../ui.js';

export function renderLogin(view) {
  const username = el('input', { class: 'form-control', id: 'login-username', name: 'username', autocomplete: 'username' });
  const password = el('input', { class: 'form-control', id: 'login-password', type: 'password', name: 'password', autocomplete: 'current-password' });
  const alertBox = el('div', { id: 'login-alert', class: 'alert alert-danger d-none' });
  const submit = el('button', { class: 'btn btn-primary w-100', type: 'submit', text: 'Masuk' });

  const form = el('form', { class: 'needs-validation', novalidate: 'novalidate' }, [
    el('h1', { class: 'h5 mb-3 text-center', text: 'Monitoring Kendaraan Operasional' }),
    alertBox,
    el('div', { class: 'mb-3' }, [el('label', { class: 'form-label', for: 'login-username', text: 'Username' }), username]),
    el('div', { class: 'mb-3' }, [el('label', { class: 'form-label', for: 'login-password', text: 'Password' }), password]),
    submit,
  ]);

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
