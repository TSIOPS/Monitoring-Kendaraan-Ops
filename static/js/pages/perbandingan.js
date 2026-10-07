import { get } from '../api.js';
import { getUser } from '../store.js';
import { el, fmtNum, toast } from '../ui.js';
import { tanggalWib } from './input.js';
import { awalBulan, bukuExcel, muatSheetJS } from './rekap.js';

// ── Helper murni (diuji) ────────────────────────────────────────────────────

// Gudang pusat = Whp (kode GDG…); selain itu cabang (Who).
export function jenisWarehouse(kode, nama) {
  return /^GDG/i.test(String(kode || '')) || /^whp\b/i.test(String(nama || '').trim()) ? 'PUSAT' : 'CABANG';
}

const kosong = () => ({ bbmEtoll: 0, bbmTunai: 0, tolEtoll: 0, tolTunai: 0, bbm: 0, tol: 0, etoll: 0, tunai: 0, total: 0, kendaraan: 0 });

function tambah(t, l) {
  const n = Number(l.amount) || 0;
  const etoll = l.metode === 'ETOLL';
  if (l.jenis === 'TOL') t[etoll ? 'tolEtoll' : 'tolTunai'] += n;
  else t[etoll ? 'bbmEtoll' : 'bbmTunai'] += n;
  t[l.jenis === 'TOL' ? 'tol' : 'bbm'] += n;
  t[etoll ? 'etoll' : 'tunai'] += n;
  t.total += n;
}

// ── Mode 1: cabang vs gudang pusat (satu rentang tanggal) ───────────────────

// lines: hasil /api/laporan/rekap-pengeluaran; cabangList: warehouse AKTIF; vehicles: kendaraan aktif.
// Baris dari warehouse yang tidak aktif/terhapus (mis. Ciamis) tidak dihitung.
export function bandingkan(lines, cabangList, vehicles) {
  const peta = new Map();
  for (const c of cabangList || []) {
    peta.set(String(c.kode), { kode: String(c.kode), nama: String(c.nama || c.kode), jenis: jenisWarehouse(c.kode, c.nama), ...kosong() });
  }
  let diabaikan = 0;
  for (const l of lines || []) {
    const w = peta.get(String(l.kode_cabang));
    if (!w) { diabaikan++; continue; }
    tambah(w, l);
  }
  for (const v of vehicles || []) {
    const w = peta.get(String(v.cabang));
    if (w) w.kendaraan++;
  }
  const semua = [...peta.values()];
  const totalSemua = semua.reduce((n, w) => n + w.total, 0);
  const lengkapi = (w) => ({ ...w, perKendaraan: w.kendaraan ? w.total / w.kendaraan : 0, persen: totalSemua ? (w.total / totalSemua) * 100 : 0 });
  const urut = (a, b) => b.total - a.total || a.nama.localeCompare(b.nama);
  const kelompok = (jenis) => {
    const baris = semua.filter((w) => w.jenis === jenis).sort(urut).map(lengkapi);
    const sub = baris.reduce((t, w) => { for (const k of Object.keys(kosong())) t[k] += w[k]; return t; }, kosong());
    return { jenis, baris, sub: lengkapi({ ...sub, kode: '', nama: '', jenis }) };
  };
  const cabang = kelompok('CABANG');
  const pusat = kelompok('PUSAT');
  const gabung = kosong();
  for (const k of Object.keys(gabung)) gabung[k] = cabang.sub[k] + pusat.sub[k];
  return { cabang, pusat, total: lengkapi({ ...gabung, kode: '', nama: '', jenis: '' }), diabaikan };
}

// ── Mode 2: bulan vs bulan per warehouse ────────────────────────────────────

const NAMA_BULAN = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

export function labelBulan(b) {
  const [y, m] = String(b).split('-');
  return `${NAMA_BULAN[Number(m) - 1]} ${y}`;
}

// 'YYYY-MM' urut naik, bulan terakhir = bulan dari hariIni.
export function daftarBulan(hariIni, jumlah) {
  let y = Number(String(hariIni).slice(0, 4));
  let m = Number(String(hariIni).slice(5, 7));
  const out = [];
  for (let i = 0; i < jumlah; i++) {
    out.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m--;
    if (m === 0) { m = 12; y--; }
  }
  return out;
}

