import { memo } from 'react';

/**
 * Eigene Juwelen-Symbole als SVG (24er-Raster). Jede Form wird aus ihren Eckpunkten
 * geschliffen: eine helle Tafel in der Mitte und Facetten, deren Helligkeit sich nach
 * einem Licht oben links richtet. So teilen alle Juwelen dieselbe Formensprache und
 * bleiben in jeder Grösse scharf. Die Farbe kommt über currentColor aus dem CSS
 * (hell und dunkel), Licht und Schatten sind weiss bzw. schwarz mit Deckkraft.
 */

type P = readonly [number, number];

interface Cut {
  outline: string;
  table: string;
  facets: { d: string; light: boolean; alpha: number }[];
  sparkle: P;
}

const LIGHT: P = [-0.6, -0.8];
const r2 = (n: number) => Math.round(n * 100) / 100;
const path = (pts: readonly P[]) => `M${pts.map(([x, y]) => `${r2(x)} ${r2(y)}`).join('L')}Z`;

function regular(n: number, r: number, rotDeg: number, cx = 12, cy = 12): P[] {
  return Array.from({ length: n }, (_, i) => {
    const a = ((rotDeg + (360 / n) * i) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  });
}

function star(points: number, outer: number, inner: number, cx = 12, cy = 12): P[] {
  return Array.from({ length: points * 2 }, (_, i) => {
    const a = ((-90 + (180 / points) * i) * Math.PI) / 180;
    const r = i % 2 ? inner : outer;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  });
}

function cut(points: readonly P[], center: P = [12, 12], k = 0.5): Cut {
  const [cx, cy] = center;
  const table = points.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as const);
  const facets = points.map((p, i) => {
    const q = points[(i + 1) % points.length];
    const mx = (p[0] + q[0]) / 2 - cx;
    const my = (p[1] + q[1]) / 2 - cy;
    const len = Math.hypot(mx, my) || 1;
    const b = (mx * LIGHT[0] + my * LIGHT[1]) / len;
    return { d: path([p, q, table[(i + 1) % points.length], table[i]]), light: b > 0, alpha: r2(b > 0 ? 0.08 + 0.34 * b : 0.05 + 0.24 * -b) };
  });
  // Glanzpunkt: auf der Tafel, zum Licht hin versetzt.
  const sparkle: P = [cx + LIGHT[0] * 3.2 * (k / 0.5), cy + LIGHT[1] * 3.2 * (k / 0.5)];
  return { outline: path(points), table: path(table), facets, sparkle };
}

const HEART: P[] = [
  [12, 21.2],
  [3.4, 12.6],
  [2.2, 8.6],
  [3.6, 5],
  [7.2, 3.3],
  [10.4, 4.2],
  [12, 6.4],
  [13.6, 4.2],
  [16.8, 3.3],
  [20.4, 5],
  [21.8, 8.6],
  [20.6, 12.6],
];

/** Index = Juwelenfarbe (0…5): Herz, Stern, Sechseck, Raute, Dreieck, Rundschliff. */
export const CUTS: Cut[] = [
  cut(HEART, [12, 10.8], 0.46),
  cut(star(5, 10.6, 4.9, 12, 12.8), [12, 12.8], 0.5),
  cut(regular(6, 10.2, -90), [12, 12], 0.52),
  cut(
    [
      [12, 1.6],
      [21.6, 12],
      [12, 22.4],
      [2.4, 12],
    ],
    [12, 12],
    0.5,
  ),
  cut(
    [
      [12, 2.4],
      [22, 20.6],
      [2, 20.6],
    ],
    [12, 14.6],
    0.46,
  ),
  cut(regular(12, 10.3, -75), [12, 12], 0.56),
];

const STONE = cut(
  [
    [5.2, 5.4],
    [12, 2.6],
    [19.2, 5],
    [21.6, 12.6],
    [17.8, 20.4],
    [8.4, 21.6],
    [2.6, 14.6],
  ],
  [12, 12.2],
  0.5,
);

function sparklePath([x, y]: P, s = 1.7): string {
  const q = s * 0.22;
  return `M${r2(x)} ${r2(y - s)}Q${r2(x + q)} ${r2(y - q)} ${r2(x + s)} ${r2(y)}Q${r2(x + q)} ${r2(y + q)} ${r2(x)} ${r2(y + s)}Q${r2(x - q)} ${r2(y + q)} ${r2(x - s)} ${r2(y)}Q${r2(x - q)} ${r2(y - q)} ${r2(x)} ${r2(y - s)}Z`;
}

