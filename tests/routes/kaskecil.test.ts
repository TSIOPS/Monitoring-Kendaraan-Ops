import { describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app';
import { authHeaders, fakeEnv, loginAs, makeDeps, memKasKecil, memMaster } from '../helpers';
import type { SessionUser } from '../../src/deps';
import type { KasJenisRow } from '../../src/db/kaskecil';
import { todayWib } from '../../src/logic/jalur';
import { uraiPecahan } from '../../src/logic/kaskecil';

const SUPER: SessionUser = { user_id: 'U-S', username: 'super', nama: 'Super', role: 'SUPERADMIN', cabang: '', exp: 1e15 };
const PIC: SessionUser = { user_id: 'U-P', username: 'pic', nama: 'Pic Lengkap', role: 'PIC CABANG', cabang: 'KWG', exp: 1e15 };
const PIC_B: SessionUser = { user_id: 'U-PB', username: 'picb', nama: 'Pic B', role: 'PIC CABANG', cabang: 'BDG', exp: 1e15 };
// Modul masih terbatas SUPERADMIN (PERAN_KAS_KECIL); tes fungsional membuka semua peran lewat deps, tes 'penjaga peran' memakai bawaan.
const SEMUA_PERAN = ['SUPERADMIN', 'PIC CABANG', 'MANAGEMENT'];
const MGMT: SessionUser = { user_id: 'U-M', username: 'mgmt', nama: 'Mgmt', role: 'MANAGEMENT', cabang: '', exp: 1e15 };

const CABANG = [
  { kode_cabang: 'KWG', nama_cabang: 'Who Karawang', lokasi: '', status: 'Aktif' },
  { kode_cabang: 'BDG', nama_cabang: 'WHP Bandung', lokasi: '', status: 'Aktif' },
];
const J = (id: string, nama: string, o: Partial<KasJenisRow> = {}): KasJenisRow => ({
  id, kode_akun: '6101-103', nama, prefiks_ref: 'BO', tipe: 'KELUAR', tanpa_penyelesaian: false, aktif: true, urut: 1, ...o,
});
const JENIS = [
  J('KJ-BENSIN', 'Biaya Bensin Delivery', { prefiks_ref: 'BP' }),
  J('KJ-UM', 'Biaya Uang Muka Delivery'),
  J('KJ-SETOR', 'Setoran Tunai Kas Kecil', { prefiks_ref: '', tanpa_penyelesaian: true }),
  J('KJ-CLOSING', 'Closing Kas', { prefiks_ref: '', tanpa_penyelesaian: true }),
  J('KJ-TAMBAH', 'Tambah Saldo', { prefiks_ref: '', tipe: 'MASUK' }),
  J('KJ-OFF', 'Jenis Nonaktif', { aktif: false }),
];

function setup() {
  const master = memMaster({ cabang: CABANG });
  const kas = memKasKecil({ jenis: JENIS });
  const { deps, kv, audits } = makeDeps({ kasKecilPeran: SEMUA_PERAN, master: master.repo, kaskecil: kas.repo });
  const app = buildApp(fakeEnv() as any, deps);
  return { app, kv, audits, kas };
}
type App = ReturnType<typeof buildApp>;
const h = (t: string) => ({ ...authHeaders(t), 'Content-Type': 'application/json' });
// Uang selalu dicatat per pecahan (aturan server). Agar tes lama tetap ringkas, body ber-`jumlah` bulat tanpa `pecahan` otomatis diurai; `callMentah` mengirim apa adanya.
const callMentah = (app: App, method: string, path: string, t: string, b?: unknown) =>
  app.request(path, { method, headers: h(t), body: b === undefined ? undefined : JSON.stringify(b) });
const PERLU_PECAHAN = /\/api\/kaskecil\/(keluar|masuk)(\/[^/]+\/selesai)?$/;
const call = (app: App, method: string, path: string, t: string, b?: any) => {
  if (method === 'POST' && PERLU_PECAHAN.test(path) && b && Number.isInteger(b.jumlah) && b.jumlah > 0 && b.jumlah <= 100_000_000 && !b.pecahan) b = { ...b, pecahan: uraiPecahan(b.jumlah) };
  // Jenis ber-BP butuh nomor BP manual (dari form Excel WHO); tes lama diberi nomor bawaan.
  if (method === 'POST' && /\/api\/kaskecil\/keluar$/.test(path) && b && b.jenis_id === 'KJ-BENSIN' && !b.urut_bp) b = { ...b, urut_bp: 1 };
  return callMentah(app, method, path, t, b);
};
const json = async (r: Response) => (await r.json()) as any;
const HARI = todayWib();
const BULAN = HARI.slice(0, 7).replace('-', '');

describe('kas keluar', () => {
  it('PIC membuat KK: nomor sama format Excel, referensi BP/BO, admin = nama lengkap, status Open', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const r1 = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-BENSIN', penerima: 'Agus', jumlah: 250000, keterangan: 'solar' }));
    expect(r1.keluar.id).toBe(`KK-WHO-KWG-${BULAN}${HARI.slice(8)}0001`);
    expect(r1.keluar.no_referensi).toBe(`BP-WHO-KWG-${BULAN}${HARI.slice(8)}0001`); // BP = awalan otomatis + nomor urut dari PIC
    expect(r1.keluar).toMatchObject({ admin: 'Pic Lengkap', status: 'Open', jumlah: 250000, kode_akun: '6101-103', jenis: 'Biaya Bensin Delivery', kode_cabang: 'KWG' });
    const r2 = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'Budi', pecahan: { '50000': 2 } }));
    expect(r2.keluar.id.endsWith('0002')).toBe(true);
    expect(r2.keluar.no_referensi).toBe(`BO-WHO-KWG-${BULAN}${HARI.slice(8)}0001`);
    expect(r2.keluar.jumlah).toBe(100000);
  });

  it('WHP memakai awalan WHP; jenis tanpa penyelesaian langsung Closed', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC_B);
    const r = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-CLOSING', penerima: 'Bank', jumlah: 500000 }));
    expect(r.keluar.id.startsWith('KK-WHP-BDG-')).toBe(true);
    expect(r.keluar.status).toBe('Closed');
    expect(r.keluar.no_referensi).toBe('');
  });

  it('validasi: penerima, jenis, nominal, pecahan tidak sama, tanggal masa depan', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const kirim = (b: unknown) => call(app, 'POST', '/api/kaskecil/keluar', tok, b);
    expect((await kirim({ jenis_id: 'KJ-UM', jumlah: 1000 })).status).toBe(400);
    expect((await kirim({ jenis_id: 'KJ-NOPE', penerima: 'A', jumlah: 1000 })).status).toBe(400);
    expect((await kirim({ jenis_id: 'KJ-OFF', penerima: 'A', jumlah: 1000 })).status).toBe(400);
    expect((await kirim({ jenis_id: 'KJ-TAMBAH', penerima: 'A', jumlah: 1000 })).status).toBe(400);
    expect((await kirim({ jenis_id: 'KJ-UM', penerima: 'A', jumlah: 0 })).status).toBe(400);
    expect((await kirim({ jenis_id: 'KJ-UM', penerima: 'A', jumlah: 100000001 })).status).toBe(400);
    expect((await kirim({ jenis_id: 'KJ-UM', penerima: 'A', jumlah: 1.5 })).status).toBe(400);
    expect((await kirim({ jenis_id: 'KJ-UM', penerima: 'A', jumlah: 90000, pecahan: { '50000': 2 } })).status).toBe(400);
    expect((await kirim({ jenis_id: 'KJ-UM', penerima: 'A', pecahan: { '777': 1 } })).status).toBe(400);
    expect((await kirim({ jenis_id: 'KJ-UM', penerima: 'A', jumlah: 1000, tanggal: '2999-01-01' })).status).toBe(400);
  });

  it('akses: PIC hanya cabangnya; MANAGEMENT baca saja; SUPERADMIN wajib memilih cabang', async () => {
    const { app, kv } = setup();
    const pic = await loginAs(kv, PIC);
    const b = { jenis_id: 'KJ-UM', penerima: 'A', jumlah: 1000 };
    expect((await call(app, 'POST', '/api/kaskecil/keluar', pic, { ...b, cabang: 'BDG' })).status).toBe(403);
    expect((await call(app, 'GET', '/api/kaskecil/keluar?cabang=BDG', pic)).status).toBe(403);
    const mg = await loginAs(kv, MGMT);
    expect((await call(app, 'POST', '/api/kaskecil/keluar', mg, { ...b, cabang: 'KWG' })).status).toBe(403);
    expect((await call(app, 'GET', '/api/kaskecil/keluar?cabang=KWG', mg)).status).toBe(200);
    const su = await loginAs(kv, SUPER);
    expect((await call(app, 'POST', '/api/kaskecil/keluar', su, b)).status).toBe(400);
    expect((await call(app, 'POST', '/api/kaskecil/keluar', su, { ...b, cabang: 'BDG' })).status).toBe(200);
  });

  it('PIC lain tidak bisa membuka/mengubah KK cabang lain', async () => {
    const { app, kv } = setup();
    const a = await json(await call(app, 'POST', '/api/kaskecil/keluar', await loginAs(kv, PIC), { jenis_id: 'KJ-UM', penerima: 'A', jumlah: 1000 }));
    const picB = await loginAs(kv, PIC_B);
    expect((await call(app, 'GET', '/api/kaskecil/keluar/' + a.keluar.id, picB)).status).toBe(403);
    expect((await call(app, 'DELETE', '/api/kaskecil/keluar/' + a.keluar.id, picB)).status).toBe(403);
  });

  it('ubah & hapus selama Open; terkunci setelah diselesaikan', async () => {
    const { app, kv, kas } = setup();
    const tok = await loginAs(kv, PIC);
    const a = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'A', jumlah: 100000 }));
    const id = a.keluar.id;
    expect((await call(app, 'PUT', '/api/kaskecil/keluar/' + id, tok, { penerima: 'B', jumlah: 150000, pecahan: uraiPecahan(150000) })).status).toBe(200);
    expect(kas.state.keluar[0]).toMatchObject({ penerima: 'B', jumlah: 150000 });
    expect((await call(app, 'POST', `/api/kaskecil/keluar/${id}/selesai`, tok, { jumlah: 50000 })).status).toBe(200);
    expect((await call(app, 'PUT', '/api/kaskecil/keluar/' + id, tok, { penerima: 'C' })).status).toBe(409);
    expect((await call(app, 'DELETE', '/api/kaskecil/keluar/' + id, tok)).status).toBe(409);
    expect((await call(app, 'DELETE', `/api/kaskecil/keluar/${id}/selesai`, tok)).status).toBe(200);
    expect((await call(app, 'DELETE', '/api/kaskecil/keluar/' + id, tok)).status).toBe(200);
    expect(kas.state.keluar[0]!.is_deleted).toBe('1');
  });
});

