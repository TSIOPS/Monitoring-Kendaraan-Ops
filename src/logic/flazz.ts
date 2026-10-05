// Logika murni untuk domain Flazz
// Tidak ada akses ke environment, database, atau storage

export type FlazzLedgerKind = 'TOPUP' | 'TOL';
export type FlazzLedgerAction = 'CREATE' | 'UPDATE' | 'DELETE';
export type FlazzCardStatus = 'TERSEDIA' | 'SEDANG_DIGUNAKAN' | 'NONAKTIF';

export interface FlazzReconciliationInput {
  openingBalance: number;
  totalTopup: number;
  totalBbmFlazz: number;
  totalTol: number;
  actualBalance: number;
}

export interface FlazzReconciliationComputed {
  totalExpense: number;
  flazzBalance: number;
  difference: number;
}

export function parseFlazzAmount(value: unknown, allowZero: boolean): number | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      return null;
    }
    if (value < 0) {
      return null;
    }
    if (!allowZero && value === 0) {
      return null;
    }
    return value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') {
      return null;
    }
    const num = parseFloat(trimmed);
    if (!Number.isFinite(num)) {
      return null;
    }
    if (num < 0) {
      return null;
    }
    if (!allowZero && num === 0) {
      return null;
    }
    return num;
  }

  return null;
}

export function isValidFlazzDate(value: unknown): boolean {
  if (typeof value !== 'string') {
    return false;
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return false;
  }
  const date = new Date(trimmed + 'T00:00:00Z');
  if (Number.isNaN(date.getTime())) {
    return false;
  }
  const parts = trimmed.split('-');
  const yearStr = parts[0];
  const monthStr = parts[1];
  const dayStr = parts[2];
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  const day = date.getUTCDate();
  return !!yearStr && !!monthStr && !!dayStr && parseInt(yearStr, 10) === year && parseInt(monthStr, 10) === month && parseInt(dayStr, 10) === day;
}

export function isCardUsable(status: string): boolean {
  const s = String(status).trim().toUpperCase();
  return s === 'TERSEDIA' || s === 'SEDANG_DIGUNAKAN';
}

export function computeReconciliation(input: FlazzReconciliationInput): FlazzReconciliationComputed {
  const totalExpense = input.totalBbmFlazz + input.totalTol;
  const flazzBalance = input.openingBalance + input.totalTopup - totalExpense;
  return {
    totalExpense,
    flazzBalance,
    difference: input.actualBalance - flazzBalance,
  };
}

export function ledgerBalanceDelta(
  kind: FlazzLedgerKind,
  action: FlazzLedgerAction,
  oldAmount: number,
  newAmount?: number,
): number {
  if (!Number.isFinite(oldAmount) || oldAmount < 0) {
    oldAmount = 0;
  }
  if (newAmount !== undefined && (!Number.isFinite(newAmount) || newAmount < 0)) {
    newAmount = 0;
  }

  if (kind === 'TOPUP') {
    if (action === 'CREATE') {
      const n = newAmount !== undefined ? newAmount : 0;
      return n;
    }
    if (action === 'UPDATE') {
      const n = newAmount !== undefined ? newAmount : oldAmount;
      return n - oldAmount;
    }
    if (action === 'DELETE') {
      return -oldAmount;
    }
    return 0;
  }

  if (kind === 'TOL') {
    if (action === 'CREATE') {
      const n = newAmount !== undefined ? newAmount : 0;
      return -n;
    }
    if (action === 'UPDATE') {
      const n = newAmount !== undefined ? newAmount : oldAmount;
      return oldAmount - n;
    }
    if (action === 'DELETE') {
      return oldAmount;
    }
    return 0;
  }

  return 0;
}