export function hariDalamBulan(b) {
  const [y, m] = String(b).split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

const rinciKosong = () => ({ bbmEtoll: 0, bbmTunai: 0, tolEtoll: 0, tolTunai: 0, total: 0 });

function rekamBaru(kode, nama, jenis, bulan) {
  return { kode, nama, jenis, per: Object.fromEntries(bulan.map((b) => [b, 0])), rinci: Object.fromEntries(bulan.map((b) => [b, rinciKosong()])), pembanding: 0 };
}

// Bulan terakhir yang masih berjalan dibandingkan dengan bulan lalu pada rentang tanggal yang
// sama (adil); rata-rata hanya dari bulan penuh; proyeksi = linear sampai akhir bulan.
function turunan(r, bulan, berjalan, hari) {
  const terakhir = bulan[bulan.length - 1];
  const sebelum = bulan.length > 1 ? bulan[bulan.length - 2] : null;
  const penuh = berjalan ? bulan.slice(0, -1) : bulan;
  const total = bulan.reduce((n, b) => n + r.per[b], 0);
  const rata = penuh.length ? penuh.reduce((n, b) => n + r.per[b], 0) / penuh.length : 0;
  const nilaiTerakhir = r.per[terakhir];
  const pembanding = sebelum ? (berjalan ? r.pembanding : r.per[sebelum]) : 0;
  const delta = sebelum ? nilaiTerakhir - pembanding : 0;
  return {
    ...r,
    total,
    rata,
    terakhir: nilaiTerakhir,
    pembandingTerakhir: pembanding,
    delta,
    deltaPersen: pembanding > 0 ? (delta / pembanding) * 100 : null,
    proyeksi: berjalan && hari > 0 ? (nilaiTerakhir / hari) * hariDalamBulan(terakhir) : null,
  };
}

function gabungRekam(a, b, bulan) {
  const r = rekamBaru('', '', '', bulan);
  for (const x of [a, b]) {
    for (const bl of bulan) {
      r.per[bl] += x.per[bl];
      for (const k of Object.keys(rinciKosong())) r.rinci[bl][k] += x.rinci[bl][k];
    }
    r.pembanding += x.pembanding;
  }
  return r;
}

export function bandingBulan(lines, cabangList, bulan, hariIni) {
  const bulanIni = String(hariIni).slice(0, 7);
  const hari = Number(String(hariIni).slice(8, 10));
  const berjalan = bulan[bulan.length - 1] === bulanIni;
  const sebelum = bulan.length > 1 ? bulan[bulan.length - 2] : null;
  const peta = new Map();
  for (const c of cabangList || []) peta.set(String(c.kode), rekamBaru(String(c.kode), String(c.nama || c.kode), jenisWarehouse(c.kode, c.nama), bulan));
  let diabaikan = 0;
  for (const l of lines || []) {
    const b = String(l.tanggal || '').slice(0, 7);
    if (!bulan.includes(b)) continue;
    const w = peta.get(String(l.kode_cabang));
    if (!w) { diabaikan++; continue; }
    const n = Number(l.amount) || 0;
    const etoll = l.metode === 'ETOLL';
    const kolom = l.jenis === 'TOL' ? (etoll ? 'tolEtoll' : 'tolTunai') : (etoll ? 'bbmEtoll' : 'bbmTunai');
    w.rinci[b][kolom] += n;
    w.rinci[b].total += n;
    w.per[b] += n;
    if (berjalan && b === sebelum && Number(String(l.tanggal).slice(8, 10)) <= hari) w.pembanding += n;
  }
  const semua = [...peta.values()];
  // Bulan-bulan awal tanpa data (sebelum aplikasi dipakai) tidak ditampilkan dan tidak masuk rata-rata.
  const awal = bulan.findIndex((bl) => semua.some((w) => w.per[bl] > 0));
  const tampil = awal > 0 ? bulan.slice(awal) : bulan;
  const kelompok = (jenis) => {
    const isi = semua.filter((w) => w.jenis === jenis);
    const baris = isi.map((w) => turunan(w, tampil, berjalan, hari)).sort((a, b) => b.total - a.total || a.nama.localeCompare(b.nama));
    const sub = isi.reduce((t, w) => gabungRekam(t, w, bulan), rekamBaru('', '', '', bulan));
    return { jenis, baris, sub: { ...turunan(sub, tampil, berjalan, hari), nama: jenis === 'PUSAT' ? 'Subtotal Gudang Pusat (Whp)' : 'Subtotal Cabang (Who)', jenis } };
  };
  const cabang = kelompok('CABANG');
  const pusat = kelompok('PUSAT');
  const total = { ...turunan(gabungRekam(cabang.sub, pusat.sub, bulan), tampil, berjalan, hari), nama: 'TOTAL', jenis: '' };
  return { bulan: tampil, berjalan, hari, hariIni, cabang, pusat, total, diabaikan };
}

// ── Spesifikasi Excel (array-of-arrays; dirender bukuExcel) ─────────────────

const tglId = (t) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(t || '');
};
const NAMA_JENIS = { CABANG: 'Cabang (Who)', PUSAT: 'Gudang Pusat (Whp)' };
const angkaAtauKosong = (v) => (v === null || v === undefined ? '' : v);

