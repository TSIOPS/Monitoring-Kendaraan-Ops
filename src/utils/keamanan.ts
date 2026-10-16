// Header keamanan untuk semua respons (halaman, aset, API, foto).
// CSP: skrip hanya dari aplikasi sendiri + cdnjs (SheetJS, html2canvas); CSS/ikon dari jsDelivr
// (Bootstrap); gambar dari aplikasi (/foto R2), Supabase (logo & foto lama), data:/blob: (pratinjau).
export const CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdnjs.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
  "font-src 'self' data: https://cdn.jsdelivr.net",
  "img-src 'self' data: blob: https://*.supabase.co https://drive.google.com https://*.googleusercontent.com",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

export const HEADER_KEAMANAN: Record<string, string> = {
  'Content-Security-Policy': CSP,
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(self), geolocation=(), microphone=(), payment=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
};

export function denganHeaderKeamanan(res: Response): Response {
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(HEADER_KEAMANAN)) out.headers.set(k, v);
  return out;
}
