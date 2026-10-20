import { BATAS_WAKTU_FOTO_MS, get, put } from '../api.js';
import { getRouteParam, halamanMasihAktif, pasangPenjagaKeluar } from '../router.js';
import { el, fmtNum, toast, pratinjauFoto, tampilkanGalat, barisForm as baris } from '../ui.js';
import { bersihkanRincian, tabelRincian, validasiRincian, ringkasRincian } from '../rincian.js';
import { meteranBensin } from '../meteran.js';
import { hitungLiter, kompresGambar, namaAman, opsiBbm, pesanDigitKm, STRUK_KUALITAS, STRUK_LEBAR, THUMB_KUALITAS, THUMB_LEBAR } from './input.js';

// Edit transaksi lengkap (M11), setara alur edit GAS: tanggal, supir, KM, bar,
// liter, pengeluaran per nota (rincian), dan foto odometer. Kendaraan tetap terkunci.

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
  // Cek digit hanya untuk KM yang diubah; rujukan = nilai lama laporan (sama dengan server).
  for (const [label, baru, lama] of [['KM awal', v.km_awal, v.km_awal_lama], ['KM akhir', v.km_akhir, v.km_akhir_lama]]) {
    if (lama !== undefined && Number(baru) === Number(lama)) continue;
    const pesan = pesanDigitKm(label, baru, Number(lama) || null);
    if (pesan) err.push(pesan);
  }
  err.push(...validasiRincian(v.rincian || [], v.label_kartu));
  return err;
}

// Body PUT. KM hanya dikirim bila berubah: server menandai km_sumber = AKTUAL setiap kali
// KM dikirim, dan transaksi ESTIMASI tidak boleh berubah diam-diam (spec M11).
// Jenis BBM transaksi lama ditebak dari harga per liter (biaya / liter), seperti calcEditLiter GAS.
// Jenis BBM tidak disimpan di laporan; ditebak dari liter tersimpan (dibulatkan 2 desimal):
// pilih jenis yang liter hitungannya (biaya / harga) paling dekat, selisih maks 0,01 L.
export function tebakJenisBbm(opsi, biayaTotal, liter) {
  const l = Number(liter);
  const b = Number(biayaTotal);
  if (!(l > 0) || !(b > 0)) return '';
  let terbaik = null;
  for (const o of opsi) {
    if (!(o.harga > 0)) continue;
    const selisih = Math.abs(b / o.harga - l);
    if (selisih <= 0.0101 && (!terbaik || selisih < terbaik.selisih)) terbaik = { value: o.value, selisih };
  }
  return terbaik?.value || '';
}

// Rincian dianggap berubah bila isi tabel (dinormalkan) beda dengan rincian awal: jenis, nominal,
// kartu, keterangan, dan urutan baris.
export function rincianBerubah(awal, sekarang) {
  const a = bersihkanRincian(awal);
  const b = bersihkanRincian(sekarang);
  if (a.length !== b.length) return true;
  return a.some((x, i) => x.jenis !== b[i].jenis || x.nominal !== b[i].nominal || x.kartu !== b[i].kartu || x.keterangan !== b[i].keterangan);
}

