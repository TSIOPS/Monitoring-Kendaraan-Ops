import { get, post } from './api.js';
import { getUser } from './store.js';
import { awalBulan, bukuExcel, muatSheetJS, namaFileRekap, susunExcel } from './pages/rekap.js';

// Alamat tujuan kiriman Excel rekap harian (spec 2026-10-21 §3). Ubah di sini bila berganti.
export const EMAIL_KIRIM_REKAP = 'ceocrew01@gmail.com';

export function rentangUnduhHarian(hariIni) {
  return { dari: awalBulan(hariIni), sampai: String(hariIni).slice(0, 10) };
}

// Unduh rekap cabang PIC bulan berjalan lalu tandai sudah diunduh di server.
export async function unduhRekapHarian(hariIni) {
  const cabang = String(getUser()?.cabang || '');
  const { dari, sampai } = rentangUnduhHarian(hariIni);
  const { lines = [] } = await get(`/api/laporan/rekap-pengeluaran?${new URLSearchParams({ dari, sampai })}`);
  const XLSX = await muatSheetJS();
  XLSX.writeFile(bukuExcel(XLSX, susunExcel(lines, { dari, sampai, warehouse: cabang })), namaFileRekap(dari, sampai, cabang));
  await post('/api/rekap/unduh-harian', {});
}
