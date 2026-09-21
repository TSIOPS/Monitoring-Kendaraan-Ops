import { describe, expect, it } from 'vitest';
import {
  LaporanRow, buildFlazzChecks, buildOdoWarning, classifyEfisiensiStatus, computeEfisiensi,
  computeLiterKonsumsi, distinctFlazzCards, estimateOdo, flazzCardCharge, flazzEditDelta,
  formatDateId, formatIdNumber, hitungEfisiensi7Riwayat, literPerBarFor, msgCardNotFound,
  msgEditInsufficient, msgInsufficient, OdoEstimateError, MSG_ODO_NO_LITER, MSG_ODO_NO_STANDAR,
  parseEditAmount, parseEditMethod, resolveTollCard, resolveTollMethod, shouldAdjustUsageOpeningAt,
  shouldAutoCreateUsageOnEdit, storeMetodeBbm,
} from '../../src/logic/laporan';
import {
  buildPerformaList, buildRecentList, groupMonthly, isDuplicateRow, mapPrefillRow, supabaseThumb,
} from '../../src/logic/laporan';

const row = (over: Partial<LaporanRow> = {}): LaporanRow => ({
  transaction_id: 'TRX-1', timestamp: '2026-09-01T01:00:00.000Z', tanggal: '2026-09-01',
  user_id: 'U-1', nama_pengguna: 'Budi', kode_cabang: 'CBG-A', vehicle_id: 'V-1', plat_nomor: 'B 1 A',
  foto_km_awal: '', ocr_km_awal: '', km_awal_confirmed: '100', bar_awal: '8',
  foto_km_akhir: '', ocr_km_akhir: '', km_akhir_confirmed: '200', bar_akhir: '4',
  km_tempuh: 100, perubahan_bar: 4, liter_bbm: 10, biaya_bbm: 100000,
  foto_struk_bbm: '', biaya_toll: 0, foto_struk_toll: '', km_per_liter: 10,
  status: 'COMPLETED', warning: '', nama_supir: 'Supir A', metode_pembayaran: 'TUNAI',
  flazz_card_id: '', km_sumber: 'AKTUAL', metode_toll: 'TUNAI', flazz_card_id_toll: '',
  ...over,
});

describe('PaymentLogic', () => {
  it('resolveTollMethod: eksplisit > BBM FLAZZ > kartu tol terisi > TUNAI', () => {
    expect(resolveTollMethod('TUNAI', 'FLAZZ', '')).toBe('TUNAI');
    expect(resolveTollMethod('', 'FLAZZ', '')).toBe('FLAZZ');
    expect(resolveTollMethod(undefined, 'TUNAI', 'FLZ-1')).toBe('FLAZZ');
    expect(resolveTollMethod(undefined, 'TUNAI', '')).toBe('TUNAI');
  });

  it('resolveTollCard: hanya saat tol FLAZZ; fallback kartu BBM', () => {
    expect(resolveTollCard('FLZ-9', 'TUNAI', 'FLAZZ', 'FLZ-1')).toBe('');
    expect(resolveTollCard('FLZ-9', 'FLAZZ', 'FLAZZ', 'FLZ-1')).toBe('FLZ-9');
    expect(resolveTollCard('', 'FLAZZ', 'FLAZZ', 'FLZ-1')).toBe('FLZ-1');
  });

  it('flazzCardCharge & flazzEditDelta menjumlahkan BBM+tol per kartu', () => {
    const st = { metodeBbm: 'FLAZZ', cardBbm: 'FLZ-1', biayaBbm: 50000, metodeTol: 'FLAZZ', cardTol: 'FLZ-1', biayaTol: 20000 };
    expect(flazzCardCharge(st, 'FLZ-1')).toBe(70000);
    expect(flazzCardCharge(st, 'FLZ-2')).toBe(0);
    const next = { ...st, biayaBbm: 30000 };
    expect(flazzEditDelta(st, next, 'FLZ-1')).toBe(20000);
    expect(flazzEditDelta(st, { metodeBbm: 'TUNAI', cardBbm: '', biayaBbm: 0, metodeTol: 'TUNAI', cardTol: '', biayaTol: 0 }, 'FLZ-1')).toBe(70000);
  });

  it('distinctFlazzCards & buildFlazzChecks', () => {
    expect(distinctFlazzCards('FLAZZ', 'FLZ-1', 'FLAZZ', 'FLZ-1')).toEqual(['FLZ-1']);
    expect(distinctFlazzCards('FLAZZ', 'FLZ-1', 'FLAZZ', 'FLZ-2')).toEqual(['FLZ-1', 'FLZ-2']);
    const checks = buildFlazzChecks('FLAZZ', 'FLZ-1', 50000, 'FLAZZ', 'FLZ-1', 20000);
    expect(checks).toEqual([{ cardId: 'FLZ-1', label: ['BBM', 'tol'], total: 70000 }]);
  });

  it('parseEditAmount/Method: undefined = pertahankan, "" = 0/kosong', () => {
    expect(parseEditAmount(undefined, 10)).toBe(10);
    expect(parseEditAmount('', 10)).toBe(0);
    expect(parseEditAmount('5', 10)).toBe(5);
    expect(parseEditMethod(undefined, 'FLAZZ')).toBe('FLAZZ');
    expect(parseEditMethod('', 'FLAZZ')).toBe('');
  });
});

