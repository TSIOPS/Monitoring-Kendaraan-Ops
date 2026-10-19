import { get } from '../api.js';
import { getUser } from '../store.js';
import { lihatSemuaCabang } from '../peran.js';
import { el, fmtNum, toast, idUntukLabel } from '../ui.js';
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

// Tab "Bulan vs Bulan": rentang tanggal pilihan dibandingkan dengan rentang yang sama di bulan
// sebelumnya (mis. 1–19 Okt vs 1–19 Sep). Bila rentang = awal bulan s.d. hari ini, ditambah
// total bulan lalu penuh dan proyeksi akhir bulan.
export const MAKS_HARI_RENTANG = 31;
const pad2 = (n) => String(n).padStart(2, '0');
const akhirBulan = (tgl) => Number(tgl.slice(8, 10)) === hariDalamBulan(tgl.slice(0, 7));

// Tanggal yang sama sebulan sebelumnya; 31 Okt -> 30 Sep, akhir bulan -> akhir bulan sebelumnya.
export function mundurSebulan(tgl) {
  const [y, m, d] = String(tgl).split('-').map(Number);
  const b = m === 1 ? `${y - 1}-12` : `${y}-${pad2(m - 1)}`;
  const hari = akhirBulan(tgl) ? hariDalamBulan(b) : Math.min(d, hariDalamBulan(b));
  return `${b}-${pad2(hari)}`;
}

export function periodeLalu(dari, sampai) {
  return { dari: mundurSebulan(dari), sampai: mundurSebulan(sampai) };
}

// '' bila rentang sah; selain itu pesan untuk pengguna.
export function cekRentangBanding(dari, sampai) {
  if (!dari || !sampai) return 'Isi tanggal dari dan sampai.';
  if (dari > sampai) return 'Tanggal "dari" tidak boleh setelah tanggal "sampai".';
  const hari = Math.round((Date.parse(sampai + 'T00:00:00Z') - Date.parse(dari + 'T00:00:00Z')) / 86_400_000) + 1;
  if (hari > MAKS_HARI_RENTANG) return `Rentang maksimal ${MAKS_HARI_RENTANG} hari (dibandingkan dengan rentang yang sama bulan sebelumnya).`;
  return '';
}

// "1–19 Okt 2026" (satu bulan) atau "28 Sep – 5 Okt 2026".
export function labelRentang(dari, sampai) {
  const [y1, m1, d1] = dari.split('-').map(Number);
  const [y2, m2, d2] = sampai.split('-').map(Number);
  const bln = (y, m) => `${NAMA_BULAN[m - 1]} ${y}`;
  if (y1 === y2 && m1 === m2) return d1 === d2 ? `${d1} ${bln(y1, m1)}` : `${d1}–${d2} ${bln(y1, m1)}`;
  return y1 === y2 ? `${d1} ${NAMA_BULAN[m1 - 1]} – ${d2} ${bln(y2, m2)}` : `${d1} ${bln(y1, m1)} – ${d2} ${bln(y2, m2)}`;
}

const rinciKosong = () => ({ bbmEtoll: 0, bbmTunai: 0, tolEtoll: 0, tolTunai: 0, total: 0 });
const rekamRentang = (kode, nama, jenis) => ({ kode, nama, jenis, ini: 0, lalu: 0, penuhLalu: 0, rinciIni: rinciKosong(), rinciLalu: rinciKosong() });

function hitungTurunan(r, proyeksiHari, hariBulan) {
  const delta = r.ini - r.lalu;
  return {
    ...r,
    delta,
    deltaPersen: r.lalu > 0 ? (delta / r.lalu) * 100 : null,
    proyeksi: proyeksiHari ? (r.ini / proyeksiHari) * hariBulan : null,
  };
}

function jumlahkan(list, nama, jenis) {
  const t = rekamRentang('', nama, jenis);
  for (const w of list) {
    t.ini += w.ini; t.lalu += w.lalu; t.penuhLalu += w.penuhLalu;
    for (const k of Object.keys(rinciKosong())) { t.rinciIni[k] += w.rinciIni[k]; t.rinciLalu[k] += w.rinciLalu[k]; }
  }
  return t;
}

