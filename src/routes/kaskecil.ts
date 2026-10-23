import { Hono } from 'hono';
import type { Context } from 'hono';
import type { Env } from '../env';
import type { AppDeps, SessionUser } from '../deps';
import type { AuthVars } from '../auth/middleware';
import { requireUser } from '../auth/middleware';
import { isSuper, lihatSemuaCabang } from '../auth/peran';
import { HttpError, okPayload, reqIp } from '../utils/http';
import { todayWib } from '../logic/jalur';
import { rekapPengeluaran, rekapTopup } from '../logic/rekap';
import { decodeBase64, extOf } from './laporan';
import { NomorKasBentrok } from '../db/kaskecil';
import type { KasJenisRow } from '../db/kaskecil';
import {
  CABANG_TOPUP_VIA_FINANCE, PECAHAN_OPNAME, jumlahPecahan, laporanHarian, nomorKas, normalPecahan, pembandingHarian, rincianPecahanHarian, saldoPecahan, summaryBulanan, tipeWh, urutBerikut,
} from '../logic/kaskecil';
import type { AppHarian, KasKeluarRow, KasMasukRow } from '../logic/kaskecil';

type Ctx = Context<{ Bindings: Env; Variables: AuthVars }>;

const MAKS_NOMINAL = 100_000_000;
const POLA_TGL = /^\d{4}-\d{2}-\d{2}$/;
const POLA_SETORAN = /^setor/i;
const ROMAWI = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

const str = (v: unknown) => String(v ?? '').trim();

async function readJson(c: Ctx): Promise<Record<string, any>> {
  try {
    const b = await c.req.json();
    return b && typeof b === 'object' ? (b as Record<string, any>) : {};
  } catch {
    return {};
  }
}

function jamWib(now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now);
}

function tanggalValid(v: unknown, label: string, hariIni: string): string {
  const t = str(v) || hariIni;
  const d = new Date(t + 'T00:00:00Z');
  if (!POLA_TGL.test(t) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== t) throw new HttpError(400, `${label} tidak valid.`, 'BAD_REQUEST');
  if (t > hariIni) throw new HttpError(400, `${label} tidak boleh di masa depan.`, 'BAD_REQUEST');
  return t;
}

// Jumlah uang: dari pecahan (bila diisi) atau angka langsung; keduanya harus sama bila sama-sama diisi.
function ambilJumlah(b: Record<string, any>, { boleh0 = false, label = 'Jumlah uang' } = {}): { jumlah: number; pecahan: Record<string, number> } {
  let pecahan: Record<string, number>;
  try {
    pecahan = normalPecahan(b.pecahan);
  } catch (e) {
    throw new HttpError(400, (e as Error).message, 'BAD_REQUEST');
  }
  const dariPecahan = jumlahPecahan(pecahan);
  const diisi = b.jumlah !== undefined && b.jumlah !== null && str(b.jumlah) !== '';
  const angka = diisi ? Number(b.jumlah) : dariPecahan;
  if (!Number.isInteger(angka) || angka < (boleh0 ? 0 : 1) || angka > MAKS_NOMINAL) {
    throw new HttpError(400, `${label} harus bilangan bulat ${boleh0 ? '≥ 0' : '> 0'} dan maksimal Rp 100.000.000.`, 'BAD_REQUEST');
  }
  if (dariPecahan > 0 && diisi && angka !== dariPecahan) throw new HttpError(400, `${label} tidak sama dengan total pecahan uang.`, 'BAD_REQUEST');
  // Seperti Excel: uang selalu dicatat per pecahan (lembar/keping) agar saldo per pecahan bisa dihitung.
  if (angka > 0 && dariPecahan === 0) throw new HttpError(400, `Rincian pecahan uang wajib diisi (${label.toLowerCase()} = total pecahan).`, 'BAD_REQUEST');
  return { jumlah: angka, pecahan };
}

