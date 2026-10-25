import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

/** Dateien aus public/, die der Service Worker zusätzlich vorhält. */
const PUBLIC_FILES = [
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
  '/apple-touch-icon.png',
];

/** Schriften nur als woff2 und nur latin/latin-ext – die übrigen lädt der Browser nie. */
const isNeededFile = (f: string) =>
  !/\.(woff|ttf|eot)$/.test(f) && !(/\.woff2$/.test(f) && !/-latin-/.test(f));

/**
 * Erzeugt beim Build sw.js aus scripts/sw-template.js mit der Liste aller gebauten
 * Dateien. Damit läuft Grapnel nach dem ersten Öffnen vollständig offline.
 * Die Version ist ein Hash über Dateiliste und Vorlage: Jede Änderung ergibt einen
 * neuen Service Worker, ohne dass jemand von Hand hochzählen muss.
 */
function serviceWorker(): Plugin {
  return {
    name: 'grapnel-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (this.environment?.name !== 'client') return;
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map') && !f.startsWith('.') && f !== 'index.html' && isNeededFile(f))
        .map((f) => `/${f}`);
      const precache = ['/', ...files, ...PUBLIC_FILES];
      const template = readFileSync('scripts/sw-template.js', 'utf8');
      const version = createHash('sha256').update(precache.join('|')).update(template).digest('hex').slice(0, 12);
      const source = template.replaceAll('__PRECACHE__', JSON.stringify(precache)).replaceAll('__VERSION__', version);
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [react(), cloudflare(), serviceWorker()],
  build: {
    chunkSizeWarningLimit: 1500,
  },
  server: {
    // Fest auf IPv4: unter Windows lauscht Vite sonst nur auf ::1.
    host: '127.0.0.1',
    port: 5175,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
  },
});
