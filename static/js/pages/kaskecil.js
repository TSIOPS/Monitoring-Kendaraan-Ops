// Kas kecil: kas keluar & penyelesaian, laporan harian, summary, pembanding, BA cash opname.
import { del, get, post, put } from '../api.js';
import { getUser } from '../store.js';
import { bolehTulis, isSuper, lihatSemuaCabang } from '../peran.js';
import { aksiSekali, bantuRupiah, barisForm, confirmDialog, el, fmtDateId, fmtNum, grupAksi, halaman, navHalaman, tampilkanGalat, toast, tombolIkon, tombolIkonSekali } from '../ui.js';
import { tanggalWib } from './input.js';
import { bukuExcel, muatSheetJS } from './rekap.js';
import {
  PECAHAN, PECAHAN_OPNAME, bersihkanPecahan, gabungNama, jumlahPecahan, namaFileKas, sheetDaftarKeluar, sheetDaftarMasuk, sheetLaporanHarian, sheetPembanding, sheetSummary, tglId,
} from '../kaskecil-helpers.js';
import { cetakBuktiKeluar, cetakLaporanHarian, cetakOpname, cetakPenyelesaian } from '../kaskecil-cetak.js';

const rp = (n) => `Rp ${fmtNum(n)}`;
const tulis = () => bolehTulis(getUser()?.role);
const semua = () => lihatSemuaCabang(getUser()?.role);
const PER_HALAMAN = 20;

const MENU = [['#/kaskecil', 'Kas Keluar'], ['#/kaskecil/masuk', 'Kas Masuk'], ['#/kaskecil/laporan', 'Laporan Harian'], ['#/kaskecil/summary', 'Summary'], ['#/kaskecil/pembanding', 'Pembanding'], ['#/kaskecil/opname', 'BA Cash Opname']];
function navKas(aktif) {
  return el('div', { class: 'd-flex flex-wrap gap-2 mb-3 no-print' }, MENU.map(([h, t]) =>
    el('a', { class: `btn btn-sm ${h === aktif ? 'btn-primary' : 'btn-outline-primary'}`, href: h, text: t })));
}

// Data dasar: daftar warehouse (nama untuk dokumen cetak) dan jenis transaksi aktif.
async function muatDasar() {
  const [master, j] = await Promise.all([get('/api/master'), get('/api/kaskecil/jenis')]);
  return { cabangList: Array.isArray(master.cabangList) ? master.cabangList : [], drivers: Array.isArray(master.drivers) ? master.drivers : [], jenis: j.jenis || [] };
}

// PIC terkunci ke cabangnya; SUPERADMIN/MANAGEMENT memilih warehouse.
function pilihanCabang(cabangList, { boleh0 = false } = {}) {
  const user = getUser();
  if (!semua()) return { node: null, kode: () => String(user?.cabang || ''), nama: () => cabangList.find((c) => c.kode === user?.cabang)?.nama || user?.cabang || '' };
  const sel = el('select', { class: 'form-select', 'aria-label': 'Warehouse' }, [
    el('option', { value: '', text: boleh0 ? 'Semua warehouse' : '— pilih warehouse —' }),
    ...cabangList.map((c) => el('option', { value: c.kode, text: c.nama || c.kode })),
  ]);
  return { node: sel, kode: () => sel.value, nama: () => cabangList.find((c) => c.kode === sel.value)?.nama || sel.value };
}

const kolom = (lebar, label, kontrol, catatan) => el('div', { class: lebar }, [barisForm(label, kontrol, catatan || '', 'mb-2')]);

function kotakPecahan(daftar, saatUbah) {
  const input = new Map(daftar.map(([k]) => [k, el('input', { type: 'number', min: '0', step: '1', class: 'form-control form-control-sm', 'aria-label': 'Jumlah pecahan' })]));
  const total = el('div', { class: 'fw-bold mt-2', text: 'Total pecahan: Rp 0' });
  const baca = () => bersihkanPecahan(Object.fromEntries([...input].map(([k, i]) => [k, i.value])));
  const segar = () => { const t = jumlahPecahan(baca()); total.textContent = `Total pecahan: ${rp(t)}`; saatUbah?.(t); };
  input.forEach((i) => i.addEventListener('input', segar));
  const node = el('details', { class: 'mb-2' }, [
    el('summary', { class: 'small fw-semibold', text: 'Rincian pecahan uang (opsional)' }),
    el('div', { class: 'row g-2 mt-1' }, daftar.map(([k, label]) => el('div', { class: 'col-6 col-md-3' }, [el('label', { class: 'form-label small mb-0', text: label }), input.get(k)]))),
    total,
  ]);
  return { node, nilai: baca, set: (p) => { input.forEach((i, k) => { i.value = p?.[k] ? String(p[k]) : ''; }); segar(); }, kosongkan: () => { input.forEach((i) => { i.value = ''; }); segar(); } };
}

async function unduhExcel(sheets, namaFile) {
  try {
    const XLSX = await muatSheetJS();
    XLSX.writeFile(bukuExcel(XLSX, sheets), namaFile);
  } catch (err) {
    toast(err.message || 'Gagal membuat file Excel.', 'error');
  }
}

const badgeStatus = (s) => el('span', { class: `badge ${s === 'Closed' ? 'text-bg-success' : 'text-bg-warning'}`, text: s });
const th = (cols, kanan = []) => el('thead', { class: 'thead-hijau' }, [el('tr', {}, cols.map((c, i) => el('th', { class: `text-nowrap${kanan.includes(i) ? ' text-end' : ''}`, text: c })))]);
const kotakInfo = (kelas, label, nilai) => el('div', { class: 'col-6 col-lg' }, [el('div', { class: `rounded-3 p-3 h-100 ${kelas}` }, [el('div', { class: 'small opacity-75', text: label }), el('div', { class: 'h6 fw-bold mb-0', text: nilai })])]);