describe('estimasi odo', () => {
  const base = { kmAwal: 0, kmAkhir: 0, kmAwalBroken: true, kmAkhirBroken: false, kmTanpaEstimasi: false, standarKmL: 10, literKonsumsi: 5, prevKmAkhir: null as number | null };

  it('akhir rusak -> km_akhir = km_awal + estKm', () => {
    const r = estimateOdo({ ...base, kmAwalBroken: false, kmAkhirBroken: true, kmAwal: 100, kmAkhir: 0 });
    expect(r).toEqual({ kmAwal: 100, kmAkhir: 150, kmTempuh: 50, kmSumber: 'ESTIMASI' });
  });

  it('awal rusak -> km_awal = km_akhir - estKm (clamp 0)', () => {
    expect(estimateOdo({ ...base, kmAwal: 0, kmAkhir: 150, kmAwalBroken: true, kmAkhirBroken: false }).kmAwal).toBe(100);
    expect(estimateOdo({ ...base, kmAwal: 0, kmAkhir: 20 }).kmAwal).toBe(0);
  });

  it('keduanya rusak -> anchor prev', () => {
    const r = estimateOdo({ ...base, kmAwalBroken: true, kmAkhirBroken: true, prevKmAkhir: 900 });
    expect(r).toEqual({ kmAwal: 900, kmAkhir: 950, kmTempuh: 50, kmSumber: 'ESTIMASI' });
  });

  it('km_tanpa_estimasi -> isi sisi kosong dengan anchor', () => {
    const r = estimateOdo({ ...base, kmAwal: 0, kmAkhir: 0, kmTanpaEstimasi: true, standarKmL: 0, literKonsumsi: 0, prevKmAkhir: 700 });
    expect(r).toEqual({ kmAwal: 700, kmAkhir: 700, kmTempuh: 0, kmSumber: 'ESTIMASI' });
  });

  it('tanpa estimasi -> throw pesan GAS sesuai sebab', () => {
    expect(() => estimateOdo({ ...base, standarKmL: 0 })).toThrow(OdoEstimateError);
    expect(() => estimateOdo({ ...base, standarKmL: 0 })).toThrow(MSG_ODO_NO_STANDAR);
    expect(() => estimateOdo({ ...base, standarKmL: 10, literKonsumsi: 0 })).toThrow(MSG_ODO_NO_LITER);
  });

  it('tidak rusak -> AKTUAL', () => {
    expect(estimateOdo({ ...base, kmAwalBroken: false, kmAkhirBroken: false, kmAwal: 10, kmAkhir: 60 }))
      .toEqual({ kmAwal: 10, kmAkhir: 60, kmTempuh: 50, kmSumber: 'AKTUAL' });
  });
});

