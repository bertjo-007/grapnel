import { defineConfig } from 'vitest/config';

// Eigene Konfiguration ohne das Cloudflare-Plugin: Die Tests prüfen reine Logik.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['tests/setup.ts'],
  },
});