// ── Kas Keluar & Penyelesaian ───────────────────────────────────────────────
export async function renderKasKeluar(view) {
  let dasar;
  try {
    dasar = await muatDasar();
  } catch (err) {
    view.replaceChildren(navKas('#/kaskecil'), el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }
  const jenisKeluar = dasar.jenis.filter((j) => j.tipe === 'KELUAR');
  const cabang = pilihanCabang(dasar.cabangList, { boleh0: true });
  const dari = el('input', { type: 'date', class: 'form-control', value: `${tanggalWib().slice(0, 8)}01` });
  const sampai = el('input', { type: 'date', class: 'form-control', value: tanggalWib() });
  const statusSel = el('select', { class: 'form-select', 'aria-label': 'Status' }, [el('option', { value: '', text: 'Semua status' }), el('option', { value: 'Open', text: 'Open' }), el('option', { value: 'Closed', text: 'Closed' })]);
  const hasil = el('div', {});
  const formBox = el('div', {});
  const selesaiBox = el('div', {});
  let data = [];
  let nomor = 1;
  let ubah = null; // baris yang sedang diubah

  // — Form kas keluar —
  const alertBox = el('div', { class: 'alert alert-danger d-none' });
  const jenis = el('select', { class: 'form-select' }, [el('option', { value: '', text: '— pilih jenis —' }), ...jenisKeluar.map((j) => el('option', { value: j.id, text: j.nama }))]);
  // Nama driver dari Data Master warehouse terpilih (saran saja; boleh mengetik nama lain, mis. non-driver).
  const daftarDriver = el('datalist', { id: 'kas-daftar-driver' });
  const penerima = el('input', { class: 'form-control', maxlength: '80', autocomplete: 'off', list: 'kas-daftar-driver', placeholder: 'Pilih driver atau ketik nama' });
  const isiDriver = () => {
    const kode = cabang.kode();
    const nama = [...new Set(dasar.drivers.filter((d) => !kode || d.cabang === kode).map((d) => String(d.nama || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    daftarDriver.replaceChildren(...nama.map((n) => el('option', { value: n })));
  };
  const penerima2 = el('input', { class: 'form-control', maxlength: '80', autocomplete: 'off', list: 'kas-daftar-driver', placeholder: 'Opsional: pendamping / driver kedua' });
  isiDriver();
  const tanggal = el('input', { type: 'date', class: 'form-control', value: tanggalWib(), max: tanggalWib() });
  const jumlah = el('input', { type: 'number', min: '1', step: '1', class: 'form-control' });
  const ket = el('input', { class: 'form-control', maxlength: '300' });
  const pecahan = kotakPecahan(PECAHAN, (t) => { jumlah.readOnly = t > 0; if (t > 0) { jumlah.value = String(t); jumlah.dispatchEvent(new Event('input')); } });
  const simpan = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Simpan Kas Keluar' });
  const batalUbah = el('button', { class: 'btn btn-outline-secondary d-none', type: 'button', text: 'Batal ubah' });
  const form = el('form', { novalidate: 'novalidate' }, [
    alertBox,
    el('div', { class: 'row g-2' }, [
      kolom('col-md-4', 'Jenis transaksi', jenis),
      kolom('col-md-4', 'Nama penerima 1 (driver)', el('div', {}, [penerima, daftarDriver])),
      kolom('col-md-4', 'Nama penerima 2 (opsional)', penerima2),
      kolom('col-md-4', 'Tanggal', tanggal),
      kolom('col-md-4', 'Jumlah uang keluar', el('div', {}, [jumlah, bantuRupiah(jumlah)])),
      kolom('col-md-8', 'Keterangan / untuk penggunaan', ket),
    ]),
    pecahan.node,
    el('div', { class: 'd-flex gap-2' }, [simpan, batalUbah]),
  ]);
  function resetForm() {
    ubah = null;
    form.reset();
    pecahan.kosongkan();
    jumlah.readOnly = false;
    jenis.disabled = false;
    tanggal.disabled = false;
    tanggal.value = tanggalWib();
    simpan.textContent = 'Simpan Kas Keluar';
    batalUbah.classList.add('d-none');
  }
  batalUbah.addEventListener('click', resetForm);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('d-none');
    const err = [];
    if (!ubah && !jenis.value) err.push('Pilih jenis transaksi.');
    if (!penerima.value.trim()) err.push('Nama penerima wajib diisi.');
    if (!(Number(jumlah.value) > 0)) err.push('Jumlah uang harus lebih dari 0.');
    if (!ubah && semua() && !cabang.kode()) err.push('Pilih warehouse pada filter di bawah.');
    if (err.length) { tampilkanGalat(alertBox, err.join(' ')); return; }
    simpan.disabled = true;
    try {
      const p = pecahan.nilai();
      const badan = { penerima: penerima.value.trim(), penerima_2: penerima2.value.trim(), jumlah: Number(jumlah.value), keterangan: ket.value.trim(), ...(Object.keys(p).length ? { pecahan: p } : {}) };
      if (ubah) {
        await put(`/api/kaskecil/keluar/${encodeURIComponent(ubah.id)}`, badan);
        toast('Kas keluar diperbarui.', 'success');
      } else {
        const res = await post('/api/kaskecil/keluar', { ...badan, jenis_id: jenis.value, tanggal: tanggal.value, cabang: cabang.kode() });
        toast(`Kas keluar ${res.keluar.id} tersimpan.`, 'success');
      }
      resetForm();
      await muat();
    } catch (e) {
      tampilkanGalat(alertBox, e.message);
    } finally {
      simpan.disabled = false;
    }
  });
  function mulaiUbah(r) {
    ubah = r;
    jenis.value = r.jenis_id;
    jenis.disabled = true;
    tanggal.value = r.tanggal;
    tanggal.disabled = true;
    penerima.value = r.penerima;
    penerima2.value = r.penerima_2 || '';
    ket.value = r.keterangan;
    jumlah.readOnly = false;
    jumlah.value = String(r.jumlah);
    pecahan.set(r.pecahan);
    simpan.textContent = 'Simpan Perubahan';
    batalUbah.classList.remove('d-none');
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
    penerima.focus();
  }

  // — Penyelesaian —
  function bukaSelesai(r) {
    const kembali = el('input', { type: 'number', min: '0', step: '1', class: 'form-control', value: '0' });
    const tgl = el('input', { type: 'date', class: 'form-control', value: tanggalWib(), min: r.tanggal, max: tanggalWib() });
    const k = el('input', { class: 'form-control', maxlength: '300' });
    const info = el('div', { class: 'fw-semibold mb-2' });
    const galat = el('div', { class: 'alert alert-danger d-none' });
    const pk = kotakPecahan(PECAHAN, (t) => { kembali.readOnly = t > 0; if (t > 0) { kembali.value = String(t); kembali.dispatchEvent(new Event('input')); } });
    const segar = () => { info.textContent = `Nominal kas keluar ${rp(r.jumlah)} — penggunaan ${rp(r.jumlah - (Number(kembali.value) || 0))}`; };
    kembali.addEventListener('input', segar);
    segar();
    const ok = el('button', { class: 'btn btn-success', type: 'submit', text: 'Selesaikan' });
    const batal = el('button', { class: 'btn btn-outline-secondary', type: 'button', text: 'Batal', onclick: () => selesaiBox.replaceChildren() });
    const f = el('form', { novalidate: 'novalidate', class: 'panel border' }, [
      el('h3', { class: 'h6', text: `Penyelesaian ${r.id} — ${gabungNama(r)}` }), galat, info,
      el('div', { class: 'row g-2' }, [kolom('col-md-4', 'Uang kembali (sisa)', el('div', {}, [kembali, bantuRupiah(kembali)])), kolom('col-md-4', 'Tanggal penyelesaian', tgl), kolom('col-md-4', 'Keterangan', k)]),
      pk.node, el('div', { class: 'd-flex gap-2' }, [ok, batal]),
    ]);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      ok.disabled = true;
      try {
        const p = pk.nilai();
        const res = await post(`/api/kaskecil/keluar/${encodeURIComponent(r.id)}/selesai`, { jumlah: Number(kembali.value) || 0, tanggal: tgl.value, keterangan: k.value.trim(), ...(Object.keys(p).length ? { pecahan: p } : {}) });
        toast(`Selesai: ${res.masuk.id}.`, 'success');
        selesaiBox.replaceChildren();
        await muat();
        if (confirmDialog('Cetak lembar penyelesaian sekarang?')) await cetak(res.keluar.id, 'selesai');
      } catch (e) {
        tampilkanGalat(galat, e.message);
        ok.disabled = false;
      }
    });
    selesaiBox.replaceChildren(f);
    f.scrollIntoView({ behavior: 'smooth', block: 'start' });
    kembali.focus();
  }

  async function cetak(id, jenisDok) {
    try {
      const d = await get(`/api/kaskecil/keluar/${encodeURIComponent(id)}`);
      if (jenisDok === 'selesai') cetakPenyelesaian(d); else cetakBuktiKeluar(d);
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  // — Daftar —
  function gambar() {
    const tersaring = data.filter((r) => !statusSel.value || r.status === statusSel.value);
    if (!tersaring.length) { hasil.replaceChildren(el('div', { class: 'text-center text-muted py-4', text: 'Belum ada kas keluar pada periode ini.' })); return; }
    const h = halaman(tersaring, nomor, PER_HALAMAN);
    nomor = h.aktif;
    const total = tersaring.reduce((n, r) => n + r.jumlah, 0);
    hasil.replaceChildren(
      el('div', { class: 'mb-2 fw-bold', text: `${fmtNum(tersaring.length)} transaksi — total kas keluar ${rp(total)}` }),
      el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-hover align-middle' }, [
        th(['Tanggal', 'No. Kas Keluar', 'Referensi', 'Penerima', 'Jenis', 'Jumlah', 'Status', 'Aksi'], [5]),
        el('tbody', {}, h.isi.map((r) => el('tr', {}, [
          el('td', { class: 'text-nowrap', text: `${fmtDateId(r.tanggal)} ${String(r.jam).slice(0, 5)}` }),
          el('td', { class: 'small', text: r.id }), el('td', { class: 'small', text: r.no_referensi || '-' }),
          el('td', { text: gabungNama(r) }), el('td', { text: r.jenis }),
          el('td', { class: 'text-end', text: rp(r.jumlah) }), el('td', {}, [badgeStatus(r.status)]),
          el('td', {}, [grupAksi([
            tombolIkon('cetak', 'Cetak bukti kas keluar', () => cetak(r.id, 'keluar')),
            r.status === 'Closed' && r.no_kas_masuk ? tombolIkon('cetak', 'Cetak penyelesaian', () => cetak(r.id, 'selesai')) : null,
            tulis() && r.status === 'Open' ? tombolIkon('selesai', 'Selesaikan (uang kembali)', () => bukaSelesai(r)) : null,
            tulis() && r.status === 'Open' ? tombolIkon('edit', 'Ubah', () => mulaiUbah(r)) : null,
            tulis() && r.no_kas_masuk ? tombolIkonSekali('batalkan', 'Batalkan penyelesaian', async () => {
              if (!confirmDialog(`Batalkan penyelesaian ${r.id}? Kas keluar kembali berstatus Open.`)) return;
              try { await del(`/api/kaskecil/keluar/${encodeURIComponent(r.id)}/selesai`); toast('Penyelesaian dibatalkan.', 'success'); await muat(); } catch (e) { toast(e.message, 'error'); }
            }) : null,
            tulis() && !r.no_kas_masuk ? tombolIkonSekali('hapus', 'Hapus', async () => {
              if (!confirmDialog(`Hapus kas keluar ${r.id} (${rp(r.jumlah)})?`)) return;
              try { await del(`/api/kaskecil/keluar/${encodeURIComponent(r.id)}`); toast('Kas keluar dihapus.', 'success'); await muat(); } catch (e) { toast(e.message, 'error'); }
            }) : null,
          ])]),
        ]))),
      ])]),
      navHalaman(h.total, h.aktif, (ke) => { nomor = ke; gambar(); }),
    );
  }
  async function muat() {
    if (dari.value > sampai.value) { toast('Tanggal "dari" tidak boleh setelah "sampai".', 'error'); return; }
    hasil.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat…' }));
    try {
      const q = new URLSearchParams({ dari: dari.value, sampai: sampai.value });
      if (semua() && cabang.kode()) q.set('cabang', cabang.kode());
      ({ keluar: data = [] } = await get(`/api/kaskecil/keluar?${q}`));
      nomor = 1;
      gambar();
    } catch (e) {
      hasil.replaceChildren(el('div', { class: 'alert alert-danger', text: e.message }));
    }
  }
  statusSel.addEventListener('change', () => { nomor = 1; gambar(); });
  const tombolTampil = el('button', { class: 'btn btn-primary', type: 'button', text: 'Tampilkan', onclick: muat });
  const tombolExcel = el('button', { class: 'btn btn-outline-primary', type: 'button', text: 'Unduh Excel' });
  tombolExcel.addEventListener('click', aksiSekali(tombolExcel, async () => {
    const q = new URLSearchParams({ dari: dari.value, sampai: sampai.value });
    if (semua() && cabang.kode()) q.set('cabang', cabang.kode());
    try {
      const { masuk = [] } = await get(`/api/kaskecil/masuk?${q}`);
      const tersaring = data.filter((r) => !statusSel.value || r.status === statusSel.value);
      if (!tersaring.length && !masuk.length) { toast('Tidak ada data untuk diunduh.', 'error'); return; }
      const opsi = { warehouse: cabang.kode() ? cabang.nama() : 'Semua Warehouse', dari: dari.value, sampai: sampai.value };
      await unduhExcel([sheetDaftarKeluar(tersaring, masuk, opsi), sheetDaftarMasuk(masuk, opsi)], namaFileKas('daftar', cabang.kode(), `${dari.value}_${sampai.value}`));
    } catch (e) {
      toast(e.message, 'error');
    }
  }));
  if (cabang.node) cabang.node.addEventListener('change', () => { isiDriver(); muat(); });

  formBox.replaceChildren(...(tulis() ? [el('div', { class: 'panel' }, [el('h3', { class: 'h6 mb-3', text: 'Kas Keluar Baru / Ubah' }), form])] : []));
  view.replaceChildren(
    el('div', { class: 'panel' }, [navKas('#/kaskecil'), el('h2', { 'data-judul-halaman': '', class: 'h5 mb-3 pb-2 border-bottom', text: 'Kas Kecil — Kas Keluar' })]),
    formBox, selesaiBox,
    el('div', { class: 'panel' }, [
      el('div', { class: 'row g-2 align-items-end mb-3' }, [
        cabang.node ? kolom('col-md-3', 'Warehouse', cabang.node) : null,
        kolom('col-md-2', 'Dari tanggal', dari), kolom('col-md-2', 'Sampai tanggal', sampai), kolom('col-md-2', 'Status', statusSel),
        el('div', { class: 'col-md-2 mb-2 d-flex gap-2' }, [tombolTampil, tombolExcel]),
      ]),
      hasil,
    ]),
  );
  await muat();
  return { ok: true };
}

