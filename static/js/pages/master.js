import { del, get, post, put } from '../api.js';
import { getUser } from '../store.js';
import { confirmDialog, el, fmtDateId, fmtNum, toast } from '../ui.js';

// Halaman Data Master (M10). Satu pembangun tabel + form dipakai semua tab;
// tiap entitas hanya mendeskripsikan kolom, field, dan endpoint (API M2/M5, field GAS).

const JENIS_KENDARAAN = [['Mobil', 'Mobil'], ['Motor', 'Motor']];
const INDIKATOR = [['DIGITAL_BAR', 'Digital Bar'], ['ANALOG_JARUM', 'Analog / Jarum'], ['DIGITAL_ANGKA', 'Digital Angka'], ['TIDAK_ADA', 'Tidak Ada'], ['LAINNYA', 'Lainnya']];
const TIPE_KARTU = [['BCA_FLAZZ', 'BCA Flazz'], ['MANDIRI_EMONEY', 'Mandiri E-Money'], ['BRI_BRIZZI', 'BRI Brizzi'], ['BNI_TAPCASH', 'BNI TapCash']];
const PERAN_KARTU = [['UTAMA', 'Kartu Utama'], ['CADANGAN', 'Kartu Cadangan']];
const ROLE = [['PIC CABANG', 'PIC CABANG'], ['SUPERADMIN', 'SUPERADMIN']];

const isSuper = () => String(getUser()?.role || '').toUpperCase() === 'SUPERADMIN';
const opsi = (pairs) => pairs.map(([value, label]) => ({ value, label }));

// Pesan field wajib yang kosong (validasi murah di klien; aturan lain di server).
// Kolom oli Data Master: baseline 0 berarti belum pernah diatur (peringatan oli tidak dihitung).
export function teksOliMaster(v) {
  const baseline = Number(v.km_terakhir_ganti_oli) || 0;
  const interval = fmtNum(v.interval_ganti_oli_km);
  return baseline > 0 ? `${fmtNum(baseline)} / ${interval}` : `Belum diatur (interval ${interval})`;
}

export function fieldKosong(fields, values, isEdit) {
  return fields
    .filter((f) => (typeof f.wajib === 'function' ? f.wajib(values, isEdit) : f.wajib))
    .filter((f) => String(values[f.key] ?? '').trim() === '')
    .map((f) => `${f.label} wajib diisi.`);
}

// Body API per entitas dari nilai form.
export function bodyKendaraan(v) {
  return {
    plat: v.plat.trim(), nama: v.nama.trim(), jenis: v.jenis, merk: v.merk.trim(), model: v.model.trim(),
    kapasitas_tangki: Number(v.kapasitas_tangki) || 0, jumlah_bar: Number(v.jumlah_bar) || 0,
    standar_km_l: Number(v.standar_km_l) || 0, jenis_indikator: v.jenis_indikator, cabang: v.cabang,
    tanggal_pajak: v.tanggal_pajak, tanggal_pajak_5_tahunan: v.tanggal_pajak_5_tahunan, tanggal_kir: v.tanggal_kir,
    interval_ganti_oli_km: Number(v.interval_ganti_oli_km) || 0, km_terakhir_ganti_oli: Number(v.km_terakhir_ganti_oli) || 0,
    // Hanya SUPERADMIN yang punya isian ini; tanpa isian, nilai lama di server dipertahankan.
    ...(v.cabang_bersama !== undefined ? { cabang_bersama: String(v.cabang_bersama).split(',').map((x) => x.trim()).filter((x) => x && x !== v.cabang) } : {}),
  };
}

export function bodyPengguna(v, isEdit) {
  const b = { username: v.username.trim(), nama: v.nama.trim(), role: v.role, cabang: v.role === 'SUPERADMIN' ? '' : v.cabang };
  // Saat edit, password kosong berarti tidak diubah.
  if (!isEdit || v.password) b.password = v.password;
  return b;
}

