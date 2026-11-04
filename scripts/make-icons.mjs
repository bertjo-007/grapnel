/**
 * Erzeugt alle App-Symbole und das Logo in der App aus Joshuas Grapnel-Logo (npm run icons).
 * Vorlage: scripts/brand/grapnel-logo.png, die Kachel mit dem silbernen G-Anker auf Blau,
 * zugeschnitten aus seinem Logo-Bild (701 × 701). Die Ecken ausserhalb der Kachel werden
 * abgerundet weggeschnitten; wo ein Hintergrund nötig ist (iOS, maskierbar), ist er Navy.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

const SRC = 701;
const NAVY = '#080D18';
const logo = `data:image/png;base64,${readFileSync('scripts/brand/grapnel-logo.png').toString('base64')}`;

/** Kachel mit abgerundeten Ecken; scale < 1 lässt Rand (für maskierbare Symbole). */
const svg = ({ scale = 1, background = null, inset = 4, radius = 0.175 } = {}) => {
  const size = SRC * scale;
  const o = (SRC - size) / 2;
  const r = (SRC - 2 * inset) * radius;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SRC}" height="${SRC}" viewBox="0 0 ${SRC} ${SRC}">
  <defs>
    <clipPath id="tile"><rect x="${inset}" y="${inset}" width="${SRC - 2 * inset}" height="${SRC - 2 * inset}" rx="${r}"/></clipPath>
  </defs>
  ${background ? `<rect width="${SRC}" height="${SRC}" fill="${background}"/>` : ''}
  <g transform="translate(${o} ${o}) scale(${scale})">
    <image href="${logo}" width="${SRC}" height="${SRC}" clip-path="url(#tile)"/>
  </g>
</svg>`;
};

const render = (source, size, file) => {
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(file, png);
  console.log(`${file} (${size}px, ${png.length} Bytes)`);
};

mkdirSync('public/icons', { recursive: true });
mkdirSync('src/ui/assets', { recursive: true });
// iOS rundet selbst ab und füllt Transparenz schwarz: darum voller Navy-Hintergrund.
render(svg({ background: NAVY, inset: 0, radius: 0 }), 180, 'public/apple-touch-icon.png');
render(svg(), 192, 'public/icons/icon-192.png');
render(svg(), 512, 'public/icons/icon-512.png');
// Maskierbar: Kachel innerhalb der sicheren Zone (80 %), Rest Navy.
render(svg({ scale: 0.8, background: NAVY }), 512, 'public/icons/maskable-512.png');
render(svg(), 64, 'public/favicon.png');
// In der App: Seitenleiste, Ladebild, leere Zustände (höchstens etwa 120 px gross, also 3×).
render(svg(), 384, 'src/ui/assets/grapnel-logo.png');