// ── Daftar Kas Masuk ────────────────────────────────────────────────────────
export async function renderKasMasuk(view) {
  let dasar;
  try {
    dasar = await muatDasar();
  } catch (err) {
    view.replaceChildren(navKas('#/kaskecil/masuk'), el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }
  const cabang = pilihanCabang(dasar.cabangList, { boleh0: true });
  const dari = el('input', { type: 'date', class: 'form-control', value: `${tanggalWib().slice(0, 8)}01` });
  const sampai = el('input', { type: 'date', class: 'form-control', value: tanggalWib() });
  const hasil = el('div', {});
  const unduh = el('button', { class: 'btn btn-outline-primary', type: 'button', text: 'Unduh Excel', disabled: 'disabled' });
  let data = [];
  let nomor = 1;
  function gambar() {
    if (!data.length) { hasil.replaceChildren(el('div', { class: 'text-center text-muted py-4', text: 'Belum ada kas masuk pada periode ini.' })); return; }
    const h = halaman(data, nomor, PER_HALAMAN);
    nomor = h.aktif;
    hasil.replaceChildren(
      el('div', { class: 'mb-2 fw-bold', text: `${fmtNum(data.length)} transaksi — total kas masuk ${rp(data.reduce((n, r) => n + r.jumlah, 0))}` }),
      el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-hover align-middle' }, [
        th(['Tanggal', 'No. Kas Masuk', 'No. Kas Keluar', 'Referensi', 'Penerima', 'Jenis', 'Jumlah', 'Keterangan'], [6]),
        el('tbody', {}, h.isi.map((r) => el('tr', {}, [
          el('td', { class: 'text-nowrap', text: `${fmtDateId(r.tanggal)} ${String(r.jam).slice(0, 5)}` }), el('td', { class: 'small', text: r.id }),
          el('td', { class: 'small', text: r.no_kas_keluar || '(tambah saldo)' }), el('td', { class: 'small', text: r.no_referensi || '-' }),
          el('td', { text: gabungNama(r) || '-' }), el('td', { text: r.jenis }), el('td', { class: 'text-end', text: rp(r.jumlah) }), el('td', { class: 'small text-muted', text: r.keterangan || '-' }),
        ]))),
      ])]),
      navHalaman(h.total, h.aktif, (ke) => { nomor = ke; gambar(); }),
    );
  }
  async function muat() {
    if (dari.value > sampai.value) { toast('Tanggal "dari" tidak boleh setelah "sampai".', 'error'); return; }
    hasil.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat…' }));
    try {
      const q = new URLSearchParams({ dari: dari.value, sampai: sampai.value });
      if (semua() && cabang.kode()) q.set('cabang', cabang.kode());
      ({ masuk: data = [] } = await get(`/api/kaskecil/masuk?${q}`));
      nomor = 1;
      unduh.disabled = !data.length;
      gambar();
    } catch (e) {
      hasil.replaceChildren(el('div', { class: 'alert alert-danger', text: e.message }));
    }
  }
  unduh.addEventListener('click', () => unduhExcel([sheetDaftarMasuk(data, { warehouse: cabang.kode() ? cabang.nama() : 'Semua Warehouse', dari: dari.value, sampai: sampai.value })], namaFileKas('masuk', cabang.kode(), `${dari.value}_${sampai.value}`)));
  if (cabang.node) cabang.node.addEventListener('change', muat);
  view.replaceChildren(el('div', { class: 'panel' }, [
    navKas('#/kaskecil/masuk'), el('h2', { 'data-judul-halaman': '', class: 'h5 mb-3 pb-2 border-bottom', text: 'Kas Kecil — Daftar Kas Masuk' }),
    el('div', { class: 'row g-2 align-items-end mb-3' }, [cabang.node ? kolom('col-md-3', 'Warehouse', cabang.node) : null, kolom('col-md-3', 'Dari tanggal', dari), kolom('col-md-3', 'Sampai tanggal', sampai),
      el('div', { class: 'col-md-3 mb-2 d-flex gap-2' }, [el('button', { class: 'btn btn-primary', type: 'button', text: 'Tampilkan', onclick: muat }), unduh])]),
    hasil,
  ]));
  await muat();
  return { ok: true };
}

