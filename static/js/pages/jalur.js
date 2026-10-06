import { del, get, post, put } from '../api.js';
import { getRouteParam } from '../router.js';
import { getUser } from '../store.js';
import { confirmDialog, el, fmtDateId, toast } from '../ui.js';
import { tanggalWib } from './input.js';

// Halaman Jalur Pengiriman (M8): daftar, buat, edit, ringkasan.

const LABEL_STATUS = { BELUM_DIISI: 'Belum diisi', SUDAH_LAPORAN: 'Sudah laporan', SELESAI: 'Selesai' };
const KELAS_STATUS = { BELUM_DIISI: 'badge-ef-waspada', SUDAH_LAPORAN: 'badge-ef-kurang-data', SELESAI: 'badge-ef-baik' };
const KELAS_DOKUMEN = { AMAN: 'badge-ef-baik', WASPADA: 'badge-ef-waspada', KRITIS: 'badge-ef-buruk', LEWAT: 'badge-ef-buruk' };

export function teksDokumen(status, sisaHari) {
  if (status === 'TIDAK_ADA' || sisaHari === null || sisaHari === undefined) return '-';
  if (status === 'LEWAT') return `Lewat ${Math.abs(Number(sisaHari))} hari`;
  return `${sisaHari} hari`;
}

// Badge dokumen pada ringkasan jalur, sama seperti jalurPajakBadge GAS.
export function badgeDokumenRingkasan(status, sisaHari, label) {
  if (status === 'TIDAK_ADA' || sisaHari === null || sisaHari === undefined) return { text: `${label} -`, kelas: 'bg-secondary' };
  if (status === 'LEWAT') return { text: `${label} lewat ${Math.abs(Number(sisaHari))} hari`, kelas: 'bg-dark' };
  const kelas = status === 'KRITIS' ? 'bg-danger' : status === 'WASPADA' ? 'bg-warning text-dark' : 'bg-success';
  return { text: `${label} habis dalam ${sisaHari} hari`, kelas };
}

// Baris form buat jalur yang lengkap (driver, kendaraan, rute) beserta pesan untuk yang tidak lengkap.
export function kumpulkanBaris(rows) {
  const valid = [];
  const err = [];
  rows.forEach((r, i) => {
    const kosong = !r.driver_id && !r.vehicle_id && !String(r.rute_tujuan || '').trim();
    if (kosong) return;
    if (!r.driver_id || !r.vehicle_id || !String(r.rute_tujuan || '').trim()) {
      err.push(`Baris ${i + 1}: driver, kendaraan, dan rute wajib diisi.`);
      return;
    }
    if (r.driver2_id && r.driver2_id === r.driver_id) {
      err.push(`Baris ${i + 1}: Driver 2 harus berbeda dari Driver 1.`);
      return;
    }
    if (r.etoll_card_id && r.etoll_card_id === r.etoll_card_id_2) {
      err.push(`Baris ${i + 1}: kartu etoll ke-2 harus berbeda dari kartu etoll ke-1.`);
      return;
    }
    valid.push(r);
  });
  if (!valid.length && !err.length) err.push('Isi minimal satu baris jalur.');
  return { valid, err };
}

const isSuper = () => String(getUser()?.role || '').toUpperCase() === 'SUPERADMIN';

