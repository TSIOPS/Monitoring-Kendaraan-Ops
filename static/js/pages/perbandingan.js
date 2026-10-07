import { get } from '../api.js';
import { getUser } from '../store.js';
import { el, fmtNum, toast } from '../ui.js';
import { tanggalWib } from './input.js';
import { awalBulan } from './rekap.js';

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

// ── Tampilan ────────────────────────────────────────────────────────────────

const rp = (n) => `Rp ${fmtNum(Math.round(n))}`;
const pct = (n) => `${n.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
const LABEL = { CABANG: 'Cabang (Who)', PUSAT: 'Gudang Pusat (Whp)' };

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

export async function renderPerbandingan(view) {
  if (getUser()?.role !== 'SUPERADMIN') {
    view.replaceChildren(el('div', { class: 'alert alert-warning', text: 'Perbandingan antar warehouse hanya untuk SUPERADMIN.' }));
    return { ok: false };
  }
  const hariIni = tanggalWib();
  const dari = el('input', { type: 'date', class: 'form-control', value: awalBulan(hariIni) });
  const sampai = el('input', { type: 'date', class: 'form-control', value: hariIni });
  const tombol = el('button', { class: 'btn btn-primary w-100', type: 'button', text: 'Tampilkan' });
  const isi = el('div', {});
  let master = null;

  async function muat() {
    if (dari.value > sampai.value) { toast('Tanggal "dari" tidak boleh setelah tanggal "sampai".', 'error'); return; }
    tombol.disabled = true;
    isi.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat perbandingan…' }));
    try {
      master ??= await get('/api/master');
      const q = new URLSearchParams({ dari: dari.value, sampai: sampai.value });
      const { lines = [] } = await get(`/api/laporan/rekap-pengeluaran?${q}`);
      const h = bandingkan(lines, master.cabangList || [], master.vehicles || []);
      if (!h.total.total) {
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
      isi.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    } finally {
      tombol.disabled = false;
    }
  }
  tombol.addEventListener('click', muat);

  const kolom = (lebar, label, kontrol) => el('div', { class: lebar }, [el('label', { class: 'form-label small fw-bold text-muted text-uppercase', text: label }), kontrol]);
  view.replaceChildren(
    el('div', { class: 'panel' }, [
      el('h2', { class: 'h5 mb-3 pb-2 border-bottom', text: 'Perbandingan Pengeluaran: Cabang & Gudang Pusat' }),
      el('div', { class: 'row g-2 align-items-end' }, [kolom('col-md-4', 'Dari tanggal', dari), kolom('col-md-4', 'Sampai tanggal', sampai), el('div', { class: 'col-md-4' }, [tombol])]),
      el('div', { class: 'form-text mt-2', text: 'Pengeluaran = BBM + tol, via etoll dan tunai (termasuk kartu ke-2 dan tol manual Flazz), sama dengan Rekap Pengeluaran.' }),
    ]),
    el('div', { class: 'panel' }, [isi]),
  );
  await muat();
  return { ok: true };
}