describe('liter konsumsi, efisiensi, warning, formatter', () => {
  it('literPerBarFor & computeLiterKonsumsi (clamp)', () => {
    expect(literPerBarFor(50, 8)).toBe(6.25);
    expect(literPerBarFor(0, 8)).toBe(0);
    expect(computeLiterKonsumsi(10, 8, 4, 6.25)).toBe(35);
    expect(computeLiterKonsumsi(10, 0, 8, 6.25)).toBe(10);
  });

  it('computeEfisiensi & classify', () => {
    expect(computeEfisiensi(100, 10)).toBe('10.00');
    expect(computeEfisiensi(100, 0)).toBe('');
    expect(classifyEfisiensiStatus('10', 12)).toBe('Di bawah standar');
    expect(classifyEfisiensiStatus('12', 12)).toBe('Sesuai standar');
    expect(classifyEfisiensiStatus('16', 12)).toBe('Di atas standar');
    expect(classifyEfisiensiStatus('', 12)).toBe('');
  });

  it('storeMetodeBbm', () => {
    expect(storeMetodeBbm(50000, 'FLAZZ')).toBe('FLAZZ');
    expect(storeMetodeBbm(0, 'FLAZZ')).toBe('');
    expect(storeMetodeBbm(50000, '')).toBe('TUNAI');
  });

  it('buildOdoWarning verbatim', () => {
    expect(buildOdoWarning(1500, 1400, '2026-09-20'))
      .toBe('SELISIH ODO: KM akhir terakhir 1.400 (20/09/2026), KM awal 1.500, selisih 100 KM - indikasi pemakaian di luar jam kerja');
  });

  it('formatIdNumber & formatDateId', () => {
    expect(formatIdNumber(1234567)).toBe('1.234.567');
    expect(formatIdNumber(0)).toBe('0');
    expect(formatDateId('2026-09-21')).toBe('21/09/2026');
    expect(formatDateId('')).toBe('-');
  });
});

describe('hitungEfisiensi7Riwayat', () => {
  const mk = (i: number, over: Partial<LaporanRow> = {}) => row({
    transaction_id: 'TRX-' + i, tanggal: `2026-09-${String(i).padStart(2, '0')}`,
    km_tempuh: 100, liter_bbm: 10, bar_awal: '8', bar_akhir: '4', km_sumber: 'AKTUAL', ...over,
  });

  it('butuh 7 baris; slice aman untuk currIdx < 6', () => {
    const trxs = Array.from({ length: 7 }, (_, i) => mk(i + 1));
    expect(hitungEfisiensi7Riwayat(trxs, 6, 0).isDataCukup).toBe(true);
    expect(hitungEfisiensi7Riwayat(trxs, 5, 0).isDataCukup).toBe(false);
    expect(hitungEfisiensi7Riwayat(trxs, 0, 0).efisiensi).toBe('10.00');
    expect(hitungEfisiensi7Riwayat([], 0, 0).isDataCukup).toBe(false);
  });

  it('label ⚠ bila ada estimasi; total konsumsi memperhitungkan bar', () => {
    const trxs = Array.from({ length: 7 }, (_, i) => mk(i + 1));
    trxs[6] = { ...trxs[6]!, km_sumber: 'ESTIMASI' };
    const r = hitungEfisiensi7Riwayat(trxs, 6, 6.25);
    // totalBeli 70, bar 8->4 => +25 => 95 ; totalKm 700
    expect(r.totalBeli).toBe(70);
    expect(r.totalKonsumsi).toBe(95);
    expect(r.efisiensi).toBe((700 / 95).toFixed(2));
    expect(r.label).toBe('Rata-rata 7 Trip ⚠ termasuk estimasi');
    expect(r.supir).toBe('Supir A');
  });

  it('total konsumsi <= 0 -> fallback totalBeli; km 0 -> efisiensi kosong', () => {
    const trxs = Array.from({ length: 7 }, (_, i) => mk(i + 1, { bar_akhir: '28', liter_bbm: 10 }));
    expect(hitungEfisiensi7Riwayat(trxs, 6, 6.25).totalKonsumsi).toBe(70);
    const zeroKm = Array.from({ length: 7 }, (_, i) => mk(i + 1, { km_tempuh: 0 }));
    expect(hitungEfisiensi7Riwayat(zeroKm, 6, 0).efisiensi).toBe('');
    expect(hitungEfisiensi7Riwayat(zeroKm, 6, 0).label).toBe('');
  });
});

