import { get, post } from '../api.js';
import { el, fmtNum, pratinjauFoto, toast } from '../ui.js';

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

  // Liter dihitung dari biaya / harga jenis BBM (seperti calcLiter GAS); tanpa jenis, liter kosong.
  const biayaTotal = Number(v.biaya_bbm || 0) + Number(v.biaya_bbm_2 || 0);
  if (v.harga_bbm !== undefined && biayaTotal > 0 && !(Number(v.harga_bbm) > 0)) {
    err.push('Pilih jenis BBM agar liter terhitung.');
  }

  if (v.metode_pembayaran === 'FLAZZ' && !v.flazz_card_id) {
    err.push('Pilih kartu Flazz untuk pembayaran.');
  }
  if (v.metode_toll === 'FLAZZ' && !v.flazz_card_id_toll) {
    err.push('Pilih kartu Flazz untuk tol.');
  }

  // Grup-2: kartu boleh kosong (nominal dicatat tunai); hanya nominal yang dicek.
  const nominal2 = [v.biaya_bbm_2, v.biaya_toll_2].filter((x) => x !== undefined && x !== '');
  if (nominal2.some((x) => !Number.isFinite(Number(x)) || Number(x) < 0)) {
    err.push('Nominal kartu ke-2 harus angka dan tidak boleh negatif.');
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
    flazz_card_id_2: v.flazz_card_id_2 || '',
    biaya_bbm_2: Number(v.biaya_bbm_2 || 0),
    flazz_card_id_toll_2: v.flazz_card_id_toll_2 || '',
    biaya_toll_2: Number(v.biaya_toll_2 || 0),
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

export function kompresGambar(file) {
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

export function namaAman(name) {
  return String(name || 'foto.jpg').replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isiOpsi(select, items, placeholder) {
  select.replaceChildren(el('option', { value: '', text: placeholder }));
  for (const it of items) {
    select.appendChild(el('option', { value: String(it.value), text: String(it.label) }));
  }
}

export function opsiSupirJalur(list) {
  return list.map((d, i) => ({
    value: String(i),
    label: d.plat_nomor ? `${d.nama_driver} — ${d.plat_nomor}` : d.nama_driver,
  }));
}

export function hitungLiter(biaya, harga) {
  const b = Number(biaya) || 0;
  const h = Number(harga) || 0;
  return b > 0 && h > 0 ? (b / h).toFixed(2) : '';
}

// Payload master SUPERADMIN memakai {id, jenis, harga}; PIC memakai {bbm_id, jenis_bbm, harga_per_liter}.
export function opsiBbm(list) {
  return (list || []).map((b) => {
    const harga = Number(b.harga ?? b.harga_per_liter) || 0;
    return { value: String(b.id ?? b.bbm_id), harga, label: `${b.jenis ?? b.jenis_bbm} — Rp ${fmtNum(harga)}/L` };
  });
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
  const bbmOpsi = opsiBbm(Array.isArray(master.bbmList) ? master.bbmList : []);

  const f = {
    vehicle_id: el('select', { class: 'form-select', id: 'f-vehicle' }),
    tanggal: el('input', { class: 'form-control', type: 'date', id: 'f-tanggal' }),
    nama_supir: el('select', { class: 'form-select', id: 'f-supir' }),
    nama_supir_2: el('input', { class: 'form-control bg-light', id: 'f-supir-2', readonly: 'readonly', tabindex: '-1', placeholder: 'tidak ada' }),
    km_awal: el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', id: 'f-km-awal' }),
    km_akhir: el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', id: 'f-km-akhir' }),
    km_awal_broken: el('input', { class: 'form-check-input', type: 'checkbox', id: 'f-km-awal-broken' }),
    km_akhir_broken: el('input', { class: 'form-check-input', type: 'checkbox', id: 'f-km-akhir-broken' }),
    bar_awal: el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', id: 'f-bar-awal' }),
    bar_akhir: el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', id: 'f-bar-akhir' }),
    jenis_bbm: el('select', { class: 'form-select', id: 'f-jenis-bbm' }),
    liter_bbm: el('input', { class: 'form-control bg-light', type: 'number', step: '0.01', id: 'f-liter', readonly: 'readonly', tabindex: '-1' }),
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
    biaya_bbm_2: el('input', { class: 'form-control', type: 'number', min: '0', id: 'f-biaya-bbm-2' }),
    flazz_card_id_2: el('select', { class: 'form-select', id: 'f-kartu-2' }),
    biaya_toll_2: el('input', { class: 'form-control', type: 'number', min: '0', id: 'f-biaya-tol-2' }),
    flazz_card_id_toll_2: el('select', { class: 'form-select', id: 'f-kartu-tol-2' }),
  };

  isiOpsi(f.vehicle_id, opsiKendaraan(vehicles), '— pilih kendaraan —');
  isiOpsi(f.jenis_bbm, bbmOpsi, '— pilih jenis BBM —');
  if (bbmOpsi.length === 1) f.jenis_bbm.value = bbmOpsi[0].value;
  const hargaBbm = () => bbmOpsi.find((o) => o.value === f.jenis_bbm.value)?.harga || 0;
  const hitungUlangLiter = () => {
    f.liter_bbm.value = hitungLiter(Number(f.biaya_bbm.value || 0) + Number(f.biaya_bbm_2.value || 0), hargaBbm());
  };
  f.jenis_bbm.addEventListener('change', hitungUlangLiter);
  f.biaya_bbm.addEventListener('input', hitungUlangLiter);
  f.biaya_bbm_2.addEventListener('input', hitungUlangLiter);
  isiOpsi(f.flazz_card_id, opsiKartu(cards), '— tidak ada —');
  isiOpsi(f.flazz_card_id_toll, opsiKartu(cards), '— tidak ada —');
  isiOpsi(f.flazz_card_id_2, opsiKartu(cards), 'Tanpa kartu (tunai)');
  isiOpsi(f.flazz_card_id_toll_2, opsiKartu(cards), 'Tanpa kartu (tunai)');

  // Supir hanya dari jalur BELUM_DIISI pada tanggal terpilih (seperti GAS, spec M8 D4).
  let jalurDrivers = [];
  const infoJalur = el('div', { class: 'form-text' });

  const serverData = { files: { odo_awal: '', odo_akhir: '' }, km_awal: '', km_akhir: '' };
  const alertBox = el('div', { class: 'alert alert-danger d-none' });
  const fotoAwal = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'form-control' });
  const fotoAkhir = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'form-control' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Simpan Laporan' });
  const batal = el('button', { class: 'btn btn-outline-secondary', type: 'button', text: 'Batal' });
  let formDiubah = false;

  f.tanggal.value = tanggalWib();

  const baris = (label, kontrol, catatan = '') =>
    el('div', { class: 'mb-3' }, [
      el('label', { class: 'form-label', text: label }),
      kontrol,
      catatan ? el('div', { class: 'form-text', text: catatan }) : null,
    ]);

  // Pengeluaran kartu ke-2 (opsional), seperti di GAS: tersembunyi sampai dibuka.
  const grup2Wrap = el('div', { class: 'form-section d-none' }, [
    el('div', { class: 'form-section-title', text: 'Pengeluaran kartu ke-2' }),
    el('div', { class: 'form-text mb-2', text: 'Dipakai saat satu kartu tidak cukup. Bila nominal diisi tanpa kartu, biaya itu dicatat sebagai tunai.' }),
    el('div', { class: 'row' }, [
      el('div', { class: 'col-md-3' }, [baris('Nominal BBM (kartu 2)', f.biaya_bbm_2)]),
      el('div', { class: 'col-md-3' }, [baris('Kartu Flazz BBM (kartu 2)', f.flazz_card_id_2)]),
      el('div', { class: 'col-md-3' }, [baris('Nominal tol (kartu 2)', f.biaya_toll_2)]),
      el('div', { class: 'col-md-3' }, [baris('Kartu Flazz tol (kartu 2)', f.flazz_card_id_toll_2)]),
    ]),
  ]);
  const grup2Toggle = el('button', { type: 'button', class: 'btn btn-outline-secondary btn-tambah-kartu w-100 mb-3', text: '+ Tambah pengeluaran dengan kartu ke-2' });
  const bukaGrup2 = () => {
    grup2Wrap.classList.remove('d-none');
    grup2Toggle.classList.add('d-none');
  };
  grup2Toggle.addEventListener('click', bukaGrup2);

  // Input dengan satuan (Rp / KM / L) di sisi kiri/kanan.
  const satuan = (kontrol, kiri, kanan) => el('div', { class: 'input-group' }, [
    kiri ? el('span', { class: 'input-group-text', text: kiri }) : null,
    kontrol,
    kanan ? el('span', { class: 'input-group-text', text: kanan }) : null,
  ]);
  const seksi = (judul, isi) => el('div', { class: 'form-section' }, [el('div', { class: 'form-section-title', text: judul }), ...isi]);
  const meterRusak = (cek, id, teks) => el('div', { class: 'form-check mb-3' }, [cek, el('label', { class: 'form-check-label', for: id, text: teks })]);
  f.biaya_toll.placeholder = 'Kosongkan bila tidak ada tol';
  f.biaya_bbm.placeholder = '0';
  f.liter_bbm.placeholder = 'otomatis';

  const form = el('form', { novalidate: 'novalidate' }, [
    alertBox,
    seksi('Kendaraan & Supir', [
      el('div', { class: 'row' }, [
        el('div', { class: 'col-md-6' }, [baris('Kendaraan', f.vehicle_id)]),
        el('div', { class: 'col-md-3' }, [baris('Tanggal', f.tanggal)]),
        el('div', { class: 'col-md-3' }, [baris('Supir', f.nama_supir), infoJalur]),
      ]),
      el('div', { class: 'row' }, [
        el('div', { class: 'col-md-6 offset-md-6' }, [baris('Driver 2', f.nama_supir_2, 'Otomatis dari jalur pengiriman.')]),
      ]),
    ]),
    seksi('Odometer & Bensin', [
      el('div', { class: 'row' }, [
        el('div', { class: 'col-md-4' }, [
          baris('Foto odometer awal', el('div', {}, [fotoAwal, pratinjauFoto(fotoAwal)])),
          baris('KM awal', satuan(f.km_awal, '', 'KM')),
          meterRusak(f.km_awal_broken, 'f-km-awal-broken', 'Meter awal mati/rusak'),
        ]),
        el('div', { class: 'col-md-4' }, [
          baris('Foto odometer akhir', el('div', {}, [fotoAkhir, pratinjauFoto(fotoAkhir)])),
          baris('KM akhir', satuan(f.km_akhir, '', 'KM')),
          meterRusak(f.km_akhir_broken, 'f-km-akhir-broken', 'Meter akhir mati/rusak'),
        ]),
        el('div', { class: 'col-md-4' }, [
          el('div', { class: 'form-subtitle', text: 'Indikator bensin' }),
          baris('Bar awal', f.bar_awal),
          baris('Bar akhir', f.bar_akhir),
        ]),
      ]),
    ]),
    seksi('Pembelian BBM', [
      el('div', { class: 'row' }, [
        el('div', { class: 'col-md-3' }, [baris('Jenis BBM', f.jenis_bbm)]),
        el('div', { class: 'col-md-3' }, [baris('Biaya BBM', satuan(f.biaya_bbm, 'Rp'))]),
        el('div', { class: 'col-md-3' }, [baris('Liter BBM', satuan(f.liter_bbm, '', 'L'), 'Otomatis: biaya ÷ harga per liter')]),
        el('div', { class: 'col-md-3' }, [baris('Metode pembayaran', f.metode_pembayaran)]),
      ]),
      el('div', { class: 'row' }, [el('div', { class: 'col-md-6' }, [baris('Kartu Flazz (BBM)', f.flazz_card_id)])]),
    ]),
    seksi('Tol', [
      el('div', { class: 'row' }, [
        el('div', { class: 'col-md-4' }, [baris('Biaya tol', satuan(f.biaya_toll, 'Rp'))]),
        el('div', { class: 'col-md-4' }, [baris('Metode tol', f.metode_toll)]),
        el('div', { class: 'col-md-4' }, [baris('Kartu Flazz (tol)', f.flazz_card_id_toll)]),
      ]),
    ]),
    el('div', {}, [grup2Toggle]),
    grup2Wrap,
    el('div', { class: 'd-flex justify-content-end gap-2 border-top pt-3 mt-2' }, [batal, submit]),
  ]);

  form.addEventListener('input', () => { formDiubah = true; });
  form.addEventListener('change', () => { formDiubah = true; });
  batal.addEventListener('click', () => {
    if (formDiubah && !window.confirm('Batalkan input laporan? Data yang sudah diisi tidak disimpan.')) return;
    window.location.hash = '#/history';
  });

  async function onVehicleChange() {
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
      if (!f.bar_awal.disabled) {
        f.bar_awal.value = pref.bar_awal || '';
        f.bar_akhir.value = pref.bar_akhir || '';
      }
      f.biaya_bbm.value = String(pref.biaya_bbm ?? '');
      f.metode_pembayaran.value = pref.metode_pembayaran || 'TUNAI';
      f.flazz_card_id.value = pref.flazz_card_id || '';
      f.metode_toll.value = pref.metode_toll || '';
      f.flazz_card_id_toll.value = pref.flazz_card_id_toll || '';
      f.flazz_card_id_2.value = pref.flazz_card_id_2 || '';
      f.biaya_bbm_2.value = pref.biaya_bbm_2 ? String(pref.biaya_bbm_2) : '';
      f.flazz_card_id_toll_2.value = pref.flazz_card_id_toll_2 || '';
      f.biaya_toll_2.value = pref.biaya_toll_2 ? String(pref.biaya_toll_2) : '';
      if (pref.flazz_card_id_2 || pref.biaya_bbm_2 || pref.flazz_card_id_toll_2 || pref.biaya_toll_2) bukaGrup2();
      // Cocokkan jenis BBM dari harga transaksi terakhir (biaya / liter) bila memungkinkan.
      const hargaPref = Number(pref.liter_bbm) > 0 ? (Number(pref.biaya_bbm || 0) + Number(pref.biaya_bbm_2 || 0)) / Number(pref.liter_bbm) : 0;
      const cocok = bbmOpsi.find((o) => Math.abs(o.harga - hargaPref) < 1);
      if (cocok) f.jenis_bbm.value = cocok.value;
      hitungUlangLiter();
    } catch (err) {
      toast(err.message, 'error');
    }
  }
  f.vehicle_id.addEventListener('change', onVehicleChange);

  function pilihKartu(select, cardId) {
    if (cardId && Array.from(select.options).some((o) => o.value === cardId)) select.value = cardId;
  }

  async function muatSupirJalur() {
    const sebelumnya = f.nama_supir.value === '' ? null : jalurDrivers[Number(f.nama_supir.value)];
    jalurDrivers = [];
    isiOpsi(f.nama_supir, [], '— memuat jalur —');
    try {
      const data = await get(`/api/jalur/drivers?tanggal=${encodeURIComponent(f.tanggal.value)}`);
      jalurDrivers = Array.isArray(data.list) ? data.list : [];
    } catch (err) {
      toast(err.message, 'error');
    }
    isiOpsi(f.nama_supir, opsiSupirJalur(jalurDrivers), jalurDrivers.length ? '— pilih supir dari jalur —' : '— tidak ada jalur —');
    infoJalur.replaceChildren(
      jalurDrivers.length
        ? 'Hanya supir dengan jalur BELUM DIISI pada tanggal ini.'
        : el('span', {}, ['Belum ada jalur BELUM DIISI pada tanggal ini. ', el('a', { href: '#/jalur/buat', text: 'Buat jalur' })]),
    );
    // Pertahankan supir yang sama bila masih punya jalur pada tanggal baru.
    const idx = sebelumnya ? jalurDrivers.findIndex((d) => d.nama_driver === sebelumnya.nama_driver && d.vehicle_id === sebelumnya.vehicle_id) : -1;
    if (idx > -1) f.nama_supir.value = String(idx);
  }

  async function onSupirChange() {
    const jalur = jalurDrivers[Number(f.nama_supir.value)];
    f.nama_supir_2.value = jalur && f.nama_supir.value !== '' ? jalur.nama_driver2 || '' : '';
    if (!jalur || f.nama_supir.value === '') return;
    if (jalur.vehicle_id && Array.from(f.vehicle_id.options).some((o) => o.value === jalur.vehicle_id)) {
      f.vehicle_id.value = jalur.vehicle_id;
      await onVehicleChange();
    }
    // Diterapkan SETELAH prefill agar kartu dari jalur tidak tertimpa transaksi terakhir.
    if (jalur.flazz_card_id) {
      f.metode_toll.value = 'FLAZZ';
      pilihKartu(f.flazz_card_id_toll, jalur.flazz_card_id);
    }
    // Kartu ke-2 jalur hanya menyiapkan slot grup-2; nominal tetap diisi manual.
    if (jalur.flazz_card_id_2 && !f.flazz_card_id_2.value) {
      pilihKartu(f.flazz_card_id_2, jalur.flazz_card_id_2);
      if (!f.flazz_card_id_toll_2.value) pilihKartu(f.flazz_card_id_toll_2, jalur.flazz_card_id_2);
      bukaGrup2();
    }
  }

  f.tanggal.addEventListener('change', async () => {
    await muatSupirJalur();
    await onSupirChange();
  });
  f.nama_supir.addEventListener('change', onSupirChange);
  muatSupirJalur();

  let fotoSudahTerunggah = false;

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('d-none');

    const values = {
      vehicle_id: f.vehicle_id.value,
      tanggal: f.tanggal.value,
      nama_supir: jalurDrivers[Number(f.nama_supir.value)]?.nama_driver ?? '',
      km_awal: f.km_awal.value,
      km_akhir: f.km_akhir.value,
      km_awal_broken: f.km_awal_broken.checked,
      km_akhir_broken: f.km_akhir_broken.checked,
      km_tanpa_estimasi: false,
      bar_awal: f.bar_awal.value,
      bar_akhir: f.bar_akhir.value,
      liter_bbm: f.liter_bbm.value,
      harga_bbm: hargaBbm(),
      biaya_bbm: f.biaya_bbm.value,
      biaya_toll: f.biaya_toll.value,
      metode_pembayaran: f.metode_pembayaran.value,
      flazz_card_id: f.flazz_card_id.value,
      metode_toll: f.metode_toll.value,
      flazz_card_id_toll: f.flazz_card_id_toll.value,
      flazz_card_id_2: f.flazz_card_id_2.value,
      biaya_bbm_2: f.biaya_bbm_2.value,
      flazz_card_id_toll_2: f.flazz_card_id_toll_2.value,
      biaya_toll_2: f.biaya_toll_2.value,
    };

    const err = validateForm(values);
    if (err.length) {
      alertBox.textContent = err.join(' ');
      alertBox.classList.remove('d-none');
      return;
    }

    submit.disabled = true;
    batal.disabled = true;
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
      window.location.hash = '#/history';
    } catch (err) {
      alertBox.textContent = err.message || 'Gagal menyimpan laporan.';
      alertBox.classList.remove('d-none');
      submit.disabled = false;
      batal.disabled = false;
      submit.textContent = 'Simpan Laporan';
    }
  });

  view.replaceChildren(el('div', { class: 'panel' }, [el('h2', { class: 'h6 mb-3', text: 'Input Laporan Harian' }), form]));
  return { ok: true };
}
