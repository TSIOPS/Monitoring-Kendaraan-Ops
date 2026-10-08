import { get } from '../api.js';
import { getUser } from '../store.js';
import { el, fmtNum, halaman, navHalaman, toast } from '../ui.js';
import { bukuExcel, muatSheetJS } from './rekap.js';
import { tanggalWib } from './input.js';

// Audit Log (SUPERADMIN): siapa melakukan apa, kapan, dan perubahan datanya.
const PER_HALAMAN = 20;

export const LABEL_MODUL = {
  transaksi: 'Laporan', jalur: 'Jalur Pengiriman', flazz: 'Kartu Flazz', master: 'Data Master',
  kendaraan: 'Kendaraan', pengguna: 'Pengguna', pengaturan: 'Pengaturan', auth: 'Login',
};
export const LABEL_AKSI = {
  CREATE: 'Tambah', EDIT: 'Ubah', UPDATE: 'Ubah', DELETE: 'Hapus', DETACH: 'Lepas Flazz', ADJUST: 'Penyesuaian',
  GANTI_OLI: 'Ganti Oli', GANTI_PASSWORD: 'Ganti Password', GANTI_PASSWORD_GAGAL: 'Ganti Password Gagal',
  LOGIN: 'Login', LOGIN_GAGAL: 'Login Gagal', LOGOUT: 'Logout', RESET_DATA: 'Kosongkan Data',
};
const KELAS_AKSI = {
  CREATE: 'text-bg-success', EDIT: 'badge-ef-atas', UPDATE: 'badge-ef-atas', DELETE: 'text-bg-danger',
  DETACH: 'text-bg-warning', ADJUST: 'text-bg-warning', RESET_DATA: 'text-bg-danger', LOGIN_GAGAL: 'text-bg-danger',
  GANTI_PASSWORD_GAGAL: 'text-bg-danger',
};

const FMT_WAKTU = new Intl.DateTimeFormat('id-ID', {
  timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
});

// Stempel ISO UTC -> "08/10/2026 07:10" WIB.
export function waktuWib(iso) {
  const t = Date.parse(String(iso ?? ''));
  return Number.isNaN(t) ? String(iso ?? '') : FMT_WAKTU.format(new Date(t)).replace(/\./g, ':').replace(',', '');
}

