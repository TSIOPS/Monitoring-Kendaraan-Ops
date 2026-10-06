import { get } from '../api.js';
import { el, fmtDateId, halaman as potong, navHalaman } from '../ui.js';

export const GALERI_PER_HALAMAN = 10;

const JENIS = [
  { value: 'all', label: 'Semua Foto' },
  { value: 'odo_awal', label: 'KM Awal' },
  { value: 'odo_akhir', label: 'KM Akhir' },
  { value: 'struk_bbm', label: 'Struk BBM' },
  { value: 'struk_toll', label: 'Struk Tol' },
];
const SLOT = [
  { jenis: 'odo_awal', label: 'KM Awal', rasio: '4/3' },
  { jenis: 'odo_akhir', label: 'KM Akhir', rasio: '4/3' },
  { jenis: 'struk_bbm', label: 'Struk BBM', rasio: '3/4' },
  { jenis: 'struk_toll', label: 'Struk Tol', rasio: '3/4' },
];

// Transaksi yang punya foto sesuai jenis terpilih (renderGalleryPage GAS).
export function saringGaleri(rows, jenis) {
  return (rows || []).filter((r) => (jenis && jenis !== 'all'
    ? Boolean(r[`foto_${jenis}`])
    : Boolean(r.foto_odo_awal || r.foto_odo_akhir || r.foto_struk_bbm || r.foto_struk_toll)));
}

export function halaman(list, nomor, per = GALERI_PER_HALAMAN) {
  return potong(list, nomor, per);
}

function kartuFoto(r, jenis) {
  const slot = jenis === 'all' ? SLOT.filter((s) => s.jenis.startsWith('odo') || r[`foto_${s.jenis}`]) : SLOT.filter((s) => s.jenis === jenis);
  return el('div', { class: 'col-12 col-md-6 col-lg-4' }, [el('div', { class: 'border rounded-3 bg-white h-100' }, [
    el('div', { class: 'd-flex justify-content-between align-items-center bg-light px-3 py-2 rounded-top' }, [
      el('span', { text: fmtDateId(r.tanggal) }),
      el('small', { class: 'fw-bold text-truncate', style: 'max-width:150px', title: r.supir || '', text: r.supir || '-' }),
    ]),
    el('div', { class: 'row g-2 p-3' }, slot.map((s) => {
      const url = r[`foto_${s.jenis}`];
      const thumb = r[`foto_${s.jenis}_thumb`] || url;
      return el('div', { class: `${jenis === 'all' ? 'col-6' : 'col-12'} text-center` }, [
        el('small', { class: 'd-block mb-1 text-muted', text: s.label }),
        url
          ? el('a', { href: url, target: '_blank', rel: 'noopener' }, [el('img', { src: thumb, 'data-full': url, alt: s.label, loading: 'lazy', class: 'img-fluid rounded border', style: `aspect-ratio:${s.rasio};object-fit:cover;width:100%` })])
          : el('span', { class: 'text-muted small', text: '-' }),
      ]);
    })),
    el('div', { class: 'px-3 pb-2 small text-muted', text: r.vehicle || '' }),
  ])]);
}

export async function renderGaleri(view) {
  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat galeri' }));
  let rows;
  try {
    ({ transactions: rows = [] } = await get('/api/dashboard'));
  } catch (err) {
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }

  const pilih = el('select', { class: 'form-select form-select-sm', style: 'max-width:200px' }, JENIS.map((j) => el('option', { value: j.value, text: j.label })));
  const isi = el('div', { class: 'row g-3' });
  const nav = el('div', {});
  let nomor = 1;

  function gambar() {
    const list = saringGaleri(rows, pilih.value);
    const h = halaman(list, nomor);
    nomor = h.aktif;
    isi.replaceChildren(...(list.length
      ? h.isi.map((r) => kartuFoto(r, pilih.value))
      : [el('div', { class: 'col-12 text-center text-muted py-4', text: 'Belum ada foto operasional. Foto akan muncul setelah laporan harian dibuat.' })]));
    nav.replaceChildren(navHalaman(h.total, nomor, (ke) => { nomor = ke; gambar(); window.scrollTo(0, 0); }));
  }
  pilih.addEventListener('change', () => { nomor = 1; gambar(); });

  view.replaceChildren(el('div', { class: 'panel' }, [
    el('div', { class: 'd-flex flex-column flex-md-row justify-content-between align-items-md-center gap-2 mb-3 pb-2 border-bottom' }, [
      el('h2', { class: 'h5 mb-0', text: 'Galeri Foto Operasional' }),
      el('div', { class: 'd-flex align-items-center gap-2' }, [el('label', { class: 'small fw-bold text-muted text-uppercase text-nowrap', text: 'Jenis Foto:' }), pilih]),
    ]),
    isi,
    nav,
  ]));
  gambar();
  return { ok: true };
}
