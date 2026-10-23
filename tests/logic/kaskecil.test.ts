import { describe, expect, it } from 'vitest';
import {
  PECAHAN, jumlahPecahan, laporanHarian, nomorKas, normalPecahan, pembandingHarian, rincianPecahanHarian, saldoPecahan, summaryBulanan, tipeWh, uraiPecahan, urutBerikut,
} from '../../src/logic/kaskecil';

const kk = (o: Record<string, unknown>) => ({
  id: 'KK-1', kode_cabang: 'KWG', tanggal: '2026-10-22', jam: '10:00:00', no_referensi: 'BO-1', penerima: 'Agus', admin: 'Gin', jenis_id: 'KJ-1',
  kode_akun: '6101-103', jenis: 'Biaya Bensin Delivery', pecahan: {}, jumlah: 100000, keterangan: '', status: 'Open', no_kas_masuk: '', is_deleted: '', ...o,
}) as any;
const km = (o: Record<string, unknown>) => ({
  id: 'KM-1', kode_cabang: 'KWG', tanggal: '2026-10-22', jam: '16:00:00', no_kas_keluar: 'KK-1', no_referensi: '', penerima: 'Agus', admin: 'Gin',
  jenis: 'Biaya Bensin Delivery', pecahan: {}, jumlah: 0, keterangan: '', is_deleted: '', ...o,
}) as any;

describe('pecahan', () => {
  it('12 pecahan sesuai Excel; jumlah dihitung dari lembar', () => {
    expect(PECAHAN).toEqual(['100000', '50000', '20000', '10000', '5000', '2000', '1000', 'K1000', '500', '200', '100', '50']);
    expect(jumlahPecahan({ '100000': 2, '5000': 3, K1000: 1 })).toBe(216000);
  });
  it('normalPecahan membuang nol & menolak kunci/jumlah tak valid', () => {
    expect(normalPecahan({ '50000': 2, '20000': 0 })).toEqual({ '50000': 2 });
    expect(normalPecahan(undefined)).toEqual({});
    expect(() => normalPecahan({ '777': 1 })).toThrow();
    expect(() => normalPecahan({ '50000': -1 })).toThrow();
    expect(() => normalPecahan({ '50000': 1.5 })).toThrow();
  });
});

describe('penomoran', () => {
  it('format sama dengan Excel; WHO/WHP dari nama cabang', () => {
    expect(nomorKas('KK', 'WHO', 'KWG', '2026-10-22', 121)).toBe('KK-WHO-KWG-202610220121');
    expect(nomorKas('BP', 'WHP', 'GDGBDG', '2026-10-01', 1)).toBe('BP-WHP-GDGBDG-202610010001');
    expect(tipeWh('WHP BANDUNG')).toBe('WHP');
    expect(tipeWh('Who Karawang')).toBe('WHO');
    expect(tipeWh('Gudang Bandung')).toBe('WHO');
  });
  it('urutan naik per bulan per awalan & cabang', () => {
    const ids = ['KK-WHO-KWG-202610010001', 'KK-WHO-KWG-202610220126', 'KK-WHO-KWG-202609300200', 'KK-WHO-BDG-202610150300', 'KM-WHO-KWG-202610220060'];
    expect(urutBerikut(ids, 'KK', 'WHO', 'KWG', '2026-10-23')).toBe(127);
    expect(urutBerikut(ids, 'KM', 'WHO', 'KWG', '2026-10-23')).toBe(61);
    expect(urutBerikut(ids, 'BO', 'WHO', 'KWG', '2026-10-23')).toBe(1);
    expect(urutBerikut(ids, 'KK', 'WHO', 'KWG', '2026-11-02')).toBe(1);
  });
});