function isiOpsi(select, items, placeholder) {
  select.replaceChildren(el('option', { value: '', text: placeholder }));
  for (const it of items) select.appendChild(el('option', { value: String(it.value), text: String(it.label) }));
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const PATH_TRUK = 'M0 3.5A1.5 1.5 0 0 1 1.5 2h9A1.5 1.5 0 0 1 12 3.5V5h1.02a1.5 1.5 0 0 1 1.17.563l1.481 1.85a1.5 1.5 0 0 1 .329.938V10.5a1.5 1.5 0 0 1-1.5 1.5H14a2 2 0 1 1-4 0H5a2 2 0 1 1-3.998-.085A1.5 1.5 0 0 1 0 10.5zm1.294 7.456A2 2 0 0 1 4.732 11h5.536a2 2 0 0 1 .732-.732V3.5a.5.5 0 0 0-.5-.5h-9a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .294.456M12 10a2 2 0 0 1 1.732 1h.768a.5.5 0 0 0 .5-.5V8.35a.5.5 0 0 0-.11-.312l-1.48-1.85A.5.5 0 0 0 13.02 6H12zm-9 1a1 1 0 1 0 0 2 1 1 0 0 0 0-2m9 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2';
const PATH_MOTOR = 'M4 4.5a.5.5 0 0 1 .5-.5H6a.5.5 0 0 1 0 1v.5h4.14l.386-1.158A.5.5 0 0 1 11 4h1a.5.5 0 0 1 0 1h-.64l-.311.935.807 1.29a3 3 0 1 1-.848.53l-.508-.812-2.076 3.322A.5.5 0 0 1 8 10.5H5.959a3 3 0 1 1-1.815-3.274L5 5.856V5h-.5a.5.5 0 0 1-.5-.5m1.5 2.443-.508.814c.5.444.85 1.054.967 1.743h1.139zM8 9.057 9.598 6.5H6.402zM4.937 9.5a2 2 0 0 0-.487-.877l-.548.877zM3.603 8.092A2 2 0 1 0 4.937 10.5H3a.5.5 0 0 1-.424-.765zm7.947.53a2 2 0 1 0 .848-.53l1.026 1.643a.5.5 0 1 1-.848.53z';
function ikonKendaraan(jenis) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ width: '16', height: '16', viewBox: '0 0 16 16', fill: 'currentColor', class: 'text-success me-1' })) svg.setAttribute(k, v);
  const pathEl = document.createElementNS(SVG_NS, 'path');
  pathEl.setAttribute('d', jenis === 'Motor' ? PATH_MOTOR : PATH_TRUK);
  svg.appendChild(pathEl);
  return svg;
}

function badge(text, kelas) {
  return el('span', { class: `badge-status ${kelas || ''}`, text });
}

const baris = (label, kontrol) => el('div', { class: 'mb-3' }, [el('label', { class: 'form-label', text: label }), kontrol]);

async function muatMaster() {
  const m = await get('/api/master');
  return {
    vehicles: Array.isArray(m.vehicles) ? m.vehicles : [],
    drivers: Array.isArray(m.drivers) ? m.drivers : [],
    cards: (Array.isArray(m.flazzCards) ? m.flazzCards : []).filter((c) => String(c.status) !== 'NONAKTIF'),
    cabang: Array.isArray(m.cabangList) ? m.cabangList : [],
  };
}

// Filter warehouse hanya untuk SUPERADMIN; PIC selalu cabangnya sendiri (dibatasi server).
function pilihWarehouse(cabangList) {
  const sel = el('select', { class: 'form-select' });
  isiOpsi(sel, cabangList.map((c) => ({ value: c.kode, label: c.nama || c.kode })), 'Semua warehouse');
  return sel;
}

function opsiCabang(list, cabang, key) {
  return cabang ? list.filter((x) => String(x[key]) === cabang) : list;
}