describe('penyelesaian', () => {
  it('membuat KM tertaut, KK jadi Closed; uang kembali > nominal ditolak; dobel ditolak', async () => {
    const { app, kv, kas } = setup();
    const tok = await loginAs(kv, PIC);
    const a = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'A', jumlah: 100000 }));
    const id = a.keluar.id;
    expect((await call(app, 'POST', `/api/kaskecil/keluar/${id}/selesai`, tok, { jumlah: 100001 })).status).toBe(400);
    const r = await json(await call(app, 'POST', `/api/kaskecil/keluar/${id}/selesai`, tok, { jumlah: 30000, keterangan: 'sisa' }));
    expect(r.masuk.id).toBe(`KM-WHO-KWG-${BULAN}${HARI.slice(8)}0001`);
    expect(r.masuk).toMatchObject({ no_kas_keluar: id, jumlah: 30000, no_referensi: a.keluar.no_referensi, jenis: 'Biaya Uang Muka Delivery' });
    expect(kas.state.keluar[0]).toMatchObject({ status: 'Closed', no_kas_masuk: r.masuk.id });
    expect((await call(app, 'POST', `/api/kaskecil/keluar/${id}/selesai`, tok, { jumlah: 0 })).status).toBe(409);
    const det = await json(await call(app, 'GET', '/api/kaskecil/keluar/' + id, tok));
    expect(det.masuk.id).toBe(r.masuk.id);
    expect(det.cabang).toEqual({ kode: 'KWG', nama: 'Who Karawang' });
  });

  it('uang kembali 0 diperbolehkan (dipakai seluruhnya)', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const a = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'A', jumlah: 100000 }));
    expect((await call(app, 'POST', `/api/kaskecil/keluar/${a.keluar.id}/selesai`, tok, { jumlah: 0 })).status).toBe(200);
  });
});

