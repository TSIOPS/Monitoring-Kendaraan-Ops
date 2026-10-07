// Web Push tanpa payload (RFC 8030 + VAPID RFC 8292), hanya WebCrypto (jalan di Workers).
// Push kosong tidak perlu enkripsi; service worker mengambil isi notifikasi sendiri
// dari /api/push/ringkasan setelah menerima push.

const b64url = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const b64urlTeks = (t: string) => b64url(new TextEncoder().encode(t));

export interface VapidKunci {
  publicKey: string; // raw P-256 (65 byte) base64url
  privateJwk: JsonWebKey; // { kty, crv, d, x, y }
  subject: string; // mailto: atau https:
}

// JWT ES256: header.payload.signature (signature IEEE P1363 r||s, format bawaan WebCrypto).
export async function vapidJwt(audience: string, k: VapidKunci, nowSec = Math.floor(Date.now() / 1000)): Promise<string> {
  const header = b64urlTeks(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64urlTeks(JSON.stringify({ aud: audience, exp: nowSec + 12 * 3600, sub: k.subject }));
  const kunci = await crypto.subtle.importKey('jwk', { ...k.privateJwk, ext: true }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, kunci, new TextEncoder().encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(sig)}`;
}

export interface HasilPush { status: number; hapus: boolean }

// Kirim push kosong ke satu langganan. hapus=true bila langganan sudah tidak berlaku (404/410).
export async function kirimPush(endpoint: string, k: VapidKunci, fetcher: typeof fetch = fetch): Promise<HasilPush> {
  const aud = new URL(endpoint).origin;
  const jwt = await vapidJwt(aud, k);
  const res = await fetcher(endpoint, {
    method: 'POST',
    headers: { Authorization: `vapid t=${jwt}, k=${k.publicKey}`, TTL: '3600', Urgency: 'high', 'Content-Length': '0' },
  });
  return { status: res.status, hapus: res.status === 404 || res.status === 410 };
}

export async function hashEndpoint(endpoint: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return b64url(d).slice(0, 32);
}
