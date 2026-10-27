import type { Settings } from '../settings';
import { applyGrade, sortLogs, stateKey } from '../srs/scheduler';
import { isAutoDifficult, isDueToday, MASTERED_STABILITY_DAYS, STATUS_RANK, statusOf, strongestState, type CardStatus } from '../srs/status';
import type { Card, CardState, Direction, DirectionChoice, FsrsData, ReviewLog, Session } from '../types';
import { addDays, dayKey, endOfDay, lastDays } from '../util/time';

/**
 * Kennzahlen aus gespeicherten Daten. Gibt es keine Daten, gibt es keine Zahl: Leere
 * Tage bleiben leer, eine Quote ohne Antworten ist null, nicht 0 %.
 */

/** Logs ohne die durch eine Korrektur ersetzten Einträge. */
export function effectiveLogs(logs: ReviewLog[]): ReviewLog[] {
  const replaced = new Set(logs.map((l) => l.replaces).filter((x): x is string => !!x));
  return logs.filter((l) => !replaced.has(l.id));
}

export interface SetStats {
  total: number;
  new: number;
  learning: number;
  review: number;
  mastered: number;
  difficult: number;
  flagged: number;
  dueToday: number;
  lastActivity: number | null;
}

const DIRECTIONS: Direction[] = ['f2b', 'b2f'];

/** Lernstände einer Karte in der gewählten Ansicht: eine Richtung oder beide. */
export function statesFor(states: Map<string, CardState>, cardId: string, view: DirectionChoice): (CardState | undefined)[] {
  return (view === 'both' ? DIRECTIONS : [view]).map((d) => states.get(stateKey(cardId, d)));
}

/**
 * Kennzahlen eines Sets. Bei «beide» zählt jede Karte mit ihrer weiter fortgeschrittenen
 * Richtung; schwierig und fällig ist sie, sobald es eine Richtung ist.
 */
export function setStats(cards: Card[], states: Map<string, CardState>, view: DirectionChoice, now = Date.now()): SetStats {
  const s: SetStats = { total: cards.length, new: 0, learning: 0, review: 0, mastered: 0, difficult: 0, flagged: 0, dueToday: 0, lastActivity: null };
  for (const c of cards) {
    const list = statesFor(states, c.id, view);
    s[statusOf(strongestState(list))]++;
    if (list.some((st) => isAutoDifficult(st))) s.difficult++;
    if (c.flagDifficult || c.flagImportant) s.flagged++;
    if (list.some((st) => isDueToday(st, now))) s.dueToday++;
    for (const st of list) if (st?.lastAt && (s.lastActivity === null || st.lastAt > s.lastActivity)) s.lastActivity = st.lastAt;
  }
  return s;
}

export interface DayActivity {
  day: string;
  answers: number;
  correct: number;
  /** null, wenn an diesem Tag nichts beantwortet wurde. */
  accuracy: number | null;
}

export function activityByDay(logs: ReviewLog[], days: string[]): DayActivity[] {
  const map = new Map<string, { answers: number; correct: number }>();
  for (const l of effectiveLogs(logs)) {
    if (l.result === 'skipped') continue;
    const d = dayKey(l.at);
    const e = map.get(d) ?? { answers: 0, correct: 0 };
    e.answers++;
    if (l.result === 'correct' || l.result === 'almost') e.correct++;
    map.set(d, e);
  }
  return days.map((day) => {
    const e = map.get(day);
    return { day, answers: e?.answers ?? 0, correct: e?.correct ?? 0, accuracy: e && e.answers ? e.correct / e.answers : null };
  });
}

export interface Streak {
  current: number;
  longest: number;
  studiedToday: boolean;
  days: number;
}

/** Lernserie aus Tagen mit mindestens einer Antwort. Heute zählt mit, sobald gelernt wurde. */
export function streakOf(logs: ReviewLog[], now = Date.now()): Streak {
  const days = new Set(effectiveLogs(logs).filter((l) => l.result !== 'skipped').map((l) => dayKey(l.at)));
  const today = dayKey(now);
  const studiedToday = days.has(today);
  let current = 0;
  let cursor = studiedToday ? now : addDays(now, -1);
  while (days.has(dayKey(cursor))) {
    current++;
    cursor = addDays(cursor, -1);
  }
  const sorted = Array.from(days).sort();
  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const d of sorted) {
    if (prev && dayKey(addDays(new Date(`${prev}T12:00:00`).getTime(), 1)) === d) run++;
    else run = 1;
    longest = Math.max(longest, run);
    prev = d;
  }
  return { current, longest, studiedToday, days: days.size };
}

export interface Overall {
  sessionsDone: number;
  answers: number;
  correct: number;
  accuracy: number | null;
}

