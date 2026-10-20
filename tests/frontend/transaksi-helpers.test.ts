import { describe, expect, it } from 'vitest';
import { teksBarisRincian } from '../../static/js/pages/transaksi.js';

describe('teksBarisRincian', () => {
  it('format satu nota: jenis, nominal, dibayar, keterangan', () => {
    const label = (id: string) => (id === 'FLZ-1' ? 'Etoll A' : id);
    expect(teksBarisRincian({ jenis: 'BBM', nominal: 200000, kartu: 'FLZ-1', keterangan: 'SPBU A' }, label)).toBe('BBM · Rp 200.000 · Etoll A · SPBU A');
    expect(teksBarisRincian({ jenis: 'TOL', nominal: 5000, kartu: '', keterangan: '' }, label)).toBe('Tol · Rp 5.000 · Tunai');
  });
});
