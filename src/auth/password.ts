const PBKDF_ROUNDS = 10000;

export async function sha256Hex(str: string): Promise<string> {
  const data = new TextEncoder().encode(String(str));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function iteratedHash(salt: string, password: string, rounds: number): Promise<string> {
  let hex = await sha256Hex(`${salt}:${String(password)}`);
  for (let i = 1; i < rounds; i++) {
    hex = await sha256Hex(`${hex}:${salt}`);
  }
  return hex;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${salt}$${PBKDF_ROUNDS}$${await iteratedHash(salt, password, PBKDF_ROUNDS)}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored || stored.indexOf('$') === -1) return false;
  const parts = stored.split('$');
  if (parts.length === 3) {
    const rounds = parseInt(parts[1], 10) || PBKDF_ROUNDS;
    return (await iteratedHash(parts[0], plain, rounds)) === parts[2];
  }
  if (parts.length === 2) {
    return (await sha256Hex(`${parts[0]}:${String(plain)}`)) === parts[1];
  }
  return false;
}