// ── Laporan Harian ──────────────────────────────────────────────────────────
export async function renderKasLaporan(view) {
  let dasar;
  try {
    dasar = await muatDasar();
  } catch (err) {
    view.replaceChildren(navKas('#/kaskecil/laporan'), el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }
  const cabang = pilihanCabang(dasar.cabangList);
  const tgl = el('input', { type: 'date', class: 'form-control', value: tanggalWib(), max: tanggalWib() });
  const isi = el('div', {});
  const cabangInfo = () => ({ nama: cabang.nama(), kode: cabang.kode() });

  async function muat() {
    if (!cabang.kode()) { isi.replaceChildren(el('div', { class: 'text-muted', text: 'Pilih warehouse untuk melihat laporan.' })); return; }
    isi.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat…' }));
    try {
      const res = await get(`/api/kaskecil/laporan-harian?${new URLSearchParams({ cabang: cabang.kode(), tanggal: tgl.value })}`);
      gambar(res);
    } catch (e) {
      isi.replaceChildren(el('div', { class: 'alert alert-danger', text: e.message }));
    }
  }

  function gambar({ laporan: l, awal }) {
    const r = l.ringkasan;
    const aksi = el('div', { class: 'd-flex gap-2 mb-3 flex-wrap no-print' }, [
      el('button', { class: 'btn btn-outline-primary btn-sm', type: 'button', text: 'Cetak', onclick: () => cetakLaporanHarian({ laporan: l, cabang: cabangInfo() }) }),
      el('button', { class: 'btn btn-outline-primary btn-sm', type: 'button', text: 'Unduh Excel', onclick: () => unduhExcel(sheetLaporanHarian(l, { warehouse: cabang.nama() }), namaFileKas('harian', cabang.kode(), l.tanggal)) }),
    ]);
    isi.replaceChildren(...[
      !awal ? el('div', { class: 'alert alert-warning', text: 'Saldo awal kas kecil warehouse ini belum diatur (dianggap Rp 0). SUPERADMIN dapat mengaturnya di bawah.' }) : null,
      el('div', { class: 'row g-2 mb-3' }, [
        kotakInfo('border bg-white', 'Saldo Awal', rp(r.saldoAwal)), kotakInfo('bg-warning-subtle', 'Kas Keluar', rp(r.keluar)),
        kotakInfo('bg-primary text-white', 'Kas Masuk', rp(r.masuk)), kotakInfo('border bg-white', 'Belum Selesai', rp(r.belumSelesai)),
        kotakInfo('bg-success text-white', 'Saldo Akhir', rp(r.saldoAkhir)),
      ]),
      aksi,
      l.baris.length ? el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-hover align-middle' }, [
        th(['Jam', 'No. Kas Keluar', 'Referensi', 'No. Kas Masuk', 'Nama', 'Jenis', 'Debit', 'Kredit', 'Saldo', 'Status', ''], [6, 7, 8]),
        el('tbody', {}, l.baris.map((b) => el('tr', {}, [
          el('td', { text: String(b.jam).slice(0, 5) }), el('td', { class: 'small', text: b.nomorKK || '-' }), el('td', { class: 'small', text: b.referensi || '-' }),
          el('td', { class: 'small', text: b.nomorKM || '-' }), el('td', { text: b.nama || '-' }), el('td', { text: b.namaJenis }),
          el('td', { class: 'text-end', text: b.debit ? fmtNum(b.debit) : '' }), el('td', { class: 'text-end', text: b.kredit ? fmtNum(b.kredit) : '' }),
          el('td', { class: 'text-end fw-semibold', text: fmtNum(b.saldo) }), el('td', {}, b.status ? [badgeStatus(b.status)] : []),
          el('td', {}, tulis() && b.jenis === 'MASUK' && !b.nomorKK ? [tombolIkonSekali('hapus', 'Hapus tambah saldo', async () => {
            if (!confirmDialog(`Hapus tambah saldo ${b.nomor} (${rp(b.debit)})?`)) return;
            try { await del(`/api/kaskecil/masuk/${encodeURIComponent(b.nomor)}`); toast('Tambah saldo dihapus.', 'success'); await muat(); } catch (e) { toast(e.message, 'error'); }
          })] : []),
        ]))),
      ])]) : el('div', { class: 'text-center text-muted py-4', text: 'Tidak ada transaksi pada tanggal ini.' }),
      tulis() ? panelTambahSaldo() : null,
      isSuper(getUser()?.role) ? panelSaldoAwal(awal) : null,
    ].filter(Boolean));
  }

  function panelTambahSaldo() {
    const jml = el('input', { type: 'number', min: '1', step: '1', class: 'form-control' });
    const ket = el('input', { class: 'form-control', maxlength: '300', placeholder: 'mis. dari pusat' });
    const galat = el('div', { class: 'alert alert-danger d-none' });
    const f = el('form', { novalidate: 'novalidate', class: 'panel border mt-3 no-print' }, [
      el('h3', { class: 'h6', text: 'Tambah Saldo Kas Kecil' }), galat,
      el('div', { class: 'row g-2 align-items-end' }, [kolom('col-md-4', 'Jumlah', el('div', {}, [jml, bantuRupiah(jml)])), kolom('col-md-6', 'Keterangan', ket),
        el('div', { class: 'col-md-2 mb-2' }, [el('button', { class: 'btn btn-primary', type: 'submit', text: 'Tambah' })])]),
    ]);
    f.addEventListener('submit', aksiSekali(f.querySelector('button[type=submit]'), async (ev) => {
      ev.preventDefault();
      if (!(Number(jml.value) > 0)) { tampilkanGalat(galat, 'Jumlah harus lebih dari 0.'); return; }
      try {
        await post('/api/kaskecil/masuk', { cabang: cabang.kode(), jumlah: Number(jml.value), keterangan: ket.value.trim(), tanggal: tgl.value });
        toast('Saldo ditambahkan.', 'success');
        await muat();
      } catch (e) {
        tampilkanGalat(galat, e.message);
      }
    }));
    return f;
  }

  function panelSaldoAwal(awal) {
    const t = el('input', { type: 'date', class: 'form-control', value: awal?.tanggal || tanggalWib() });
    const j = el('input', { type: 'number', min: '0', step: '1', class: 'form-control', value: String(awal?.jumlah ?? 0) });
    const f = el('form', { novalidate: 'novalidate', class: 'panel border mt-3 no-print' }, [
      el('h3', { class: 'h6', text: 'Saldo Awal Kas Kecil (SUPERADMIN)' }),
      el('div', { class: 'small text-muted mb-2', text: 'Saldo dihitung dari tanggal ini; transaksi sebelum tanggal ini tidak ikut dihitung.' }),
      el('div', { class: 'row g-2 align-items-end' }, [kolom('col-md-4', 'Tanggal saldo awal', t), kolom('col-md-4', 'Jumlah', el('div', {}, [j, bantuRupiah(j)])),
        el('div', { class: 'col-md-2 mb-2' }, [el('button', { class: 'btn btn-outline-primary', type: 'submit', text: 'Simpan' })])]),
    ]);
    f.addEventListener('submit', aksiSekali(f.querySelector('button[type=submit]'), async (ev) => {
      ev.preventDefault();
      try {
        await put('/api/kaskecil/saldo-awal', { cabang: cabang.kode(), tanggal: t.value, jumlah: Number(j.value) });
        toast('Saldo awal disimpan.', 'success');
        await muat();
      } catch (e) {
        toast(e.message, 'error');
      }
    }));
    return f;
  }

  const tombol = el('button', { class: 'btn btn-primary', type: 'button', text: 'Tampilkan', onclick: muat });
  if (cabang.node) cabang.node.addEventListener('change', muat);
  view.replaceChildren(el('div', { class: 'panel' }, [
    navKas('#/kaskecil/laporan'),
    el('h2', { 'data-judul-halaman': '', class: 'h5 mb-3 pb-2 border-bottom', text: 'Kas Kecil — Laporan Harian' }),
    el('div', { class: 'row g-2 align-items-end mb-3' }, [cabang.node ? kolom('col-md-4', 'Warehouse', cabang.node) : null, kolom('col-md-3', 'Tanggal', tgl), el('div', { class: 'col-md-2 mb-2' }, [tombol])]),
    isi,
  ]));
  await muat();
  return { ok: true };
}

