import { get, post, put } from '../api.js';
import { getUser } from '../store.js';
import { el, toast } from '../ui.js';

export const MAKS_LOGO = 10 * 1024 * 1024;
const TIPE_LOGO = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

// Validasi file logo sebelum diunggah; kosong bila valid.
export function cekLogo(file) {
  if (!file) return '';
  if (!TIPE_LOGO.includes(file.type)) return 'Format logo harus PNG, JPG, WEBP, atau GIF.';
  if (file.size > MAKS_LOGO) return 'Ukuran logo tidak boleh melebihi 10MB.';
  return '';
}

export function bodyPengaturan(v) {
  return { app_name: String(v.app_name || '').trim(), company_name: String(v.company_name || '').trim(), footer_text: String(v.footer_text || '').trim() };
}

const bacaDataUrl = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result));
  r.onerror = () => reject(new Error('Gagal membaca file logo.'));
  r.readAsDataURL(file);
});

export async function renderPengaturan(view, { onTersimpan } = {}) {
  if (getUser()?.role !== 'SUPERADMIN') {
    view.replaceChildren(el('div', { class: 'alert alert-warning', text: 'Halaman Pengaturan hanya untuk SUPERADMIN.' }));
    return { ok: false };
  }
  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat pengaturan' }));
  let s;
  try {
    s = await get('/api/settings');
  } catch (err) {
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }

  const pratinjau = el('div', { class: 'logo-preview mb-3' });
  const tampilLogo = (src) => pratinjau.replaceChildren(src
    ? el('img', { src, alt: 'Logo aplikasi' })
    : el('div', { class: 'text-muted small', text: 'Belum ada logo' }));
  tampilLogo(s.logo_url);

  const fileLogo = el('input', { type: 'file', accept: TIPE_LOGO.join(','), class: 'd-none' });
  const pilihLogo = el('button', { type: 'button', class: 'btn btn-outline-primary', text: 'Pilih Logo Baru' });
  const batalLogo = el('button', { type: 'button', class: 'btn btn-link btn-sm d-none', text: 'Batal ganti logo' });
  const infoLogo = el('div', { class: 'small text-muted mt-2' });
  let objekUrl = '';
  pilihLogo.addEventListener('click', () => fileLogo.click());
  const resetLogo = () => {
    fileLogo.value = '';
    if (objekUrl) URL.revokeObjectURL(objekUrl);
    objekUrl = '';
    tampilLogo(s.logo_url);
    infoLogo.textContent = '';
    batalLogo.classList.add('d-none');
  };
  fileLogo.addEventListener('change', () => {
    const file = fileLogo.files && fileLogo.files[0];
    const salah = cekLogo(file);
    if (salah) { toast(salah, 'error'); resetLogo(); return; }
    if (!file) { resetLogo(); return; }
    if (objekUrl) URL.revokeObjectURL(objekUrl);
    objekUrl = URL.createObjectURL(file);
    tampilLogo(objekUrl);
    infoLogo.textContent = `${file.name} — akan diunggah saat Simpan.`;
    batalLogo.classList.remove('d-none');
  });
  batalLogo.addEventListener('click', resetLogo);

  const appName = el('input', { type: 'text', class: 'form-control', placeholder: 'Monitoring Kendaraan Operasional', value: s.app_name || '' });
  const company = el('input', { type: 'text', class: 'form-control', placeholder: 'PT Tridaya Sinergi Indonesia', value: s.company_name || '' });
  const footer = el('input', { type: 'text', class: 'form-control', placeholder: '© 2026 Tridaya Sinergi Indonesia', value: s.footer_text || '' });
  const simpan = el('button', { type: 'button', class: 'btn btn-primary btn-lg w-100', text: 'Simpan Pengaturan' });

  simpan.addEventListener('click', async () => {
    simpan.disabled = true;
    simpan.textContent = 'Menyimpan';
    try {
      const file = fileLogo.files && fileLogo.files[0];
      const body = bodyPengaturan({ app_name: appName.value, company_name: company.value, footer_text: footer.value });
      if (file) {
        const up = await post('/api/settings/logo', { base64Data: await bacaDataUrl(file), fileName: file.name });
        body.logo_url = up.url;
      }
      await put('/api/settings', body);
      s = await get('/api/settings');
      resetLogo();
      appName.value = s.app_name || '';
      company.value = s.company_name || '';
      footer.value = s.footer_text || '';
      toast('Pengaturan berhasil disimpan.', 'success');
      if (onTersimpan) onTersimpan(s);
    } catch (err) {
      toast(err.message || 'Gagal menyimpan pengaturan.', 'error');
    } finally {
      simpan.disabled = false;
      simpan.textContent = 'Simpan Pengaturan';
    }
  });

  const baris = (label, kontrol, catatan) => el('div', { class: 'mb-3' }, [
    el('label', { class: 'form-label', text: label }), kontrol, catatan ? el('div', { class: 'form-text', text: catatan }) : null,
  ]);

  view.replaceChildren(el('div', { class: 'panel' }, [
    el('h2', { class: 'h5 mb-3 pb-2 border-bottom', text: 'Pengaturan Aplikasi' }),
    el('div', { class: 'row g-4' }, [
      el('div', { class: 'col-md-6' }, [el('div', { class: 'form-section h-100 text-center' }, [
        el('div', { class: 'form-section-title text-start', text: 'Logo Aplikasi' }),
        pratinjau,
        el('p', { class: 'text-muted small mb-2' }, ['Format: PNG, JPG, WEBP, GIF', el('br'), 'Maks. 10MB (disarankan di bawah 200KB, ±200×200px)']),
        fileLogo, pilihLogo, el('div', {}, [batalLogo]), infoLogo,
        el('div', { class: 'mb-3' }),
      ])]),
      el('div', { class: 'col-md-6' }, [el('div', { class: 'form-section h-100' }, [
        el('div', { class: 'form-section-title', text: 'Info Aplikasi' }),
        baris('Nama Aplikasi', appName, 'Tampil di halaman login dan menu atas.'),
        baris('Nama Perusahaan', company, 'Tampil di halaman login.'),
        baris('Footer Text', footer, 'Tampil di bagian bawah setiap halaman. Kosongkan untuk menyembunyikan.'),
      ])]),
    ]),
    el('div', { class: 'mt-4' }, [simpan]),
  ]));
  return { ok: true };
}
