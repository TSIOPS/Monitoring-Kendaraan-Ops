// Satu sumber kebenaran role. MANAGEMENT = pemantau: lihat semua cabang, tidak bisa menulis.
export const PERAN_VALID = ['SUPERADMIN', 'MANAGEMENT', 'PIC CABANG'] as const;

type BerPeran = { role?: unknown };

export function normalPeran(u: BerPeran): string {
  return String(u.role ?? '').trim().toUpperCase();
}
export function isSuper(u: BerPeran): boolean {
  return normalPeran(u) === 'SUPERADMIN';
}
export function isManagement(u: BerPeran): boolean {
  return normalPeran(u) === 'MANAGEMENT';
}
// Cakupan BACA semua cabang. Jangan dipakai untuk cek tulis — tulis tetap isSuper().
export function lihatSemuaCabang(u: BerPeran): boolean {
  return isSuper(u) || isManagement(u);
}
