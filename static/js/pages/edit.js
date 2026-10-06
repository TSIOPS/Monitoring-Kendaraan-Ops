import { get, put } from '../api.js';
import { getRouteParam } from '../router.js';
import { el, fmtNum, toast, pratinjauFoto } from '../ui.js';
import { kompresGambar, namaAman } from './input.js';

// Edit transaksi lengkap (M11), setara alur edit GAS: tanggal, supir, KM, bar,
// liter, pembayaran (grup 1 & 2), dan foto odometer. Kendaraan tetap terkunci.

// Tanggal tampilan daftar transaksi (DD/MM/YYYY) -> nilai input date (YYYY-MM-DD).
export function tanggalIso(v) {
  const s = String(v ?? '');
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : '';
}

export function validateEdit(v) {
  const err = [];
  if (!v.tanggal) err.push('Tanggal wajib diisi.');
  if (!v.nama_supir) err.push('Supir wajib dipilih.');
  const angka = { 'KM awal': v.km_awal, 'KM akhir': v.km_akhir, 'Bar awal': v.bar_awal, 'Bar akhir': v.bar_akhir, Liter: v.liter_bbm };
  for (const [label, x] of Object.entries(angka)) {
    if (String(x) === '' || !Number.isFinite(Number(x)) || Number(x) < 0) err.push(`${label} harus angka dan tidak boleh negatif.`);
  }
  if (Number(v.km_akhir) < Number(v.km_awal)) err.push('KM akhir tidak boleh lebih kecil dari KM awal.');
  if (v.metode_pembayaran === 'FLAZZ' && !v.flazz_card_id) err.push('Pilih kartu Flazz untuk pembayaran.');
  return err;
}

// Body PUT. KM hanya dikirim bila berubah: server menandai km_sumber = AKTUAL setiap kali
// KM dikirim, dan transaksi ESTIMASI tidak boleh berubah diam-diam (spec M11).
export function bodyEdit(trx, v) {
  const body = {
    tanggal: v.tanggal,
    nama_supir: v.nama_supir,
    bar_awal: Number(v.bar_awal),
    bar_akhir: Number(v.bar_akhir),
    liter_bbm: Number(v.liter_bbm),
    metode_pembayaran: v.metode_pembayaran,
    biaya_bbm: v.biaya_bbm,
    biaya_toll: v.biaya_toll,
    flazz_card_id: v.flazz_card_id,
    metode_toll: v.metode_toll,
    flazz_card_id_toll: v.flazz_card_id_toll,
    flazz_card_id_2: v.flazz_card_id_2,
    biaya_bbm_2: v.biaya_bbm_2 === '' ? 0 : v.biaya_bbm_2,
    flazz_card_id_toll_2: v.flazz_card_id_toll_2,
    biaya_toll_2: v.biaya_toll_2 === '' ? 0 : v.biaya_toll_2,
  };
  if (Number(v.km_awal) !== Number(trx.km_awal) || Number(v.km_akhir) !== Number(trx.km_akhir)) {
    body.km_awal = Number(v.km_awal);
    body.km_akhir = Number(v.km_akhir);
  }
  return body;
}

function opsiKartu(cards) {
  return cards.map((c) => ({
    value: c.id || c.card_id,
    label: `${c.card_name || c.card_number || c.id} (saldo ${fmtNum(c.last_balance || 0)})`,
  }));
}

function isiOpsi(select, items, placeholder) {
  select.replaceChildren(el('option', { value: '', text: placeholder }));
  for (const it of items) {
    select.appendChild(el('option', { value: String(it.value), text: String(it.label) }));
  }
}

// Nilai lama yang tidak ada di daftar (kartu nonaktif, supir pindah cabang) tetap ditampilkan.
function pilihNilai(select, value, label) {
  const id = String(value || '');
  if (id && !Array.from(select.options).some((o) => o.value === id)) {
    select.appendChild(el('option', { value: id, text: label || `${id} (tidak ada di daftar)` }));
  }
  select.value = id;
}

