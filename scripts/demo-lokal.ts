// Server demo LOKAL yang terisolasi: seluruh aplikasi (API + tampilan) berjalan dengan data PALSU di memori.
//   npm run demo      -> buka http://localhost:8788
// TIDAK memakai Supabase/Cloudflare/.dev.vars sama sekali, jadi aman: tidak menyentuh data produksi dan
// tidak mengubah apa pun di PIC cabang. Data hilang saat server dihentikan (Ctrl+C).
// Bawaan kas kecil Karawang kosong (hanya saldo awal); npm run demo -- --contoh = dengan contoh transaksi.
// Akun demo (password semua: demo123): super (SUPERADMIN), pic.kwg (PIC Karawang), pic.bdg (PIC Whp Bandung), mgmt (MANAGEMENT).
import { readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildApp } from '../src/app';
import { hashPassword } from '../src/auth/password';
import { todayWib } from '../src/logic/jalur';
import { laporanRow, makeDeps, memFlazz, memKasKecil, memLaporan, memMaster } from '../tests/helpers';
import type { KasJenisRow } from '../src/db/kaskecil';
import { uraiPecahan } from '../src/logic/kaskecil';
import type { KasKeluarRow, KasMasukRow } from '../src/logic/kaskecil';

const PORT = Number(process.env.PORT || 8788);
const STATIC = fileURLToPath(new URL('../static/', import.meta.url));
const PASSWORD = 'demo123';

// ── Data palsu ──────────────────────────────────────────────────────────────
const hariIni = todayWib();
const bulan = hariIni.slice(0, 7);
const hari = (d: number) => `${bulan}-${String(d).padStart(2, '0')}`;
const tanggalSampai = Math.max(2, Math.min(Number(hariIni.slice(8)), 20));