function entitas(m) {
  const cabangOpsi = () => m.cabang.map((c) => ({ value: c.kode, label: c.nama || c.kode }));
  const namaCabang = (kode) => m.cabang.find((c) => c.kode === kode)?.nama || kode || '-';
  const supirOpsi = (cabang) => m.drivers.filter((d) => !cabang || d.cabang === cabang).map((d) => ({ value: d.id, label: d.nama }));
  const namaSupir = (id) => m.drivers.find((d) => d.id === id)?.nama || id || '-';
  const platKendaraan = (id) => m.vehicles.find((v) => v.vehicle_id === id)?.plat_nomor || '-';
  const dok = (t) => (t ? fmtDateId(String(t).slice(0, 10)) : '-');

  return {
    kendaraan: {
      label: 'Kendaraan', boleh: true, list: () => m.vehicles, cabangOf: (v) => v.cabang, key: (v) => v.vehicle_id,
      kolom: [
        ['Plat', (v) => v.plat_nomor], ['Nama', (v) => v.nama], ['Jenis', (v) => v.jenis],
        ['Indikator', (v) => INDIKATOR.find(([k]) => k === v.jenis_indikator)?.[1] || v.jenis_indikator],
        ['Warehouse', (v) => [namaCabang(v.cabang), ...(v.cabang_bersama || []).map((k) => '+ ' + namaCabang(k))].join(' ')], ['Pajak', (v) => dok(v.tanggal_pajak)], ['KIR', (v) => dok(v.tanggal_kir)],
        ['Oli (km terakhir / interval)', teksOliMaster, (v) => ((Number(v.km_terakhir_ganti_oli) || 0) > 0 ? '' : 'text-warning-emphasis bg-warning-subtle')],
      ],
      fields: [
        { key: 'plat', label: 'Plat nomor', wajib: true, dari: (v) => v.plat_nomor },
        { key: 'nama', label: 'Nama kendaraan', wajib: true, dari: (v) => v.nama },
        { key: 'jenis', label: 'Jenis kendaraan', type: 'select', opsi: () => opsi(JENIS_KENDARAAN), awal: 'Mobil', dari: (v) => v.jenis },
        { key: 'merk', label: 'Merk', dari: (v) => v.merk },
        { key: 'model', label: 'Model', dari: (v) => v.model },
        { key: 'kapasitas_tangki', label: 'Kapasitas tangki (L)', type: 'number', dari: (v) => v.kapasitas_tangki },
        { key: 'jumlah_bar', label: 'Jumlah bar', type: 'number', dari: (v) => v.jumlah_bar },
        { key: 'standar_km_l', label: 'Standar KM/L', type: 'number', dari: (v) => v.standar_km_l },
        { key: 'jenis_indikator', label: 'Jenis indikator BBM', type: 'select', opsi: () => opsi(INDIKATOR), awal: 'DIGITAL_BAR', dari: (v) => v.jenis_indikator },
        { key: 'tanggal_pajak', label: 'Jatuh tempo pajak tahunan', type: 'date', dari: (v) => String(v.tanggal_pajak || '').slice(0, 10) },
        { key: 'tanggal_pajak_5_tahunan', label: 'Jatuh tempo pajak 5 tahunan', type: 'date', dari: (v) => String(v.tanggal_pajak_5_tahunan || '').slice(0, 10) },
        { key: 'tanggal_kir', label: 'Jatuh tempo KIR', type: 'date', dari: (v) => String(v.tanggal_kir || '').slice(0, 10) },
        { key: 'interval_ganti_oli_km', label: 'Interval ganti oli (KM)', type: 'number', awal: '5000', dari: (v) => v.interval_ganti_oli_km },
        { key: 'km_terakhir_ganti_oli', label: 'KM terakhir ganti oli (odometer)', type: 'number', dari: (v) => v.km_terakhir_ganti_oli },
        { key: 'cabang', label: 'Warehouse', type: 'select', wajib: true, opsi: cabangOpsi, dari: (v) => v.cabang },
        ...(isSuper() ? [{ key: 'cabang_bersama', label: 'Dipakai juga oleh (kendaraan bersama)', type: 'multi', ikut: 'cabang',
          opsi: (v) => cabangOpsi().filter((o) => o.value !== v.cabang), dari: (v) => (v.cabang_bersama || []).join(','),
          catatan: () => 'Centang warehouse lain yang ikut memakai kendaraan ini. Riwayat KM, ganti oli, dan efisiensi tetap satu.' }] : []),
      ],
      simpan: (v, row) => (row ? put('/api/master/kendaraan', { ...bodyKendaraan(v), edit_id: row.vehicle_id }) : post('/api/master/kendaraan', bodyKendaraan(v))),
      hapus: (row) => ({ tanya: `Hapus kendaraan ${row.plat_nomor}?`, jalan: () => del(`/api/master/kendaraan/${encodeURIComponent(row.vehicle_id)}`) }),
      ekstra: (row) => [{ label: 'Reset oli', tanya: `Set baseline ganti oli ${row.plat_nomor} ke KM odometer terakhir?`, jalan: () => post(`/api/master/kendaraan/${encodeURIComponent(row.vehicle_id)}/reset-oli`, {}) }],
    },
    cabang: {
      label: 'Warehouse', boleh: isSuper(), list: () => m.cabang, key: (c) => c.kode,
      kolom: [['Kode', (c) => c.kode], ['Nama', (c) => c.nama], ['Lokasi', (c) => c.lokasi || '-']],
      fields: [
        { key: 'kode', label: 'Kode warehouse', wajib: true, kunciSaatEdit: true, dari: (c) => c.kode },
        { key: 'nama', label: 'Nama warehouse', wajib: true, dari: (c) => c.nama },
        { key: 'lokasi', label: 'Lokasi', dari: (c) => c.lokasi },
      ],
      simpan: (v, row) => {
        const b = { kode: v.kode.trim(), nama: v.nama.trim(), lokasi: v.lokasi.trim() };
        return row ? put('/api/master/cabang', { ...b, kode: row.kode, edit_id: row.kode }) : post('/api/master/cabang', b);
      },
      hapus: (row) => ({ tanya: `Hapus warehouse ${row.nama}?`, jalan: () => del(`/api/master/cabang/${encodeURIComponent(row.kode)}`) }),
    },
    supir: {
      label: 'Supir', boleh: true, list: () => m.drivers, cabangOf: (d) => d.cabang, key: (d) => d.id,
      kolom: [['Nama', (d) => d.nama], ['Warehouse', (d) => namaCabang(d.cabang)], ['Kendaraan default', (d) => (d.default_vehicle_id ? platKendaraan(d.default_vehicle_id) : '-')]],
      fields: [
        { key: 'nama', label: 'Nama lengkap', wajib: true, dari: (d) => d.nama },
        { key: 'cabang', label: 'Warehouse', type: 'select', wajib: true, opsi: cabangOpsi, dari: (d) => d.cabang },
        { key: 'default_vehicle_id', label: 'Kendaraan default (opsional)', type: 'select', ikut: 'cabang',
          opsi: (v) => m.vehicles.filter((x) => !v.cabang || x.cabang === v.cabang || (x.cabang_bersama || []).includes(v.cabang)).map((x) => ({ value: x.vehicle_id, label: `${x.plat_nomor} — ${x.nama}` })),
          dari: (d) => d.default_vehicle_id },
      ],
      simpan: (v, row) => {
        const b = { nama: v.nama.trim(), cabang: v.cabang, default_vehicle_id: v.default_vehicle_id };
        return row ? put('/api/master/supir', { ...b, edit_id: row.id }) : post('/api/master/supir', b);
      },
      hapus: (row) => ({ tanya: `Hapus supir ${row.nama}?`, jalan: () => del(`/api/master/supir/${encodeURIComponent(row.id)}`) }),
    },
    bbm: {
      label: 'BBM', boleh: isSuper(), list: () => m.bbm, key: (b) => b.id,
      kolom: [['Jenis', (b) => b.jenis], ['Harga / liter', (b) => 'Rp ' + fmtNum(b.harga)], ['Warehouse', (b) => (b.kode_cabang ? namaCabang(b.kode_cabang) : 'Semua (global)')]],
      fields: [
        { key: 'jenis', label: 'Jenis BBM', wajib: true, dari: (b) => b.jenis },
        { key: 'harga', label: 'Harga per liter (Rp)', type: 'number', wajib: true, dari: (b) => b.harga },
        { key: 'kode_cabang', label: 'Warehouse (kosong = semua)', type: 'select', opsi: cabangOpsi, dari: (b) => b.kode_cabang },
      ],
      simpan: (v, row) => {
        const b = { jenis: v.jenis.trim(), harga: Number(v.harga) || 0, kode_cabang: v.kode_cabang };
        return row ? put('/api/master/bbm', { ...b, edit_id: row.id }) : post('/api/master/bbm', b);
      },
      hapus: (row) => ({ tanya: `Hapus BBM ${row.jenis}?`, jalan: () => del(`/api/master/bbm/${encodeURIComponent(row.id)}`) }),
    },
    kartu: {
      label: 'Kartu Flazz', boleh: true, list: () => m.cards, cabangOf: (k) => k.branch_id, key: (k) => k.id,
      kolom: [
        ['ID', (k) => k.id], ['Nomor kartu', (k) => k.card_number], ['Nama', (k) => k.card_name],
        ['Tipe', (k) => TIPE_KARTU.find(([x]) => x === k.card_type)?.[1] || k.card_type || '-'],
        ['Kategori', (k) => PERAN_KARTU.find(([x]) => x === k.card_role)?.[1] || k.card_role || '-'],
        ['Warehouse', (k) => namaCabang(k.branch_id)], ['Saldo', (k) => 'Rp ' + fmtNum(k.last_balance)], ['Status', (k) => k.status],
      ],
      fields: [
        { key: 'card_number', label: 'Nomor kartu', wajib: true, dari: (k) => k.card_number },
        { key: 'card_name', label: 'Nama kartu', wajib: true, dari: (k) => k.card_name },
        { key: 'card_type', label: 'Tipe kartu (jenis fisik)', type: 'select', opsi: () => opsi(TIPE_KARTU), awal: 'BCA_FLAZZ', dari: (k) => k.card_type },
        { key: 'card_role', label: 'Peran kartu', type: 'select', opsi: () => opsi(PERAN_KARTU), awal: 'UTAMA', dari: (k) => k.card_role },
        // Warehouse kartu tidak dapat dipindah setelah dibuat (aturan M5).
        { key: 'branch_id', label: 'Warehouse', type: 'select', wajib: true, kunciSaatEdit: true, opsi: cabangOpsi, dari: (k) => k.branch_id },
        { key: 'default_driver_id', label: 'Supir default (pemilik tetap)', type: 'select', ikut: 'branch_id', opsi: (v) => supirOpsi(v.branch_id), dari: (k) => k.default_driver_id },
        { key: 'notes', label: 'Keterangan tambahan', dari: (k) => k.notes },
      ],
      simpan: (v, row) => {
        const b = { card_number: v.card_number.trim(), card_name: v.card_name.trim(), card_type: v.card_type, card_role: v.card_role, default_driver_id: v.default_driver_id, notes: v.notes.trim() };
        return row ? put(`/api/flazz/card/${encodeURIComponent(row.id)}`, b) : post('/api/flazz/card', { ...b, branch_id: v.branch_id });
      },
      hapus: (row) => (row.status === 'NONAKTIF'
        ? { label: 'Aktifkan', tanya: `Aktifkan kembali kartu ${row.card_name}?`, jalan: () => put(`/api/flazz/card/${encodeURIComponent(row.id)}`, { status: 'TERSEDIA' }) }
        : { label: 'Nonaktifkan', tanya: `Nonaktifkan kartu ${row.card_name}?`, jalan: () => del(`/api/flazz/card/${encodeURIComponent(row.id)}`) }),
      info: (k) => `Supir default: ${namaSupir(k.default_driver_id)}`,
    },
    pengguna: {
      label: 'Pengguna', boleh: isSuper(), list: () => m.pengguna, cabangOf: (p) => p.cabang, key: (p) => p.user_id,
      kolom: [['Username', (p) => p.username], ['Nama', (p) => p.nama], ['Role', (p) => p.role], ['Warehouse', (p) => (p.cabang ? namaCabang(p.cabang) : '-')], ['Status', (p) => p.status]],
      fields: [
        { key: 'username', label: 'Username', wajib: true, dari: (p) => p.username },
        { key: 'password', label: 'Password', type: 'password', wajib: (v, isEdit) => !isEdit, catatan: (isEdit) => (isEdit ? 'Kosongkan bila tidak diubah.' : ''), dari: () => '' },
        { key: 'nama', label: 'Nama lengkap', wajib: true, dari: (p) => p.nama },
        { key: 'role', label: 'Role', type: 'select', opsi: () => opsi(ROLE), awal: 'PIC CABANG', dari: (p) => p.role },
        { key: 'cabang', label: 'Warehouse', type: 'select', wajib: (v) => v.role !== 'SUPERADMIN', opsi: cabangOpsi, dari: (p) => p.cabang },
      ],
      simpan: (v, row) => (row ? put('/api/master/pengguna', { ...bodyPengguna(v, true), user_id: row.user_id }) : post('/api/master/pengguna', bodyPengguna(v, false))),
      hapus: (row) => (row.status === 'Aktif'
        ? { label: 'Nonaktifkan', tanya: `Nonaktifkan akun ${row.username}?`, jalan: () => del(`/api/master/pengguna/${encodeURIComponent(row.user_id)}`) }
        : { label: 'Aktifkan', tanya: `Aktifkan kembali akun ${row.username}?`, jalan: () => post(`/api/master/pengguna/${encodeURIComponent(row.user_id)}/activate`, {}) }),
    },
  };
}

