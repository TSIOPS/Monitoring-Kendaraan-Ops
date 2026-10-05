import { get, post } from '../api.js';
import { el, fmtNum, toast } from '../ui.js';

const MAKS_LEBAR = 1600;
const KUALITAS_JPEG = 0.8;

export function validateForm(v) {
  const err = [];
  if (!v.vehicle_id) err.push('Kendaraan wajib dipilih.');
  if (!v.tanggal) err.push('Tanggal wajib diisi.');
  if (!v.nama_supir) err.push('Nama supir wajib diisi.');

  const kmAwal = Number(v.km_awal);
  const kmAkhir = Number(v.km_akhir);
  if (v.km_awal === '' || v.km_akhir === '') {
    err.push('KM awal dan akhir wajib diisi.');
  } else if (!Number.isFinite(kmAwal) || !Number.isFinite(kmAkhir)) {
    err.push('KM awal dan akhir harus berupa angka.');
  }

  const liter = Number(v.liter_bbm);
  if (v.liter_bbm !== '' && (!Number.isFinite(liter) || liter < 0)) {
    err.push('Liter harus angka dan tidak boleh negatif.');
  }

  const biaya = Number(v.biaya_bbm);
  if (v.biaya_bbm !== '' && (!Number.isFinite(biaya) || biaya < 0)) {
    err.push('Biaya BBM harus angka dan tidak boleh negatif.');
  }

  if (v.metode_pembayaran === 'FLAZZ' && !v.flazz_card_id) {
    err.push('Pilih kartu Flazz untuk pembayaran.');
  }
  if (v.metode_toll === 'FLAZZ' && !v.flazz_card_id_toll) {
    err.push('Pilih kartu Flazz untuk tol.');
  }
  return err;
}

export function buildPayload(v, serverData) {
  return {
    vehicle_id: v.vehicle_id,
    tanggal: v.tanggal,
    nama_supir: v.nama_supir,
    km_awal_confirmed: String(v.km_awal),
    km_akhir_confirmed: String(v.km_akhir),
    km_awal_broken: Boolean(v.km_awal_broken),
    km_akhir_broken: Boolean(v.km_akhir_broken),
    km_tanpa_estimasi: Boolean(v.km_tanpa_estimasi),
    bar_awal: String(v.bar_awal),
    bar_akhir: String(v.bar_akhir),
    liter_bbm: Number(v.liter_bbm || 0),
    biaya_bbm: Number(v.biaya_bbm || 0),
    biaya_toll: Number(v.biaya_toll || 0),
    metode_pembayaran: v.metode_pembayaran,
    flazz_card_id: v.flazz_card_id,
    metode_toll: v.metode_toll,
    flazz_card_id_toll: v.flazz_card_id_toll,
    serverData,
  };
}

// Locale en-CA memformat tanggal sebagai YYYY-MM-DD, sesuai nilai <input type="date">.
const FORMAT_WIB = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jakarta',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export function tanggalWib(d = new Date()) {
  return FORMAT_WIB.format(d);
}

function kompresGambar(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File tidak dapat dibaca.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Foto tidak valid.'));
      img.onload = () => {
        const skala = img.width > MAKS_LEBAR ? MAKS_LEBAR / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * skala);
        canvas.height = Math.round(img.height * skala);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Browser tidak mendukung kompresi foto.'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', KUALITAS_JPEG));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

