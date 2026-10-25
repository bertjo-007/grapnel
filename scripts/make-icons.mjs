/**
 * Erzeugt alle App-Symbole aus einem SVG (npm run icons).
 * Motiv: der Anker aus Phosphor (anchor-simple, bold) auf Kobaltblau.
 * Ein Grapnel ist ein Enterhaken: etwas, das hält. Das Glyph stammt aus der
 * Icon-Bibliothek der App, damit Logo und Oberfläche dieselbe Linie haben.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const raw = readFileSync('node_modules/@phosphor-icons/core/assets/bold/anchor-simple-bold.svg', 'utf8');
const path = raw.match(/<path d="([^"]+)"/)[1];

const mark = (scale) => {
  // Glyph im 256er-Raster, zentriert und skaliert auf eine 1024er-Fläche.
  const s = (1024 * scale) / 256;
  const o = (1024 - 256 * s) / 2;
  return `<g transform="translate(${o} ${o}) scale(${s})"><path d="${path}" fill="#f4f6fb"/></g>`;
};

const svg = (scale) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a66dc"/>
      <stop offset="1" stop-color="#2649b4"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>
  ${mark(scale)}
</svg>`;

const render = (source, size, file) => {
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(file, png);
  console.log(`${file} (${size}px, ${png.length} Bytes)`);
};

mkdirSync('public/icons', { recursive: true });
// iOS rundet selbst ab – volle Fläche ohne eigene Ecken.
render(svg(0.6), 180, 'public/apple-touch-icon.png');
render(svg(0.6), 192, 'public/icons/icon-192.png');
render(svg(0.6), 512, 'public/icons/icon-512.png');
// Maskierbar: Motiv innerhalb der sicheren Zone (80 %).
render(svg(0.46), 512, 'public/icons/maskable-512.png');

const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="56" fill="#2f5bd3"/>
  <g transform="translate(38 38) scale(0.703)"><path d="${path}" fill="#f4f6fb"/></g>
</svg>`;
writeFileSync('public/favicon.svg', favicon);
console.log('public/favicon.svg');
