import { get } from '../api.js';
import { getUser } from '../store.js';
import { el, fmtNum } from '../ui.js';

const STATUS_KELAS = { 'Sesuai standar': 'bg-success', 'Di bawah standar': 'bg-danger', 'Di atas standar': 'badge-ef-atas' };

// Item performa membawa NAMA warehouse; filter SUPERADMIN memakai kode (renderPerforma GAS).
export function saringPerforma(items, kode, cabangList) {
  if (!kode) return items || [];
  const nama = (cabangList || []).find((c) => String(c.kode) === String(kode))?.nama;
  return nama ? (items || []).filter((r) => String(r.cabang || '') === String(nama)) : items || [];
}

export async function renderPerforma(view) {
  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat performa' }));
  const isSuper = getUser()?.role === 'SUPERADMIN';
  let items;
  let cabangList = [];
  try {
    const [perf, master] = await Promise.all([get('/api/laporan/performa'), isSuper ? get('/api/master') : Promise.resolve({})]);
    items = Array.isArray(perf.items) ? perf.items : [];
    cabangList = Array.isArray(master.cabangList) ? master.cabangList : [];
  } catch (err) {
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }

  const pilih = el('select', { class: 'form-select' }, [el('option', { value: '', text: 'Semua Warehouse' }), ...cabangList.map((c) => el('option', { value: c.kode, text: c.nama || c.kode }))]);
  const isi = el('div', {});

  function gambar() {
    const rows = saringPerforma(items, isSuper ? pilih.value : '', cabangList);
    isi.replaceChildren(rows.length
      ? el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-bordered table-striped table-hover align-middle' }, [
        el('thead', { class: 'table-dark text-center text-nowrap' }, [el('tr', {}, ['Periode Tanggal', 'Warehouse', 'Supir (Trip Terakhir)', 'Kendaraan', 'Total KM Tempuh', 'Total Isi BBM', 'Efisiensi (KM/L)', 'Status Standar'].map((h) => el('th', { text: h })))]),
        el('tbody', {}, rows.map((r) => el('tr', {}, [
          el('td', { text: r.periode || '-' }),
          el('td', { text: r.cabang || '-' }),
          el('td', {}, [el('div', { text: r.supir || '-' }), r.supir_2 ? el('div', { class: 'small text-muted', text: `& ${r.supir_2}` }) : null]),
          el('td', { class: 'text-nowrap', text: r.vehicle || '-' }),
          el('td', { class: 'text-end', text: `${fmtNum(r.total_km)} KM` }),
          el('td', { class: 'text-end', text: `${fmtNum(r.total_beli)} L` }),
          el('td', { class: 'text-end', text: `${r.efisiensi} KM/L` }),
          el('td', {}, [STATUS_KELAS[r.status_efisiensi] ? el('span', { class: `badge ${STATUS_KELAS[r.status_efisiensi]}`, text: r.status_efisiensi }) : r.status_efisiensi || '']),
        ]))),
      ])])
      : el('div', { class: 'text-center text-muted py-4' }, [
        el('div', { class: 'fw-bold', text: 'Belum ada rekap performa 7 trip' }),
        el('div', { class: 'small', text: 'Data akan muncul setelah kendaraan menyelesaikan kelipatan 7 perjalanan.' }),
      ]));
  }
  pilih.addEventListener('change', gambar);

  view.replaceChildren(el('div', { class: 'panel' }, [
    el('h2', { class: 'h5 mb-3 pb-2 border-bottom', text: 'Ringkasan Performa Kendaraan (Per 7 Trip)' }),
    isSuper && cabangList.length > 1 ? el('div', { class: 'row mb-3' }, [el('div', { class: 'col-md-4' }, [el('label', { class: 'form-label small fw-bold text-muted text-uppercase', text: 'Pilih Warehouse' }), pilih])]) : null,
    isi,
  ]));
  gambar();
  return { ok: true };
}
