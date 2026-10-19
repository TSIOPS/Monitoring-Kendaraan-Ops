# Perbaikan Keamanan & UX — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Aturan proyek:** baca [CLAUDE.md](../../../CLAUDE.md) dulu. Setiap tugas selesai → centang di sini + entri [CHANGELOG.md](../../../CHANGELOG.md).
> Setiap fase ditutup dengan **gerbang review** (security-review / ui-ux-pro-max / code-review) sesuai CLAUDE.md §3.

**Goal:** Menutup celah bypass lockout login dan menghilangkan risiko kehilangan data laporan serta masalah UX utama yang ditemukan pada review 2026-10-19.

**Architecture:** Perbaikan server di Hono route + db layer (`src/`), perbaikan klien di modul vanilla JS (`static/js/`). Logika baru ditaruh di fungsi murni ber-`export` supaya bisa dites di vitest (environment `node`, tanpa DOM); integrasi DOM tipis di halaman. Tidak ada dependensi baru.

**Tech Stack:** Cloudflare Workers + Hono, supabase-js, Cloudflare KV, vanilla JS ES modules, Bootstrap 5.3 (CDN), vitest.

**Sumber temuan:** review keamanan & UX seluruh codebase, 2026-10-19 (sesi Claude Code).

---

## Peta file

| File | Status | Tanggung jawab |
|---|---|---|
| `src/utils/keamanan.ts` | ubah | + `polaUsername()` (escape pola ILIKE, tolak wildcard) |
| `src/db/users.ts`, `src/db/master.ts` | ubah | pakai `polaUsername()` di lookup username |
| `src/routes/auth.ts` | ubah | validasi username, rate limit per akun & per IP |
| `src/auth/sessions.ts` | ubah | sesi *sliding* (diperpanjang saat aktif) |
| `src/routes/laporan.ts`, `src/logic/laporan.ts` | ubah | pesan khusus bila jalur sudah dilaporkan (retry) |
| `static/js/api.js` | ubah | jangan hapus sesi pada respons non-JSON; timeout |
| `static/js/draft.js` | **baru** | simpan/baca/hapus draft form (fungsi murni + storage) |
| `static/js/router.js` | ubah | penjaga keluar halaman (form belum disimpan), rute tujuan setelah login, scroll ke atas |
| `static/js/ui.js` | ubah | `tampilkanGalat()`, `barisForm()`, toast aksesibel, `navHalaman` berjendela, `aksiSekali()`, `teksRupiah()` |
| `static/js/pages/input.js` | ubah | draft, penjaga keluar, galat terlihat, retry jalur, capture, inputmode |
| `static/js/pages/edit.js`, `jalur.js`, `flazz.js`, `master.js`, `rekap.js`, `transaksi.js`, `login.js` | ubah | perbaikan per alur |
| `static/js/notifikasi.js`, `static/sw.js` | ubah | tidak memindah halaman saat form kotor |
| `static/css/app.css` | ubah | font input 16px mobile, target sentuh 44px, kontras, dvh, toast |

---

# FASE 1 — Keamanan (gerbang: `/security-review`)

### Task 1: Escape pola ILIKE pada lookup username

**Files:**
- Modify: `src/utils/keamanan.ts` (tambah fungsi di akhir file)
- Modify: `src/db/users.ts:10`
- Modify: `src/db/master.ts:238`
- Test: `tests/keamanan-headers.test.ts` (tambah describe baru)

- [x] **Step 1: Tulis tes gagal**

Tambahkan di akhir `tests/keamanan-headers.test.ts`:

```ts
import { polaUsername } from '../src/utils/keamanan';

describe('polaUsername', () => {
  it('meng-escape _ dan \\ agar dicocokkan literal oleh ILIKE', () => {
    expect(polaUsername('pic_jkt')).toBe('pic\\_jkt');
    expect(polaUsername('a\\b')).toBe('a\\\\b');
  });
  it('username biasa tidak berubah', () => {
    expect(polaUsername('picjkt')).toBe('picjkt');
  });
  it('menolak wildcard % dan * (null = pasti tidak ada akun)', () => {
    expect(polaUsername('admin%')).toBeNull();
    expect(polaUsername('%')).toBeNull();
    expect(polaUsername('adm*')).toBeNull();
  });
});
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/keamanan-headers.test.ts`
Expected: FAIL — `polaUsername is not a function` / export tidak ada.

- [x] **Step 3: Implementasi**

Tambahkan di akhir `src/utils/keamanan.ts`:

```ts
// Username dipakai sebagai pola ILIKE (cocok tanpa beda huruf besar/kecil). Wildcard harus
// dinetralkan: tanpa ini `admi_`, `admin%`, `%` cocok ke akun yang sama dan tiap variasi
// mendapat jatah rate limit login sendiri. `%`/`*` (alias % di PostgREST) ditolak; `_` dan `\` di-escape.
export function polaUsername(username: string): string | null {
  if (/[%*]/.test(username)) return null;
  return username.replace(/[\\_]/g, (ch) => '\\' + ch);
}
```

Ubah `src/db/users.ts` (fungsi `findByUsernameDb`):

```ts
import { polaUsername } from '../utils/keamanan';
// ...
  return async (username: string): Promise<UserRecord | null> => {
    const pola = polaUsername(username);
    if (pola === null) return null;
    const { data, error } = await getSupabase(env)
      .from('pengguna')
      .select('user_id, username, password, nama, role, kode_cabang, status')
      .ilike('username', pola)
      .limit(1)
      .maybeSingle();
```

Ubah `src/db/master.ts` (`findPenggunaByUsername`), tambah import `polaUsername` dari `'../utils/keamanan'`:

```ts
    async findPenggunaByUsername(username) {
      const pola = polaUsername(username);
      if (pola === null) return null;
      const { data, error } = await sb().from('pengguna')
        .select('user_id, username, password, nama, role, kode_cabang, status')
        .ilike('username', pola).limit(1).maybeSingle();
```

- [x] **Step 4: Jalankan tes + typecheck**

Run: `npx vitest run tests/keamanan-headers.test.ts && npm run typecheck`
Expected: PASS, tanpa error tsc.

- [x] **Step 5: Commit**

```bash
git add src/utils/keamanan.ts src/db/users.ts src/db/master.ts tests/keamanan-headers.test.ts
git commit -m "fix(auth): netralkan wildcard ILIKE pada lookup username"
```

### Task 2: Rate limit login per akun & per IP

**Files:**
- Modify: `src/routes/auth.ts:9-60`
- Test: `tests/auth-routes.test.ts`

- [x] **Step 1: Tulis tes gagal** (tambahkan di dalam `describe('auth routes', …)`):

```ts
  it('variasi penulisan username tidak menambah jatah percobaan untuk akun yang sama', async () => {
    const cryptoHash = await hashPassword('rahasia123');
    // Fake meniru ILIKE: semua variasi ini menunjuk ke akun yang sama.
    const { deps } = makeDeps({ findByUsername: async () => ({ ...PIC_USER, password: cryptoHash }) });
    const app = buildApp(fakeEnv(), deps);
    const variasi = ['picjkt', 'picjk_', 'pic_kt', '_icjkt', 'p_cjkt'];
    for (const v of variasi) await login(app, v, 'salah');
    const { res, body } = await login(app, 'pi_jkt', 'salah');
    expect(res.status).toBe(429);
    expect(body.error).toBe('RATE_LIMIT');
  });

  it('akun terkunci tetap terkunci walau password benar sampai jendela habis', async () => {
    const cryptoHash = await hashPassword('rahasia123');
    const { deps } = makeDeps({ findByUsername: async () => ({ ...PIC_USER, password: cryptoHash }) });
    const app = buildApp(fakeEnv(), deps);
    for (let i = 0; i < 5; i++) await login(app, `v${i}`, 'salah');
    const { res } = await login(app, 'picjkt', 'rahasia123');
    expect(res.status).toBe(429);
  });

  it('username dengan karakter wildcard ditolak sebagai kredensial salah', async () => {
    const { deps } = makeDeps({ findByUsername: async () => null });
    const app = buildApp(fakeEnv(), deps);
    const { res } = await login(app, '%', 'x');
    expect(res.status).toBe(401);
  });
```

- [x] **Step 2: Jalankan, pastikan dua tes pertama gagal**

Run: `npx vitest run tests/auth-routes.test.ts`
Expected: FAIL — status 401, bukan 429 (rate limit masih per string mentah).