describe('saldo, tambah saldo, laporan harian', () => {
  it('saldo awal hanya SUPERADMIN; laporan harian menghitung saldo berjalan', async () => {
    const { app, kv } = setup();
    const pic = await loginAs(kv, PIC);
    const su = await loginAs(kv, SUPER);
    expect((await call(app, 'PUT', '/api/kaskecil/saldo-awal', pic, { tanggal: '2026-10-01', jumlah: 1000000 })).status).toBe(403);
    expect((await call(app, 'PUT', '/api/kaskecil/saldo-awal', su, { cabang: 'KWG', tanggal: '2026-10-01', jumlah: 1000000 })).status).toBe(200);
    expect((await call(app, 'POST', '/api/kaskecil/masuk', pic, { jumlah: 500000, keterangan: 'dari pusat' })).status).toBe(200);
    await call(app, 'POST', '/api/kaskecil/keluar', pic, { jenis_id: 'KJ-UM', penerima: 'A', jumlah: 100000 });
    const lap = await json(await call(app, 'GET', `/api/kaskecil/laporan-harian?tanggal=${HARI}`, pic));
    expect(lap.laporan.saldoAwal).toBe(1000000);
    expect(lap.laporan.baris.map((b: any) => [b.jenis, b.debit, b.kredit]).sort()).toEqual([['KELUAR', 0, 100000], ['MASUK', 500000, 0]]);
    expect(lap.laporan.baris.at(-1).saldo).toBe(1400000);
    expect(lap.laporan.ringkasan).toMatchObject({ keluar: 100000, masuk: 500000, belumSelesai: 100000, saldoAkhir: 1400000 });
  });

  it('tambah saldo bisa dihapus; penyelesaian KK tidak bisa dihapus lewat /masuk', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const t = await json(await call(app, 'POST', '/api/kaskecil/masuk', tok, { jumlah: 1000 }));
    expect((await call(app, 'DELETE', '/api/kaskecil/masuk/' + t.masuk.id, tok)).status).toBe(200);
    const a = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'A', jumlah: 1000 }));
    const s = await json(await call(app, 'POST', `/api/kaskecil/keluar/${a.keluar.id}/selesai`, tok, { jumlah: 0 }));
    expect((await call(app, 'DELETE', '/api/kaskecil/masuk/' + s.masuk.id, tok)).status).toBe(409);
  });

  it('laporan harian & summary butuh cabang untuk SUPERADMIN/MANAGEMENT', async () => {
    const { app, kv } = setup();
    const su = await loginAs(kv, SUPER);
    expect((await call(app, 'GET', '/api/kaskecil/laporan-harian', su)).status).toBe(400);
    expect((await call(app, 'GET', '/api/kaskecil/summary', su)).status).toBe(400);
    expect((await call(app, 'GET', '/api/kaskecil/summary?cabang=KWG&bulan=2026-13', su)).status).toBe(400);
  });
});