function bacaJson(teks) {
  if (!teks) return null;
  try {
    const v = JSON.parse(teks);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

const teksNilai = (v) => (v === undefined || v === null || v === '' ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// Baris perubahan per kolom; `berubah` = nilai sebelum dan sesudah berbeda.
// Data yang bukan JSON (atau terpotong) dikembalikan sebagai teks mentah.
export function rincianPerubahan(sebelum, sesudah) {
  const a = bacaJson(sebelum);
  const b = bacaJson(sesudah);
  if ((sebelum && !a) || (sesudah && !b)) return { mentah: true, sebelum: sebelum || '', sesudah: sesudah || '' };
  const kunci = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
  return {
    mentah: false,
    baris: kunci.map((k) => {
      const s = teksNilai(a?.[k]);
      const t = teksNilai(b?.[k]);
      return { kolom: k, sebelum: s, sesudah: t, berubah: !!a && !!b && s !== t };
    }),
  };
}

export function labelPengguna(username, peta) {
  const nama = peta.get(username);
  return nama && nama !== username ? `${nama} (${username})` : String(username || '-');
}

export function susunExcelAudit(items, peta) {
  const aoa = [['Waktu (WIB)', 'Username', 'Nama', 'Aksi', 'Modul', 'Keterangan', 'Data sebelum', 'Data sesudah', 'IP']];
  for (const r of items) {
    aoa.push([waktuWib(r.timestamp), r.username, peta.get(r.username) || '', LABEL_AKSI[r.action] || r.action,
      LABEL_MODUL[r.modul] || r.modul, r.keterangan, r.data_sebelum, r.data_sesudah, r.ip]);
  }
  return [{ nama: 'Audit Log', aoa, angka: { kolom: [] } }];
}

export async function renderAudit(view) {
  if (getUser()?.role !== 'SUPERADMIN') {
    view.replaceChildren(el('div', { class: 'alert alert-warning', text: 'Halaman ini hanya untuk SUPERADMIN.' }));
    return { ok: false };
  }
  let master = {};
  try {
    master = await get('/api/master');
  } catch (err) {
    toast(err.message, 'danger');
  }
  const pengguna = Array.isArray(master.penggunaList) ? master.penggunaList : [];
  const peta = new Map(pengguna.map((p) => [String(p.username), String(p.nama || '')]));

  const opsi = (sel, list, kosong) => {
    sel.replaceChildren(el('option', { value: '', text: kosong }), ...list.map(([v, t]) => el('option', { value: v, text: t })));
    return sel;
  };
  const fUser = opsi(el('select', { class: 'form-select' }),
    [...pengguna].sort((x, y) => String(x.nama || x.username).localeCompare(String(y.nama || y.username)))
      .map((p) => [p.username, labelPengguna(p.username, peta)]), 'Semua pengguna');
  const fModul = opsi(el('select', { class: 'form-select' }), Object.entries(LABEL_MODUL), 'Semua modul');
  const fAksi = opsi(el('select', { class: 'form-select' }),
    Object.entries(LABEL_AKSI).filter(([k]) => k !== 'UPDATE'), 'Semua aksi');
  const hariIni = tanggalWib();
  const seminggu = new Date(Date.parse(hariIni + 'T00:00:00Z') - 6 * 86_400_000).toISOString().slice(0, 10);
  const fDari = el('input', { type: 'date', class: 'form-control', value: seminggu });
  const fSampai = el('input', { type: 'date', class: 'form-control', value: hariIni });
  const fLogin = el('input', { type: 'checkbox', class: 'form-check-input', id: 'audit-login' });
  const tombolCari = el('button', { type: 'button', class: 'btn btn-primary', text: 'Tampilkan' });
  const tombolExcel = el('button', { type: 'button', class: 'btn btn-outline-primary', text: 'Unduh Excel' });
  const hasil = el('div', {});
  let items = [];
  let aktif = 1;

  const baris = (label, kontrol) => el('div', {}, [el('label', { class: 'form-label small mb-1', text: label }), kontrol]);

  function detail(r) {
    const d = rincianPerubahan(r.data_sebelum, r.data_sesudah);
    if (d.mentah) {
      return el('div', { class: 'small' }, [
        d.sebelum ? el('div', {}, [el('strong', { text: 'Sebelum: ' }), el('code', { text: d.sebelum })]) : null,
        d.sesudah ? el('div', {}, [el('strong', { text: 'Sesudah: ' }), el('code', { text: d.sesudah })]) : null,
      ]);
    }
    if (!d.baris.length) return el('div', { class: 'small text-muted', text: 'Tidak ada data perubahan yang dicatat.' });
    return el('table', { class: 'table table-sm table-bordered mb-0 small bg-white' }, [
      el('thead', {}, [el('tr', {}, ['Kolom', 'Sebelum', 'Sesudah'].map((t) => el('th', { text: t })))]),
      el('tbody', {}, d.baris.map((x) => el('tr', { class: x.berubah ? 'table-warning' : '' }, [
        el('td', { class: 'text-nowrap', text: x.kolom }),
        el('td', { class: 'text-break', text: x.sebelum || '-' }),
        el('td', { class: 'text-break', text: x.sesudah || '-' }),
      ]))),
    ]);
  }

  function gambar(info = '') {
    if (!items.length) {
      hasil.replaceChildren(el('div', { class: 'text-muted', text: 'Tidak ada aktivitas untuk filter ini.' }));
      return;
    }
    const h = halaman(items, aktif, PER_HALAMAN);
    aktif = h.aktif;
    const jumlahUser = new Set(items.map((r) => r.username)).size;
    const tbody = el('tbody', {});
    for (const r of h.isi) {
      const bisaDetail = !!(r.data_sebelum || r.data_sesudah);
      const barisDetail = el('tr', { class: 'd-none' }, [el('td', { colspan: '6', class: 'bg-light' }, [])]);
      const tombol = bisaDetail
        ? el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', title: 'Lihat perubahan', 'aria-label': 'Lihat perubahan' }, [el('i', { class: 'bi bi-chevron-down', 'aria-hidden': 'true' })])
        : null;
      tombol?.addEventListener('click', () => {
        const buka = barisDetail.classList.toggle('d-none') === false;
        if (buka && !barisDetail.firstChild.firstChild) barisDetail.firstChild.appendChild(detail(r));
        tombol.firstChild.className = `bi ${buka ? 'bi-chevron-up' : 'bi-chevron-down'}`;
      });
      tbody.append(el('tr', {}, [
        el('td', { class: 'text-nowrap', text: waktuWib(r.timestamp) }),
        el('td', { text: labelPengguna(r.username, peta) }),
        el('td', { class: 'text-center' }, [el('span', { class: `badge ${KELAS_AKSI[r.action] || 'text-bg-secondary'}`, text: LABEL_AKSI[r.action] || r.action })]),
        el('td', { text: LABEL_MODUL[r.modul] || r.modul }),
        el('td', { class: 'text-break', text: r.keterangan || '-' }),
        el('td', { class: 'text-center' }, [tombol || '-']),
      ]), barisDetail);
    }
    hasil.replaceChildren(
      el('div', { class: 'small text-muted mb-2', text: `${fmtNum(items.length)} aktivitas oleh ${fmtNum(jumlahUser)} pengguna.${info}` }),
      el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-bordered align-middle' }, [
        el('thead', { class: 'thead-hijau' }, [el('tr', {}, ['Waktu (WIB)', 'Pengguna', 'Aksi', 'Modul', 'Keterangan', 'Detail'].map((t) => el('th', { class: 'text-center', text: t })))]),
        tbody,
      ])]),
      navHalaman(h.total, aktif, (ke) => { aktif = ke; gambar(info); }),
    );
  }

  async function muat() {
    const q = new URLSearchParams({ limit: '2000' });
    if (fUser.value) q.set('username', fUser.value);
    if (fModul.value) q.set('modul', fModul.value);
    if (fAksi.value) q.set('action', fAksi.value);
    if (fDari.value) q.set('dari', fDari.value);
    if (fSampai.value) q.set('sampai', fSampai.value);
    if (fLogin.checked) q.set('login', '1');
    hasil.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat audit log' }));
    try {
      const res = await get('/api/audit?' + q.toString());
      items = Array.isArray(res.items) ? res.items : [];
      aktif = 1;
      gambar(res.terpotong ? ` Hanya ${fmtNum(res.limit)} aktivitas terbaru yang ditampilkan; persempit filter untuk melihat lebih lama.` : '');
    } catch (err) {
      items = [];
      hasil.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    }
  }

  tombolCari.addEventListener('click', muat);
  for (const x of [fUser, fModul, fAksi, fLogin]) x.addEventListener('change', muat);
  tombolExcel.addEventListener('click', async () => {
    if (!items.length) { toast('Tidak ada data untuk diunduh.', 'warning'); return; }
    try {
      const XLSX = await muatSheetJS();
      XLSX.writeFile(bukuExcel(XLSX, susunExcelAudit(items, peta)), `audit-log-${fDari.value}_${fSampai.value}${fUser.value ? '-' + fUser.value : ''}.xlsx`);
    } catch (err) {
      toast(err.message || 'Gagal membuat Excel.', 'danger');
    }
  });

  view.replaceChildren(el('div', { class: 'panel' }, [
    el('h2', { class: 'h6 mb-1', text: 'Audit Log' }),
    el('div', { class: 'small text-muted mb-3', text: 'Riwayat aktivitas semua pengguna: siapa menambah, mengubah, atau menghapus data, beserta perubahannya.' }),
    el('div', { class: 'row g-2 align-items-end mb-3' }, [
      el('div', { class: 'col-md-3' }, [baris('Pengguna', fUser)]),
      el('div', { class: 'col-md-2' }, [baris('Modul', fModul)]),
      el('div', { class: 'col-md-2' }, [baris('Aksi', fAksi)]),
      el('div', { class: 'col-md-2' }, [baris('Dari', fDari)]),
      el('div', { class: 'col-md-2' }, [baris('Sampai', fSampai)]),
      el('div', { class: 'col-md-1' }, [el('div', { class: 'form-check mb-2' }, [fLogin, el('label', { class: 'form-check-label small', for: 'audit-login', text: 'Login' })])]),
    ]),
    el('div', { class: 'd-flex gap-2 mb-3' }, [tombolCari, tombolExcel]),
    hasil,
  ]));
  await muat();
  return { ok: true };
}
