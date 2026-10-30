// Excel data pajak & KIR kendaraan (Dashboard › Peringatan Dini). Fungsi murni, diuji di tests/frontend/pajak-kir.test.ts.

const URUT = { LEWAT: 3, KRITIS: 2, WASPADA: 1, AMAN: 0, '': -1 };
const DOK = [['pajak', 'Pajak Tahunan', 'tanggal_pajak'], ['pajak5', 'Pajak 5 Tahunan', 'tanggal_pajak_5_tahunan'], ['kir', 'KIR', 'tanggal_kir']];

export const hariIniWib = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const tglId = (t) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(t || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
};

// Ambang sama dengan peringatan dini di server (src/logic/warnings.ts): ≤0 hari LEWAT, ≤30 KRITIS, ≤60 WASPADA, selebihnya AMAN.
export function statusTanggal(tanggal, today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(tanggal || ''));
  const t = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ''));
  if (!m || !t) return { tanggal: '', sisa: null, status: '' };
  const sisa = Math.ceil((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(+t[1], +t[2] - 1, +t[3])) / 86_400_000);
  const status = sisa <= 0 ? 'LEWAT' : sisa <= 30 ? 'KRITIS' : sisa <= 60 ? 'WASPADA' : 'AMAN';
  return { tanggal: `${m[1]}-${m[2]}-${m[3]}`, sisa, status };
}

// Satu baris per kendaraan aktif; motor tidak punya pajak 5 tahunan & KIR (dikosongkan). Urut: paling mendesak dulu.
/** @param {any[]} vehicles @param {{ today?: string, cabang?: string, namaCabang?: Record<string, string> }} [opsi] @returns {any[]} */
export function barisPajakKir(vehicles, { today = '', cabang = '', namaCabang = {} } = {}) {
  const baris = (vehicles || [])
    .filter((v) => !cabang || String(v.cabang) === String(cabang))
    .map((v) => {
      const motor = /motor/i.test(String(v.jenis || ''));
      const dok = {};
      for (const [kunci, , field] of DOK) {
        dok[kunci] = motor && kunci !== 'pajak' ? { tanggal: '', sisa: null, status: '', na: true } : statusTanggal(v[field], today);
      }
      const terburuk = Object.values(dok).reduce((w, d) => ((URUT[d.status] ?? -1) > (URUT[w] ?? -1) ? d.status : w), '');
      const minSisa = Math.min(...Object.values(dok).map((d) => (d.sisa == null ? Infinity : d.sisa)));
      return { cabang: String(v.cabang || ''), namaCabang: namaCabang[v.cabang] || String(v.cabang || ''), plat: String(v.plat_nomor || ''), nama: String(v.nama || ''), jenis: String(v.jenis || ''), dok, terburuk, minSisa };
    });
  return baris.sort((a, b) => (URUT[b.terburuk] ?? -1) - (URUT[a.terburuk] ?? -1) || a.minSisa - b.minSisa || a.plat.localeCompare(b.plat));
}

/** @param {any[]} baris */
export function ringkasPajakKir(baris) {
  const hitung = (s) => baris.filter((b) => b.terburuk === s).length;
  return { total: baris.length, lewat: hitung('LEWAT'), kritis: hitung('KRITIS'), waspada: hitung('WASPADA'), aman: hitung('AMAN'), kosong: hitung('') };
}

// Spesifikasi sheet untuk bukuExcel (pages/rekap.js).
/** @param {any[]} baris @param {{ warehouse?: string, today?: string }} [opsi] */
export function sheetPajakKir(baris, { warehouse = 'Semua Warehouse', today = '' } = {}) {
  const r = ringkasPajakKir(baris);
  const kepalaDok = DOK.flatMap(([, label]) => [`${label} — Jatuh Tempo`, `${label} — Sisa Hari`, `${label} — Status`]);
  const awalTabel = 5;
  return [{
    nama: 'Pajak & KIR',
    aoa: [
      ['Data Pajak & KIR Kendaraan'],
      ['Per tanggal', tglId(today)],
      ['Warehouse', warehouse],
      ['Ringkasan', `Lewat: ${r.lewat} | Kritis (≤30 hari): ${r.kritis} | Waspada (≤60 hari): ${r.waspada} | Aman: ${r.aman} | Belum diisi: ${r.kosong}`],
      [],
      ['No', 'Warehouse', 'Plat Nomor', 'Nama Kendaraan', 'Jenis', ...kepalaDok, 'Status Terburuk'],
      ...baris.map((b, i) => [i + 1, b.namaCabang, b.plat, b.nama, b.jenis, ...DOK.flatMap(([k]) => [tglId(b.dok[k].tanggal), b.dok[k].sisa ?? '', b.dok[k].status]), b.terburuk || '-']),
      ['', 'TOTAL KENDARAAN', r.total, '', '', ...DOK.flatMap(() => ['', '', '']), ''],
    ],
    angka: { kolom: [] },
    filter: true,
    awalTabel,
  }];
}

export const namaFilePajakKir = (kodeWh, today) => `pajak-kir-${kodeWh || 'semua'}-${today}.xlsx`;