async function muat() {
  const d = await get('/api/master');
  return {
    vehicles: d.vehicles || [], drivers: d.drivers || [], cabang: d.cabangList || [],
    bbm: d.bbmList || [], cards: d.flazzCards || [], pengguna: d.penggunaList || [],
  };
}

function kontrol(f, nilai, isEdit, values) {
  let node;
  if (f.type === 'multi') {
    // Kotak centang; .value = kode terpilih dipisah koma (seragam dengan kontrol lain).
    const terpilih = new Set(String(nilai ?? '').split(',').filter(Boolean));
    const kotak = f.opsi(values).map((o) => el('input', { class: 'form-check-input', type: 'checkbox', value: String(o.value), id: `m-${f.key}-${o.value}` }));
    kotak.forEach((k) => { k.checked = terpilih.has(k.value); });
    node = el('div', { class: 'border rounded px-2 py-1', style: 'max-height:9rem;overflow:auto' }, kotak.length
      ? kotak.map((k, i) => el('div', { class: 'form-check' }, [k, el('label', { class: 'form-check-label small', for: k.id, text: f.opsi(values)[i].label })]))
      : [el('div', { class: 'small text-muted', text: 'Pilih warehouse pemilik dulu.' })]);
    Object.defineProperty(node, 'value', { get: () => kotak.filter((k) => k.checked).map((k) => k.value).join(','), set: () => {} });
    return node;
  }
  if (f.type === 'select') {
    node = el('select', { class: 'form-select form-select-sm' });
    node.appendChild(el('option', { value: '', text: '—' }));
    for (const o of f.opsi(values)) node.appendChild(el('option', { value: String(o.value), text: String(o.label) }));
  } else {
    node = el('input', { class: 'form-control form-control-sm', type: f.type || 'text', autocomplete: f.type === 'password' ? 'new-password' : 'off' });
  }
  node.value = String(nilai ?? '');
  if (isEdit && f.kunciSaatEdit) node.disabled = true;
  return node;
}

