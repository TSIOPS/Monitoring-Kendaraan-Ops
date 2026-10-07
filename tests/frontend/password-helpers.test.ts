import { describe, expect, it } from 'vitest';
import { cekGantiPassword } from '../../static/js/pages/password.js';

describe('cekGantiPassword', () => {
  it('valid bila lama diisi, baru >= 6, berbeda, dan ulangi sama', () => {
    expect(cekGantiPassword('lama123', 'baru456', 'baru456')).toEqual([]);
  });
  it('menolak baru pendek, sama dengan lama, atau ulangi beda', () => {
    expect(cekGantiPassword('', 'abc', 'abd').length).toBe(3);
    expect(cekGantiPassword('sama123', 'sama123', 'sama123')).toContain('Password baru harus berbeda dari password lama.');
  });
});
