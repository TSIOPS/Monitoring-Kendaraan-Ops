import { post } from '../api.js';
import { getUser } from '../store.js';
import { el, toast } from '../ui.js';

export const PANJANG_MIN = 6;

// Validasi form ganti password; kosong bila valid.
export function cekGantiPassword(lama, baru, ulang) {
  const err = [];
  if (!lama) err.push('Password lama wajib diisi.');
  if (String(baru || '').length < PANJANG_MIN) err.push(`Password baru minimal ${PANJANG_MIN} karakter.`);
  if (baru && baru === lama) err.push('Password baru harus berbeda dari password lama.');
  if (baru !== ulang) err.push('Ulangi password baru tidak sama.');
  return err;
}

export async function renderPassword(view) {
  const user = getUser() || {};
  const input = (id, auto) => el('input', { type: 'password', class: 'form-control', id, autocomplete: auto });
  const lama = input('pw-lama', 'current-password');
  const baru = input('pw-baru', 'new-password');
  const ulang = input('pw-ulang', 'new-password');
  const lihat = el('input', { type: 'checkbox', class: 'form-check-input', id: 'pw-lihat' });
  lihat.addEventListener('change', () => { for (const x of [lama, baru, ulang]) x.type = lihat.checked ? 'text' : 'password'; });
  const alertBox = el('div', { class: 'alert alert-danger d-none' });
  const simpan = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Simpan Password' });
  const baris = (label, kontrol, catatan) => el('div', { class: 'mb-3' }, [
    el('label', { class: 'form-label', for: kontrol.id, text: label }), kontrol, catatan ? el('div', { class: 'form-text', text: catatan }) : null,
  ]);

  const form = el('form', { novalidate: 'novalidate' }, [
    alertBox,
    baris('Password lama', lama),
    baris('Password baru', baru, `Minimal ${PANJANG_MIN} karakter.`),
    baris('Ulangi password baru', ulang),
    el('div', { class: 'form-check mb-3' }, [lihat, el('label', { class: 'form-check-label', for: 'pw-lihat', text: 'Tampilkan password' })]),
    el('div', { class: 'd-flex gap-2' }, [simpan, el('a', { class: 'btn btn-outline-secondary', href: '#/dashboard', text: 'Batal' })]),
  ]);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('d-none');
    const err = cekGantiPassword(lama.value, baru.value, ulang.value);
    if (err.length) {
      alertBox.textContent = err.join(' ');
      alertBox.classList.remove('d-none');
      return;
    }
    simpan.disabled = true;
    simpan.textContent = 'Menyimpan';
    try {
      const res = await post('/api/password', { password_lama: lama.value, password_baru: baru.value });
      toast(res.msg || 'Password berhasil diganti.', 'success');
      for (const x of [lama, baru, ulang]) x.value = '';
      window.location.hash = '#/dashboard';
    } catch (e) {
      alertBox.textContent = e.message || 'Gagal mengganti password.';
      alertBox.classList.remove('d-none');
    } finally {
      simpan.disabled = false;
      simpan.textContent = 'Simpan Password';
    }
  });

  view.replaceChildren(el('div', { class: 'panel', style: 'max-width:480px;margin:0 auto' }, [
    el('h2', { class: 'h5 mb-1', text: 'Ganti Password' }),
    el('div', { class: 'text-muted small mb-3', text: `Akun: ${user.username || '-'}${user.nama ? ' (' + user.nama + ')' : ''}` }),
    form,
  ]));
  lama.focus();
  return { ok: true };
}
