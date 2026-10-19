import { get } from './api.js';
import { getJumlahPeringatan, getUser, setJumlahPeringatan } from './store.js';
import { el, fmtNum } from './ui.js';
import { bolehTulis } from './peran.js';

// Lonceng notifikasi bilah atas: tugas hari ini (laporan/rekonsiliasi belum selesai) +
// Peringatan Dini (pajak/KIR, saldo etoll, ganti oli, odometer estimasi). Data dari
// /api/tugas-hari-ini dan /api/dashboard/warnings; dimuat saat boot, tiap 5 menit, dan
// saat lonceng dibuka.

const LABEL_DOK = { PAJAK: 'Pajak', PAJAK5: 'Pajak 5 tahunan', KIR: 'KIR' };
const KELAS_STATUS = { LEWAT: 'text-bg-danger', KRITIS: 'text-bg-warning', WASPADA: 'text-bg-info', GANTI_OLI: 'text-bg-danger' };

// Daftar notifikasi siap tampil (murni, diuji). href = halaman tindak lanjut.
// boleh = false (MANAGEMENT, read-only): tautan ke halaman tulis dialihkan ke halaman baca.
export function susunNotifikasi(warn, tugas, boleh = true) {
  const out = [];
  for (const t of tugas?.item || []) {
    const lewat = Boolean(t.tanggal && tugas.tanggal && t.tanggal < tugas.tanggal);
    const perlu = (t.perlu || []).map((p) => (p === 'LAPORAN' ? 'laporan' : 'rekonsiliasi')).join(' & ');
    out.push({
      grup: 'Tugas belum selesai', judul: `${t.plat_nomor} — ${t.nama_driver}`,
      ket: `Belum ${perlu}` + (!boleh && t.kode_cabang ? ` · ${t.kode_cabang}` : '') + (lewat ? ` · jalur ${t.tanggal.slice(8, 10)}/${t.tanggal.slice(5, 7)}` : ''),
      badge: lewat ? 'Tertunggak' : 'Hari ini', kelas: lewat ? 'text-bg-dark' : 'text-bg-danger',
      href: !boleh ? '#/jalur' : (t.perlu || []).includes('LAPORAN') ? '#/input' : '#/flazz/rekon',
    });
  }
  for (const r of warn?.pajakKIR || []) {
    const a = (r.alerts || [])[0] || {};
    out.push({
      grup: 'Pajak & KIR', judul: `${r.plat_nomor} — ${r.nama_kendaraan}`,
      ket: (r.alerts || []).map((x) => `${LABEL_DOK[x.tipe] || x.tipe}${x.sisa_hari != null ? (x.sisa_hari < 0 ? ` lewat ${Math.abs(x.sisa_hari)} hari` : ` sisa ${x.sisa_hari} hari`) : ''}`).join(' · '),
      badge: r.worst || a.status || '', kelas: KELAS_STATUS[r.worst || a.status] || 'text-bg-secondary', href: '#/dashboard',
    });
  }
  for (const c of warn?.saldo || []) {
    out.push({ grup: 'Saldo etoll rendah', judul: c.card_name || c.card_number, ket: `Saldo Rp ${fmtNum(c.last_balance)}`, badge: '< 100rb', kelas: 'text-bg-warning', href: boleh ? '#/flazz/topup' : '#/flazz' });
  }
  for (const r of warn?.oli || []) {
    out.push({
      grup: 'Ganti oli', judul: `${r.plat_nomor} — ${r.nama_kendaraan}`,
      ket: r.status === 'GANTI_OLI' ? `Lewat ${fmtNum(Math.abs(r.sisa_km))} KM dari interval` : `Sisa ${fmtNum(r.sisa_km)} KM`,
      badge: r.status === 'GANTI_OLI' ? 'GANTI OLI' : 'WASPADA', kelas: KELAS_STATUS[r.status] || 'text-bg-info', href: '#/dashboard',
    });
  }
  for (const r of warn?.odoEstimasi || []) {
    out.push({ grup: 'Odometer estimasi', judul: `${r.plat_nomor} — ${r.nama_kendaraan}`, ket: 'KM trip terakhir dari estimasi', badge: 'ESTIMASI', kelas: 'text-bg-warning', href: '#/dashboard' });
  }
  return out;
}

let cache = { warn: null, tugas: null, waktu: 0 };
const pendengar = new Set();

export function jumlahNotifikasi() {
  return susunNotifikasi(cache.warn, cache.tugas, bolehTulis(getUser()?.role)).length;
}

