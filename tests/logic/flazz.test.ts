import { describe, expect, it } from 'vitest';
import {
  computeReconciliation,
  isCardUsable,
  isValidFlazzDate,
  ledgerBalanceDelta,
  parseFlazzAmount,
} from '../../src/logic/flazz';

describe('parseFlazzAmount', () => {
  it('menerima angka finite dan menolak nilai invalid', () => {
    expect(parseFlazzAmount('12500', false)).toBe(12500);
    expect(parseFlazzAmount(0, true)).toBe(0);
    expect(parseFlazzAmount(0, false)).toBeNull();
    expect(parseFlazzAmount(-1, true)).toBeNull();
    expect(parseFlazzAmount('abc', true)).toBeNull();
    expect(parseFlazzAmount(Infinity, true)).toBeNull();
  });
});

describe('isValidFlazzDate', () => {
  it('hanya menerima YYYY-MM-DD yang valid', () => {
    expect(isValidFlazzDate('2026-09-25')).toBe(true);
    expect(isValidFlazzDate('2026-02-30')).toBe(false);
    expect(isValidFlazzDate('25/09/2026')).toBe(false);
    expect(isValidFlazzDate('')).toBe(false);
  });
});

describe('isCardUsable', () => {
  it('hanya TERSEDIA dan SEDANG_DIGUNAKAN yang dapat dipakai', () => {
    expect(isCardUsable('TERSEDIA')).toBe(true);
    expect(isCardUsable('SEDANG_DIGUNAKAN')).toBe(true);
    expect(isCardUsable('NONAKTIF')).toBe(false);
  });
});

describe('computeReconciliation', () => {
  it('menghitung expense, saldo, dan difference', () => {
    expect(computeReconciliation({
      openingBalance: 100000,
      totalTopup: 50000,
      totalBbmFlazz: 40000,
      totalTol: 10000,
      actualBalance: 95000,
    })).toEqual({ totalExpense: 50000, flazzBalance: 100000, difference: -5000 });
  });
});

describe('ledgerBalanceDelta', () => {
  it('menghitung arah delta top-up dan tol', () => {
    expect(ledgerBalanceDelta('TOPUP', 'CREATE', 0, 50000)).toBe(50000);
    expect(ledgerBalanceDelta('TOPUP', 'UPDATE', 50000, 70000)).toBe(20000);
    expect(ledgerBalanceDelta('TOPUP', 'DELETE', 50000)).toBe(-50000);
    expect(ledgerBalanceDelta('TOL', 'CREATE', 0, 15000)).toBe(-15000);
    expect(ledgerBalanceDelta('TOL', 'UPDATE', 15000, 10000)).toBe(5000);
    expect(ledgerBalanceDelta('TOL', 'DELETE', 15000)).toBe(15000);
  });
});
