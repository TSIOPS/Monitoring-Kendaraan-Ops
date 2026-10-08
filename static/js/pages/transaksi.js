import { get, del } from '../api.js';
import { getUser } from '../store.js';
import { el, fmtNum, fmtDateId, toast, spinner, confirmDialog, halaman, navHalaman } from '../ui.js';

const PER_HALAMAN = 10;
let halamanAktif = 1;
// Filter bertahan selama sesi halaman (mis. setelah hapus/detach yang menggambar ulang).
let filterAktif = { cabang: '', vehicle_id: '', dari: '', sampai: '', pengguna: '' };

export function queryHistory(f) {
  const q = new URLSearchParams();
  for (const k of ['cabang', 'vehicle_id', 'dari', 'sampai']) if (f[k]) q.set(k, f[k]);
  const s = q.toString();
  return s ? `?${s}` : '';
}

// Daftar penginput unik (untuk filter "Diinput oleh") dan penyaringannya di sisi klien.
export function opsiPengguna(rows) {
  return [...new Set(rows.map((r) => String(r.user || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}
export function saringPengguna(rows, nama) {
  return nama ? rows.filter((r) => String(r.user || '').trim() === nama) : rows;
}

// Pesan validasi rentang tanggal; kosong bila valid.
export function cekRentang(dari, sampai) {
  return dari && sampai && dari > sampai ? 'Tanggal "dari" tidak boleh setelah tanggal "sampai".' : '';
}

// Tampilan mengikuti Riwayat Operasional GAS; foto odometer cukup dilihat di Galeri.
const STATUS_KELAS = {
  'di atas standar': 'badge-ef-atas',
  'sesuai standar': 'text-bg-success',
  'di bawah standar': 'text-bg-danger',
  'data belum cukup': 'text-bg-secondary',
};

const KOLOM = ['Tanggal', 'Warehouse', 'Supir', 'Kendaraan', 'KM Tempuh', 'Isi BBM', 'Konsumsi BBM', 'Diinput oleh', 'Aksi'];

export function teksEfisiensi(row) {
  const status = String(row.status_efisiensi || '').toLowerCase();
  if (status === 'data belum cukup') return 'Data belum cukup';
  return row.efisiensi ? `${row.efisiensi} KM/L` : '-';
}

function selKonsumsi(row) {
  const status = String(row.status_efisiensi || '').toLowerCase();
  const badge = row.status_efisiensi
    ? el('span', { class: `badge ${STATUS_KELAS[status] || 'text-bg-secondary'}`, text: row.status_efisiensi })
    : null;
  if (status === 'data belum cukup' || !row.efisiensi) return el('td', { class: 'text-center' }, [badge || '-']);
  return el('td', { class: 'text-center' }, [
    el('span', { class: 'fw-semibold', text: teksEfisiensi(row) }),
    row.efisiensi_label ? el('span', { class: 'small text-muted ms-1', text: `(${row.efisiensi_label})` }) : null,
    badge ? el('div', {}, [badge]) : null,
  ]);
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

// Selisih KM akhir laporan sebelumnya dengan KM awal laporan ini (teks dari server).
export function selisihOdo(row) {
  const w = String(row.warning || '');
  if (!w) return null;
  const m = w.match(/KM akhir terakhir ([d.,]+) (([^)]*)), KM awal ([d.,]+), selisih (-?[d.,]+) KM/);
  const teks = m ? `Selisih ODO ${m[4].startsWith('-') ? '' : '+'}${m[4]} KM` : 'Selisih ODO';
  return el('div', {}, [el('span', { class: 'badge text-bg-danger', title: w, text: teks })]);
}

function barisTabel(r) {
  const liter = Number(r.isi_bbm) || 0;
  return el('tr', {}, [
    selKolom(fmtDateId(r.tanggal), 'text-nowrap'),
    selKolom(String(r.cabang || r.kode_cabang || '-')),
    // Driver 2 di baris kedua (kecil) agar kolom tidak melebar.
    el('td', {}, [
      el('div', { text: String(r.supir || '-') }),
      r.supir_2 ? el('div', { class: 'small text-muted', text: `& ${r.supir_2}` }) : null,
    ]),
    selKolom(String(r.vehicle || '-').trim(), 'text-nowrap'),
    el('td', { class: 'text-center text-nowrap' }, [
      `${fmtNum(r.km_tempuh)} KM`,
      String(r.km_sumber) === 'ESTIMASI' ? el('span', { class: 'badge text-bg-warning ms-1', title: 'KM dihitung dari estimasi (odometer tidak terbaca)', text: 'ESTIMASI' }) : null,
      selisihOdo(r),
    ]),
    el('td', { class: 'text-center text-nowrap' }, [
      liter > 0 ? `${fmtNum(liter)} L` : '-',
      pakaiKartu2(r) ? el('div', {}, [el('span', { class: 'badge text-bg-light border', title: 'Dibayar dengan 2 kartu', text: '2 kartu' })]) : null,
    ]),
    selKonsumsi(r),
    el('td', { class: 'small' }, [String(r.user || '-')]),
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
          el('table', { class: 'table table-bordered table-striped table-hover align-middle table-history' }, [
            el('thead', { class: 'thead-hijau' }, [el('tr', {}, KOLOM.map((t) => el('th', { class: 'text-center', text: t })))]),
            el('tbody', {}, h.isi.map(barisTabel)),
          ]),
        ])
      : el('p', { class: 'text-muted', text: adaFilter ? 'Tidak ada transaksi yang cocok dengan filter.' : 'Belum ada transaksi.' });
    panel.replaceChildren(
      el('h2', { class: 'h5 mb-3 pb-2 border-bottom text-success fw-bold' }, [
        el('i', { class: 'bi bi-clock-history me-2', 'aria-hidden': 'true' }), `Riwayat Operasional (${rows.length})`,
      ]),
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

function panelFilter(master, isSuper, view, penginput) {
  const cabangList = Array.isArray(master.cabangList) ? master.cabangList : [];
  const vehicles = Array.isArray(master.vehicles) ? master.vehicles : [];
  const wh = el('select', { class: 'form-select' }, [el('option', { value: '', text: 'Semua Warehouse' }), ...cabangList.map((c) => el('option', { value: c.kode, text: c.nama || c.kode }))]);
  const kendaraan = el('select', { class: 'form-select' });
  const dari = el('input', { type: 'date', class: 'form-control', value: filterAktif.dari });
  const sampai = el('input', { type: 'date', class: 'form-control', value: filterAktif.sampai });
  const pengguna = el('select', { class: 'form-select' }, [el('option', { value: '', text: 'Semua penginput' }), ...penginput.map((n) => el('option', { value: n, text: n }))]);
  pengguna.value = penginput.includes(filterAktif.pengguna) ? filterAktif.pengguna : '';
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
      isSuper ? kolom('col-md-2', 'Warehouse', wh) : null,
      kolom(isSuper ? 'col-md-2' : 'col-md-3', 'Kendaraan', kendaraan),
      kolom('col-md-2', 'Diinput oleh', pengguna),
      kolom('col-md-2', 'Dari tanggal', dari),
      kolom('col-md-2', 'Sampai tanggal', sampai),
      el('div', { class: `${isSuper ? 'col-md-2' : 'col-md-3'} d-flex gap-2` }, [
        el('button', { class: 'btn btn-primary flex-fill', type: 'button', text: 'Tampilkan', onclick: () => terapkan({ cabang: isSuper ? wh.value : '', vehicle_id: kendaraan.value, dari: dari.value, sampai: sampai.value, pengguna: pengguna.value }) }),
        el('button', { class: 'btn btn-outline-secondary', type: 'button', text: 'Reset', onclick: () => terapkan({ cabang: '', vehicle_id: '', dari: '', sampai: '', pengguna: '' }) }),
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

  const semua = Array.isArray(data.transactions) ? data.transactions : [];
  const transactions = saringPengguna(semua, filterAktif.pengguna);
  const monthly = (Array.isArray(data.monthly) ? data.monthly : [])
    .filter((m) => !filterAktif.cabang || String(m.cabang) === filterAktif.cabang);
  const adaFilter = Boolean(filterAktif.cabang || filterAktif.vehicle_id || filterAktif.dari || filterAktif.sampai || filterAktif.pengguna);

  view.replaceChildren(
    el('div', {}, [
      panelFilter(master, isSuper, view, opsiPengguna(semua)),
      panelStatistik(monthly),
      panelTransaksi(transactions, view, adaFilter),
    ]),
  );

  return { ok: true };
}
