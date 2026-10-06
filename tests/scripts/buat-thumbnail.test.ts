import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { kecilkan, rencanaThumb, thumbKeyOf } from '../../scripts/buat-thumbnail.mjs';
import { thumbKeyOf as thumbKeyServer } from '../../src/logic/foto';

describe('buat-thumbnail', () => {
  it('kunci thumbnail sama dengan yang dipakai server', () => {
    for (const k of ['BDG/KM_Awal/gdrive-abc.jpg', 'BDG/KM_Akhir/x.png', 'thumb/BDG/KM_Awal/a.jpg']) {
      expect(thumbKeyOf(k)).toBe(thumbKeyServer(k));
    }
    expect(thumbKeyOf('BDG/KM_Akhir/x.png')).toBe('thumb/BDG/KM_Akhir/x.jpg');
  });

  it('hanya foto penuh yang belum punya thumbnail', () => {
    expect(rencanaThumb(['BDG/KM_Awal/a.jpg', 'BDG/KM_Awal/b.jpg', 'thumb/BDG/KM_Awal/a.jpg', 'logo.txt'])).toEqual(['BDG/KM_Awal/b.jpg']);
  });

  it('mengecilkan ke lebar 320 px JPEG', async () => {
    const besar = await sharp({ create: { width: 1280, height: 960, channels: 3, background: '#336699' } }).jpeg().toBuffer();
    const kecil = await kecilkan(besar);
    const meta = await sharp(kecil).metadata();
    expect([meta.width, meta.format]).toEqual([320, 'jpeg']);
  });
});