// ── Daftar ────────────────────────────────────────────────────────────────
export async function renderJalurList(view) {
  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat' }));
  let master;
  try {
    master = await muatMaster();
  } catch (err) {
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }

  const dari = el('input', { type: 'date', class: 'form-control', value: tanggalWib() });
  const sampai = el('input', { type: 'date', class: 'form-control', value: tanggalWib() });
  const wh = pilihWarehouse(master.cabang);
  const hasil = el('div', {});

  async function tampilkan() {
    hasil.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat jalur' }));
    const q = new URLSearchParams({ tanggal: dari.value, tanggal_akhir: sampai.value || dari.value });
    if (isSuper() && wh.value) q.set('cabang', wh.value);
    let data;
    try {
      data = await get(`/api/jalur?${q}`);
    } catch (err) {
      hasil.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
      return;
    }
    const list = Array.isArray(data.list) ? data.list : [];
    if (!list.length) {
      hasil.replaceChildren(el('div', { class: 'text-muted', text: 'Tidak ada jalur pada rentang ini.' }));
      return;
    }
    const tbody = el('tbody', {}, list.map((j) => el('tr', {}, [
      el('td', { text: fmtDateId(j.tanggal) }),
      el('td', {}, [el('div', { text: j.plat_nomor || '-' }), el('div', { class: 'small text-muted', text: j.nama_kendaraan || '' })]),
      el('td', {}, [el('div', { text: j.nama_driver || '-' }), j.nama_driver2 ? el('div', { class: 'small text-muted', text: j.nama_driver2 }) : null]),
      el('td', { text: j.rute_tujuan || '-' }),
      el('td', {}, [el('div', { text: j.flazz_card_name || (j.flazz_card_id ? j.flazz_card_id : '-') }), j.flazz_card_id_2 ? el('div', { class: 'small text-muted', text: j.flazz_card_name_2 || j.flazz_card_id_2 }) : null]),
      el('td', {}, [badge(LABEL_STATUS[j.status] || j.status, KELAS_STATUS[j.status])]),
      el('td', {}, [badge(teksDokumen(j.status_pajak, j.sisa_hari_pajak), KELAS_DOKUMEN[j.status_pajak])]),
      el('td', {}, [
        el('a', { class: 'btn btn-sm btn-outline-primary me-1', href: `#/jalur/edit/${encodeURIComponent(j.id)}`, text: 'Edit' }),
        el('button', { class: 'btn btn-sm btn-outline-danger', type: 'button', text: 'Hapus', onclick: () => hapus(j) }),
      ]),
    ])));
    hasil.replaceChildren(el('div', { class: 'table-wrap' }, [
      el('table', { class: 'table table-sm align-middle' }, [
        el('thead', {}, [el('tr', {}, ['Tanggal', 'Kendaraan', 'Driver', 'Rute', 'Etoll', 'Status', 'Pajak', 'Aksi'].map((t) => el('th', { text: t })))]),
        tbody,
      ]),
    ]));
  }

  async function hapus(j) {
    if (!confirmDialog(`Hapus jalur ${j.plat_nomor} (${fmtDateId(j.tanggal)})? Kartu etoll yang terpasang akan dikembalikan.`)) return;
    try {
      const res = await del(`/api/jalur/${encodeURIComponent(j.id)}`);
      toast(res.msg || 'Jadwal dihapus.', 'success');
      await tampilkan();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  view.replaceChildren(el('div', { class: 'panel' }, [
    el('div', { class: 'd-flex flex-wrap gap-2 justify-content-between align-items-center mb-3' }, [
      el('h2', { class: 'h6 m-0', text: 'Daftar Jalur Pengiriman' }),
      el('div', { class: 'd-flex gap-2' }, [
        el('a', { class: 'btn btn-sm btn-primary', href: '#/jalur/buat', text: 'Buat Jalur' }),
        el('a', { class: 'btn btn-sm btn-outline-secondary', href: '#/jalur/ringkasan', text: 'Ringkasan' }),
      ]),
    ]),
    el('div', { class: 'row g-2 mb-3' }, [
      isSuper() ? el('div', { class: 'col-md-3' }, [baris('Warehouse', wh)]) : null,
      el('div', { class: 'col-md-3' }, [baris('Dari tanggal', dari)]),
      el('div', { class: 'col-md-3' }, [baris('Sampai tanggal', sampai)]),
      el('div', { class: 'col-md-3 d-flex align-items-end mb-3' }, [el('button', { class: 'btn btn-primary', type: 'button', text: 'Tampilkan', onclick: tampilkan })]),
    ]),
    hasil,
  ]));
  await tampilkan();
  return { ok: true };
}

// ── Form baris (buat & edit) ───────────────────────────────────────────────
function formBaris(master, cabang, nilai = {}) {
  const drv = (placeholder) => {
    const s = el('select', { class: 'form-select form-select-sm' });
    isiOpsi(s, opsiCabang(master.drivers, cabang, 'cabang').map((d) => ({ value: d.id, label: d.nama })), placeholder);
    return s;
  };
  const f = {
    driver_id: drv('— driver 1 —'),
    driver2_id: drv('— driver 2 (opsional) —'),
    vehicle_id: el('select', { class: 'form-select form-select-sm' }),
    rute_tujuan: el('input', { class: 'form-control form-control-sm', placeholder: 'Gudang A - Toserba B' }),
    etoll_card_id: el('select', { class: 'form-select form-select-sm' }),
    etoll_card_id_2: el('select', { class: 'form-select form-select-sm' }),
  };
  isiOpsi(f.vehicle_id, opsiCabang(master.vehicles, cabang, 'cabang').map((v) => ({ value: v.vehicle_id, label: `${v.plat_nomor} — ${v.nama}` })), '— kendaraan —');
  const kartu = opsiCabang(master.cards, cabang, 'branch_id').map((c) => ({ value: c.id, label: c.card_name || c.card_number || c.id }));
  isiOpsi(f.etoll_card_id, kartu, '— tanpa kartu etoll —');
  isiOpsi(f.etoll_card_id_2, kartu, '— tanpa kartu kedua —');
  for (const [k, ctl] of Object.entries(f)) if (nilai[k] !== undefined) ctl.value = String(nilai[k] ?? '');
  const ambil = () => Object.fromEntries(Object.entries(f).map(([k, ctl]) => [k, ctl.value.trim()]));
  return { f, ambil };
}

// ── Buat ──────────────────────────────────────────────────────────────────
export async function renderJalurBuat(view) {
  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat data master' }));
  let master;
  try {
    master = await muatMaster();
  } catch (err) {
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }

  const tanggal = el('input', { type: 'date', class: 'form-control', value: tanggalWib() });
  const wh = pilihWarehouse(master.cabang);
  const alertBox = el('div', { class: 'alert alert-danger d-none' });
  const wadah = el('div', {});
  let daftar = [];

  function tambahBaris() {
    const cabang = isSuper() ? wh.value : '';
    const b = formBaris(master, cabang);
    const item = { ...b, node: null };
    item.node = el('div', { class: 'border rounded p-2 mb-2' }, [
      el('div', { class: 'row g-2' }, [
        el('div', { class: 'col-md-4' }, [baris('Driver 1', b.f.driver_id)]),
        el('div', { class: 'col-md-4' }, [baris('Driver 2', b.f.driver2_id)]),
        el('div', { class: 'col-md-4' }, [baris('Kendaraan', b.f.vehicle_id)]),
        el('div', { class: 'col-md-4' }, [baris('Rute tujuan', b.f.rute_tujuan)]),
        el('div', { class: 'col-md-3' }, [baris('Kartu etoll 1', b.f.etoll_card_id)]),
        el('div', { class: 'col-md-3' }, [baris('Kartu etoll 2', b.f.etoll_card_id_2)]),
        el('div', { class: 'col-md-2 d-flex align-items-end mb-3' }, [
          el('button', { class: 'btn btn-sm btn-outline-danger', type: 'button', text: 'Hapus baris', onclick: () => {
            daftar = daftar.filter((x) => x !== item);
            item.node.remove();
          } }),
        ]),
      ]),
    ]);
    daftar.push(item);
    wadah.appendChild(item.node);
  }

  // Ganti warehouse mengosongkan baris karena pilihan driver/kendaraan/kartu ikut berubah.
  wh.addEventListener('change', () => {
    daftar = [];
    wadah.replaceChildren();
    tambahBaris();
  });

  const simpan = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Simpan Jalur' });
  const form = el('form', { novalidate: 'novalidate' }, [
    alertBox,
    el('div', { class: 'row g-2' }, [
      isSuper() ? el('div', { class: 'col-md-4' }, [baris('Warehouse', wh)]) : null,
      el('div', { class: 'col-md-4' }, [baris('Tanggal pengiriman', tanggal)]),
    ]),
    wadah,
    el('div', { class: 'd-flex gap-2' }, [
      el('button', { class: 'btn btn-outline-primary', type: 'button', text: 'Tambah Baris', onclick: tambahBaris }),
      el('a', { class: 'btn btn-outline-secondary', href: '#/jalur', text: 'Batal' }),
      simpan,
    ]),
  ]);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('d-none');
    const { valid, err } = kumpulkanBaris(daftar.map((d) => d.ambil()));
    if (!tanggal.value) err.unshift('Tanggal pengiriman wajib diisi.');
    if (err.length) {
      alertBox.textContent = err.join(' ');
      alertBox.classList.remove('d-none');
      return;
    }
    simpan.disabled = true;
    simpan.textContent = 'Menyimpan';
    try {
      const res = await post('/api/jalur', { tanggal: tanggal.value, rows: valid });
      toast(res.msg || 'Jalur tersimpan.', 'success');
      for (const w of res.warnings || []) toast(w, 'error');
      window.location.hash = '#/jalur';
    } catch (e) {
      alertBox.textContent = e.message || 'Gagal menyimpan jalur.';
      alertBox.classList.remove('d-none');
      simpan.disabled = false;
      simpan.textContent = 'Simpan Jalur';
    }
  });

  tambahBaris();
  view.replaceChildren(el('div', { class: 'panel' }, [el('h2', { class: 'h6 mb-3', text: 'Buat Jalur Pengiriman' }), form]));
  return { ok: true };
}