describe('helper usage & pesan', () => {
  it('shouldAdjustUsageOpeningAt & shouldAutoCreateUsageOnEdit', () => {
    expect(shouldAdjustUsageOpeningAt(null, 100)).toBe(true);
    expect(shouldAdjustUsageOpeningAt(50, null)).toBe(true);
    expect(shouldAdjustUsageOpeningAt(50, 100)).toBe(true);
    expect(shouldAdjustUsageOpeningAt(150, 100)).toBe(false);
    expect(shouldAutoCreateUsageOnEdit(false, true)).toBe(true);
    expect(shouldAutoCreateUsageOnEdit(true, true)).toBe(false);
  });

  it('pesan verbatim', () => {
    expect(msgCardNotFound(['BBM', 'tol'], 'FLZ-1'))
      .toBe('Kartu Flazz untuk BBM + tol (ID: FLZ-1) tidak ditemukan. Pilih ulang kartu Flazz yang valid sebelum menyimpan laporan.');
    expect(msgInsufficient('Kartu A', ['BBM'], 10000, 25000))
      .toBe('Saldo kartu Flazz (Kartu A) tidak mencukupi untuk BBM. Saldo: Rp 10.000, Total pengeluaran: Rp 25.000. Silakan top up Flazz terlebih dahulu.');
    expect(msgEditInsufficient(5000))
      .toBe('Saldo kartu tidak mencukupi untuk koreksi ini (sisa Rp 5.000). Lakukan Top Up atau selesaikan Rekonsiliasi terlebih dahulu.');
  });
});

describe('mapping', () => {
  it('isDuplicateRow membandingkan string efektif', () => {
    const r = row({ km_awal_confirmed: '100', km_akhir_confirmed: '200', liter_bbm: 10, biaya_bbm: 100000, biaya_toll: 0 });
    expect(isDuplicateRow(r, { vehicle_id: 'V-1', tanggal: '2026-09-01', km_awal: '100', km_akhir: '200', liter: '10', biaya_bbm: '100000', biaya_toll: '0' })).toBe(true);
    expect(isDuplicateRow(r, { vehicle_id: 'V-1', tanggal: '2026-09-01', km_awal: '100', km_akhir: '200', liter: '11', biaya_bbm: '100000', biaya_toll: '0' })).toBe(false);
  });

  it('supabaseThumb menulis ulang ke render endpoint', () => {
    expect(supabaseThumb('https://x.supabase.co/storage/v1/object/public/foto/CBG-A/KM_Awal/a.jpg'))
      .toBe('https://x.supabase.co/storage/v1/render/image/public/foto/CBG-A/KM_Awal/a.jpg?width=200');
    expect(supabaseThumb('')).toBe('');
  });

  it('mapPrefillRow meresolusi tol & kartu kanonik', () => {
    const cardMap = new Map([['FLZ1', 'FLZ-1']]);
    const r = row({ flazz_card_id: 'FLZ1', metode_pembayaran: 'FLAZZ', metode_toll: '', flazz_card_id_toll: '' });
    const p = mapPrefillRow(r, cardMap);
    expect(p.flazz_card_id).toBe('FLZ-1');
    expect(p.metode_toll).toBe('FLAZZ');
    expect(p.flazz_card_id_toll).toBe('FLZ-1');
    expect(p.tanggal).toBe('2026-09-01');
  });
});

describe('buildPerformaList (window non-overlap)', () => {
  const mk = (i: number, vid = 'V-1') => row({ transaction_id: 'TRX-' + i, vehicle_id: vid, plat_nomor: vid === 'V-1' ? 'B 1 A' : 'B 2 B', tanggal: `2026-09-${String(i).padStart(2, '0')}`, km_tempuh: 100, liter_bbm: 10, bar_awal: '8', bar_akhir: '4' });
  const kmap = new Map([['V-1', { kapasitas: 50, jumlah_bar: 8, standar: 10 }], ['V-2', { kapasitas: 50, jumlah_bar: 8, standar: 10 }]]);
  const cmap = new Map([['CBG-A', 'Cabang A']]);

  it('hanya tiap kelipatan 7 dan butuh 7 baris', () => {
    const rows = Array.from({ length: 14 }, (_, i) => mk(i + 1));
    const out = buildPerformaList(rows, kmap, cmap);
    expect(out).toHaveLength(2); // i=6 dan i=13
    expect(out[0]!.periode).toContain(' s/d ');
    expect(out[0]!.cabang).toBe('Cabang A');
    expect(out[0]!.status_efisiensi).toBeDefined();
  });

  it('6 baris -> tidak ada output', () => {
    expect(buildPerformaList(Array.from({ length: 6 }, (_, i) => mk(i + 1)), kmap, cmap)).toHaveLength(0);
  });
});

