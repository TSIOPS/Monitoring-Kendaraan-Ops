### Task 1: Scaffold Repo

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.jsonc`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `static/index.html`
- Create: `src/env.ts`

**Interfaces:**
- Produces: `Env` type (dipakai `app.ts`, `index.ts`, semua route), script npm `dev/deploy/test/typecheck`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "monitoring-kendaraan-ops-cloud",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:migrate": "supabase db push"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.4",
    "hono": "^4.6.14"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250729.0",
    "typescript": "^5.6.3",
    "vitest": "^2.1.9",
    "wrangler": "^4.5.0"
  }
}
```

- [ ] **Step 2: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowImportingTsExtensions": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*.ts", "tests/**/*.ts", "vitest.config.ts"]
}
```

- [ ] **Step 3: Write `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "monitoring-kendaraan-ops",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-18",
  "compatibility_flags": ["nodejs_compat"],
  "assets": {
    "directory": "./static",
    "binding": "ASSETS"
  },
  "kv_namespaces": [
    { "binding": "SESSION_KV", "id": "PASTE_KV_NAMESPACE_ID_HERE" }
  ]
}
```

> Catatan: buat namespace KV via `npx wrangler kv namespace create SESSION_KV`, lalu ganti `id`. Untuk `wrangler dev` lokal nilai `id` palsu cukup (KV lokal dipakai otomatis).

- [ ] **Step 4: Write `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Write `.gitignore`**

```gitignore
node_modules/
.wrangler/
.dev.vars
dist/
*.log
```

- [ ] **Step 6: Write `.env.example`**

```env
# Cloudflare Worker secrets (set via: npx wrangler secret put NAME)
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=service_role_key
```

> Jangan commit `.dev.vars` (berisi nilai asli) â€” gunakan `.env.example` sebagai template.

- [ ] **Step 7: Write `static/index.html`**

```html
<!DOCTYPE html>
<html lang="id">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Laporan BBM & Operasional Harian</title>
</head>
<body>
  <main style="font-family: system-ui, sans-serif; padding: 2rem; text-align: center;">
    <h1>Monitoring Kendaraan Operasional</h1>
    <p>Versi Cloud â€” fondasi berjalan.</p>
  </main>
</body>
</html>
```

- [ ] **Step 8: Write `src/env.ts`**

```ts
export interface Env {
  ASSETS: Fetcher;
  SESSION_KV: KVNamespace;
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}
```

- [ ] **Step 9: Write placeholder `src/index.ts`**

```ts
export default {
  async fetch(): Promise<Response> {
    return new Response('Monitoring Kendaraan Operasional (Cloud)', { status: 200 });
  },
};
```

- [ ] **Step 10: Verifikasi**

Run: `npm install`
Run: `npm run typecheck`
Run: `npm run dev` lalu buka `http://localhost:8787` â€” harus tampil "Monitoring Kendaraan Operasional (Cloud)".
Expected: typecheck lolos tanpa error; dev server menyajikan teks di atas.

- [ ] **Step 11: Commit**

```bash
git add .
git commit -m "chore: scaffold Cloudflare Workers repo"
```

---

### Task 2: Skema PostgreSQL (Supabase)
