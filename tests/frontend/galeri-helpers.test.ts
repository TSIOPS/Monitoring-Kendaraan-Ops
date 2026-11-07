import { describe, expect, it } from 'vitest';
import { saringGaleri } from '../../static/js/pages/galeri.js';

describe('saringGaleri', () => {
  const a = { transaction_id: 'A', foto_odo_awal: 'u1' };
  const b = { transaction_id: 'B', foto_struk_retribusi: 'r.jpg' };
  const c = { transaction_id: 'C', foto_struk_parkir: 'p.jpg' };
  const d = { transaction_id: 'D' };
  it('Semua Foto memuat laporan yang hanya punya bukti retribusi/parkir', () => {
    expect(saringGaleri([a, b, c, d], 'all').map((x: { transaction_id: string }) => x.transaction_id)).toEqual(['A', 'B', 'C']);
  });
  it('filter per jenis foto retribusi dan parkir', () => {
    expect(saringGaleri([a, b, c, d], 'struk_retribusi').map((x: { transaction_id: string }) => x.transaction_id)).toEqual(['B']);
    expect(saringGaleri([a, b, c, d], 'struk_parkir').map((x: { transaction_id: string }) => x.transaction_id)).toEqual(['C']);
  });
});