describe('buildRecentList', () => {
  const kmap = new Map([['V-1', { kapasitas: 50, jumlah_bar: 8, standar: 10 }]]);
  const cmap = new Map([['CBG-A', 'Cabang A']]);
  const cards = new Map([['FLZ1', 'FLZ-1']]);
  const mk = (i: number, over: Partial<LaporanRow> = {}) => row({
    transaction_id: 'TRX-' + i, tanggal: `2026-09-${String(i).padStart(2, '0')}`,
    timestamp: `2026-09-${String(i).padStart(2, '0')}T0${i % 10}:00:00.000Z`,
    km_awal_confirmed: String(100 * i), km_akhir_confirmed: String(100 * i + 100),
    km_tempuh: 100, liter_bbm: 10, bar_awal: '8', bar_akhir: '4', ...over,
  });

  it('Data Belum Cukup bila < 7 riwayat; warning dinamis dari prev', () => {
    const rows = [mk(1), mk(2, { km_awal_confirmed: '250' }), mk(3)];
    const out = buildRecentList(rows, kmap, cmap, cards);
    const t2 = out.find((x) => x.transaction_id === 'TRX-2')!;
    expect(t2.status_efisiensi).toBe('Data Belum Cukup');
    expect(t2.efisiensi).toBe('');
    expect(t2.warning).toBe('SELISIH ODO: KM akhir terakhir 200 (01/09/2026), KM awal 250, selisih 50 KM - indikasi pemakaian di luar jam kerja');
  });

  it('sort timestamp desc lalu sub_timestamp desc; thumb diisi', () => {
    const rows = [mk(1), mk(2), mk(3, { foto_km_awal: 'https://x/storage/v1/object/public/foto/a.jpg' })];
    const out = buildRecentList(rows, kmap, cmap, cards);
    expect(out[0]!.transaction_id).toBe('TRX-3');
    expect(out[0]!.foto_odo_awal_thumb).toContain('/render/image/public/');
    expect(out[2]!.transaction_id).toBe('TRX-1');
  });

  it('hanya memproses 200 baris terakhir', () => {
    const rows = Array.from({ length: 205 }, (_, i) => mk((i % 28) + 1));
    expect(buildRecentList(rows, kmap, cmap, cards).length).toBeLessThanOrEqual(201);
  });
});

describe('groupMonthly', () => {
  it('group per cabang, 2 desimal, urut cabang', () => {
    const rows = [
      row({ kode_cabang: 'CBG-B', tanggal: '2026-09-02', liter_bbm: 10.555, biaya_bbm: 100, biaya_toll: 5 }),
      row({ kode_cabang: 'CBG-A', tanggal: '2026-09-01', liter_bbm: 5, biaya_bbm: 50, biaya_toll: 0 }),
      row({ kode_cabang: 'CBG-A', tanggal: '2026-09-03', liter_bbm: 5, biaya_bbm: 50, biaya_toll: 0 }),
      row({ kode_cabang: 'CBG-A', tanggal: '2026-08-31', liter_bbm: 99, biaya_bbm: 99, biaya_toll: 0 }),
    ];
    const out = groupMonthly(rows, '2026-09');
    expect(out.map((m) => m.cabang)).toEqual(['CBG-A', 'CBG-B']);
    expect(out[0]).toMatchObject({ total_transaksi: 2, total_liter: 10, total_biaya_bbm: 100, total_toll: 0 });
    expect(out[1]).toMatchObject({ total_transaksi: 1, total_liter: 10.56, total_biaya_bbm: 100, total_toll: 5 });
  });
});