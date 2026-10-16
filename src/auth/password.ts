// Format hash:
//   pbkdf2$<putaran>$<salt hex 16 byte>$<hash hex 32 byte>   (baru: PBKDF2-SHA256, WebCrypto)
//   <salt>$<putaran>$<hex>                                    (lama: SHA-256 berulang, warisan GAS)
//   <salt>$<hex>                                              (lama: SHA-256 sekali, warisan GAS)
// Format lama tetap diterima saat login lalu otomatis diganti ke PBKDF2 (perluRehash).
export const PBKDF2_ITER = 100_000;
const LEGACY_ROUNDS = 10000;

const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const dariHex = (s: string) => new Uint8Array((s.match(/.{2}/g) ?? []).map((h) => parseInt(h, 16)));

export async function sha256Hex(str: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(str))));
}

export async function iteratedHash(salt: string, password: string, rounds: number): Promise<string> {
  let h = await sha256Hex(`${salt}:${String(password)}`);
  for (let i = 1; i < rounds; i++) h = await sha256Hex(`${h}:${salt}`);
  return h;
}

async function pbkdf2Hex(password: string, salt: Uint8Array, iter: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

// Bandingkan tanpa berhenti di karakter pertama yang beda (mencegah timing attack).
function samaPersis(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let beda = 0;
  for (let i = 0; i < a.length; i++) beda |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return beda === 0;
}

export async function hashPassword(password: string, iter = PBKDF2_ITER): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${iter}$${hex(salt)}$${await pbkdf2Hex(password, salt, iter)}`;
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  if (!stored || stored.indexOf('$') === -1) return false;
  const parts = stored.split('$');
  if (parts[0] === 'pbkdf2' && parts.length === 4) {
    const iter = parseInt(parts[1]!, 10);
    if (!(iter > 0)) return false;
    return samaPersis(await pbkdf2Hex(plain, dariHex(parts[2]!), iter), parts[3]!);
  }
  if (parts.length === 3) {
    const rounds = parseInt(parts[1]!, 10) || LEGACY_ROUNDS;
    return samaPersis(await iteratedHash(parts[0]!, plain, rounds), parts[2]!);
  }
  if (parts.length === 2) return samaPersis(await sha256Hex(`${parts[0]!}:${String(plain)}`), parts[1]!);
  return false;
}

// Hash lama atau putaran lebih kecil dari standar sekarang -> perlu diganti saat login.
export function perluRehash(stored: string): boolean {
  const p = String(stored || '').split('$');
  return !(p[0] === 'pbkdf2' && p.length === 4 && parseInt(p[1]!, 10) >= PBKDF2_ITER);
}
