import { get, del } from '../api.js';
import { getUser } from '../store.js';
import { el, fmtNum, fmtDateId, toast, spinner, confirmDialog, halaman, navHalaman } from '../ui.js';

const PER_HALAMAN = 10;
let halamanAktif = 1;
// Filter bertahan selama sesi halaman (mis. setelah hapus/detach yang menggambar ulang).
let filterAktif = { cabang: '', vehicle_id: '', dari: '', sampai: '' };

export function queryHistory(f) {
  const q = new URLSearchParams();
  for (const k of ['cabang', 'vehicle_id', 'dari', 'sampai']) if (f[k]) q.set(k, f[k]);
  const s = q.toString();
  return s ? `?${s}` : '';
}

// Pesan validasi rentang tanggal; kosong bila valid.
export function cekRentang(dari, sampai) {
  return dari && sampai && dari > sampai ? 'Tanggal "dari" tidak boleh setelah tanggal "sampai".' : '';
}

const EFISIENSI_KELAS = {
  'di atas standar': 'badge-ef-baik',
  'sesuai standar': 'badge-ef-waspada',
  'di bawah standar': 'badge-ef-buruk',
  'data belum cukup': 'badge-ef-kurang-data',
};

const KOLOM = [
  'Tanggal',
  'Kendaraan',
  'Supir',
  'KM',
  'Liter',
  'Biaya BBM',
  'Bayar',
  'Efisiensi',
  'Foto awal',
  'Foto akhir',
  'Aksi',
];

export function teksEfisiensi(row) {
  const status = String(row.status_efisiensi || '').toLowerCase();
  if (status === 'data belum cukup') return 'Data belum cukup';
  return row.efisiensi ? `${row.efisiensi} km/l` : '-';
}

function badgeEfisiensi(row) {
  const status = String(row.status_efisiensi || '').toLowerCase();
  const kelas = EFISIENSI_KELAS[status] || 'badge-ef-kurang-data';
  return el('span', { class: `badge-status ${kelas}`, title: String(row.efisiensi_label || ''), text: teksEfisiensi(row) });
}

function thumb(url, full) {
  if (!url) return el('span', { class: 'text-muted', text: '-' });
  const img = el('img', { class: 'thumb', src: url, alt: 'foto odometer', loading: 'lazy', 'data-full': full || url });
  // Klik membuka foto penuh untuk membaca angka odometer.
  return full ? el('a', { href: full, target: '_blank', rel: 'noopener' }, [img]) : img;
}

function selKolom(nilai, kelas = '') {
  return el('td', { class: kelas, text: nilai });
}

function panelStatistik(monthly) {
  const total = monthly.reduce(
    (acc, m) => ({
      transaksi: acc.transaksi + Number(m.total_transaksi || 0),
      liter: acc.liter + Number(m.total_liter || 0),
      bbm: acc.bbm + Number(m.total_biaya_bbm || 0),
      tol: acc.tol + Number(m.total_toll || 0),
    }),
    { transaksi: 0, liter: 0, bbm: 0, tol: 0 },
  );

  const kartu = [
    { label: 'Transaksi bulan ini', value: fmtNum(total.transaksi) },
    { label: 'Total liter', value: fmtNum(total.liter) },
    { label: 'Biaya BBM', value: fmtNum(total.bbm) },
    { label: 'Biaya tol', value: fmtNum(total.tol) },
  ];

  return el('div', { class: 'panel' }, [
    el('h2', { class: 'h6 mb-3', text: 'Ringkasan bulan berjalan' }),
    el(
      'div',
      { class: 'stat-grid' },
      kartu.map((k) =>
        el('div', { class: 'stat-card' }, [
          el('div', { class: 'label', text: k.label }),
          el('div', { class: 'value', text: k.value }),
        ]),
      ),
    ),
    monthly.length > 1
      ? el('div', { class: 'mt-2 text-muted small', text: `Menampilkan ${monthly.length} cabang.` })
      : null,
  ]);
}

// Tombol ikon; label lengkap di title (tooltip) dan aria-label untuk pembaca layar.
const ikon = (nama) => el('i', { class: `bi ${nama}`, 'aria-hidden': 'true' });