export function bandingRentang(lines, cabangList, dari, sampai, hariIni) {
  const lalu = periodeLalu(dari, sampai);
  const bulanLalu = lalu.dari.slice(0, 7);
  // Bulan berjalan s.d. hari ini (dari tanggal 1): tambah bulan lalu penuh & proyeksi.
  const berjalan = dari.endsWith('-01') && sampai === hariIni && dari.slice(0, 7) === sampai.slice(0, 7);
  const hariIniKe = Number(sampai.slice(8, 10));
  const hariBulan = hariDalamBulan(sampai.slice(0, 7));
  const peta = new Map();
  for (const c of cabangList || []) peta.set(String(c.kode), rekamRentang(String(c.kode), String(c.nama || c.kode), jenisWarehouse(c.kode, c.nama)));
  let diabaikan = 0;
  for (const l of lines || []) {
    const t = String(l.tanggal || '').slice(0, 10);
    const diIni = t >= dari && t <= sampai;
    const diLalu = t >= lalu.dari && t <= lalu.sampai;
    const diPenuh = berjalan && t.slice(0, 7) === bulanLalu;
    if (!diIni && !diLalu && !diPenuh) continue;
    const w = peta.get(String(l.kode_cabang));
    if (!w) { diabaikan++; continue; }
    const n = Number(l.amount) || 0;
    const etoll = l.metode === 'ETOLL';
    const kolom = l.jenis === 'TOL' ? (etoll ? 'tolEtoll' : 'tolTunai') : (etoll ? 'bbmEtoll' : 'bbmTunai');
    if (diIni) { w.ini += n; w.rinciIni[kolom] += n; w.rinciIni.total += n; }
    if (diLalu) { w.lalu += n; w.rinciLalu[kolom] += n; w.rinciLalu.total += n; }
    if (diPenuh) w.penuhLalu += n;
  }
  const proyeksiHari = berjalan ? hariIniKe : 0;
  const semua = [...peta.values()];
  const kelompok = (jenis) => {
    const isi = semua.filter((w) => w.jenis === jenis);
    const baris = isi.map((w) => hitungTurunan(w, proyeksiHari, hariBulan)).sort((a, b) => b.ini - a.ini || b.lalu - a.lalu || a.nama.localeCompare(b.nama));
    const nama = jenis === 'PUSAT' ? 'Subtotal Gudang Pusat (Whp)' : 'Subtotal Cabang (Who)';
    return { jenis, baris, sub: hitungTurunan(jumlahkan(isi, nama, jenis), proyeksiHari, hariBulan) };
  };
  const cabang = kelompok('CABANG');
  const pusat = kelompok('PUSAT');
  const total = hitungTurunan(jumlahkan([cabang.sub, pusat.sub], 'TOTAL', ''), proyeksiHari, hariBulan);
  return { dari, sampai, lalu, berjalan, bulanLalu, hariIni, cabang, pusat, total, diabaikan };
}

// Tab "Bulan vs Bulan": total pengeluaran sebulan dibandingkan dengan total bulan lain
// (mis. September 1–30 vs Oktober 1 s.d. hari ini). Bulan berjalan dihitung s.d. hari ini
// dan diberi proyeksi akhir bulan.

// Rentang tanggal sebuah bulan: penuh, atau s.d. hari ini bila bulan berjalan.
export function rentangBulan(bulan, hariIni) {
  const berjalan = bulan === String(hariIni).slice(0, 7);
  const akhir = berjalan ? String(hariIni).slice(0, 10) : `${bulan}-${String(hariDalamBulan(bulan)).padStart(2, '0')}`;
  return { bulan, dari: `${bulan}-01`, sampai: akhir, berjalan, label: `${labelBulan(bulan)} (1–${Number(akhir.slice(8, 10))}${berjalan ? ', berjalan' : ''})` };
}

// '' bila pilihan sah; selain itu pesan untuk pengguna.
export function cekPilihanBulan(bulanA, bulanB, hariIni) {
  if (!bulanA || !bulanB) return 'Pilih kedua bulan.';
  if (bulanA === bulanB) return 'Pilih dua bulan yang berbeda.';
  const ini = String(hariIni).slice(0, 7);
  if (bulanA > ini || bulanB > ini) return 'Bulan yang dipilih belum berjalan.';
  return '';
}

const rekamBulan = (kode, nama, jenis) => ({ kode, nama, jenis, a: 0, b: 0, rinciA: rinciKosong(), rinciB: rinciKosong() });

function turunanBulan(r, proyeksi) {
  const delta = r.b - r.a;
  return {
    ...r,
    delta,
    deltaPersen: r.a > 0 ? (delta / r.a) * 100 : null,
    proyeksi: proyeksi ? (r.b / proyeksi.hari) * proyeksi.hariBulan : null,
  };
}

function jumlahBulan(list, nama, jenis) {
  const t = rekamBulan('', nama, jenis);
  for (const w of list) {
    t.a += w.a; t.b += w.b;
    for (const k of Object.keys(rinciKosong())) { t.rinciA[k] += w.rinciA[k]; t.rinciB[k] += w.rinciB[k]; }
  }
  return t;
}