describe('summary & pembanding', () => {
  it('summary: nilai bersih KK − KM per jenis', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const a = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'A', jumlah: 100000 }));
    await call(app, 'POST', `/api/kaskecil/keluar/${a.keluar.id}/selesai`, tok, { jumlah: 60000 });
    await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-BENSIN', penerima: 'A', jumlah: 250000 });
    const s = await json(await call(app, 'GET', '/api/kaskecil/summary?bulan=' + HARI.slice(0, 7), tok));
    expect(s.summary.total).toEqual({ 'Biaya Uang Muka Delivery': 40000, 'Biaya Bensin Delivery': 250000, semua: 290000 });
  });

  it('pembanding: kas bensin tanpa laporan aplikasi → selisih negatif', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-BENSIN', penerima: 'A', jumlah: 250000 });
    const p = await json(await call(app, 'GET', '/api/kaskecil/pembanding?bulan=' + HARI.slice(0, 7), tok));
    expect(p.baris).toHaveLength(1);
    expect(p.baris[0]).toMatchObject({ tanggal: HARI, cocok: false, bbm: { app: 0, kas: 250000, selisih: -250000 } });
  });
});

describe('jenis & opname', () => {
  it('jenis: semua peran baca yang aktif; hanya SUPERADMIN mengubah', async () => {
    const { app, kv } = setup();
    const pic = await loginAs(kv, PIC);
    const list = await json(await call(app, 'GET', '/api/kaskecil/jenis', pic));
    expect(list.jenis.map((j: any) => j.id)).not.toContain('KJ-OFF');
    expect((await call(app, 'PUT', '/api/kaskecil/jenis/KJ-UM', pic, { nama: 'X' })).status).toBe(403);
    const su = await loginAs(kv, SUPER);
    expect((await call(app, 'PUT', '/api/kaskecil/jenis/KJ-UM', su, { aktif: false })).status).toBe(200);
    expect((await call(app, 'PUT', '/api/kaskecil/jenis/NOPE', su, { aktif: false })).status).toBe(404);
    const semua = await json(await call(app, 'GET', '/api/kaskecil/jenis?semua=1', su));
    expect(semua.jenis.find((j: any) => j.id === 'KJ-UM').aktif).toBe(false);
  });

  it('opname: nilai buku = saldo akhir hari, selisih fisik − buku, nomor CO per tahun, bisa dihapus', async () => {
    const { app, kv, kas } = setup();
    const su = await loginAs(kv, SUPER);
    const tok = await loginAs(kv, PIC);
    await call(app, 'PUT', '/api/kaskecil/saldo-awal', su, { cabang: 'KWG', tanggal: '2026-10-01', jumlah: 1000000 });
    const r = await json(await call(app, 'POST', '/api/kaskecil/opname', tok, { pecahan: { '100000': 9, '50000': 1 }, catatan: 'rutin' }));
    const bulanRomawi = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'][Number(HARI.slice(5, 7)) - 1];
    expect(r.opname).toMatchObject({ id: `CO.001/TSI-OPR/KWG/${bulanRomawi}/${HARI.slice(0, 4)}`, nilai_fisik: 950000, nilai_buku: 1000000, selisih: -50000, pemeriksa: 'Pic Lengkap' });
    const r2 = await json(await call(app, 'POST', '/api/kaskecil/opname', tok, { pecahan: { '75000': 1 } }));
    expect(r2.opname.id.startsWith('CO.002/')).toBe(true);
    expect((await call(app, 'POST', '/api/kaskecil/opname', tok, { pecahan: { '777': 1 } })).status).toBe(400);
    const del = await call(app, 'DELETE', '/api/kaskecil/opname/' + encodeURIComponent(r.opname.id), tok);
    expect(del.status).toBe(200);
    expect(kas.state.opname.find((o) => o.id === r.opname.id)!.is_deleted).toBe('1');
    const daftar = await json(await call(app, 'GET', '/api/kaskecil/opname', tok));
    expect(daftar.opname).toHaveLength(1);
  });

  it('semua tulis dicatat di audit log', async () => {
    const { app, kv, audits } = setup();
    const tok = await loginAs(kv, PIC);
    await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'A', jumlah: 1000 });
    expect(audits.some((a) => a.modul === 'kaskecil' && a.action === 'CREATE')).toBe(true);
  });
});

