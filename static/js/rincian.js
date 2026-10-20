import { el, fmtNum, bantuRupiah } from './ui.js';

// Rincian pengeluaran per nota (spec 2026-10-21). Validasi sama dengan server (src/logic/rincian.ts).
export const MAKS_BARIS = 30;
export const MAKS_KETERANGAN = 100;
export const MAKS_NOMINAL = 100000000;
export const MAKS_KARTU = 64;
const kanonis = (id) => String(id ?? '').trim().replace(/-/g, '');

// Baris yang nominal & keterangannya kosong dianggap belum diisi dan dibuang.
export function bersihkanRincian(rows) {
  return (rows || [])
    .filter((r) => String(r.nominal ?? '').trim() !== '' || String(r.keterangan ?? '').trim() !== '')
    .map((r) => ({ jenis: String(r.jenis || 'BBM').toUpperCase(), nominal: Math.round(Number(r.nominal) || 0), kartu: String(r.kartu || '').trim(), keterangan: String(r.keterangan || '').trim() }));
}

export function ringkasRincian(items) {
  const perKartu = {};
  let bbm = 0;
  let tol = 0;
  for (const it of items || []) {
    const n = Number(it.nominal) || 0;
    if (it.jenis === 'BBM') bbm += n; else tol += n;
    if (it.kartu) perKartu[it.kartu] = (perKartu[it.kartu] || 0) + n;
  }
  return { bbm, tol, perKartu, jumlah: (items || []).length };
}

export function validasiRincian(items, labelKartu = (id) => id) {
  const list = items || [];
  if (list.length > MAKS_BARIS) return [`Rincian pengeluaran maksimal ${MAKS_BARIS} baris.`];
  const err = [];
  list.forEach((it, i) => {
    if (it.jenis !== 'BBM' && it.jenis !== 'TOL') err.push(`Baris ${i + 1}: jenis harus BBM atau Tol.`);
    const nominal = Number(it.nominal);
    if (!Number.isFinite(nominal) || !(nominal > 0)) err.push(`Baris ${i + 1}: nominal harus lebih dari 0.`);
    else if (nominal > MAKS_NOMINAL) err.push(`Baris ${i + 1}: nominal maksimal Rp 100.000.000.`);
    if (String(it.kartu || '').length > MAKS_KARTU) err.push(`Baris ${i + 1}: kartu tidak valid.`);
    if (String(it.keterangan || '').length > MAKS_KETERANGAN) err.push(`Baris ${i + 1}: keterangan maksimal ${MAKS_KETERANGAN} karakter.`);
  });
  if (err.length) return err;
  for (const [jenis, label] of [['BBM', 'BBM'], ['TOL', 'Tol']]) {
    const sumber = new Map();
    for (const it of list) if (it.jenis === jenis) sumber.set(it.kartu ? kanonis(it.kartu) : 'TUNAI', it.kartu);
    if (sumber.size > 2) {
      const nama = [...sumber.values()].map((k) => (k ? labelKartu(k) : 'Tunai')).join(', ');
      err.push(`${label} dibayar dengan ${sumber.size} cara (${nama}). Maksimal 2 cara per jenis — gabungkan atau pindahkan salah satu.`);
    }
  }
  return err;
}