- [x] **Step 3: Implementasi** — ganti blok rate limit di handler `/login`:

```ts
const LOGIN_MAX = 5;
const LOGIN_IP_MAX = 30;
const PASSWORD_MIN = 6;
const LOGIN_WINDOW_MS = 5 * 60 * 1000;
```

```ts
    // Lapis 1: per string input (perilaku lama) + per IP, sebelum menyentuh DB.
    const rate = await checkRate(deps.kv, `login:${username}`, LOGIN_MAX, LOGIN_WINDOW_MS, deps.now);
    const rateIp = ip ? await checkRate(deps.kv, `login-ip:${ip}`, LOGIN_IP_MAX, LOGIN_WINDOW_MS, deps.now) : rate;
    const tolak = !rate.allowed ? rate : !rateIp.allowed ? rateIp : null;
    if (tolak) {
      return c.json(errPayload(`Terlalu banyak percobaan login. Tunggu ${tolak.retryAfterSec} detik.`, 'RATE_LIMIT'), 429);
    }

    const user = await deps.findByUsername(username);
    // Lapis 2: per akun hasil lookup — variasi penulisan username tidak memberi jatah baru.
    if (user) {
      const rateAkun = await checkRate(deps.kv, `login-akun:${user.user_id}`, LOGIN_MAX, LOGIN_WINDOW_MS, deps.now);
      if (!rateAkun.allowed) {
        return c.json(errPayload(`Terlalu banyak percobaan login. Tunggu ${rateAkun.retryAfterSec} detik.`, 'RATE_LIMIT'), 429);
      }
    }
```

Dan setelah login sukses, reset kedua kunci:

```ts
    await resetRate(deps.kv, `login:${username}`);
    await resetRate(deps.kv, `login-akun:${user.user_id}`);
```

- [x] **Step 4: Jalankan seluruh tes auth**

Run: `npx vitest run tests/auth-routes.test.ts tests/rate-limit.test.ts`
Expected: PASS semua (termasuk tes lama "login melebihi rate limit diblokir").

- [x] **Step 5: Commit**

```bash
git add src/routes/auth.ts tests/auth-routes.test.ts
git commit -m "fix(auth): rate limit login per akun dan per IP"
```

### Gerbang Fase 1
- [x] `npm test && npm run typecheck` hijau
- [x] Jalankan **`/security-review`** atas commit Fase 1; perbaiki temuan
- [x] Entri CHANGELOG (Keamanan) + update "Catatan keamanan" di README.md (rate limit per akun/IP)
  - Hasil security-review 2026-10-19: tidak ada temuan ≥8. Catatan: username baru berisi `%`/`*` lolos cek unik (tidak bisa login) → Fase 5 #8.

---

# FASE 2 — Mencegah kehilangan data laporan (gerbang: `/ui-ux-pro-max`, `/security-review` untuk Task 5, `/code-review:code-review`)

### Task 3: Klien API — jangan logout pada respons non-JSON, tambah timeout

**Files:**
- Modify: `static/js/api.js`
- Test: `tests/frontend/api.test.ts`

- [x] **Step 1: Tulis tes gagal** (tambahkan di `describe('request', …)`; import `getToken` dari store):

```ts
  it('respons non-JSON (mis. halaman 502 Cloudflare) tidak menghapus sesi', async () => {
    setToken('T-LAMA');
    stubFetch(async () => new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    const err = await request('GET', '/api/master').catch((e) => e as ApiError);
    expect(err.error).toBe('BAD_RESPONSE');
    expect(getToken()).toBe('T-LAMA');
  });

  it('401 tetap menghapus sesi', async () => {
    setToken('T-LAMA');
    stubFetch(async () => json({ success: false, error: 'UNAUTHORIZED', message: 'sesi tidak valid' }, 401));
    await request('GET', '/api/master').catch(() => null);
    expect(getToken()).toBe('');
  });

  it('request yang menggantung dibatalkan dengan galat TIMEOUT', async () => {
    vi.useFakeTimers();
    stubFetch((_u, init) => new Promise((_r, rej) => init?.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))));
    const p = request('GET', '/api/master').catch((e) => e as ApiError);
    await vi.advanceTimersByTimeAsync(31_000);
    const err = await p;
    expect(err.error).toBe('TIMEOUT');
    vi.useRealTimers();
  });
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/frontend/api.test.ts`
Expected: FAIL — token terhapus; tes timeout menggantung/FAIL.

- [x] **Step 3: Implementasi** — ganti isi `request()` di `static/js/api.js`:

```js
const WAKTU_HABIS = 'Server tidak merespons. Periksa sinyal lalu coba lagi.';
// Unggah foto (base64 besar) di sinyal lemah butuh waktu lebih lama.
export const BATAS_WAKTU_MS = 30_000;
export const BATAS_WAKTU_FOTO_MS = 120_000;

export async function request(method, path, body, { timeoutMs = BATAS_WAKTU_MS } = {}) {
  const ctrl = new AbortController();
  const init = { method, headers: headerToken(), signal: ctrl.signal };
  if (body !== undefined) init.body = JSON.stringify(body);
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  let res;
  try {
    res = await fetch(path, init);
  } catch (e) {
    clearTimeout(timer);
    if (e?.name === 'AbortError') throw new ApiError(WAKTU_HABIS, 0, 'TIMEOUT');
    throw new ApiError(JARINGAN_GAGAL, 0, 'NETWORK');
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // Halaman error proxy/Cloudflare/captive portal: bukan tanda sesi tidak sah — sesi dipertahankan.
    throw new ApiError(RESPON_GAGAL, res.status, 'BAD_RESPONSE');
  } finally {
    clearTimeout(timer);
  }
  // ...sisa fungsi tetap sama (cek !res.ok, 401 -> clearSession, dispatch data-berubah)
}

export function post(path, body, opsi) {
  return request('POST', path, body, opsi);
}
```

- [x] **Step 4: Pakai batas waktu foto di input & edit**

Di `static/js/pages/input.js` (baris `const up = await post('/api/laporan/photos', fotoBody);`) dan pemanggilan unggah foto yang sama di `static/js/pages/edit.js`:

```js
import { get, post, BATAS_WAKTU_FOTO_MS } from '../api.js';
// ...
const up = await post('/api/laporan/photos', fotoBody, { timeoutMs: BATAS_WAKTU_FOTO_MS });
```

- [x] **Step 5: Jalankan tes**

Run: `npx vitest run tests/frontend`
Expected: PASS.

- [x] **Step 6: Commit**

```bash
git add static/js/api.js static/js/pages/input.js static/js/pages/edit.js tests/frontend/api.test.ts
git commit -m "fix(api): sesi tidak dihapus pada respons non-JSON; tambah timeout request"
```

### Task 4: Pesan jelas saat laporan dikirim ulang setelah respons hilang

**Konteks:** POST pertama sukses tapi respons hilang → jalur sudah `SUDAH_LAPORAN` → retry ditolak dengan `MSG_JALUR_GATE` ("buat jalur dulu") yang membuat PIC membuat jalur + laporan ganda.

**Files:**
- Modify: `src/logic/laporan.ts:529-532` (tambah konstanta)
- Modify: `src/routes/laporan.ts:234-236`
- Test: `tests/routes/laporan.test.ts`

- [x] **Step 1: Tulis tes gagal** (di `describe('POST /api/laporan (save)', …)`):

```ts
  it('jalur sudah dilaporkan -> 409 SUDAH_DILAPORKAN, bukan pesan "buat jalur"', async () => {
    const { app, kv } = setup({ jalur: [jalurRow({ status: 'SUDAH_LAPORAN', laporan_id: 'TRX-LAMA' })] });
    const tok = await loginAs(kv, PIC);
    const res = await post(app, '/api/laporan', tok, saveBody());
    expect(res.status).toBe(409);
    const b = await res.json() as any;
    expect(b.error).toBe('SUDAH_DILAPORKAN');
    expect(b.message).toContain('sudah tersimpan');
  });
```

- [x] **Step 2: Jalankan, pastikan gagal**

Run: `npx vitest run tests/routes/laporan.test.ts -t "sudah dilaporkan"`
Expected: FAIL — `error` = `CONFLICT`.

- [x] **Step 3: Implementasi**

`src/logic/laporan.ts` (setelah `MSG_DUPLICATE`):