function CutShape({ c, sparkle = true }: { c: Cut; sparkle?: boolean }) {
  return (
    <>
      <path d={c.outline} fill="currentColor" />
      {c.facets.map((f, i) => (
        <path key={i} d={f.d} fill={f.light ? '#fff' : '#000'} fillOpacity={f.alpha} />
      ))}
      <path d={c.table} fill="#fff" fillOpacity={0.14} />
      <path d={c.outline} fill="none" className="gem-edge" strokeWidth={0.7} strokeLinejoin="round" />
      {sparkle && <path d={sparklePath(c.sparkle)} fill="#fff" fillOpacity={0.92} />}
    </>
  );
}

export const GemArt = memo(function GemArt({ color }: { color: number }) {
  return (
    <svg className="gem-art" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <CutShape c={CUTS[color] ?? CUTS[5]} />
    </svg>
  );
});

export const StoneArt = memo(function StoneArt() {
  return (
    <svg className="gem-art" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <CutShape c={STONE} sparkle={false} />
      <path d="M12 6.6 13.4 10.6 11.6 13 13.2 17.4" fill="none" stroke="#000" strokeOpacity={0.3} strokeWidth={0.8} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
});

/**
 * Bombe: runder Körper in der Juwelenfarbe (sie zählt weiter als diese Farbe), Metallkappe,
 * geschwungene Zündschnur mit Funke. Die kleine Form im Körper hält die Farbe auch ohne
 * Farbsehen erkennbar.
 */
export const BombArt = memo(function BombArt({ color }: { color: number }) {
  const glyph = CUTS[color] ?? CUTS[5];
  return (
    <svg className="gem-art bomb-art" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="11" cy="13.6" r="8.2" fill="currentColor" />
      <circle cx="11" cy="13.6" r="8.2" fill="url(#gems-bomb-shade)" />
      <circle cx="11" cy="13.6" r="8.2" fill="none" className="gem-edge" strokeWidth={0.7} />
      <ellipse cx="7.9" cy="10.4" rx="2.6" ry="1.6" transform="rotate(-38 7.9 10.4)" fill="#fff" fillOpacity={0.5} />
      <path d={glyph.outline} transform="translate(7.04 9.64) scale(0.33)" fill="#fff" fillOpacity={0.9} />
      <rect x="14.1" y="4.3" width="4.6" height="3.4" rx="1" transform="rotate(42 16.4 6)" className="bomb-cap" />
      <path d="M17.3 4.5c.6-1.4 1.7-2 3-1.6" fill="none" className="bomb-fuse" strokeWidth={1.2} strokeLinecap="round" />
      <g className="bomb-spark">
        <path d={sparklePath([20.6, 3], 2)} fill="#ffb224" />
        <circle cx="20.6" cy="3" r="0.75" fill="#fff" />
      </g>
    </svg>
  );
});

/** Gemeinsame Verläufe; einmal pro Spielfeld eingebunden. */
export function GemDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="gems-bomb-shade" cx="0.32" cy="0.28" r="0.85">
          <stop offset="0.35" stopColor="#000" stopOpacity="0" />
          <stop offset="1" stopColor="#000" stopOpacity="0.42" />
        </radialGradient>
      </defs>
    </svg>
  );
}

const PARTICLES = Array.from({ length: 12 }, (_, i) => ({ a: i * 30 + (i % 2 ? 9 : -6), d: i % 3 === 0 ? 1.55 : i % 3 === 1 ? 1.25 : 1.05 }));

/**
 * Explosion an einer Bombe: heller Kern, Druckwelle und Funken, alles nur über transform
 * und opacity. Liegt in einer eigenen Ebene über dem Feld und verschiebt nichts.
 */
export function BlastEffect({ index, size, color }: { index: number; size: number; color: number }) {
  const r = Math.floor(index / size);
  const c = index % size;
  return (
    <div className={`blast c${color}`} style={{ transform: `translate(${c * 100}%, ${r * 100}%)` }} aria-hidden="true">
      <span className="blast-ring" />
      <span className="blast-core" />
      {PARTICLES.map((p, i) => (
        <span key={i} className="blast-spark" style={{ ['--a' as string]: `${p.a}deg`, ['--d' as string]: p.d }} />
      ))}
    </div>
  );
}
