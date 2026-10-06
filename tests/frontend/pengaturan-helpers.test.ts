import { describe, expect, it } from 'vitest';
import { bodyPengaturan, cekLogo, MAKS_LOGO } from '../../static/js/pages/pengaturan.js';

describe('pengaturan', () => {
  it('validasi file logo', () => {
    expect(cekLogo(null)).toBe('');
    expect(cekLogo({ type: 'image/png', size: 1000 })).toBe('');
    expect(cekLogo({ type: 'image/svg+xml', size: 1000 })).toContain('Format');
    expect(cekLogo({ type: 'image/jpeg', size: MAKS_LOGO + 1 })).toContain('10MB');
  });
  it('body pengaturan dirapikan dan tidak membawa logo_url', () => {
    expect(bodyPengaturan({ app_name: ' App ', company_name: 'PT X', footer_text: '' })).toEqual({ app_name: 'App', company_name: 'PT X', footer_text: '' });
  });
});

describe('kosongkan data', () => {
  it('tombol aktif hanya bila kata tepat dan password diisi', async () => {
    const { bolehKosongkan } = await import('../../static/js/pages/pengaturan.js');
    expect(bolehKosongkan('KOSONGKAN', 'x')).toBe(true);
    expect(bolehKosongkan('kosongkan', 'x')).toBe(false);
    expect(bolehKosongkan('KOSONGKAN', '')).toBe(false);
  });
});