// ── Edit ──────────────────────────────────────────────────────────────────
export async function renderJalurEdit(view) {
  const id = getRouteParam('id');
  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat jalur' }));
  let master;
  let jalur;
  try {
    [master, { jalur }] = await Promise.all([muatMaster(), get(`/api/jalur/${encodeURIComponent(id)}`)]);
  } catch (err) {
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }

  const b = formBaris(master, jalur.kode_cabang, {
    driver_id: jalur.driver_id, driver2_id: jalur.driver2_id, vehicle_id: jalur.vehicle_id,
    rute_tujuan: jalur.rute_tujuan, etoll_card_id: jalur.flazz_card_id, etoll_card_id_2: jalur.flazz_card_id_2,
  });
  const tanggal = el('input', { type: 'date', class: 'form-control', value: jalur.tanggal });
  const alertBox = el('div', { class: 'alert alert-danger d-none' });
  const simpan = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Simpan Perubahan' });

  const form = el('form', { novalidate: 'novalidate' }, [
    alertBox,
    el('div', { class: 'row g-2' }, [
      el('div', { class: 'col-md-4' }, [baris('Tanggal', tanggal)]),
      el('div', { class: 'col-md-4' }, [baris('Driver 1', b.f.driver_id)]),
      el('div', { class: 'col-md-4' }, [baris('Driver 2 (opsional)', b.f.driver2_id)]),
      el('div', { class: 'col-md-4' }, [baris('Kendaraan', b.f.vehicle_id)]),
      el('div', { class: 'col-md-4' }, [baris('Rute tujuan', b.f.rute_tujuan)]),
      el('div', { class: 'col-md-2' }, [baris('Kartu etoll 1', b.f.etoll_card_id)]),
      el('div', { class: 'col-md-2' }, [baris('Kartu etoll 2', b.f.etoll_card_id_2)]),
    ]),
    el('div', { class: 'd-flex gap-2' }, [simpan, el('a', { class: 'btn btn-outline-secondary', href: '#/jalur', text: 'Batal' })]),
  ]);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('d-none');
    const v = b.ambil();
    const { err } = kumpulkanBaris([v]);
    if (err.length) {
      alertBox.textContent = err.join(' ').replace('Baris 1: ', '');
      alertBox.classList.remove('d-none');
      return;
    }
    simpan.disabled = true;
    try {
      const res = await put(`/api/jalur/${encodeURIComponent(id)}`, { tanggal: tanggal.value, ...v });
      toast(res.msg || 'Jadwal diperbarui.', 'success');
      window.location.hash = '#/jalur';
    } catch (e) {
      alertBox.textContent = e.message || 'Gagal memperbarui jalur.';
      alertBox.classList.remove('d-none');
      simpan.disabled = false;
    }
  });

  view.replaceChildren(el('div', { class: 'panel' }, [
    el('h2', { class: 'h6 mb-1', text: 'Edit Jalur Pengiriman' }),
    el('div', { class: 'small text-muted mb-3', text: `Status: ${LABEL_STATUS[jalur.status] || jalur.status}` }),
    form,
  ]));
  return { ok: true };
}