describe('laporanHarian', () => {
  const awal = { tanggal: '2026-10-01', jumlah: 1000000 };
  const keluar = [kk({ id: 'KK-A', tanggal: '2026-10-21', jumlah: 300000, status: 'Closed', no_kas_masuk: 'KM-A' }), kk({ id: 'KK-B', jumlah: 100000, jam: '09:00:00' }), kk({ id: 'KK-C', jumlah: 50000, jam: '11:00:00', status: 'Closed', no_kas_masuk: 'KM-C' })];
  const masuk = [km({ id: 'KM-A', tanggal: '2026-10-21', no_kas_keluar: 'KK-A', jumlah: 100000 }), km({ id: 'KM-C', no_kas_keluar: 'KK-C', jumlah: 20000 }), km({ id: 'KM-T', no_kas_keluar: '', jenis: 'Tambah Saldo', jumlah: 500000, jam: '08:00:00' })];
  it('saldo awal hari, baris berurut waktu dengan saldo berjalan, ringkasan', () => {
    const r = laporanHarian({ awal, keluar, masuk, tanggal: '2026-10-22' });
    expect(r.saldoAwal).toBe(800000); // 1.000.000 - 300.000 + 100.000
    expect(r.baris.map((b) => [b.nomor, b.debit, b.kredit, b.saldo])).toEqual([
      ['KM-T', 500000, 0, 1300000], ['KK-B', 0, 100000, 1200000], ['KK-C', 0, 50000, 1150000], ['KM-C', 20000, 0, 1170000],
    ]);
    expect(r.ringkasan).toEqual({ saldoAwal: 800000, keluar: 150000, masuk: 520000, belumSelesai: 100000, saldoAkhir: 1170000 });
  });
  it('transaksi sebelum tanggal saldo awal & yang terhapus diabaikan', () => {
    const r = laporanHarian({ awal, keluar: [kk({ id: 'KK-X', tanggal: '2026-09-30', jumlah: 999 }), kk({ id: 'KK-D', is_deleted: '1', jumlah: 777 })], masuk: [], tanggal: '2026-10-22' });
    expect(r.saldoAwal).toBe(1000000);
    expect(r.ringkasan.saldoAkhir).toBe(1000000);
  });
  it('status & belum selesai mengikuti tanggal laporan: KK yang diselesaikan kemudian masih Open pada laporan lama', () => {
    const kkLama = kk({ id: 'KK-L', tanggal: '2026-10-10', jumlah: 100000, status: 'Closed', no_kas_masuk: 'KM-L' });
    const kmLama = km({ id: 'KM-L', tanggal: '2026-10-20', no_kas_keluar: 'KK-L', jumlah: 40000 });
    const lama = laporanHarian({ awal, keluar: [kkLama], masuk: [kmLama], tanggal: '2026-10-15' });
    expect(lama.ringkasan.belumSelesai).toBe(100000);
    const baru = laporanHarian({ awal, keluar: [kkLama], masuk: [kmLama], tanggal: '2026-10-20' });
    expect(baru.ringkasan.belumSelesai).toBe(0);
    expect(laporanHarian({ awal, keluar: [kk({ id: 'KK-H', tanggal: '2026-10-15', status: 'Closed', no_kas_masuk: 'KM-L' })], masuk: [kmLama], tanggal: '2026-10-15' }).baris[0]!.status).toBe('Open');
  });
  it('tanpa saldo awal dianggap 0', () => {
    expect(laporanHarian({ awal: null, keluar: [], masuk: [], tanggal: '2026-10-22' }).saldoAwal).toBe(0);
  });
});

describe('summaryBulanan', () => {
  it('nilai = KK - KM per jenis per tanggal KK; total; KM tanpa KK (tambah saldo) diabaikan', () => {
    const keluar = [
      kk({ id: 'A', tanggal: '2026-10-01', jenis: 'Biaya Bensin Delivery', jumlah: 250000 }),
      kk({ id: 'B', tanggal: '2026-10-01', jenis: 'Biaya Uang Muka Delivery', jumlah: 100000 }),
      kk({ id: 'C', tanggal: '2026-10-03', jenis: 'Biaya Bensin Delivery', jumlah: 300000 }),
      kk({ id: 'D', tanggal: '2026-09-30', jenis: 'Biaya Bensin Delivery', jumlah: 999 }),
    ];
    const masuk = [km({ no_kas_keluar: 'B', jumlah: 100000 }), km({ id: 'KM-T', no_kas_keluar: '', jumlah: 1 })];
    const s = summaryBulanan({ keluar, masuk, bulan: '2026-10' });
    expect(s.jenis).toEqual(['Biaya Bensin Delivery', 'Biaya Uang Muka Delivery']);
    expect(s.baris.map((b) => [b.tanggal, b.nilai['Biaya Bensin Delivery'] ?? 0, b.nilai['Biaya Uang Muka Delivery'] ?? 0, b.total])).toEqual([
      ['2026-10-01', 250000, 0, 250000], ['2026-10-03', 300000, 0, 300000],
    ]);
    expect(s.total).toEqual({ 'Biaya Bensin Delivery': 550000, 'Biaya Uang Muka Delivery': 0, semua: 550000 });
  });
});

