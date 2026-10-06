import { get } from '../api.js';
import { getUser } from '../store.js';
import { el, fmtDateId, fmtNum, halaman, navHalaman, toast } from '../ui.js';
import { tanggalWib } from './input.js';

// ── Helper murni (diuji) ────────────────────────────────────────────────────

export function awalBulan(tanggal) {
  return `${String(tanggal).substring(0, 7)}-01`;
}

const kosongTotal = () => ({ bbmEtoll: 0, tolEtoll: 0, bbmTunai: 0, tolTunai: 0, totalEtoll: 0, totalTunai: 0, total: 0, jumlah: 0 });

function tambahkan(t, l) {
  const n = Number(l.amount) || 0;
  const etoll = l.metode === 'ETOLL';
  if (l.jenis === 'BBM') t[etoll ? 'bbmEtoll' : 'bbmTunai'] += n;
  else t[etoll ? 'tolEtoll' : 'tolTunai'] += n;
  t[etoll ? 'totalEtoll' : 'totalTunai'] += n;
  t.total += n;
  t.jumlah += 1;
  return t;
}

export function ringkasRekap(lines) {
  return (lines || []).reduce(tambahkan, kosongTotal());
}

// Kelompok per kartu etoll (hanya baris ETOLL) atau per kendaraan; urut total terbesar.
export function kelompokRekap(lines, per) {
  const map = new Map();
  for (const l of lines || []) {
    if (per === 'kartu' && l.metode !== 'ETOLL') continue;
    const key = per === 'kartu' ? l.card_id || l.kartu || '-' : l.plat_nomor || l.vehicle_id || '-';
    const label = per === 'kartu' ? l.kartu || l.card_id || '-' : l.plat_nomor || l.vehicle_id || '-';
    if (!map.has(key)) map.set(key, { key, label, cabang: new Set(), ...kosongTotal() });
    const g = map.get(key);
    if (l.kode_cabang) g.cabang.add(l.kode_cabang);
    tambahkan(g, l);
  }
  return [...map.values()]
    .map((g) => ({ ...g, cabang: [...g.cabang].sort().join(', ') }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

const csvSel = (v) => {
  const s = String(v ?? '');
  return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function csvRekap(lines) {
  const kepala = ['Tanggal', 'Warehouse', 'Kendaraan', 'Supir', 'Jenis', 'Metode', 'Kartu Etoll', 'Nominal', 'Sumber', 'Referensi'];
  const isi = (lines || []).map((l) => [l.tanggal, l.kode_cabang, l.plat_nomor, l.supir, l.jenis, l.metode, l.kartu, l.amount, l.sumber === 'TOL_MANUAL' ? 'Tol manual Flazz' : 'Laporan harian', l.ref]);
  return [kepala, ...isi].map((r) => r.map(csvSel).join(';')).join('\r\n');
}

// ── Tampilan ────────────────────────────────────────────────────────────────

const rp = (n) => `Rp ${fmtNum(n)}`;
const PER_HALAMAN = 20;

export async function renderRekap(view) {
  const isSuper = getUser()?.role === 'SUPERADMIN';
  let cabangList = [];
  if (isSuper) {
    try {
      const master = await get('/api/master');
      cabangList = Array.isArray(master.cabangList) ? master.cabangList : [];
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  const hariIni = tanggalWib();
  const wh = el('select', { class: 'form-select' }, [el('option', { value: '', text: 'Semua Warehouse' }), ...cabangList.map((c) => el('option', { value: c.kode, text: c.nama || c.kode }))]);
  const dari = el('input', { type: 'date', class: 'form-control', value: awalBulan(hariIni) });
  const sampai = el('input', { type: 'date', class: 'form-control', value: hariIni });
  const tombol = el('button', { class: 'btn btn-primary flex-fill', type: 'button', text: 'Tampilkan' });
  const unduh = el('button', { class: 'btn btn-outline-primary', type: 'button', text: 'Unduh CSV' });
  const ringkasan = el('div', { class: 'row g-3 mb-3' });
  const isi = el('div', {});
  const tab = { aktif: 'kartu' };
  let lines = [];
  let nomor = 1;
  const filterJenis = el('select', { class: 'form-select form-select-sm', style: 'width:auto' }, [
    el('option', { value: '', text: 'Semua jenis' }), el('option', { value: 'BBM', text: 'BBM' }), el('option', { value: 'TOL', text: 'Tol' }),
  ]);
  const filterMetode = el('select', { class: 'form-select form-select-sm', style: 'width:auto' }, [
    el('option', { value: '', text: 'Semua metode' }), el('option', { value: 'ETOLL', text: 'Etoll' }), el('option', { value: 'TUNAI', text: 'Tunai' }),
  ]);
  filterJenis.addEventListener('change', () => { nomor = 1; gambarIsi(); });
  filterMetode.addEventListener('change', () => { nomor = 1; gambarIsi(); });

  const kotak = (kelas, label, nilai, sub) => el('div', { class: 'col-6 col-lg-3' }, [el('div', { class: `rounded-3 p-3 h-100 ${kelas}` }, [
    el('div', { class: 'small opacity-75', text: label }),
    el('div', { class: 'h5 fw-bold mb-0', text: nilai }),
    sub ? el('div', { class: 'small opacity-75', text: sub }) : null,
  ])]);

  function gambarRingkasan() {
    const r = ringkasRekap(lines);
    ringkasan.replaceChildren(
      kotak('bg-primary text-white', 'BBM via Etoll', rp(r.bbmEtoll)),
      kotak('bg-primary text-white', 'Tol via Etoll', rp(r.tolEtoll)),
      kotak('bg-warning-subtle', 'BBM Tunai', rp(r.bbmTunai)),
      kotak('bg-warning-subtle', 'Tol Tunai', rp(r.tolTunai)),
      kotak('border bg-white', 'Total Etoll', rp(r.totalEtoll)),
      kotak('border bg-white', 'Total Tunai', rp(r.totalTunai)),
      kotak('bg-success text-white', 'Total Pengeluaran', rp(r.total), `${fmtNum(r.jumlah)} pembayaran`),
    );
  }

  const th = (cols) => el('thead', { class: 'table-light' }, [el('tr', {}, cols.map((h, i) => el('th', { class: i > 1 ? 'text-end' : '', text: h })))]);
  const angka = (n) => el('td', { class: 'text-end', text: n ? rp(n) : '-' });

  function gambarIsi() {
    if (!lines.length) {
      isi.replaceChildren(el('div', { class: 'text-center text-muted py-4', text: 'Tidak ada pengeluaran pada periode ini.' }));
      return;
    }
    if (tab.aktif === 'kartu') {
      const grup = kelompokRekap(lines, 'kartu');
      isi.replaceChildren(grup.length ? el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-hover align-middle' }, [
        th(['Kartu Etoll', 'Warehouse', 'BBM', 'Tol', 'Total', 'Pembayaran']),
        el('tbody', {}, grup.map((g) => el('tr', {}, [
          el('td', { class: 'fw-bold', text: g.label }), el('td', { text: g.cabang || '-' }),
          angka(g.bbmEtoll), angka(g.tolEtoll), el('td', { class: 'text-end fw-bold', text: rp(g.total) }), el('td', { class: 'text-end', text: fmtNum(g.jumlah) }),
        ]))),
      ])]) : el('div', { class: 'text-center text-muted py-4', text: 'Tidak ada pengeluaran etoll pada periode ini.' }));
      return;
    }
    if (tab.aktif === 'kendaraan') {
      const grup = kelompokRekap(lines, 'kendaraan');
      isi.replaceChildren(el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-hover align-middle' }, [
        th(['Kendaraan', 'Warehouse', 'BBM Etoll', 'Tol Etoll', 'BBM Tunai', 'Tol Tunai', 'Total']),
        el('tbody', {}, grup.map((g) => el('tr', {}, [
          el('td', { class: 'fw-bold', text: g.label }), el('td', { text: g.cabang || '-' }),
          angka(g.bbmEtoll), angka(g.tolEtoll), angka(g.bbmTunai), angka(g.tolTunai), el('td', { class: 'text-end fw-bold', text: rp(g.total) }),
        ]))),
      ])]));
      return;
    }
    const tersaring = lines.filter((l) => (!filterJenis.value || l.jenis === filterJenis.value) && (!filterMetode.value || l.metode === filterMetode.value));
    const h = halaman(tersaring, nomor, PER_HALAMAN);
    nomor = h.aktif;
    isi.replaceChildren(
      el('div', { class: 'd-flex gap-2 mb-2' }, [filterJenis, filterMetode]),
      el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-hover align-middle' }, [
        el('thead', { class: 'table-light' }, [el('tr', {}, ['Tanggal', 'Warehouse', 'Kendaraan', 'Supir', 'Jenis', 'Metode', 'Kartu Etoll', 'Nominal'].map((x, i) => el('th', { class: i === 7 ? 'text-end' : '', text: x })))]),
        el('tbody', {}, h.isi.map((l) => el('tr', {}, [
          el('td', { text: fmtDateId(l.tanggal) }), el('td', { text: l.kode_cabang || '-' }), el('td', { text: l.plat_nomor || '-' }),
          el('td', { text: l.supir || '-' }),
          el('td', {}, [l.jenis, l.sumber === 'TOL_MANUAL' ? el('span', { class: 'badge text-bg-light border ms-1', title: 'Dicatat di modul Flazz', text: 'manual' }) : null]),
          el('td', {}, [el('span', { class: `badge ${l.metode === 'ETOLL' ? 'text-bg-primary' : 'text-bg-warning'}`, text: l.metode === 'ETOLL' ? 'Etoll' : 'Tunai' })]),
          el('td', { text: l.kartu || '-' }),
          el('td', { class: 'text-end', text: rp(l.amount) }),
        ]))),
      ])]),
      tersaring.length ? navHalaman(h.total, h.aktif, (ke) => { nomor = ke; gambarIsi(); }) : el('div', { class: 'text-muted small', text: 'Tidak ada baris yang cocok.' }),
    );
  }

  const tabTombol = [['kartu', 'Per Kartu Etoll'], ['kendaraan', 'Per Kendaraan'], ['detail', 'Detail Transaksi']].map(([key, label]) => {
    const b = el('button', { type: 'button', class: 'btn btn-sm', text: label });
    b.addEventListener('click', () => { tab.aktif = key; nomor = 1; gambarTab(); });
    return { key, b };
  });
  function gambarTab() {
    tabTombol.forEach(({ key, b }) => { b.className = `btn btn-sm ${tab.aktif === key ? 'btn-primary' : 'btn-outline-primary'}`; });
    gambarIsi();
  }

  async function muat() {
    if (dari.value > sampai.value) { toast('Tanggal "dari" tidak boleh setelah tanggal "sampai".', 'error'); return; }
    tombol.disabled = true;
    isi.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat rekap…' }));
    try {
      const q = new URLSearchParams({ dari: dari.value, sampai: sampai.value });
      if (isSuper && wh.value) q.set('cabang', wh.value);
      ({ lines = [] } = await get(`/api/laporan/rekap-pengeluaran?${q}`));
      nomor = 1;
      gambarRingkasan();
      gambarTab();
    } catch (err) {
      isi.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    } finally {
      tombol.disabled = false;
    }
  }
  tombol.addEventListener('click', muat);
  unduh.addEventListener('click', () => {
    if (!lines.length) { toast('Tidak ada data untuk diunduh.', 'error'); return; }
    // BOM agar Excel membaca UTF-8; pemisah ';' sesuai pengaturan regional Indonesia.
    const blob = new Blob(['﻿' + csvRekap(lines)], { type: 'text/csv;charset=utf-8' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `rekap-pengeluaran-${dari.value}_${sampai.value}${isSuper && wh.value ? '-' + wh.value : ''}.csv` });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  });

  const kolom = (lebar, label, kontrol) => el('div', { class: lebar }, [el('label', { class: 'form-label small fw-bold text-muted text-uppercase', text: label }), kontrol]);
  view.replaceChildren(
    el('div', { class: 'panel' }, [
      el('h2', { class: 'h5 mb-3 pb-2 border-bottom', text: 'Rekap Pengeluaran BBM & Tol' }),
      el('div', { class: 'row g-2 align-items-end' }, [
        isSuper ? kolom('col-md-3', 'Warehouse', wh) : null,
        kolom('col-md-3', 'Dari tanggal', dari),
        kolom('col-md-3', 'Sampai tanggal', sampai),
        el('div', { class: `${isSuper ? 'col-md-3' : 'col-md-6'} d-flex gap-2` }, [tombol, unduh]),
      ]),
    ]),
    el('div', { class: 'panel' }, [ringkasan, el('div', { class: 'd-flex gap-2 mb-3 flex-wrap' }, tabTombol.map((t) => t.b)), isi]),
  );
  await muat();
  return { ok: true };
}
