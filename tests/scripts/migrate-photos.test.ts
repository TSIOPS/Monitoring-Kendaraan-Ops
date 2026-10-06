import { describe, expect, it } from 'vitest';
import { driveId, jenisGambar, keyFoto, rencanaFoto, safeBranch } from '../../scripts/migrate-photos.mjs';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345';

describe('driveId', () => {
  it('mengambil ID dari link file dan thumbnail Drive', () => {
    expect(driveId(`https://drive.google.com/file/d/${ID}/view?usp=drivesdk`)).toBe(ID);
    expect(driveId(`https://drive.google.com/thumbnail?id=${ID}&sz=w200`)).toBe(ID);
  });
  it('mengabaikan URL bukan Drive (sudah di Storage) dan nilai kosong', () => {
    expect(driveId(`https://x.supabase.co/storage/v1/object/public/foto/BDG/KM_Awal/gdrive-${ID}.jpg`)).toBe('');
    expect(driveId('')).toBe('');
  });
});

describe('kunci objek dan jenis file', () => {
  it('kunci tetap per ID Drive dengan folder seperti upload aplikasi', () => {
    expect(keyFoto('BDG', 'KM_Awal', ID, 'jpg')).toBe(`BDG/KM_Awal/gdrive-${ID}.jpg`);
    expect(safeBranch('')).toBe('TANPA-CABANG');
    expect(safeBranch('K W/G')).toBe('KWG');
  });
  it('mengenali JPEG/PNG dan menolak HTML', () => {
    expect(jenisGambar(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))?.ext).toBe('jpg');
    expect(jenisGambar(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 0, 0, 0, 0]))?.ext).toBe('png');
    expect(jenisGambar(new TextEncoder().encode('<!DOCTYPE html>'))).toBeNull();
  });
});

describe('rencanaFoto', () => {
  it('satu pekerjaan per kolom yang masih Drive; yang sudah dipindah dilewati', () => {
    const jobs = rencanaFoto([
      { transaction_id: 'TRX-1', kode_cabang: 'BDG', foto_km_awal: `https://drive.google.com/file/d/${ID}/view`, foto_km_akhir: 'https://x.supabase.co/storage/v1/object/public/foto/a.jpg', foto_struk_bbm: '', foto_struk_toll: '' },
    ]);
    expect(jobs).toEqual([{ transaction_id: 'TRX-1', kode_cabang: 'BDG', kolom: 'foto_km_awal', folder: 'KM_Awal', driveId: ID }]);
  });
});
