import { endOfDay } from '../util/time';
import type { CardState } from '../types';

/**
 * Lernstatus einer Karte, abgeleitet aus dem FSRS-Zustand. Bewusst streng:
 * «Sicher» erst, wenn die Erinnerung voraussichtlich mindestens drei Wochen hält.
 * Eine einzelne richtige Antwort macht eine Karte also nie zu «Sicher».
 */
export type CardStatus = 'new' | 'learning' | 'review' | 'mastered';

export const MASTERED_STABILITY_DAYS = 21;

export function statusOf(s: CardState | undefined | null): CardStatus {
  if (!s || s.fsrs.state === 0) return 'new';
  if (s.fsrs.state === 1 || s.fsrs.state === 3) return 'learning';
  if (s.fsrs.stability >= MASTERED_STABILITY_DAYS && s.lastResult !== 'wrong') return 'mastered';
  return 'review';
}

export const STATUS_RANK: Record<CardStatus, number> = { new: 0, learning: 1, review: 2, mastered: 3 };

/**
 * Für die Ansicht «Beide Richtungen»: Eine Karte zählt so weit, wie sie in mindestens einer
 * Richtung ist. Sonst bliebe zum Beispiel Schreiben von Deutsch nach Französisch unsichtbar,
 * solange die Übersicht nur Französisch nach Deutsch zeigt.
 */
export function strongestState(list: (CardState | undefined)[]): CardState | undefined {
  let best: CardState | undefined;
  for (const s of list) {
    if (!s) continue;
    const diff = best ? STATUS_RANK[statusOf(s)] - STATUS_RANK[statusOf(best)] : 1;
    if (diff > 0 || (diff === 0 && s.fsrs.stability > best!.fsrs.stability)) best = s;
  }
  return best;
}

/** Schon gelernt und jetzt fällig. Lernschritte (Minuten) genau, Wiederholungen tageweise. */
export function isDueNow(s: CardState | undefined | null, now: number): boolean {
  if (!s || s.fsrs.state === 0) return false;
  if (s.fsrs.state === 2) return s.due <= endOfDay(now);
  return s.due <= now;
}

/** Fällig im Lauf des heutigen Tages (für Zähler auf der Startseite). */
export function isDueToday(s: CardState | undefined | null, now: number): boolean {
  if (!s || s.fsrs.state === 0) return false;
  return s.due <= endOfDay(now);
}

/**
 * Automatisch ermittelte Schwierigkeit, unabhängig von der persönlichen Markierung.
 * Schwierig ist, was mehrmals vergessen wurde, was FSRS als schwer einstuft oder was
 * deutlich öfter falsch als richtig beantwortet wurde.
 */
export function isAutoDifficult(s: CardState | undefined | null): boolean {
  if (!s) return false;
  const total = s.correct + s.wrong;
  if (s.fsrs.lapses >= 3) return true;
  if (s.fsrs.reps >= 3 && s.fsrs.difficulty >= 8) return true;
  return s.wrong >= 3 && total > 0 && s.wrong / total >= 0.4;
}

export function lastWasWrong(s: CardState | undefined | null): boolean {
  return !!s && s.lastResult === 'wrong';
}