// ── Summary & Pembanding (per bulan) ────────────────────────────────────────
async function halamanBulanan(view, { aktif, judul, endpoint, gambar, sheet, kunci }) {
  let dasar;
  try {
    dasar = await muatDasar();
  } catch (err) {
    view.replaceChildren(navKas(aktif), el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }
  const cabang = pilihanCabang(dasar.cabangList);
  const bulan = el('input', { type: 'month', class: 'form-control', value: tanggalWib().slice(0, 7), max: tanggalWib().slice(0, 7) });
  const isi = el('div', {});
  const unduh = el('button', { class: 'btn btn-outline-primary', type: 'button', text: 'Unduh Excel', disabled: 'disabled' });
  let hasil = null;
  async function muat() {
    if (!cabang.kode()) { isi.replaceChildren(el('div', { class: 'text-muted', text: 'Pilih warehouse.' })); return; }
    isi.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat…' }));
    try {
      hasil = (await get(`${endpoint}?${new URLSearchParams({ cabang: cabang.kode(), bulan: bulan.value })}`))[kunci];
      isi.replaceChildren(gambar(hasil));
      unduh.disabled = false;
    } catch (e) {
      hasil = null;
      unduh.disabled = true;
      isi.replaceChildren(el('div', { class: 'alert alert-danger', text: e.message }));
    }
  }
  unduh.addEventListener('click', () => hasil && unduhExcel(sheet(hasil, { warehouse: cabang.nama(), bulan: bulan.value }), namaFileKas(kunci, cabang.kode(), bulan.value)));
  if (cabang.node) cabang.node.addEventListener('change', muat);
  view.replaceChildren(el('div', { class: 'panel' }, [
    navKas(aktif), el('h2', { 'data-judul-halaman': '', class: 'h5 mb-3 pb-2 border-bottom', text: judul }),
    el('div', { class: 'row g-2 align-items-end mb-3' }, [cabang.node ? kolom('col-md-4', 'Warehouse', cabang.node) : null, kolom('col-md-3', 'Bulan', bulan),
      el('div', { class: 'col-md-4 mb-2 d-flex gap-2' }, [el('button', { class: 'btn btn-primary', type: 'button', text: 'Tampilkan', onclick: muat }), unduh])]),
    isi,
  ]));
  await muat();
  return { ok: true };
}

export function renderKasSummary(view) {
  return halamanBulanan(view, {
    aktif: '#/kaskecil/summary', judul: 'Kas Kecil — Summary Bulanan', endpoint: '/api/kaskecil/summary', kunci: 'summary', sheet: sheetSummary,
    gambar: (s) => {
      if (!s.baris.length) return el('div', { class: 'text-center text-muted py-4', text: 'Belum ada kas keluar pada bulan ini.' });
      return el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-hover align-middle' }, [
        th(['Tanggal', ...s.jenis, 'Total'], s.jenis.map((_, i) => i + 1).concat([s.jenis.length + 1])),
        el('tbody', {}, s.baris.map((b) => el('tr', {}, [el('td', { class: 'text-nowrap', text: fmtDateId(b.tanggal) }), ...s.jenis.map((j) => el('td', { class: 'text-end', text: b.nilai[j] ? fmtNum(b.nilai[j]) : '-' })), el('td', { class: 'text-end fw-bold', text: fmtNum(b.total) })]))),
        el('tfoot', { class: 'table-light fw-bold' }, [el('tr', {}, [el('td', { text: 'Total' }), ...s.jenis.map((j) => el('td', { class: 'text-end', text: fmtNum(s.total[j] ?? 0) })), el('td', { class: 'text-end', text: fmtNum(s.total.semua ?? 0) })])]),
      ])]);
    },
  });
}

