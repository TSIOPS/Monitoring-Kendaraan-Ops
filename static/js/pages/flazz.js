import { del, get, post, put } from '../api.js';
import { getUser } from '../store.js';
import { confirmDialog, el, fmtDateId, fmtNum, toast, labelDari, petaMaster } from '../ui.js';
import { kompresGambar, namaAman, tanggalWib } from './input.js';

// Halaman Flazz (M9): List, Top Up, Pengembalian & Rekonsiliasi, Riwayat.
// Angka saldo rekonsiliasi selalu dari server (preview); halaman tidak menghitung ulang.

const FMT_WIB = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' });

// Kunci tanggal WIB (YYYY-MM-DD) dari tanggal polos atau stempel waktu ISO.
export function tglKey(v) {
  const s = String(v ?? '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const t = Date.parse(s);
  return Number.isNaN(t) ? '' : FMT_WIB.format(new Date(t));
}
const inRange = (v, start, end) => {
  const k = tglKey(v);
  return !!k && k >= start && k <= end;
};
const ts = (v) => {
  const t = Date.parse(String(v ?? ''));
  return Number.isNaN(t) ? null : t;
};
const n = (v) => Number(v) || 0;

// Saldo awal/pengeluaran/saldo akhir satu kartu dalam periode (port renderFlazzListingTable GAS).
export function hitungListing(card, data, start, end) {
  const id = card.id;
  const lastBal = n(card.last_balance);
  const topups = (data.topups || []).filter((t) => t.card_id === id && inRange(t.date, start, end));
  const tols = (data.tols || []).filter((t) => t.card_id === id && inRange(t.date, start, end));
  const bbm = (data.bbmFlazz || []).filter((b) => b.card_id === id && inRange(b.tanggal || b.timestamp, start, end));
  const totalTopup = topups.reduce((s, t) => s + n(t.amount), 0);
  const totalTol = tols.reduce((s, t) => s + n(t.amount), 0) + bbm.reduce((s, b) => s + n(b.toll_amount), 0);
  const totalBbm = bbm.reduce((s, b) => s + n(b.amount), 0);
  const pengeluaran = totalTol + totalBbm;

  const recons = (data.recons || []).filter((r) => r.card_id === id && inRange(r.date, start, end))
    .sort((a, b) => (ts(a.reconciled_at) ?? ts(a.date) ?? 0) - (ts(b.reconciled_at) ?? ts(b.date) ?? 0));
  let saldoAwal;
  let saldoAkhir;
  if (recons.length) {
    // Saldo akhir = saldo sistem rekon TERAKHIR + aktivitas yang tercatat setelahnya.
    const last = recons[recons.length - 1];
    const batas = ts(last.reconciled_at) ?? ts(last.date) ?? 0;
    const setelah = (v) => (ts(v) ?? -Infinity) > batas;
    let tailTopup = 0;
    let tailKeluar = 0;
    topups.forEach((t) => { if (setelah(t.created_at || t.date)) tailTopup += n(t.amount); });
    tols.forEach((t) => { if (setelah(t.created_at || t.date)) tailKeluar += n(t.amount); });
    bbm.forEach((b) => { if (setelah(b.timestamp || b.tanggal)) tailKeluar += n(b.amount) + n(b.toll_amount); });
    saldoAwal = n(last.opening_balance);
    saldoAkhir = (n(last.flazz_balance) || lastBal) + tailTopup - tailKeluar;
  } else {
    saldoAwal = pengeluaran > 0 || totalTopup > 0 ? lastBal + pengeluaran - totalTopup : 0;
    saldoAkhir = lastBal;
  }
  return { saldoAwal, pengeluaran, saldoAkhir, totalTopup, totalBbm, totalTol, topups, tols, bbm };
}

// Baris rekap detail kartu: top up dan pengeluaran (BBM & tol dipisah per baris), urut tanggal.
export function susunDetailKartu(h) {
  const urut = (a, b) => String(a.tanggal).localeCompare(String(b.tanggal));
  const topup = h.topups.map((t) => ({ tanggal: t.date, ket: t.notes || '', nominal: n(t.amount), bukti: t.evidence_url || '' })).sort(urut);
  const keluar = [
    ...h.tols.map((t) => ({ tanggal: t.date, jenis: 'Tol', driver: t.driver_id || '', kendaraan: t.vehicle_id || '', nominal: n(t.amount), bukti: t.evidence_url || '' })),
    ...h.bbm.flatMap((b) => [
      n(b.amount) > 0 ? { tanggal: b.tanggal, jenis: 'BBM', driver: b.driver || '', kendaraan: b.vehicle || '', nominal: n(b.amount), bukti: b.evidence || '' } : null,
      n(b.toll_amount) > 0 ? { tanggal: b.tanggal, jenis: 'Tol', driver: b.driver || '', kendaraan: b.vehicle || '', nominal: n(b.toll_amount), bukti: b.toll_evidence || '' } : null,
    ].filter(Boolean)),
  ].sort(urut);
  return { topup, keluar };
}

// BBM Flazz yang kartunya sudah direkonsiliasi pada/setelah laporan dibuat (server menolak Lepas Flazz).
export function sudahDirekon(b, recons) {
  const waktu = ts(b.timestamp) ?? ts(b.tanggal);
  if (waktu === null) return false;
  return (recons || []).some((r) => String(r.is_deleted || '') !== '1' && r.card_id === b.card_id &&
    (ts(r.reconciled_at) ?? ts(r.date) ?? -Infinity) >= waktu);
}

// Info selisih seperti GAS: selisih tampilan = fisik - sistem; usulan tindakan.
export function infoSelisih(sistem, fisik) {
  const diff = n(fisik) - n(sistem);
  if (diff === 0) return { kelas: 'alert-success', teks: 'Saldo sesuai.', aksi: 'IGNORE' };
  if (diff < 0) return { kelas: 'alert-warning', teks: `Selisih kurang Rp ${fmtNum(Math.abs(diff))}. Ada pengeluaran belum tercatat?`, aksi: 'ADJUST' };
  return { kelas: 'alert-info', teks: `Selisih lebih Rp ${fmtNum(diff)}. Top up belum tercatat?`, aksi: 'ADJUST' };
}

const isSuper = () => String(getUser()?.role || '').toUpperCase() === 'SUPERADMIN';
const rp = (v) => 'Rp ' + fmtNum(v);
const baris = (label, kontrol) => el('div', { class: 'mb-3' }, [el('label', { class: 'form-label', text: label }), kontrol]);
const namaKartu = (c) => (c ? `${c.card_name || c.card_number || c.id}` : '-');
const KELAS_STATUS_KARTU = { SEDANG_DIGUNAKAN: 'badge-ef-waspada', TERSEDIA: 'badge-ef-baik' };

function isiOpsi(select, items, placeholder) {
  select.replaceChildren(el('option', { value: '', text: placeholder }));
  for (const it of items) select.appendChild(el('option', { value: String(it.value), text: String(it.label) }));
}

function tabel(kolom, barisList) {
  return el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm align-middle' }, [
    el('thead', {}, [el('tr', {}, kolom.map((t) => el('th', { text: t })))]),
    el('tbody', {}, barisList),
  ])]);
}