export async function muatLonceng() {
  if (!getUser()) return;
  const [warn, tugas] = await Promise.all([
    get('/api/dashboard/warnings').catch(() => cache.warn),
    get('/api/tugas-hari-ini').catch(() => cache.tugas),
  ]);
  cache = { warn, tugas, waktu: Date.now() };
  if (warn) {
    const total = ['pajakKIR', 'saldo', 'oli', 'odoEstimasi'].reduce((s, k) => s + (warn[k] || []).length, 0);
    // Hanya bila berubah: setJumlahPeringatan menggambar ulang topbar (panel yang terbuka ikut tertutup).
    if (total !== getJumlahPeringatan()) setJumlahPeringatan(total);
  }
  pendengar.forEach((fn) => fn());
}

let mulai = false;
export function mulaiLonceng() {
  if (mulai) return;
  mulai = true;
  muatLonceng();
  setInterval(() => { if (!document.hidden) muatLonceng(); }, 5 * 60_000);
  window.addEventListener('data-berubah', () => setTimeout(muatLonceng, 600));
}

// Tutup panel saat klik di luar / Esc (satu pendengar; topbar digambar ulang tiap pindah halaman).
function tutupSemua(e) {
  document.querySelectorAll('.panel-lonceng:not(.d-none)').forEach((p) => {
    if (e?.type === 'click' && p.parentElement?.contains(e.target)) return;
    p.classList.add('d-none');
  });
}
if (typeof document !== 'undefined') {
  document.addEventListener('click', tutupSemua);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') tutupSemua(e); });
}

export function tombolLonceng() {
  const badge = el('span', { class: 'badge rounded-pill bg-danger lonceng-badge d-none' });
  const tombol = el('button', { type: 'button', class: 'btn btn-light btn-sm tombol-ikon position-relative', 'aria-label': 'Notifikasi', 'aria-haspopup': 'true' }, [
    el('i', { class: 'bi bi-bell', 'aria-hidden': 'true' }), badge,
  ]);
  const isi = el('div', { class: 'lonceng-isi' });
  const panel = el('div', { class: 'panel-lonceng d-none', role: 'dialog', 'aria-label': 'Notifikasi' }, [
    el('div', { class: 'd-flex justify-content-between align-items-center px-3 py-2 border-bottom' }, [
      el('span', { class: 'fw-bold', text: 'Notifikasi' }),
      el('a', { href: '#/dashboard', class: 'small text-decoration-none', text: 'Lihat Dashboard' }),
    ]),
    isi,
  ]);

  function gambar() {
    const n = jumlahNotifikasi();
    badge.textContent = n > 99 ? '99+' : String(n);
    badge.classList.toggle('d-none', !n);
    tombol.title = n ? `${n} notifikasi` : 'Tidak ada notifikasi';
    const list = susunNotifikasi(cache.warn, cache.tugas, bolehTulis(getUser()?.role));
    if (!cache.waktu) { isi.replaceChildren(el('div', { class: 'p-3 small text-muted', text: 'Memuat notifikasi…' })); return; }
    if (!list.length) { isi.replaceChildren(el('div', { class: 'p-3 small text-muted text-center', text: 'Tidak ada notifikasi. Semua aman.' })); return; }
    const anak = [];
    let grup = '';
    for (const x of list) {
      if (x.grup !== grup) { grup = x.grup; anak.push(el('div', { class: 'menu-judul', text: grup })); }
      anak.push(el('a', { class: 'lonceng-item', href: x.href }, [
        el('div', { class: 'd-flex justify-content-between gap-2' }, [
          el('span', { class: 'fw-semibold text-truncate', text: x.judul }),
          x.badge ? el('span', { class: `badge ${x.kelas} flex-shrink-0`, text: x.badge }) : null,
        ].filter(Boolean)),
        el('div', { class: 'small text-muted', text: x.ket }),
      ]));
    }
    isi.replaceChildren(...anak);
  }
  // Hanya satu lonceng aktif (topbar digambar ulang tiap pindah halaman).
  pendengar.clear();
  pendengar.add(gambar);
  gambar();
  if (!cache.waktu) muatLonceng();

  tombol.addEventListener('click', (e) => {
    e.stopPropagation();
    const buka = panel.classList.toggle('d-none') === false;
    if (buka && Date.now() - cache.waktu > 30_000) muatLonceng();
  });
  panel.addEventListener('click', (e) => { if (e.target.closest('a')) panel.classList.add('d-none'); });
  return el('div', { class: 'position-relative' }, [tombol, panel]);
}