function namaAman(name) {
  return String(name || 'foto.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isiOpsi(select, items, placeholder) {
  select.replaceChildren(el('option', { value: '', text: placeholder }));
  for (const it of items) {
    select.appendChild(el('option', { value: String(it.value), text: String(it.label) }));
  }
}

function opsiKendaraan(vehicles) {
  return vehicles.map((v) => ({ value: v.vehicle_id, label: `${v.plat_nomor} — ${v.nama}` }));
}

function opsiKartu(cards) {
  return cards.map((c) => ({
    value: c.id || c.card_id,
    label: `${c.card_name || c.card_number || c.id} (saldo ${fmtNum(c.last_balance || 0)})`,
  }));
}

export async function renderInput(view) {
  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat data master' }));

  let master;
  try {
    master = await get('/api/master');
  } catch (err) {
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }

  const vehicles = Array.isArray(master.vehicles) ? master.vehicles : [];
  const cards = Array.isArray(master.flazzCards) ? master.flazzCards : [];
  const drivers = Array.isArray(master.drivers) ? master.drivers : [];

  const f = {
    vehicle_id: el('select', { class: 'form-select', id: 'f-vehicle' }),
    tanggal: el('input', { class: 'form-control', type: 'date', id: 'f-tanggal' }),
    nama_supir: el('input', { class: 'form-control', id: 'f-supir', list: 'f-supir-list', autocomplete: 'off' }),
    km_awal: el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', id: 'f-km-awal' }),
    km_akhir: el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', id: 'f-km-akhir' }),
    km_awal_broken: el('input', { class: 'form-check-input', type: 'checkbox', id: 'f-km-awal-broken' }),
    km_akhir_broken: el('input', { class: 'form-check-input', type: 'checkbox', id: 'f-km-akhir-broken' }),
    bar_awal: el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', id: 'f-bar-awal' }),
    bar_akhir: el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', id: 'f-bar-akhir' }),
    liter_bbm: el('input', { class: 'form-control', type: 'number', step: '0.01', id: 'f-liter' }),
    biaya_bbm: el('input', { class: 'form-control', type: 'number', id: 'f-biaya-bbm' }),
    metode_pembayaran: el('select', { class: 'form-select', id: 'f-metode' }, [
      el('option', { value: 'TUNAI', text: 'Tunai' }),
      el('option', { value: 'FLAZZ', text: 'Flazz' }),
    ]),
    flazz_card_id: el('select', { class: 'form-select', id: 'f-kartu' }),
    biaya_toll: el('input', { class: 'form-control', type: 'number', id: 'f-biaya-tol' }),
    metode_toll: el('select', { class: 'form-select', id: 'f-metode-tol' }, [
      el('option', { value: '', text: 'Sama dengan pembayaran BBM' }),
      el('option', { value: 'TUNAI', text: 'Tunai' }),
      el('option', { value: 'FLAZZ', text: 'Flazz' }),
    ]),
    flazz_card_id_toll: el('select', { class: 'form-select', id: 'f-kartu-tol' }),
  };

  isiOpsi(f.vehicle_id, opsiKendaraan(vehicles), '— pilih kendaraan —');
  isiOpsi(f.flazz_card_id, opsiKartu(cards), '— tidak ada —');
  isiOpsi(f.flazz_card_id_toll, opsiKartu(cards), '— tidak ada —');

  // Server mencocokkan nama supir dengan jalur secara persis; datalist mengurangi salah ketik.
  const supirList = el(
    'datalist',
    { id: 'f-supir-list' },
    drivers.map((d) => el('option', { value: String(d.nama ?? '') })),
  );

  const serverData = { files: { odo_awal: '', odo_akhir: '' }, km_awal: '', km_akhir: '' };
  const alertBox = el('div', { class: 'alert alert-danger d-none' });
  const fotoAwal = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'form-control' });
  const fotoAkhir = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'form-control' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Simpan Laporan' });

  f.tanggal.value = tanggalWib();

  const baris = (label, kontrol, catatan = '') =>
    el('div', { class: 'mb-3' }, [
      el('label', { class: 'form-label', text: label }),
      kontrol,
      catatan ? el('div', { class: 'form-text', text: catatan }) : null,
    ]);

  const form = el('form', { novalidate: 'novalidate' }, [
    alertBox,
    el('div', { class: 'row' }, [
      el('div', { class: 'col-md-6' }, [baris('Kendaraan', f.vehicle_id)]),
      el('div', { class: 'col-md-3' }, [baris('Tanggal', f.tanggal)]),
      el('div', { class: 'col-md-3' }, [baris('Supir', f.nama_supir), supirList]),
    ]),
    el('div', { class: 'row' }, [
      el('div', { class: 'col-md-4' }, [
        baris('KM awal', f.km_awal),
        el('div', { class: 'form-check mb-2' }, [
          f.km_awal_broken,
          el('label', { class: 'form-check-label', for: 'f-km-awal-broken', text: 'Meter awal mati/rusak' }),
        ]),
      ]),
      el('div', { class: 'col-md-4' }, [
        baris('KM akhir', f.km_akhir),
        el('div', { class: 'form-check mb-2' }, [
          f.km_akhir_broken,
          el('label', { class: 'form-check-label', for: 'f-km-akhir-broken', text: 'Meter akhir mati/rusak' }),
        ]),
      ]),
      el('div', { class: 'col-md-2' }, [baris('Bar awal', f.bar_awal)]),
      el('div', { class: 'col-md-2' }, [baris('Bar akhir', f.bar_akhir)]),
    ]),
    el('div', { class: 'row' }, [
      el('div', { class: 'col-md-4' }, [baris('Liter BBM', f.liter_bbm)]),
      el('div', { class: 'col-md-4' }, [baris('Biaya BBM', f.biaya_bbm)]),
      el('div', { class: 'col-md-4' }, [baris('Metode pembayaran', f.metode_pembayaran)]),
    ]),
    el('div', { class: 'row' }, [el('div', { class: 'col-md-4' }, [baris('Kartu Flazz (BBM)', f.flazz_card_id)])]),
    el('div', { class: 'row' }, [
      el('div', { class: 'col-md-4' }, [baris('Biaya tol', f.biaya_toll, 'Kosongkan bila tidak ada tol')]),
      el('div', { class: 'col-md-4' }, [baris('Metode tol', f.metode_toll)]),
      el('div', { class: 'col-md-4' }, [baris('Kartu Flazz (tol)', f.flazz_card_id_toll)]),
    ]),
    el('div', { class: 'row' }, [
      el('div', { class: 'col-md-6' }, [baris('Foto odometer awal', fotoAwal)]),
      el('div', { class: 'col-md-6' }, [baris('Foto odometer akhir', fotoAkhir)]),
    ]),
    submit,
  ]);

  f.vehicle_id.addEventListener('change', async () => {
    if (!f.vehicle_id.value) return;

    const terpilih = vehicles.find((v) => String(v.vehicle_id) === f.vehicle_id.value);
    if (terpilih && String(terpilih.jenis_indikator) === 'ANALOG_JARUM') {
      f.bar_awal.value = '100';
      f.bar_akhir.value = '100';
      f.bar_awal.disabled = true;
      f.bar_akhir.disabled = true;
    } else {
      f.bar_awal.disabled = false;
      f.bar_akhir.disabled = false;
    }

    try {
      const data = await get('/api/laporan/prefill');
      const pref = data.pref;
      if (!pref || String(pref.vehicle_id) !== f.vehicle_id.value) return;
      f.tanggal.value = pref.tanggal || f.tanggal.value;
      f.nama_supir.value = pref.nama_supir || '';
      if (!f.bar_awal.disabled) {
        f.bar_awal.value = pref.bar_awal || '';
        f.bar_akhir.value = pref.bar_akhir || '';
      }
      f.liter_bbm.value = String(pref.liter_bbm ?? '');
      f.biaya_bbm.value = String(pref.biaya_bbm ?? '');
      f.metode_pembayaran.value = pref.metode_pembayaran || 'TUNAI';
      f.flazz_card_id.value = pref.flazz_card_id || '';
      f.metode_toll.value = pref.metode_toll || '';
      f.flazz_card_id_toll.value = pref.flazz_card_id_toll || '';
    } catch (err) {
      toast(err.message, 'error');
    }
  });

  let fotoSudahTerunggah = false;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('d-none');

    const values = {
      vehicle_id: f.vehicle_id.value,
      tanggal: f.tanggal.value,
      nama_supir: f.nama_supir.value.trim(),
      km_awal: f.km_awal.value,
      km_akhir: f.km_akhir.value,
      km_awal_broken: f.km_awal_broken.checked,
      km_akhir_broken: f.km_akhir_broken.checked,
      km_tanpa_estimasi: false,
      bar_awal: f.bar_awal.value,
      bar_akhir: f.bar_akhir.value,
      liter_bbm: f.liter_bbm.value,
      biaya_bbm: f.biaya_bbm.value,
      biaya_toll: f.biaya_toll.value,
      metode_pembayaran: f.metode_pembayaran.value,
      flazz_card_id: f.flazz_card_id.value,
      metode_toll: f.metode_toll.value,
      flazz_card_id_toll: f.flazz_card_id_toll.value,
    };

    const err = validateForm(values);
    if (err.length) {
      alertBox.textContent = err.join(' ');
      alertBox.classList.remove('d-none');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Menyimpan';

    try {
      if (!fotoSudahTerunggah) {
        const fotoBody = {};
        if (fotoAwal.files && fotoAwal.files[0]) {
          fotoBody.foto_odo_awal = await kompresGambar(fotoAwal.files[0]);
          fotoBody.foto_odo_awal_name = namaAman(fotoAwal.files[0].name);
        }
        if (fotoAkhir.files && fotoAkhir.files[0]) {
          fotoBody.foto_odo_akhir = await kompresGambar(fotoAkhir.files[0]);
          fotoBody.foto_odo_akhir_name = namaAman(fotoAkhir.files[0].name);
        }

        if (Object.keys(fotoBody).length) {
          fotoBody.km_awal_val = values.km_awal;
          fotoBody.km_akhir_val = values.km_akhir;
          const up = await post('/api/laporan/photos', fotoBody);
          serverData.files.odo_awal = up.files?.odo_awal || '';
          serverData.files.odo_akhir = up.files?.odo_akhir || '';
          serverData.km_awal = String(up.km_awal ?? '');
          serverData.km_akhir = String(up.km_akhir ?? '');
          fotoSudahTerunggah = true;
          fotoAwal.disabled = true;
          fotoAkhir.disabled = true;
          fotoAwal.closest('.mb-3').classList.add('text-muted');
          fotoAkhir.closest('.mb-3').classList.add('text-muted');
        }
      }

      await post('/api/laporan', buildPayload(values, serverData));
      toast('Laporan tersimpan.', 'success');
      window.location.hash = '#/transaksi';
    } catch (err) {
      alertBox.textContent = err.message || 'Gagal menyimpan laporan.';
      alertBox.classList.remove('d-none');
      submit.disabled = false;
      submit.textContent = 'Simpan Laporan';
    }
  });

  view.replaceChildren(el('div', { class: 'panel' }, [el('h2', { class: 'h6 mb-3', text: 'Input Laporan Harian' }), form]));
  return { ok: true };
}
