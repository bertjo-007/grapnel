import { createRng, shuffle, type Rng } from '../util/rng';
import { mcOptions, parseKey, type Deck } from './deck';

/**
 * Modi «Schreiben» und «Multiple Choice»: jede Karte einmal, falsch beantwortete kommen
 * in der nächsten Runde wieder, bis alle sitzen (oder die Sitzung beendet wird).
 */

export type RoundsTask = { type: 'write'; key: string } | { type: 'mc'; key: string; options: string[] };

export interface RoundsState {
  kind: 'rounds';
  task: 'write' | 'mc';
  seed: number;
  step: number;
  all: string[];
  queue: string[];
  round: number;
  wrong: string[];
  /** Erster Versuch je Karte richtig? */
  first: Record<string, boolean>;
  current: RoundsTask | null;
  roundLog: { key: string; correct: boolean }[];
  betweenRounds: boolean;
  done: boolean;
}

function nextRng(s: RoundsState): Rng {
  s.step++;
  return createRng((s.seed ^ Math.imul(s.step, 2654435761)) >>> 0);
}

export function createRounds(keys: string[], task: 'write' | 'mc', mix: boolean, seed: number): RoundsState {
  const s: RoundsState = {
    kind: 'rounds',
    task,
    seed,
    step: 0,
    all: keys,
    queue: [],
    round: 1,
    wrong: [],
    first: {},
    current: null,
    roundLog: [],
    betweenRounds: false,
    done: keys.length === 0,
  };
  s.queue = mix ? shuffle(keys, nextRng(s)) : keys.slice();
  return s;
}

export function roundsTask(s: RoundsState, deck: Deck): RoundsTask | null {
  if (s.done || s.betweenRounds) return null;
  if (s.current) return s.current;
  while (s.queue.length) {
    const key = s.queue.shift()!;
    if (!deck.card(parseKey(key).c)) continue;
    if (s.task === 'mc') {
      const options = mcOptions(deck, parseKey(key), nextRng(s));
      s.current = options ? { type: 'mc', key, options } : { type: 'write', key };
    } else s.current = { type: 'write', key };
    return s.current;
  }
  if (s.wrong.length) s.betweenRounds = true;
  else s.done = true;
  return null;
}

export function roundsAnswer(s: RoundsState, correct: boolean): void {
  const t = s.current;
  if (!t) return;
  if (s.first[t.key] === undefined) s.first[t.key] = correct;
  if (!correct && !s.wrong.includes(t.key)) s.wrong.push(t.key);
  s.roundLog.push({ key: t.key, correct });
  s.current = null;
}

/** «Ich hatte recht»: letzte Antwort auf diese Karte zählt als richtig. */
export function roundsOverride(s: RoundsState, key: string): void {
  s.wrong = s.wrong.filter((k) => k !== key);
  const log = s.roundLog.findLast((e) => e.key === key);
  if (log && !log.correct) {
    log.correct = true;
    if (s.roundLog.filter((e) => e.key === key).length === 1 && s.round === 1) s.first[key] = true;
  }
  if (s.betweenRounds && s.wrong.length === 0) {
    s.betweenRounds = false;
    s.done = s.queue.length === 0;
  }
}

export function nextRound(s: RoundsState): void {
  s.queue = shuffle(s.wrong, nextRng(s));
  s.wrong = [];
  s.round++;
  s.roundLog = [];
  s.betweenRounds = false;
}

export function roundsProgress(s: RoundsState): { done: number; total: number } {
  const pending = new Set([...s.queue, ...s.wrong, ...(s.current ? [s.current.key] : [])]);
  return { done: s.all.filter((k) => !pending.has(k)).length, total: s.all.length };
}