export function susunExcelBanding(h, { dari = '', sampai = '' } = {}) {
  const ringkas = (k) => [NAMA_JENIS[k.jenis], k.baris.length, k.sub.kendaraan, k.sub.bbm, k.sub.tol, k.sub.etoll, k.sub.tunai, k.sub.total, k.sub.persen, k.sub.perKendaraan];
  const ringkasan = {
    nama: 'Ringkasan',
    aoa: [
      ['Perbandingan Pengeluaran: Cabang & Gudang Pusat'],
      ['Periode', `${tglId(dari)} s.d. ${tglId(sampai)}`],
      ['Keterangan', 'BBM + tol, via etoll dan tunai (termasuk kartu ke-2 dan tol manual Flazz). Warehouse nonaktif tidak dihitung.'],
      [],
      ['Kelompok', 'Jumlah Warehouse', 'Kendaraan', 'BBM (Rp)', 'Tol (Rp)', 'Etoll (Rp)', 'Tunai (Rp)', 'Total (Rp)', '% Total', 'Per Kendaraan (Rp)'],
      ringkas(h.cabang),
      ringkas(h.pusat),
      ['Total', h.cabang.baris.length + h.pusat.baris.length, h.total.kendaraan, h.total.bbm, h.total.tol, h.total.etoll, h.total.tunai, h.total.total, h.total.persen, h.total.perKendaraan],
    ],
    angka: { baris: [5, 6, 7], kolom: [3, 4, 5, 6, 7, 9] },
    persen: { baris: [5, 6, 7], kolom: [8] },
  };
  const urut = [...h.cabang.baris, ...h.pusat.baris];
  const detail = {
    nama: 'Per Warehouse',
    aoa: [
      ['No', 'Jenis', 'Warehouse', 'Kendaraan', 'BBM Etoll (Rp)', 'BBM Tunai (Rp)', 'Tol Etoll (Rp)', 'Tol Tunai (Rp)', 'BBM (Rp)', 'Tol (Rp)', 'Etoll (Rp)', 'Tunai (Rp)', 'Total (Rp)', '% Total', 'Per Kendaraan (Rp)'],
      ...urut.map((w, i) => [i + 1, NAMA_JENIS[w.jenis], w.nama, w.kendaraan, w.bbmEtoll, w.bbmTunai, w.tolEtoll, w.tolTunai, w.bbm, w.tol, w.etoll, w.tunai, w.total, w.persen, w.perKendaraan]),
      ['', '', 'TOTAL', h.total.kendaraan, h.total.bbmEtoll, h.total.bbmTunai, h.total.tolEtoll, h.total.tolTunai, h.total.bbm, h.total.tol, h.total.etoll, h.total.tunai, h.total.total, h.total.persen, h.total.perKendaraan],
    ],
    angka: { kolom: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14] },
    persen: { kolom: [13] },
    filter: true,
  };
  return [ringkasan, detail];
}

