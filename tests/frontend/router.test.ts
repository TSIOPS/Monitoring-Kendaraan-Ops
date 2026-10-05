import { describe, expect, it } from 'vitest';
import { matchRoute, registerRoute } from '../../static/js/router.js';

const loader = async () => ({ render: () => undefined });

registerRoute('#/login', loader, { guard: false });
registerRoute('#/transaksi', loader);
registerRoute('#/edit/:id', loader);

describe('matchRoute', () => {
  it('mencocokkan route yang didaftarkan dengan awalan #', () => {
    expect(matchRoute('#/login')).not.toBeNull();
    expect(matchRoute('#/transaksi')).not.toBeNull();
  });

  it('memakai #/login untuk hash kosong', () => {
    expect(matchRoute('')?.guard).toBe(false);
  });

  it('mencocokkan route berparameter', () => {
    expect(matchRoute('#/edit/TRX-1')).not.toBeNull();
  });

  it('mengembalikan null untuk route tak dikenal', () => {
    expect(matchRoute('#/tidak-ada')).toBeNull();
  });
});