```ts
export const MSG_SUDAH_DILAPORKAN =
  'Laporan untuk supir & kendaraan ini pada tanggal tersebut sudah tersimpan (mungkin dari kiriman sebelumnya saat sinyal putus). Cek Riwayat Transaksi sebelum menginput ulang.';
```

`src/routes/laporan.ts` — ganti blok gate:

```ts
    if (!matchedJalur) throw new HttpError(409, L.MSG_JALUR_GATE, 'CONFLICT');
    if (matchedJalur.status !== 'BELUM_DIISI') throw new HttpError(409, L.MSG_SUDAH_DILAPORKAN, 'SUDAH_DILAPORKAN');
```

- [x] **Step 4: Klien — tawarkan tautan Riwayat**

Di `static/js/pages/input.js`, blok `catch (err)` submit:

```js
    } catch (err) {
      alertBox.replaceChildren(
        err.message || 'Gagal menyimpan laporan.',
        err.error === 'SUDAH_DILAPORKAN' ? el('div', { class: 'mt-2' }, [el('a', { href: '#/history', class: 'alert-link', text: 'Buka Riwayat Transaksi' })]) : '',
      );
      tampilkanGalat(alertBox); // dari Task 10; sebelum Task 10 cukup alertBox.classList.remove('d-none')
```

- [x] **Step 5: Jalankan tes laporan** — Run: `npx vitest run tests/routes/laporan.test.ts` → PASS.

- [x] **Step 6: Commit**

```bash
git add src/logic/laporan.ts src/routes/laporan.ts static/js/pages/input.js tests/routes/laporan.test.ts
git commit -m "fix(laporan): pesan SUDAH_DILAPORKAN saat kirim ulang setelah respons hilang"
```

### Task 5: Sesi sliding (diperpanjang selama aktif)

**Files:**
- Modify: `src/auth/sessions.ts` (`resolveSession`)
- Test: `tests/sessions.test.ts`

- [ ] **Step 1: Tulis tes gagal**

```ts
import { createSession, resolveSession, SESSION_TTL_SECONDS } from '../src/auth/sessions';
// (pakai helper KV memori yang sudah dipakai di file ini)

it('sesi yang dipakai setelah separuh TTL diperpanjang', async () => {
  const kv = memKv();
  let t = 1_000_000;
  const now = () => t;
  const token = await createSession(kv, { user_id: 'U-1', username: 'a', nama: 'A', role: 'PIC CABANG', cabang: 'X', exp: 0 }, now);
  t += (SESSION_TTL_SECONDS * 1000) * 0.6;
  const s1 = await resolveSession(kv, token, now);
  expect(s1!.exp).toBe(t + SESSION_TTL_SECONDS * 1000);
  t += (SESSION_TTL_SECONDS * 1000) * 0.6; // total 1.2x TTL: tanpa perpanjangan sudah kedaluwarsa
  expect(await resolveSession(kv, token, now)).not.toBeNull();
});

it('sesi yang dipakai sebelum separuh TTL tidak ditulis ulang', async () => {
  const kv = memKv();
  let t = 1_000_000;
  const token = await createSession(kv, { user_id: 'U-1', username: 'a', nama: 'A', role: 'PIC CABANG', cabang: 'X', exp: 0 }, () => t);
  const awal = (await resolveSession(kv, token, () => t))!.exp;
  t += 1000;
  expect((await resolveSession(kv, token, () => t))!.exp).toBe(awal);
});
```

(Gunakan helper KV memori yang ada di `tests/sessions.test.ts`/`tests/helpers.ts`; namai `memKv` sesuai yang tersedia di sana.)

- [ ] **Step 2: Jalankan, pastikan gagal** — Run: `npx vitest run tests/sessions.test.ts` → FAIL (exp tidak berubah).

- [ ] **Step 3: Implementasi** — ganti `resolveSession`:

```ts
// Sesi diperpanjang (sliding) bila sudah lewat separuh umur: PIC yang login pagi tidak
// terlempar di tengah input sore. Ditulis ulang paling banyak sekali per separuh TTL agar KV hemat.
export async function resolveSession(kv: KVStore, token: string | null, now: () => number = Date.now): Promise<SessionUser | null> {
  if (!token) return null;
  const raw = await kv.get(`session:${token}`);
  if (!raw) return null;
  const s = JSON.parse(raw as string) as SessionUser;
  const t = now();
  if (t > s.exp) {
    await kv.delete(`session:${token}`);
    return null;
  }
  const ttlMs = SESSION_TTL_SECONDS * 1000;
  if (s.exp - t < ttlMs / 2) {
    s.exp = t + ttlMs;
    await kv.put(`session:${token}`, JSON.stringify(s), { expirationTtl: SESSION_TTL_SECONDS });
    if (s.user_id) {
      const daftar = await kv.get(kunciDaftar(s.user_id), 'json');
      if (Array.isArray(daftar)) await kv.put(kunciDaftar(s.user_id), JSON.stringify(daftar), { expirationTtl: SESSION_TTL_SECONDS });
    }
  }
  return s;
}
```

Catatan keamanan: pencabutan sesi (`cabutSesiPengguna`) tetap berfungsi karena daftar token ikut diperpanjang.

- [ ] **Step 4: Jalankan** — Run: `npx vitest run tests/sessions.test.ts tests/auth-routes.test.ts tests/routes/password.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/auth/sessions.ts tests/sessions.test.ts
git commit -m "feat(auth): sesi sliding diperpanjang saat aktif"
```

### Task 6: Draft otomatis form Input Laporan

**Keputusan desain:** draft menyimpan **nilai field saja** di `localStorage` (bukan foto — File tidak bisa diserialisasi; foto di IndexedDB ditunda ke rencana lanjutan). Banner pemulihan memberi tahu bahwa foto perlu dipilih ulang. Kunci per user. Draft kedaluwarsa 24 jam. Supir disimpan sebagai `nama_driver` + `vehicle_id` (bukan indeks opsi, karena indeks berubah saat daftar jalur dimuat ulang).

**Files:**
- Create: `static/js/draft.js`
- Modify: `static/js/pages/input.js`
- Test: `tests/frontend/draft.test.ts`

- [ ] **Step 1: Tulis tes gagal** — `tests/frontend/draft.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { bacaDraft, hapusDraft, kunciDraft, simpanDraft, DRAFT_UMUR_MS } from '../../static/js/draft.js';

class Mem { m = new Map<string, string>(); getItem(k: string) { return this.m.get(k) ?? null; } setItem(k: string, v: string) { this.m.set(k, v); } removeItem(k: string) { this.m.delete(k); } }

describe('draft form', () => {
  it('kunci dibedakan per form dan per user', () => {
    expect(kunciDraft('input', 'U-1')).toBe('draft.input.U-1');
    expect(kunciDraft('input', '')).toBe('draft.input.anon');
  });

  it('simpan lalu baca mengembalikan nilai dan waktu simpan', () => {
    const s = new Mem();
    simpanDraft(s, 'k', { km_awal: '12345' }, 1000);
    expect(bacaDraft(s, 'k', 2000)).toEqual({ nilai: { km_awal: '12345' }, disimpan: 1000 });
  });

  it('draft kedaluwarsa dibuang', () => {
    const s = new Mem();
    simpanDraft(s, 'k', { a: '1' }, 0);
    expect(bacaDraft(s, 'k', DRAFT_UMUR_MS + 1)).toBeNull();
    expect(s.getItem('k')).toBeNull();
  });

  it('JSON rusak / storage melempar tidak membuat crash', () => {
    const s = new Mem();
    s.setItem('k', '{rusak');
    expect(bacaDraft(s, 'k', 0)).toBeNull();
    const lempar = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); }, removeItem() { throw new Error('x'); } };
    expect(bacaDraft(lempar, 'k', 0)).toBeNull();
    expect(() => simpanDraft(lempar, 'k', {}, 0)).not.toThrow();
    expect(() => hapusDraft(lempar, 'k')).not.toThrow();
  });

  it('draft tanpa isi berarti (semua kosong) tidak disimpan', () => {
    const s = new Mem();
    simpanDraft(s, 'k', { a: '', b: false }, 0);
    expect(s.getItem('k')).toBeNull();
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal** — Run: `npx vitest run tests/frontend/draft.test.ts` → FAIL (modul tidak ada).

- [ ] **Step 3: Implementasi** — `static/js/draft.js`:

```js
// Draft form di localStorage agar isian tidak hilang saat reload, tab dimatikan HP,
// sesi habis, atau pindah halaman tak sengaja. Semua akses storage dibungkus try/catch
// (mode privat / storage penuh tidak boleh mematahkan form).
export const DRAFT_UMUR_MS = 24 * 60 * 60 * 1000;

