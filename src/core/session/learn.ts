import { isAutoDifficult, isDueNow, lastWasWrong } from '../srs/status';
import { createRng, randInt, shuffle, type Rng } from '../util/rng';
import { itemKey, mcOptions, parseKey, trueFalse, type Deck, type ItemRef } from './deck';

/**
 * Modus «Lernen» (und «Gemischt»): passt sich dem Lernstand an.
 *
 * Eine Sitzung läuft in Runden. Jede Runde nimmt bis zu `roundSize` Karten, davon höchstens
 * `newPerRound` neue, damit Neues in überschaubaren Mengen kommt. Jede Karte durchläuft
 * Stufen: erst erkennen (Multiple Choice), dann abrufen (Schreiben). Wer falsch antwortet,
 * fällt eine Stufe zurück und kommt 3 bis 6 Aufgaben später wieder, nie direkt danach
 * (ausser es ist nur noch diese Karte übrig). Fertig ist eine Karte nach einem richtigen
 * Abruf, schwierige Karten im gemischten Modus nach zwei.
 *
 * Reihenfolge der Karten: zuerst fällige (am längsten überfällige zuerst), dann solche,
 * die zuletzt falsch waren oder noch in Lernschritten stecken, dann neue, zuletzt bekannte.
 */

export type Stage = 'mc' | 'write' | 'done';

export type LearnTask =
  | { type: 'mc'; key: string; options: string[] }
  | { type: 'write'; key: string }
  | { type: 'flashcard'; key: string }
  | { type: 'truefalse'; key: string; shownCardId: string; truth: boolean };

export interface LearnItem {
  key: string;
  stage: Stage;
  needed: number;
  got: number;
  isNew: boolean;
  wrong: number;
  attempts: number;
  firstResult: boolean | null;
}

export interface LearnState {
  kind: 'learn';
  variant: 'learn' | 'mixed';
  seed: number;
  step: number;
  items: Record<string, LearnItem>;
  order: string[];
  pool: string[];
  active: string[];
  queue: string[];
  round: number;
  roundSize: number;
  newPerRound: number;
  lastKey: string | null;
  current: LearnTask | null;
  roundLog: { key: string; correct: boolean }[];
  betweenRounds: boolean;
  done: boolean;
}

export interface LearnOptions {
  variant: 'learn' | 'mixed';
  roundSize: number;
  /** Höchstens so viele neue Karten in dieser Sitzung. */
  newLimit: number;
  seed: number;
  now?: number;
}

function nextRng(s: LearnState): Rng {
  s.step++;
  return createRng((s.seed ^ Math.imul(s.step, 2654435761)) >>> 0);
}

export function createLearn(deck: Deck, refs: ItemRef[], o: LearnOptions): LearnState {
  const now = o.now ?? Date.now();
  const due: ItemRef[] = [];
  const shaky: ItemRef[] = [];
  const fresh: ItemRef[] = [];
  const known: ItemRef[] = [];
  for (const r of refs) {
    const st = deck.state(r);
    if (!st || st.fsrs.state === 0) fresh.push(r);
    else if (isDueNow(st, now)) due.push(r);
    else if (st.fsrs.state !== 2 || lastWasWrong(st) || isAutoDifficult(st)) shaky.push(r);
    else known.push(r);
  }
  due.sort((a, b) => (deck.state(a)?.due ?? 0) - (deck.state(b)?.due ?? 0));
  const ordered = [...due, ...shaky, ...fresh.slice(0, Math.max(0, o.newLimit)), ...known];

  const items: Record<string, LearnItem> = {};
  for (const r of ordered) {
    const st = deck.state(r);
    const card = deck.card(r.c);
    const isNew = !st || st.fsrs.state === 0;
    const startsEasy = !isNew && st!.fsrs.state === 2 && !lastWasWrong(st) && !isAutoDifficult(st);
    const hard = isAutoDifficult(st) || !!card?.flagDifficult;
    items[itemKey(r)] = {
      key: itemKey(r),
      stage: startsEasy ? 'write' : 'mc',
      needed: o.variant === 'mixed' && hard ? 2 : 1,
      got: 0,
      isNew,
      wrong: 0,
      attempts: 0,
      firstResult: null,
    };
  }
  const state: LearnState = {
    kind: 'learn',
    variant: o.variant,
    seed: o.seed,
    step: 0,
    items,
    order: ordered.map(itemKey),
    pool: ordered.map(itemKey),
    active: [],
    queue: [],
    round: 0,
    roundSize: Math.max(2, o.roundSize),
    newPerRound: Math.max(1, Math.ceil(o.roundSize / 2)),
    lastKey: null,
    current: null,
    roundLog: [],
    betweenRounds: false,
    done: ordered.length === 0,
  };
  if (!state.done) startRound(state);
  return state;
}