// Peta kode -> nama supir / plat kendaraan, diisi saat data dimuat.
let peta = petaMaster(null);
const supirNama = (x) => labelDari(x, peta.supir);
const platOf = (x) => labelDari(x, peta.kendaraan);

async function muatData() {
  const [dash, master] = await Promise.all([get('/api/flazz/dashboard'), get('/api/master')]);
  peta = petaMaster(master);
  return { ...dash, cabang: Array.isArray(master.cabangList) ? master.cabangList : [] };
}

function pilihWarehouse(cabang) {
  const sel = el('select', { class: 'form-select' });
  isiOpsi(sel, cabang.map((c) => ({ value: c.kode, label: c.nama || c.kode })), 'Semua warehouse');
  return sel;
}

function navFlazz(aktif) {
  const item = [['#/flazz', 'List Flazz'], ['#/flazz/topup', 'Top Up'], ['#/flazz/rekon', 'Pengembalian & Rekonsiliasi'], ['#/flazz/riwayat', 'Riwayat']];
  return el('div', { class: 'd-flex flex-wrap gap-2 mb-3 no-print' }, item.map(([h, t]) =>
    el('a', { class: `btn btn-sm ${h === aktif ? 'btn-primary' : 'btn-outline-primary'}`, href: h, text: t })));
}

async function siapkan(view, aktif) {
  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat data Flazz' }));
  try {
    return await muatData();
  } catch (err) {
    view.replaceChildren(navFlazz(aktif), el('div', { class: 'alert alert-danger', text: err.message }));
    return null;
  }
}

async function bacaFoto(input) {
  const file = input.files && input.files[0];
  if (!file) return {};
  return { foto_bukti: await kompresGambar(file), foto_bukti_name: namaAman(file.name) };
}