// Komponen tabel rincian. opsiKartu: [{ value, label }]; awal: item rincian.
// kartuDefault: nilai "Dibayar" untuk baris baru ('' = Tunai). labelTidakAda: akhiran label kartu
// tersimpan yang tidak ada di opsiKartu. onUbah() dipanggil setiap isi berubah (liter & ringkasan).
export function tabelRincian({ opsiKartu = [], awal = [], kartuDefault = '', labelTidakAda = '(tidak ada di jalur)', onUbah = () => {} } = {}) {
  let kartu = opsiKartu;
  let bawaan = String(kartuDefault || '');
  const badan = el('div', { class: 'rincian-baris-wrap' });
  const ringkas = el('div', { class: 'form-text mb-2', 'aria-live': 'polite' });
  const tambah = el('button', { type: 'button', class: 'btn btn-outline-primary btn-sm mb-2', text: '+ Tambah baris' });

  const isiBayar = (sel, nilai) => {
    sel.replaceChildren(el('option', { value: '', text: 'Tunai' }), ...kartu.map((k) => el('option', { value: String(k.value), text: String(k.label) })));
    if (nilai && !kartu.some((k) => String(k.value) === String(nilai))) sel.appendChild(el('option', { value: String(nilai), text: `${nilai} ${labelTidakAda}` }));
    sel.value = String(nilai || '');
  };

  function baris(it = { jenis: 'BBM', nominal: '', kartu: bawaan, keterangan: '' }) {
    const jenis = el('select', { class: 'form-select', 'aria-label': 'Jenis' }, [el('option', { value: 'BBM', text: 'BBM' }), el('option', { value: 'TOL', text: 'Tol' })]);
    jenis.value = it.jenis === 'TOL' ? 'TOL' : 'BBM';
    const nominal = el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', min: '1', placeholder: 'Nominal', 'aria-label': 'Nominal (Rp)', value: String(it.nominal ?? '') });
    const bayar = el('select', { class: 'form-select', 'aria-label': 'Dibayar' });
    isiBayar(bayar, it.kartu);
    const ket = el('input', { class: 'form-control', maxlength: String(MAKS_KETERANGAN), placeholder: 'SPBU / gerbang tol (opsional)', 'aria-label': 'Keterangan', value: String(it.keterangan ?? '') });
    const hapus = el('button', { type: 'button', class: 'btn btn-outline-danger', title: 'Hapus baris', 'aria-label': 'Hapus baris' }, [el('i', { class: 'bi bi-trash', 'aria-hidden': 'true' })]);
    const r = el('div', { class: 'rincian-baris row g-2 mb-2 align-items-start' }, [
      el('div', { class: 'col-4 col-md-2' }, [jenis]),
      el('div', { class: 'col-8 col-md-3' }, [nominal, bantuRupiah(nominal)]),
      el('div', { class: 'col-6 col-md-3' }, [bayar]),
      el('div', { class: 'col-6 col-md-3' }, [ket]),
      el('div', { class: 'col-12 col-md-1 text-end' }, [hapus]),
    ]);
    r._ambil = () => ({ jenis: jenis.value, nominal: nominal.value, kartu: bayar.value, keterangan: ket.value });
    r._bayar = bayar;
    r._kosong = () => nominal.value.trim() === '' && ket.value.trim() === '';
    hapus.addEventListener('click', () => { r.remove(); perbarui(); badan.dispatchEvent(new Event('change', { bubbles: true })); });
    return r;
  }

  const semuaBaris = () => [...badan.querySelectorAll('.rincian-baris')];
  const ambil = () => bersihkanRincian(semuaBaris().map((r) => r._ambil()));
  function perbarui() {
    const s = ringkasRincian(ambil());
    const labelKartu = (id) => kartu.find((k) => String(k.value) === id)?.label || id;
    ringkas.replaceChildren(
      `Total BBM Rp ${fmtNum(s.bbm)} · Total tol Rp ${fmtNum(s.tol)}`,
      ...Object.entries(s.perKartu).map(([id, n]) => el('div', { text: `${labelKartu(id)}: terpakai Rp ${fmtNum(n)}` })),
    );
    tambah.disabled = semuaBaris().length >= MAKS_BARIS;
    onUbah();
  }
  tambah.addEventListener('click', () => { badan.appendChild(baris()); perbarui(); semuaBaris().at(-1)?.querySelector('input')?.focus(); });
  badan.addEventListener('input', perbarui);
  badan.addEventListener('change', perbarui);

  for (const it of awal) badan.appendChild(baris(it));
  if (!awal.length) badan.appendChild(baris());
  perbarui();

  return {
    elemen: el('div', {}, [badan, tambah, ringkas]),
    ambil,
    isi(items) { badan.replaceChildren(...(items.length ? items : [undefined]).map((x) => baris(x))); perbarui(); },
    // kartuDefault (opsional) mengganti default baris baru dan ikut diterapkan ke baris yang masih kosong.
    setKartu(list, kartuDefault) {
      kartu = list;
      if (kartuDefault !== undefined) bawaan = String(kartuDefault || '');
      for (const r of semuaBaris()) isiBayar(r._bayar, kartuDefault !== undefined && r._kosong() ? bawaan : r._bayar.value);
      perbarui();
    },
  };
}
