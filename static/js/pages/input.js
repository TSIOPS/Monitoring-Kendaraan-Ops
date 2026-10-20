import { get, post, pesanTimeoutSimpan, BATAS_WAKTU_FOTO_MS } from '../api.js';
import { el, fmtDateId, fmtNum, pratinjauFoto, toast, tampilkanGalat, barisForm as baris } from '../ui.js';
import { meteranBensin } from '../meteran.js';
import { tabelRincian, validasiRincian, ringkasRincian } from '../rincian.js';
import { bacaDraft, hapusDraft, kunciDraft, simpanDraft } from '../draft.js';
import { getUser } from '../store.js';
import { halamanMasihAktif, navigate, pasangPenjagaKeluar } from '../router.js';

// Setara compressPhoto GAS (1280 px, 70%) agar kapasitas Storage awet.
const MAKS_LEBAR = 1280;
const KUALITAS_JPEG = 0.7;
// Thumbnail untuk daftar & galeri (hemat egress).
export const THUMB_LEBAR = 320;
// Struk berisi teks: lebar 1024 px & kualitas 60% tetap terbaca, lebih hemat Storage.
export const STRUK_LEBAR = 1024;
export const STRUK_KUALITAS = 0.6;
export const THUMB_KUALITAS = 0.6;

// KM wajib 5-6 digit (sama dengan server); kendaraan yang odometernya memang < 10.000
// (KM terakhir < 10.000) atau belum punya riwayat (rujukan kosong) dikecualikan.
export function pesanDigitKm(label, km, kmRujukan) {
  const n = Number(km);
  if (String(km ?? '') === '' || !Number.isFinite(n)) return '';
  if (n > 999999) return `${label} maksimal 6 digit (999.999). Periksa kembali angka odometer.`;
  const r = kmRujukan === null || kmRujukan === undefined || kmRujukan === '' ? null : Number(kmRujukan);
  if (n < 10000 && r !== null && r >= 10000) return `${label} minimal 5 digit. KM terakhir kendaraan ini ${fmtNum(r)}; periksa kembali angka odometer.`;
  return '';
}

