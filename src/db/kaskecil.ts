import type { Env } from '../env';
import { getSupabase } from './client';
import type { KasKeluarRow, KasMasukRow, SaldoAwal } from '../logic/kaskecil';

export interface KasJenisRow {
  id: string;
  kode_akun: string;
  nama: string;
  prefiks_ref: string; // 'BO' | 'BP' | ''
  tipe: string; // 'KELUAR' | 'MASUK'
  tanpa_penyelesaian: boolean;
  aktif: boolean;
  urut: number;
}

export interface KasOpnameRow {
  id: string;
  kode_cabang: string;
  tanggal: string;
  pemeriksa: string;
  pecahan: Record<string, number>;
  nilai_fisik: number;
  nilai_buku: number;
  selisih: number;
  catatan: string;
  created_by: string;
  created_at: string;
  is_deleted: string;
}

export interface KasRentang { cabang: string; dari?: string; sampai?: string }

export class NomorKasBentrok extends Error {}

// Repo kas kecil. `cabang` kosong = semua cabang (hanya untuk peran baca-semua).
export interface KasKecilRepo {
  listJenis(): Promise<KasJenisRow[]>;
  upsertJenis(row: KasJenisRow): Promise<void>;
  getSaldoAwal(cabang: string): Promise<SaldoAwal | null>;
  setSaldoAwal(cabang: string, awal: SaldoAwal): Promise<void>;
  listKeluar(f: KasRentang): Promise<KasKeluarRow[]>;
  findKeluar(id: string): Promise<KasKeluarRow | null>;
  insertKeluar(row: KasKeluarRow): Promise<void>;
  updateKeluar(id: string, patch: Partial<KasKeluarRow>): Promise<void>;
  // Tutup kas keluar hanya bila masih Open (atomik); false = sudah diselesaikan pihak lain.
  tutupKeluar(id: string, noKasMasuk: string): Promise<boolean>;
  listMasuk(f: KasRentang): Promise<KasMasukRow[]>;
  findMasuk(id: string): Promise<KasMasukRow | null>;
  insertMasuk(row: KasMasukRow): Promise<void>;
  updateMasuk(id: string, patch: Partial<KasMasukRow>): Promise<void>;
  // Semua nomor (KK, KM, referensi) milik cabang pada bulan itu (termasuk yang terhapus) untuk penomoran berikutnya.
  nomorBulan(cabang: string, bulan: string): Promise<string[]>;
  listOpname(f: KasRentang): Promise<KasOpnameRow[]>;
  findOpname(id: string): Promise<KasOpnameRow | null>;
  insertOpname(row: KasOpnameRow): Promise<void>;
  updateOpname(id: string, patch: Partial<KasOpnameRow>): Promise<void>;
}

const HALAMAN = 1000;

