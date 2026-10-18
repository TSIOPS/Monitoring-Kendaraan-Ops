// Tugas harian PIC: jalur hari ini yang belum dilaporkan / belum direkonsiliasi.
// Laporan belum = status BELUM_DIISI. Rekonsiliasi belum = jalur membawa kartu etoll
// dan belum SELESAI (aturan tuntas yang sama dengan gate jalur).
import { cardsOf, STATUS_BELUM, STATUS_SELESAI, tgl10 } from './jalur';
import type { JalurFull } from './jalur';

export interface ItemTugas {
  jalur_id: string;
  kode_cabang: string;
  plat_nomor: string;
  nama_driver: string;
  tanggal: string;
  perlu: Array<'LAPORAN' | 'REKONSILIASI'>;
}

export interface RingkasanTugas {
  tanggal: string;
  laporan: number;
  rekonsiliasi: number;
  // Jumlah jalur dari hari sebelumnya (dalam HARI_TERTUNGGAK hari) yang masih belum tuntas.
  tertunggak: number;
  item: ItemTugas[];
}

// Jalur yang belum tuntas tetap diingatkan sampai 7 hari ke belakang (hari ini termasuk).
export const HARI_TERTUNGGAK = 7;
export function awalRentangTugas(tanggal: string): string {
  return new Date(Date.parse(tgl10(tanggal) + 'T00:00:00Z') - (HARI_TERTUNGGAK - 1) * 86_400_000).toISOString().slice(0, 10);
}

const str = (v: unknown) => String(v ?? '').trim();

export function ringkasTugas(rows: JalurFull[], tanggal: string, cabang = ''): RingkasanTugas {
  const hari = tgl10(tanggal);
  const awal = awalRentangTugas(hari);
  const item: ItemTugas[] = [];
  for (const r of rows) {
    const t = tgl10(r.tanggal);
    if (str(r.is_deleted) === '1' || t > hari || t < awal) continue;
    if (cabang && str(r.kode_cabang) !== cabang) continue;
    const status = str(r.status) || STATUS_BELUM;
    const perlu: ItemTugas['perlu'] = [];
    if (status === STATUS_BELUM) perlu.push('LAPORAN');
    if (cardsOf(r).length && status !== STATUS_SELESAI) perlu.push('REKONSILIASI');
    if (perlu.length) {
      item.push({ jalur_id: str(r.id), kode_cabang: str(r.kode_cabang), plat_nomor: str(r.plat_nomor), nama_driver: str(r.nama_driver), tanggal: t, perlu });
    }
  }
  // Tertunggak (tanggal lebih lama) di atas.
  item.sort((a, b) => a.tanggal.localeCompare(b.tanggal) || a.kode_cabang.localeCompare(b.kode_cabang) || a.plat_nomor.localeCompare(b.plat_nomor));
  return {
    tanggal: hari,
    laporan: item.filter((i) => i.perlu.includes('LAPORAN')).length,
    rekonsiliasi: item.filter((i) => i.perlu.includes('REKONSILIASI')).length,
    tertunggak: item.filter((i) => i.tanggal < hari).length,
    item,
  };
}

// Jam tutup operasional WIB: Senin-Jumat 17:00, Sabtu & Minggu 16:00.
export function jamTutupWib(ms = Date.now()): string {
  const hari = new Date(ms + 7 * 3600_000).getUTCDay();
  return hari === 0 || hari === 6 ? '16:00' : '17:00';
}

export function teksTugas(r: Pick<RingkasanTugas, 'laporan' | 'rekonsiliasi'> & { tertunggak?: number }): string {
  const bagian = [];
  if (r.laporan) bagian.push(`${r.laporan} laporan`);
  if (r.rekonsiliasi) bagian.push(`${r.rekonsiliasi} rekonsiliasi`);
  if (!bagian.length) return '';
  return `${bagian.join(' & ')} belum selesai` + (r.tertunggak ? ` (${r.tertunggak} jalur dari hari sebelumnya)` : '');
}