// ── Ringkasan (cetak) ─────────────────────────────────────────────────────
const HTML2CANVAS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
let html2canvasSiap = null;
function muatHtml2canvas() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  html2canvasSiap ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = HTML2CANVAS_URL;
    s.onload = () => (window.html2canvas ? resolve(window.html2canvas) : reject(new Error('Library screenshot tidak tersedia.')));
    s.onerror = () => { html2canvasSiap = null; reject(new Error('Gagal memuat library screenshot. Periksa koneksi.')); };
    document.head.appendChild(s);
  });
  return html2canvasSiap;
}

// Gambar ringkasan untuk WhatsApp: di HP lewat menu bagikan (pilih WhatsApp); di laptop
// disalin ke clipboard untuk ditempel di WhatsApp Web, atau diunduh bila clipboard ditolak.
async function bagikanGambar(node, namaFile) {
  const html2canvas = await muatHtml2canvas();
  const canvas = await html2canvas(node, { scale: 2, backgroundColor: '#ffffff' });
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Gagal membuat gambar.');
  const file = new File([blob], namaFile, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Ringkasan Jalur Pengiriman' });
    } catch (err) {
      if (err && err.name !== 'AbortError') throw err;
    }
    return;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('Gambar disalin. Buka WhatsApp lalu tempel (Ctrl+V).', 'success');
  } catch {
    const a = el('a', { href: URL.createObjectURL(blob), download: namaFile });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    toast('Gambar diunduh. Lampirkan file itu di WhatsApp.', 'success');
  }
}

