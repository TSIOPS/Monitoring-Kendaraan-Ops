// Draft form di localStorage agar isian tidak hilang saat reload, tab dimatikan HP,
// sesi habis, atau pindah halaman tak sengaja. Semua akses storage dibungkus try/catch
// (mode privat / storage penuh tidak boleh mematahkan form).
export const DRAFT_UMUR_MS = 24 * 60 * 60 * 1000;

export function kunciDraft(form, userId) {
  return `draft.${form}.${userId || 'anon'}`;
}

function adaIsi(nilai) {
  return Object.values(nilai || {}).some((v) => v !== '' && v !== false && v !== null && v !== undefined);
}

export function simpanDraft(storage, kunci, nilai, now = Date.now()) {
  try {
    if (!adaIsi(nilai)) { storage.removeItem(kunci); return; }
    storage.setItem(kunci, JSON.stringify({ nilai, disimpan: now }));
  } catch { /* abaikan */ }
}

export function bacaDraft(storage, kunci, now = Date.now()) {
  try {
    const raw = storage.getItem(kunci);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d.nilai !== 'object' || !(now - Number(d.disimpan) <= DRAFT_UMUR_MS)) {
      storage.removeItem(kunci);
      return null;
    }
    return { nilai: d.nilai, disimpan: Number(d.disimpan) };
  } catch {
    return null;
  }
}

export function hapusDraft(storage, kunci) {
  try { storage.removeItem(kunci); } catch { /* abaikan */ }
}
