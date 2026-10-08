// Kendaraan bersama: satu kendaraan fisik didaftarkan SEKALI di cabang pemilik (kode_cabang),
// cabang lain yang ikut memakainya dicatat di cabang_bersama ("CBY,GDGTSM"). Riwayat KM,
// selisih ODO, ganti oli, efisiensi, dan gate jalur menyatu per vehicle_id; laporan & jalur
// tetap distempel cabang pemakai sehingga rekap biaya jatuh ke cabang yang memakai.

export interface KendaraanCabang {
  vehicle_id?: string;
  kode_cabang?: string | null;
  cabang_bersama?: string | null;
}

export function daftarCabangBersama(v: unknown): string[] {
  const raw = Array.isArray(v) ? v : String(v ?? '').split(',');
  return [...new Set(raw.map((x) => String(x ?? '').trim()).filter(Boolean))];
}

export function cabangPemakai(k: KendaraanCabang): string[] {
  const pemilik = String(k.kode_cabang ?? '').trim();
  return [...new Set([pemilik, ...daftarCabangBersama(k.cabang_bersama)].filter(Boolean))];
}

export function bolehPakai(cabang: string, k: KendaraanCabang): boolean {
  return !!cabang && cabangPemakai(k).includes(String(cabang));
}

export function isBersama(k: KendaraanCabang): boolean {
  return cabangPemakai(k).length > 1;
}

// Nilai yang disimpan: kode cabang valid, unik, tanpa cabang pemilik, dipisah koma.
export function normalisasiCabangBersama(input: unknown, pemilik: string, valid: Set<string>): string {
  return daftarCabangBersama(input).filter((k) => k !== pemilik && valid.has(k)).join(',');
}

// Kendaraan bersama yang melibatkan cabang ini (sebagai pemilik atau pemakai).
export function idBersamaUntuk(kendaraan: KendaraanCabang[], cabang: string): string[] {
  return kendaraan.filter((k) => isBersama(k) && cabangPemakai(k).includes(cabang)).map((k) => String(k.vehicle_id ?? ''));
}

// Gabungkan baris laporan cabang dengan baris kendaraan bersama dari cabang lain (konteks
// perhitungan efisiensi/ODO), unik per transaction_id dan urut seq naik.
export function gabungKonteks<T extends { transaction_id: string; seq?: number }>(rows: T[], konteks: T[]): T[] {
  if (!konteks.length) return rows;
  const peta = new Map<string, T>();
  for (const r of [...rows, ...konteks]) peta.set(String(r.transaction_id), r);
  return [...peta.values()].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
}