// a = bulan pembanding, b = bulan yang dibandingkan. Selisih = total b - total a.
export function bandingDuaBulan(lines, cabangList, bulanA, bulanB, hariIni) {
  const a = rentangBulan(bulanA, hariIni);
  const b = rentangBulan(bulanB, hariIni);
  const proyeksi = b.berjalan ? { hari: Number(b.sampai.slice(8, 10)), hariBulan: hariDalamBulan(bulanB) } : null;
  const peta = new Map();
  for (const c of cabangList || []) peta.set(String(c.kode), rekamBulan(String(c.kode), String(c.nama || c.kode), jenisWarehouse(c.kode, c.nama)));
  let diabaikan = 0;
  for (const l of lines || []) {
    const t = String(l.tanggal || '').slice(0, 10);
    const diA = t >= a.dari && t <= a.sampai;
    const diB = t >= b.dari && t <= b.sampai;
    if (!diA && !diB) continue;
    const w = peta.get(String(l.kode_cabang));
    if (!w) { diabaikan++; continue; }
    const n = Number(l.amount) || 0;
    const etoll = l.metode === 'ETOLL';
    const kolom = l.jenis === 'TOL' ? (etoll ? 'tolEtoll' : 'tolTunai') : (etoll ? 'bbmEtoll' : 'bbmTunai');
    if (diA) { w.a += n; w.rinciA[kolom] += n; w.rinciA.total += n; }
    if (diB) { w.b += n; w.rinciB[kolom] += n; w.rinciB.total += n; }
  }
  const semua = [...peta.values()];
  const kelompok = (jenis) => {
    const isi = semua.filter((w) => w.jenis === jenis);
    const baris = isi.map((w) => turunanBulan(w, proyeksi)).sort((x, y) => y.b - x.b || y.a - x.a || x.nama.localeCompare(y.nama));
    const nama = jenis === 'PUSAT' ? 'Subtotal Gudang Pusat (Whp)' : 'Subtotal Cabang (Who)';
    return { jenis, baris, sub: turunanBulan(jumlahBulan(isi, nama, jenis), proyeksi) };
  };
  const cabang = kelompok('CABANG');
  const pusat = kelompok('PUSAT');
  const total = turunanBulan(jumlahBulan([cabang.sub, pusat.sub], 'TOTAL', ''), proyeksi);
  return { a, b, adaProyeksi: Boolean(proyeksi), hariIni, cabang, pusat, total, diabaikan };
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

export function susunExcelRentang(h) {
  const ini = labelRentang(h.dari, h.sampai);
  const lalu = labelRentang(h.lalu.dari, h.lalu.sampai);
  const penuh = h.berjalan ? `${labelBulan(h.bulanLalu)} penuh (Rp)` : null;
  const ringkasBaris = [
    [NAMA_JENIS.CABANG, h.cabang.sub.lalu, h.cabang.sub.ini, h.cabang.sub.delta, angkaAtauKosong(h.cabang.sub.deltaPersen)],
    [NAMA_JENIS.PUSAT, h.pusat.sub.lalu, h.pusat.sub.ini, h.pusat.sub.delta, angkaAtauKosong(h.pusat.sub.deltaPersen)],
    ['Total', h.total.lalu, h.total.ini, h.total.delta, angkaAtauKosong(h.total.deltaPersen)],
  ];
  const ringkasan = {
    nama: 'Ringkasan',
    aoa: [
      ['Perbandingan Pengeluaran Bulan vs Bulan'],
      ['Periode', ini],
      ['Pembanding', `${lalu} (rentang yang sama bulan sebelumnya)`],
      ['Keterangan', 'BBM + tol, via etoll dan tunai. Selisih positif = pengeluaran naik. Warehouse nonaktif tidak dihitung.'],
      [],
      ['Kelompok', `${lalu} (Rp)`, `${ini} (Rp)`, 'Selisih (Rp)', 'Selisih (%)'],
      ...ringkasBaris,
    ],
    angka: { baris: [6, 7, 8], kolom: [1, 2, 3] },
    persen: { baris: [6, 7, 8], kolom: [4] },
  };
  const kepala = ['No', 'Jenis', 'Warehouse', ...(penuh ? [penuh] : []), `${lalu} (Rp)`, `${ini} (Rp)`, 'Selisih (Rp)', 'Selisih (%)', ...(h.berjalan ? ['Proyeksi Akhir Bulan (Rp)'] : [])];
  const nilai = (w) => [...(penuh ? [w.penuhLalu] : []), w.lalu, w.ini, w.delta, angkaAtauKosong(w.deltaPersen), ...(h.berjalan ? [angkaAtauKosong(w.proyeksi)] : [])];
  const aoaM = [
    kepala,
    ...h.cabang.baris.map((w, i) => [i + 1, NAMA_JENIS[w.jenis], w.nama, ...nilai(w)]),
    ['', '', 'Subtotal Cabang (Who)', ...nilai(h.cabang.sub)],
    ...h.pusat.baris.map((w, i) => [i + 1, NAMA_JENIS[w.jenis], w.nama, ...nilai(w)]),
    ['', '', 'Subtotal Gudang Pusat (Whp)', ...nilai(h.pusat.sub)],
    ['', '', 'TOTAL', ...nilai(h.total)],
  ];
  const awalNilai = 3;
  const nRp = (penuh ? 1 : 0) + 3;
  const kolomPersen = awalNilai + nRp;
  const kolomRp = [...Array.from({ length: nRp }, (_, i) => awalNilai + i), ...(h.berjalan ? [kolomPersen + 1] : [])];
  const matriks = { nama: 'Per Warehouse', aoa: aoaM, angka: { kolom: kolomRp }, persen: { kolom: [kolomPersen] } };

  const rinci = [];
  for (const [label, kunci] of [[lalu, 'rinciLalu'], [ini, 'rinciIni']]) {
    for (const w of [...h.cabang.baris, ...h.pusat.baris]) {
      const r = w[kunci];
      if (r.total > 0) rinci.push([label, NAMA_JENIS[w.jenis], w.nama, r.bbmEtoll, r.bbmTunai, r.tolEtoll, r.tolTunai, r.total]);
    }
  }
  const jumlah = (i) => rinci.reduce((n, x) => n + x[i], 0);
  const detail = {
    nama: 'Rinci',
    aoa: [
      ['Periode', 'Jenis', 'Warehouse', 'BBM Etoll (Rp)', 'BBM Tunai (Rp)', 'Tol Etoll (Rp)', 'Tol Tunai (Rp)', 'Total (Rp)'],
      ...rinci,
      ['TOTAL', '', '', jumlah(3), jumlah(4), jumlah(5), jumlah(6), jumlah(7)],
    ],
    angka: { kolom: [3, 4, 5, 6, 7] },
    filter: true,
  };
  return [ringkasan, matriks, detail];
}

export function susunExcelBulan(h) {
  const A = h.a.label;
  const B = h.b.label;
  const baris3 = [
    [NAMA_JENIS.CABANG, h.cabang.sub.a, h.cabang.sub.b, h.cabang.sub.delta, angkaAtauKosong(h.cabang.sub.deltaPersen)],
    [NAMA_JENIS.PUSAT, h.pusat.sub.a, h.pusat.sub.b, h.pusat.sub.delta, angkaAtauKosong(h.pusat.sub.deltaPersen)],
    ['Total', h.total.a, h.total.b, h.total.delta, angkaAtauKosong(h.total.deltaPersen)],
  ];
  const ringkasan = {
    nama: 'Ringkasan',
    aoa: [
      ['Perbandingan Pengeluaran Bulan vs Bulan'],
      ['Bulan pembanding', A],
      ['Bulan', B],
      ['Data sampai', tglId(h.hariIni)],
      ['Keterangan', `Total BBM + tol (etoll & tunai) sebulan. Selisih = ${labelBulan(h.b.bulan)} − ${labelBulan(h.a.bulan)}; positif = pengeluaran naik.${h.b.berjalan ? ' Bulan berjalan dihitung s.d. tanggal data; lihat proyeksi akhir bulan.' : ''} Warehouse nonaktif tidak dihitung.`],
      [],
      ['Kelompok', `${A} (Rp)`, `${B} (Rp)`, 'Selisih (Rp)', 'Selisih (%)'],
      ...baris3,
    ],
    angka: { baris: [7, 8, 9], kolom: [1, 2, 3] },
    persen: { baris: [7, 8, 9], kolom: [4] },
  };
  const nilai = (w) => [w.a, w.b, w.delta, angkaAtauKosong(w.deltaPersen), ...(h.adaProyeksi ? [angkaAtauKosong(w.proyeksi)] : [])];
  const aoaM = [
    ['No', 'Jenis', 'Warehouse', `${A} (Rp)`, `${B} (Rp)`, 'Selisih (Rp)', 'Selisih (%)', ...(h.adaProyeksi ? ['Proyeksi Akhir Bulan (Rp)'] : [])],
    ...h.cabang.baris.map((w, i) => [i + 1, NAMA_JENIS[w.jenis], w.nama, ...nilai(w)]),
    ['', '', 'Subtotal Cabang (Who)', ...nilai(h.cabang.sub)],
    ...h.pusat.baris.map((w, i) => [i + 1, NAMA_JENIS[w.jenis], w.nama, ...nilai(w)]),
    ['', '', 'Subtotal Gudang Pusat (Whp)', ...nilai(h.pusat.sub)],
    ['', '', 'TOTAL', ...nilai(h.total)],
  ];
  const matriks = { nama: 'Per Warehouse', aoa: aoaM, angka: { kolom: [3, 4, 5, ...(h.adaProyeksi ? [7] : [])] }, persen: { kolom: [6] } };

  const rinci = [];
  for (const [label, kunci] of [[A, 'rinciA'], [B, 'rinciB']]) {
    for (const w of [...h.cabang.baris, ...h.pusat.baris]) {
      const r = w[kunci];
      if (r.total > 0) rinci.push([label, NAMA_JENIS[w.jenis], w.nama, r.bbmEtoll, r.bbmTunai, r.tolEtoll, r.tolTunai, r.total]);
    }
  }
  const jumlah = (i) => rinci.reduce((n, x) => n + x[i], 0);
  const detail = {
    nama: 'Rinci',
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
// Plus (naik) hijau, minus (turun) merah — konvensi yang lazim dibaca pengguna.
const kelasDelta = (n) => (!n ? '' : n > 0 ? 'text-success' : 'text-danger');

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

const kolom = (lebar, label, kontrol) => el('div', { class: lebar }, [el('label', { class: 'form-label small fw-bold text-muted text-uppercase', for: idUntukLabel(kontrol), text: label }), kontrol]);

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
      el('h2', { 'data-judul-halaman': '', class: 'h5 mb-3 pb-2 border-bottom', text: 'Perbandingan Pengeluaran: Cabang & Gudang Pusat' }),
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
function grafikRentang(h) {
  const bar = [
    ...(h.berjalan ? [{ label: `${labelBulan(h.bulanLalu)} (penuh)`, c: h.cabang.sub.penuhLalu, p: h.pusat.sub.penuhLalu, redup: true }] : []),
    { label: labelRentang(h.lalu.dari, h.lalu.sampai), c: h.cabang.sub.lalu, p: h.pusat.sub.lalu, redup: true },
    { label: labelRentang(h.dari, h.sampai), c: h.cabang.sub.ini, p: h.pusat.sub.ini, redup: false },
  ];
  const maks = Math.max(1, ...bar.map((x) => x.c + x.p));
  return el('div', { class: 'mb-4' }, [
    el('h3', { class: 'h6 fw-bold mb-2', text: 'Total pengeluaran' }),
    el('div', { class: 'd-flex gap-3 small mb-2' }, [
      el('span', {}, [el('span', { class: 'bar-legenda bar-cabang' }), ' Cabang (Who)']),
      el('span', {}, [el('span', { class: 'bar-legenda bar-pusat' }), ' Gudang Pusat (Whp)']),
    ]),
    ...bar.map((x) => el('div', { class: `bar-baris${x.redup ? ' opacity-75' : ''}` }, [
      el('div', { class: 'bar-nama', text: x.label }),
      el('div', { class: 'bar-jalur d-flex' }, [
        el('div', { class: 'bar-isi bar-cabang', style: `width:${(x.c / maks) * 100}%`, title: `Cabang ${rp(x.c)}` }),
        el('div', { class: 'bar-isi bar-pusat', style: `width:${(x.p / maks) * 100}%`, title: `Gudang pusat ${rp(x.p)}` }),
      ]),
      el('div', { class: 'bar-nilai', text: rp(x.c + x.p) }),
    ])),
  ]);
}

function tabelRentang(h, k) {
  const sel = (n, tebal, kelas = '') => el('td', { class: `text-end text-nowrap ${tebal ? 'fw-bold' : ''} ${kelas}`, text: n ? rp(n) : '-' });
  const baris = (w, tebal) => el('tr', { class: tebal ? 'table-light fw-bold' : '' }, [
    el('td', { class: tebal ? '' : 'fw-semibold', text: w.nama }),
    ...(h.berjalan ? [sel(w.penuhLalu, tebal, 'text-muted')] : []),
    sel(w.lalu, tebal, 'text-muted'),
    sel(w.ini, tebal),
    el('td', { class: `text-end text-nowrap ${tebal ? 'fw-bold' : ''} ${kelasDelta(w.delta)}`, text: teksDelta(w.delta) }),
    el('td', { class: `text-end text-nowrap ${kelasDelta(w.delta)}`, text: teksDeltaPersen(w.deltaPersen) }),
    ...(h.berjalan ? [sel(w.proyeksi, tebal)] : []),
  ]);
  return el('div', { class: 'mb-4' }, [
    el('h3', { class: 'h6 fw-bold mb-2', text: `${LABEL[k.jenis]} — ${k.baris.length} warehouse` }),
    el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-hover align-middle' }, [
      el('thead', { class: 'table-light' }, [el('tr', {}, [
        'Warehouse', ...(h.berjalan ? [`${labelBulan(h.bulanLalu)} (penuh)`] : []),
        labelRentang(h.lalu.dari, h.lalu.sampai), labelRentang(h.dari, h.sampai), 'Selisih', '%', ...(h.berjalan ? ['Proyeksi akhir bulan'] : []),
      ].map((t, i) => el('th', { class: i ? 'text-end text-nowrap' : '', text: t })))]),
      el('tbody', {}, [...k.baris.map((w) => baris(w, false)), baris(k.sub, true)]),
    ])]),
  ]);
}

