import { get, post } from '../api.js';
import { getUser, setJumlahPeringatan } from '../store.js';
import { confirmDialog, el, fmtDateId, fmtNum, toast } from '../ui.js';

// ── Helper murni (diuji) ────────────────────────────────────────────────────

// Sapaan menurut jam WIB, sama seperti renderDashboard GAS.
export function sapaan(jam) {
  if (jam >= 5 && jam < 11) return 'Selamat Pagi';
  if (jam >= 11 && jam < 15) return 'Selamat Siang';
  if (jam >= 15 && jam < 18) return 'Selamat Sore';
  return 'Selamat Malam';
}

export function jamWib(d = new Date()) {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', hourCycle: 'h23' }).format(d));
}

export function samarkanNomor(nomor) {
  const s = String(nomor || '');
  return s.length > 4 ? `***${s.slice(-4)}` : s;
}

// Filter warehouse (SUPERADMIN) di atas hasil /api/dashboard/warnings.
export function saringPeringatan(res, cabang) {
  const pilih = (list) => (list || []).filter((r) => !cabang || String(r.cabang) === String(cabang));
  const pajakKIR = pilih(res.pajakKIR);
  const saldo = pilih(res.saldo);
  const oli = pilih(res.oli);
  const odoEstimasi = pilih(res.odoEstimasi);
  return { pajakKIR, saldo, oli, odoEstimasi, total: pajakKIR.length + saldo.length + oli.length + odoEstimasi.length };
}

export function teksOli(r) {
  return r.status === 'GANTI_OLI'
    ? `sudah lewat ${Math.abs(r.sisa_km)} KM dari interval ${r.interval_km} KM`
    : `sisa ${r.sisa_km} KM lagi (interval ${r.interval_km} KM)`;
}

export function ringkasKartu(cards, topups) {
  const list = cards || [];
  const terakhir = (topups || [])[0];
  return {
    aktif: list.filter((c) => c.status === 'SEDANG_DIGUNAKAN').length,
    total: list.length,
    saldo: list.reduce((n, c) => n + (Number(c.last_balance) || 0), 0),
    topupTerakhir: terakhir ? { amount: Number(terakhir.amount) || 0, date: terakhir.date } : null,
  };
}

export function fotoPertama(r) {
  const urutan = [['foto_odo_awal', 'foto_odo_awal_thumb'], ['foto_odo_akhir', 'foto_odo_akhir_thumb'], ['foto_struk_bbm', 'foto_struk_bbm_thumb'], ['foto_struk_toll', 'foto_struk_toll_thumb']];
  for (const [url, thumb] of urutan) if (r[url]) return { url: r[url], thumb: r[thumb] || r[url] };
  return null;
}

// ── Tampilan ────────────────────────────────────────────────────────────────

const rp = (n) => `Rp ${fmtNum(n)}`;
const WARN_KELAS = { LEWAT: 'text-bg-danger', KRITIS: 'text-bg-warning', WASPADA: 'text-bg-info' };
const OLI_KELAS = { GANTI_OLI: 'text-bg-danger', WASPADA: 'text-bg-warning' };
const LABEL_DOK = { PAJAK: 'Pajak', PAJAK5: 'Pajak 5th', KIR: 'KIR' };
const KARTU_KELAS = { SEDANG_DIGUNAKAN: 'bg-warning', TERSEDIA: 'bg-success' };

const kartuPanel = (judul, aksi, isi) => el('div', { class: 'panel' }, [
  el('div', { class: 'd-flex justify-content-between align-items-center flex-wrap gap-2 mb-3' }, [el('h2', { class: 'h6 fw-bold mb-0' }, judul), aksi]),
  isi,
]);
const kosong = (teks) => el('div', { class: 'text-muted small py-2', text: teks });
const judulSeksi = (teks) => el('h3', { class: 'fw-bold text-uppercase small text-muted mt-2', text: teks });
const badgeCabang = (kode, isSuper) => (isSuper && kode ? el('span', { class: 'badge text-bg-light border ms-1', text: kode }) : null);