describe('penyelesaian bersamaan', () => {
  it('bila kas keluar sudah ditutup pihak lain saat menyimpan, KM ganda dibatalkan & 409', async () => {
    const asli = memKasKecil({ jenis: JENIS, keluar: [{ id: 'KK-WHO-KWG-1', kode_cabang: 'KWG', tanggal: '2026-10-01', jam: '09:00:00', no_referensi: 'BO-1', penerima: 'A', admin: 'x', jenis_id: 'KJ-UM', kode_akun: '', jenis: 'Biaya Uang Muka Delivery', pecahan: {}, jumlah: 100000, keterangan: '', status: 'Open', no_kas_masuk: '', is_deleted: '' }] });
    // Balapan: pihak lain menutup kas keluar tepat sebelum penutupan oleh permintaan ini.
    const { deps } = makeDeps({ kasKecilPeran: SEMUA_PERAN, master: memMaster({ cabang: CABANG }).repo, kaskecil: { ...asli.repo, tutupKeluar: async () => false } });
    const app2 = buildApp(fakeEnv() as any, deps);
    const tok2 = await loginAs(deps.kv, PIC);
    const res = await call(app2, 'POST', '/api/kaskecil/keluar/KK-WHO-KWG-1/selesai', tok2, { jumlah: 0 });
    expect(res.status).toBe(409);
    expect(await deps.kaskecil.listMasuk({ cabang: 'KWG' })).toHaveLength(0); // KM yang sempat dibuat sudah dibatalkan (soft delete)
  });
  it('pecahan terlalu besar & penerima kepanjangan ditolak/dipotong', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    expect((await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'A', pecahan: { '50000': 2000000 } })).status).toBe(400);
    const r = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'X'.repeat(200), jumlah: 1000 }));
    expect(r.keluar.penerima).toHaveLength(80);
  });
});

describe('validasi tambahan', () => {
  it('tanggal yang tidak ada di kalender ditolak', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    expect((await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'A', jumlah: 1000, tanggal: '2026-02-31' })).status).toBe(400);
  });
  it('saldo awal: jumlah kosong/null/pecahan ditolak (tidak menimpa menjadi 0)', async () => {
    const { app, kv, kas } = setup();
    const su = await loginAs(kv, SUPER);
    await call(app, 'PUT', '/api/kaskecil/saldo-awal', su, { cabang: 'KWG', tanggal: '2026-10-01', jumlah: 500000 });
    for (const jumlah of [null, '', 1.5, 'abc', -1]) {
      expect((await call(app, 'PUT', '/api/kaskecil/saldo-awal', su, { cabang: 'KWG', tanggal: '2026-10-01', jumlah })).status).toBe(400);
    }
    expect(kas.state.saldoAwal.KWG!.jumlah).toBe(500000);
  });
  it('penutupan KK gagal (galat DB) → KM yang sempat dibuat dibatalkan dan galat diteruskan', async () => {
    const asli = memKasKecil({ jenis: JENIS, keluar: [{ id: 'KK-WHO-KWG-1', kode_cabang: 'KWG', tanggal: '2026-10-01', jam: '09:00:00', no_referensi: 'BO-1', penerima: 'A', admin: 'x', jenis_id: 'KJ-UM', kode_akun: '', jenis: 'Biaya Uang Muka Delivery', pecahan: {}, jumlah: 100000, keterangan: '', status: 'Open', no_kas_masuk: '', is_deleted: '' }] });
    const { deps } = makeDeps({ kasKecilPeran: SEMUA_PERAN, master: memMaster({ cabang: CABANG }).repo, kaskecil: { ...asli.repo, tutupKeluar: async () => { throw new Error('DB mati'); } } });
    const app2 = buildApp(fakeEnv() as any, deps);
    const tok = await loginAs(deps.kv, PIC);
    const res = await call(app2, 'POST', '/api/kaskecil/keluar/KK-WHO-KWG-1/selesai', tok, { jumlah: 10000 });
    expect(res.status).toBe(500);
    expect(await deps.kaskecil.listMasuk({ cabang: 'KWG' })).toHaveLength(0);
  });
});

describe('pembanding top up via Finance', () => {
  it('kode GDGBDG/BDG/CBY ditandai topupFinance; cabang lain tidak', async () => {
    const { CABANG_TOPUP_VIA_FINANCE } = await import('../../src/logic/kaskecil');
    expect([...CABANG_TOPUP_VIA_FINANCE].sort()).toEqual(['BDG', 'CBY', 'GDGBDG']);
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC_B); // BDG
    await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-BENSIN', penerima: 'A', jumlah: 1000 });
    const p = await json(await call(app, 'GET', '/api/kaskecil/pembanding?bulan=' + HARI.slice(0, 7), tok));
    expect(p.baris[0].topupFinance).toBe(true);
    const k = await json(await call(app, 'GET', '/api/kaskecil/pembanding?bulan=' + HARI.slice(0, 7), await loginAs(kv, PIC)));
    expect(k.baris.every((b: any) => b.topupFinance === false)).toBe(true);
  });
});