// ── List Flazz ────────────────────────────────────────────────────────────
export async function renderFlazzList(view) {
  const data = await siapkan(view, '#/flazz');
  if (!data) return { ok: false };
  const wh = pilihWarehouse(data.cabang);
  const dari = el('input', { type: 'date', class: 'form-control', value: tanggalWib() });
  const sampai = el('input', { type: 'date', class: 'form-control', value: tanggalWib() });
  const cari = el('input', { class: 'form-control', placeholder: 'Nomor / nama kartu' });
  const hasil = el('div', {});
  const detail = el('div', {});

  function tampilkan() {
    detail.replaceChildren();
    const start = dari.value || tanggalWib();
    const end = sampai.value || start;
    const q = cari.value.trim().toLowerCase();
    const cards = data.cards.filter((c) => c.status !== 'NONAKTIF' && (!wh.value || c.branch_id === wh.value) &&
      (!q || `${c.card_number} ${c.card_name}`.toLowerCase().includes(q)));
    if (!cards.length) {
      hasil.replaceChildren(el('div', { class: 'text-muted', text: 'Tidak ada kartu.' }));
      return;
    }
    hasil.replaceChildren(tabel(['No', 'Nomor kartu', 'Nama', 'Driver', 'Status', 'Saldo awal', 'Pengeluaran', 'Saldo akhir'],
      cards.map((c, i) => {
        const h = hitungListing(c, data, start, end);
        return el('tr', {}, [
          el('td', { text: String(i + 1) }),
          el('td', {}, [el('a', { href: '#', text: c.card_number || c.id, onclick: (e) => { e.preventDefault(); tampilDetail(c, start, end); } })]),
          el('td', { text: c.card_name || '-' }),
          el('td', { text: supirNama(c.driver_id) || '-' }),
          el('td', {}, [el('span', { class: `badge-status ${KELAS_STATUS_KARTU[c.status] || ''}`, text: c.status || '-' })]),
          el('td', { class: 'text-end', text: rp(h.saldoAwal) }),
          el('td', { class: 'text-end', text: h.pengeluaran > 0 ? '-' + rp(h.pengeluaran) : '-' }),
          el('td', { class: 'text-end fw-bold', text: rp(h.saldoAkhir) }),
        ]);
      })));
  }

  function tampilDetail(c, start, end) {
    const h = hitungListing(c, data, start, end);
    const r = susunDetailKartu(h);
    const periode = start === end ? fmtDateId(start) : `${fmtDateId(start)} s.d. ${fmtDateId(end)}`;
    const stat = (label, nilai, kelas = '') => el('div', { class: 'stat-card' }, [
      el('div', { class: 'label', text: label }),
      el('div', { class: `value ${kelas}`, text: nilai }),
    ]);
    const bukti = (url) => (url ? el('a', { href: url, target: '_blank', rel: 'noopener', title: 'Lihat bukti', 'aria-label': 'Lihat bukti' }, [el('i', { class: 'bi bi-image', 'aria-hidden': 'true' })]) : '-');
    const tabelRekap = (judul, kolom, isi, total, kosong) => el('div', { class: 'mb-3' }, [
      el('h4', { class: 'h6 mb-2', text: judul }),
      isi.length
        ? el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm table-bordered align-middle mb-0' }, [
          el('thead', { class: 'thead-hijau' }, [el('tr', {}, kolom.map((t) => el('th', { class: 'text-center', text: t })))]),
          el('tbody', {}, isi),
          el('tfoot', {}, [el('tr', { class: 'fw-bold' }, [
            el('td', { colspan: String(kolom.length - 2), class: 'text-end', text: 'Total' }),
            el('td', { class: 'text-end text-nowrap', text: rp(total) }),
            el('td', {}),
          ])]),
        ])])
        : el('div', { class: 'text-muted small', text: kosong }),
    ]);
    detail.replaceChildren(el('div', { class: 'panel mt-3 detail-kartu' }, [
      el('div', { class: 'd-flex flex-wrap justify-content-between align-items-start gap-2 mb-3' }, [
        el('div', {}, [
          el('h3', { class: 'h6 m-0', text: `Rekap Kartu ${namaKartu(c)}` }),
          el('div', { class: 'small text-muted', text: `${c.card_number || c.id} · ${periode} · Driver: ${supirNama(c.driver_id) || '-'}` }),
        ]),
        el('div', { class: 'd-flex gap-2 no-print' }, [
          el('button', { class: 'btn btn-sm btn-outline-primary', type: 'button', onclick: () => window.print() }, [el('i', { class: 'bi bi-printer me-1', 'aria-hidden': 'true' }), 'Cetak']),
          el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', onclick: () => detail.replaceChildren() }, [el('i', { class: 'bi bi-x-lg me-1', 'aria-hidden': 'true' }), 'Tutup']),
        ]),
      ]),
      el('div', { class: 'stat-grid mb-3' }, [
        stat('Saldo awal', rp(h.saldoAwal)),
        stat('Top up', '+' + rp(h.totalTopup), 'text-success'),
        stat('BBM', '-' + rp(h.totalBbm), 'text-danger'),
        stat('Tol', '-' + rp(h.totalTol), 'text-danger'),
        stat('Saldo akhir', rp(h.saldoAkhir)),
      ]),
      el('div', { class: 'row g-3' }, [
        el('div', { class: 'col-lg-5' }, [tabelRekap('Top Up', ['Tanggal', 'Keterangan', 'Nominal', 'Bukti'],
          r.topup.map((x) => el('tr', {}, [
            el('td', { class: 'text-nowrap', text: fmtDateId(x.tanggal) }), el('td', { text: x.ket || '-' }),
            el('td', { class: 'text-end text-nowrap text-success', text: '+' + rp(x.nominal) }), el('td', { class: 'text-center' }, [bukti(x.bukti)]),
          ])), h.totalTopup, 'Tidak ada top up pada periode ini.')]),
        el('div', { class: 'col-lg-7' }, [tabelRekap('Pengeluaran', ['Tanggal', 'Jenis', 'Driver', 'Kendaraan', 'Nominal', 'Bukti'],
          r.keluar.map((x) => el('tr', {}, [
            el('td', { class: 'text-nowrap', text: fmtDateId(x.tanggal) }),
            el('td', { class: 'text-center' }, [el('span', { class: `badge ${x.jenis === 'BBM' ? 'text-bg-warning' : 'text-bg-info'}`, text: x.jenis })]),
            el('td', { text: supirNama(x.driver) || '-' }), el('td', { class: 'text-nowrap', text: platOf(x.kendaraan) || '-' }),
            el('td', { class: 'text-end text-nowrap text-danger', text: '-' + rp(x.nominal) }), el('td', { class: 'text-center' }, [bukti(x.bukti)]),
          ])), h.pengeluaran, 'Tidak ada pengeluaran pada periode ini.')]),
      ]),
    ]));
    detail.scrollIntoView({ behavior: 'smooth' });
  }

  for (const ctl of [wh, dari, sampai]) ctl.addEventListener('change', tampilkan);
  cari.addEventListener('input', tampilkan);
  view.replaceChildren(el('div', { class: 'panel' }, [
    navFlazz('#/flazz'),
    el('h2', { class: 'h6 mb-3', text: 'List Flazz' }),
    el('div', { class: 'row g-2 no-print' }, [
      isSuper() ? el('div', { class: 'col-md-3' }, [baris('Warehouse', wh)]) : null,
      el('div', { class: 'col-md-3' }, [baris('Dari tanggal', dari)]),
      el('div', { class: 'col-md-3' }, [baris('Sampai tanggal', sampai)]),
      el('div', { class: 'col-md-3' }, [baris('Cari', cari)]),
    ]),
    hasil,
  ]), detail);
  tampilkan();
  return { ok: true };
}