export function kunciDraft(form, userId) {
  return `draft.${form}.${userId || 'anon'}`;
}

function adaIsi(nilai) {
  return Object.values(nilai || {}).some((v) => v !== '' && v !== false && v !== null && v !== undefined);
}

export function simpanDraft(storage, kunci, nilai, now = Date.now()) {
  try {
    if (!adaIsi(nilai)) { storage.removeItem(kunci); return; }
    storage.setItem(kunci, JSON.stringify({ nilai, disimpan: now }));
  } catch { /* abaikan */ }
}

export function bacaDraft(storage, kunci, now = Date.now()) {
  try {
    const raw = storage.getItem(kunci);
    if (!raw) return null;
    const d = JSON.parse(raw);
    if (!d || typeof d.nilai !== 'object' || !(now - Number(d.disimpan) <= DRAFT_UMUR_MS)) {
      storage.removeItem(kunci);
      return null;
    }
    return { nilai: d.nilai, disimpan: Number(d.disimpan) };
  } catch {
    return null;
  }
}

export function hapusDraft(storage, kunci) {
  try { storage.removeItem(kunci); } catch { /* abaikan */ }
}
```

- [ ] **Step 4: Jalankan** — Run: `npx vitest run tests/frontend/draft.test.ts` → PASS.

- [ ] **Step 5: Integrasi di `static/js/pages/input.js`**

Import:

```js
import { bacaDraft, hapusDraft, kunciDraft, simpanDraft } from '../draft.js';
import { getUser } from '../store.js';
```

Setelah `form` dibuat (sebelum `form.addEventListener('input', …)`):

```js
  // ── Draft otomatis ──
  const KUNCI = kunciDraft('input', getUser()?.user_id);
  const FIELD_DRAFT = ['tanggal', 'km_awal', 'km_akhir', 'bar_awal', 'bar_akhir', 'jenis_bbm', 'biaya_bbm', 'metode_pembayaran',
    'flazz_card_id', 'biaya_toll', 'metode_toll', 'flazz_card_id_toll', 'biaya_bbm_2', 'flazz_card_id_2', 'biaya_toll_2', 'flazz_card_id_toll_2'];
  const ambilNilai = () => {
    const v = Object.fromEntries(FIELD_DRAFT.map((k) => [k, f[k].value]));
    const j = jalurDrivers[Number(f.nama_supir.value)];
    v.supir = j && f.nama_supir.value !== '' ? { nama_driver: j.nama_driver, vehicle_id: j.vehicle_id } : null;
    v.km_awal_broken = f.km_awal_broken.checked;
    v.km_akhir_broken = f.km_akhir_broken.checked;
    return v;
  };
  let timerDraft = 0;
  const simpanNanti = () => {
    clearTimeout(timerDraft);
    timerDraft = setTimeout(() => simpanDraft(localStorage, KUNCI, ambilNilai()), 600);
  };
  form.addEventListener('input', simpanNanti);
  form.addEventListener('change', simpanNanti);
  const bannerDraft = el('div', { class: 'alert alert-info d-none d-flex flex-wrap align-items-center gap-2', role: 'status' });
  form.prepend(bannerDraft);

  async function pulihkanDraft() {
    const d = bacaDraft(localStorage, KUNCI);
    if (!d) return;
    const v = d.nilai;
    if (v.tanggal && v.tanggal !== f.tanggal.value) { f.tanggal.value = v.tanggal; await muatSupirJalur(); }
    if (v.supir) {
      const idx = jalurDrivers.findIndex((x) => x.nama_driver === v.supir.nama_driver && x.vehicle_id === v.supir.vehicle_id);
      if (idx > -1) { f.nama_supir.value = String(idx); await onSupirChange(); }
    }
    for (const k of FIELD_DRAFT) if (k !== 'tanggal' && v[k] !== undefined && v[k] !== '') f[k].value = v[k];
    for (const k of ['km_awal_broken', 'km_akhir_broken']) if (v[k]) { f[k].checked = true; f[k].dispatchEvent(new Event('change')); }
    if (v.biaya_bbm_2 || v.biaya_toll_2) bukaGrup2();
    hitungUlangLiter();
    formDiubah = true;
    const jam = new Date(d.disimpan).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const buang = el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary ms-auto', text: 'Buang draft' });
    buang.addEventListener('click', () => { hapusDraft(localStorage, KUNCI); window.location.reload(); });
    bannerDraft.replaceChildren(el('span', { text: `Isian dari ${jam} dipulihkan. Foto perlu dipilih ulang.` }), buang);
    bannerDraft.classList.remove('d-none');
  }
```

Ganti panggilan awal `muatSupirJalur();` menjadi:

```js
  muatSupirJalur().then(pulihkanDraft);
```

Setelah submit sukses (sebelum `toast('Laporan tersimpan.'…)`):

```js
      clearTimeout(timerDraft);
      hapusDraft(localStorage, KUNCI);
```

- [ ] **Step 6: Verifikasi manual** (`npm run dev`, buka `#/input` di viewport 375px): isi KM & biaya → reload → banner "Isian dari HH:MM dipulihkan" muncul dan nilai kembali; "Buang draft" mengosongkan; simpan sukses → buka `#/input` lagi tanpa banner.

- [ ] **Step 7: Commit**

```bash
git add static/js/draft.js static/js/pages/input.js tests/frontend/draft.test.ts
git commit -m "feat(input): draft otomatis form laporan (dipulihkan setelah reload/sesi habis)"
```

### Task 7: Penjaga keluar halaman saat form belum disimpan

**Files:**
- Modify: `static/js/router.js`
- Modify: `static/js/pages/input.js`, `static/js/pages/edit.js`
- Modify: `static/sw.js` (notificationclick)
- Modify: `static/js/app.js` (terima pesan dari SW)
- Test: `tests/frontend/router.test.ts`

- [ ] **Step 1: Tulis tes gagal** (helper murni):

```ts
import { putuskanKeluar } from '../../static/js/router.js';

describe('putuskanKeluar', () => {
  it('tanpa penjaga: boleh pindah', () => {
    expect(putuskanKeluar(null, () => false)).toBe(true);
  });
  it('penjaga tidak memberi pesan: boleh pindah tanpa bertanya', () => {
    const tanya = vi.fn(() => false);
    expect(putuskanKeluar(() => '', tanya)).toBe(true);
    expect(tanya).not.toHaveBeenCalled();
  });
  it('penjaga memberi pesan: ikut jawaban konfirmasi', () => {
    expect(putuskanKeluar(() => 'Belum disimpan', () => true)).toBe(true);
    expect(putuskanKeluar(() => 'Belum disimpan', () => false)).toBe(false);
  });
});
```

(Tambahkan `vi` ke import vitest di file tes.)

- [ ] **Step 2: Jalankan, pastikan gagal** — Run: `npx vitest run tests/frontend/router.test.ts` → FAIL.

- [ ] **Step 3: Implementasi di `static/js/router.js`**

```js
let penjagaKeluar = null;
let hashAktif = '';
let abaikanHashBerikut = false;

// Halaman dengan form memasang penjaga: fungsi yang mengembalikan pesan konfirmasi
// bila ada isian belum disimpan ('' = aman). Dilepas otomatis setiap ganti halaman.
export function pasangPenjagaKeluar(fn) {
  penjagaKeluar = fn;
}

export function putuskanKeluar(penjaga, tanya = (m) => window.confirm(m)) {
  const pesan = penjaga ? penjaga() : '';
  return !pesan || tanya(pesan);
}

export function bolehTinggalkanHalaman() {
  return putuskanKeluar(penjagaKeluar);
}
```

Di `startRouter()`:

```js
export function startRouter() {
  window.addEventListener('hashchange', () => {
    if (abaikanHashBerikut) { abaikanHashBerikut = false; return; }
    if (!putuskanKeluar(penjagaKeluar)) {
      abaikanHashBerikut = true;
      window.location.hash = hashAktif; // batal pindah: kembalikan hash, halaman tidak digambar ulang
      return;
    }
    run(window.location.hash);
  });
  window.addEventListener('beforeunload', (ev) => {
    if (penjagaKeluar && penjagaKeluar()) { ev.preventDefault(); ev.returnValue = ''; }
  });
  run(window.location.hash);
}
```

