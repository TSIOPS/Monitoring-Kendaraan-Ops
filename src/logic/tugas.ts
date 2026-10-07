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
  perlu: Array<'LAPORAN' | 'REKONSILIASI'>;
}

export interface RingkasanTugas {
  tanggal: string;
  laporan: number;
  rekonsiliasi: number;
  item: ItemTugas[];
}

const str = (v: unknown) => String(v ?? '').trim();

export function ringkasTugas(rows: JalurFull[], tanggal: string, cabang = ''): RingkasanTugas {
  const hari = tgl10(tanggal);
  const item: ItemTugas[] = [];
  for (const r of rows) {
    if (str(r.is_deleted) === '1' || tgl10(r.tanggal) !== hari) continue;
    if (cabang && str(r.kode_cabang) !== cabang) continue;
    const status = str(r.status) || STATUS_BELUM;
    const perlu: ItemTugas['perlu'] = [];
    if (status === STATUS_BELUM) perlu.push('LAPORAN');
    if (cardsOf(r).length && status !== STATUS_SELESAI) perlu.push('REKONSILIASI');
    if (perlu.length) {
      item.push({ jalur_id: str(r.id), kode_cabang: str(r.kode_cabang), plat_nomor: str(r.plat_nomor), nama_driver: str(r.nama_driver), perlu });
    }
  }
  item.sort((a, b) => a.kode_cabang.localeCompare(b.kode_cabang) || a.plat_nomor.localeCompare(b.plat_nomor));
  return {
    tanggal: hari,
    laporan: item.filter((i) => i.perlu.includes('LAPORAN')).length,
    rekonsiliasi: item.filter((i) => i.perlu.includes('REKONSILIASI')).length,
    item,
  };
}

export function teksTugas(r: Pick<RingkasanTugas, 'laporan' | 'rekonsiliasi'>): string {
  const bagian = [];
  if (r.laporan) bagian.push(`${r.laporan} laporan`);
  if (r.rekonsiliasi) bagian.push(`${r.rekonsiliasi} rekonsiliasi`);
  return bagian.length ? `${bagian.join(' & ')} belum selesai` : '';
}