export async function renderMaster(view) {
  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat data master' }));
  let m;
  try {
    m = await muat();
  } catch (err) {
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }
  let ent = entitas(m);
  const urutan = ['kendaraan', 'cabang', 'supir', 'bbm', 'kartu', 'pengguna'].filter((k) => ent[k].boleh);
  let tab = urutan[0];
  const wh = el('select', { class: 'form-select form-select-sm' });
  wh.appendChild(el('option', { value: '', text: 'Semua warehouse' }));
  for (const c of m.cabang) wh.appendChild(el('option', { value: c.kode, text: c.nama || c.kode }));
  const cari = el('input', { class: 'form-control form-control-sm', placeholder: 'Cari' });
  const formBox = el('div', {});
  const isi = el('div', {});
  const tombol = {};

  const muatUlang = async () => {
    m = await muat();
    ent = entitas(m);
    gambar();
  };

  function bukaForm(row) {
    const e = ent[tab];
    const isEdit = !!row;
    const values = {};
    for (const f of e.fields) values[f.key] = isEdit ? (f.dari(row) ?? '') : (f.awal ?? (!isSuper() && ['cabang', 'branch_id'].includes(f.key) ? getUser()?.cabang || '' : ''));
    const ctl = {};
    const alertBox = el('div', { class: 'alert alert-danger d-none py-2' });
    const grid = el('div', { class: 'row g-2' });
    const render = () => {
      grid.replaceChildren(...e.fields.map((f) => {
        ctl[f.key] = kontrol(f, values[f.key], isEdit, values);
        ctl[f.key].addEventListener('change', () => {
          values[f.key] = ctl[f.key].value;
          // Field yang pilihannya bergantung (mis. kendaraan default per warehouse) digambar ulang.
          if (e.fields.some((x) => x.ikut === f.key)) {
            for (const x of e.fields) if (x.ikut === f.key) values[x.key] = '';
            render();
          }
        });
        ctl[f.key].addEventListener('input', () => { values[f.key] = ctl[f.key].value; });
        const catatan = f.catatan ? f.catatan(isEdit) : '';
        return el('div', { class: 'col-md-4' }, [el('div', { class: 'mb-2' }, [
          el('label', { class: 'form-label small mb-1', text: f.label }), ctl[f.key],
          catatan ? el('div', { class: 'form-text', text: catatan }) : null,
        ])]);
      }));
    };
    render();
    const simpan = el('button', { class: 'btn btn-sm btn-primary', type: 'submit', text: 'Simpan' });
    const form = el('form', { novalidate: 'novalidate', class: 'border rounded p-3 mb-3' }, [
      el('div', { class: 'fw-bold mb-2', text: `${isEdit ? 'Edit' : 'Tambah'} ${e.label}` }),
      alertBox, grid,
      el('div', { class: 'd-flex gap-2 mt-2' }, [simpan, el('button', { class: 'btn btn-sm btn-outline-secondary', type: 'button', text: 'Batal', onclick: () => formBox.replaceChildren() })]),
    ]);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      for (const f of e.fields) values[f.key] = ctl[f.key].value;
      const err = fieldKosong(e.fields, values, isEdit);
      if (err.length) {
        alertBox.textContent = err.join(' ');
        alertBox.classList.remove('d-none');
        return;
      }
      simpan.disabled = true;
      try {
        const res = await e.simpan(values, row);
        toast(res.msg || 'Tersimpan.', 'success');
        formBox.replaceChildren();
        await muatUlang();
      } catch (er) {
        alertBox.textContent = er.message;
        alertBox.classList.remove('d-none');
        simpan.disabled = false;
      }
    });
    formBox.replaceChildren(form);
    form.scrollIntoView({ behavior: 'smooth' });
  }

  async function aksi(a) {
    if (!confirmDialog(a.tanya)) return;
    try {
      const res = await a.jalan();
      toast(res.msg || 'Berhasil.', 'success');
      await muatUlang();
    } catch (er) {
      toast(er.message, 'error');
    }
  }

  function gambar() {
    const e = ent[tab];
    for (const [k, b] of Object.entries(tombol)) b.className = `btn btn-sm ${k === tab ? 'btn-primary' : 'btn-outline-primary'}`;
    const q = cari.value.trim().toLowerCase();
    const rows = e.list().filter((r) => (!wh.value || !e.cabangOf || e.cabangOf(r) === wh.value) &&
      (!q || e.kolom.some(([, fn]) => String(fn(r) ?? '').toLowerCase().includes(q))));
    const body = rows.map((r) => {
      const h = e.hapus(r);
      // Kendaraan bersama milik warehouse lain: PIC hanya memakai, pengelolaan oleh pemilik.
      const bukanMilik = !isSuper() && e.cabangOf && String(e.cabangOf(r)) !== String(getUser()?.cabang || '');
      return el('tr', {}, [
        ...e.kolom.map(([, fn, kelas]) => el('td', { class: kelas ? kelas(r) : '', text: String(fn(r) ?? '-') })),
        bukanMilik ? el('td', { class: 'small text-muted', text: 'Kendaraan bersama (dikelola pemilik)' }) : el('td', { class: 'text-nowrap' }, [
          el('button', { class: 'btn btn-sm btn-outline-primary me-1', type: 'button', text: 'Edit', onclick: () => bukaForm(r) }),
          ...(e.ekstra ? e.ekstra(r).map((x) => el('button', { class: 'btn btn-sm btn-outline-secondary me-1', type: 'button', text: x.label, onclick: () => aksi(x) })) : []),
          el('button', { class: 'btn btn-sm btn-outline-danger', type: 'button', text: h.label || 'Hapus', onclick: () => aksi(h) }),
        ]),
      ]);
    });
    isi.replaceChildren(
      el('div', { class: 'd-flex justify-content-between align-items-center mb-2' }, [
        el('div', { class: 'small text-muted', text: `${rows.length} data` }),
        el('button', { class: 'btn btn-sm btn-success', type: 'button', text: `Tambah ${e.label}`, onclick: () => bukaForm(null) }),
      ]),
      rows.length
        ? el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-sm align-middle' }, [
          el('thead', {}, [el('tr', {}, [...e.kolom.map(([t]) => el('th', { text: t })), el('th', { text: 'Aksi' })])]),
          el('tbody', {}, body),
        ])])
        : el('div', { class: 'text-muted', text: 'Tidak ada data.' }),
    );
  }

  const barTab = el('div', { class: 'd-flex flex-wrap gap-2 mb-3' }, urutan.map((k) => {
    tombol[k] = el('button', { type: 'button', text: ent[k].label, onclick: () => { tab = k; formBox.replaceChildren(); gambar(); } });
    return tombol[k];
  }));
  wh.addEventListener('change', gambar);
  cari.addEventListener('input', gambar);
  view.replaceChildren(el('div', { class: 'panel' }, [
    el('h2', { class: 'h6 mb-3', text: 'Data Master' }),
    barTab,
    el('div', { class: 'row g-2 mb-2' }, [
      isSuper() ? el('div', { class: 'col-md-3' }, [wh]) : null,
      el('div', { class: 'col-md-3' }, [cari]),
    ]),
    formBox,
    isi,
  ]));
  gambar();
  return { ok: true };
}