Di awal `run(hash)` (setelah `if (!view) return;`):

```js
  penjagaKeluar = null;
  hashAktif = hash;
```

- [ ] **Step 4: Pasang di input.js** (setelah `formDiubah` didefinisikan):

```js
import { pasangPenjagaKeluar } from '../router.js';
// ...
  pasangPenjagaKeluar(() => (formDiubah ? 'Laporan belum disimpan. Tinggalkan halaman? (Isian tetap tersimpan sebagai draft.)' : ''));
```

Tombol Batal tidak perlu confirm sendiri lagi — ganti handler menjadi `window.location.hash = '#/history';` (penjaga yang bertanya). Setelah submit sukses set `formDiubah = false;` sebelum pindah hash.

Pasang hal yang sama di `static/js/pages/edit.js` (pesan: `'Perubahan belum disimpan. Tinggalkan halaman?'`), dengan flag kotor dari event `input`/`change` pada form edit; set `false` setelah simpan sukses. Ganti pindah halaman setelah simpan dengan `location.replace('#/history')` agar tombol Back tidak kembali ke form edit lama.

- [ ] **Step 5: Notifikasi push tidak memaksa navigasi** — `static/sw.js` notificationclick:

```js
    for (const c of semua) {
      if ('focus' in c) {
        await c.focus();
        // Biarkan halaman memutuskan (form yang belum disimpan dijaga router).
        c.postMessage({ type: 'buka-url', url });
        return;
      }
    }
```

`static/js/app.js` (di tempat listener `message` SW yang sudah menangani `bunyi-pengingat`, atau tambahkan):

```js
navigator.serviceWorker?.addEventListener('message', (ev) => {
  if (ev.data?.type === 'buka-url') {
    const hash = new URL(ev.data.url, location.origin).hash || '#/dashboard';
    if (hash !== location.hash) location.hash = hash; // lewat hashchange -> penjaga ikut bertanya
  }
});
```

- [ ] **Step 6: Popup 16:30 & banner** — di `static/js/notifikasi.js`, tautan "Lihat jalur" sudah berupa `href="#/jalur"` sehingga otomatis lewat penjaga. Tambahan: jangan buka popup saat penjaga aktif. Ekspor dari router `export function adaFormTerbuka() { return Boolean(penjagaKeluar && penjagaKeluar()); }`, lalu di `tampilPopup` awal fungsi:

```js
import { adaFormTerbuka } from './router.js';
// ...
  if (adaFormTerbuka()) return; // banner tetap tampil; popup ditunda sampai form selesai
```

- [ ] **Step 7: Jalankan tes** — Run: `npx vitest run tests/frontend` → PASS.

- [ ] **Step 8: Verifikasi manual:** isi form input → klik menu Dashboard → muncul konfirmasi; Batal → tetap di form dengan isian utuh; tombol Back HP → konfirmasi yang sama; reload → dialog browser "tinggalkan situs?".

- [ ] **Step 9: Commit**

```bash
git add static/js/router.js static/js/pages/input.js static/js/pages/edit.js static/sw.js static/js/app.js static/js/notifikasi.js tests/frontend/router.test.ts
git commit -m "feat(router): konfirmasi sebelum meninggalkan form yang belum disimpan"
```

### Task 8: Login — kembali ke halaman tujuan, dan jangan tampilkan login saat sudah masuk

**Files:**
- Modify: `static/js/router.js` (`run`, `ensureSession`)
- Modify: `static/js/pages/login.js`
- Test: `tests/frontend/router.test.ts`

- [ ] **Step 1: Tulis tes gagal**

```ts
import { tujuanSetelahLogin } from '../../static/js/router.js';

describe('tujuanSetelahLogin', () => {
  it('memakai rute tersimpan bila aman', () => {
    expect(tujuanSetelahLogin('#/input')).toBe('#/input');
    expect(tujuanSetelahLogin('#/edit/TRX-1')).toBe('#/edit/TRX-1');
  });
  it('default dashboard untuk kosong, login, atau bukan hash rute', () => {
    expect(tujuanSetelahLogin('')).toBe('#/dashboard');
    expect(tujuanSetelahLogin('#/login')).toBe('#/dashboard');
    expect(tujuanSetelahLogin('https://jahat.example')).toBe('#/dashboard');
    expect(tujuanSetelahLogin(null)).toBe('#/dashboard');
  });
});
```

- [ ] **Step 2: Jalankan, pastikan gagal.**

- [ ] **Step 3: Implementasi** di `router.js`:

```js
const KUNCI_TUJUAN = 'tujuan-login';

// Hanya hash rute internal ('#/...') yang diterima — mencegah open redirect.
export function tujuanSetelahLogin(simpanan) {
  const s = String(simpanan || '');
  return /^#\/[\w\-/%.]*$/.test(s) && s !== '#/login' ? s : '#/dashboard';
}

function keLogin(hashSekarang) {
  try { if (hashSekarang && hashSekarang !== '#/login') sessionStorage.setItem(KUNCI_TUJUAN, hashSekarang); } catch { /* abaikan */ }
  window.location.hash = '#/login';
}

export function ambilTujuanLogin() {
  let s = '';
  try { s = sessionStorage.getItem(KUNCI_TUJUAN) || ''; sessionStorage.removeItem(KUNCI_TUJUAN); } catch { /* abaikan */ }
  return tujuanSetelahLogin(s);
}
```

Di `run()`: ganti `window.location.hash = '#/login'` (guard) dengan `keLogin(hash)`. Di `ensureSession()` ganti kedua `window.location.hash = '#/login'` dengan `keLogin(window.location.hash)`.

`static/js/pages/login.js`:

```js
import { isLoggedIn, setToken, setUser } from '../store.js';
import { ambilTujuanLogin } from '../router.js';

export function renderLogin(view) {
  if (isLoggedIn()) { location.replace('#/dashboard'); return; }
  // ...
      setUser(data.user);
      location.replace(ambilTujuanLogin()); // replace: tombol Back tidak kembali ke form login
```

- [ ] **Step 4: Jalankan tes** → PASS. **Step 5: Commit** `fix(login): kembali ke halaman tujuan setelah login`.

### Task 9: Gagal memuat jalur ditampilkan sebagai galat + Coba lagi (bukan "tidak ada jalur")

**Files:** Modify `static/js/pages/input.js` (`muatSupirJalur`)

- [ ] **Step 1: Implementasi**

```js
  async function muatSupirJalur() {
    const sebelumnya = f.nama_supir.value === '' ? null : jalurDrivers[Number(f.nama_supir.value)];
    jalurDrivers = [];
    isiOpsi(f.nama_supir, [], '— memuat jalur —');
    try {
      const data = await get(`/api/jalur/drivers?tanggal=${encodeURIComponent(f.tanggal.value)}`);
      jalurDrivers = Array.isArray(data.list) ? data.list : [];
    } catch (err) {
      isiOpsi(f.nama_supir, [], '— gagal memuat jalur —');
      const ulang = el('button', { type: 'button', class: 'btn btn-sm btn-outline-danger ms-2', text: 'Coba lagi' });
      ulang.addEventListener('click', async () => { await muatSupirJalur(); await onSupirChange(); });
      infoJalur.replaceChildren(el('span', { class: 'text-danger', role: 'alert' }, [`Gagal memuat jalur: ${err.message}`, ulang]));
      return;
    }
    // ...sisa fungsi tetap
```

- [ ] **Step 2: Verifikasi manual** (DevTools → Offline → ganti tanggal): muncul teks merah + "Coba lagi", tidak ada tautan "Buat jalur".
- [ ] **Step 3: Commit** `fix(input): galat muat jalur dengan tombol coba lagi`.

### Gerbang Fase 2
- [ ] `npm test && npm run typecheck` hijau
- [ ] **`/security-review`** (Task 5 sesi sliding, Task 8 redirect login)
- [ ] **`/ui-ux-pro-max`** review alur Input & Edit (draft, konfirmasi keluar, galat)
- [ ] **`/code-review:code-review`** (modul baru `draft.js`, perubahan router)
- [ ] CHANGELOG (UX + Keamanan) diperbarui

---

# FASE 3 — Umpan balik form & aksesibilitas (gerbang: `/ui-ux-pro-max`, `/code-review:code-review`)

### Task 10: `tampilkanGalat()` — galat selalu terlihat dan diumumkan

