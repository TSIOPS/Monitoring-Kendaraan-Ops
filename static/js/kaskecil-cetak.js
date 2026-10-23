// Dokumen cetak kas kecil (mengikuti format Excel): tampil sebagai lembar penuh, dicetak lewat window.print().
import { el, fmtNum } from './ui.js';
import { PECAHAN_OPNAME, gabungNama, jumlahPecahan, labelPecahan, terbilang, tglId, tglPanjang } from './kaskecil-helpers.js';

const PERUSAHAAN = 'PT. TRIDAYA SINERGI INDONESIA';
const rp = (n) => `Rp ${fmtNum(n)}`;

function bukaCetak(judul, isi) {
  document.body.classList.add('mode-cetak');
  const tutup = () => { overlay.remove(); document.body.classList.remove('mode-cetak'); };
  const overlay = el('div', { class: 'cetak-overlay', role: 'dialog', 'aria-label': judul }, [
    el('div', { class: 'cetak-bar no-print' }, [
      el('button', { class: 'btn btn-primary btn-sm', type: 'button', text: 'Cetak', onclick: () => window.print() }),
      el('button', { class: 'btn btn-outline-secondary btn-sm', type: 'button', text: 'Tutup', onclick: tutup }),
    ]),
    el('div', { class: 'cetak-kertas' }, isi),
  ]);
  document.body.appendChild(overlay);
  overlay.querySelector('button')?.focus();
}

const kepala = (judul, kode) => el('div', { class: 'cetak-kepala' }, [
  el('div', { class: 'fw-bold', text: PERUSAHAAN }),
  el('div', { text: kode }),
  el('h2', { class: 'cetak-judul', text: judul }),
]);

const barisInfo = (label, nilai) => el('tr', {}, [el('td', { class: 'cetak-label', text: label }), el('td', { text: ':' }), el('td', { class: 'fw-semibold', text: nilai || '-' })]);
const tabelInfo = (baris) => el('table', { class: 'cetak-info' }, [el('tbody', {}, baris.map(([l, v]) => barisInfo(l, v)))]);

const tandaTangan = (kiri, kanan) => el('div', { class: 'cetak-ttd' }, [
  el('div', {}, [el('div', { text: kiri[0] }), el('div', { class: 'cetak-garis', text: kiri[1] })]),
  el('div', {}, [el('div', { text: kanan[0] }), el('div', { class: 'cetak-garis', text: kanan[1] })]),
]);

const tabel = (kolom, baris, { kanan = [], kecil = false } = {}) => el('table', { class: `cetak-tabel${kecil ? ' cetak-kecil' : ''}` }, [
  el('thead', {}, [el('tr', {}, kolom.map((k, i) => el('th', { class: kanan.includes(i) ? 'text-end' : '', text: k })))]),
  el('tbody', {}, baris.map((b) => el('tr', {}, b.map((v, i) => el('td', { class: kanan.includes(i) ? 'text-end' : '', text: String(v ?? '') }))))),
]);

export function cetakBuktiKeluar({ keluar: k, cabang }) {
  const kota = cabang?.nama || k.kode_cabang;
  const pecahan = Object.entries(k.pecahan || {});
  bukaCetak('Bukti Kas Keluar', [
    kepala('BUKTI KAS KELUAR', k.id),
    tabelInfo([
      ['No. Kas Keluar', k.id], ['No. Referensi', k.no_referensi], ['Tanggal', `${tglId(k.tanggal)} ${k.jam}`], ['Nama', gabungNama(k)],
      ['Untuk Keperluan', k.jenis], ['Jumlah', rp(k.jumlah)], ['Keterangan', k.keterangan],
    ]),
    el('div', { class: 'cetak-terbilang', text: terbilang(k.jumlah) }),
    pecahan.length ? el('div', { class: 'cetak-kecil mb-2', text: 'Pecahan: ' + pecahan.map(([p, n]) => `${p.replace('K', '')}${p.startsWith('K') ? ' (koin)' : ''} × ${n}`).join(', ') }) : null,
    el('div', { class: 'cetak-kota', text: `${kota}, ${tglPanjang(k.tanggal)}` }),
    tandaTangan(['Dikeluarkan oleh,', k.admin], ['Diterima oleh,', gabungNama(k)]),
  ]);
}

