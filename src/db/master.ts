// Bagian ini ditulis di Task 1; MasterRepo + supabaseMasterRepo menyusul di Task 2.
export interface MasterCabang {
  kode_cabang: string;
  nama_cabang: string;
  lokasi: string;
  status: string;
}
export interface MasterSupir {
  supir_id: string;
  nama_supir: string;
  kode_cabang: string;
  default_vehicle_id: string;
  status: string;
}
export interface MasterBbm {
  bbm_id: string;
  jenis_bbm: string;
  harga_per_liter: number;
  kode_cabang: string;
  status: string;
}
export interface MasterKendaraan {
  vehicle_id: string;
  plat_nomor: string;
  nama_kendaraan: string;
  jenis_kendaraan: string;
  merk: string;
  model: string;
  kapasitas_tangki: number;
  jumlah_bar: number;
  standar_km_l: number;
  kode_cabang: string;
  status: string;
  jenis_indikator: string;
  tanggal_pajak: string;
  tanggal_pajak_5_tahunan: string;
  tanggal_kir: string;
  km_terakhir_ganti_oli: number;
  interval_ganti_oli_km: number;
}
export interface MasterPengguna {
  user_id: string;
  username: string;
  nama: string;
  role: string;
  kode_cabang: string;
  status: string;
}
export interface MasterPenggunaWithPassword extends MasterPengguna {
  password: string;
}
export interface MasterFlazzCard {
  id: string;
  card_number: string;
  card_name: string;
  card_type: string;
  card_role: string;
  branch_id: string;
  driver_id: string;
  default_driver_id: string;
  last_balance: number;
  status: string;
  notes: string;
}
export interface MasterAllRaw {
  cabang: MasterCabang[];
  supir: MasterSupir[];
  bbm: MasterBbm[];
  kendaraan: MasterKendaraan[];
  pengguna: MasterPengguna[];
  flazzCard: MasterFlazzCard[];
}