export function supabaseKasKecilRepo(env: Env): KasKecilRepo {
  const sb = () => getSupabase(env);
  const fail = (kind: string) => (err: unknown): never => {
    throw new Error(`DB kas kecil ${kind}: ${(err as Error)?.message ?? String(err)}`);
  };
  // PostgREST membatasi 1000 baris per permintaan; ambil per halaman sampai habis.
  const semua = async <T>(kind: string, bangun: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>): Promise<T[]> => {
    const out: T[] = [];
    for (let from = 0; ; from += HALAMAN) {
      const { data, error } = await bangun(from, from + HALAMAN - 1);
      if (error) throw fail(kind)(error);
      const rows = (data as T[] | null) ?? [];
      out.push(...rows);
      if (rows.length < HALAMAN) return out;
    }
  };
  const rentang = (tabel: string, f: KasRentang, urut: string) => (from: number, to: number) => {
    let q = sb().from(tabel).select('*').neq('is_deleted', '1');
    if (f.cabang) q = q.eq('kode_cabang', f.cabang);
    if (f.dari) q = q.gte('tanggal', f.dari);
    if (f.sampai) q = q.lte('tanggal', f.sampai);
    return q.order('tanggal', { ascending: true }).order(urut, { ascending: true }).range(from, to);
  };
  const cari = async <T>(tabel: string, id: string, kind: string): Promise<T | null> => {
    const { data, error } = await sb().from(tabel).select('*').eq('id', id).maybeSingle();
    if (error) throw fail(kind)(error);
    return (data as T | null) ?? null;
  };
  const sisip = async (tabel: string, row: object, kind: string) => {
    const { error } = await sb().from(tabel).insert(row);
    if (error) {
      if ((error as { code?: string }).code === '23505') throw new NomorKasBentrok('Nomor sudah dipakai.');
      throw fail(kind)(error);
    }
  };
  const ubah = async (tabel: string, id: string, patch: object, kind: string) => {
    const { error } = await sb().from(tabel).update(patch).eq('id', id);
    if (error) throw fail(kind)(error);
  };

  return {
    async listJenis() {
      const { data, error } = await sb().from('kas_jenis').select('*').order('urut', { ascending: true });
      if (error) throw fail('listJenis')(error);
      return (data as KasJenisRow[] | null) ?? [];
    },
    async upsertJenis(row) {
      const { error } = await sb().from('kas_jenis').upsert(row, { onConflict: 'id' });
      if (error) throw fail('upsertJenis')(error);
    },
    async getSaldoAwal(cabang) {
      const { data, error } = await sb().from('kas_saldo_awal').select('tanggal,jumlah').eq('kode_cabang', cabang).maybeSingle();
      if (error) throw fail('getSaldoAwal')(error);
      return data ? { tanggal: String((data as any).tanggal), jumlah: Number((data as any).jumlah) || 0 } : null;
    },
    async setSaldoAwal(cabang, awal) {
      const { error } = await sb().from('kas_saldo_awal').upsert({ kode_cabang: cabang, tanggal: awal.tanggal, jumlah: awal.jumlah }, { onConflict: 'kode_cabang' });
      if (error) throw fail('setSaldoAwal')(error);
    },
    listKeluar: (f) => semua<KasKeluarRow>('listKeluar', rentang('kas_keluar', f, 'jam')),
    findKeluar: (id) => cari<KasKeluarRow>('kas_keluar', id, 'findKeluar'),
    insertKeluar: (row) => sisip('kas_keluar', row, 'insertKeluar'),
    updateKeluar: (id, patch) => ubah('kas_keluar', id, patch, 'updateKeluar'),
    async tutupKeluar(id, noKasMasuk) {
      const { data, error } = await sb().from('kas_keluar').update({ status: 'Closed', no_kas_masuk: noKasMasuk }).eq('id', id).eq('status', 'Open').select('id');
      if (error) throw fail('tutupKeluar')(error);
      return ((data as unknown[] | null) ?? []).length > 0;
    },
    listMasuk: (f) => semua<KasMasukRow>('listMasuk', rentang('kas_masuk', f, 'jam')),
    findMasuk: (id) => cari<KasMasukRow>('kas_masuk', id, 'findMasuk'),
    insertMasuk: (row) => sisip('kas_masuk', row, 'insertMasuk'),
    updateMasuk: (id, patch) => ubah('kas_masuk', id, patch, 'updateMasuk'),
    async nomorBulan(cabang, bulan) {
      const out: string[] = [];
      const kk = await semua<{ id: string; no_referensi: string }>('nomorBulan', (from, to) =>
        sb().from('kas_keluar').select('id,no_referensi').eq('kode_cabang', cabang).like('tanggal', bulan + '%').range(from, to));
      for (const r of kk) out.push(r.id, r.no_referensi);
      const km = await semua<{ id: string; no_referensi: string }>('nomorBulan', (from, to) =>
        sb().from('kas_masuk').select('id,no_referensi').eq('kode_cabang', cabang).like('tanggal', bulan + '%').range(from, to));
      for (const r of km) out.push(r.id, r.no_referensi);
      return out.filter(Boolean);
    },
    listOpname: (f) => semua<KasOpnameRow>('listOpname', rentang('kas_opname', f, 'created_at')),
    findOpname: (id) => cari<KasOpnameRow>('kas_opname', id, 'findOpname'),
    insertOpname: (row) => sisip('kas_opname', row, 'insertOpname'),
    updateOpname: (id, patch) => ubah('kas_opname', id, patch, 'updateOpname'),
  };
}