export function cetakPenyelesaian({ keluar: k, masuk: m, cabang }) {
  const kota = cabang?.nama || k.kode_cabang;
  const kembali = m ? m.jumlah : 0;
  bukaCetak('Penyelesaian Kas Kecil', [
    kepala('PENYELESAIAN KAS KECIL', m ? m.id : k.id),
    tabelInfo([['No. Referensi', k.no_referensi], ['Nama', gabungNama(k)], ['Jenis Transaksi', k.jenis]]),
    tabel(['No. Kas Keluar', 'Tgl KK', 'Nominal KK', 'Nominal KM', 'Tgl KM', 'No. Kas Masuk'], [[k.id, tglId(k.tanggal), fmtNum(k.jumlah), fmtNum(kembali), m ? tglId(m.tanggal) : '-', m ? m.id : '-']], { kanan: [2, 3], kecil: true }),
    tabelInfo([['Jumlah Anggaran', rp(k.jumlah)], ['Sisa Anggaran', rp(kembali)], ['Penggunaan Anggaran', rp(k.jumlah - kembali)]]),
    el('div', { class: 'cetak-terbilang', text: terbilang(k.jumlah) }),
    el('div', { class: 'cetak-kecil mb-2', text: 'Penerimaan dokumen terlampir bukti penggunaan uang.' }),
    el('div', { class: 'cetak-kota', text: `${kota}, ${tglPanjang(m ? m.tanggal : k.tanggal)}` }),
    tandaTangan(['Admin,', k.admin], ['Penerima,', gabungNama(k)]),
  ]);
}

export function cetakLaporanHarian({ laporan: l, rincian: rin, cabang }) {
  const r = l.ringkasan;
  bukaCetak('Laporan Harian Kas Kecil', [
    kepala('LAPORAN HARIAN KAS KECIL', `${cabang?.nama || ''} — ${tglPanjang(l.tanggal)}`),
    tabelInfo([['Saldo Awal', rp(r.saldoAwal)], ['Kas Keluar', rp(r.keluar)], ['Kas Masuk', rp(r.masuk)], ['Belum Selesai', rp(r.belumSelesai)], ['Saldo Akhir', rp(r.saldoAkhir)]]),
    tabel(['No', 'Jam', 'No. Kas Keluar', 'No. Referensi', 'No. Kas Masuk', 'Nama', 'Jenis Transaksi', 'Debit', 'Kredit', 'Saldo', 'Status'],
      l.baris.map((b, i) => [i + 1, b.jam.slice(0, 5), b.nomorKK, b.referensi, b.nomorKM, b.nama, b.namaJenis, b.debit ? fmtNum(b.debit) : '', b.kredit ? fmtNum(b.kredit) : '', fmtNum(b.saldo), b.status]),
      { kanan: [7, 8, 9], kecil: true }),
    rin ? tabel(['Pecahan', 'Saldo Awal', 'Masuk', 'Keluar', 'Saldo Akhir', 'Nilai (Rp)'],
      [...rin.baris.map((b) => [labelPecahan(b.kunci), b.awal, b.masuk, b.keluar, b.akhir, fmtNum(b.nilaiAkhir)]), ['TOTAL', '', '', '', '', fmtNum(rin.nilaiAkhir)]],
      { kanan: [1, 2, 3, 4, 5], kecil: true }) : null,
  ]);
}

export function cetakOpname({ opname: o, cabang }) {
  const kota = cabang?.nama || o.kode_cabang;
  const baris = PECAHAN_OPNAME.filter(([k]) => (o.pecahan || {})[k]).map(([k, label]) => [label, fmtNum(o.pecahan[k]), fmtNum(jumlahPecahan({ [k]: o.pecahan[k] }))]);
  bukaCetak('BA Cash Opname', [
    kepala('BERITA ACARA CASH OPNAME', o.id),
    el('p', { text: `Pada hari ini, ${tglPanjang(o.tanggal)}, telah dilakukan pemeriksaan kas kecil ${kota} oleh ${o.pemeriksa} dengan hasil sebagai berikut:` }),
    tabel(['Pecahan', 'Jumlah (lembar/keping)', 'Total Fisik (Rp)'], baris, { kanan: [1, 2] }),
    tabelInfo([['Nilai Fisik', rp(o.nilai_fisik)], ['Nilai Buku', rp(o.nilai_buku)], ['Selisih', rp(o.selisih)], ['Hasil', o.selisih === 0 ? 'Sesuai' : 'Tidak sesuai'], ['Catatan', o.catatan]]),
    el('div', { class: 'cetak-kota', text: `${kota}, ${tglPanjang(o.tanggal)}` }),
    tandaTangan(['Pemeriksa,', o.pemeriksa], ['Mengetahui,', '']),
  ]);
}