export function bodyEdit(trx, v) {
  const body = {
    tanggal: v.tanggal,
    nama_supir: v.nama_supir,
    bar_awal: Number(v.bar_awal),
    bar_akhir: Number(v.bar_akhir),
    liter_bbm: Number(v.liter_bbm),
  };
  // Server menjumlahkan rincian ke kolom slot lama (grup-1 + grup-2). Rincian yang tidak diubah
  // tidak dikirim: pembayaran lama (slot, kartu, usage) dipertahankan apa adanya.
  if (rincianBerubah(Array.isArray(trx.rincian) ? trx.rincian : [], v.rincian || [])) body.rincian = v.rincian || [];
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
  const hashSaya = window.location.hash;
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
    if (!halamanMasihAktif(hashSaya)) return { ok: false };
    const pesan = err.status === 404 ? 'Transaksi tidak ditemukan. Mungkin sudah dihapus.' : err.message;
    view.replaceChildren(el('div', { class: `alert ${err.status === 404 ? 'alert-warning' : 'alert-danger'}`, text: pesan }));
    return { ok: false };
  }
  // Pengguna sudah pindah halaman selama data dimuat: jangan pasang penjaga/gambar di sana.
  if (!halamanMasihAktif(hashSaya)) return { ok: false };

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
  // Jarum: persen 0-100 (seperti GAS), bar digital: jumlah bar menyala.
  const batasBar = jarum ? { max: '100', placeholder: 'persen jarum 0–100' } : {};
  const barAwal = angka(trx.bar_awal, batasBar);
  const barAkhir = angka(trx.bar_akhir, batasBar);
  // Jarum: meteran E-F + slider seperti Input Laporan; nilai lama langsung tampil di jarum.
  const meterAwal = jarum ? meteranBensin(barAwal, 'Level bensin awal') : null;
  const meterAkhir = jarum ? meteranBensin(barAkhir, 'Level bensin akhir') : null;
  if (jarum) for (const m of [meterAwal, meterAkhir]) m.setJenis(kendaraan?.jenis);
  const liter = angka(trx.isi_bbm, { step: '0.01', readonly: 'readonly', tabindex: '-1' });
  liter.classList.add('bg-light');
  const bbmOpsi = opsiBbm(Array.isArray(master.bbmList) ? master.bbmList : []);
  const jenisBbm = el('select', { class: 'form-select' });
  isiOpsi(jenisBbm, bbmOpsi, '— pilih jenis BBM —');
  const fotoAwal = el('input', { type: 'file', accept: 'image/*', class: 'form-control' });
  const fotoAkhir = el('input', { type: 'file', accept: 'image/*', class: 'form-control' });
  const fotoStrukBbm = el('input', { type: 'file', accept: 'image/*', class: 'form-control' });
  const fotoStrukTol = el('input', { type: 'file', accept: 'image/*', class: 'form-control' });

  // Jenis BBM ditebak dari total BBM (grup-1 + grup-2) dan liter tersimpan.
  jenisBbm.value = tebakJenisBbm(bbmOpsi, Number(trx.total_bbm || 0), trx.isi_bbm)
    || (bbmOpsi.length === 1 ? bbmOpsi[0].value : '');
  // Liter mengikuti total BBM rincian / harga jenis BBM; total 0 -> liter 0.
  // Didefinisikan sebagai function: tabelRincian memanggil onUbah saat dibuat.
  function hitungUlangLiter() {
    const total = ringkasRincian(tabel.ambil()).bbm;
    const harga = bbmOpsi.find((o) => o.value === jenisBbm.value)?.harga || 0;
    if (!(total > 0)) liter.value = '0';
    else if (harga > 0) liter.value = hitungLiter(total, harga);
  }
  jenisBbm.addEventListener('change', hitungUlangLiter);
  // Penjaga `if (tabel)`: panggilan onUbah saat tabel dibuat tidak menimpa liter tersimpan.
  let tabel = null;
  tabel = tabelRincian({
    opsiKartu: opsiKartu(cards),
    awal: Array.isArray(trx.rincian) ? trx.rincian : [],
    labelTidakAda: '(kartu lama)',
    onUbah: () => { if (tabel) hitungUlangLiter(); },
  });
  const labelKartu = (kartuId) => opsiKartu(cards).find((k) => String(k.value) === kartuId)?.label || kartuId;

  const alertBox = el('div', { class: 'alert alert-danger d-none' });
  const submit = el('button', { class: 'btn btn-primary', type: 'submit', text: 'Simpan Perubahan' });
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
      jarum ? null : kol(2, baris('Bar awal', barAwal)),
      jarum ? null : kol(2, baris('Bar akhir', barAkhir)),
      kol(jarum ? 6 : 2, baris('Liter BBM', liter, 'Otomatis: total BBM ÷ harga per liter')),
    ].filter(Boolean)),
    jarum ? el('div', { class: 'row' }, [
      kol(6, baris('Level bensin awal (berangkat)', meterAwal.elemen)),
      kol(6, baris('Level bensin akhir (pulang)', meterAkhir.elemen)),
    ]) : null,
    el('div', { class: 'row' }, [
      kol(6, baris('Foto odometer awal', el('div', {}, [fotoAwal, pratinjauFoto(fotoAwal, trx.foto_odo_awal || trx.foto_odo_awal_thumb)]), 'Kosongkan bila tidak diganti.')),
      kol(6, baris('Foto odometer akhir', el('div', {}, [fotoAkhir, pratinjauFoto(fotoAkhir, trx.foto_odo_akhir || trx.foto_odo_akhir_thumb)]), 'Kosongkan bila tidak diganti.')),
    ]),
    el('div', { class: 'row' }, [
      kol(6, baris('Foto struk BBM (gabungan semua struk)', el('div', {}, [fotoStrukBbm, pratinjauFoto(fotoStrukBbm, trx.foto_struk_bbm || trx.foto_struk_bbm_thumb)]), trx.foto_struk_bbm ? 'Kosongkan bila tidak diganti.' : 'Belum ada struk; tambahkan bila ada.')),
      kol(6, baris('Foto bukti tol (gabungan semua bukti)', el('div', {}, [fotoStrukTol, pratinjauFoto(fotoStrukTol, trx.foto_struk_toll || trx.foto_struk_toll_thumb)]), trx.foto_struk_toll ? 'Kosongkan bila tidak diganti.' : 'Belum ada bukti. Beberapa struk difoto sekaligus dalam 1 foto; e-toll tanpa struk: foto cetak cek pengeluaran kartu.')),
    ]),
    el('h3', { class: 'h6 mt-2', text: 'Pengeluaran BBM & Tol' }),
    el('div', { class: 'form-text mb-2', text: 'Isi satu baris per nota. Dibayar: kartu etoll atau Tunai. Maks. 2 cara bayar per jenis.' }),
    trx.rincian_lama ? el('div', { class: 'form-text mb-2', text: 'Laporan lama: total dipecah otomatis menjadi baris. Boleh dirinci per nota.' }) : null,
    tabel.elemen,
    el('div', { class: 'row' }, [kol(6, baris('Jenis BBM', jenisBbm))]),
    el('div', { class: 'd-flex gap-2' }, [
      submit,
      el('a', { class: 'btn btn-outline-secondary', href: '#/history', text: 'Batal' }),
    ]),
  ]);

  // Penjaga keluar: tautan Batal, menu, dan tombol Back ditanya bila ada perubahan belum disimpan.
  let formDiubah = false;
  form.addEventListener('input', () => { formDiubah = true; });
  form.addEventListener('change', () => { formDiubah = true; });
  pasangPenjagaKeluar(() => (formDiubah ? 'Perubahan belum disimpan. Tinggalkan halaman?' : ''));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    alertBox.classList.add('d-none');
    const values = {
      tanggal: tanggal.value, nama_supir: supir.value, km_awal: kmAwal.value, km_akhir: kmAkhir.value,
      km_awal_lama: trx.km_awal, km_akhir_lama: trx.km_akhir,
      bar_awal: barAwal.value, bar_akhir: barAkhir.value, liter_bbm: liter.value,
      rincian: tabel.ambil(), label_kartu: labelKartu,
    };
    const err = validateEdit(values);
    if (err.length) {
      tampilkanGalat(alertBox, err.join(' '));
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Menyimpan';
    try {
      const body = bodyEdit(trx, values);
      if (fotoAwal.files && fotoAwal.files[0]) {
        body.foto_odo_awal = await kompresGambar(fotoAwal.files[0]);
        body.foto_odo_awal_thumb = await kompresGambar(fotoAwal.files[0], THUMB_LEBAR, THUMB_KUALITAS);
        body.foto_odo_awal_name = namaAman(fotoAwal.files[0].name);
      }
      if (fotoAkhir.files && fotoAkhir.files[0]) {
        body.foto_odo_akhir = await kompresGambar(fotoAkhir.files[0]);
        body.foto_odo_akhir_thumb = await kompresGambar(fotoAkhir.files[0], THUMB_LEBAR, THUMB_KUALITAS);
        body.foto_odo_akhir_name = namaAman(fotoAkhir.files[0].name);
      }
      for (const [slot, input] of [['struk_bbm', fotoStrukBbm], ['struk_toll', fotoStrukTol]]) {
        if (!(input.files && input.files[0])) continue;
        body['foto_' + slot] = await kompresGambar(input.files[0], STRUK_LEBAR, STRUK_KUALITAS);
        body['foto_' + slot + '_thumb'] = await kompresGambar(input.files[0], THUMB_LEBAR, THUMB_KUALITAS);
        body['foto_' + slot + '_name'] = namaAman(input.files[0].name);
      }
      const res = await put(`/api/laporan/${encodeURIComponent(id)}`, body, { timeoutMs: BATAS_WAKTU_FOTO_MS });
      toast(res.msg || 'Transaksi diperbarui.', 'success');
      formDiubah = false; // sebelum pindah agar penjaga tidak bertanya
      // replace: tombol Back tidak kembali ke form edit lama.
      location.replace('#/history');
    } catch (e) {
      tampilkanGalat(alertBox, e.message || 'Gagal memperbarui transaksi.');
      submit.disabled = false;
      submit.textContent = 'Simpan Perubahan';
    }
  });

  view.replaceChildren(el('div', { class: 'panel' }, [el('h2', { 'data-judul-halaman': '', class: 'h6 mb-3', text: 'Edit Transaksi' }), form]));
  return { ok: true };
}