export function overall(logs: ReviewLog[], sessions: Session[]): Overall {
  const counted = effectiveLogs(logs).filter((l) => l.result !== 'skipped');
  const correct = counted.filter((l) => l.result === 'correct' || l.result === 'almost').length;
  return {
    sessionsDone: sessions.filter((s) => s.status === 'done').length,
    answers: counted.length,
    correct,
    accuracy: counted.length ? correct / counted.length : null,
  };
}

export interface MissedCard {
  cardId: string;
  wrong: number;
  total: number;
}

export function mostMissed(logs: ReviewLog[], limit = 10): MissedCard[] {
  const map = new Map<string, MissedCard>();
  for (const l of effectiveLogs(logs)) {
    if (l.result === 'skipped') continue;
    const e = map.get(l.cardId) ?? { cardId: l.cardId, wrong: 0, total: 0 };
    e.total++;
    if (l.result === 'wrong') e.wrong++;
    map.set(l.cardId, e);
  }
  return Array.from(map.values())
    .filter((e) => e.wrong > 0)
    .sort((a, b) => b.wrong - a.wrong || b.wrong / b.total - a.wrong / a.total)
    .slice(0, limit);
}

/** Fällige Karten der nächsten Tage, aus den gespeicherten Fälligkeiten. Überfälliges zählt zu heute. */
export function forecast(states: CardState[], now = Date.now(), days = 14): { day: string; count: number }[] {
  const keys = lastDays(addDays(now, days - 1), days);
  const counts = new Map(keys.map((k) => [k, 0]));
  const today = keys[0];
  for (const st of states) {
    if (st.fsrs.state === 0) continue;
    const k = st.due <= endOfDay(now) ? today : dayKey(st.due);
    if (counts.has(k)) counts.set(k, counts.get(k)! + 1);
  }
  return keys.map((day) => ({ day, count: counts.get(day)! }));
}

export type StatusCounts = Record<CardStatus, number>;

/**
 * Entwicklung des Lernstands: für jeden Tag, wie viele Karten am Abend neu, im Lernen,
 * in Wiederholung oder sicher waren. Berechnet durch Nachspielen des Verlaufs.
 */
export function progressOverTime(cards: Card[], logs: ReviewLog[], view: DirectionChoice, settings: Settings, now = Date.now(), days = 30): ({ day: string } & StatusCounts)[] {
  const dayList = lastDays(now, days);
  const ends = dayList.map((d) => endOfDay(new Date(`${d}T12:00:00`).getTime()));
  const dirs = view === 'both' ? DIRECTIONS : [view];
  const byKey = new Map<string, ReviewLog[]>();
  for (const l of effectiveLogs(logs)) {
    if (!dirs.includes(l.direction)) continue;
    const key = stateKey(l.cardId, l.direction);
    byKey.set(key, [...(byKey.get(key) ?? []), l]);
  }
  const rows = dayList.map((day) => ({ day, new: 0, learning: 0, review: 0, mastered: 0 }));
  for (const card of cards) {
    // Je Richtung eine Zeitreihe; pro Tag zählt die weiter fortgeschrittene (wie in setStats).
    const timelines = dirs.map((d) => timelineOf(byKey.get(stateKey(card.id, d)) ?? [], settings));
    const pos = timelines.map(() => -1);
    ends.forEach((end, i) => {
      if (card.createdAt > end) return;
      let best: CardStatus = 'new';
      timelines.forEach((tl, j) => {
        while (pos[j] + 1 < tl.length && tl[pos[j] + 1].at <= end) pos[j]++;
        const st = pos[j] >= 0 ? tl[pos[j]].status : 'new';
        if (STATUS_RANK[st] > STATUS_RANK[best]) best = st;
      });
      rows[i][best]++;
    });
  }
  return rows;
}

function timelineOf(logs: ReviewLog[], settings: Settings): { at: number; status: CardStatus }[] {
  const timeline: { at: number; status: CardStatus }[] = [];
  let f: FsrsData | null = null;
  let lastResult: ReviewLog['result'] | null = null;
  for (const l of sortLogs(logs)) {
    if (l.rating !== null) f = applyGrade(f, l.rating, l.at, settings.srs);
    if (l.result !== 'skipped') lastResult = l.result;
    let status: CardStatus = 'new';
    if (f && f.state !== 0) {
      if (f.state === 1 || f.state === 3) status = 'learning';
      else status = f.stability >= MASTERED_STABILITY_DAYS && lastResult !== 'wrong' ? 'mastered' : 'review';
    }
    timeline.push({ at: l.at, status });
  }
  return timeline;
}

/** Erster Tag mit Aktivität (für sinnvolle Zeitachsen ohne leere Vorgeschichte). */
export function firstActivity(logs: ReviewLog[]): number | null {
  let min: number | null = null;
  for (const l of logs) if (min === null || l.at < min) min = l.at;
  return min;
}