describe('pembandingHarian', () => {
  it('membandingkan BBM tunai, top up Flazz, tol tunai dengan jenis kas; menandai selisih', () => {
    const summary = {
      jenis: ['Biaya Bensin Delivery', 'Biaya Pengisian ETOLL', 'Biaya Uang Muka Delivery'],
      baris: [
        { tanggal: '2026-10-01', nilai: { 'Biaya Bensin Delivery': 250000, 'Biaya Pengisian ETOLL': 300000 }, total: 550000 },
        { tanggal: '2026-10-02', nilai: { 'Biaya Bensin Delivery': 100000 }, total: 100000 },
      ],
      total: {},
    } as any;
    const app = new Map([['2026-10-01', { bbmTunai: 250000, topup: 300000, tolTunai: 0 }], ['2026-10-03', { bbmTunai: 50000, topup: 0, tolTunai: 7000 }]]);
    const r = pembandingHarian({ summary, app });
    expect(r.map((x) => [x.tanggal, x.bbm.app, x.bbm.kas, x.bbm.selisih, x.topup.selisih, x.tol.selisih, x.cocok])).toEqual([
      ['2026-10-01', 250000, 250000, 0, 0, 0, true],
      ['2026-10-02', 0, 100000, -100000, 0, 0, false],
      ['2026-10-03', 50000, 0, 50000, 0, 7000, false],
    ]);
  });
});

describe('pembandingHarian — top up via Finance', () => {
  it('cabang via Finance: top up tidak dibandingkan dengan kas kecil dan tidak membuat status Selisih', () => {
    const summary = { jenis: [], baris: [{ tanggal: '2026-10-01', nilai: {}, total: 0 }], total: {} } as any;
    const app = new Map([['2026-10-01', { bbmTunai: 0, topup: 500000, tolTunai: 0 }]]);
    const r = pembandingHarian({ summary, app, topupFinance: true });
    expect(r[0]).toMatchObject({ topupFinance: true, cocok: true, topup: { app: 500000, selisih: 0 } });
    expect(pembandingHarian({ summary, app })[0]).toMatchObject({ topupFinance: false, cocok: false, topup: { selisih: 500000 } });
  });
});

describe('saldo per pecahan', () => {
  const awal = { tanggal: '2026-10-01', jumlah: 615000, pecahan: { '100000': 5, '50000': 2, '5000': 3 } };
  const kkP = (o: Record<string, unknown>) => kk({ ...o });
  it('uraiPecahan memecah nominal dengan pecahan terbesar dulu', () => {
    expect(uraiPecahan(215000)).toEqual({ '100000': 2, '10000': 1, '5000': 1 });
    expect(uraiPecahan(0)).toEqual({});
  });
  it('saldo = awal + masuk − keluar per pecahan; hari berjalan & sebelum hari', () => {
    const keluar = [kkP({ id: 'A', tanggal: '2026-10-05', pecahan: { '100000': 1, '5000': 1 }, jumlah: 105000 })];
    const masuk = [km({ id: 'M', tanggal: '2026-10-06', no_kas_keluar: '', pecahan: { '50000': 4 }, jumlah: 200000 })];
    expect(saldoPecahan({ awal, keluar, masuk, tanggal: '2026-10-05' })).toMatchObject({ '100000': 4, '50000': 2, '5000': 2 });
    expect(saldoPecahan({ awal, keluar, masuk, tanggal: '2026-10-06' })).toMatchObject({ '100000': 4, '50000': 6, '5000': 2 });
    expect(saldoPecahan({ awal, keluar, masuk, tanggal: '2026-10-05', sebelum: true })).toMatchObject({ '100000': 5, '5000': 3 });
    expect(Object.keys(saldoPecahan({ awal: null, keluar: [], masuk: [] })).sort()).toEqual([...PECAHAN].sort());
  });
  it('rincian harian: baris awal/masuk/keluar/akhir, nilai, sinkron & negatif', () => {
    const keluar = [kkP({ id: 'A', tanggal: '2026-10-05', pecahan: { '100000': 1, '5000': 1 }, jumlah: 105000 })];
    const r = rincianPecahanHarian({ awal, keluar, masuk: [], tanggal: '2026-10-05' });
    const b100 = r.baris.find((x) => x.kunci === '100000')!;
    expect(b100).toMatchObject({ awal: 5, masuk: 0, keluar: 1, akhir: 4, nilaiAkhir: 400000 });
    expect(r).toMatchObject({ nilaiAwal: 615000, nilaiAkhir: 510000, saldoUang: 510000, selisih: 0, sinkron: true, negatif: [] });
    const rusak = rincianPecahanHarian({ awal: { tanggal: '2026-10-01', jumlah: 100000, pecahan: {} }, keluar: [kkP({ id: 'B', tanggal: '2026-10-05', pecahan: { '50000': 1 }, jumlah: 50000 })], masuk: [], tanggal: '2026-10-05' });
    expect(rusak.sinkron).toBe(false);
    expect(rusak.negatif).toEqual(['50000']);
  });
});