const hash = await hashPassword(PASSWORD);
const cabang = [
  { kode_cabang: 'KWG', nama_cabang: 'Who Karawang', lokasi: '', status: 'Aktif' },
  { kode_cabang: 'BDG', nama_cabang: 'Who Bandung', lokasi: '', status: 'Aktif' },
  { kode_cabang: 'GDGBDG', nama_cabang: 'Whp Bandung', lokasi: '', status: 'Aktif' },
  { kode_cabang: 'BGR', nama_cabang: 'Who Bogor', lokasi: '', status: 'Aktif' },
];
const pengguna = [
  { user_id: 'U-1', username: 'super', nama: 'Admin Pusat (demo)', role: 'SUPERADMIN', kode_cabang: '', status: 'Aktif', password: hash },
  { user_id: 'U-2', username: 'pic.kwg', nama: 'Gin Gin Ginanjar (demo)', role: 'PIC CABANG', kode_cabang: 'KWG', status: 'Aktif', password: hash },
  { user_id: 'U-3', username: 'pic.bdg', nama: 'PIC Whp Bandung (demo)', role: 'PIC CABANG', kode_cabang: 'GDGBDG', status: 'Aktif', password: hash },
  { user_id: 'U-4', username: 'mgmt', nama: 'Manajemen (demo)', role: 'MANAGEMENT', kode_cabang: '', status: 'Aktif', password: hash },
];
const kendaraan = [
  { vehicle_id: 'V-KWG1', plat_nomor: 'D 8119 EZ', nama_kendaraan: 'Grand Max Blind Van', jenis_kendaraan: 'Mobil', merk: 'Daihatsu', model: 'Blind Van', kapasitas_tangki: 43, jumlah_bar: 8, standar_km_l: 10, kode_cabang: 'KWG', status: 'Aktif', jenis_indikator: 'DIGITAL_BAR', tanggal_pajak: '', tanggal_pajak_5_tahunan: '', tanggal_kir: '', km_terakhir_ganti_oli: 0, interval_ganti_oli_km: 5000, cabang_bersama: '' },
];
const supir = [{ supir_id: 'S-1', nama_supir: 'Haris Riswanto', kode_cabang: 'KWG', default_vehicle_id: 'V-KWG1', status: 'Aktif' }];
const kartu = [
  { id: 'FLZ-KWG1', card_number: '0145 0082 0168 3850', card_name: 'KWG 01', card_type: 'FLAZZ', card_role: 'UTAMA', branch_id: 'KWG', driver_id: '', default_driver_id: 'S-1', last_balance: 400000, status: 'TERSEDIA', notes: '', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z' },
];

// Jenis kas kecil: ambil dari seed db/kas-kecil.sql (sama dengan produksi nanti).
const seedSql = readFileSync(fileURLToPath(new URL('../db/kas-kecil.sql', import.meta.url)), 'utf8');
const jenis: KasJenisRow[] = [...seedSql.matchAll(/\('(KJ-\d+)', '([^']*)', '((?:[^']|'')*)', '([^']*)', '([^']*)', (true|false), (true|false), (\d+)\)/g)]
  .map((m) => ({ id: m[1]!, kode_akun: m[2]!, nama: m[3]!.replace(/''/g, "'"), prefiks_ref: m[4]!, tipe: m[5]!, tanpa_penyelesaian: m[6] === 'true', aktif: m[7] === 'true', urut: Number(m[8]) }));
const jenisId = (nama: string) => jenis.find((j) => j.nama === nama)!;

let nomor = 0;
const keluar: KasKeluarRow[] = [];
const masuk: KasMasukRow[] = [];
const buatKK = (d: number, jam: string, namaJenis: string, penerima: string, jumlah: number, kembali: number | null, penerima2 = '') => {
  const j = jenisId(namaJenis);
  const id = `KK-WHO-KWG-${bulan.replace('-', '')}${String(d).padStart(2, '0')}${String(++nomor).padStart(4, '0')}`;
  const ref = j.prefiks_ref ? `${j.prefiks_ref}-WHO-KWG-${bulan.replace('-', '')}${String(d).padStart(2, '0')}${String(nomor).padStart(4, '0')}` : '';
  const kk: KasKeluarRow = { id, kode_cabang: 'KWG', tanggal: hari(d), jam, no_referensi: ref, penerima, penerima_2: penerima2, admin: 'Gin Gin Ginanjar (demo)', jenis_id: j.id, kode_akun: j.kode_akun, jenis: j.nama, pecahan: uraiPecahan(jumlah), jumlah, keterangan: j.nama, status: kembali === null && !j.tanpa_penyelesaian ? 'Open' : 'Closed', no_kas_masuk: '', created_by: 'pic.kwg', created_at: new Date().toISOString(), is_deleted: '' };
  if (kembali !== null && kembali > 0) {
    const km: KasMasukRow = { id: id.replace('KK-', 'KM-'), kode_cabang: 'KWG', tanggal: hari(d), jam: '16:30:00', no_kas_keluar: id, no_referensi: ref, penerima, penerima_2: penerima2, admin: kk.admin, jenis_id: j.id, kode_akun: j.kode_akun, jenis: j.nama, pecahan: uraiPecahan(kembali), jumlah: kembali, keterangan: '', created_by: 'pic.kwg', created_at: new Date().toISOString(), is_deleted: '' };
    masuk.push(km);
    kk.no_kas_masuk = km.id;
  }
  keluar.push(kk);
};
const laporan: ReturnType<typeof laporanRow>[] = [];
const topups: any[] = [];
// Bawaan: kas kecil Karawang KOSONG (hanya saldo awal), meniru awal bulan tanpa migrasi transaksi. Contoh transaksi: npm run demo -- --contoh
const CONTOH = process.argv.includes('--contoh');
for (let d = 1; CONTOH && d <= tanggalSampai; d++) {
  buatKK(d, '09:10:00', 'Biaya Uang Muka Delivery', 'Haris Riswanto', 100000, d % 2 ? 100000 : 60000, 'Rakhman Hakim');
  buatKK(d, '10:05:00', 'Biaya Retribusi', 'Haris Riswanto', 10000, 0);
  if (d % 2 === 0) {
    buatKK(d, '10:30:00', 'Biaya Bensin Delivery', 'Haris Riswanto', 250000, 0);
    // Laporan aplikasi: BBM tunai cocok di hari genap, selisih Rp 50.000 di hari kelipatan 6 (agar terlihat tanda Selisih).
    laporan.push(laporanRow({ transaction_id: `TRX-${d}`, tanggal: hari(d), kode_cabang: 'KWG', vehicle_id: 'V-KWG1', plat_nomor: 'D 8119 EZ', nama_supir: 'Haris Riswanto', biaya_bbm: d % 6 === 0 ? 200000 : 250000, metode_pembayaran: 'TUNAI', metode_toll: 'TUNAI', biaya_toll: 0 }));
  }
  if (d === 3) {
    buatKK(d, '11:00:00', 'Biaya Pengisian ETOLL', 'Haris Riswanto', 300000, 0);
    topups.push({ id: 'TOP-1', date: hari(d), card_id: 'FLZ-KWG1', amount: 300000, evidence_url: '', notes: 'top up awal', created_by: 'pic.kwg', created_at: new Date().toISOString(), is_deleted: '0' });
  }
}
if (CONTOH) buatKK(tanggalSampai, '14:00:00', 'Biaya Uang Muka Delivery', 'Haris Riswanto', 150000, null); // Open: belum diselesaikan

const master = memMaster({ cabang, kendaraan: kendaraan as any, supir: supir as any, pengguna: pengguna as any, flazzCard: [] });
const lap = memLaporan({ rows: laporan });
const flz = memFlazz({ cards: kartu as any, topups });
const kas = memKasKecil({ jenis, saldoAwal: { KWG: { tanggal: hari(1), jumlah: 5_000_000, dana_mingguan: 2_000_000, pecahan: { '100000': 40, '50000': 6, '20000': 10, '10000': 20, '5000': 20, '2000': 25, '1000': 50, '500': 100, '200': 100, '100': 100, '50': 400 } } }, keluar, masuk });
const { deps } = makeDeps({
  master: master.repo, laporan: lap.repo, flazz: flz.repo, jalur: undefined as any, kaskecil: kas.repo, now: () => Date.now(),
  findByUsername: async (u) => {
    const p = pengguna.find((x) => x.username.toLowerCase() === u.toLowerCase());
    return p ? { user_id: p.user_id, username: p.username, password: p.password, nama: p.nama, role: p.role, kode_cabang: p.kode_cabang, status: p.status } : null;
  },
});
delete (deps as any).jalur;
const { memJalur } = await import('../tests/helpers');
deps.jalur = memJalur(lap.state.jalur).repo;

const TIPE: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const env: any = {
  SUPABASE_URL: 'http://tidak-dipakai.invalid', SUPABASE_SERVICE_ROLE_KEY: 'demo', SESSION_KV: deps.kv,
  ASSETS: {
    fetch: async (req: Request) => {
      let p = decodeURIComponent(new URL(req.url).pathname);
      if (p === '/' || p === '') p = '/index.html';
      const file = normalize(join(STATIC, p));
      if (!file.startsWith(STATIC) || !existsSync(file) || !statSync(file).isFile()) return new Response('tidak ditemukan', { status: 404 });
      return new Response(readFileSync(file), { headers: { 'Content-Type': TIPE[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' } });
    },
  },
};
const app = buildApp(env, deps);

createServer(async (rq, rs) => {
  const bagian: Buffer[] = [];
  for await (const b of rq) bagian.push(b as Buffer);
  const body = bagian.length ? Buffer.concat(bagian) : undefined;
  const headers = new Headers();
  for (const [k, v] of Object.entries(rq.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  const res = await app.fetch(new Request(`http://localhost:${PORT}${rq.url}`, { method: rq.method, headers, body: ['GET', 'HEAD'].includes(rq.method ?? 'GET') ? undefined : body }), env, { waitUntil() {}, passThroughOnException() {} } as any);
  rs.writeHead(res.status, Object.fromEntries(res.headers));
  rs.end(Buffer.from(await res.arrayBuffer()));
}).listen(PORT, () => {
  console.log(`\nDEMO LOKAL (data palsu di memori, tidak terhubung ke produksi)\n  Buka: http://localhost:${PORT}\n  Akun (password ${PASSWORD}): super | pic.kwg | pic.bdg | mgmt (Kas Kecil: login super)\n  Kas kecil Karawang: ${CONTOH ? 'CONTOH transaksi' : 'KOSONG, hanya saldo awal (npm run demo -- --contoh untuk contoh transaksi)'}\n  Hentikan: Ctrl+C\n`);
});
