export function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function fmtNum(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return n.toLocaleString('id-ID', { maximumFractionDigits: 2 });
}

export function fmtDateId(value) {
  const raw = String(value ?? '');
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw;
  return `${Number(m[3])}-${Number(m[2])}-${m[1]}`;
}

export function fmtDate(value) {
  const raw = String(value ?? '');
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return fmtDateId(raw);
  return new Date(ms).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = String(value);
    else if (key === 'text') node.textContent = String(value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  }
  for (const child of Array.isArray(children) ? children : [children]) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

let nomorField = 0;
// Label wajib terhubung ke kontrolnya (for=id): dibaca pembaca layar & area tap label ikut memfokuskan input.
export function idUntukLabel(kontrol) {
  if (kontrol.id) return kontrol.id;
  const id = `fld-${++nomorField}`;
  kontrol.setAttribute('id', id);
  return id;
}

// Kontrol bisa dibungkus (input-group/div berisi input file + pratinjau): label menunjuk
// input/select/textarea pertama di dalamnya.
export function barisForm(label, kontrol, catatan = '', kelas = 'mb-3') {
  const target = kontrol.matches?.('input,select,textarea') ? kontrol : kontrol.querySelector?.('input,select,textarea');
  let teksCatatan = null;
  if (catatan) {
    // Catatan dibacakan bersama kontrolnya (aria-describedby), bukan hanya terlihat.
    teksCatatan = el('div', { class: 'form-text', id: `ket-${++nomorField}`, text: catatan });
    if (target) tambahKeterangan(target, teksCatatan.id);
  }
  return el('div', { class: kelas }, [
    el('label', { class: 'form-label', text: label, for: target ? idUntukLabel(target) : null }),
    kontrol,
    teksCatatan,
  ]);
}

// Tambah id ke aria-describedby kontrol (nilai lama dipertahankan, tanpa duplikat).
export function tambahKeterangan(kontrol, id) {
  const ada = String(kontrol.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
  if (!ada.includes(id)) ada.push(id);
  kontrol.setAttribute('aria-describedby', ada.join(' '));
}

// "= Rp 150.000" untuk nominal valid; kosong bila kosong/bukan angka.
export function teksRupiah(nilai) {
  const n = Number(nilai);
  if (nilai === '' || nilai === null || nilai === undefined || !Number.isFinite(n)) return '';
  return `= Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
}

// Teks bantu di bawah input nominal agar 150.000 vs 1.500.000 mudah dibedakan. Mengembalikan
// elemen teks; pemanggil menaruhnya setelah input/input-group. Isi diperbarui pada event
// 'input' — nilai yang diisi lewat kode perlu dispatchEvent(new Event('input')).
// Tanpa aria-live (dibacakan tiap ketukan terlalu ramai); terhubung lewat aria-describedby.
export function bantuRupiah(input) {
  input.setAttribute('inputmode', 'numeric');
  const teks = el('div', { class: 'form-text fw-semibold', id: `rp-${++nomorField}` });
  tambahKeterangan(input, teks.id);
  const segar = () => { teks.textContent = teksRupiah(input.value); };
  input.addEventListener('input', segar);
  segar();
  return teks;
}

// Pemanggil lama memakai nama kelas Bootstrap ('danger'); semua dipetakan ke gaya toast yang ada.
const PETA_JENIS = { danger: 'error', warning: 'warning', error: 'error', success: 'success', info: 'info' };
export const jenisToast = (kind) => PETA_JENIS[kind] || 'info';

// Toast diumumkan pembaca layar (galat: role=alert, lainnya: status) dan bisa ditutup; galat tampil lebih lama.
// Role hanya di <span> pesan (bukan node berisi tombol ×, agar "Tutup notifikasi" tidak ikut dibaca).
// Span disisipkan kosong lalu diisi di tick berikutnya: VoiceOver hanya mengumumkan perubahan isi
// region yang sudah ada, bukan region yang muncul sudah berisi.
export function toast(message, kind = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', class: 'toast-host' });
    document.body.appendChild(host);
  }
  const jenis = jenisToast(kind);
  const tutup = el('button', { type: 'button', class: 'toast-tutup', 'aria-label': 'Tutup notifikasi', text: '×' });
  const pesan = el('span', { role: jenis === 'error' ? 'alert' : 'status' });
  const node = el('div', { class: `toast-item toast-${jenis}` }, [pesan, tutup]);
  tutup.addEventListener('click', () => node.remove());
  host.appendChild(node);
  setTimeout(() => { pesan.textContent = String(message); }, 0);
  setTimeout(() => node.remove(), jenis === 'error' ? 10000 : 4000);
}

// Galat form selalu di-scroll ke tengah layar dan difokuskan (fokus membuat pembaca layar
// membacakannya — tanpa role=alert agar tidak diumumkan dua kali); tombol Simpan ada di bawah
// form panjang, jadi galat di atas form sebelumnya tidak terlihat di HP.
// Tanpa `pesan`: isi kotak yang sudah dibangun pemanggil (mis. pesan + tautan) dipertahankan.
export function tampilkanGalat(box, pesan) {
  if (pesan !== undefined) box.textContent = pesan;
  box.setAttribute('tabindex', '-1');
  box.classList.remove('d-none');
  const kurangiGerak = typeof globalThis.matchMedia === 'function' && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches;
  box.scrollIntoView?.({ block: 'center', behavior: kurangiGerak ? 'auto' : 'smooth' });
  box.focus?.({ preventScroll: true });
}

export function confirmDialog(message) {
  return window.confirm(message);
}

export function spinner(view, text = 'Memuat data') {
  view.replaceChildren(el('div', { class: 'loading text-muted', text }));
}

// Potong daftar per halaman; nomor dibatasi ke rentang yang ada.
export function halaman(list, nomor, per = 10) {
  const total = Math.max(1, Math.ceil(list.length / per));
  const aktif = Math.min(Math.max(1, nomor), total);
  return { total, aktif, isi: list.slice((aktif - 1) * per, aktif * per) };
}

// Tombol « 1 2 3 » seperti renderDashPagination GAS; kosong bila hanya satu halaman.
export function navHalaman(total, aktif, keHalaman) {
  const wrap = el('div', { class: 'd-flex justify-content-center gap-2 flex-wrap mt-3' });
  if (total <= 1) return wrap;
  const tombol = (label, ke, sekarang = false, mati = false) => {
    const b = el('button', { type: 'button', class: `btn btn-sm ${sekarang ? 'btn-primary' : 'btn-outline-primary'}`, text: label });
    b.disabled = mati;
    b.addEventListener('click', () => keHalaman(ke));
    return b;
  };
  wrap.append(
    tombol('«', aktif - 1, false, aktif === 1),
    ...Array.from({ length: total }, (_, i) => tombol(String(i + 1), i + 1, i + 1 === aktif)),
    tombol('»', aktif + 1, false, aktif === total),
  );
  return wrap;
}

// Pratinjau besar foto odometer agar angka KM dan bar bensin terbaca sebelum disimpan.
// urlAwal: foto yang sudah tersimpan (halaman edit); diganti saat file baru dipilih.
export function pratinjauFoto(input, urlAwal = '') {
  const kotak = el('div', { class: 'foto-preview mt-2' });
  let objekUrl = '';
  const tampil = (src, judul) => {
    if (!src) {
      kotak.replaceChildren(el('div', { class: 'foto-preview-kosong', text: 'Belum ada foto' }));
      return;
    }
    kotak.replaceChildren(el('a', { href: src, target: '_blank', rel: 'noopener', title: 'Buka ukuran penuh' }, [el('img', { src, alt: judul })]));
  };
  input.addEventListener('change', () => {
    if (objekUrl) URL.revokeObjectURL(objekUrl);
    const file = input.files && input.files[0];
    objekUrl = file ? URL.createObjectURL(file) : '';
    tampil(objekUrl || urlAwal, file ? file.name : 'Foto tersimpan');
  });
  tampil(urlAwal, 'Foto tersimpan');
  return kotak;
}

// Kolom driver/kendaraan di data Flazz berisi campuran KODE master (mis. supir default
// kartu: "DRV-…") dan NAMA (dari laporan/jalur). Kode diterjemahkan; nama dibiarkan.
export function petaMaster(master) {
  const supir = new Map((master?.drivers || []).map((d) => [String(d.id), String(d.nama || d.id)]));
  const kendaraan = new Map((master?.vehicles || []).map((v) => [String(v.vehicle_id), String(v.plat_nomor || v.vehicle_id).trim()]));
  return { supir, kendaraan };
}

export function labelDari(nilai, peta) {
  const s = String(nilai ?? '').trim();
  return s ? peta.get(s) || s : '';
}

// Refresh otomatis halaman daftar: tiap `ms` selama halaman ini masih tampil & tab terlihat,
// dan langsung saat tab dibuka lagi. Dilewati bila pengguna sedang mengetik/memilih di
// halaman atau `sibuk()` true (mis. form edit terbuka) agar isian tidak hilang.
export function autoRefresh(view, muat, { ms = 30_000, sibuk = () => false } = {}) {
  const hash = String(window.location.hash || '').split('?')[0];
  let jalan = false;
  // Satu refresh aktif per view: render ulang halaman yang sama menggantikan yang lama.
  const token = String(Math.random());
  view.dataset.autoRefresh = token;
  const masihDiHalaman = () => String(window.location.hash || '').split('?')[0] === hash && view.isConnected && view.dataset.autoRefresh === token;
  const tick = async () => {
    if (!masihDiHalaman()) { berhenti(); return; }
    if (document.hidden || jalan) return;
    const aktif = document.activeElement;
    if (aktif && view.contains(aktif) && /^(INPUT|TEXTAREA|SELECT)$/.test(aktif.tagName)) return;
    if (sibuk()) return;
    jalan = true;
    try { await muat(); } catch { /* refresh diam: abaikan galat jaringan sesaat */ } finally { jalan = false; }
  };
  const id = setInterval(tick, ms);
  const saatTerlihat = () => { if (!document.hidden) tick(); };
  document.addEventListener('visibilitychange', saatTerlihat);
  function berhenti() {
    clearInterval(id);
    document.removeEventListener('visibilitychange', saatTerlihat);
  }
  window.addEventListener('hashchange', () => { if (!masihDiHalaman()) berhenti(); });
  return berhenti;
}

// Tombol aksi berupa ikon (label di title/tooltip & aria-label). Beri `href` untuk tautan.
// Jenis umum: edit, hapus, nonaktif, aktif, lepas, oli, lihat.
export const IKON_AKSI = {
  edit: ['bi-pencil', 'btn-outline-primary'],
  hapus: ['bi-trash', 'btn-outline-danger'],
  nonaktif: ['bi-slash-circle', 'btn-outline-danger'],
  aktif: ['bi-check-circle', 'btn-outline-success'],
  lepas: ['bi-credit-card-2-back', 'btn-outline-warning'],
  oli: ['bi-droplet', 'btn-outline-secondary'],
  lihat: ['bi-image', 'btn-outline-secondary'],
};
export function tombolIkon(jenis, judul, aksi) {
  const [ikon, kelas] = IKON_AKSI[jenis] || ['bi-three-dots', 'btn-outline-secondary'];
  const attrs = { class: `btn btn-sm ${kelas}`, title: judul, 'aria-label': judul };
  const node = typeof aksi === 'string'
    ? el('a', { ...attrs, href: aksi })
    : el('button', { ...attrs, type: 'button', onclick: aksi });
  node.appendChild(el('i', { class: `bi ${ikon}`, 'aria-hidden': 'true' }));
  return node;
}
export const grupAksi = (tombol) => el('div', { class: 'aksi-ikon' }, tombol.filter(Boolean));