// ── Top Up ────────────────────────────────────────────────────────────────
export async function renderFlazzTopup(view) {
  const data = await siapkan(view, '#/flazz/topup');
  if (!data) return { ok: false };
  const kartu = el('select', { class: 'form-select' });
  isiOpsi(kartu, data.cards.filter((c) => ['TERSEDIA', 'SEDANG_DIGUNAKAN'].includes(c.status))
    .map((c) => ({ value: c.id, label: `${namaKartu(c)} (saldo ${fmtNum(c.last_balance)})` })), '— pilih kartu —');
  const nominal = el('input', { type: 'number', min: '1', class: 'form-control' });
  const tanggal = el('input', { type: 'date', class: 'form-control', value: tanggalWib() });
  const catatan = el('input', { class: 'form-control' });
  const foto = el('input', { type: 'file', accept: 'image/*', class: 'form-control' });
  const alertBox = el('div', { class: 'alert alert-danger d-none' });
  const simpan = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Proses Top Up' });
  const form = el('form', { novalidate: 'novalidate' }, [
    alertBox,
    el('div', { class: 'row g-2' }, [
      el('div', { class: 'col-md-6' }, [baris('Kartu', kartu)]),
      el('div', { class: 'col-md-3' }, [baris('Nominal top up', nominal)]),
      el('div', { class: 'col-md-3' }, [baris('Tanggal top up', tanggal)]),
      el('div', { class: 'col-md-6' }, [baris('Catatan', catatan)]),
      el('div', { class: 'col-md-6' }, [baris('Foto bukti (opsional)', foto)]),
    ]),
    simpan,
  ]);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('d-none');
    const err = [];
    if (!kartu.value) err.push('Pilih kartu.');
    if (!(Number(nominal.value) > 0)) err.push('Nominal top up harus lebih dari 0.');
    if (err.length) {
      alertBox.textContent = err.join(' ');
      alertBox.classList.remove('d-none');
      return;
    }
    simpan.disabled = true;
    try {
      const res = await post('/api/flazz/topup', {
        card_id: kartu.value, amount: Number(nominal.value), date: tanggal.value, notes: catatan.value.trim(), ...(await bacaFoto(foto)),
      });
      toast(res.msg || 'Top Up berhasil dicatat dan saldo bertambah.', 'success');
      window.location.hash = '#/flazz/riwayat';
    } catch (e) {
      alertBox.textContent = e.message;
      alertBox.classList.remove('d-none');
      simpan.disabled = false;
    }
  });
  view.replaceChildren(el('div', { class: 'panel' }, [navFlazz('#/flazz/topup'), el('h2', { class: 'h6 mb-3', text: 'Top Up Saldo Flazz' }), form]));
  return { ok: true };
}

