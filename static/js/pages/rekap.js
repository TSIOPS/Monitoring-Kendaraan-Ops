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
    const plat = String(l.plat_nomor ?? '').trim();
    const key = per === 'kartu' ? l.card_id || l.kartu || '-' : plat || l.vehicle_id || '-';
    const label = per === 'kartu' ? String(l.kartu || l.card_id || '-').trim() : plat || l.vehicle_id || '-';
    if (!map.has(key)) map.set(key, { key, label, cabang: new Set(), ...kosongTotal() });
    const g = map.get(key);
    if (l.kode_cabang) g.cabang.add(l.kode_cabang);
    tambahkan(g, l);
  }
  return [...map.values()]
    .map((g) => ({ ...g, cabang: [...g.cabang].sort().join(', ') }))
    .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
}

// ── Ekspor Excel ──────────────────────────────────────────────────────────
// Spesifikasi sheet (array-of-arrays) dipisah dari SheetJS agar bisa diuji.
const FORMAT_RUPIAH = '#,##0';
const tglId = (t) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(t || '');
};

/** @param {any[]} lines @param {{ dari?: string, sampai?: string, warehouse?: string, namaCabang?: Record<string, string> }} [opsi] */
export function susunExcel(lines, { dari = '', sampai = '', warehouse = 'Semua Warehouse', namaCabang = {} } = {}) {
  const wh = (kode) => (kode ? (namaCabang[kode] ? `${namaCabang[kode]} (${kode})` : kode) : '-');
  // Teks dari data lama kadang berspasi di tepi; Detail diurutkan dari tanggal terlama.
  const t = (v) => String(v ?? '').trim();
  const urut = [...lines].sort((x, y) => t(x.tanggal).localeCompare(t(y.tanggal)) || t(x.plat_nomor).localeCompare(t(y.plat_nomor)));
  const r = ringkasRekap(lines);
  const ringkasan = {
    nama: 'Ringkasan',
    aoa: [
      ['Rekap Pengeluaran BBM & Tol'],
      ['Periode', `${tglId(dari)} s.d. ${tglId(sampai)}`],
      ['Warehouse', warehouse],
      [],
      ['Keterangan', 'Etoll (Rp)', 'Tunai (Rp)', 'Total (Rp)'],
      ['BBM', r.bbmEtoll, r.bbmTunai, r.bbmEtoll + r.bbmTunai],
      ['Tol', r.tolEtoll, r.tolTunai, r.tolEtoll + r.tolTunai],
      ['Total', r.totalEtoll, r.totalTunai, r.total],
      [],
      ['Jumlah pembayaran', r.jumlah],
    ],
    angka: { baris: [5, 6, 7], kolom: [1, 2, 3] },
  };
  const detail = {
    nama: 'Detail',
    aoa: [
      ['No', 'Tanggal', 'Warehouse', 'Kendaraan', 'Supir', 'Jenis', 'Metode', 'Kartu Etoll', 'Nominal (Rp)', 'Sumber', 'Referensi'],
      ...urut.map((l, i) => [i + 1, tglId(l.tanggal), wh(l.kode_cabang), t(l.plat_nomor) || '-', t(l.supir) || '-', l.jenis === 'TOL' ? 'Tol' : 'BBM',
        l.metode === 'ETOLL' ? 'Etoll' : 'Tunai', t(l.kartu) || '-', Number(l.amount) || 0, l.sumber === 'TOL_MANUAL' ? 'Tol manual Flazz' : 'Laporan harian', l.ref]),
      ['', '', '', '', '', '', '', 'TOTAL', r.total, '', ''],
    ],
    angka: { kolom: [8] },
    filter: true,
  };
  const kartu = kelompokRekap(lines, 'kartu');
  const perKartu = {
    nama: 'Per Kartu Etoll',
    aoa: [
      ['No', 'Kartu Etoll', 'Warehouse', 'BBM (Rp)', 'Tol (Rp)', 'Total (Rp)', 'Jumlah Pembayaran'],
      ...kartu.map((g, i) => [i + 1, t(g.label), g.cabang.split(', ').map(wh).join(', '), g.bbmEtoll, g.tolEtoll, g.total, g.jumlah]),
      ['', 'TOTAL', '', r.bbmEtoll, r.tolEtoll, r.totalEtoll, kartu.reduce((n, g) => n + g.jumlah, 0)],
    ],
    angka: { kolom: [3, 4, 5] },
    filter: true,
  };
  const kendaraan = kelompokRekap(lines, 'kendaraan');
  const perKendaraan = {
    nama: 'Per Kendaraan',
    aoa: [
      ['No', 'Kendaraan', 'Warehouse', 'BBM Etoll (Rp)', 'Tol Etoll (Rp)', 'BBM Tunai (Rp)', 'Tol Tunai (Rp)', 'Total (Rp)', 'Jumlah Pembayaran'],
      ...kendaraan.map((g, i) => [i + 1, t(g.label), g.cabang.split(', ').map(wh).join(', '), g.bbmEtoll, g.tolEtoll, g.bbmTunai, g.tolTunai, g.total, g.jumlah]),
      ['', 'TOTAL', '', r.bbmEtoll, r.tolEtoll, r.bbmTunai, r.tolTunai, r.total, r.jumlah],
    ],
    angka: { kolom: [3, 4, 5, 6, 7] },
    filter: true,
  };
  return [ringkasan, detail, perKartu, perKendaraan];
}