export async function renderEdit(view) {
  const id = getRouteParam('id');
  if (!id) {
    window.location.hash = '#/history';
    return { ok: false };
  }

  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat transaksi' }));

  // Diambil per id agar transaksi lama (di luar 200 terbaru daftar) tetap bisa diedit.
  let trx;
  let master;
  try {
    [{ transaksi: trx }, master] = await Promise.all([get(`/api/laporan/${encodeURIComponent(id)}`), get('/api/master')]);
  } catch (err) {
    const pesan = err.status === 404 ? 'Transaksi tidak ditemukan. Mungkin sudah dihapus.' : err.message;
    view.replaceChildren(el('div', { class: `alert ${err.status === 404 ? 'alert-warning' : 'alert-danger'}`, text: pesan }));
    return { ok: false };
  }

  const cards = Array.isArray(master.flazzCards) ? master.flazzCards : [];
  const kendaraan = (master.vehicles || []).find((v) => v.vehicle_id === trx.vehicle_id);
  const jarum = String(kendaraan?.jenis_indikator) === 'ANALOG_JARUM';
  const angka = (value, attrs = {}) => el('input', { class: 'form-control', type: 'number', min: '0', value: String(value ?? ''), ...attrs });

  const tanggal = el('input', { class: 'form-control', type: 'date', value: tanggalIso(trx.tanggal) });
  const supir = el('select', { class: 'form-select' });
  isiOpsi(supir, (master.drivers || []).filter((d) => !trx.kode_cabang || d.cabang === trx.kode_cabang).map((d) => ({ value: d.nama, label: d.nama })), '— pilih supir —');
  pilihNilai(supir, trx.supir === '-' ? '' : trx.supir, trx.supir);
  const kmAwal = angka(trx.km_awal);
  const kmAkhir = angka(trx.km_akhir);
  const barAwal = angka(jarum ? 100 : trx.bar_awal, jarum ? { disabled: 'disabled' } : {});
  const barAkhir = angka(jarum ? 100 : trx.bar_akhir, jarum ? { disabled: 'disabled' } : {});
  const liter = angka(trx.isi_bbm, { step: '0.01' });
  const fotoAwal = el('input', { type: 'file', accept: 'image/*', class: 'form-control' });
  const fotoAkhir = el('input', { type: 'file', accept: 'image/*', class: 'form-control' });

  const metode = el('select', { class: 'form-select' }, [
    el('option', { value: 'TUNAI', text: 'Tunai' }),
    el('option', { value: 'FLAZZ', text: 'Flazz' }),
  ]);
  metode.value = trx.metode_pembayaran || 'TUNAI';
  const kartu = el('select', { class: 'form-select' });
  isiOpsi(kartu, opsiKartu(cards), '— tidak ada —');
  pilihNilai(kartu, trx.flazz_card_id);
  const biayaBbm = angka(trx.biaya_bbm ?? 0);
  const biayaTol = angka(trx.toll ?? 0);
  const metodeTol = el('select', { class: 'form-select' }, [
    el('option', { value: '', text: 'Sama seperti pembayaran BBM' }),
    el('option', { value: 'TUNAI', text: 'Tunai' }),
    el('option', { value: 'FLAZZ', text: 'Flazz' }),
  ]);
  metodeTol.value = trx.metode_toll || '';
  const kartuTol = el('select', { class: 'form-select' });
  isiOpsi(kartuTol, opsiKartu(cards), '— tidak ada —');
  pilihNilai(kartuTol, trx.flazz_card_id_toll);

  // Grup-2 (kartu kedua): kartu kosong berarti nominalnya dicatat tunai.
  const biayaBbm2 = angka(trx.biaya_bbm_2 || '');
  const kartu2 = el('select', { class: 'form-select' });
  isiOpsi(kartu2, opsiKartu(cards), 'Tanpa kartu (tunai)');
  pilihNilai(kartu2, trx.flazz_card_id_2);
  const biayaTol2 = angka(trx.biaya_toll_2 || '');
  const kartuTol2 = el('select', { class: 'form-select' });
  isiOpsi(kartuTol2, opsiKartu(cards), 'Tanpa kartu (tunai)');
  pilihNilai(kartuTol2, trx.flazz_card_id_toll_2);

  const alertBox = el('div', { class: 'alert alert-danger d-none' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Simpan Perubahan' });
  const baris = (label, kontrol, catatan = '') =>
    el('div', { class: 'mb-3' }, [
      el('label', { class: 'form-label', text: label }),
      kontrol,
      catatan ? el('div', { class: 'form-text', text: catatan }) : null,
    ]);
  const kol = (n, ...isi) => el('div', { class: `col-md-${n}` }, isi);

  const form = el('form', { novalidate: 'novalidate' }, [
    alertBox,
    el('div', { class: 'row' }, [
      kol(4, baris('Kendaraan (tidak dapat diubah)', el('input', { class: 'form-control', value: trx.vehicle || '-', disabled: 'disabled' }))),
      kol(4, baris('Tanggal', tanggal)),
      kol(4, baris('Supir', supir, trx.supir_2 ? `Driver 2: ${trx.supir_2} (mengikuti jalur). Mengubah tanggal atau supir memindahkan tautan jalur pengiriman.` : 'Mengubah tanggal atau supir memindahkan tautan jalur pengiriman.')),
    ]),
    el('div', { class: 'row' }, [
      kol(3, baris('KM awal', kmAwal)),
      kol(3, baris('KM akhir', kmAkhir, trx.km_sumber === 'ESTIMASI' ? 'KM saat ini hasil estimasi; mengubah KM menjadikannya aktual.' : '')),
      kol(2, baris('Bar awal', barAwal)),
      kol(2, baris('Bar akhir', barAkhir)),
      kol(2, baris('Liter BBM', liter)),
    ]),
    el('div', { class: 'row' }, [
      kol(6, baris('Foto odometer awal', el('div', {}, [fotoAwal, pratinjauFoto(fotoAwal, trx.foto_odo_awal || trx.foto_odo_awal_thumb)]), 'Kosongkan bila tidak diganti.')),
      kol(6, baris('Foto odometer akhir', el('div', {}, [fotoAkhir, pratinjauFoto(fotoAkhir, trx.foto_odo_akhir || trx.foto_odo_akhir_thumb)]), 'Kosongkan bila tidak diganti.')),
    ]),
    el('h3', { class: 'h6 mt-2', text: 'Pembayaran' }),
    el('div', { class: 'row' }, [
      kol(4, baris('Biaya BBM', biayaBbm)),
      kol(4, baris('Metode pembayaran', metode)),
      kol(4, baris('Kartu Flazz (BBM)', kartu)),
    ]),
    el('div', { class: 'row' }, [
      kol(4, baris('Biaya tol', biayaTol)),
      kol(4, baris('Metode tol', metodeTol)),
      kol(4, baris('Kartu Flazz (tol)', kartuTol)),
    ]),
    el('h3', { class: 'h6 mt-2', text: 'Kartu ke-2 (opsional)' }),
    el('div', { class: 'form-text mb-2', text: 'Isi bila laporan memakai 2 kartu. Nominal tanpa kartu dihitung sebagai tunai.' }),
    el('div', { class: 'row' }, [
      kol(3, baris('Biaya BBM (kartu 2)', biayaBbm2)),
      kol(3, baris('Kartu Flazz BBM (kartu 2)', kartu2)),
      kol(3, baris('Biaya tol (kartu 2)', biayaTol2)),
      kol(3, baris('Kartu Flazz tol (kartu 2)', kartuTol2)),
    ]),
    el('div', { class: 'd-flex gap-2' }, [
      submit,
      el('a', { class: 'btn btn-outline-secondary', href: '#/history', text: 'Batal' }),
    ]),
  ]);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('d-none');
    const values = {
      tanggal: tanggal.value, nama_supir: supir.value, km_awal: kmAwal.value, km_akhir: kmAkhir.value,
      bar_awal: barAwal.value, bar_akhir: barAkhir.value, liter_bbm: liter.value,
      metode_pembayaran: metode.value, biaya_bbm: biayaBbm.value, biaya_toll: biayaTol.value, flazz_card_id: kartu.value,
      metode_toll: metodeTol.value, flazz_card_id_toll: kartuTol.value,
      flazz_card_id_2: kartu2.value, biaya_bbm_2: biayaBbm2.value, flazz_card_id_toll_2: kartuTol2.value, biaya_toll_2: biayaTol2.value,
    };
    const err = validateEdit(values);
    if (err.length) {
      alertBox.textContent = err.join(' ');
      alertBox.classList.remove('d-none');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Menyimpan';
    try {
      const body = bodyEdit(trx, values);
      if (fotoAwal.files && fotoAwal.files[0]) {
        body.foto_odo_awal = await kompresGambar(fotoAwal.files[0]);
        body.foto_odo_awal_name = namaAman(fotoAwal.files[0].name);
      }
      if (fotoAkhir.files && fotoAkhir.files[0]) {
        body.foto_odo_akhir = await kompresGambar(fotoAkhir.files[0]);
        body.foto_odo_akhir_name = namaAman(fotoAkhir.files[0].name);
      }
      const res = await put(`/api/laporan/${encodeURIComponent(id)}`, body);
      toast(res.msg || 'Transaksi diperbarui.', 'success');
      window.location.hash = '#/history';
    } catch (e) {
      alertBox.textContent = e.message || 'Gagal memperbarui transaksi.';
      alertBox.classList.remove('d-none');
      submit.disabled = false;
      submit.textContent = 'Simpan Perubahan';
    }
  });

  view.replaceChildren(el('div', { class: 'panel' }, [el('h2', { class: 'h6 mb-3', text: 'Edit Transaksi' }), form]));
  return { ok: true };
}
