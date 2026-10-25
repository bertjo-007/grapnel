import type { Grade } from '../types';
import { createRng, shuffle } from '../util/rng';

/**
 * Karteikarten: durchblättern, umdrehen, selbst bewerten. Die Bewertung fliesst in die
 * Planung ein. «Nochmals üben» startet eine neue Runde mit den nicht gewussten Karten.
 */

export interface FlashState {
  kind: 'flash';
  seed: number;
  step: number;
  /** Ursprüngliche Reihenfolge der aktuellen Runde (für «Reihenfolge umkehren»). */
  base: string[];
  order: string[];
  index: number;
  round: number;
  /** Letzte Bewertung je Karte in dieser Runde. */
  ratings: Record<string, Grade>;
  /** Alle Bewertungen der Sitzung (für die Zusammenfassung). */
  history: { key: string; grade: Grade }[];
  shuffled: boolean;
  reversed: boolean;
  done: boolean;
}

export function createFlash(keys: string[], mix: boolean, seed: number): FlashState {
  const s: FlashState = {
    kind: 'flash',
    seed,
    step: 0,
    base: keys.slice(),
    order: keys.slice(),
    index: 0,
    round: 1,
    ratings: {},
    history: [],
    shuffled: false,
    reversed: false,
    done: keys.length === 0,
  };
  if (mix) toggleShuffle(s);
  return s;
}

/** Vor der ersten Bewertung wird alles neu geordnet, danach nur die noch nicht gesehenen Karten. */
function keepUntil(s: FlashState): number {
  return s.index === 0 && Object.keys(s.ratings).length === 0 ? 0 : s.index + 1;
}

export function toggleShuffle(s: FlashState): void {
  s.step++;
  s.shuffled = !s.shuffled;
  const keep = keepUntil(s);
  const seen = new Set(s.order.slice(0, keep));
  let rest = s.base.filter((k) => !seen.has(k));
  if (s.shuffled) rest = shuffle(rest, createRng(s.seed + s.step));
  if (s.reversed) rest.reverse();
  s.order = [...s.order.slice(0, keep), ...rest];
}

export function toggleReverse(s: FlashState): void {
  s.reversed = !s.reversed;
  const keep = keepUntil(s);
  s.order = [...s.order.slice(0, keep), ...s.order.slice(keep).reverse()];
}

export function flashRate(s: FlashState, grade: Grade): void {
  const key = s.order[s.index];
  if (!key) return;
  s.ratings[key] = grade;
  s.history.push({ key, grade });
  flashNext(s);
}

export function flashNext(s: FlashState): void {
  if (s.index < s.order.length - 1) s.index++;
  else s.done = true;
}

export function flashPrev(s: FlashState): void {
  if (s.done) s.done = false;
  else if (s.index > 0) s.index--;
}

export function flashUnknown(s: FlashState): string[] {
  return s.order.filter((k) => s.ratings[k] === 1);
}

/** Neue Runde mit den angegebenen Karten (z. B. den nicht gewussten). */
export function flashRestart(s: FlashState, keys: string[]): void {
  s.base = keys.slice();
  s.order = keys.slice();
  s.index = 0;
  s.round++;
  s.ratings = {};
  s.shuffled = false;
  s.reversed = false;
  s.done = keys.length === 0;
}