function selAksi(r) {
  const id = String(r.transaction_id || '');
  const bisaDetach = Boolean(r.flazz_card_id || r.flazz_card_id_2);
  return el('td', { class: 'text-nowrap' }, [
    el('div', { class: 'aksi-ikon' }, [
      el('a', { class: 'btn btn-sm btn-outline-primary', href: `#/edit/${encodeURIComponent(id)}`, title: 'Edit', 'aria-label': 'Edit transaksi' }, [ikon('bi-pencil')]),
      el('button', { class: 'btn btn-sm btn-outline-danger', type: 'button', 'data-hapus': id, title: 'Hapus', 'aria-label': 'Hapus transaksi' }, [ikon('bi-trash')]),
      bisaDetach
        ? el('button', { class: 'btn btn-sm btn-outline-warning', type: 'button', 'data-detach': id, title: 'Lepas pembayaran Flazz', 'aria-label': 'Lepas pembayaran Flazz' }, [ikon('bi-credit-card-2-back')])
        : null,
    ]),
  ]);
}

function pakaiKartu2(r) {
  return Boolean(r.flazz_card_id_2 || r.flazz_card_id_toll_2 || Number(r.biaya_bbm_2) || Number(r.biaya_toll_2));
}

function barisTabel(r) {
  return el('tr', {}, [
    selKolom(fmtDateId(r.tanggal), 'text-nowrap'),
    selKolom(String(r.vehicle || '-'), 'text-nowrap'),
    // Driver 2 di baris kedua (kecil) agar kolom tidak melebar.
    el('td', {}, [
      el('div', { text: String(r.supir || '-') }),
      r.supir_2 ? el('div', { class: 'small text-muted', text: `& ${r.supir_2}` }) : null,
    ]),
    selKolom(fmtNum(r.km_tempuh), 'text-end'),
    selKolom(fmtNum(r.liter), 'text-end'),
    // Total grup-1 + grup-2; data lama tanpa total_bbm memakai biaya_bbm.
    selKolom(fmtNum(r.total_bbm ?? r.biaya_bbm), 'text-end text-nowrap'),
    el('td', {}, [
      String(r.metode_pembayaran || '-'),
      pakaiKartu2(r) ? el('span', { class: 'badge-status ms-1', text: '2 kartu' }) : null,
    ]),
    el('td', { class: 'text-nowrap' }, [badgeEfisiensi(r)]),
    el('td', {}, [thumb(r.foto_odo_awal_thumb, r.foto_odo_awal)]),
    el('td', {}, [thumb(r.foto_odo_akhir_thumb, r.foto_odo_akhir)]),
    selAksi(r),
  ]);
}

function panelTransaksi(rows, view, adaFilter = false) {
  const panel = el('div', { class: 'panel' });
  const gambar = () => {
    const h = halaman(rows, halamanAktif, PER_HALAMAN);
    halamanAktif = h.aktif;
    const isi = rows.length
      ? el('div', { class: 'table-wrap' }, [
          el('table', { class: 'table table-sm align-middle table-history' }, [
            el('thead', {}, [el('tr', {}, KOLOM.map((t) => el('th', { text: t })))]),
            el('tbody', {}, h.isi.map(barisTabel)),
          ]),
        ])
      : el('p', { class: 'text-muted', text: adaFilter ? 'Tidak ada transaksi yang cocok dengan filter.' : 'Belum ada transaksi.' });
    panel.replaceChildren(
      el('h2', { class: 'h6 mb-3', text: `Riwayat Operasional (${rows.length})` }),
      isi,
      navHalaman(h.total, h.aktif, (ke) => {
        halamanAktif = ke;
        gambar();
        panel.scrollIntoView({ block: 'start' });
      }),
    );
    pasangAksiHapus(view, panel);
    pasangAksiDetach(view, panel);
  };
  gambar();
  return panel;
}

function pasangAksiHapus(view, root) {
  root.querySelectorAll('[data-hapus]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.hapus;
      if (!confirmDialog('Hapus transaksi ini? Saldo Flazz akan dikembalikan.')) return;
      btn.disabled = true;
      try {
        await del(`/api/laporan/${encodeURIComponent(id)}`);
        toast('Transaksi dihapus.', 'success');
        await renderHistory(view);
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

function pasangAksiDetach(view, root) {
  root.querySelectorAll('[data-detach]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.detach;
      const ok = confirmDialog(
        'Lepas pembayaran Flazz pada transaksi ini?\n\nPayment BBM dilepas, tetapi data tol dan kartu tol tetap tersimpan.',
      );
      if (!ok) return;
      btn.disabled = true;
      try {
        await del(`/api/laporan/${encodeURIComponent(id)}/flazz`);
        toast('Pembayaran Flazz dilepas.', 'success');
        await renderHistory(view);
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
      }
    });
  });
}