export function startRound(s: LearnState): void {
  const rng = nextRng(s);
  s.active = s.active.filter((k) => s.items[k].stage !== 'done');
  let newCount = s.active.filter((k) => s.items[k].isNew && s.items[k].attempts === 0).length;
  const rest: string[] = [];
  for (const k of s.pool) {
    if (s.active.length >= s.roundSize) {
      rest.push(k);
      continue;
    }
    const isFreshNew = s.items[k].isNew;
    if (isFreshNew && newCount >= s.newPerRound) {
      rest.push(k);
      continue;
    }
    if (isFreshNew) newCount++;
    s.active.push(k);
  }
  s.pool = rest;
  s.queue = shuffle(s.active, rng);
  if (s.queue.length > 1 && s.queue[0] === s.lastKey) [s.queue[0], s.queue[1]] = [s.queue[1], s.queue[0]];
  s.round++;
  s.roundLog = [];
  s.betweenRounds = false;
}

function allDone(s: LearnState): boolean {
  return s.pool.length === 0 && Object.values(s.items).every((i) => i.stage === 'done');
}

/** Aktuelle Aufgabe; erzeugt bei Bedarf die nächste. null = Rundenpause oder fertig. */
export function learnTask(s: LearnState, deck: Deck): LearnTask | null {
  if (s.done || s.betweenRounds) return null;
  if (s.current) return s.current;
  while (s.queue.length) {
    const key = s.queue.shift()!;
    const item = s.items[key];
    if (!item || item.stage === 'done' || !deck.card(parseKey(key).c)) continue;
    const rng = nextRng(s);
    const ref = parseKey(key);
    let task: LearnTask;
    if (item.stage === 'mc') {
      const useTf = s.variant === 'mixed' && rng() < 0.4;
      if (useTf) {
        task = { type: 'truefalse', key, ...trueFalse(deck, ref, rng) };
      } else {
        const options = mcOptions(deck, ref, rng);
        if (options) task = { type: 'mc', key, options };
        else {
          item.stage = 'write';
          task = { type: 'write', key };
        }
      }
    } else {
      task = s.variant === 'mixed' && rng() < 0.35 ? { type: 'flashcard', key } : { type: 'write', key };
    }
    s.current = task;
    s.lastKey = key;
    return task;
  }
  if (allDone(s)) s.done = true;
  else s.betweenRounds = true;
  return null;
}

/** Verbucht das Ergebnis der aktuellen Aufgabe. */
export function learnAnswer(s: LearnState, correct: boolean): void {
  const task = s.current;
  if (!task) return;
  const item = s.items[task.key];
  item.attempts++;
  if (item.firstResult === null) item.firstResult = correct;
  s.roundLog.push({ key: task.key, correct });
  const recall = task.type === 'write' || task.type === 'flashcard';
  if (correct) {
    if (recall) {
      item.got++;
      if (item.got >= item.needed) item.stage = 'done';
    } else {
      item.stage = 'write';
    }
  } else {
    item.wrong++;
    item.got = 0;
    item.stage = 'mc';
    const rng = nextRng(s);
    const pos = s.queue.length >= 3 ? Math.min(s.queue.length, randInt(3, 6, rng)) : s.queue.length;
    s.queue.splice(pos, 0, task.key);
  }
  s.current = null;
  if (s.queue.length === 0 && allDone(s)) s.done = true;
}

/**
 * «Ich hatte recht» nach einer als falsch gewerteten Abruf-Aufgabe: Der Fehler wird
 * zurückgenommen (auch die Wiedervorlage) und der Versuch zählt als richtiger Abruf.
 */
export function learnOverride(s: LearnState, key: string): void {
  const item = s.items[key];
  if (!item || item.wrong === 0) return;
  item.wrong--;
  if (item.attempts === 1) item.firstResult = true;
  const i = s.queue.indexOf(key);
  if (i >= 0) s.queue.splice(i, 1);
  const log = s.roundLog.findLast((e) => e.key === key);
  if (log) log.correct = true;
  item.got++;
  item.stage = item.got >= item.needed ? 'done' : 'write';
  if (s.queue.length === 0 && allDone(s)) s.done = true;
}

export function learnProgress(s: LearnState): { done: number; total: number; learning: number; fresh: number } {
  const items = Object.values(s.items);
  return {
    done: items.filter((i) => i.stage === 'done').length,
    total: items.length,
    learning: items.filter((i) => i.stage !== 'done' && i.attempts > 0).length,
    fresh: items.filter((i) => i.attempts === 0).length,
  };
}