describe('daftar kas masuk', () => {
  it('GET /masuk: sesuai rentang & cabang; PIC tidak bisa melihat cabang lain', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const a = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'A', jumlah: 100000 }));
    await call(app, 'POST', `/api/kaskecil/keluar/${a.keluar.id}/selesai`, tok, { jumlah: 30000 });
    await call(app, 'POST', '/api/kaskecil/masuk', tok, { jumlah: 500000 });
    const l = await json(await call(app, 'GET', `/api/kaskecil/masuk?dari=${HARI}&sampai=${HARI}`, tok));
    expect(l.masuk.map((m: any) => m.jumlah).sort((x: number, y: number) => x - y)).toEqual([30000, 500000]);
    expect((await call(app, 'GET', '/api/kaskecil/masuk?cabang=BDG', tok)).status).toBe(403);
    const kosong = await json(await call(app, 'GET', '/api/kaskecil/masuk?dari=2000-01-01&sampai=2000-01-02', tok));
    expect(kosong.masuk).toEqual([]);
  });
});

describe('dua nama penerima', () => {
  it('penerima_2 opsional: tersimpan, bisa diubah, diwarisi penyelesaian, tampil gabungan di laporan harian', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const a = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'Haris', penerima_2: 'Aris', jumlah: 100000 }));
    expect(a.keluar.penerima_2).toBe('Aris');
    const tanpa = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'Solo', jumlah: 1000 }));
    expect(tanpa.keluar.penerima_2).toBe('');
    expect((await call(app, 'PUT', '/api/kaskecil/keluar/' + a.keluar.id, tok, { penerima_2: 'Budi' })).status).toBe(200);
    const s = await json(await call(app, 'POST', `/api/kaskecil/keluar/${a.keluar.id}/selesai`, tok, { jumlah: 0 }));
    expect(s.masuk.penerima_2).toBe('Budi');
    const lap = await json(await call(app, 'GET', `/api/kaskecil/laporan-harian?tanggal=${HARI}`, tok));
    expect(lap.laporan.baris.map((b: any) => b.nama)).toContain('Haris / Budi');
    expect(lap.laporan.baris.map((b: any) => b.nama)).toContain('Solo');
  });
});

describe('pecahan wajib, tambah saldo & setoran seluruh saldo', () => {
  const FOTO = { foto_bukti: 'aGVsbG8=', foto_bukti_name: 'bukti.jpg' };
  const siapSaldo = async (app: App, kv: any, pecahan: Record<string, number>, jumlah?: number) => {
    const su = await loginAs(kv, SUPER);
    const res = await callMentah(app, 'PUT', '/api/kaskecil/saldo-awal', su, { cabang: 'KWG', tanggal: '2026-10-01', pecahan, ...(jumlah !== undefined ? { jumlah } : {}), dana_mingguan: 2000000 });
    expect(res.status).toBe(200);
  };

  it('uang tanpa rincian pecahan ditolak; jumlah diturunkan dari pecahan', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const r = await callMentah(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'A', jumlah: 100000 });
    expect(r.status).toBe(400);
    expect((await json(r)).message).toMatch(/pecahan/i);
    expect((await callMentah(app, 'POST', '/api/kaskecil/masuk', tok, { jumlah: 1000 })).status).toBe(400);
    const ok = await json(await callMentah(app, 'POST', '/api/kaskecil/masuk', tok, { pecahan: { '100000': 2 } }));
    expect(ok.masuk.jumlah).toBe(200000);
  });

  it('setoran lewat /keluar ditolak (harus lewat /setoran)', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    expect((await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-SETOR', penerima: 'Bank', jumlah: 1000 })).status).toBe(400);
  });

  it('setoran: seluruh saldo sesuai pecahan, foto wajib, Closed, saldo jadi nol, tidak bisa dua kali', async () => {
    const { app, kv, kas } = setup();
    await siapSaldo(app, kv, { '100000': 5, '50000': 2, '5000': 3 });
    const tok = await loginAs(kv, PIC);
    await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'A', pecahan: { '100000': 1 } });
    expect((await callMentah(app, 'POST', '/api/kaskecil/setoran', tok, {})).status).toBe(400); // tanpa foto
    const res = await json(await callMentah(app, 'POST', '/api/kaskecil/setoran', tok, { ...FOTO, keterangan: 'Senin' }));
    expect(res.keluar).toMatchObject({ jumlah: 515000, status: 'Closed', jenis: 'Setoran Tunai Kas Kecil', pecahan: { '100000': 4, '50000': 2, '5000': 3 } });
    expect(res.keluar.bukti_url).toBeTruthy();
    expect(kas.state.keluar.some((k) => k.id === res.keluar.id && k.status === 'Closed')).toBe(true);
    const s = await json(await call(app, 'GET', '/api/kaskecil/saldo-pecahan', tok));
    expect(s.rincian).toMatchObject({ nilaiAkhir: 0, saldoUang: 0, sinkron: true });
    expect((await callMentah(app, 'POST', '/api/kaskecil/setoran', tok, FOTO)).status).toBe(400); // tidak ada saldo
  });

  it('setoran ditolak bila rincian pecahan tidak sinkron dengan saldo uang', async () => {
    const { app, kv } = setup();
    await siapSaldo(app, kv, {}, 100000); // saldo uang ada, tapi pecahan tidak tercatat
    const tok = await loginAs(kv, PIC);
    const r = await callMentah(app, 'POST', '/api/kaskecil/setoran', tok, FOTO);
    expect(r.status).toBe(409);
    expect((await json(r)).message).toMatch(/tidak sama/);
  });

  it('PIC hanya setor cabangnya; MANAGEMENT tidak bisa', async () => {
    const { app, kv } = setup();
    await siapSaldo(app, kv, { '100000': 1 });
    expect((await callMentah(app, 'POST', '/api/kaskecil/setoran', await loginAs(kv, PIC_B), { ...FOTO, cabang: 'KWG' })).status).toBe(403);
    expect((await callMentah(app, 'POST', '/api/kaskecil/setoran', await loginAs(kv, MGMT), { ...FOTO, cabang: 'KWG' })).status).toBe(403);
  });

  it('peringatan bila pecahan yang dikeluarkan melebihi saldo tercatat (tidak memblokir)', async () => {
    const { app, kv } = setup();
    await siapSaldo(app, kv, { '100000': 1 });
    const tok = await loginAs(kv, PIC);
    const r = await json(await call(app, 'POST', '/api/kaskecil/keluar', tok, { jenis_id: 'KJ-UM', penerima: 'A', pecahan: { '100000': 2 } }));
    expect(r.keluar.jumlah).toBe(200000);
    expect(r.peringatan).toHaveLength(1);
    expect(r.peringatan[0]).toMatch(/100000/);
  });

  it('saldo awal: jumlah dari pecahan, harus sama bila keduanya diisi; dana mingguan tersimpan', async () => {
    const { app, kv, kas } = setup();
    const su = await loginAs(kv, SUPER);
    expect((await callMentah(app, 'PUT', '/api/kaskecil/saldo-awal', su, { cabang: 'KWG', tanggal: '2026-10-01', jumlah: 1, pecahan: { '50000': 2 } })).status).toBe(400);
    await siapSaldo(app, kv, { '50000': 2 });
    expect(kas.state.saldoAwal.KWG).toMatchObject({ jumlah: 100000, pecahan: { '50000': 2 }, dana_mingguan: 2000000 });
    const l = await json(await call(app, 'GET', `/api/kaskecil/laporan-harian?cabang=KWG&tanggal=${HARI}`, su));
    expect(l.rincian.baris.find((b: any) => b.kunci === '50000')).toMatchObject({ awal: 2, akhir: 2 });
  });
});

