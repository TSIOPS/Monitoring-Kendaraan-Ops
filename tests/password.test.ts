import { describe, expect, it } from 'vitest';
import { hashPassword, iteratedHash, sha256Hex, verifyPassword } from '../src/auth/password';

describe('password hashing (kompatibel GAS)', () => {
  it('verify lulus untuk password yang baru di-hash', async () => {
    const stored = await hashPassword('rahasia123');
    expect(stored.split('$')).toHaveLength(3);
    expect(await verifyPassword('rahasia123', stored)).toBe(true);
    expect(await verifyPassword('salah', stored)).toBe(false);
  });

  it('verify format legacy 2-bagian (salt$sha256(salt:pass))', async () => {
    const salt = 'aaaa0000bbbb1111';
    const legacy = `${salt}$${await sha256Hex(`${salt}:sekret`)}`;
    expect(await verifyPassword('sekret', legacy)).toBe(true);
    expect(await verifyPassword('bukan', legacy)).toBe(false);
  });

  it('verify format 3-bagian dengan rounds non-default', async () => {
    const salt = 'salt-1234567';
    const rounds = 8;
    const hash = await iteratedHash(salt, 'pw', rounds);
    expect(await verifyPassword('pw', `${salt}$${rounds}$${hash}`)).toBe(true);
  });

  it('menolak stored yang tidak valid', async () => {
    expect(await verifyPassword('x', '')).toBe(false);
    expect(await verifyPassword('x', 'tanpa-dollar')).toBe(false);
    expect(await verifyPassword('x', 'a$1$b$c$d')).toBe(false);
  });
});