export function kasKecilRoutes(deps: AppDeps): Hono<{ Bindings: Env }> {
  const app = new Hono<{ Bindings: Env }>();
  app.use('*', requireUser(deps));

  const audit = (c: Ctx, entry: Omit<Parameters<AppDeps['recordAudit']>[0], 'user_id' | 'username' | 'ip'>) =>
    deps.recordAudit({ ...entry, user_id: c.get('user').user_id, username: c.get('user').username, ip: reqIp(c) });

  // Cabang kerja: PIC terkunci ke cabangnya; SUPERADMIN/MANAGEMENT memilih (kosong = semua, hanya bila `boleh Kosong`).
  const cabangBaca = (u: SessionUser, diminta: unknown, { wajib = false } = {}): string => {
    const minta = str(diminta);
    if (lihatSemuaCabang(u)) {
      if (wajib && !minta) throw new HttpError(400, 'Pilih warehouse terlebih dahulu.', 'BAD_REQUEST');
      return minta;
    }
    if (minta && minta !== String(u.cabang || '')) throw new HttpError(403, 'Akses ditolak: Anda hanya dapat melihat kas kecil warehouse ' + u.cabang + '.', 'FORBIDDEN');
    if (!u.cabang) throw new HttpError(403, 'Akun Anda belum terhubung ke warehouse.', 'FORBIDDEN');
    return String(u.cabang);
  };
  const cabangTulis = (u: SessionUser, diminta: unknown): string => {
    const minta = str(diminta);
    if (isSuper(u)) {
      if (!minta) throw new HttpError(400, 'Pilih warehouse terlebih dahulu.', 'BAD_REQUEST');
      return minta;
    }
    if (!u.cabang) throw new HttpError(403, 'Akun Anda belum terhubung ke warehouse.', 'FORBIDDEN');
    if (minta && minta !== String(u.cabang)) throw new HttpError(403, 'Akses ditolak: Anda hanya dapat mengelola kas kecil warehouse ' + u.cabang + '.', 'FORBIDDEN');
    return String(u.cabang);
  };
  const tipeCabang = async (kode: string) => {
    const c = await deps.master.findCabangByKode(kode);
    return tipeWh(String(c?.nama_cabang ?? ''));
  };
  const cariKeluar = async (id: string, u: SessionUser): Promise<KasKeluarRow> => {
    const r = await deps.kaskecil.findKeluar(id);
    if (!r || r.is_deleted === '1') throw new HttpError(404, 'Kas keluar tidak ditemukan.', 'NOT_FOUND');
    if (!lihatSemuaCabang(u) && r.kode_cabang !== String(u.cabang || '')) throw new HttpError(403, 'Akses ditolak: kas keluar milik warehouse lain.', 'FORBIDDEN');
    return r;
  };
  const jenisDari = async (id: string, tipe: 'KELUAR' | 'MASUK'): Promise<KasJenisRow> => {
    const j = (await deps.kaskecil.listJenis()).find((x) => x.id === id);
    if (!j || !j.aktif) throw new HttpError(400, 'Jenis transaksi tidak valid.', 'BAD_REQUEST');
    if (j.tipe !== tipe) throw new HttpError(400, 'Jenis transaksi tidak sesuai.', 'BAD_REQUEST');
    return j;
  };

  // Sisip dengan nomor baru; ulangi bila bentrok (dua admin menyimpan bersamaan).
  const sisipBernomor = async (kode: string, tanggal: string, awalan: 'KK' | 'KM', prefiksRef: string, buat: (nomor: string, ref: string) => Promise<void>) => {
    const tipe = await tipeCabang(kode);
    for (let i = 0; i < 6; i++) {
      const ids = await deps.kaskecil.nomorBulan(kode, tanggal.slice(0, 7));
      const nomor = nomorKas(awalan, tipe, kode, tanggal, urutBerikut(ids, awalan, tipe, kode, tanggal));
      const ref = prefiksRef ? nomorKas(prefiksRef as 'BO' | 'BP', tipe, kode, tanggal, urutBerikut(ids, prefiksRef as 'BO' | 'BP', tipe, kode, tanggal)) : '';
      try {
        await buat(nomor, ref);
        return;
      } catch (e) {
        if (!(e instanceof NomorKasBentrok)) throw e;
      }
    }
    throw new HttpError(409, 'Gagal membuat nomor kas, coba lagi.', 'CONFLICT');
  };

  // Saldo per pecahan sesudah transaksi tersimpan negatif = uang yang dikeluarkan melebihi lembar/keping yang tercatat ada (peringatan, tidak memblokir).
  const peringatanPecahan = async (kode: string, tanggal: string, dikeluarkan: Record<string, number>): Promise<string[]> => {
    const awal = await deps.kaskecil.getSaldoAwal(kode);
    if (!awal) return [];
    const { keluar, masuk } = await dataKas(kode, tanggal);
    const saldo = saldoPecahan({ awal, keluar, masuk, tanggal });
    return Object.keys(dikeluarkan).filter((k) => (saldo[k] ?? 0) < 0).map((k) => `Pecahan ${k.replace('K', '')}${k.startsWith('K') ? ' (koin)' : ''}: saldo tercatat ${saldo[k]} (kurang dari yang dikeluarkan). Periksa pecahan yang diinput.`);
  };

  // ── Master jenis ─────────────────────────────────────────────────────────
  app.get('/jenis', async (c: Ctx) => {
    const semua = isSuper(c.get('user')) && c.req.query('semua') === '1';
    const jenis = (await deps.kaskecil.listJenis()).filter((j) => semua || j.aktif);
    return c.json(okPayload({ jenis }));
  });

  app.put('/jenis/:id', async (c: Ctx) => {
    if (!isSuper(c.get('user'))) throw new HttpError(403, 'Hanya SUPERADMIN yang dapat mengubah jenis transaksi.', 'FORBIDDEN');
    const id = str(c.req.param('id'));
    const b = await readJson(c);
    const ada = (await deps.kaskecil.listJenis()).find((j) => j.id === id);
    if (!ada) throw new HttpError(404, 'Jenis transaksi tidak ditemukan.', 'NOT_FOUND');
    const nama = b.nama !== undefined ? str(b.nama) : ada.nama;
    if (!nama) throw new HttpError(400, 'Nama jenis wajib diisi.', 'BAD_REQUEST');
    const row: KasJenisRow = { ...ada, nama, kode_akun: b.kode_akun !== undefined ? str(b.kode_akun) : ada.kode_akun, aktif: b.aktif !== undefined ? Boolean(b.aktif) : ada.aktif };
    await deps.kaskecil.upsertJenis(row);
    await audit(c, { action: 'UPDATE', modul: 'kaskecil', keterangan: 'Ubah jenis kas kecil ' + nama });
    return c.json(okPayload({ jenis: row }));
  });

  // ── Saldo awal ───────────────────────────────────────────────────────────
  app.get('/saldo-awal', async (c: Ctx) => {
    const cabang = cabangBaca(c.get('user'), c.req.query('cabang'), { wajib: true });
    return c.json(okPayload({ awal: await deps.kaskecil.getSaldoAwal(cabang) }));
  });

  app.put('/saldo-awal', async (c: Ctx) => {
    const u = c.get('user');
    if (!isSuper(u)) throw new HttpError(403, 'Hanya SUPERADMIN yang dapat mengatur saldo awal kas kecil.', 'FORBIDDEN');
    const b = await readJson(c);
    const cabang = cabangTulis(u, b.cabang);
    const tanggal = tanggalValid(b.tanggal, 'Tanggal saldo awal', todayWib());
    let pecahan: Record<string, number>;
    try {
      pecahan = normalPecahan(b.pecahan);
    } catch (e) {
      throw new HttpError(400, (e as Error).message, 'BAD_REQUEST');
    }
    const dariPecahan = jumlahPecahan(pecahan);
    const jumlah = dariPecahan > 0 && (b.jumlah === undefined || str(b.jumlah) === '') ? dariPecahan : str(b.jumlah) === '' ? NaN : Number(b.jumlah);
    if (!Number.isInteger(jumlah) || jumlah < 0 || jumlah > 10 * MAKS_NOMINAL) throw new HttpError(400, 'Saldo awal tidak valid.', 'BAD_REQUEST');
    if (dariPecahan > 0 && dariPecahan !== jumlah) throw new HttpError(400, 'Saldo awal tidak sama dengan total pecahan uang.', 'BAD_REQUEST');
    const dana = b.dana_mingguan === undefined || str(b.dana_mingguan) === '' ? ((await deps.kaskecil.getSaldoAwal(cabang))?.dana_mingguan ?? 0) : Number(b.dana_mingguan);
    if (!Number.isInteger(dana) || dana < 0 || dana > MAKS_NOMINAL) throw new HttpError(400, 'Dana mingguan tidak valid.', 'BAD_REQUEST');
    await deps.kaskecil.setSaldoAwal(cabang, { tanggal, jumlah, pecahan, dana_mingguan: dana });
    await audit(c, { action: 'UPDATE', modul: 'kaskecil', keterangan: `Saldo awal kas kecil ${cabang}: ${tanggal} Rp ${jumlah}` });
    return c.json(okPayload({ awal: { tanggal, jumlah, pecahan, dana_mingguan: dana } }));
  });

  // ── Kas keluar ───────────────────────────────────────────────────────────
  app.get('/keluar', async (c: Ctx) => {
    const cabang = cabangBaca(c.get('user'), c.req.query('cabang'));
    const keluar = await deps.kaskecil.listKeluar({ cabang, dari: str(c.req.query('dari')) || undefined, sampai: str(c.req.query('sampai')) || undefined });
    return c.json(okPayload({ keluar: keluar.reverse() }));
  });

  app.get('/masuk', async (c: Ctx) => {
    const cabang = cabangBaca(c.get('user'), c.req.query('cabang'));
    const masuk = await deps.kaskecil.listMasuk({ cabang, dari: str(c.req.query('dari')) || undefined, sampai: str(c.req.query('sampai')) || undefined });
    return c.json(okPayload({ masuk: masuk.reverse() }));
  });

  app.get('/keluar/:id', async (c: Ctx) => {
    const keluar = await cariKeluar(c.req.param('id') as string, c.get('user'));
    const masuk = keluar.no_kas_masuk ? await deps.kaskecil.findMasuk(keluar.no_kas_masuk) : null;
    const cabang = await deps.master.findCabangByKode(keluar.kode_cabang);
    return c.json(okPayload({ keluar, masuk: masuk && masuk.is_deleted !== '1' ? masuk : null, cabang: cabang ? { kode: cabang.kode_cabang, nama: cabang.nama_cabang } : null }));
  });

  app.post('/keluar', async (c: Ctx) => {
    const u = c.get('user');
    const b = await readJson(c);
    const kode = cabangTulis(u, b.cabang);
    const hariIni = todayWib();
    const tanggal = tanggalValid(b.tanggal, 'Tanggal', hariIni);
    const jenis = await jenisDari(str(b.jenis_id), 'KELUAR');
    if (POLA_SETORAN.test(jenis.nama)) throw new HttpError(400, 'Setoran ke bank dicatat lewat tombol "Setor Seluruh Saldo ke Bank" di Laporan Harian.', 'BAD_REQUEST');
    const penerima = str(b.penerima).slice(0, 80);
    if (!penerima) throw new HttpError(400, 'Nama penerima wajib diisi.', 'BAD_REQUEST');
    const { jumlah, pecahan } = ambilJumlah(b);
    const row: KasKeluarRow = {
      id: '', kode_cabang: kode, tanggal, jam: jamWib(), no_referensi: '', penerima, penerima_2: str(b.penerima_2).slice(0, 80), admin: u.nama || u.username,
      jenis_id: jenis.id, kode_akun: jenis.kode_akun, jenis: jenis.nama, pecahan, jumlah, keterangan: str(b.keterangan).slice(0, 300),
      status: jenis.tanpa_penyelesaian ? 'Closed' : 'Open', no_kas_masuk: '', created_by: u.username, created_at: new Date(deps.now()).toISOString(), is_deleted: '',
    };
    await sisipBernomor(kode, tanggal, 'KK', jenis.prefiks_ref, async (nomor, ref) => {
      row.id = nomor;
      row.no_referensi = ref;
      await deps.kaskecil.insertKeluar(row);
    });
    await audit(c, { action: 'CREATE', modul: 'kaskecil', keterangan: `Kas keluar ${row.id} ${jenis.nama} Rp ${jumlah}` });
    return c.json(okPayload({ keluar: row, peringatan: await peringatanPecahan(kode, tanggal, pecahan) }));
  });

  app.put('/keluar/:id', async (c: Ctx) => {
    const u = c.get('user');
    const row = await cariKeluar(c.req.param('id') as string, u);
    cabangTulis(u, row.kode_cabang);
    if (row.status === 'Closed' && row.no_kas_masuk) throw new HttpError(409, 'Kas keluar sudah diselesaikan. Batalkan penyelesaian dulu untuk mengubahnya.', 'CONFLICT');
    const b = await readJson(c);
    const patch: Partial<KasKeluarRow> = {};
    if (b.penerima !== undefined) {
      if (!str(b.penerima)) throw new HttpError(400, 'Nama penerima wajib diisi.', 'BAD_REQUEST');
      patch.penerima = str(b.penerima).slice(0, 80);
    }
    if (b.penerima_2 !== undefined) patch.penerima_2 = str(b.penerima_2).slice(0, 80);
    if (b.keterangan !== undefined) patch.keterangan = str(b.keterangan).slice(0, 300);
    if (b.jumlah !== undefined || b.pecahan !== undefined) Object.assign(patch, ambilJumlah(b));
    await deps.kaskecil.updateKeluar(row.id, patch);
    await audit(c, { action: 'UPDATE', modul: 'kaskecil', keterangan: 'Ubah kas keluar ' + row.id });
    return c.json(okPayload({ keluar: { ...row, ...patch } }));
  });

  app.delete('/keluar/:id', async (c: Ctx) => {
    const u = c.get('user');
    const row = await cariKeluar(c.req.param('id') as string, u);
    cabangTulis(u, row.kode_cabang);
    if (row.no_kas_masuk) throw new HttpError(409, 'Kas keluar sudah diselesaikan. Batalkan penyelesaian dulu.', 'CONFLICT');
    await deps.kaskecil.updateKeluar(row.id, { is_deleted: '1' });
    await audit(c, { action: 'DELETE', modul: 'kaskecil', keterangan: `Hapus kas keluar ${row.id} Rp ${row.jumlah}` });
    return c.json(okPayload({ id: row.id }));
  });

  // ── Penyelesaian (kas masuk dari kas keluar) ─────────────────────────────
  app.post('/keluar/:id/selesai', async (c: Ctx) => {
    const u = c.get('user');
    const kk = await cariKeluar(c.req.param('id') as string, u);
    cabangTulis(u, kk.kode_cabang);
    if (kk.status === 'Closed') throw new HttpError(409, 'Kas keluar ini sudah selesai.', 'CONFLICT');
    const b = await readJson(c);
    const hariIni = todayWib();
    const tanggal = tanggalValid(b.tanggal, 'Tanggal penyelesaian', hariIni);
    if (tanggal < kk.tanggal) throw new HttpError(400, 'Tanggal penyelesaian tidak boleh sebelum tanggal kas keluar.', 'BAD_REQUEST');
    const { jumlah, pecahan } = ambilJumlah(b, { boleh0: true, label: 'Uang kembali' });
    if (jumlah > kk.jumlah) throw new HttpError(400, 'Uang kembali tidak boleh melebihi nominal kas keluar.', 'BAD_REQUEST');
    const masuk: KasMasukRow = {
      id: '', kode_cabang: kk.kode_cabang, tanggal, jam: jamWib(), no_kas_keluar: kk.id, no_referensi: kk.no_referensi, penerima: kk.penerima, penerima_2: kk.penerima_2 ?? '',
      admin: u.nama || u.username, jenis_id: kk.jenis_id, kode_akun: kk.kode_akun, jenis: kk.jenis, pecahan, jumlah,
      keterangan: str(b.keterangan).slice(0, 300), created_by: u.username, created_at: new Date(deps.now()).toISOString(), is_deleted: '',
    };
    await sisipBernomor(kk.kode_cabang, tanggal, 'KM', '', async (nomor) => {
      masuk.id = nomor;
      await deps.kaskecil.insertMasuk(masuk);
    });
    // KM sudah tersimpan; bila penutupan KK gagal/kalah balapan, KM dibatalkan agar uang kembali tidak terhitung ganda.
    let tertutup = false;
    try {
      tertutup = await deps.kaskecil.tutupKeluar(kk.id, masuk.id);
    } catch (e) {
      await deps.kaskecil.updateMasuk(masuk.id, { is_deleted: '1' }).catch(() => {});
      throw e;
    }
    if (!tertutup) {
      await deps.kaskecil.updateMasuk(masuk.id, { is_deleted: '1' });
      throw new HttpError(409, 'Kas keluar ini sudah selesai.', 'CONFLICT');
    }
    await audit(c, { action: 'CREATE', modul: 'kaskecil', keterangan: `Penyelesaian ${kk.id} → ${masuk.id}, uang kembali Rp ${jumlah}` });
    return c.json(okPayload({ keluar: { ...kk, status: 'Closed', no_kas_masuk: masuk.id }, masuk }));
  });

  app.delete('/keluar/:id/selesai', async (c: Ctx) => {
    const u = c.get('user');
    const kk = await cariKeluar(c.req.param('id') as string, u);
    cabangTulis(u, kk.kode_cabang);
    if (!kk.no_kas_masuk) throw new HttpError(409, 'Kas keluar ini belum diselesaikan.', 'CONFLICT');
    await deps.kaskecil.updateMasuk(kk.no_kas_masuk, { is_deleted: '1' });
    await deps.kaskecil.updateKeluar(kk.id, { status: 'Open', no_kas_masuk: '' });
    await audit(c, { action: 'DELETE', modul: 'kaskecil', keterangan: `Batalkan penyelesaian ${kk.id} (${kk.no_kas_masuk})` });
    return c.json(okPayload({ id: kk.id }));
  });

  // ── Tambah saldo (kas masuk tanpa kas keluar) ────────────────────────────
  app.post('/masuk', async (c: Ctx) => {
    const u = c.get('user');
    const b = await readJson(c);
    const kode = cabangTulis(u, b.cabang);
    const tanggal = tanggalValid(b.tanggal, 'Tanggal', todayWib());
    const jenis = (await deps.kaskecil.listJenis()).find((j) => j.tipe === 'MASUK' && j.aktif);
    if (!jenis) throw new HttpError(400, 'Jenis "Tambah Saldo" belum tersedia.', 'BAD_REQUEST');
    const { jumlah, pecahan } = ambilJumlah(b);
    const masuk: KasMasukRow = {
      id: '', kode_cabang: kode, tanggal, jam: jamWib(), no_kas_keluar: '', no_referensi: '', penerima: str(b.penerima).slice(0, 80), penerima_2: '', admin: u.nama || u.username,
      jenis_id: jenis.id, kode_akun: jenis.kode_akun, jenis: jenis.nama, pecahan, jumlah, keterangan: str(b.keterangan).slice(0, 300),
      created_by: u.username, created_at: new Date(deps.now()).toISOString(), is_deleted: '',
    };
    await sisipBernomor(kode, tanggal, 'KM', '', async (nomor) => {
      masuk.id = nomor;
      await deps.kaskecil.insertMasuk(masuk);
    });
    await audit(c, { action: 'CREATE', modul: 'kaskecil', keterangan: `Tambah saldo ${masuk.id} Rp ${jumlah}` });
    return c.json(okPayload({ masuk }));
  });

  app.delete('/masuk/:id', async (c: Ctx) => {
    const u = c.get('user');
    const m = await deps.kaskecil.findMasuk(c.req.param('id') as string);
    if (!m || m.is_deleted === '1') throw new HttpError(404, 'Kas masuk tidak ditemukan.', 'NOT_FOUND');
    cabangTulis(u, m.kode_cabang);
    if (m.no_kas_keluar) throw new HttpError(409, 'Kas masuk ini adalah penyelesaian kas keluar; batalkan dari kas keluarnya.', 'CONFLICT');
    await deps.kaskecil.updateMasuk(m.id, { is_deleted: '1' });
    await audit(c, { action: 'DELETE', modul: 'kaskecil', keterangan: `Hapus tambah saldo ${m.id} Rp ${m.jumlah}` });
    return c.json(okPayload({ id: m.id }));
  });

  // ── Laporan ──────────────────────────────────────────────────────────────
  const dataKas = async (cabang: string, sampai: string) => {
    const awal = await deps.kaskecil.getSaldoAwal(cabang);
    const dari = awal?.tanggal || undefined;
    const [keluar, masuk] = await Promise.all([deps.kaskecil.listKeluar({ cabang, dari, sampai }), deps.kaskecil.listMasuk({ cabang, dari, sampai })]);
    return { awal, keluar, masuk };
  };

  app.get('/laporan-harian', async (c: Ctx) => {
    const cabang = cabangBaca(c.get('user'), c.req.query('cabang'), { wajib: true });
    const tanggal = tanggalValid(c.req.query('tanggal'), 'Tanggal', todayWib());
    const { awal, keluar, masuk } = await dataKas(cabang, tanggal);
    return c.json(okPayload({ laporan: laporanHarian({ awal, keluar, masuk, tanggal }), rincian: rincianPecahanHarian({ awal, keluar, masuk, tanggal }), awal }));
  });

  // Saldo per pecahan saat ini (acuan form kas keluar / setoran).
  app.get('/saldo-pecahan', async (c: Ctx) => {
    const cabang = cabangBaca(c.get('user'), c.req.query('cabang'), { wajib: true });
    const tanggal = tanggalValid(c.req.query('tanggal'), 'Tanggal', todayWib());
    const { awal, keluar, masuk } = await dataKas(cabang, tanggal);
    return c.json(okPayload({ rincian: rincianPecahanHarian({ awal, keluar, masuk, tanggal }), awal }));
  });

  // Setor SELURUH saldo kas kecil ke bank, dikeluarkan sesuai pecahan yang ada; foto bukti setor wajib.
  app.post('/setoran', async (c: Ctx) => {
    const u = c.get('user');
    const b = await readJson(c);
    const kode = cabangTulis(u, b.cabang);
    const tanggal = tanggalValid(b.tanggal, 'Tanggal', todayWib());
    const jenis = (await deps.kaskecil.listJenis()).find((j) => j.tipe === 'KELUAR' && j.aktif && POLA_SETORAN.test(j.nama));
    if (!jenis) throw new HttpError(400, 'Jenis "Setoran Tunai Kas Kecil" belum tersedia.', 'BAD_REQUEST');
    if (!b.foto_bukti) throw new HttpError(400, 'Foto bukti setor bank wajib diupload.', 'BAD_REQUEST');
    const { awal, keluar, masuk } = await dataKas(kode, tanggal);
    const rincian = rincianPecahanHarian({ awal, keluar, masuk, tanggal });
    if (rincian.negatif.length) throw new HttpError(409, 'Rincian pecahan saldo tidak sinkron (ada pecahan bersaldo minus). Perbaiki catatan pecahan dulu sebelum setoran.', 'CONFLICT');
    if (!rincian.sinkron) throw new HttpError(409, `Saldo uang (Rp ${rincian.saldoUang}) tidak sama dengan total pecahan (Rp ${rincian.nilaiAkhir}). Perbaiki catatan pecahan dulu sebelum setoran.`, 'CONFLICT');
    const pecahan: Record<string, number> = {};
    for (const bar of rincian.baris) if (bar.akhir > 0) pecahan[bar.kunci] = bar.akhir;
    const jumlah = jumlahPecahan(pecahan);
    if (jumlah <= 0) throw new HttpError(400, 'Tidak ada saldo kas kecil untuk disetor.', 'BAD_REQUEST');
    let buktiUrl: string;
    try {
      const bytes = decodeBase64(b.foto_bukti);
      const { ext, contentType } = extOf(b.foto_bukti_name);
      buktiUrl = (await deps.uploadEvidence(c.env as Env, { branch: kode, folder: 'Kas_Setoran', bytes, ext, contentType })).url;
    } catch (e) {
      throw new HttpError(422, 'Upload foto bukti gagal: ' + (e as Error).message, 'UNPROCESSABLE');
    }
    const row: KasKeluarRow = {
      id: '', kode_cabang: kode, tanggal, jam: jamWib(), no_referensi: '', penerima: str(b.penerima).slice(0, 80) || 'Setoran Bank', penerima_2: '', admin: u.nama || u.username,
      jenis_id: jenis.id, kode_akun: jenis.kode_akun, jenis: jenis.nama, pecahan, jumlah, keterangan: str(b.keterangan).slice(0, 300) || 'Setor seluruh saldo kas kecil ke bank',
      bukti_url: buktiUrl, status: 'Closed', no_kas_masuk: '', created_by: u.username, created_at: new Date(deps.now()).toISOString(), is_deleted: '',
    };
    await sisipBernomor(kode, tanggal, 'KK', '', async (nomor) => {
      row.id = nomor;
      await deps.kaskecil.insertKeluar(row);
    });
    await audit(c, { action: 'CREATE', modul: 'kaskecil', keterangan: `Setoran bank ${row.id} Rp ${jumlah}` });
    return c.json(okPayload({ keluar: row }));
  });

  const bulanValid = (v: unknown): string => {
    const b = str(v) || todayWib().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(b)) throw new HttpError(400, 'Bulan tidak valid (format YYYY-MM).', 'BAD_REQUEST');
    return b;
  };
  const akhirBulan = (bulan: string) => bulan + '-31';

  app.get('/summary', async (c: Ctx) => {
    const cabang = cabangBaca(c.get('user'), c.req.query('cabang'), { wajib: true });
    const bulan = bulanValid(c.req.query('bulan'));
    const [keluar, masuk] = await Promise.all([
      deps.kaskecil.listKeluar({ cabang, dari: bulan + '-01', sampai: akhirBulan(bulan) }),
      deps.kaskecil.listMasuk({ cabang, dari: bulan + '-01' }),
    ]);
    return c.json(okPayload({ summary: summaryBulanan({ keluar, masuk, bulan }) }));
  });

  app.get('/pembanding', async (c: Ctx) => {
    const cabang = cabangBaca(c.get('user'), c.req.query('cabang'), { wajib: true });
    const bulan = bulanValid(c.req.query('bulan'));
    const dari = bulan + '-01';
    const sampai = akhirBulan(bulan);
    const [keluar, masuk, rows, tols, cards, topupRows] = await Promise.all([
      deps.kaskecil.listKeluar({ cabang, dari, sampai }),
      deps.kaskecil.listMasuk({ cabang, dari }),
      deps.laporan.rowsBetween(cabang, dari, sampai),
      deps.flazz.listTols(),
      deps.flazz.listCards(),
      deps.flazz.listTopups(),
    ]);
    const lines = rekapPengeluaran({ rows, tols, cards, platByVehicle: new Map(), dari, sampai, cabang });
    const topups = rekapTopup({ topups: topupRows, cards, namaPengguna: new Map(), dari, sampai, cabang });
    const appHarian = new Map<string, AppHarian>();
    const hari = (t: string) => appHarian.get(t) ?? appHarian.set(t, { bbmTunai: 0, topup: 0, tolTunai: 0 }).get(t)!;
    for (const l of lines) {
      if (l.metode !== 'TUNAI') continue;
      if (l.jenis === 'BBM') hari(l.tanggal).bbmTunai += l.amount; else hari(l.tanggal).tolTunai += l.amount;
    }
    for (const t of topups) hari(t.tanggal).topup += t.nominal;
    const summary = summaryBulanan({ keluar, masuk, bulan });
    return c.json(okPayload({ baris: pembandingHarian({ summary, app: appHarian, topupFinance: CABANG_TOPUP_VIA_FINANCE.includes(cabang) }) }));
  });

  // ── BA Cash Opname ───────────────────────────────────────────────────────
  app.get('/opname', async (c: Ctx) => {
    const cabang = cabangBaca(c.get('user'), c.req.query('cabang'));
    const opname = await deps.kaskecil.listOpname({ cabang, dari: str(c.req.query('dari')) || undefined, sampai: str(c.req.query('sampai')) || undefined });
    return c.json(okPayload({ opname: opname.reverse() }));
  });

  app.post('/opname', async (c: Ctx) => {
    const u = c.get('user');
    const b = await readJson(c);
    const kode = cabangTulis(u, b.cabang);
    const tanggal = tanggalValid(b.tanggal, 'Tanggal', todayWib());
    let pecahan: Record<string, number>;
    try {
      pecahan = normalPecahan(b.pecahan, PECAHAN_OPNAME);
    } catch (e) {
      throw new HttpError(400, (e as Error).message, 'BAD_REQUEST');
    }
    const nilaiFisik = jumlahPecahan(pecahan);
    const { awal, keluar, masuk } = await dataKas(kode, tanggal);
    const nilaiBuku = laporanHarian({ awal, keluar, masuk, tanggal }).ringkasan.saldoAkhir;
    const tahun = tanggal.slice(0, 4);
    const sudah = await deps.kaskecil.listOpname({ cabang: kode, dari: tahun + '-01-01', sampai: tahun + '-12-31' });
    const maks = sudah.reduce((n, o) => Math.max(n, Number(/^CO\.(\d+)\//.exec(o.id)?.[1] ?? 0)), 0);
    const row = {
      id: '', kode_cabang: kode, tanggal, pemeriksa: str(b.pemeriksa) || u.nama || u.username, pecahan, nilai_fisik: nilaiFisik, nilai_buku: nilaiBuku,
      selisih: nilaiFisik - nilaiBuku, catatan: str(b.catatan).slice(0, 300), created_by: u.username, created_at: new Date(deps.now()).toISOString(), is_deleted: '',
    };
    let ok = false;
    for (let i = 1; i <= 10 && !ok; i++) {
      row.id = `CO.${String(maks + i).padStart(3, '0')}/TSI-OPR/${kode}/${ROMAWI[Number(tanggal.slice(5, 7)) - 1]}/${tahun}`;
      try {
        await deps.kaskecil.insertOpname(row);
        ok = true;
      } catch (e) {
        if (!(e instanceof NomorKasBentrok)) throw e;
      }
    }
    if (!ok) throw new HttpError(409, 'Gagal membuat nomor BA, coba lagi.', 'CONFLICT');
    await audit(c, { action: 'CREATE', modul: 'kaskecil', keterangan: `Cash opname ${row.id}: fisik Rp ${nilaiFisik}, buku Rp ${nilaiBuku}` });
    return c.json(okPayload({ opname: row }));
  });

  app.delete('/opname/:id{.+}', async (c: Ctx) => {
    const u = c.get('user');
    const o = await deps.kaskecil.findOpname(decodeURIComponent(c.req.param('id') as string));
    if (!o || o.is_deleted === '1') throw new HttpError(404, 'BA cash opname tidak ditemukan.', 'NOT_FOUND');
    cabangTulis(u, o.kode_cabang);
    await deps.kaskecil.updateOpname(o.id, { is_deleted: '1' });
    await audit(c, { action: 'DELETE', modul: 'kaskecil', keterangan: 'Hapus BA cash opname ' + o.id });
    return c.json(okPayload({ id: o.id }));
  });

  return app;
}