export function validateForm(v) {
  const err = [];
  if (!v.vehicle_id) err.push('Kendaraan wajib dipilih.');
  if (!v.tanggal) err.push('Tanggal wajib diisi.');
  if (!v.nama_supir) err.push('Nama supir wajib diisi.');

  // Sisi yang dicentang "meter mati/rusak" tidak wajib diisi: KM-nya diestimasi server
  // (liter konsumsi x standar KM/L). Sisi lain tetap wajib angka 5-6 digit.
  for (const [label, km, rusak] of [['KM awal', v.km_awal, v.km_awal_broken], ['KM akhir', v.km_akhir, v.km_akhir_broken]]) {
    if (rusak) continue;
    if (String(km ?? '') === '') err.push(`${label} wajib diisi (atau centang meter mati/rusak).`);
    else if (!Number.isFinite(Number(km))) err.push(`${label} harus berupa angka.`);
    else {
      const pesan = pesanDigitKm(label, km, v.km_terakhir);
      if (pesan) err.push(pesan);
    }
  }

  const liter = Number(v.liter_bbm);
  if (v.liter_bbm !== '' && (!Number.isFinite(liter) || liter < 0)) {
    err.push('Liter harus angka dan tidak boleh negatif.');
  }

  // Pengeluaran per nota (rincian): validasi sama dengan server; liter dihitung dari total BBM.
  const rincian = v.rincian || [];
  err.push(...validasiRincian(rincian, v.label_kartu));
  const { bbm, tol } = ringkasRincian(rincian);
  // Bukti wajib (sama dengan server): struk BBM bila ada biaya BBM, bukti tol bila ada biaya tol.
  if (v.ada_struk_bbm === false && bbm > 0) err.push('Foto struk BBM wajib diupload karena ada biaya BBM.');
  if (v.ada_struk_tol === false && tol > 0) err.push('Foto struk / bukti tol wajib diupload karena ada biaya tol.');
  if (v.harga_bbm !== undefined && bbm > 0 && !(Number(v.harga_bbm) > 0)) err.push('Pilih jenis BBM agar liter terhitung.');

  if (v.jarum && [v.bar_awal, v.bar_akhir].some((x) => x !== '' && (Number(x) < 0 || Number(x) > 100))) {
    err.push('Indikator jarum diisi persen jarum 0–100.');
  }
  // Meteran jarum wajib digeser: kosong berarti belum dibaca, bukan tangki kosong.
  if (v.jarum && (v.bar_awal === '' || v.bar_akhir === '')) {
    err.push('Geser meteran bensin awal dan akhir sesuai posisi jarum.');
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
    rincian: v.rincian || [],
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

const FORMAT_JAM_WIB = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit' });

// Teks banner draft dipulihkan. Draft dari tanggal lain menyebut tanggalnya agar PIC
// tidak tanpa sadar mengirim laporan untuk tanggal yang salah.
export function teksBannerDraft(disimpanMs, tanggalDraft, hariIni = tanggalWib()) {
  const jam = FORMAT_JAM_WIB.format(new Date(disimpanMs));
  if (tanggalDraft && tanggalDraft !== hariIni) {
    const tglSimpan = fmtDateId(tanggalWib(new Date(disimpanMs)));
    return `Isian dari ${tglSimpan} ${jam} dipulihkan — tanggal laporan diisi ${fmtDateId(tanggalDraft)}. Foto perlu dipilih ulang.`;
  }
  return `Isian dari ${jam} dipulihkan. Foto perlu dipilih ulang.`;
}

export function kompresGambar(file, maksLebar = MAKS_LEBAR, kualitas = KUALITAS_JPEG) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('File tidak dapat dibaca.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Foto tidak valid.'));
      img.onload = () => {
        const skala = img.width > maksLebar ? maksLebar / img.width : 1;
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(img.width * skala);
        canvas.height = Math.round(img.height * skala);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Browser tidak mendukung kompresi foto.'));
          return;
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', kualitas));
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

// Kartu Flazz yang boleh dipakai: hanya kartu yang dikeluarkan di jalur (urut kartu 1, 2).
// Tanpa jalur terpilih, semua kartu ditampilkan.
export function kartuJalur(cards, jalur) {
  if (!jalur) return cards;
  const ids = [jalur.flazz_card_id, jalur.flazz_card_id_2].map((x) => String(x || '')).filter(Boolean);
  return ids.map((id) => cards.find((c) => String(c.id || c.card_id) === id)).filter(Boolean);
}

function opsiKartu(cards) {
  return cards.map((c) => ({
    value: c.id || c.card_id,
    label: `${c.card_name || c.card_number || c.id} (saldo ${fmtNum(c.last_balance || 0)})`,
  }));
}

export async function renderInput(view) {
  const hashSaya = window.location.hash;
  view.replaceChildren(el('div', { class: 'text-muted', text: 'Memuat data master' }));

  let master;
  try {
    master = await get('/api/master');
  } catch (err) {
    if (!halamanMasihAktif(hashSaya)) return { ok: false };
    view.replaceChildren(el('div', { class: 'alert alert-danger', text: err.message }));
    return { ok: false };
  }
  // Pengguna sudah pindah halaman selama master dimuat: jangan pasang penjaga/gambar di sana.
  if (!halamanMasihAktif(hashSaya)) return { ok: false };

  const vehicles = Array.isArray(master.vehicles) ? master.vehicles : [];
  const cards = Array.isArray(master.flazzCards) ? master.flazzCards : [];
  const bbmOpsi = opsiBbm(Array.isArray(master.bbmList) ? master.bbmList : []);

  const f = {
    vehicle_id: el('select', { class: 'form-select', id: 'f-vehicle' }),
    tanggal: el('input', { class: 'form-control', type: 'date', id: 'f-tanggal' }),
    nama_supir: el('select', { class: 'form-select', id: 'f-supir' }),
    nama_supir_2: el('input', { class: 'form-control bg-light', id: 'f-supir-2', readonly: 'readonly', tabindex: '-1', placeholder: 'tidak ada' }),
    km_awal: el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', id: 'f-km-awal', min: '0', max: '999999', placeholder: '5–6 digit' }),
    km_akhir: el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', id: 'f-km-akhir', min: '0', max: '999999', placeholder: '5–6 digit' }),
    km_awal_broken: el('input', { class: 'form-check-input', type: 'checkbox', id: 'f-km-awal-broken' }),
    km_akhir_broken: el('input', { class: 'form-check-input', type: 'checkbox', id: 'f-km-akhir-broken' }),
    bar_awal: el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', id: 'f-bar-awal' }),
    bar_akhir: el('input', { class: 'form-control', type: 'number', inputmode: 'numeric', id: 'f-bar-akhir' }),
    jenis_bbm: el('select', { class: 'form-select', id: 'f-jenis-bbm' }),
    liter_bbm: el('input', { class: 'form-control bg-light', type: 'number', step: '0.01', id: 'f-liter', readonly: 'readonly', tabindex: '-1' }),
  };

  isiOpsi(f.vehicle_id, opsiKendaraan(vehicles), '— pilih kendaraan —');
  isiOpsi(f.jenis_bbm, bbmOpsi, '— pilih jenis BBM —');
  if (bbmOpsi.length === 1) f.jenis_bbm.value = bbmOpsi[0].value;
  const hargaBbm = () => bbmOpsi.find((o) => o.value === f.jenis_bbm.value)?.harga || 0;
  // Didefinisikan sebagai function: tabelRincian memanggil onUbah saat dibuat.
  function hitungUlangLiter() {
    f.liter_bbm.value = hitungLiter(ringkasRincian(tabel.ambil()).bbm, hargaBbm());
  }
  f.jenis_bbm.addEventListener('change', hitungUlangLiter);
  // Kartu etoll yang boleh dipilih di kolom "Dibayar": hanya kartu jalur (tanpa jalur: semua kartu).
  let kartuBoleh = cards;
  let tabel = null;
  tabel = tabelRincian({ opsiKartu: opsiKartu(cards), onUbah: () => { if (tabel) hitungUlangLiter(); } });
  function isiKartu(daftar) {
    kartuBoleh = daftar;
    tabel.setKartu(opsiKartu(daftar));
  }

  // Supir hanya dari jalur BELUM_DIISI pada tanggal terpilih (seperti GAS, spec M8 D4).
  let jalurDrivers = [];
  const infoJalur = el('div', { class: 'form-text' });
  const infoBar = el('div', { class: 'form-text mb-3' });

  const serverData = { files: { odo_awal: '', odo_akhir: '', struk_bbm: '', struk_toll: '' }, km_awal: '', km_akhir: '' };
  const alertBox = el('div', { class: 'alert alert-danger d-none' });
  const fotoAwal = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'form-control' });
  const fotoAkhir = el('input', { type: 'file', accept: 'image/*', capture: 'environment', class: 'form-control' });
  // Struk BBM & tol: opsional dulu (masa sosialisasi ke PIC). Tanpa `capture`: struk boleh dipilih
  // dari galeri (sering difoto lebih dulu di SPBU); odometer tetap kamera langsung (anti-kecurangan).
  const fotoStrukBbm = el('input', { type: 'file', accept: 'image/*', class: 'form-control' });
  const fotoStrukTol = el('input', { type: 'file', accept: 'image/*', class: 'form-control' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Simpan Laporan' });
  const batal = el('button', { class: 'btn btn-outline-secondary', type: 'button', text: 'Batal' });
  let formDiubah = false;

  f.tanggal.value = tanggalWib();

  // Input dengan satuan (Rp / KM / L) di sisi kiri/kanan.
  const satuan = (kontrol, kiri, kanan) => el('div', { class: 'input-group' }, [
    kiri ? el('span', { class: 'input-group-text', text: kiri }) : null,
    kontrol,
    kanan ? el('span', { class: 'input-group-text', text: kanan }) : null,
  ]);
  const seksi = (judul, isi) => el('div', { class: 'form-section' }, [el('div', { class: 'form-section-title', text: judul }), ...isi]);
  // Indikator bar digital: kolom angka; indikator jarum: meteran E-F + slider (seperti GAS).
  const meterAwal = meteranBensin(f.bar_awal, 'Level bensin awal');
  const meterAkhir = meteranBensin(f.bar_akhir, 'Level bensin akhir');
  const barAngkaAwal = baris('Bar bensin awal', f.bar_awal);
  const barAngkaAkhir = baris('Bar bensin akhir', f.bar_akhir);
  const barJarumAwal = el('div', { class: 'd-none' }, [baris('Level bensin awal (berangkat)', meterAwal.elemen)]);
  const barJarumAkhir = el('div', { class: 'd-none' }, [baris('Level bensin akhir (pulang)', meterAkhir.elemen)]);
  const meterRusak = (cek, id, teks) => el('div', { class: 'form-check mb-3' }, [cek, el('label', { class: 'form-check-label', for: id, text: teks })]);
  f.liter_bbm.placeholder = 'otomatis';

  const form = el('form', { novalidate: 'novalidate' }, [
    alertBox,
    // Laporan berbasis supir di jalur: pilih tanggal & supir, kendaraan + driver 2 terisi otomatis.
    seksi('Supir & Kendaraan', [
      el('div', { class: 'row' }, [
        el('div', { class: 'col-md-4' }, [baris('Tanggal', f.tanggal)]),
        el('div', { class: 'col-md-8' }, [baris('Supir (Driver 1)', f.nama_supir), infoJalur]),
      ]),
      el('div', { class: 'row' }, [
        el('div', { class: 'col-md-4' }, [baris('Driver 2', f.nama_supir_2, 'Otomatis dari jalur pengiriman.')]),
        el('div', { class: 'col-md-8' }, [baris('Kendaraan', f.vehicle_id, 'Otomatis dari jalur pengiriman.')]),
      ]),
    ]),
    // Kolom kiri = awal perjalanan, kanan = akhir: foto, KM, lalu bar bensin.
    seksi('Odometer & Bensin', [
      el('div', { class: 'row g-4' }, [
        el('div', { class: 'col-md-6' }, [
          el('div', { class: 'form-subtitle', text: 'Awal perjalanan' }),
          baris('Foto odometer awal', el('div', {}, [fotoAwal, pratinjauFoto(fotoAwal)])),
          baris('KM awal', satuan(f.km_awal, '', 'KM')),
          meterRusak(f.km_awal_broken, 'f-km-awal-broken', 'Meter awal mati/rusak'),
          barAngkaAwal,
          barJarumAwal,
        ]),
        el('div', { class: 'col-md-6' }, [
          el('div', { class: 'form-subtitle', text: 'Akhir perjalanan' }),
          baris('Foto odometer akhir', el('div', {}, [fotoAkhir, pratinjauFoto(fotoAkhir)])),
          baris('KM akhir', satuan(f.km_akhir, '', 'KM')),
          meterRusak(f.km_akhir_broken, 'f-km-akhir-broken', 'Meter akhir mati/rusak'),
          barAngkaAkhir,
          barJarumAkhir,
          infoBar,
        ]),
      ]),
    ]),
    seksi('Pengeluaran BBM & Tol', [
      el('div', { class: 'form-text mb-2', text: 'Isi satu baris per nota. Dibayar: kartu etoll yang dibawa di jalur, atau Tunai. Maks. 2 cara bayar per jenis.' }),
      tabel.elemen,
      el('div', { class: 'row' }, [
        el('div', { class: 'col-md-6' }, [baris('Jenis BBM', f.jenis_bbm)]),
        el('div', { class: 'col-md-6' }, [baris('Liter BBM', satuan(f.liter_bbm, '', 'L'), 'Otomatis: total BBM ÷ harga per liter')]),
      ]),
      el('div', { class: 'row' }, [
        el('div', { class: 'col-md-6' }, [baris('Foto struk BBM (gabungan semua struk)', el('div', {}, [fotoStrukBbm, pratinjauFoto(fotoStrukBbm)]), 'Wajib bila ada baris BBM. Susun semua struk lalu foto sekaligus.')]),
        el('div', { class: 'col-md-6' }, [baris('Foto bukti tol (gabungan semua bukti)', el('div', {}, [fotoStrukTol, pratinjauFoto(fotoStrukTol)]), 'Wajib bila ada baris tol. E-toll tanpa struk: foto cetak cek pengeluaran kartu.')]),
      ]),
    ]),
    el('div', { class: 'd-flex justify-content-end gap-2 border-top pt-3 mt-2' }, [batal, submit]),
  ]);

  // Meter mati/rusak: kolom KM dikunci & dikosongkan, server mengisi KM estimasi.
  for (const [cek, km] of [[f.km_awal_broken, f.km_awal], [f.km_akhir_broken, f.km_akhir]]) {
    cek.addEventListener('change', () => {
      km.disabled = cek.checked;
      if (cek.checked) km.value = '';
      km.placeholder = cek.checked ? 'Diestimasi otomatis' : '5–6 digit';
    });
  }

  form.addEventListener('input', () => { formDiubah = true; });
  form.addEventListener('change', () => { formDiubah = true; });
  // Konfirmasi ditangani penjaga router (dipasang di bagian draft otomatis di bawah).
  batal.addEventListener('click', () => { window.location.hash = '#/history'; });

  // Tidak ada prefill dari laporan terakhir: bar bensin adalah bacaan fisik saat ini
  // (GAS pun tidak mengisinya), dan biaya/metode/kartu BBM lama rawan terbawa
  // sehingga saldo Flazz terpotong salah. Yang otomatis hanya data dari jalur.
  // Indikator jarum: level diisi persen (0-100) seperti GAS; bar digital: jumlah bar menyala.
  let isJarum = false;
  async function onVehicleChange() {
    if (!f.vehicle_id.value) return;
    const terpilih = vehicles.find((v) => String(v.vehicle_id) === f.vehicle_id.value);
    const jarumSebelumnya = isJarum;
    isJarum = Boolean(terpilih && String(terpilih.jenis_indikator) === 'ANALOG_JARUM');
    // Satuan berbeda (bar vs persen): nilai lama dibuang saat jenis indikator berganti.
    if (jarumSebelumnya !== isJarum) { f.bar_awal.value = ''; f.bar_akhir.value = ''; }
    for (const x of [barAngkaAwal, barAngkaAkhir]) x.classList.toggle('d-none', isJarum);
    for (const x of [barJarumAwal, barJarumAkhir]) x.classList.toggle('d-none', !isJarum);
    if (isJarum) for (const m of [meterAwal, meterAkhir]) m.setJenis(terpilih?.jenis);
    const maks = isJarum ? '100' : String(Number(terpilih?.jumlah_bar) || '');
    for (const x of [f.bar_awal, f.bar_akhir]) {
      x.disabled = false;
      x.min = '0';
      if (maks) x.max = maks; else x.removeAttribute('max');
      x.placeholder = isJarum ? 'persen jarum 0–100' : (maks ? `0–${maks} bar` : '');
    }
    infoBar.textContent = isJarum
      ? ''
      : (maks ? `Indikator bar: isi jumlah bar yang menyala (0–${maks}).` : '');
  }
  f.vehicle_id.addEventListener('change', onVehicleChange);

  // Mengembalikan true bila berhasil, false bila gagal, null bila hasilnya basi (sudah ada
  // pemuatan yang lebih baru, mis. tanggal diganti lagi) dan diabaikan.
  let nomorMuat = 0;
  async function muatSupirJalur() {
    const nomor = ++nomorMuat;
    const sebelumnya = f.nama_supir.value === '' ? null : jalurDrivers[Number(f.nama_supir.value)];
    jalurDrivers = [];
    isiOpsi(f.nama_supir, [], '— memuat jalur —');
    infoJalur.replaceChildren('Memuat jalur…');
    let list;
    try {
      const data = await get(`/api/jalur/drivers?tanggal=${encodeURIComponent(f.tanggal.value)}`);
      list = Array.isArray(data.list) ? data.list : [];
    } catch (err) {
      if (nomor !== nomorMuat) return null;
      // Galat jaringan/server bukan berarti "tidak ada jalur": tampilkan galat + Coba lagi,
      // tanpa tautan "Buat jalur" yang memicu jalur ganda.
      isiOpsi(f.nama_supir, [], '— gagal memuat jalur —');
      const ulang = el('button', { type: 'button', class: 'btn btn-outline-danger ms-2', text: 'Coba lagi' });
      ulang.addEventListener('click', async () => {
        ulang.disabled = true;
        ulang.textContent = 'Memuat…';
        const ok = await muatSupirJalur();
        if (ok === null) return;
        pakaiSupirTertunda(ok);
        await onSupirChange();
      });
      infoJalur.replaceChildren(el('span', { class: 'text-danger', role: 'alert' }, [`Gagal memuat jalur: ${err.message}`, ulang]));
      return false;
    }
    if (nomor !== nomorMuat) return null;
    jalurDrivers = list;
    isiOpsi(f.nama_supir, opsiSupirJalur(jalurDrivers), jalurDrivers.length ? '— pilih supir dari jalur —' : '— tidak ada jalur —');
    infoJalur.replaceChildren(
      jalurDrivers.length
        ? 'Hanya supir dengan jalur BELUM DIISI pada tanggal ini.'
        : el('span', {}, ['Belum ada jalur BELUM DIISI pada tanggal ini. ', el('a', { href: '#/jalur/buat', text: 'Buat jalur' })]),
    );
    // Pertahankan supir yang sama bila masih punya jalur pada tanggal baru.
    const idx = sebelumnya ? jalurDrivers.findIndex((d) => d.nama_driver === sebelumnya.nama_driver && d.vehicle_id === sebelumnya.vehicle_id) : -1;
    if (idx > -1) f.nama_supir.value = String(idx);
    return true;
  }

  // Supir dari draft yang belum bisa dipilih karena jalur gagal dimuat saat pemulihan.
  let supirTertunda = null;
  function pakaiSupirTertunda(ok) {
    if (!ok || !supirTertunda) return;
    const s = supirTertunda;
    supirTertunda = null;
    const idx = jalurDrivers.findIndex((x) => x.nama_driver === s.nama_driver && x.vehicle_id === s.vehicle_id);
    if (idx > -1) f.nama_supir.value = String(idx);
    else catatanSupir.textContent = ` Supir ${s.nama_driver} tidak lagi punya jalur BELUM DIISI pada tanggal ini — pilih ulang.`;
  }

  async function onSupirChange() {
    const jalur = jalurDrivers[Number(f.nama_supir.value)];
    const adaJalur = Boolean(jalur && f.nama_supir.value !== '');
    const d2 = adaJalur ? String(jalur.nama_driver2 || '').trim() : '';
    // Driver 2 sama dengan Driver 1 (salah input di jalur lama) tidak ditampilkan.
    f.nama_supir_2.value = d2 && d2.toLowerCase() !== String(jalur.nama_driver || '').trim().toLowerCase() ? d2 : '';
    // Kendaraan mengikuti jalur (gate server menolak kendaraan yang tidak cocok); dikunci selama supir dipilih.
    f.vehicle_id.disabled = adaJalur && Array.from(f.vehicle_id.options).some((o) => o.value === jalur.vehicle_id);
    isiKartu(kartuJalur(cards, adaJalur ? jalur : null));
    if (!adaJalur) return;
    if (jalur.vehicle_id && Array.from(f.vehicle_id.options).some((o) => o.value === jalur.vehicle_id)) {
      f.vehicle_id.value = jalur.vehicle_id;
      await onVehicleChange();
    }
  }

  f.tanggal.addEventListener('change', async () => {
    const ok = await muatSupirJalur();
    if (ok === null) return;
    pakaiSupirTertunda(ok);
    await onSupirChange();
  });
  f.nama_supir.addEventListener('change', onSupirChange);

  // ── Draft otomatis ──
  // Hanya nilai field (foto tidak bisa diserialisasi). Supir disimpan sebagai nama + kendaraan,
  // bukan indeks opsi, karena indeks berubah saat daftar jalur dimuat ulang.
  const KUNCI = kunciDraft('input', getUser()?.user_id);
  // Rincian pengeluaran disimpan sebagai array; kunci slot lama (biaya_bbm dst.) di draft lama diabaikan.
  const FIELD_DRAFT = ['tanggal', 'km_awal', 'km_akhir', 'bar_awal', 'bar_akhir', 'jenis_bbm'];
  const ambilNilai = () => {
    const v = Object.fromEntries(FIELD_DRAFT.map((k) => [k, f[k].value]));
    const j = jalurDrivers[Number(f.nama_supir.value)];
    v.supir = j && f.nama_supir.value !== '' ? { nama_driver: j.nama_driver, vehicle_id: j.vehicle_id } : null;
    v.km_awal_broken = f.km_awal_broken.checked;
    v.km_akhir_broken = f.km_akhir_broken.checked;
    const rincian = tabel.ambil();
    // Tabel kosong tidak disimpan: [] akan dihitung "sudah ada isi" oleh simpanDraft.
    if (rincian.length) v.rincian = rincian;
    return v;
  };
  // Field berdefault (tanggal hari ini, jenis BBM tunggal) tidak dihitung sebagai "sudah ada isi".
  const FIELD_BERDEFAULT = ['tanggal', 'jenis_bbm'];
  // Draft dibaca sinkron saat render, sebelum listener simpan dipasang, dan penyimpanan
  // ditahan sampai pemulihan selesai: ketukan selama jalur dimuat (bisa sampai 30 dtk)
  // tidak boleh menimpa draft lama dengan form yang hampir kosong.
  const draftAwal = bacaDraft(localStorage, KUNCI);
  let draftSiap = false;
  let timerDraft = 0;
  const simpanNanti = () => {
    if (!draftSiap) return;
    clearTimeout(timerDraft);
    timerDraft = setTimeout(() => simpanDraft(localStorage, KUNCI, ambilNilai(), Date.now(), FIELD_BERDEFAULT), 600);
  };
  form.addEventListener('input', simpanNanti);
  form.addEventListener('change', simpanNanti);
  // Penjaga keluar menyimpan draft saat itu juga (tanpa menunggu debounce) agar pesan
  // "isian disimpan sebagai draft" benar.
  pasangPenjagaKeluar(() => {
    if (!formDiubah) return '';
    if (draftSiap) {
      clearTimeout(timerDraft);
      simpanDraft(localStorage, KUNCI, ambilNilai(), Date.now(), FIELD_BERDEFAULT);
    }
    return 'Laporan belum dikirim. Tinggalkan halaman? Isian disimpan sebagai draft, tetapi foto harus dipilih ulang.';
  });
  const bannerDraft = el('div', { class: 'alert alert-info d-none d-flex flex-wrap align-items-center gap-2', role: 'status' });
  const catatanSupir = el('span', {});
  form.prepend(bannerDraft);

  async function pulihkanDraft(d, jalurOk) {
    try {
      if (d) await terapkanDraft(d, jalurOk);
    } finally {
      draftSiap = true; // juga saat tidak ada draft atau pemulihan gagal
    }
  }

  async function terapkanDraft(d, jalurOk) {
    const v = d.nilai;
    if (v.tanggal && v.tanggal !== f.tanggal.value) { f.tanggal.value = v.tanggal; jalurOk = await muatSupirJalur(); }
    if (v.supir) {
      const idx = jalurDrivers.findIndex((x) => x.nama_driver === v.supir.nama_driver && x.vehicle_id === v.supir.vehicle_id);
      if (idx > -1) { f.nama_supir.value = String(idx); await onSupirChange(); }
      // Jalur gagal dimuat: supir dipilih setelah "Coba lagi" berhasil.
      else if (!jalurOk) supirTertunda = v.supir;
      else catatanSupir.textContent = ` Supir ${v.supir.nama_driver} tidak lagi punya jalur BELUM DIISI pada tanggal ini — pilih ulang.`;
    }
    for (const k of FIELD_DRAFT) if (k !== 'tanggal' && v[k] !== undefined && v[k] !== '') f[k].value = v[k];
    for (const k of ['km_awal_broken', 'km_akhir_broken']) if (v[k]) { f[k].checked = true; f[k].dispatchEvent(new Event('change')); }
    if (Array.isArray(v.rincian) && v.rincian.length) tabel.isi(v.rincian);
    hitungUlangLiter();
    formDiubah = true;
    const buang = el('button', { type: 'button', class: 'btn btn-outline-secondary ms-auto', text: 'Buang draft' });
    buang.addEventListener('click', () => {
      if (!window.confirm('Buang isian draft? Isian di form akan dikosongkan.')) return;
      clearTimeout(timerDraft);
      hapusDraft(localStorage, KUNCI);
      formDiubah = false; // isian sengaja dibuang: gambar ulang tanpa dialog penjaga
      navigate(window.location.hash);
      toast('Draft dibuang.');
    });
    bannerDraft.replaceChildren(el('span', {}, [teksBannerDraft(d.disimpan, v.tanggal), catatanSupir]), buang);
    bannerDraft.classList.remove('d-none');
  }

  muatSupirJalur().catch(() => false).then((ok) => pulihkanDraft(draftAwal, ok)).catch(() => {});

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
      km_terakhir: vehicles.find((x) => String(x.vehicle_id) === f.vehicle_id.value)?.km_terakhir ?? null,
      km_tanpa_estimasi: false,
      jarum: isJarum,
      bar_awal: f.bar_awal.value,
      bar_akhir: f.bar_akhir.value,
      liter_bbm: f.liter_bbm.value,
      harga_bbm: hargaBbm(),
      rincian: tabel.ambil(),
      label_kartu: (id) => opsiKartu(kartuBoleh).find((k) => String(k.value) === id)?.label || id,
    };

    values.ada_struk_bbm = Boolean(fotoStrukBbm.files?.[0] || serverData.files.struk_bbm);
    values.ada_struk_tol = Boolean(fotoStrukTol.files?.[0] || serverData.files.struk_toll);
    const err = validateForm(values);
    if (err.length) {
      tampilkanGalat(alertBox, err.join(' '));
      return;
    }

    submit.disabled = true;
    batal.disabled = true;
    submit.textContent = 'Menyimpan…';
    let tahap = 'foto';

    try {
      if (!fotoSudahTerunggah) {
        if ([fotoAwal, fotoAkhir, fotoStrukBbm, fotoStrukTol].some((x) => x.files && x.files[0])) submit.textContent = 'Mengunggah foto…';
        const fotoBody = {};
        if (fotoAwal.files && fotoAwal.files[0]) {
          fotoBody.foto_odo_awal = await kompresGambar(fotoAwal.files[0]);
          fotoBody.foto_odo_awal_thumb = await kompresGambar(fotoAwal.files[0], THUMB_LEBAR, THUMB_KUALITAS);
          fotoBody.foto_odo_awal_name = namaAman(fotoAwal.files[0].name);
        }
        if (fotoAkhir.files && fotoAkhir.files[0]) {
          fotoBody.foto_odo_akhir = await kompresGambar(fotoAkhir.files[0]);
          fotoBody.foto_odo_akhir_thumb = await kompresGambar(fotoAkhir.files[0], THUMB_LEBAR, THUMB_KUALITAS);
          fotoBody.foto_odo_akhir_name = namaAman(fotoAkhir.files[0].name);
        }
        for (const [slot, input] of [['struk_bbm', fotoStrukBbm], ['struk_toll', fotoStrukTol]]) {
          if (!(input.files && input.files[0])) continue;
          fotoBody['foto_' + slot] = await kompresGambar(input.files[0], STRUK_LEBAR, STRUK_KUALITAS);
          fotoBody['foto_' + slot + '_thumb'] = await kompresGambar(input.files[0], THUMB_LEBAR, THUMB_KUALITAS);
          fotoBody['foto_' + slot + '_name'] = namaAman(input.files[0].name);
        }

        if (Object.keys(fotoBody).length) {
          fotoBody.km_awal_val = values.km_awal;
          fotoBody.km_akhir_val = values.km_akhir;
          const up = await post('/api/laporan/photos', fotoBody, { timeoutMs: BATAS_WAKTU_FOTO_MS });
          serverData.files.odo_awal = up.files?.odo_awal || '';
          serverData.files.odo_akhir = up.files?.odo_akhir || '';
          serverData.files.struk_bbm = up.files?.struk_bbm || '';
          serverData.files.struk_toll = up.files?.struk_toll || '';
          serverData.km_awal = String(up.km_awal ?? '');
          serverData.km_akhir = String(up.km_akhir ?? '');
          fotoSudahTerunggah = true;
          for (const x of [fotoAwal, fotoAkhir, fotoStrukBbm, fotoStrukTol]) x.disabled = true;
          fotoAwal.closest('.mb-3').classList.add('text-muted');
          fotoAkhir.closest('.mb-3').classList.add('text-muted');
        }
      }

      tahap = 'laporan';
      submit.textContent = 'Menyimpan laporan…';
      await post('/api/laporan', buildPayload(values, serverData));
      clearTimeout(timerDraft);
      hapusDraft(localStorage, KUNCI);
      formDiubah = false; // sebelum pindah hash agar penjaga tidak bertanya
      toast('Laporan tersimpan.', 'success');
      window.location.hash = '#/history';
    } catch (err) {
      if (err.error === 'SUDAH_DILAPORKAN') {
        // Laporan sudah masuk: draft dibuang agar tidak dipulihkan lagi, dan tautan Riwayat tidak memicu penjaga.
        clearTimeout(timerDraft);
        hapusDraft(localStorage, KUNCI);
        formDiubah = false;
      }
      // Timeout saat kirim laporan: server mungkin sudah menyimpan; kirim ulang aman (dijawab SUDAH_DILAPORKAN).
      const pesanTimeout = tahap === 'laporan'
        ? ` Laporan mungkin sudah terkirim. Kirim ulang aman: bila muncul 'sudah dilaporkan', berarti sudah masuk.`
        : '';
      alertBox.replaceChildren(
        ...[
          pesanTimeoutSimpan(err, pesanTimeout) || 'Gagal menyimpan laporan.',
          err.error === 'SUDAH_DILAPORKAN'
            ? el('div', { class: 'mt-2' }, [el('a', { href: '#/history', class: 'alert-link', text: 'Buka Riwayat Transaksi' })])
            : null,
        ].filter(Boolean),
      );
      tampilkanGalat(alertBox);
      submit.disabled = false;
      batal.disabled = false;
      submit.textContent = 'Simpan Laporan';
    }
  });

  view.replaceChildren(el('div', { class: 'panel' }, [el('h2', { 'data-judul-halaman': '', class: 'h6 mb-3', text: 'Input Laporan Harian' }), form]));
  return { ok: true };
}