describe('penjaga peran Kas Kecil (tahap uji: hanya SUPERADMIN)', () => {
  it('bawaan: PIC CABANG & MANAGEMENT ditolak di semua endpoint; SUPERADMIN diizinkan', async () => {
    const { PERAN_KAS_KECIL } = await import('../../src/routes/kaskecil');
    expect([...PERAN_KAS_KECIL]).toEqual(['SUPERADMIN']);
    const master = memMaster({ cabang: CABANG });
    const kas = memKasKecil({ jenis: JENIS });
    const { deps, kv } = makeDeps({ master: master.repo, kaskecil: kas.repo }); // tanpa kasKecilPeran -> bawaan
    const app = buildApp(fakeEnv() as any, deps);
    for (const u of [PIC, MGMT]) {
      const tok = await loginAs(kv, u);
      for (const [m, p] of [['GET', '/api/kaskecil/jenis'], ['GET', '/api/kaskecil/keluar'], ['POST', '/api/kaskecil/keluar'], ['POST', '/api/kaskecil/setoran'], ['GET', '/api/kaskecil/laporan-harian']]) {
        const res = await callMentah(app, m!, p!, tok, m === 'POST' ? {} : undefined);
        expect(res.status, `${u.role} ${m} ${p}`).toBe(403);
        expect((await json(res)).message).toMatch(/belum dibuka|hanya dapat melihat/);
      }
    }
    expect((await callMentah(app, 'GET', '/api/kaskecil/jenis', await loginAs(kv, SUPER))).status).toBe(200);
  });
});

