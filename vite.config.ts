import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

/** Dateien aus public/, die der Service Worker zusätzlich vorhält (relativ zur Basis). */
const PUBLIC_FILES = [
  'manifest.webmanifest',
  'favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'apple-touch-icon.png',
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
function serviceWorker(base: string): Plugin {
  return {
    name: 'grapnel-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      if (this.environment?.name !== 'client') return;
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map') && !f.startsWith('.') && f !== 'index.html' && isNeededFile(f));
      const precache = ['', ...files, ...PUBLIC_FILES].map((f) => base + f);
      const template = readFileSync('scripts/sw-template.js', 'utf8');
      const version = createHash('sha256').update(precache.join('|')).update(template).digest('hex').slice(0, 12);
      const source = template
        .replaceAll('__PRECACHE__', JSON.stringify(precache))
        .replaceAll('__VERSION__', version)
        .replaceAll('__BASE__', JSON.stringify(base));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

/** GitHub Pages kennt keinen SPA-Fallback, liefert aber 404.html für jede unbekannte Adresse. */
function spaFallback(): Plugin {
  return {
    name: 'grapnel-404',
    apply: 'build',
    writeBundle(options) {
      if (options.dir) copyFileSync(join(options.dir, 'index.html'), join(options.dir, '404.html'));
    },
  };
}

/**
 * Zwei Ziele:
 * - Standard: Cloudflare Worker mit Sync-Server (`npm run build`, `npm run deploy`).
 * - `--mode pages`: statische App für GitHub Pages unter /grapnel/, ohne Server und darum
 *   ohne Geräte-Sync (`npm run build:pages`).
 */
export default defineConfig(({ mode }) => {
  const pages = mode === 'pages';
  const base = pages ? (process.env.GRAPNEL_BASE ?? '/grapnel/') : '/';
  return {
    base,
    plugins: pages ? [react(), serviceWorker(base), spaFallback()] : [react(), cloudflare(), serviceWorker(base)],
    build: {
      chunkSizeWarningLimit: 1500,
      ...(pages ? { outDir: 'dist/pages' } : {}),
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
  };
});