export function renderKasPembanding(view) {
  return halamanBulanan(view, {
    aktif: '#/kaskecil/pembanding', judul: 'Kas Kecil — Pembanding dengan Aplikasi', endpoint: '/api/kaskecil/pembanding', kunci: 'baris', sheet: sheetPembanding,
    gambar: (baris) => {
      if (!baris.length) return el('div', { class: 'text-center text-muted py-4', text: 'Belum ada data pada bulan ini.' });
      const sel = (p) => [el('td', { class: 'text-end', text: fmtNum(p.app) }), el('td', { class: 'text-end', text: fmtNum(p.kas) }), el('td', { class: `text-end ${p.selisih ? 'kas-selisih' : 'kas-cocok'}`, text: p.selisih ? fmtNum(p.selisih) : '0' })];
      return el('div', {}, [
        el('div', { class: 'small text-muted mb-2', text: 'Selisih = aplikasi − kas kecil. BBM tunai ↔ Bensin Delivery; Top Up Flazz ↔ Pengisian ETOLL (WHP Bandung, WHO Bandung, WHO Cibaduyut: top up dibayar langsung Finance, tidak dibandingkan); Tol tunai ↔ Uang Muka Delivery (indikatif).' }),
        el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-hover align-middle' }, [
          el('thead', { class: 'thead-hijau' }, [
            el('tr', {}, [el('th', { rowspan: '2', text: 'Tanggal' }), el('th', { colspan: '3', class: 'text-center', text: 'BBM Tunai' }), el('th', { colspan: '3', class: 'text-center', text: 'Top Up Flazz' }), el('th', { colspan: '3', class: 'text-center', text: 'Tol Tunai' }), el('th', { rowspan: '2', text: 'Status' })]),
            el('tr', {}, ['Aplikasi', 'Kas', 'Selisih', 'Aplikasi', 'Kas', 'Selisih', 'Aplikasi', 'Kas', 'Selisih'].map((x) => el('th', { class: 'text-end', text: x }))),
          ]),
          el('tbody', {}, baris.map((b) => el('tr', {}, [el('td', { class: 'text-nowrap', text: tglId(b.tanggal) }), ...sel(b.bbm), ...(b.topupFinance ? [el('td', { class: 'text-end', text: fmtNum(b.topup.app) }), el('td', { class: 'text-end text-muted', colspan: '2', text: 'Via Finance' })] : sel(b.topup)), ...sel(b.tol), el('td', {}, [el('span', { class: b.cocok ? 'kas-cocok' : 'kas-selisih', text: b.cocok ? 'Cocok' : 'Selisih' })])]))),
        ])]),
      ]);
    },
  });
}