export function susunExcelBulanan(b) {
  const label = (bl) => labelBulan(bl) + (b.berjalan && bl === b.bulan[b.bulan.length - 1] ? ' (berjalan)' : '');
  const awal = labelBulan(b.bulan[0]);
  const akhir = labelBulan(b.bulan[b.bulan.length - 1]);
  const teksDelta = b.berjalan ? `Selisih s.d. tgl ${b.hari} (Rp)` : 'Selisih Bulan Terakhir (Rp)';
  const barisBulan = (r) => b.bulan.map((bl) => r.per[bl]);

  // Ringkasan per bulan (cabang vs gudang pusat).
  const ringkasanBaris = b.bulan.map((bl, i) => {
    const tot = b.total.per[bl];
    const last = i === b.bulan.length - 1;
    const pembanding = i === 0 ? null : (last && b.berjalan ? b.total.pembanding : b.total.per[b.bulan[i - 1]]);
    const delta = pembanding === null ? '' : tot - pembanding;
    const persen = pembanding && pembanding > 0 ? ((tot - pembanding) / pembanding) * 100 : '';
    return [label(bl), b.cabang.sub.per[bl], b.pusat.sub.per[bl], tot, delta, persen];
  });
  const ringkasan = {
    nama: 'Ringkasan',
    aoa: [
      ['Perbandingan Pengeluaran Bulan vs Bulan'],
      ['Periode', `${awal} s.d. ${akhir}`],
      ['Data sampai', tglId(b.hariIni)],
      ['Catatan', b.berjalan ? `Bulan terakhir masih berjalan: selisihnya dibandingkan dengan bulan sebelumnya pada rentang tanggal yang sama (1–${b.hari}). Rata-rata per bulan hanya dari bulan penuh.` : 'Seluruh bulan adalah bulan penuh.'],
      [],
      ['Bulan', 'Cabang (Who) (Rp)', 'Gudang Pusat (Whp) (Rp)', 'Total (Rp)', 'Selisih vs Bulan Sebelumnya (Rp)', 'Selisih (%)'],
      ...ringkasanBaris,
    ],
    angka: { baris: ringkasanBaris.map((_, i) => 6 + i), kolom: [1, 2, 3, 4] },
    persen: { baris: ringkasanBaris.map((_, i) => 6 + i), kolom: [5] },
  };

  // Matriks per warehouse (baris subtotal & total di dalam tabel).
  const kolomAwal = 3;
  const barisW = (w, no) => [no, NAMA_JENIS[w.jenis], w.nama, ...barisBulan(w), w.total, w.rata, w.delta, angkaAtauKosong(w.deltaPersen), b.berjalan ? angkaAtauKosong(w.proyeksi) : ''];
  const barisSub = (r, nama) => ['', '', nama, ...barisBulan(r), r.total, r.rata, r.delta, angkaAtauKosong(r.deltaPersen), b.berjalan ? angkaAtauKosong(r.proyeksi) : ''];
  const aoaM = [
    ['No', 'Jenis', 'Warehouse', ...b.bulan.map(label), 'Total (Rp)', 'Rata-rata/Bulan (Rp)', teksDelta, 'Selisih (%)', 'Proyeksi Bulan Berjalan (Rp)'],
    ...b.cabang.baris.map((w, i) => barisW(w, i + 1)),
    barisSub(b.cabang.sub, 'Subtotal Cabang (Who)'),
    ...b.pusat.baris.map((w, i) => barisW(w, i + 1)),
    barisSub(b.pusat.sub, 'Subtotal Gudang Pusat (Whp)'),
    barisSub(b.total, 'TOTAL'),
  ];
  const nB = b.bulan.length;
  const kolomRp = [...Array.from({ length: nB }, (_, i) => kolomAwal + i), kolomAwal + nB, kolomAwal + nB + 1, kolomAwal + nB + 2, kolomAwal + nB + 4];
  const matriks = { nama: 'Per Warehouse', aoa: aoaM, angka: { kolom: kolomRp }, persen: { kolom: [kolomAwal + nB + 3] } };

  // Rinci (cocok untuk pivot): satu baris per bulan × warehouse yang ada pengeluaran.
  const rinci = [];
  for (const bl of b.bulan) {
    for (const w of [...b.cabang.baris, ...b.pusat.baris]) {
      const r = w.rinci[bl];
      if (r.total > 0) rinci.push([label(bl), NAMA_JENIS[w.jenis], w.nama, r.bbmEtoll, r.bbmTunai, r.tolEtoll, r.tolTunai, r.total]);
    }
  }
  const jumlah = (i) => rinci.reduce((n, x) => n + x[i], 0);
  const detail = {
    nama: 'Rinci Bulanan',
    aoa: [
      ['Bulan', 'Jenis', 'Warehouse', 'BBM Etoll (Rp)', 'BBM Tunai (Rp)', 'Tol Etoll (Rp)', 'Tol Tunai (Rp)', 'Total (Rp)'],
      ...rinci,
      ['TOTAL', '', '', jumlah(3), jumlah(4), jumlah(5), jumlah(6), jumlah(7)],
    ],
    angka: { kolom: [3, 4, 5, 6, 7] },
    filter: true,
  };
  return [ringkasan, matriks, detail];
}

// ── Tampilan ────────────────────────────────────────────────────────────────

