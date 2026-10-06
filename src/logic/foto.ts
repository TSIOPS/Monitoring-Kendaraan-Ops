// Thumbnail foto laporan: salinan kecil (±320 px) di bucket foto dengan prefix "thumb/".
// Kunci thumbnail diturunkan dari kunci foto penuh, jadi tidak perlu kolom DB tambahan;
// tampilan yang memakai thumbnail jatuh ke foto penuh bila thumbnail belum ada.
export const THUMB_PREFIX = 'thumb/';

export function thumbKeyOf(key: string): string {
  const k = String(key || '').replace(/^\/+/, '');
  if (!k || k.startsWith(THUMB_PREFIX)) return k;
  return THUMB_PREFIX + k.replace(/\.[A-Za-z0-9]+$/, '') + '.jpg';
}

// URL publik foto penuh di bucket "foto" -> URL thumbnail-nya; URL lain dikembalikan apa adanya.
export function thumbUrlOf(url: string): string {
  const s = String(url || '').split('?')[0] ?? '';
  const m = /^(.*\/storage\/v1\/object\/public\/foto\/)(.+)$/.exec(s);
  if (!m) return s;
  return m[1] + thumbKeyOf(m[2]!);
}
