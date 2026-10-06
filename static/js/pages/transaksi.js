import { get, del } from '../api.js';
import { el, fmtNum, fmtDateId, toast, spinner, confirmDialog, halaman, navHalaman } from '../ui.js';

const PER_HALAMAN = 10;
let halamanAktif = 1;

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

function thumb(url) {
  if (!url) return el('span', { class: 'text-muted', text: '-' });
  return el('img', { class: 'thumb', src: url, alt: 'foto odometer', loading: 'lazy' });
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

function selAksi(r) {
  const id = String(r.transaction_id || '');
  const bisaDetach = Boolean(r.flazz_card_id || r.flazz_card_id_2);
  return el('td', {}, [
    el('a', {
      class: 'btn btn-sm btn-outline-primary me-1',
      href: `#/edit/${encodeURIComponent(id)}`,
      text: 'Edit',
    }),
    el('button', {
      class: 'btn btn-sm btn-outline-danger me-1',
      'data-hapus': id,
      text: 'Hapus',
    }),
    bisaDetach
      ? el('button', { class: 'btn btn-sm btn-outline-warning', 'data-detach': id, text: 'Detach Flazz' })
      : null,
  ]);
}

function pakaiKartu2(r) {
  return Boolean(r.flazz_card_id_2 || r.flazz_card_id_toll_2 || Number(r.biaya_bbm_2) || Number(r.biaya_toll_2));
}

function barisTabel(r) {
  return el('tr', {}, [
    selKolom(fmtDateId(r.tanggal)),
    selKolom(String(r.vehicle || '-')),
    selKolom(String(r.supir || '-')),
    selKolom(fmtNum(r.km_tempuh), 'text-end'),
    selKolom(fmtNum(r.liter), 'text-end'),
    // Total grup-1 + grup-2; data lama tanpa total_bbm memakai biaya_bbm.
    selKolom(fmtNum(r.total_bbm ?? r.biaya_bbm), 'text-end'),
    el('td', {}, [
      String(r.metode_pembayaran || '-'),
      pakaiKartu2(r) ? el('span', { class: 'badge-status ms-1', text: '2 kartu' }) : null,
    ]),
    el('td', {}, [badgeEfisiensi(r)]),
    el('td', {}, [thumb(r.foto_odo_awal_thumb)]),
    el('td', {}, [thumb(r.foto_odo_akhir_thumb)]),
    selAksi(r),
  ]);
}

function panelTransaksi(rows, view) {
  const panel = el('div', { class: 'panel' });
  const gambar = () => {
    const h = halaman(rows, halamanAktif, PER_HALAMAN);
    halamanAktif = h.aktif;
    const isi = rows.length
      ? el('div', { class: 'table-wrap' }, [
          el('table', { class: 'table table-sm align-middle' }, [
            el('thead', {}, [el('tr', {}, KOLOM.map((t) => el('th', { text: t })))]),
            el('tbody', {}, h.isi.map(barisTabel)),
          ]),
        ])
      : el('p', { class: 'text-muted', text: 'Belum ada transaksi.' });
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

export async function renderHistory(view) {
  spinner(view, 'Memuat riwayat laporan');
  let data;
  try {
    data = await get('/api/dashboard');
  } catch (err) {
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }

  const transactions = Array.isArray(data.transactions) ? data.transactions : [];
  const monthly = Array.isArray(data.monthly) ? data.monthly : [];

  view.replaceChildren(
    el('div', {}, [
      panelStatistik(monthly),
      panelTransaksi(transactions, view),
    ]),
  );

  return { ok: true };
}
