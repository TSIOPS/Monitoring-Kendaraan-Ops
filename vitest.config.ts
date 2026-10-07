import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Hash password (PBKDF berulang) 2-5 dtk per tes; batas default 5 dtk bikin tes auth
    // kadang gagal saat seluruh suite berjalan paralel.
    testTimeout: 30000,
  },
});