describe('nomor BP: awalan otomatis + nomor urut dari PIC; nomor BO otomatis', () => {
  const kirim = (app: App, tok: string, b: Record<string, unknown>) => callMentah(app, 'POST', '/api/kaskecil/keluar', tok, { penerima: 'Haris', ...b });
  const rp = (n: number) => ({ pecahan: uraiPecahan(n) });
  const TGL = HARI.replace(/-/g, '');

  it('jenis ber-BP: nomor urut wajib (1–9999); nomor BP = awalan otomatis + urut 4 digit; sama untuk beberapa pengeluaran', async () => {
    const { app, kv, kas } = setup();
    const tok = await loginAs(kv, PIC);
    for (const urut of [undefined, '', '  ', 0, '0', -1, 'abc', '12345', 1.5, '1e3']) {
      expect((await kirim(app, tok, { jenis_id: 'KJ-BENSIN', ...rp(250000), ...(urut === undefined ? {} : { urut_bp: urut }) })).status, `urut_bp=${String(urut)}`).toBe(400);
    }
    const a = await json(await kirim(app, tok, { jenis_id: 'KJ-BENSIN', ...rp(250000), urut_bp: 12 }));
    expect(a.keluar.no_referensi).toBe(`BP-WHO-KWG-${TGL}0012`);
    const b = await json(await kirim(app, tok, { jenis_id: 'KJ-BENSIN', ...rp(50000), urut_bp: '12' }));
    expect(b.keluar.no_referensi).toBe(`BP-WHO-KWG-${TGL}0012`);
    expect(b.keluar.id).not.toBe(a.keluar.id);
    expect(kas.state.keluar.filter((k) => k.no_referensi === `BP-WHO-KWG-${TGL}0012`)).toHaveLength(2);
    const c = await json(await kirim(app, tok, { jenis_id: 'KJ-BENSIN', ...rp(1000), urut_bp: 9999 }));
    expect(c.keluar.no_referensi).toBe(`BP-WHO-KWG-${TGL}9999`);
  });

  it('WHP memakai awalan BP-WHP; tanggal transaksi masuk ke nomor', async () => {
    const { app, kv } = setup();
    const a = await json(await kirim(app, await loginAs(kv, PIC_B), { jenis_id: 'KJ-BENSIN', ...rp(1000), urut_bp: 3, tanggal: '2026-10-01' }));
    expect(a.keluar.no_referensi).toBe('BP-WHP-BDG-202610010003');
  });

  it('jenis ber-BO: nomor otomatis & baru tiap pengeluaran; input dari klien diabaikan', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const a = await json(await kirim(app, tok, { jenis_id: 'KJ-UM', ...rp(100000), urut_bp: 5, no_referensi: 'BO-PALSU' }));
    const b = await json(await kirim(app, tok, { jenis_id: 'KJ-UM', ...rp(50000), no_referensi: a.keluar.no_referensi }));
    expect(a.keluar.no_referensi).toMatch(/^BO-WHO-KWG-\d{8}0001$/);
    expect(b.keluar.no_referensi).toMatch(/^BO-WHO-KWG-\d{8}0002$/);
  });

  it('jenis tanpa referensi (Closing Kas) tidak memakai nomor', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const a = await json(await kirim(app, tok, { jenis_id: 'KJ-CLOSING', ...rp(1000), urut_bp: 1 }));
    expect(a.keluar.no_referensi).toBe('');
  });

  it('nomor urut BP bisa dikoreksi selama Open (memakai tanggal kas keluar); penyelesaian mewarisi nomor; BO tidak berubah', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    const a = await json(await kirim(app, tok, { jenis_id: 'KJ-BENSIN', ...rp(250000), urut_bp: 5, tanggal: '2026-10-02' }));
    expect(a.keluar.no_referensi).toBe('BP-WHO-KWG-202610020005');
    expect((await call(app, 'PUT', '/api/kaskecil/keluar/' + a.keluar.id, tok, { urut_bp: '' })).status).toBe(400);
    expect((await call(app, 'PUT', '/api/kaskecil/keluar/' + a.keluar.id, tok, { urut_bp: 6 })).status).toBe(200);
    const s = await json(await callMentah(app, 'POST', `/api/kaskecil/keluar/${a.keluar.id}/selesai`, tok, { pecahan: {} }));
    expect(s.masuk.no_referensi).toBe('BP-WHO-KWG-202610020006');
    const o = await json(await kirim(app, tok, { jenis_id: 'KJ-UM', ...rp(100000) }));
    await call(app, 'PUT', '/api/kaskecil/keluar/' + o.keluar.id, tok, { urut_bp: 9 });
    const l = await json(await call(app, 'GET', `/api/kaskecil/keluar?dari=${HARI}&sampai=${HARI}`, tok));
    expect(l.keluar.find((k: any) => k.id === o.keluar.id).no_referensi).toBe(o.keluar.no_referensi);
  });

  it('GET /referensi: saran nomor urut BP driver itu (BP saja, 14 hari), total & jumlah transaksi', async () => {
    const { app, kv } = setup();
    const tok = await loginAs(kv, PIC);
    await kirim(app, tok, { jenis_id: 'KJ-BENSIN', ...rp(250000), urut_bp: 1 });
    await kirim(app, tok, { jenis_id: 'KJ-BENSIN', ...rp(50000), urut_bp: 1 });
    await kirim(app, tok, { jenis_id: 'KJ-BENSIN', ...rp(7000), urut_bp: 2, penerima: 'Orang Lain' });
    await kirim(app, tok, { jenis_id: 'KJ-UM', ...rp(100000) }); // BO tidak ikut saran
    const l = await json(await call(app, 'GET', '/api/kaskecil/referensi?penerima=haris', tok));
    expect(l.referensi).toHaveLength(1);
    expect(l.referensi[0]).toMatchObject({ ref: `BP-WHO-KWG-${TGL}0001`, urut: 1, jumlah: 300000, transaksi: 2, tanggal: HARI });
    expect((await json(await call(app, 'GET', '/api/kaskecil/referensi?penerima=', tok))).referensi).toEqual([]);
    expect((await call(app, 'GET', '/api/kaskecil/referensi?cabang=BDG&penerima=haris', tok)).status).toBe(403);
  });
});
