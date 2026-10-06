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

  // Zona berbahaya: hanya tampil bila server menyalakan ENABLE_RESET_DATA (sementara, cutover).
  try {
    const { aktif } = await get('/api/settings/reset-status');
    if (aktif) view.appendChild(panelKosongkan());
  } catch {
    // Status tidak terbaca: panel tidak ditampilkan.
  }
  return { ok: true };
}

export const KATA_KONFIRMASI = 'KOSONGKAN';

export function bolehKosongkan(kata, password) {
  return String(kata || '').trim() === KATA_KONFIRMASI && String(password || '') !== '';
}

function panelKosongkan() {
  const kata = el('input', { type: 'text', class: 'form-control', placeholder: KATA_KONFIRMASI, autocomplete: 'off' });
  const password = el('input', { type: 'password', class: 'form-control', autocomplete: 'current-password' });
  const tombol = el('button', { type: 'button', class: 'btn btn-danger', text: 'Kosongkan Data' });
  const hasil = el('div', { class: 'mt-3' });
  tombol.disabled = true;
  const cek = () => { tombol.disabled = !bolehKosongkan(kata.value, password.value); };
  kata.addEventListener('input', cek);
  password.addEventListener('input', cek);

  tombol.addEventListener('click', async () => {
    if (!window.confirm('Yakin mengosongkan SEMUA data operasional? Tindakan ini tidak bisa dibatalkan.')) return;
    tombol.disabled = true;
    tombol.textContent = 'Mengosongkan…';
    try {
      const res = await post('/api/settings/reset-data', { konfirmasi: kata.value.trim(), password: password.value });
      const total = Object.values(res.hapus || {}).reduce((n, x) => n + Number(x || 0), 0);
      hasil.replaceChildren(el('div', { class: 'alert alert-success' }, [
        el('strong', { text: `Data dikosongkan (${total.toLocaleString('id-ID')} baris). ` }),
        'Lanjutkan migrasi data dari export GAS.',
        el('ul', { class: 'small mb-0 mt-2' }, Object.entries(res.hapus || {}).map(([t, n]) => el('li', { text: `${t}: ${Number(n).toLocaleString('id-ID')}` }))),
      ]));
      kata.value = '';
      toast('Data berhasil dikosongkan.', 'success');
    } catch (err) {
      hasil.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    } finally {
      password.value = '';
      tombol.textContent = 'Kosongkan Data';
      cek();
    }
  });

  return el('div', { class: 'panel border-danger' }, [
    el('h2', { class: 'h5 text-danger mb-2', text: 'Zona Berbahaya — Kosongkan Data (Cutover)' }),
    el('div', { class: 'alert alert-warning small' }, [
      el('div', { class: 'fw-bold mb-1', text: 'Tombol sementara untuk cutover dari GAS.' }),
      el('ul', { class: 'mb-0' }, [
        el('li', { text: 'Menghapus semua laporan, jalur, data Flazz, kendaraan, supir, BBM, warehouse, dan audit log.' }),
        el('li', { text: 'Akun pengguna dan pengaturan (logo, nama) TIDAK dihapus; Anda tetap bisa login.' }),
        el('li', { text: 'Tidak bisa dibatalkan. Jalankan migrasi data dari export GAS setelahnya.' }),
      ]),
    ]),
    el('div', { class: 'row g-2 align-items-end' }, [
      el('div', { class: 'col-md-4' }, [el('label', { class: 'form-label', text: `Ketik ${KATA_KONFIRMASI}` }), kata]),
      el('div', { class: 'col-md-4' }, [el('label', { class: 'form-label', text: 'Password Anda' }), password]),
      el('div', { class: 'col-md-4' }, [tombol]),
    ]),
    hasil,
  ]);
}