function panelRentang(ambilMaster) {
  const hariIni = tanggalWib();
  const dari = el('input', { type: 'date', class: 'form-control', value: awalBulan(hariIni) });
  const sampai = el('input', { type: 'date', class: 'form-control', value: hariIni });
  const pesan = el('div', { class: 'text-danger small mt-1', role: 'alert' });
  const tombol = el('button', { class: 'btn btn-primary flex-fill', type: 'button', text: 'Tampilkan' });
  const unduh = el('button', { class: 'btn btn-outline-primary', type: 'button', text: 'Unduh Excel' });
  const isi = el('div', {});
  let hasil = null;

  async function muat() {
    const salah = cekRentangBanding(dari.value, sampai.value);
    pesan.textContent = salah;
    if (salah) return;
    tombol.disabled = true;
    isi.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat perbandingan…' }));
    try {
      const sekarang = tanggalWib();
      const lalu = periodeLalu(dari.value, sampai.value);
      const master = await ambilMaster();
      // Ambil dari awal bulan pembanding agar total bulan lalu penuh ikut terhitung.
      const q = new URLSearchParams({ dari: `${lalu.dari.slice(0, 7)}-01`, sampai: sampai.value });
      const { lines = [] } = await get(`/api/laporan/rekap-pengeluaran?${q}`);
      const h = bandingRentang(lines, master.cabangList || [], dari.value, sampai.value, sekarang);
      hasil = h.total.ini || h.total.lalu ? h : null;
      if (!hasil) {
        isi.replaceChildren(el('div', { class: 'text-center text-muted py-4', text: 'Tidak ada pengeluaran pada kedua periode ini.' }));
        return;
      }
      const ini = labelRentang(h.dari, h.sampai);
      const lalu2 = labelRentang(h.lalu.dari, h.lalu.sampai);
      isi.replaceChildren(...[
        el('div', { class: 'row g-3 mb-4' }, [
          kartu('bg-success text-white', `Total ${ini}`, rp(h.total.ini), h.total.lalu > 0 ? `${teksDeltaPersen(h.total.deltaPersen)} dari ${lalu2}` : 'belum ada pembanding'),
          kartu('border bg-white', `Pembanding: ${lalu2}`, rp(h.total.lalu), h.berjalan ? `${labelBulan(h.bulanLalu)} penuh: ${rp(h.total.penuhLalu)}` : 'rentang yang sama bulan sebelumnya'),
          h.berjalan
            ? kartu('kartu-biru', 'Proyeksi akhir bulan ini', rp(h.total.proyeksi ?? 0), 'perkiraan linear dari data berjalan')
            : kartu('border bg-white', 'Selisih', teksDelta(h.total.delta), h.total.delta > 0 ? 'pengeluaran naik' : h.total.delta < 0 ? 'pengeluaran turun' : 'sama'),
          kartu('border bg-white', `Cabang (Who) · ${ini}`, rp(h.cabang.sub.ini), `Gudang pusat (Whp): ${rp(h.pusat.sub.ini)}`),
        ]),
        grafikRentang(h),
        tabelRentang(h, h.cabang),
        tabelRentang(h, h.pusat),
        el('div', { class: 'small text-muted mt-2' }, [
          `Selisih membandingkan ${ini} dengan ${lalu2} (rentang yang sama bulan sebelumnya). `,
          h.berjalan ? `Proyeksi = pengeluaran berjalan ÷ ${Number(h.sampai.slice(8, 10))} hari × jumlah hari bulan itu (perkiraan). ` : '',
          'Hijau = naik (+), merah = turun (−).',
        ]),
        h.diabaikan ? el('div', { class: 'small text-muted mt-1', text: `${fmtNum(h.diabaikan)} pembayaran dari warehouse yang sudah tidak aktif tidak dihitung.` }) : null,
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
      await unduhExcel(susunExcelRentang(hasil), `perbandingan-${hasil.dari}_${hasil.sampai}.xlsx`);
    } catch (err) {
      toast(err.message || 'Gagal membuat file Excel.', 'error');
    } finally {
      unduh.disabled = false;
    }
  });

  const node = el('div', {}, [
    el('div', { class: 'panel' }, [
      el('h2', { 'data-judul-halaman': '', class: 'h5 mb-3 pb-2 border-bottom', text: 'Perbandingan Pengeluaran Rentang Tanggal yang Sama' }),
      el('div', { class: 'row g-2 align-items-end' }, [
        kolom('col-md-3', 'Dari tanggal', dari),
        kolom('col-md-3', 'Sampai tanggal', sampai),
        el('div', { class: 'col-md-4 d-flex gap-2' }, [tombol, unduh]),
      ]),
      pesan,
      el('div', { class: 'form-text mt-2', text: `Rentang dibandingkan dengan tanggal yang sama di bulan sebelumnya (maks. ${MAKS_HARI_RENTANG} hari). Sumber data sama dengan Rekap Pengeluaran.` }),
    ]),
    el('div', { class: 'panel' }, [isi]),
  ]);
  return { node, muat };
}

function grafikDuaBulan(h) {
  const bar = [
    { label: h.a.label, c: h.cabang.sub.a, p: h.pusat.sub.a },
    { label: h.b.label, c: h.cabang.sub.b, p: h.pusat.sub.b },
    ...(h.adaProyeksi ? [{ label: `${labelBulan(h.b.bulan)} (proyeksi)`, c: h.cabang.sub.proyeksi ?? 0, p: h.pusat.sub.proyeksi ?? 0, redup: true }] : []),
  ];
  const maks = Math.max(1, ...bar.map((x) => x.c + x.p));
  return el('div', { class: 'mb-4' }, [
    el('h3', { class: 'h6 fw-bold mb-2', text: 'Total pengeluaran per bulan' }),
    el('div', { class: 'd-flex gap-3 small mb-2' }, [
      el('span', {}, [el('span', { class: 'bar-legenda bar-cabang' }), ' Cabang (Who)']),
      el('span', {}, [el('span', { class: 'bar-legenda bar-pusat' }), ' Gudang Pusat (Whp)']),
    ]),
    ...bar.map((x) => el('div', { class: `bar-baris${x.redup ? ' opacity-50' : ''}` }, [
      el('div', { class: 'bar-nama', text: x.label }),
      el('div', { class: 'bar-jalur d-flex' }, [
        el('div', { class: 'bar-isi bar-cabang', style: `width:${(x.c / maks) * 100}%`, title: `Cabang ${rp(x.c)}` }),
        el('div', { class: 'bar-isi bar-pusat', style: `width:${(x.p / maks) * 100}%`, title: `Gudang pusat ${rp(x.p)}` }),
      ]),
      el('div', { class: 'bar-nilai', text: rp(x.c + x.p) }),
    ])),
  ]);
}

function tabelDuaBulan(h, k) {
  const sel = (n, tebal, kelas = '') => el('td', { class: `text-end text-nowrap ${tebal ? 'fw-bold' : ''} ${kelas}`, text: n ? rp(n) : '-' });
  const baris = (w, tebal) => el('tr', { class: tebal ? 'table-light fw-bold' : '' }, [
    el('td', { class: tebal ? '' : 'fw-semibold', text: w.nama }),
    sel(w.a, tebal),
    sel(w.b, tebal),
    el('td', { class: `text-end text-nowrap ${tebal ? 'fw-bold' : ''} ${kelasDelta(w.delta)}`, text: teksDelta(w.delta) }),
    el('td', { class: `text-end text-nowrap ${kelasDelta(w.delta)}`, text: teksDeltaPersen(w.deltaPersen) }),
    ...(h.adaProyeksi ? [sel(w.proyeksi, tebal, 'text-muted')] : []),
  ]);
  return el('div', { class: 'mb-4' }, [
    el('h3', { class: 'h6 fw-bold mb-2', text: `${LABEL[k.jenis]} — ${k.baris.length} warehouse` }),
    el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-hover align-middle' }, [
      el('thead', { class: 'table-light' }, [el('tr', {}, [
        'Warehouse', h.a.label, h.b.label, 'Selisih', '%', ...(h.adaProyeksi ? [`Proyeksi akhir ${labelBulan(h.b.bulan)}`] : []),
      ].map((t, i) => el('th', { class: i ? 'text-end text-nowrap' : '', text: t })))]),
      el('tbody', {}, [...k.baris.map((w) => baris(w, false)), baris(k.sub, true)]),
    ])]),
  ]);
}