export async function renderDashboard(view) {
  const user = getUser() || {};
  const isSuper = user.role === 'SUPERADMIN';

  const tanggal = new Date().toLocaleDateString('id-ID', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Jakarta' });
  const salam = el('div', { class: 'rounded-3 bg-primary text-white p-4 mb-3 shadow-sm' }, [
    el('div', { class: 'h4 fw-bold mb-1', text: `${sapaan(jamWib())}${user.nama ? ', ' + user.nama : ''}!` }),
    el('div', { class: 'text-white-50', text: tanggal }),
  ]);

  const akses = [
    { label: 'Buat Jalur', href: '#/jalur/buat' },
    { label: 'Input Laporan', href: '#/input' },
    { label: 'Rekonsiliasi Flazz', href: '#/flazz/rekon' },
  ];
  const aksesCepat = kartuPanel('Akses Cepat', null, el('div', { class: 'row g-2' }, akses.map((a) =>
    el('div', { class: 'col-6 col-md-4' }, [
      el('a', { class: 'd-block border rounded-3 p-3 fw-bold text-decoration-none text-dark h-100', href: a.href, text: a.label }),
    ]))));

  // Peringatan Dini
  const jumlahWarn = el('span', { class: 'badge rounded-pill text-bg-danger ms-1', text: '0' });
  const pilihCabang = el('select', { class: 'form-select form-select-sm d-none', style: 'width:auto' }, [el('option', { value: '', text: 'Semua Warehouse' })]);
  const tombolWarn = el('button', { class: 'btn btn-outline-primary btn-sm', type: 'button', text: 'Refresh' });
  const isiWarn = el('div', { class: 'text-muted', text: 'Memeriksa peringatan…' });
  const panelWarn = kartuPanel(['Peringatan Dini', jumlahWarn], el('div', { class: 'd-flex gap-2 align-items-center' }, [pilihCabang, tombolWarn]), isiWarn);
  let cacheWarn = null;

  function itemPajak(r) {
    return el('a', { class: 'list-group-item list-group-item-action', href: '#/jalur' }, [
      el('div', { class: 'fw-bold' }, [`${r.plat_nomor} - ${r.nama_kendaraan}`, badgeCabang(r.cabang, isSuper)]),
      el('div', { class: 'small text-muted' }, r.alerts.map((a) => el('div', {}, [
        el('span', { class: `badge ${WARN_KELAS[a.status] || 'text-bg-secondary'}`, text: a.status }),
        ` ${LABEL_DOK[a.tipe] || a.tipe}${a.sisa_hari != null ? ` | sisa ${a.sisa_hari} hari` : ''}${a.tanggal ? ` | ${a.tanggal}` : ''}`,
      ]))),
    ]);
  }
  function itemSaldo(c) {
    const masked = samarkanNomor(c.card_number);
    return el('a', { class: 'list-group-item list-group-item-action d-flex justify-content-between align-items-center', href: '#/flazz/topup' }, [
      el('div', {}, [
        el('div', { class: 'fw-bold' }, [c.card_name || masked, badgeCabang(c.cabang, isSuper)]),
        el('div', { class: 'small text-muted', text: `${masked}${c.card_type ? ' | ' + c.card_type : ''}` }),
      ]),
      el('div', { class: 'text-danger fw-bold', text: rp(c.last_balance) }),
    ]);
  }
  function itemOli(r) {
    const bisaReset = isSuper || (user.role === 'PIC CABANG' && String(r.cabang) === String(user.cabang));
    const tombol = bisaReset ? el('button', { class: 'btn btn-sm btn-outline-success ms-2', type: 'button', text: 'Oli Diganti' }) : null;
    tombol?.addEventListener('click', async () => {
      if (!confirmDialog('Tandai oli kendaraan ini sudah diganti? Baseline akan di-set ke odometer saat ini.')) return;
      tombol.disabled = true;
      try {
        const res = await post(`/api/master/kendaraan/${encodeURIComponent(r.vehicle_id)}/reset-oli`, {});
        toast(res.msg || 'Baseline ganti oli diperbarui.', 'success');
        await muatWarn(true);
      } catch (err) {
        toast(err.message, 'error');
        tombol.disabled = false;
      }
    });
    return el('div', { class: 'list-group-item d-flex justify-content-between align-items-center' }, [
      el('div', {}, [
        el('div', { class: 'fw-bold' }, [`${r.plat_nomor} - ${r.nama_kendaraan}`, badgeCabang(r.cabang, isSuper)]),
        el('div', { class: 'small text-muted' }, [
          el('span', { class: `badge ${OLI_KELAS[r.status] || 'text-bg-secondary'}`, text: r.status }),
          ` ${teksOli(r)} | tempuh ${r.tempuh_km} KM`,
        ]),
      ]),
      tombol,
    ]);
  }
  function itemOdo(r) {
    return el('div', { class: 'list-group-item' }, [
      el('div', { class: 'fw-bold' }, [`${r.plat_nomor} - ${r.nama_kendaraan}`, badgeCabang(r.cabang, isSuper)]),
      el('div', { class: 'small text-muted' }, [
        el('span', { class: 'badge text-bg-warning', text: 'ESTIMASI' }),
        ' KM trip terakhir dihitung dari estimasi, odometer belum terbaca normal — mohon segera diperbaiki.',
      ]),
    ]);
  }
  const daftar = (items, render, teksKosong) => (items.length
    ? el('div', { class: 'list-group list-group-flush' }, items.map(render))
    : kosong(teksKosong));

  function gambarWarn() {
    if (!cacheWarn) return;
    const w = saringPeringatan(cacheWarn, isSuper ? pilihCabang.value : '');
    jumlahWarn.textContent = String(w.total);
    setJumlahPeringatan(w.total);
    isiWarn.className = 'row';
    isiWarn.replaceChildren(
      el('div', { class: 'col-lg-6 mb-3' }, [judulSeksi('Pajak & KIR Kendaraan'), daftar(w.pajakKIR, itemPajak, 'Semua aman - tidak ada kendaraan yang pajak/KIR-nya kritis.')]),
      el('div', { class: 'col-lg-6 mb-3' }, [judulSeksi('Saldo Kartu Etoll < Rp100.000'), daftar(w.saldo, itemSaldo, 'Semua aman - tidak ada kartu etoll di bawah Rp100.000.')]),
      el('div', { class: 'col-12 mb-3' }, [judulSeksi('Ganti Oli Kendaraan'), daftar(w.oli, itemOli, 'Semua aman - jarak tempuh oli seluruh kendaraan masih di bawah ambang.')]),
      el('div', { class: 'col-12 mb-3' }, [judulSeksi('Odometer Tidak Terbaca (Estimasi)'), daftar(w.odoEstimasi, itemOdo, 'Semua aman - tidak ada kendaraan dengan odometer tidak terbaca.')]),
    );
  }
  async function muatWarn(fresh = false) {
    tombolWarn.disabled = true;
    try {
      cacheWarn = await get(`/api/dashboard/warnings${fresh ? '?fresh=1' : ''}`);
      gambarWarn();
    } catch (err) {
      isiWarn.className = 'text-muted';
      isiWarn.textContent = 'Gagal memuat peringatan.';
      toast(`Gagal memuat peringatan: ${err.message}`, 'error');
    } finally {
      tombolWarn.disabled = false;
    }
  }
  tombolWarn.addEventListener('click', () => muatWarn(true));
  pilihCabang.addEventListener('change', gambarWarn);

  // Status Kartu Etoll
  const tombolKartu = el('button', { class: 'btn btn-outline-primary btn-sm', type: 'button', text: 'Refresh' });
  const isiKartu = el('div', { class: 'text-muted', text: 'Memuat data kartu etoll…' });
  const panelKartu = kartuPanel('Status Kartu Etoll', tombolKartu, isiKartu);
  async function muatKartu() {
    tombolKartu.disabled = true;
    try {
      const data = await get('/api/flazz/dashboard');
      const cards = data.cards || [];
      const r = ringkasKartu(cards, data.topups);
      const kotak = (kelas, label, nilai) => el('div', { class: 'col-md-4' }, [el('div', { class: `rounded-3 ${kelas} text-white p-3 h-100` }, [
        el('div', { class: 'small text-white-50', text: label }), el('div', { class: 'h5 fw-bold mb-0', text: nilai }),
      ])]);
      isiKartu.className = '';
      isiKartu.replaceChildren(
        r.aktif > 0 ? el('div', { class: 'alert alert-warning' }, [
          el('strong', { text: 'Peringatan! ' }), `Ada ${r.aktif} kartu Flazz berstatus "Sedang Digunakan". Jika fisik kartu sudah dikembalikan oleh supir ke Admin, Anda mungkin terlewat melakukan `,
          el('a', { href: '#/flazz/rekon', class: 'alert-link', text: 'Rekonsiliasi Flazz' }), ' hari ini.',
        ]) : null,
        el('div', { class: 'row g-3 mb-3' }, [
          kotak('bg-primary', 'Total Kartu Aktif', `${r.aktif} dari ${r.total}`),
          kotak('bg-success', 'Total Saldo (Seluruh Kartu)', rp(r.saldo)),
          kotak('bg-info', 'Top Up Terakhir', r.topupTerakhir ? `${rp(r.topupTerakhir.amount)} (${fmtDateId(r.topupTerakhir.date)})` : '-'),
        ]),
        el('div', { class: 'table-wrap' }, [el('table', { class: 'table table-hover align-middle' }, [
          el('thead', { class: 'table-light' }, [el('tr', {}, ['Nomor Kartu', 'Tipe', 'Driver/Kendaraan', 'Saldo Terakhir', 'Status'].map((h) => el('th', { text: h })))]),
          el('tbody', {}, cards.map((c) => el('tr', {}, [
            el('td', { class: 'fw-bold', text: c.card_number || '-' }),
            el('td', { text: c.card_type || '-' }),
            el('td', { text: c.driver_id || '-' }),
            el('td', { class: 'fw-bold', text: rp(c.last_balance) }),
            el('td', {}, [el('span', { class: `badge ${KARTU_KELAS[c.status] || 'bg-secondary'}`, text: c.status || '-' })]),
          ]))),
        ])]),
      );
    } catch (err) {
      isiKartu.className = 'text-muted';
      isiKartu.textContent = `Gagal memuat data Flazz: ${err.message}`;
    } finally {
      tombolKartu.disabled = false;
    }
  }
  tombolKartu.addEventListener('click', muatKartu);

  // Galeri Foto Terbaru
  const isiGaleri = el('div', { class: 'row g-2' }, [el('div', { class: 'col-12 text-center text-muted py-4', text: 'Memuat galeri…' })]);
  const panelGaleri = kartuPanel('Galeri Foto Terbaru', el('a', { href: '#/galeri', class: 'small text-decoration-none', text: 'Lihat Semua →' }), isiGaleri);
  async function muatGaleri() {
    try {
      const { transactions = [] } = await get('/api/dashboard');
      const items = transactions.map((r) => ({ r, foto: fotoPertama(r) })).filter((x) => x.foto).slice(0, 6);
      isiGaleri.replaceChildren(...(items.length ? items.map(({ r, foto }) => el('div', { class: 'col-6 col-md-2' }, [
        el('a', { href: foto.url, target: '_blank', rel: 'noopener', class: 'text-decoration-none' }, [el('div', { class: 'border rounded-3 overflow-hidden h-100' }, [
          el('img', { src: foto.thumb, alt: 'foto operasional', class: 'w-100', style: 'aspect-ratio:4/3;object-fit:cover' }),
          el('div', { class: 'py-1 px-2 small text-truncate text-dark', text: fmtDateId(r.tanggal) }),
        ])]),
      ])) : [el('div', { class: 'col-12 text-center text-muted py-4', text: 'Belum ada foto operasional.' })]));
    } catch (err) {
      isiGaleri.replaceChildren(el('div', { class: 'col-12 text-muted', text: `Gagal memuat galeri: ${err.message}` }));
    }
  }

  view.replaceChildren(salam, aksesCepat, panelWarn, panelKartu, panelGaleri);

  if (isSuper) {
    try {
      const master = await get('/api/master');
      const cabang = Array.isArray(master.cabangList) ? master.cabangList : [];
      if (cabang.length > 1) {
        cabang.forEach((c) => pilihCabang.appendChild(el('option', { value: c.kode, text: c.nama || c.kode })));
        pilihCabang.classList.remove('d-none');
      }
    } catch {
      // Filter warehouse opsional; peringatan tetap tampil untuk semua warehouse.
    }
  }
  await Promise.all([muatWarn(), muatKartu(), muatGaleri()]);
  return { ok: true };
}
