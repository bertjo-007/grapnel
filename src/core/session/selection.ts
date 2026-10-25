import { isAutoDifficult, isDueNow, lastWasWrong } from '../srs/status';
import { stateKey } from '../srs/scheduler';
import type { Card, CardState, Direction, DirectionChoice } from '../types';
import { createRng, shuffle } from '../util/rng';
import type { ItemRef } from './deck';

/**
 * Welche Karten in eine Sitzung kommen. Persönliche Markierungen (schwierig, wichtig)
 * und der automatisch ermittelte Lernstand sind getrennte Kriterien.
 */

export type SelectionKind = 'all' | 'new' | 'difficult' | 'wrong' | 'due' | 'flagged' | 'random' | 'manual';

export interface SelectionInput {
  kind: SelectionKind;
  direction: DirectionChoice;
  tags?: string[];
  flag?: 'difficult' | 'important' | 'any';
  randomCount?: number;
  manualIds?: string[];
  seed?: number;
}

export function directionsOf(choice: DirectionChoice): Direction[] {
  return choice === 'both' ? ['f2b', 'b2f'] : [choice];
}

function matches(kind: SelectionKind, card: Card, st: CardState | undefined, now: number, flag: SelectionInput['flag']): boolean {
  switch (kind) {
    case 'all':
    case 'random':
    case 'manual':
      return true;
    case 'new':
      return !st || st.fsrs.state === 0;
    case 'due':
      return isDueNow(st, now);
    case 'difficult':
      return isAutoDifficult(st);
    case 'wrong':
      return lastWasWrong(st);
    case 'flagged':
      if (flag === 'difficult') return card.flagDifficult;
      if (flag === 'important') return card.flagImportant;
      return card.flagDifficult || card.flagImportant;
  }
}

/** Liefert die Einträge (Karte + Richtung) in Set-Reihenfolge, bei «zufällig» gemischt. */
export function selectItems(cards: Card[], states: Map<string, CardState>, input: SelectionInput, now = Date.now()): ItemRef[] {
  const dirs = directionsOf(input.direction);
  const manual = input.kind === 'manual' ? new Set(input.manualIds ?? []) : null;
  const tags = input.tags?.length ? new Set(input.tags) : null;
  const out: ItemRef[] = [];
  for (const card of cards) {
    if (manual && !manual.has(card.id)) continue;
    if (tags && !card.tags.some((t) => tags.has(t))) continue;
    for (const d of dirs) {
      const st = states.get(stateKey(card.id, d));
      if (matches(input.kind, card, st, now, input.flag)) out.push({ c: card.id, d });
    }
  }
  if (input.kind === 'random') {
    const n = Math.max(1, input.randomCount ?? 20);
    return shuffle(out, createRng(input.seed ?? 1)).slice(0, n);
  }
  return out;
}

export interface SelectionCounts {
  all: number;
  new: number;
  due: number;
  difficult: number;
  wrong: number;
  flagged: number;
}

/** Zähler für die Auswahl-Ansicht, damit leere Kriterien sofort sichtbar sind. */
export function countSelections(cards: Card[], states: Map<string, CardState>, direction: DirectionChoice, now = Date.now()): SelectionCounts {
  const count = (kind: SelectionKind) => selectItems(cards, states, { kind, direction, flag: 'any' }, now).length;
  return { all: count('all'), new: count('new'), due: count('due'), difficult: count('difficult'), wrong: count('wrong'), flagged: count('flagged') };
}

/** Nächste Fälligkeit nach jetzt (für «Nichts fällig, nächste Wiederholung in …»). */
export function nextDue(cards: Card[], states: Map<string, CardState>, direction: DirectionChoice, now = Date.now()): number | null {
  let best: number | null = null;
  for (const card of cards) {
    for (const d of directionsOf(direction)) {
      const st = states.get(stateKey(card.id, d));
      if (!st || st.fsrs.state === 0 || st.due <= now) continue;
      if (best === null || st.due < best) best = st.due;
    }
  }
  return best;
}
