import { describe, expect, it } from 'vitest';
import { isManagement, isSuper, lihatSemuaCabang, normalPeran, PERAN_VALID } from '../../src/auth/peran';

describe('peran', () => {
  it('normalPeran: huruf besar & tanpa spasi tepi', () => {
    expect(normalPeran({ role: ' management ' })).toBe('MANAGEMENT');
    expect(normalPeran({ role: undefined })).toBe('');
  });
  it('isSuper / isManagement', () => {
    expect(isSuper({ role: 'SUPERADMIN' })).toBe(true);
    expect(isSuper({ role: 'MANAGEMENT' })).toBe(false);
    expect(isManagement({ role: 'management' })).toBe(true);
    expect(isManagement({ role: 'PIC CABANG' })).toBe(false);
  });
  it('lihatSemuaCabang: SUPERADMIN dan MANAGEMENT saja', () => {
    expect(lihatSemuaCabang({ role: 'SUPERADMIN' })).toBe(true);
    expect(lihatSemuaCabang({ role: 'MANAGEMENT' })).toBe(true);
    expect(lihatSemuaCabang({ role: 'PIC CABANG' })).toBe(false);
    expect(lihatSemuaCabang({ role: '' })).toBe(false);
  });
  it('PERAN_VALID', () => {
    expect(PERAN_VALID).toEqual(['SUPERADMIN', 'MANAGEMENT', 'PIC CABANG']);
  });
});