export async function renderJalurRingkasan(view) {
  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat' }));
  let master;
  try {
    master = await muatMaster();
  } catch (err) {
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }
  const tanggal = el('input', { type: 'date', class: 'form-control', value: tanggalWib() });
  const wh = pilihWarehouse(master.cabang);
  const infoTanggal = el('span', { class: 'fw-semibold' });
  const infoPembuat = el('span', { class: 'fw-semibold', text: '-' });
  const infoWh = el('span', { class: 'fw-semibold' });
  const barisWh = el('div', { class: 'text-muted fw-bold mb-1 d-none' }, ['Warehouse : ', infoWh]);
  const hasil = el('div', {});
  const kepala = el('div', { class: 'px-3 pt-3' }, [
    el('div', { class: 'fw-bold text-success mb-2 d-flex align-items-center gap-1', style: 'font-size:1.1rem' }, [ikonKendaraan('Mobil'), 'Jalur Pengiriman']),
    el('div', { class: 'text-muted fw-bold mb-1' }, ['Tanggal Pengiriman : ', infoTanggal]),
    barisWh,
    el('div', { class: 'text-muted fw-bold mb-3' }, ['Dibuat Oleh : ', infoPembuat]),
  ]);
  const shot = el('div', { class: 'bg-white p-2 d-none' }, [el('div', { class: 'card border-0 shadow-sm' }, [kepala, hasil])]);
  const kosong = el('div', { class: 'd-none' });
  const tombolWa = el('button', { class: 'btn btn-success', type: 'button', text: 'Screenshot WA' });
  tombolWa.addEventListener('click', async () => {
    if (shot.classList.contains('d-none')) { toast('Tampilkan dulu jalur pada tanggal yang dipilih.', 'error'); return; }
    tombolWa.disabled = true;
    try {
      await bagikanGambar(shot, `jalur-${tanggal.value}.png`);
    } catch (err) {
      toast(err.message || 'Gagal membuat screenshot.', 'error');
    } finally {
      tombolWa.disabled = false;
    }
  });
  const dok = (status, sisa, label) => {
    const b = badgeDokumenRingkasan(status, sisa, label);
    return el('span', { class: `badge ${b.kelas}`, text: b.text });
  };

  async function tampilkan() {
    const namaWh = isSuper() && wh.value ? wh.options[wh.selectedIndex]?.text : '';
    infoTanggal.textContent = tanggal.value;
    infoWh.textContent = namaWh || '';
    barisWh.classList.toggle('d-none', !namaWh);
    shot.classList.add('d-none');
    kosong.className = 'text-muted';
    kosong.textContent = 'Memuat';
    const q = new URLSearchParams({ tanggal: tanggal.value });
    if (isSuper() && wh.value) q.set('cabang', wh.value);
    try {
      const { list = [], created_by: pembuat = '' } = await get(`/api/jalur?${q}`);
      if (!list.length) {
        kosong.textContent = `Belum ada jadwal pengiriman pada ${tanggal.value}.`;
        return;
      }
      kosong.className = 'd-none';
      infoPembuat.textContent = pembuat || '-';
      hasil.replaceChildren(el('div', { class: 'table-responsive' }, [el('table', { class: 'table table-hover align-middle mb-0' }, [
        el('thead', { class: 'table-light' }, [el('tr', {}, ['Kendaraan', 'Driver 1', 'Driver 2', 'Rute Tujuan', 'Etoll', 'Pajak Tahunan', 'Pajak 5 Tahunan', 'KIR'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, list.map((j) => el('tr', {}, [
          el('td', { class: 'text-nowrap' }, [ikonKendaraan(j.jenis_kendaraan), `${j.plat_nomor || '-'} `, el('span', { class: 'text-muted small', text: j.nama_kendaraan || '' })]),
          el('td', { text: j.nama_driver || '-' }),
          el('td', { text: j.nama_driver2 || '-' }),
          el('td', { text: j.rute_tujuan || '-' }),
          el('td', {}, j.flazz_card_name && j.flazz_card_name_2
            ? [j.flazz_card_name, el('br'), el('span', { class: 'text-muted small', text: j.flazz_card_name_2 })]
            : [j.flazz_card_name || j.flazz_card_name_2 || '-']),
          el('td', {}, [dok(j.status_pajak, j.sisa_hari_pajak, 'Pajak')]),
          el('td', {}, [dok(j.status_pajak_5, j.sisa_hari_pajak_5, 'Pajak 5 Tahun')]),
          el('td', {}, [j.jenis_kendaraan === 'Mobil'
            ? dok(j.status_kir, j.sisa_hari_kir, 'KIR')
            : el('span', { class: 'badge bg-light text-muted fw-normal border', text: 'N/A' })]),
        ]))),
      ])]));
      shot.classList.remove('d-none');
    } catch (err) {
      kosong.className = 'alert alert-danger';
      kosong.textContent = err.message;
    }
  }


  view.replaceChildren(el('div', { class: 'panel' }, [
    el('div', { class: 'row g-2 no-print' }, [
      isSuper() ? el('div', { class: 'col-md-3' }, [baris('Warehouse', wh)]) : null,
      el('div', { class: 'col-md-3' }, [baris('Tanggal', tanggal)]),
      el('div', { class: 'col-md-6 d-flex gap-2 align-items-end mb-3' }, [
        el('button', { class: 'btn btn-primary', type: 'button', text: 'Tampilkan', onclick: tampilkan }),
        el('button', { class: 'btn btn-outline-primary', type: 'button', text: 'Cetak', onclick: () => window.print() }),
        tombolWa,
        el('a', { class: 'btn btn-outline-secondary', href: '#/jalur', text: 'Kembali' }),
      ]),
    ]),
    kosong,
    shot,
  ]));
  await tampilkan();
  return { ok: true };
}