// ── BA Cash Opname ──────────────────────────────────────────────────────────
export async function renderKasOpname(view) {
  let dasar;
  try {
    dasar = await muatDasar();
  } catch (err) {
    view.replaceChildren(navKas('#/kaskecil/opname'), el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }
  const cabang = pilihanCabang(dasar.cabangList, { boleh0: true });
  const tgl = el('input', { type: 'date', class: 'form-control', value: tanggalWib(), max: tanggalWib() });
  const catatan = el('input', { class: 'form-control', maxlength: '300' });
  const galat = el('div', { class: 'alert alert-danger d-none' });
  const total = el('div', { class: 'h6', text: 'Nilai fisik: Rp 0' });
  const pecahan = kotakPecahan(PECAHAN_OPNAME, (t) => { total.textContent = `Nilai fisik: ${rp(t)}`; });
  pecahan.node.open = true;
  pecahan.node.querySelector('summary').textContent = 'Hitung fisik uang per pecahan';
  const daftar = el('div', {});
  const simpan = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Simpan BA Cash Opname' });
  const form = el('form', { novalidate: 'novalidate', class: 'panel' }, [
    el('h3', { class: 'h6 mb-3', text: 'Berita Acara Cash Opname' }), galat,
    el('div', { class: 'row g-2' }, [kolom('col-md-3', 'Tanggal', tgl), kolom('col-md-9', 'Catatan', catatan)]),
    pecahan.node, total,
    el('div', { class: 'small text-muted mb-2', text: 'Nilai buku diambil otomatis dari saldo akhir kas kecil pada tanggal tersebut.' }), simpan,
  ]);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    galat.classList.add('d-none');
    if (semua() && !cabang.kode()) { tampilkanGalat(galat, 'Pilih warehouse terlebih dahulu.'); return; }
    simpan.disabled = true;
    try {
      const res = await post('/api/kaskecil/opname', { cabang: cabang.kode(), tanggal: tgl.value, catatan: catatan.value.trim(), pecahan: pecahan.nilai() });
      const o = res.opname;
      toast(o.selisih === 0 ? `BA ${o.id} tersimpan — sesuai.` : `BA ${o.id} tersimpan — selisih ${rp(o.selisih)}.`, o.selisih === 0 ? 'success' : 'warning');
      pecahan.kosongkan();
      catatan.value = '';
      await muat();
    } catch (e) {
      tampilkanGalat(galat, e.message);
    } finally {
      simpan.disabled = false;
    }
  });
  async function muat() {
    try {
      const q = new URLSearchParams();
      if (semua() && cabang.kode()) q.set('cabang', cabang.kode());
      const { opname = [] } = await get(`/api/kaskecil/opname?${q}`);
      daftar.replaceChildren(opname.length ? el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-hover align-middle' }, [
        th(['Tanggal', 'Nomor BA', 'Pemeriksa', 'Nilai Fisik', 'Nilai Buku', 'Selisih', 'Aksi'], [3, 4, 5]),
        el('tbody', {}, opname.map((o) => el('tr', {}, [
          el('td', { text: fmtDateId(o.tanggal) }), el('td', { class: 'small', text: o.id }), el('td', { text: o.pemeriksa }),
          el('td', { class: 'text-end', text: rp(o.nilai_fisik) }), el('td', { class: 'text-end', text: rp(o.nilai_buku) }),
          el('td', { class: `text-end ${o.selisih ? 'kas-selisih' : 'kas-cocok'}`, text: o.selisih ? rp(o.selisih) : 'Sesuai' }),
          el('td', {}, [grupAksi([
            tombolIkon('cetak', 'Cetak BA', () => cetakOpname({ opname: o, cabang: { nama: dasar.cabangList.find((c) => c.kode === o.kode_cabang)?.nama || o.kode_cabang } })),
            tulis() ? tombolIkonSekali('hapus', 'Hapus BA', async () => {
              if (!confirmDialog(`Hapus BA ${o.id}?`)) return;
              try { await del(`/api/kaskecil/opname/${encodeURIComponent(o.id)}`); toast('BA dihapus.', 'success'); await muat(); } catch (e) { toast(e.message, 'error'); }
            }) : null,
          ])]),
        ]))),
      ])]) : el('div', { class: 'text-center text-muted py-4', text: 'Belum ada BA cash opname.' }));
    } catch (e) {
      daftar.replaceChildren(el('div', { class: 'alert alert-danger', text: e.message }));
    }
  }
  if (cabang.node) cabang.node.addEventListener('change', muat);
  view.replaceChildren(
    el('div', { class: 'panel' }, [navKas('#/kaskecil/opname'), el('h2', { 'data-judul-halaman': '', class: 'h5 mb-3 pb-2 border-bottom', text: 'Kas Kecil — BA Cash Opname' }), cabang.node ? kolom('col-md-4', 'Warehouse', cabang.node) : null]),
    ...(tulis() ? [form] : []),
    el('div', { class: 'panel' }, [daftar]),
  );
  await muat();
  return { ok: true };
}