**Files:** Modify `static/js/ui.js`; pakai di `input.js`, `edit.js`, `jalur.js`, `flazz.js`, `master.js` (semua tempat `alertBox.classList.remove('d-none')`).

- [ ] **Step 1: Implementasi** di `ui.js`:

```js
// Galat form selalu di-scroll ke tengah layar dan diumumkan pembaca layar; tombol Simpan
// ada di bawah form panjang, jadi galat di atas form sebelumnya tidak terlihat di HP.
export function tampilkanGalat(box, pesan) {
  if (pesan !== undefined) box.textContent = pesan;
  box.setAttribute('role', 'alert');
  box.setAttribute('tabindex', '-1');
  box.classList.remove('d-none');
  box.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  box.focus?.({ preventScroll: true });
}
```

- [ ] **Step 2:** Ganti setiap pasangan
`alertBox.textContent = X; alertBox.classList.remove('d-none');` → `tampilkanGalat(alertBox, X);`
Cari dengan: `grep -n "classList.remove('d-none')" static/js/pages/*.js` dan ubah hanya yang menampilkan kotak galat (`alert-danger`).

- [ ] **Step 3:** `npx vitest run tests/frontend` → PASS. Verifikasi manual: submit form input kosong di 375px → layar bergulir ke galat.
- [ ] **Step 4: Commit** `fix(ui): galat form di-scroll ke layar dan diumumkan`.

### Task 11: Label terhubung ke input (`barisForm`)

**Files:** Modify `static/js/ui.js`; ganti helper `baris` lokal di `input.js`, `edit.js`, `jalur.js`, `flazz.js`, `master.js`, `pengaturan.js`, `transaksi.js`, `audit.js`, `galeri.js`, `rekap.js` (`kolom`).

- [ ] **Step 1: Tes gagal** — `tests/frontend/ui.test.ts`:

```ts
import { idUntukLabel } from '../../static/js/ui.js';
it('idUntukLabel memakai id yang ada atau membuat id unik', () => {
  expect(idUntukLabel({ id: 'f-km' } as any)).toBe('f-km');
  const a = { id: '', setAttribute(k: string, v: string) { (this as any)[k] = v; } } as any;
  const id1 = idUntukLabel(a);
  expect(id1).toMatch(/^fld-\d+$/);
  expect(a.id).toBe(id1);
});
```

- [ ] **Step 2: Implementasi** di `ui.js`:

```js
let nomorField = 0;
// Label wajib terhubung ke kontrolnya (for=id): dibaca pembaca layar & area tap label ikut memfokuskan input.
export function idUntukLabel(kontrol) {
  if (kontrol.id) return kontrol.id;
  const id = `fld-${++nomorField}`;
  kontrol.setAttribute('id', id);
  return id;
}

// Kontrol bisa dibungkus (input-group/div): label menunjuk input/select/textarea pertama di dalamnya.
export function barisForm(label, kontrol, catatan = '', kelas = 'mb-3') {
  const target = kontrol.matches?.('input,select,textarea') ? kontrol : kontrol.querySelector?.('input,select,textarea');
  return el('div', { class: kelas }, [
    el('label', { class: 'form-label', text: label, for: target ? idUntukLabel(target) : null }),
    kontrol,
    catatan ? el('div', { class: 'form-text', text: catatan }) : null,
  ]);
}
```

- [ ] **Step 3:** Di setiap halaman, hapus definisi `const baris = (label, kontrol, catatan = '') => …` dan import `barisForm as baris` dari `../ui.js` (signature sama, jadi pemanggilan tidak berubah). Untuk halaman dengan kelas label berbeda (`rekap.js` `kolom`, `master.js` pencarian), tambahkan `for` lewat `idUntukLabel` di helper lokalnya. Input tanpa label sama sekali (pencarian master) diberi `aria-label`.
- [ ] **Step 4:** `npx vitest run tests/frontend` → PASS. **Step 5: Commit** `fix(a11y): label form terhubung ke input`.

### Task 12: Toast aksesibel, bisa ditutup, dan semua jenis punya gaya

**Files:** Modify `static/js/ui.js` (`toast`), `static/index.html:27`, `static/css/app.css:201-221`

- [ ] **Step 1:** `static/index.html`: `<div id="toast-host" class="toast-host" aria-live="polite"></div>`
- [ ] **Step 2:** ganti `toast()`:

```js
const PETA_JENIS = { danger: 'error', warning: 'warning', error: 'error', success: 'success', info: 'info' };
export function toast(message, kind = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = el('div', { id: 'toast-host', class: 'toast-host', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const jenis = PETA_JENIS[kind] || 'info';
  const tutup = el('button', { type: 'button', class: 'toast-tutup', 'aria-label': 'Tutup notifikasi', text: '×' });
  const node = el('div', { class: `toast-item toast-${jenis}`, role: jenis === 'error' ? 'alert' : 'status' }, [el('span', { text: message }), tutup]);
  tutup.addEventListener('click', () => node.remove());
  host.appendChild(node);
  setTimeout(() => node.remove(), jenis === 'error' ? 10000 : 4000);
}
```

- [ ] **Step 3:** CSS tambahan:

```css
.toast-item { display: flex; align-items: flex-start; gap: 0.5rem; }
.toast-warning { background: #8a5300; }
.toast-tutup { margin-left: auto; background: none; border: 0; color: inherit; font-size: 1.25rem; line-height: 1; min-width: 44px; min-height: 44px; margin: -0.65rem -0.9rem -0.65rem 0; cursor: pointer; }
@media (max-width: 575.98px) { .toast-host { left: 1rem; right: 1rem; bottom: calc(1rem + env(safe-area-inset-bottom)); } .toast-item { max-width: none; } }
```

- [ ] **Step 4: Commit** `fix(ui): toast aksesibel dengan tombol tutup`.

### Task 13: CSS mobile — font input 16px, target sentuh 44px, kontras, dvh

**Files:** Modify `static/css/app.css`

- [ ] **Step 1:** Tambahkan di akhir `app.css`:

```css
/* iOS memperbesar layar bila font input < 16px. Basis html 15px, jadi paksa 16px di layar sentuh. */
@media (max-width: 991.98px) {
  .form-control, .form-select, .form-control-sm, .form-select-sm { font-size: 16px; }
}

/* Target sentuh minimal 44px di perangkat sentuh (WCAG 2.5.5 / Apple HIG). */
@media (pointer: coarse) {
  .aksi-ikon { gap: 0.5rem; }
  .aksi-ikon .btn, .btn-sm { min-width: 44px; min-height: 44px; }
}

/* Kontras: teks putih di oranye #fd7e14 hanya ~2.9:1 → pakai oranye gelap (≥4.5:1). */
.badge-ef-waspada { background: #b35900; }
```

Ganti `height: 100vh` pada aturan sidebar mobile (sekitar `app.css:557`) menjadi `height: 100vh; height: 100dvh;`.

- [ ] **Step 2:** Di `static/js/pages/dashboard.js`, ganti kelas `badge bg-warning` → `badge text-bg-warning`, `bg-info` dengan teks putih → `text-bg-info` (Bootstrap memilih warna teks kontras). Cari: `grep -n "bg-warning\|bg-info\|text-white-50" static/js/pages/dashboard.js`.
- [ ] **Step 3:** Verifikasi di DevTools (iPhone SE, 375px): tap input tidak zoom; ikon aksi di tabel ≥44px; cek kontras badge di Lighthouse Accessibility.
- [ ] **Step 4: Commit** `fix(css): font input 16px, target sentuh 44px, kontras badge`.

### Task 14: Perbaiki regex badge "Selisih ODO"

**Files:** Modify `static/js/pages/transaksi.js:135`; Test `tests/frontend/dashboard-helpers.test.ts`

- [ ] **Step 1: Tes gagal** (di `describe('history: selisih ODO', …)`):

```ts
  it('menampilkan angka selisih dari teks warning server', async () => {
    const { selisihOdo } = await import('../../static/js/pages/transaksi.js');
    const w = 'SELISIH ODO: KM akhir terakhir 12.300 (5-10-2026), KM awal 12.450, selisih 150 KM - indikasi pemakaian di luar jam kerja';
    const node = selisihOdo({ warning: w }) as any;
    expect(node.textContent).toBe('Selisih ODO +150 KM');
  });
```

(Jika tes berjalan di node tanpa `document`, ekstrak dulu fungsi murni `teksSelisihOdo(warning)` yang mengembalikan string, tes fungsi itu, dan `selisihOdo` memakainya.)