const rp = (n) => `Rp ${fmtNum(Math.round(n))}`;
const pct = (n) => `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
const LABEL = { CABANG: 'Cabang (Who)', PUSAT: 'Gudang Pusat (Whp)' };

export function teksDelta(n) {
  if (!n) return '-';
  return `${n > 0 ? '+' : '−'}Rp ${fmtNum(Math.abs(Math.round(n)))}`;
}

export function teksDeltaPersen(n) {
  if (n === null || n === undefined) return '-';
  if (Math.abs(n) < 0.05) return '0%';
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
}

// Pengeluaran naik = merah (boros), turun = hijau.
const kelasDelta = (n) => (!n ? '' : n > 0 ? 'text-danger' : 'text-success');

function kartu(kelas, judul, nilai, sub) {
  return el('div', { class: 'col-6 col-lg-3' }, [el('div', { class: `rounded-3 p-3 h-100 ${kelas}` }, [
    el('div', { class: 'small opacity-75', text: judul }),
    el('div', { class: 'h5 fw-bold mb-0', text: nilai }),
    sub ? el('div', { class: 'small opacity-75', text: sub }) : null,
  ])]);
}

function tabelKelompok(k) {
  const sel = (n, tebal) => el('td', { class: `text-end text-nowrap ${tebal ? 'fw-bold' : ''}`, text: n ? rp(n) : '-' });
  return el('div', { class: 'mb-4' }, [
    el('h3', { class: 'h6 fw-bold mb-2', text: `${LABEL[k.jenis]} — ${k.baris.length} warehouse` }),
    el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-hover align-middle' }, [
      el('thead', { class: 'table-light' }, [el('tr', {}, ['Warehouse', 'Kendaraan', 'BBM', 'Tol', 'Etoll', 'Tunai', 'Total', '% Total', 'Per kendaraan'].map((h, i) => el('th', { class: i ? 'text-end' : '', text: h })))]),
      el('tbody', {}, [
        ...k.baris.map((w) => el('tr', {}, [
          el('td', { class: 'fw-semibold', text: w.nama }),
          el('td', { class: 'text-end', text: fmtNum(w.kendaraan) }),
          sel(w.bbm), sel(w.tol), sel(w.etoll), sel(w.tunai), sel(w.total, true),
          el('td', { class: 'text-end', text: pct(w.persen) }),
          sel(w.perKendaraan),
        ])),
        el('tr', { class: 'table-light fw-bold' }, [
          el('td', { text: 'Subtotal' }), el('td', { class: 'text-end', text: fmtNum(k.sub.kendaraan) }),
          sel(k.sub.bbm, true), sel(k.sub.tol, true), sel(k.sub.etoll, true), sel(k.sub.tunai, true), sel(k.sub.total, true),
          el('td', { class: 'text-end', text: pct(k.sub.persen) }), sel(k.sub.perKendaraan, true),
        ]),
      ]),
    ])]),
  ]);
}

function grafik(h) {
  const semua = [...h.cabang.baris, ...h.pusat.baris].sort((a, b) => b.total - a.total);
  const maks = Math.max(1, ...semua.map((w) => w.total));
  return el('div', { class: 'mb-4' }, [
    el('h3', { class: 'h6 fw-bold mb-2', text: 'Total pengeluaran per warehouse' }),
    el('div', { class: 'd-flex gap-3 small mb-2' }, [
      el('span', {}, [el('span', { class: 'bar-legenda bar-cabang' }), ' Cabang (Who)']),
      el('span', {}, [el('span', { class: 'bar-legenda bar-pusat' }), ' Gudang Pusat (Whp)']),
    ]),
    ...semua.map((w) => el('div', { class: 'bar-baris' }, [
      el('div', { class: 'bar-nama', text: w.nama }),
      el('div', { class: 'bar-jalur' }, [el('div', { class: `bar-isi ${w.jenis === 'PUSAT' ? 'bar-pusat' : 'bar-cabang'}`, style: `width:${(w.total / maks) * 100}%` })]),
      el('div', { class: 'bar-nilai', text: rp(w.total) }),
    ])),
  ]);
}

const kolom = (lebar, label, kontrol) => el('div', { class: lebar }, [el('label', { class: 'form-label small fw-bold text-muted text-uppercase', text: label }), kontrol]);

async function unduhExcel(sheets, namaFile) {
  const XLSX = await muatSheetJS();
  XLSX.writeFile(bukuExcel(XLSX, sheets), namaFile);
}

// Mode 1: cabang vs gudang pusat.
function panelBanding(ambilMaster) {
  const hariIni = tanggalWib();
  const dari = el('input', { type: 'date', class: 'form-control', value: awalBulan(hariIni) });
  const sampai = el('input', { type: 'date', class: 'form-control', value: hariIni });
  const tombol = el('button', { class: 'btn btn-primary flex-fill', type: 'button', text: 'Tampilkan' });
  const unduh = el('button', { class: 'btn btn-outline-primary', type: 'button', text: 'Unduh Excel' });
  const isi = el('div', {});
  let hasil = null;

  async function muat() {
    if (dari.value > sampai.value) { toast('Tanggal "dari" tidak boleh setelah tanggal "sampai".', 'error'); return; }
    tombol.disabled = true;
    isi.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat perbandingan…' }));
    try {
      const master = await ambilMaster();
      const q = new URLSearchParams({ dari: dari.value, sampai: sampai.value });
      const { lines = [] } = await get(`/api/laporan/rekap-pengeluaran?${q}`);
      const h = bandingkan(lines, master.cabangList || [], master.vehicles || []);
      hasil = h.total.total ? h : null;
      if (!hasil) {
        isi.replaceChildren(el('div', { class: 'text-center text-muted py-4', text: 'Tidak ada pengeluaran pada periode ini.' }));
        return;
      }
      isi.replaceChildren(...[
        el('div', { class: 'row g-3 mb-4' }, [
          kartu('bg-success text-white', 'Cabang (Who)', rp(h.cabang.sub.total), `${pct(h.cabang.sub.persen)} dari total · ${h.cabang.baris.length} warehouse`),
          kartu('kartu-biru', 'Gudang Pusat (Whp)', rp(h.pusat.sub.total), `${pct(h.pusat.sub.persen)} dari total · ${h.pusat.baris.length} warehouse`),
          kartu('border bg-white', 'Rata-rata per kendaraan (cabang)', rp(h.cabang.sub.perKendaraan), `${fmtNum(h.cabang.sub.kendaraan)} kendaraan`),
          kartu('border bg-white', 'Rata-rata per kendaraan (gudang pusat)', rp(h.pusat.sub.perKendaraan), `${fmtNum(h.pusat.sub.kendaraan)} kendaraan`),
        ]),
        grafik(h),
        tabelKelompok(h.cabang),
        tabelKelompok(h.pusat),
        el('div', { class: 'd-flex justify-content-between flex-wrap gap-2 fw-bold border-top pt-2' }, [
          el('span', { text: 'Total keseluruhan' }), el('span', { text: rp(h.total.total) }),
        ]),
        h.diabaikan ? el('div', { class: 'small text-muted mt-2', text: `${fmtNum(h.diabaikan)} pembayaran dari warehouse yang sudah tidak aktif tidak dihitung.` }) : null,
      ].filter(Boolean));
    } catch (err) {
      hasil = null;
      isi.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    } finally {
      tombol.disabled = false;
    }
  }
  tombol.addEventListener('click', muat);
  unduh.addEventListener('click', async () => {
    if (!hasil) { toast('Tidak ada data untuk diunduh.', 'error'); return; }
    unduh.disabled = true;
    try {
      await unduhExcel(susunExcelBanding(hasil, { dari: dari.value, sampai: sampai.value }), `perbandingan-warehouse-${dari.value}_${sampai.value}.xlsx`);
    } catch (err) {
      toast(err.message || 'Gagal membuat file Excel.', 'error');
    } finally {
      unduh.disabled = false;
    }
  });

  const node = el('div', {}, [
    el('div', { class: 'panel' }, [
      el('h2', { class: 'h5 mb-3 pb-2 border-bottom', text: 'Perbandingan Pengeluaran: Cabang & Gudang Pusat' }),
      el('div', { class: 'row g-2 align-items-end' }, [
        kolom('col-md-4', 'Dari tanggal', dari), kolom('col-md-4', 'Sampai tanggal', sampai),
        el('div', { class: 'col-md-4 d-flex gap-2' }, [tombol, unduh]),
      ]),
      el('div', { class: 'form-text mt-2', text: 'Pengeluaran = BBM + tol, via etoll dan tunai (termasuk kartu ke-2 dan tol manual Flazz), sama dengan Rekap Pengeluaran.' }),
    ]),
    el('div', { class: 'panel' }, [isi]),
  ]);
  return { node, muat };
}

// Mode 2: bulan vs bulan per warehouse.
function grafikBulanan(b) {
  const maks = Math.max(1, ...b.bulan.map((bl) => b.total.per[bl]));
  return el('div', { class: 'mb-4' }, [
    el('h3', { class: 'h6 fw-bold mb-2', text: 'Total pengeluaran per bulan' }),
    el('div', { class: 'd-flex gap-3 small mb-2' }, [
      el('span', {}, [el('span', { class: 'bar-legenda bar-cabang' }), ' Cabang (Who)']),
      el('span', {}, [el('span', { class: 'bar-legenda bar-pusat' }), ' Gudang Pusat (Whp)']),
    ]),
    ...b.bulan.map((bl) => {
      const c = b.cabang.sub.per[bl];
      const p = b.pusat.sub.per[bl];
      return el('div', { class: 'bar-baris' }, [
        el('div', { class: 'bar-nama', text: labelBulan(bl) + (b.berjalan && bl === b.bulan[b.bulan.length - 1] ? ' *' : '') }),
        el('div', { class: 'bar-jalur d-flex' }, [
          el('div', { class: 'bar-isi bar-cabang', style: `width:${(c / maks) * 100}%`, title: `Cabang ${rp(c)}` }),
          el('div', { class: 'bar-isi bar-pusat', style: `width:${(p / maks) * 100}%`, title: `Gudang pusat ${rp(p)}` }),
        ]),
        el('div', { class: 'bar-nilai', text: rp(b.total.per[bl]) }),
      ]);
    }),
    b.berjalan ? el('div', { class: 'small text-muted', text: `* bulan berjalan, data sampai tanggal ${b.hari}.` }) : null,
  ].filter(Boolean));
}

function tabelBulanan(b, k) {
  const sel = (n, tebal, kelas = '') => el('td', { class: `text-end text-nowrap ${tebal ? 'fw-bold' : ''} ${kelas}`, text: n ? rp(n) : '-' });
  const baris = (w, tebal) => el('tr', { class: tebal ? 'table-light fw-bold' : '' }, [
    el('td', { class: tebal ? '' : 'fw-semibold', text: tebal ? w.nama : w.nama }),
    ...b.bulan.map((bl) => sel(w.per[bl], tebal)),
    sel(w.rata, tebal),
    el('td', { class: `text-end text-nowrap ${tebal ? 'fw-bold' : ''} ${kelasDelta(w.delta)}`, text: teksDelta(w.delta) }),
    el('td', { class: `text-end text-nowrap ${kelasDelta(w.delta)}`, text: teksDeltaPersen(w.deltaPersen) }),
    ...(b.berjalan ? [sel(w.proyeksi, tebal)] : []),
  ]);
  const judulDelta = b.berjalan ? `Selisih s.d. tgl ${b.hari}` : 'Selisih bln terakhir';
  return el('div', { class: 'mb-4' }, [
    el('h3', { class: 'h6 fw-bold mb-2', text: `${LABEL[k.jenis]} — ${k.baris.length} warehouse` }),
    el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-hover align-middle' }, [
      el('thead', { class: 'table-light' }, [el('tr', {}, [
        'Warehouse', ...b.bulan.map((bl) => labelBulan(bl) + (b.berjalan && bl === b.bulan[b.bulan.length - 1] ? ' *' : '')),
        'Rata-rata/bln', judulDelta, '%', ...(b.berjalan ? ['Proyeksi bln ini'] : []),
      ].map((h, i) => el('th', { class: i ? 'text-end text-nowrap' : '', text: h })))]),
      el('tbody', {}, [...k.baris.map((w) => baris(w, false)), baris(k.sub, true)]),
    ])]),
  ]);
}

function panelBulanan(ambilMaster) {
  const jumlah = el('select', { class: 'form-select' }, [3, 6, 12].map((n) => el('option', { value: String(n), text: `${n} bulan terakhir` })));
  jumlah.value = '6';
  const tombol = el('button', { class: 'btn btn-primary flex-fill', type: 'button', text: 'Tampilkan' });
  const unduh = el('button', { class: 'btn btn-outline-primary', type: 'button', text: 'Unduh Excel' });
  const isi = el('div', {});
  let hasil = null;

  async function muat() {
    tombol.disabled = true;
    isi.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat perbandingan…' }));
    try {
      const hariIni = tanggalWib();
      const bulan = daftarBulan(hariIni, Number(jumlah.value));
      const master = await ambilMaster();
      const q = new URLSearchParams({ dari: `${bulan[0]}-01`, sampai: hariIni });
      const { lines = [] } = await get(`/api/laporan/rekap-pengeluaran?${q}`);
      const b = bandingBulan(lines, master.cabangList || [], bulan, hariIni);
      hasil = b.total.total ? b : null;
      if (!hasil) {
        isi.replaceChildren(el('div', { class: 'text-center text-muted py-4', text: 'Tidak ada pengeluaran pada periode ini.' }));
        return;
      }
      isi.replaceChildren(...[
        el('div', { class: 'row g-3 mb-4' }, [
          kartu('bg-success text-white', `Total ${labelBulan(bulan[bulan.length - 1])}${b.berjalan ? ` (s.d. tgl ${b.hari})` : ''}`, rp(b.total.terakhir),
            b.total.pembandingTerakhir > 0 ? `${teksDeltaPersen(b.total.deltaPersen)} dari ${b.berjalan ? 'periode sama bulan lalu' : 'bulan sebelumnya'}` : 'belum ada pembanding'),
          kartu('border bg-white', 'Rata-rata per bulan (bulan penuh)', rp(b.total.rata), b.bulan.length > 1 || !b.berjalan ? `${b.cabang.baris.length + b.pusat.baris.length} warehouse` : 'belum ada bulan penuh'),
          b.berjalan ? kartu('kartu-biru', 'Proyeksi akhir bulan ini', rp(b.total.proyeksi ?? 0), 'perkiraan linear dari data berjalan') : kartu('border bg-white', 'Total periode', rp(b.total.total), `${b.bulan.length} bulan`),
          kartu('border bg-white', `Cabang (Who) · ${labelBulan(bulan[bulan.length - 1])}`, rp(b.cabang.sub.terakhir), `Gudang pusat (Whp): ${rp(b.pusat.sub.terakhir)}`),
        ]),
        grafikBulanan(b),
        tabelBulanan(b, b.cabang),
        tabelBulanan(b, b.pusat),
        el('div', { class: 'd-flex justify-content-between flex-wrap gap-2 fw-bold border-top pt-2' }, [
          el('span', { text: `Total ${b.bulan.length} bulan` }), el('span', { text: rp(b.total.total) }),
        ]),
        el('div', { class: 'small text-muted mt-2' }, [
          'Rata-rata/bln dihitung dari bulan penuh saja. ',
          b.berjalan ? `Selisih membandingkan ${labelBulan(bulan[bulan.length - 1])} s.d. tanggal ${b.hari} dengan tanggal yang sama bulan sebelumnya; proyeksi = pengeluaran berjalan ÷ ${b.hari} hari × jumlah hari bulan itu (perkiraan). ` : '',
          'Merah = pengeluaran naik, hijau = turun.',
        ]),
        b.diabaikan ? el('div', { class: 'small text-muted mt-1', text: `${fmtNum(b.diabaikan)} pembayaran dari warehouse yang sudah tidak aktif tidak dihitung.` }) : null,
      ].filter(Boolean));
    } catch (err) {
      hasil = null;
      isi.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    } finally {
      tombol.disabled = false;
    }
  }
  tombol.addEventListener('click', muat);
  unduh.addEventListener('click', async () => {
    if (!hasil) { toast('Tidak ada data untuk diunduh.', 'error'); return; }
    unduh.disabled = true;
    try {
      await unduhExcel(susunExcelBulanan(hasil), `perbandingan-bulanan-${hasil.bulan[0]}_${hasil.bulan[hasil.bulan.length - 1]}.xlsx`);
    } catch (err) {
      toast(err.message || 'Gagal membuat file Excel.', 'error');
    } finally {
      unduh.disabled = false;
    }
  });

  const node = el('div', {}, [
    el('div', { class: 'panel' }, [
      el('h2', { class: 'h5 mb-3 pb-2 border-bottom', text: 'Perbandingan Pengeluaran Bulan vs Bulan per Warehouse' }),
      el('div', { class: 'row g-2 align-items-end' }, [
        kolom('col-md-4', 'Rentang', jumlah),
        el('div', { class: 'col-md-4 d-flex gap-2' }, [tombol, unduh]),
      ]),
      el('div', { class: 'form-text mt-2', text: 'Dasar untuk melihat tren dan merencanakan anggaran BBM & tol per warehouse. Sumber data sama dengan Rekap Pengeluaran.' }),
    ]),
    el('div', { class: 'panel' }, [isi]),
  ]);
  return { node, muat };
}

export async function renderPerbandingan(view) {
  if (getUser()?.role !== 'SUPERADMIN') {
    view.replaceChildren(el('div', { class: 'alert alert-warning', text: 'Perbandingan antar warehouse hanya untuk SUPERADMIN.' }));
    return { ok: false };
  }
  let masterP = null;
  const ambilMaster = () => {
    masterP ??= get('/api/master').catch((err) => { masterP = null; throw err; });
    return masterP;
  };
  const tab = {
    bulanan: { label: 'Bulan vs Bulan', panel: panelBulanan(ambilMaster), dimuat: false },
    banding: { label: 'Cabang vs Gudang Pusat', panel: panelBanding(ambilMaster), dimuat: false },
  };
  const tempat = el('div', {});
  const bar = el('div', { class: 'd-flex gap-2 flex-wrap mb-3' });
  const tombolTab = {};
  function pilih(kunci) {
    for (const [k, t] of Object.entries(tab)) tombolTab[k].className = `btn btn-sm ${k === kunci ? 'btn-primary' : 'btn-outline-primary'}`;
    tempat.replaceChildren(tab[kunci].panel.node);
    if (!tab[kunci].dimuat) { tab[kunci].dimuat = true; tab[kunci].panel.muat(); }
  }
  for (const [k, t] of Object.entries(tab)) {
    const b = el('button', { type: 'button', text: t.label });
    b.addEventListener('click', () => pilih(k));
    tombolTab[k] = b;
    bar.appendChild(b);
  }
  view.replaceChildren(bar, tempat);
  pilih('bulanan');
  return { ok: true };
}