// ── Pengembalian & Rekonsiliasi ───────────────────────────────────────────
export async function renderFlazzRekon(view) {
  const data = await siapkan(view, '#/flazz/rekon');
  if (!data) return { ok: false };
  const kartu = el('select', { class: 'form-select' });
  const dipakai = data.cards.filter((c) => c.status === 'SEDANG_DIGUNAKAN');
  isiOpsi(kartu, dipakai.map((c) => ({ value: c.id, label: `${namaKartu(c)} — ${supirNama(c.driver_id) || 'tanpa pemegang'}` })),
    dipakai.length ? '— pilih kartu yang sedang digunakan —' : '— tidak ada kartu yang sedang digunakan —');
  const gate = el('div', { class: 'alert d-none py-2' });
  const rincian = el('div', { class: 'small text-muted mb-3' });
  const sistem = el('input', { class: 'form-control', disabled: 'disabled' });
  const fisik = el('input', { type: 'number', min: '0', class: 'form-control' });
  const selisih = el('div', { class: 'alert d-none py-2' });
  const aksi = el('select', { class: 'form-select' }, [
    el('option', { value: 'ADJUST', text: 'Sesuaikan saldo kartu ke saldo fisik' }),
    el('option', { value: 'IGNORE', text: 'Abaikan selisih (saldo kartu = saldo sistem)' }),
  ]);
  const catatan = el('input', { class: 'form-control', placeholder: 'Alasan selisih, dsb.' });
  const foto = el('input', { type: 'file', accept: 'image/*', class: 'form-control' });
  const alertBox = el('div', { class: 'alert alert-danger d-none' });
  const simpan = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Selesaikan Rekonsiliasi' });
  let preview = null;

  function hitungSelisih() {
    if (!preview || fisik.value === '') {
      selisih.className = 'alert d-none py-2';
      return;
    }
    const s = infoSelisih(preview.flazz_balance, fisik.value);
    selisih.className = `alert ${s.kelas} py-2`;
    selisih.textContent = s.teks;
    aksi.value = s.aksi;
  }

  kartu.addEventListener('change', async () => {
    preview = null;
    sistem.value = '';
    rincian.textContent = '';
    gate.className = 'alert d-none py-2';
    simpan.disabled = true;
    hitungSelisih();
    if (!kartu.value) return;
    try {
      preview = await get(`/api/flazz/reconciliation/preview?card_id=${encodeURIComponent(kartu.value)}`);
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    gate.className = `alert ${preview.eligible ? 'alert-success' : 'alert-danger'} py-2`;
    gate.textContent = preview.reason;
    simpan.disabled = !preview.eligible;
    sistem.value = rp(preview.flazz_balance);
    rincian.textContent = `Saldo awal ${rp(preview.opening_balance)} + top up ${rp(preview.total_topup)} − BBM ${rp(preview.total_bbm_flazz)} − tol ${rp(preview.total_tol)}` +
      (preview.usage ? ` · diserahkan ke ${supirNama(preview.usage.driver_id) || '-'} sejak ${fmtDateId(tglKey(preview.usage.used_at))}` : '');
    hitungSelisih();
  });
  fisik.addEventListener('input', hitungSelisih);

  const form = el('form', { novalidate: 'novalidate' }, [
    alertBox,
    baris('Kartu (yang sedang digunakan)', kartu),
    gate,
    el('div', { class: 'row g-2' }, [
      el('div', { class: 'col-md-6' }, [baris('Saldo di sistem (hitung otomatis)', sistem), rincian]),
      el('div', { class: 'col-md-6' }, [baris('Saldo fisik / cek asli', fisik)]),
    ]),
    selisih,
    el('div', { class: 'row g-2' }, [
      el('div', { class: 'col-md-6' }, [baris('Tindakan pada selisih', aksi)]),
      el('div', { class: 'col-md-6' }, [baris('Bukti cek saldo (jika ada selisih)', foto)]),
    ]),
    baris('Catatan', catatan),
    simpan,
  ]);
  simpan.disabled = true;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('d-none');
    if (!preview || fisik.value === '' || !(Number(fisik.value) >= 0)) {
      alertBox.textContent = 'Pilih kartu dan isi saldo fisik.';
      alertBox.classList.remove('d-none');
      return;
    }
    simpan.disabled = true;
    try {
      const res = await post('/api/flazz/reconciliation', {
        card_id: kartu.value, actual_balance: Number(fisik.value), action: aksi.value, notes: catatan.value.trim(), ...(await bacaFoto(foto)),
      });
      toast(res.msg, 'success');
      window.location.hash = '#/flazz/riwayat';
    } catch (e) {
      alertBox.textContent = e.message;
      alertBox.classList.remove('d-none');
      simpan.disabled = false;
    }
  });
  view.replaceChildren(el('div', { class: 'panel' }, [navFlazz('#/flazz/rekon'), el('h2', { class: 'h6 mb-3', text: 'Pengembalian & Rekonsiliasi' }), form]));
  return { ok: true };
}