- [ ] **Step 2: Implementasi**

```js
export function teksSelisihOdo(warning) {
  const m = String(warning || '').match(/KM akhir terakhir ([\d.,]+) \(([^)]*)\), KM awal ([\d.,]+), selisih (-?[\d.,]+) KM/);
  return m ? `Selisih ODO ${m[4].startsWith('-') ? '' : '+'}${m[4]} KM` : 'Selisih ODO';
}

export function selisihOdo(row) {
  const w = String(row.warning || '');
  if (!w) return null;
  return el('div', {}, [el('span', { class: 'badge text-bg-danger', title: w, text: teksSelisihOdo(w) })]);
}
```

Tes pakai `teksSelisihOdo`. **Step 3:** PASS. **Step 4: Commit** `fix(history): badge Selisih ODO menampilkan angka`.

### Task 15: Input rupiah — keyboard angka + tampilan terformat

**Files:** Modify `static/js/ui.js`, `static/js/pages/input.js`, `edit.js`, `flazz.js`; Test `tests/frontend/ui.test.ts`

- [ ] **Step 1: Tes gagal**

```ts
import { teksRupiah } from '../../static/js/ui.js';
it('teksRupiah memformat nominal id-ID', () => {
  expect(teksRupiah('150000')).toBe('= Rp 150.000');
  expect(teksRupiah('')).toBe('');
  expect(teksRupiah('abc')).toBe('');
});
```

- [ ] **Step 2: Implementasi** di `ui.js`:

```js
export function teksRupiah(nilai) {
  const n = Number(nilai);
  if (nilai === '' || nilai === null || !Number.isFinite(n)) return '';
  return `= Rp ${n.toLocaleString('id-ID', { maximumFractionDigits: 0 })}`;
}

// Teks bantu di bawah input nominal agar 150.000 vs 1.500.000 mudah dibedakan.
export function bantuRupiah(input) {
  input.setAttribute('inputmode', 'numeric');
  const teks = el('div', { class: 'form-text fw-semibold', 'aria-live': 'polite' });
  const segar = () => { teks.textContent = teksRupiah(input.value); };
  input.addEventListener('input', segar);
  segar();
  return el('div', {}, [input, teks]);
}
```

- [ ] **Step 3:** Di `input.js`, bungkus field rupiah: `baris('Biaya BBM', bantuRupiah(satuan(f.biaya_bbm, 'Rp')))` — catatan: `bantuRupiah` menerima elemen input; untuk input-group buat `const g = satuan(f.biaya_bbm,'Rp'); f.biaya_bbm.setAttribute('inputmode','numeric');` lalu tempel `teks` di bawah `g`. Terapkan pada `biaya_bbm`, `biaya_toll`, `biaya_bbm_2`, `biaya_toll_2`, dan field nominal top up / saldo fisik di `flazz.js`, field biaya di `edit.js`.
- [ ] **Step 4:** PASS + verifikasi manual. **Step 5: Commit** `feat(form): bantu baca nominal rupiah`.

### Task 16: Foto struk boleh dari galeri

**Files:** Modify `static/js/pages/input.js:298-299` (dan input struk di `edit.js` bila ada `capture`)

- [ ] **Step 1:** Hapus `capture: 'environment'` dari `fotoStrukBbm` dan `fotoStrukTol` (odometer tetap kamera langsung sebagai anti-kecurangan).
- [ ] **Step 2: Commit** `fix(input): foto struk bisa dipilih dari galeri`.

### Gerbang Fase 3
- [ ] `npm test && npm run typecheck` hijau
- [ ] **`/ui-ux-pro-max`** (checklist §1 Accessibility, §2 Touch, §5 Layout, §8 Forms) di 375px
- [ ] **`/code-review:code-review`** (helper baru di `ui.js`, perubahan lintas 10 halaman)
- [ ] CHANGELOG diperbarui

---

# FASE 4 — Perbaikan per alur (gerbang: `/ui-ux-pro-max`)

### Task 17: Rekonsiliasi Flazz — pilihan tindakan tidak ditimpa, race guard, konfirmasi ADJUST

**Files:** Modify `static/js/pages/flazz.js:325-416`

- [ ] **Step 1: Implementasi**

```js
  let aksiDisentuh = false;
  aksi.addEventListener('change', () => { aksiDisentuh = true; });

  function hitungSelisih() {
    // ...sama, tetapi:
    if (!aksiDisentuh) aksi.value = s.aksi; // usulan hanya sampai user memilih sendiri
  }

  kartu.addEventListener('change', async () => {
    const diminta = kartu.value;
    aksiDisentuh = false;
    preview = null;
    // ...reset seperti sebelumnya...
    if (!diminta) return;
    gate.className = 'alert alert-secondary py-2';
    gate.textContent = 'Memeriksa kartu…';
    let hasil;
    try {
      hasil = await get(`/api/flazz/reconciliation/preview?card_id=${encodeURIComponent(diminta)}`);
    } catch (e) {
      if (kartu.value !== diminta) return;
      gate.className = 'alert alert-danger py-2';
      const ulang = el('button', { type: 'button', class: 'btn btn-sm btn-outline-danger ms-2', text: 'Coba lagi' });
      ulang.addEventListener('click', () => kartu.dispatchEvent(new Event('change')));
      gate.replaceChildren(`Gagal memeriksa kartu: ${e.message}`, ulang);
      return;
    }
    if (kartu.value !== diminta) return; // respons kartu lama datang terlambat
    preview = hasil;
    // ...render seperti sebelumnya
  });
```

Di submit, sebelum `post`:

```js
    const selisihRp = Number(fisik.value) - Number(preview.flazz_balance);
    if (selisihRp !== 0 && aksi.value === 'ADJUST' &&
        !confirmDialog(`Saldo kartu akan diubah dari ${rp(preview.flazz_balance)} menjadi ${rp(Number(fisik.value))}. Lanjutkan?`)) return;
```

- [ ] **Step 2: Verifikasi manual:** pilih IGNORE → ubah saldo fisik → tetap IGNORE; ganti kartu cepat 2× → preview cocok dengan kartu terakhir.
- [ ] **Step 3: Commit** `fix(flazz): rekon tidak menimpa pilihan tindakan; guard respons lama; konfirmasi penyesuaian`.

### Task 18: Rekap — Unduh Excel memakai filter yang sedang ditampilkan

**Files:** Modify `static/js/pages/rekap.js:286-316`

- [ ] **Step 1: Implementasi**

```js
  let filterDimuat = { dari: '', sampai: '', wh: '' };
  // di muat(), setelah lines diterima:
      filterDimuat = { dari: dari.value, sampai: sampai.value, wh: isSuper ? wh.value : String(getUser()?.cabang || '') };
  // di handler unduh, ganti dari.value/sampai.value/kodeWh dengan filterDimuat:
      const { dari: d, sampai: s, wh: kodeWh } = filterDimuat;
      const sheets = susunExcel(lines, { dari: d, sampai: s, warehouse: kodeWh ? namaCabang[kodeWh] || kodeWh : 'Semua Warehouse', namaCabang });
      XLSX.writeFile(bukuExcel(XLSX, sheets), `rekap-pengeluaran-${d}_${s}${kodeWh ? '-' + kodeWh : ''}.xlsx`);
```

Tambahan: jika `dari.value !== filterDimuat.dari || sampai.value !== filterDimuat.sampai || (isSuper && wh.value !== filterDimuat.wh)` tampilkan `toast('Filter belum diterapkan — file berisi periode yang sedang ditampilkan.', 'warning')`.
- [ ] **Step 2: Commit** `fix(rekap): unduh Excel sesuai periode yang ditampilkan`.

### Task 19: Cegah klik ganda pada aksi hapus/simpan baris (`aksiSekali`)

**Files:** Modify `static/js/ui.js`; pakai di `jalur.js:162-171`, `flazz.js:466-482`, `master.js:300-309`; Test `tests/frontend/ui.test.ts`

- [ ] **Step 1: Tes gagal**

```ts
import { aksiSekali } from '../../static/js/ui.js';
it('aksiSekali menolak panggilan kedua selama yang pertama berjalan', async () => {
  let selesai!: () => void;
  const fn = vi.fn(() => new Promise<void>((r) => { selesai = r; }));
  const btn = { disabled: false } as any;
  const jalan = aksiSekali(btn, fn);
  jalan(); jalan();
  expect(fn).toHaveBeenCalledTimes(1);
  expect(btn.disabled).toBe(true);
  selesai(); await Promise.resolve(); await Promise.resolve();
  expect(btn.disabled).toBe(false);
});
```