// Lebar kolom mengikuti isi terpanjang (karakter), dibatasi 6..45.
export function lebarKolom(aoa) {
  const lebar = [];
  for (const baris of aoa) {
    baris.forEach((v, i) => {
      const n = typeof v === 'number' ? v.toLocaleString('id-ID').length + 2 : String(v ?? '').length + 2;
      lebar[i] = Math.max(lebar[i] || 6, Math.min(n, 45));
    });
  }
  return lebar.map((wch) => ({ wch }));
}

export function bukuExcel(XLSX, sheets) {
  const wb = XLSX.utils.book_new();
  for (const sh of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sh.aoa);
    ws['!cols'] = lebarKolom(sh.nama === 'Ringkasan' ? sh.aoa.slice(1) : sh.aoa);
    sh.aoa.forEach((baris, r) => {
      if (sh.angka.baris && !sh.angka.baris.includes(r)) return;
      for (const c of sh.angka.kolom) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && typeof cell.v === 'number') cell.z = FORMAT_RUPIAH;
      }
    });
    if (sh.filter && sh.aoa.length > 2) {
      ws['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: sh.aoa.length - 2, c: sh.aoa[0].length - 1 } }) };
    }
    XLSX.utils.book_append_sheet(wb, ws, sh.nama);
  }
  return wb;
}

const SHEETJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
let sheetjsSiap = null;
function muatSheetJS() {
  if (window.XLSX) return Promise.resolve(window.XLSX);
  sheetjsSiap ??= new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = SHEETJS_URL;
    sc.onload = () => (window.XLSX ? resolve(window.XLSX) : reject(new Error('Library Excel tidak tersedia.')));
    sc.onerror = () => { sheetjsSiap = null; reject(new Error('Gagal memuat library Excel. Periksa koneksi.')); };
    document.head.appendChild(sc);
  });
  return sheetjsSiap;
}

// ── Tampilan ────────────────────────────────────────────────────────────────

const rp = (n) => `Rp ${fmtNum(n)}`;
const PER_HALAMAN = 20;

export async function renderRekap(view) {
  const isSuper = getUser()?.role === 'SUPERADMIN';
  let cabangList = [];
  try {
    // Nama warehouse dipakai di filter (SUPERADMIN) dan di file Excel (semua role).
    const master = await get('/api/master');
    cabangList = Array.isArray(master.cabangList) ? master.cabangList : [];
  } catch (err) {
    toast(err.message, 'error');
  }
  const namaCabang = Object.fromEntries(cabangList.map((c) => [c.kode, c.nama || c.kode]));

  const hariIni = tanggalWib();
  const wh = el('select', { class: 'form-select' }, [el('option', { value: '', text: 'Semua Warehouse' }), ...cabangList.map((c) => el('option', { value: c.kode, text: c.nama || c.kode }))]);
  const dari = el('input', { type: 'date', class: 'form-control', value: awalBulan(hariIni) });
  const sampai = el('input', { type: 'date', class: 'form-control', value: hariIni });
  const tombol = el('button', { class: 'btn btn-primary flex-fill', type: 'button', text: 'Tampilkan' });
  const unduh = el('button', { class: 'btn btn-outline-primary', type: 'button', text: 'Unduh Excel' });
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
  unduh.addEventListener('click', async () => {
    if (!lines.length) { toast('Tidak ada data untuk diunduh.', 'error'); return; }
    unduh.disabled = true;
    try {
      const XLSX = await muatSheetJS();
      const kodeWh = isSuper ? wh.value : String(getUser()?.cabang || '');
      const sheets = susunExcel(lines, { dari: dari.value, sampai: sampai.value, warehouse: kodeWh ? namaCabang[kodeWh] || kodeWh : 'Semua Warehouse', namaCabang });
      XLSX.writeFile(bukuExcel(XLSX, sheets), `rekap-pengeluaran-${dari.value}_${sampai.value}${kodeWh ? '-' + kodeWh : ''}.xlsx`);
    } catch (err) {
      toast(err.message || 'Gagal membuat file Excel.', 'error');
    } finally {
      unduh.disabled = false;
    }
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