function panelFilter(master, isSuper, view) {
  const cabangList = Array.isArray(master.cabangList) ? master.cabangList : [];
  const vehicles = Array.isArray(master.vehicles) ? master.vehicles : [];
  const wh = el('select', { class: 'form-select' }, [el('option', { value: '', text: 'Semua Warehouse' }), ...cabangList.map((c) => el('option', { value: c.kode, text: c.nama || c.kode }))]);
  const kendaraan = el('select', { class: 'form-select' });
  const dari = el('input', { type: 'date', class: 'form-control', value: filterAktif.dari });
  const sampai = el('input', { type: 'date', class: 'form-control', value: filterAktif.sampai });
  const pesan = el('div', { class: 'text-danger small mt-1' });
  wh.value = filterAktif.cabang;

  const isiKendaraan = () => {
    const pilihan = vehicles.filter((v) => !wh.value || String(v.cabang) === wh.value);
    kendaraan.replaceChildren(el('option', { value: '', text: 'Semua Kendaraan' }), ...pilihan.map((v) => el('option', { value: v.vehicle_id, text: `${v.plat_nomor} — ${v.nama}` })));
    kendaraan.value = pilihan.some((v) => v.vehicle_id === filterAktif.vehicle_id) ? filterAktif.vehicle_id : '';
  };
  isiKendaraan();
  wh.addEventListener('change', isiKendaraan);

  const terapkan = (f) => {
    const salah = cekRentang(f.dari, f.sampai);
    pesan.textContent = salah;
    if (salah) return;
    filterAktif = f;
    halamanAktif = 1;
    renderHistory(view);
  };
  const kolom = (lebar, label, kontrol) => el('div', { class: lebar }, [el('label', { class: 'form-label small fw-bold text-muted text-uppercase', text: label }), kontrol]);

  return el('div', { class: 'panel' }, [
    el('div', { class: 'row g-2 align-items-end' }, [
      isSuper ? kolom('col-md-3', 'Warehouse', wh) : null,
      kolom(isSuper ? 'col-md-3' : 'col-md-4', 'Kendaraan', kendaraan),
      kolom('col-md-2', 'Dari tanggal', dari),
      kolom('col-md-2', 'Sampai tanggal', sampai),
      el('div', { class: `${isSuper ? 'col-md-2' : 'col-md-4'} d-flex gap-2` }, [
        el('button', { class: 'btn btn-primary flex-fill', type: 'button', text: 'Tampilkan', onclick: () => terapkan({ cabang: isSuper ? wh.value : '', vehicle_id: kendaraan.value, dari: dari.value, sampai: sampai.value }) }),
        el('button', { class: 'btn btn-outline-secondary', type: 'button', text: 'Reset', onclick: () => terapkan({ cabang: '', vehicle_id: '', dari: '', sampai: '' }) }),
      ]),
    ]),
    pesan,
  ]);
}

export async function renderHistory(view) {
  spinner(view, 'Memuat riwayat laporan');
  const isSuper = getUser()?.role === 'SUPERADMIN';
  let data;
  let master;
  try {
    [data, master] = await Promise.all([get(`/api/dashboard${queryHistory(filterAktif)}`), get('/api/master')]);
  } catch (err) {
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }

  const transactions = Array.isArray(data.transactions) ? data.transactions : [];
  const monthly = (Array.isArray(data.monthly) ? data.monthly : [])
    .filter((m) => !filterAktif.cabang || String(m.cabang) === filterAktif.cabang);
  const adaFilter = Boolean(filterAktif.cabang || filterAktif.vehicle_id || filterAktif.dari || filterAktif.sampai);

  view.replaceChildren(
    el('div', {}, [
      panelFilter(master, isSuper, view),
      panelStatistik(monthly),
      panelTransaksi(transactions, view, adaFilter),
    ]),
  );

  return { ok: true };
}