- [ ] **Step 2: Implementasi**

```js
// Bungkus handler async: tombol dimatikan selama proses agar tap ganda tidak mengirim dua request.
export function aksiSekali(tombol, fn) {
  let berjalan = false;
  return async (...args) => {
    if (berjalan) return;
    berjalan = true;
    if (tombol) tombol.disabled = true;
    try { return await fn(...args); } finally {
      berjalan = false;
      if (tombol && tombol.isConnected !== false) tombol.disabled = false;
    }
  };
}
```

- [ ] **Step 3:** Bungkus handler hapus jalur, hapus/simpan riwayat Flazz, hapus master. Perbaiki teks toast `'Jadwal dihapus.'` → `'Jalur dihapus.'` (`jalur.js:166`). Pada edit riwayat Flazz, setelah form edit muncul panggil `formEdit.scrollIntoView({ block: 'start', behavior: 'smooth' })`.
- [ ] **Step 4:** PASS. **Step 5: Commit** `fix(ui): cegah klik ganda pada aksi hapus/simpan`.

### Task 20: Jalur — konfirmasi sebelum membuang baris & format tanggal

**Files:** Modify `static/js/pages/jalur.js` (form buat: ganti warehouse & tombol Batal; ringkasan)

- [ ] **Step 1:** Saat warehouse diganti dan ada ≥1 baris terisi: `if (!confirmDialog('Ganti warehouse akan mengosongkan semua baris jalur. Lanjutkan?')) { wh.value = whSebelumnya; return; }`. Simpan `whSebelumnya` setiap perubahan yang disetujui.
- [ ] **Step 2:** Pasang `pasangPenjagaKeluar` (Task 7) di form buat/edit jalur dengan flag kotor dari event `input`/`change`; tombol Batal cukup pindah hash.
- [ ] **Step 3:** Tampilkan nomor baris pada kartu baris (`el('div', { class: 'small fw-bold text-muted', text: \`Jalur #${i + 1}\` })`) agar pesan galat "Baris N" bisa dicocokkan; beri kelas `border-danger` pada baris yang galat.
- [ ] **Step 4:** Ringkasan: ganti tanggal ISO mentah dengan `fmtDateId(...)`. Cari: `grep -n "tanggal" static/js/pages/jalur.js | grep -v fmtDateId`.
- [ ] **Step 5: Commit** `fix(jalur): konfirmasi buang baris, nomor baris, format tanggal`.

### Task 21: Pagination berjendela

**Files:** Modify `static/js/ui.js` (`navHalaman`); Test `tests/frontend/ui.test.ts`

- [ ] **Step 1: Tes gagal**

```ts
import { nomorHalamanTampil } from '../../static/js/ui.js';
it('nomorHalamanTampil memberi jendela dengan elipsis', () => {
  expect(nomorHalamanTampil(5, 3)).toEqual([1, 2, 3, 4, 5]);
  expect(nomorHalamanTampil(100, 50)).toEqual([1, '…', 49, 50, 51, '…', 100]);
  expect(nomorHalamanTampil(100, 1)).toEqual([1, 2, '…', 100]);
});
```

- [ ] **Step 2: Implementasi**

```js
export function nomorHalamanTampil(total, aktif, sisi = 1) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const hasil = [];
  for (let i = 1; i <= total; i++) {
    if (i === 1 || i === total || Math.abs(i - aktif) <= sisi) hasil.push(i);
    else if (hasil[hasil.length - 1] !== '…') hasil.push('…');
  }
  return hasil;
}
```

Di `navHalaman`, ganti `...Array.from({ length: total }, …)` dengan:

```js
    ...nomorHalamanTampil(total, aktif).map((n) => (n === '…'
      ? el('span', { class: 'px-2 align-self-center text-muted', text: '…' })
      : tombol(String(n), n, n === aktif))),
```

Tambahkan `'aria-current': 'page'` pada tombol aktif dan `aria-label` "Halaman sebelumnya/berikutnya" untuk « ».
- [ ] **Step 3:** PASS. **Step 4: Commit** `fix(ui): pagination berjendela`.

### Task 22: Navigasi — gulir ke atas & judul halaman per rute

**Files:** Modify `static/js/router.js` (`run`)

- [ ] **Step 1:** Setelah `await page.render(view);`:

```js
    window.scrollTo?.(0, 0);
    const judul = view.querySelector('h1, h2');
    document.title = judul ? `${judul.textContent} — Monitoring Kendaraan` : 'Monitoring Kendaraan Operasional';
    if (judul) { judul.setAttribute('tabindex', '-1'); judul.focus({ preventScroll: true }); }
```

- [ ] **Step 2: Commit** `fix(router): scroll ke atas, judul & fokus per halaman`.

### Gerbang Fase 4
- [ ] `npm test && npm run typecheck` hijau
- [ ] **`/ui-ux-pro-max`** review alur Flazz, Rekap, Jalur, History
- [ ] CHANGELOG diperbarui

---

# FASE 5 — Rencana lanjutan (masing-masing dibuat rencana terpisah via brainstorming → writing-plans)

Item berikut lebih besar / butuh keputusan desain, jadi **tidak** dirinci di sini (scope check writing-plans):

1. **Offline & PWA** — precache app shell + Bootstrap lokal, banner offline, antrean kirim laporan (IndexedDB + Background Sync), ikon maskable + `id` di manifest.
2. **Foto di draft (IndexedDB)** + kompresi saat foto dipilih (bukan saat Simpan) + status per foto + tombol "Ganti foto" setelah unggah sebagian gagal.
3. **Login ulang di tempat** (modal saat 401, request diulang tanpa meninggalkan halaman).
4. **Bottom navigation mobile** (Dashboard, Input, Jalur, History, Flazz) + tampilan kartu untuk tabel History/Jalur/Flazz di < 768px.
5. **Dialog aksesibel** — helper modal bersama (`<dialog>.showModal()`, Esc, fokus kembali) untuk profil, popup 16:30, drawer sidebar (`inert` saat tertutup).
6. **Galeri** — lightbox dalam aplikasi + filter tanggal/kendaraan; `loading="lazy"` di galeri dashboard.
7. **Konsistensi istilah** (Flazz/Etoll, History/Riwayat) dan label enum ramah (`SEDANG_DIGUNAKAN` → "Sedang dipakai").
8. **Keamanan rendah** — escape `\` di `listForDrivers` (`src/db/jalur.ts:52`), validasi URL foto `serverData.files` harus dari prefix storage sendiri sebelum dihapus saat edit, perbandingan `X-Migrasi-Token` constant-time.
9. Kompres logo sebelum unggah (`pengaturan.js`), `tabular-nums` untuk kolom angka.

---

## Self-review (penulis rencana)
- **Cakupan temuan:** Vuln 1 → Task 1–2. UX Kritis/High: draft → T6; non-JSON logout → T3; sesi → T5 (+F5 #3); retry → T4; timeout → T3; galat tak terlihat → T10; keluar tanpa peringatan → T7; galat jalur → T9; font iOS → T13; offline → F5 #1. Medium: ODO → T14; rekon → T17; rekap → T18; foto → T16 + F5 #2; rupiah → T15; a11y → T11–T13, F5 #5; touch → T13; double-submit → T19; popup 16:30 → T7 step 6; login → T8; edit back → T7 step 4; jalur → T20; pagination → T21; route focus → T22. Lainnya → Fase 5.
- **Konsistensi nama:** `tampilkanGalat`, `barisForm`, `idUntukLabel`, `aksiSekali`, `teksRupiah`, `bantuRupiah`, `nomorHalamanTampil` (ui.js); `pasangPenjagaKeluar`, `putuskanKeluar`, `adaFormTerbuka`, `tujuanSetelahLogin`, `ambilTujuanLogin` (router.js); `kunciDraft`, `simpanDraft`, `bacaDraft`, `hapusDraft` (draft.js); `polaUsername` (keamanan.ts); `MSG_SUDAH_DILAPORKAN` (logic/laporan.ts).
- **Risiko yang perlu dicek saat eksekusi:** import siklik `notifikasi.js → router.js` (router tidak mengimpor notifikasi, aman); `tests/frontend` berjalan di node — helper DOM (`tampilkanGalat`, `barisForm`) diverifikasi manual, hanya fungsi murni yang dites otomatis.
