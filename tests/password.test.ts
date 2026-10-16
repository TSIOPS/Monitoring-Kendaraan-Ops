import { describe, expect, it } from 'vitest';
import { hashPassword, iteratedHash, perluRehash, PBKDF2_ITER, sha256Hex, verifyPassword } from '../src/auth/password';

describe('password hashing (kompatibel GAS)', () => {
  it('hash baru memakai PBKDF2-SHA256 (salt 16 byte) dan bisa diverifikasi', async () => {
    const stored = await hashPassword('rahasia123');
    const [jenis, iter, salt, hash] = stored.split('$');
    expect([jenis, Number(iter), salt!.length, hash!.length]).toEqual(['pbkdf2', PBKDF2_ITER, 32, 64]);
    expect(perluRehash(stored)).toBe(false);
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

  it('menerima vektor statis dari hashPassword run (GAS-compatible)', async () => {
    const stored = '2ca4c6a8cb961f06$10000$57febf9c9e736a7be66829f2dd69e355ce34f47cb6d57e93a4968a104a86f453';
    expect(await verifyPassword('vektor-test', stored)).toBe(true);
    expect(await verifyPassword('bukan-password', stored)).toBe(false);
  });

  it('hash lama (GAS) masih diterima tetapi ditandai perlu rehash', async () => {
    expect(perluRehash('2ca4c6a8cb961f06$10000$57febf9c9e736a7be66829f2dd69e355ce34f47cb6d57e93a4968a104a86f453')).toBe(true);
    expect(perluRehash('aaaa$bbbb')).toBe(true);
    expect(perluRehash(await hashPassword('x', 1000))).toBe(true);
    expect(await verifyPassword('x', await hashPassword('x', 1000))).toBe(true);
  });
});
