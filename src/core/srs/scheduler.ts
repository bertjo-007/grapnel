import { createEmptyCard, fsrs, generatorParameters, type Card as FCard, type FSRS } from 'ts-fsrs';
import type { SrsSettings } from '../settings';
import type { AnswerResult, CardState, Direction, FsrsData, Grade, ReviewLog } from '../types';

/**
 * Dünne Schicht über ts-fsrs. Grapnel speichert Daten als Zahlen (ms), ts-fsrs rechnet
 * mit Date-Objekten. Die Planung ist deterministisch: gleiche Logs ergeben auf jedem
 * Gerät denselben Zustand. Darauf baut der Sync (Verlauf vereinigen, neu berechnen).
 */

let cached: { key: string; f: FSRS } | null = null;

function scheduler(s: SrsSettings): FSRS {
  const key = `${s.retention}|${s.maxIntervalDays}`;
  if (!cached || cached.key !== key) {
    cached = {
      key,
      f: fsrs(
        generatorParameters({
          request_retention: s.retention,
          maximum_interval: s.maxIntervalDays,
          enable_fuzz: true,
          enable_short_term: true,
        }),
      ),
    };
  }
  return cached.f;
}

export function emptyFsrs(now: number): FsrsData {
  return fromF(createEmptyCard(new Date(now)));
}

function toF(d: FsrsData): FCard {
  return {
    due: new Date(d.due),
    stability: d.stability,
    difficulty: d.difficulty,
    elapsed_days: d.elapsed_days,
    scheduled_days: d.scheduled_days,
    learning_steps: d.learning_steps,
    reps: d.reps,
    lapses: d.lapses,
    state: d.state,
    last_review: d.last_review === null ? undefined : new Date(d.last_review),
  } as FCard;
}

function fromF(c: FCard): FsrsData {
  return {
    due: c.due.getTime(),
    stability: c.stability,
    difficulty: c.difficulty,
    elapsed_days: c.elapsed_days,
    scheduled_days: c.scheduled_days,
    learning_steps: c.learning_steps ?? 0,
    reps: c.reps,
    lapses: c.lapses,
    state: c.state as FsrsData['state'],
    last_review: c.last_review ? new Date(c.last_review).getTime() : null,
  };
}

export function applyGrade(data: FsrsData | null, grade: Grade, at: number, s: SrsSettings): FsrsData {
  const base = data ?? emptyFsrs(at);
  // Ein Log, das (z. B. nach einem Sync) älter ist als die letzte Wiederholung, darf
  // die Zeit nicht rückwärts laufen lassen.
  const when = base.last_review !== null && at < base.last_review ? base.last_review : at;
  return fromF(scheduler(s).next(toF(base), new Date(when), grade).card);
}

/** Zeit bis zur nächsten Fälligkeit für jede Bewertung (für die Beschriftung der Knöpfe). */
export function previewIntervals(data: FsrsData | null, now: number, s: SrsSettings): Record<Grade, number> {
  const base = data ?? emptyFsrs(now);
  const rec = scheduler(s).repeat(toF(base), new Date(now));
  const out = {} as Record<Grade, number>;
  for (const g of [1, 2, 3, 4] as Grade[]) out[g] = Math.max(0, rec[g].card.due.getTime() - now);
  return out;
}

export function stateKey(cardId: string, direction: Direction): string {
  return `${cardId}:${direction}`;
}

/** Zählt ein Ergebnis als richtig für die Statistik? «Fast richtig» zählt als richtig. */
export function isCorrect(r: AnswerResult): boolean {
  return r === 'correct' || r === 'almost';
}

/** Sortiert Logs stabil nach Zeit, bei Gleichstand nach ID (gleich auf allen Geräten). */
export function sortLogs(logs: ReviewLog[]): ReviewLog[] {
  return logs.slice().sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Berechnet den Lernstand einer Karte in einer Richtung vollständig aus ihren Logs. */
export function replay(
  cardId: string,
  setId: string,
  direction: Direction,
  logs: ReviewLog[],
  s: SrsSettings,
): CardState | null {
  const own = logs.filter((l) => l.cardId === cardId && l.direction === direction);
  const replaced = new Set(own.map((l) => l.replaces).filter((x): x is string => !!x));
  const mine = sortLogs(own.filter((l) => !replaced.has(l.id)));
  if (mine.length === 0) return null;
  let f: FsrsData | null = null;
  let correct = 0;
  let wrong = 0;
  let lastResult: AnswerResult | null = null;
  let lastAt: number | null = null;
  for (const l of mine) {
    if (l.rating !== null) f = applyGrade(f, l.rating, l.at, s);
    if (l.result !== 'skipped') {
      if (isCorrect(l.result)) correct++;
      else wrong++;
      lastResult = l.result;
      lastAt = l.at;
    }
  }
  const fsrsData = f ?? emptyFsrs(mine[0].at);
  return {
    key: stateKey(cardId, direction),
    cardId,
    setId,
    direction,
    fsrs: fsrsData,
    due: fsrsData.due,
    correct,
    wrong,
    lastResult,
    lastAt,
  };
}