// ── Riwayat ───────────────────────────────────────────────────────────────
export async function renderFlazzRiwayat(view) {
  let data = await siapkan(view, '#/flazz/riwayat');
  if (!data) return { ok: false };
  const wh = pilihWarehouse(data.cabang);
  const dari = el('input', { type: 'date', class: 'form-control', value: tanggalWib().slice(0, 8) + '01' });
  const sampai = el('input', { type: 'date', class: 'form-control', value: tanggalWib() });
  const isi = el('div', {});
  const editBox = el('div', {});
  let tab = 'topup';
  const tombolTab = {};

  const kartuMap = () => new Map(data.cards.map((c) => [c.id, c]));
  const filterKartu = (list) => {
    const km = kartuMap();
    return list.filter((x) => km.has(x.card_id) && (!wh.value || km.get(x.card_id).branch_id === wh.value));
  };
  const muatUlang = async () => {
    data = { ...(await get('/api/flazz/dashboard')), cabang: data.cabang };
    gambar();
  };
  const aman = async (fn) => {
    try {
      await fn();
    } catch (e) {
      toast(e.message, 'error');
    }
  };
  const tautan = (url) => (url ? el('a', { href: url, target: '_blank', rel: 'noopener', text: 'Lihat' }) : '-');

  function formEdit(jenis, row) {
    const nominal = el('input', { type: 'number', min: '1', class: 'form-control form-control-sm', value: String(row.amount) });
    const tanggal = el('input', { type: 'date', class: 'form-control form-control-sm', value: tglKey(row.date) });
    const catatan = el('input', { class: 'form-control form-control-sm', value: row.notes || '' });
    editBox.replaceChildren(el('div', { class: 'border rounded p-2 mb-3' }, [
      el('div', { class: 'fw-bold mb-2', text: `Edit ${jenis === 'topup' ? 'top up' : 'tol'} — ${namaKartu(kartuMap().get(row.card_id))}` }),
      el('div', { class: 'row g-2' }, [
        el('div', { class: 'col-md-3' }, [baris('Nominal', nominal)]),
        el('div', { class: 'col-md-3' }, [baris('Tanggal', tanggal)]),
        el('div', { class: 'col-md-6' }, [baris('Catatan', catatan)]),
      ]),
      el('div', { class: 'd-flex gap-2' }, [
        el('button', { class: 'btn btn-sm btn-primary', type: 'button', text: 'Simpan', onclick: () => aman(async () => {
          await put(`/api/flazz/${jenis}/${encodeURIComponent(row.id)}`, { amount: Number(nominal.value), date: tanggal.value, notes: catatan.value.trim() });
          toast('Perubahan disimpan.', 'success');
          editBox.replaceChildren();
          await muatUlang();
        }) }),
        el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', text: 'Batal', onclick: () => editBox.replaceChildren() }),
      ]),
    ]));
  }

  const hapus = (pesan, path) => aman(async () => {
    if (!confirmDialog(pesan)) return;
    const res = await del(path);
    toast(res.msg || 'Dihapus.', 'success');
    await muatUlang();
  });

  function gambar() {
    const start = dari.value;
    const end = sampai.value || start;
    const km = kartuMap();
    const kn = (id) => namaKartu(km.get(id));
    const dalam = (v) => inRange(v, start, end);
    let konten;
    if (tab === 'topup') {
      const list = filterKartu(data.topups).filter((t) => dalam(t.date));
      konten = tabel(['Tanggal', 'Kartu', 'Nominal', 'Bukti', 'Catatan', 'Dicatat oleh', 'Aksi'], list.map((t) => el('tr', {}, [
        el('td', { text: fmtDateId(t.date) }), el('td', { text: kn(t.card_id) }), el('td', { class: 'text-end', text: rp(t.amount) }),
        el('td', {}, [tautan(t.evidence_url)]), el('td', { text: t.notes || '-' }), el('td', { class: 'small', text: t.created_by || '-' }),
        el('td', {}, [
          el('button', { class: 'btn btn-sm btn-outline-primary me-1', type: 'button', text: 'Edit', onclick: () => formEdit('topup', t) }),
          el('button', { class: 'btn btn-sm btn-outline-danger', type: 'button', text: 'Hapus', onclick: () => hapus('Hapus top up ini? Saldo kartu ikut dikurangi.', `/api/flazz/topup/${encodeURIComponent(t.id)}`) }),
        ]),
      ])));
    } else if (tab === 'tol') {
      const list = filterKartu(data.tolHistory).filter((t) => dalam(t.date));
      konten = tabel(['Tanggal', 'Kartu', 'Supir / Kendaraan', 'Nominal', 'Bukti', 'Catatan', 'Dicatat oleh', 'Aksi'], list.map((t) => el('tr', {}, [
        el('td', { text: fmtDateId(tglKey(t.date)) }), el('td', { text: kn(t.card_id) }),
        el('td', { text: [supirNama(t.driver_id), platOf(t.vehicle_id)].filter(Boolean).join(' / ') || '-' }), el('td', { class: 'text-end', text: rp(t.amount) }),
        el('td', {}, [tautan(t.evidence_url)]), el('td', { text: t.notes || '-' }),
        el('td', { class: 'small', text: t.source === 'MANUAL' ? (t.created_by || '-') : 'laporan' }),
        el('td', {}, t.source === 'MANUAL' ? [
          el('button', { class: 'btn btn-sm btn-outline-primary me-1', type: 'button', text: 'Edit', onclick: () => formEdit('tol', t) }),
          el('button', { class: 'btn btn-sm btn-outline-danger', type: 'button', text: 'Hapus', onclick: () => hapus('Hapus catatan tol ini? Saldo kartu ikut dikembalikan.', `/api/flazz/tol/${encodeURIComponent(t.id)}`) }),
        ] : [el('span', { class: 'small text-muted', text: 'dari laporan' })]),
      ])));
    } else if (tab === 'bbm') {
      const list = filterKartu(data.bbmFlazz).filter((b) => dalam(b.tanggal));
      konten = tabel(['Tanggal', 'Kartu', 'Supir / Kendaraan', 'Biaya', 'Bukti', 'Aksi'], list.map((b) => el('tr', {}, [
        el('td', { text: fmtDateId(b.tanggal) }), el('td', { text: kn(b.card_id) }),
        el('td', { text: [b.driver, b.vehicle].filter(Boolean).join(' / ') || '-' }),
        el('td', { class: 'text-end', text: rp(n(b.amount) + n(b.toll_amount)) }), el('td', {}, [tautan(b.evidence)]),
        el('td', {}, n(b.amount) <= 0 ? [] : sudahDirekon(b, data.recons) ? [el('span', { class: 'small text-muted', title: 'Hapus rekonsiliasi kartunya dulu bila perlu dikoreksi.' }, [el('i', { class: 'bi bi-lock me-1', 'aria-hidden': 'true' }), 'Sudah direkon'])] : [el('button', { class: 'btn btn-sm btn-outline-warning', type: 'button', text: 'Lepas Flazz',
          onclick: () => hapus('Lepas pembayaran BBM Flazz dari laporan ini? Nominal tetap tercatat sebagai tunai dan saldo kartu dikembalikan.', `/api/laporan/${encodeURIComponent(b.transaction_id)}/flazz`) })]),
      ])));
    } else if (tab === 'usage') {
      const list = filterKartu(data.usages).filter((u) => dalam(u.used_at || u.date));
      konten = tabel(['Tanggal', 'Kartu', 'Supir / Kendaraan', 'Sumber', 'Status', 'Dikembalikan'], list.map((u) => el('tr', {}, [
        el('td', { text: fmtDateId(tglKey(u.used_at || u.date)) }), el('td', { text: kn(u.card_id) }),
        el('td', { text: [supirNama(u.driver_id), platOf(u.vehicle_id)].filter(Boolean).join(' / ') || '-' }), el('td', { text: u.ref_type || '-' }),
        el('td', { text: u.status }), el('td', { text: u.returned_at ? fmtDateId(tglKey(u.returned_at)) : '-' }),
      ])));
    } else {
      const list = filterKartu(data.recons).filter((r) => dalam(r.date));
      konten = tabel(['Tanggal', 'Kartu', 'Pemegang', 'Saldo awal', 'Top up', 'BBM+Tol', 'Saldo sistem', 'Saldo fisik', 'Selisih', 'Status', 'Catatan', 'Oleh', 'Aksi'],
        list.map((r) => el('tr', {}, [
          el('td', { text: fmtDateId(r.date) }), el('td', { text: kn(r.card_id) }), el('td', { text: supirNama(r.driver_id) || '-' }),
          el('td', { class: 'text-end', text: rp(r.opening_balance) }), el('td', { class: 'text-end', text: rp(r.total_topup) }),
          el('td', { class: 'text-end', text: rp(n(r.total_bbm_flazz) + n(r.total_tol)) }), el('td', { class: 'text-end', text: rp(r.flazz_balance) }),
          el('td', { class: 'text-end', text: rp(r.actual_balance) }), el('td', { class: 'text-end', text: rp(r.difference) }),
          el('td', {}, [el('span', { class: `badge-status ${r.reconciliation_status === 'SESUAI' ? 'badge-ef-baik' : 'badge-ef-waspada'}`, text: r.reconciliation_status })]),
          el('td', { text: r.notes || '-' }), el('td', { text: r.reconciled_by || '-' }),
          el('td', {}, isSuper() ? [el('button', { class: 'btn btn-sm btn-outline-danger', type: 'button', text: 'Hapus',
            onclick: () => hapus('Hapus rekonsiliasi ini? Saldo kartu kembali ke saldo sistem sebelum rekonsiliasi dan kartu kembali SEDANG_DIGUNAKAN.', `/api/flazz/reconciliation/${encodeURIComponent(r.id)}`) })] : []),
        ])));
    }
    for (const [k, b] of Object.entries(tombolTab)) b.className = `btn btn-sm ${k === tab ? 'btn-secondary' : 'btn-outline-secondary'}`;
    isi.replaceChildren(konten.querySelector('tbody').children.length ? konten : el('div', { class: 'text-muted', text: 'Tidak ada data pada rentang ini.' }));
  }

  const tabs = [['topup', 'Top Up'], ['tol', 'Tol'], ['bbm', 'BBM Flazz'], ['usage', 'Penyerahan'], ['recon', 'Rekonsiliasi']];
  const barTab = el('div', { class: 'd-flex flex-wrap gap-2 mb-3' }, tabs.map(([k, t]) => {
    tombolTab[k] = el('button', { type: 'button', text: t, onclick: () => { tab = k; editBox.replaceChildren(); gambar(); } });
    return tombolTab[k];
  }));
  for (const ctl of [wh, dari, sampai]) ctl.addEventListener('change', gambar);
  view.replaceChildren(el('div', { class: 'panel' }, [
    navFlazz('#/flazz/riwayat'),
    el('h2', { class: 'h6 mb-3', text: 'Riwayat Flazz' }),
    el('div', { class: 'row g-2' }, [
      isSuper() ? el('div', { class: 'col-md-4' }, [baris('Warehouse', wh)]) : null,
      el('div', { class: 'col-md-4' }, [baris('Dari tanggal', dari)]),
      el('div', { class: 'col-md-4' }, [baris('Sampai tanggal', sampai)]),
    ]),
    barTab, editBox, isi,
  ]));
  gambar();
  return { ok: true };
}