function panelBulanan(ambilMaster) {
  const hariIni = tanggalWib();
  const bulanIni = hariIni.slice(0, 7);
  const [bulanLalu] = daftarBulan(hariIni, 2);
  const bulanA = el('input', { type: 'month', class: 'form-control', value: bulanLalu, max: bulanIni });
  const bulanB = el('input', { type: 'month', class: 'form-control', value: bulanIni, max: bulanIni });
  const pesan = el('div', { class: 'text-danger small mt-1', role: 'alert' });
  const tombol = el('button', { class: 'btn btn-primary flex-fill', type: 'button', text: 'Tampilkan' });
  const unduh = el('button', { class: 'btn btn-outline-primary', type: 'button', text: 'Unduh Excel' });
  const isi = el('div', {});
  let hasil = null;

  async function muat() {
    const sekarang = tanggalWib();
    const salah = cekPilihanBulan(bulanA.value, bulanB.value, sekarang);
    pesan.textContent = salah;
    if (salah) return;
    tombol.disabled = true;
    isi.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat perbandingan…' }));
    try {
      const a = rentangBulan(bulanA.value, sekarang);
      const b = rentangBulan(bulanB.value, sekarang);
      const master = await ambilMaster();
      const q = new URLSearchParams({ dari: a.dari < b.dari ? a.dari : b.dari, sampai: a.sampai > b.sampai ? a.sampai : b.sampai });
      const { lines = [] } = await get(`/api/laporan/rekap-pengeluaran?${q}`);
      const h = bandingDuaBulan(lines, master.cabangList || [], bulanA.value, bulanB.value, sekarang);
      hasil = h.total.a || h.total.b ? h : null;
      if (!hasil) {
        isi.replaceChildren(el('div', { class: 'text-center text-muted py-4', text: 'Tidak ada pengeluaran pada kedua bulan ini.' }));
        return;
      }
      const nA = labelBulan(h.a.bulan);
      const nB = labelBulan(h.b.bulan);
      isi.replaceChildren(...[
        el('div', { class: 'row g-3 mb-4' }, [
          kartu('border bg-white', `Total ${h.a.label}`, rp(h.total.a), `Cabang ${rp(h.cabang.sub.a)} · Pusat ${rp(h.pusat.sub.a)}`),
          kartu('bg-success text-white', `Total ${h.b.label}`, rp(h.total.b), `Cabang ${rp(h.cabang.sub.b)} · Pusat ${rp(h.pusat.sub.b)}`),
          kartu('border bg-white', `Selisih ${nB} − ${nA}`, teksDelta(h.total.delta), h.total.a > 0 ? `${teksDeltaPersen(h.total.deltaPersen)} dari ${nA}` : 'belum ada pembanding'),
          h.adaProyeksi
            ? kartu('kartu-biru', `Proyeksi akhir ${nB}`, rp(h.total.proyeksi ?? 0), `perkiraan; ${teksDelta((h.total.proyeksi ?? 0) - h.total.a)} dari ${nA}`)
            : kartu('border bg-white', 'Warehouse', fmtNum(h.cabang.baris.length + h.pusat.baris.length), `${h.cabang.baris.length} cabang · ${h.pusat.baris.length} gudang pusat`),
        ]),
        grafikDuaBulan(h),
        tabelDuaBulan(h, h.cabang),
        tabelDuaBulan(h, h.pusat),
        el('div', { class: 'small text-muted mt-2' }, [
          `Selisih = total ${nB} − total ${nA}. `,
          h.b.berjalan ? `${nB} masih berjalan (s.d. tanggal ${Number(h.b.sampai.slice(8, 10))}), jadi totalnya belum lengkap; proyeksi = pengeluaran berjalan ÷ jumlah hari berjalan × jumlah hari sebulan (perkiraan). ` : '',
          'Hijau = naik (+), merah = turun (−).',
        ]),
        h.diabaikan ? el('div', { class: 'small text-muted mt-1', text: `${fmtNum(h.diabaikan)} pembayaran dari warehouse yang sudah tidak aktif tidak dihitung.` }) : null,
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
      await unduhExcel(susunExcelBulan(hasil), `perbandingan-${hasil.a.bulan}_vs_${hasil.b.bulan}.xlsx`);
    } catch (err) {
      toast(err.message || 'Gagal membuat file Excel.', 'error');
    } finally {
      unduh.disabled = false;
    }
  });

  const node = el('div', {}, [
    el('div', { class: 'panel' }, [
      el('h2', { 'data-judul-halaman': '', class: 'h5 mb-3 pb-2 border-bottom', text: 'Perbandingan Pengeluaran Bulan vs Bulan per Warehouse' }),
      el('div', { class: 'row g-2 align-items-end' }, [
        kolom('col-md-3', 'Bulan pembanding', bulanA),
        kolom('col-md-3', 'Bulan', bulanB),
        el('div', { class: 'col-md-4 d-flex gap-2' }, [tombol, unduh]),
      ]),
      pesan,
      el('div', { class: 'form-text mt-2', text: 'Membandingkan total pengeluaran sebulan (tanggal 1 sampai akhir bulan; bulan berjalan s.d. hari ini). Sumber data sama dengan Rekap Pengeluaran.' }),
    ]),
    el('div', { class: 'panel' }, [isi]),
  ]);
  return { node, muat };
}

export async function renderPerbandingan(view) {
  if (!lihatSemuaCabang(getUser()?.role)) {
    view.replaceChildren(el('div', { class: 'alert alert-warning', text: 'Perbandingan antar warehouse hanya untuk SUPERADMIN dan MANAGEMENT.' }));
    return { ok: false };
  }
  let masterP = null;
  const ambilMaster = () => {
    masterP ??= get('/api/master').catch((err) => { masterP = null; throw err; });
    return masterP;
  };
  const tab = {
    bulanan: { label: 'Bulan vs Bulan', panel: panelBulanan(ambilMaster), dimuat: false },
    rentang: { label: 'Rentang Tanggal Sama', panel: panelRentang(ambilMaster), dimuat: false },
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
