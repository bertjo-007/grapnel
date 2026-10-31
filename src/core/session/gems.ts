import { createRng, randInt, shuffle, type Rng } from '../util/rng';
import { mcOptions, parseKey, type Deck } from './deck';
import type { RoundsTask } from './rounds';

/**
 * Spiel «Juwelen»: Zwei benachbarte Juwelen tauschen, damit drei oder mehr gleiche in
 * einer Reihe liegen. Jeder Tausch kostet einen Zug. Frage-Juwelen stellen beim Abräumen
 * eine Frage aus dem Lernset; richtig beantwortet bringt sie die aufgedruckten Züge.
 * Das Spiel endet, wenn keine Züge mehr übrig sind.
 *
 * Besondere Juwelen:
 * - Bombe: entsteht aus vier oder mehr in einer Reihe, räumt beim Abräumen ein 3×3-Feld.
 * - Stein: lässt sich weder tauschen noch kombinieren, nur sprengen (Bonuspunkte).
 * - Gift: kostet beim Abräumen einen Zug.
 *
 * Der Zustand ist reines JSON (Sitzung pausieren, neu laden), der Zufall reproduzierbar.
 */

export const GEM_SIZE = 8;
export const GEM_COLORS = 6;
export const START_MOVES = 15;
export const MIN_CARDS = 6;
export const POINTS_PER_GEM = 10;
export const STONE_BONUS = 100;
export const POISON_PENALTY = 1;
const START_STONES = 3;
const START_QUESTIONS = 4;
const QUESTION_CHANCE = 0.07;
const POISON_CHANCE = 0.025;

export type GemKind = 'normal' | 'question' | 'bomb' | 'stone' | 'poison';

export interface Gem {
  id: number;
  kind: GemKind;
  /** 0…GEM_COLORS-1; Steine haben keine Farbe (-1). */
  color: number;
  /** Nur Frage-Juwelen: Züge für eine richtige Antwort. */
  moves?: number;
}

/** Zeilenweise, Länge size × size. */
export type Board = Gem[];

export interface GemsStep {
  /** IDs der abgeräumten Juwelen (vor dem Nachrutschen). */
  cleared: number[];
  /** IDs, die in diesem Schritt zur Bombe wurden. */
  bombs: number[];
  /** Felder (Indizes vor dem Abräumen), auf denen eine Bombe gezündet hat. */
  blasts: number[];
  /** Feld nach Nachrutschen und Auffüllen. */
  board: Board;
  combo: number;
  points: number;
  questions: number;
  poison: number;
  stones: number;
  /** Keine Züge mehr möglich: das Feld wurde neu gemischt. */
  shuffled?: boolean;
}

export type GemsQuestion = RoundsTask & { moves: number };

export interface GemsState {
  kind: 'gems';
  size: number;
  seed: number;
  step: number;
  nextId: number;
  board: Board;
  moves: number;
  score: number;
  swaps: number;
  bestCombo: number;
  questionType: 'mc' | 'write';
  /** Reihenfolge der Fragen; falsch beantwortete kommen später noch einmal. */
  keys: string[];
  qIndex: number;
  /** Abgeräumte Frage-Juwelen, deren Frage noch aussteht (Züge je Juwel). */
  pending: number[];
  current: GemsQuestion | null;
  last: { key: string; moves: number; correct: boolean } | null;
  asked: number;
  correct: number;
  movesWon: number;
  stonesBroken: number;
  missed: string[];
  done: boolean;
}

function nextRng(s: { seed: number; step: number }): Rng {
  s.step++;
  return createRng((s.seed ^ Math.imul(s.step, 2654435761)) >>> 0);
}

// ---------- Feld ----------

const rc = (i: number, size: number) => [Math.floor(i / size), i % size] as const;
const matchable = (g: Gem | undefined) => !!g && g.kind !== 'stone';

export function adjacent(a: number, b: number, size: number): boolean {
  const [ra, ca] = rc(a, size);
  const [rb, cb] = rc(b, size);
  return Math.abs(ra - rb) + Math.abs(ca - cb) === 1;
}

/** Alle waagrechten und senkrechten Reihen aus drei oder mehr gleichen Juwelen. */
export function findRuns(board: Board, size: number): number[][] {
  const runs: number[][] = [];
  for (const horizontal of [true, false]) {
    for (let line = 0; line < size; line++) {
      let run: number[] = [];
      for (let k = 0; k <= size; k++) {
        const i = k < size ? (horizontal ? line * size + k : k * size + line) : -1;
        const g = i >= 0 ? board[i] : undefined;
        const prev = run.length ? board[run[0]] : undefined;
        if (g && matchable(g) && prev && g.color === prev.color) run.push(i);
        else {
          if (run.length >= 3) runs.push(run);
          run = g && matchable(g) ? [i] : [];
        }
      }
    }
  }
  return runs;
}

function swapped(board: Board, a: number, b: number): Board {
  const next = board.slice();
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

/** Ein Tausch, der eine Reihe ergibt, oder null. */
export function findMove(board: Board, size: number): [number, number] | null {
  for (let i = 0; i < board.length; i++) {
    const [r, c] = rc(i, size);
    for (const j of [c + 1 < size ? i + 1 : -1, r + 1 < size ? i + size : -1]) {
      if (j < 0 || !matchable(board[i]) || !matchable(board[j])) continue;
      if (findRuns(swapped(board, i, j), size).length) return [i, j];
    }
  }
  return null;
}

function spawn(s: GemsState, rng: Rng, plain = false): Gem {
  const id = s.nextId++;
  const color = randInt(0, GEM_COLORS - 1, rng);
  const roll = rng();
  if (!plain && roll < POISON_CHANCE) return { id, kind: 'poison', color };
  if (!plain && roll < POISON_CHANCE + QUESTION_CHANCE) return { id, kind: 'question', color, moves: randInt(2, 4, rng) };
  return { id, kind: 'normal', color };
}

/** Startfeld ohne fertige Reihen, mit mindestens einem möglichen Zug. */
function initialBoard(s: GemsState, rng: Rng): Board {
  const n = s.size * s.size;
  for (let attempt = 0; attempt < 50; attempt++) {
    const board: Board = [];
    for (let i = 0; i < n; i++) {
      const [r, c] = rc(i, s.size);
      let g = spawn(s, rng, true);
      for (let tries = 0; tries < 20; tries++) {
        const left = c >= 2 && board[i - 1].color === g.color && board[i - 2].color === g.color;
        const up = r >= 2 && board[i - s.size].color === g.color && board[i - 2 * s.size].color === g.color;
        if (!left && !up) break;
        g = { ...g, color: (g.color + 1) % GEM_COLORS };
      }
      board.push(g);
    }
    const spots = shuffle(
      Array.from({ length: n }, (_, i) => i),
      rng,
    );
    // Steine nicht in die oberste Reihe, damit sie nicht sofort im Weg liegen.
    let stones = 0;
    let questions = 0;
    for (const i of spots) {
      if (stones < START_STONES && i >= s.size) {
        board[i] = { id: board[i].id, kind: 'stone', color: -1 };
        stones++;
      } else if (questions < START_QUESTIONS) {
        board[i] = { ...board[i], kind: 'question', moves: randInt(2, 4, rng) };
        questions++;
      }
      if (stones >= START_STONES && questions >= START_QUESTIONS) break;
    }
    if (!findRuns(board, s.size).length && findMove(board, s.size)) return board;
  }
  throw new Error('gems-board');
}

/** Mischt die beweglichen Juwelen neu, bis es keine fertige Reihe, aber einen Zug gibt. */
function reshuffle(s: GemsState, board: Board, rng: Rng): Board {
  const free = board.map((g, i) => (g.kind === 'stone' ? -1 : i)).filter((i) => i >= 0);
  for (let attempt = 0; attempt < 100; attempt++) {
    const gems = shuffle(
      free.map((i) => board[i]),
      rng,
    );
    const next = board.slice();
    free.forEach((i, k) => (next[i] = gems[k]));
    if (!findRuns(next, s.size).length && findMove(next, s.size)) return next;
  }
  return initialBoard(s, rng);
}

/**
 * Räumt alle Reihen ab, lässt nachrutschen und füllt auf, bis nichts mehr passt
 * (Kettenreaktionen zählen als Kombo und geben mehr Punkte).
 */
function resolve(s: GemsState, board: Board, swap: [number, number] | null, rng: Rng): { board: Board; steps: GemsStep[] } {
  const steps: GemsStep[] = [];
  let combo = 0;
  for (let runs = findRuns(board, s.size); runs.length; runs = findRuns(board, s.size)) {
    combo++;
    const clear = new Set<number>();
    const keep = new Map<number, Gem>();
    // Vier oder mehr in einer Reihe: eine Bombe bleibt liegen, am Tauschort oder in der Mitte.
    for (const run of runs) {
      for (const i of run) clear.add(i);
      if (run.length < 4) continue;
      const at = (combo === 1 && swap ? run.find((i) => swap.includes(i)) : undefined) ?? run[Math.floor(run.length / 2)];
      const g = board[at];
      if (g.kind === 'bomb' || keep.has(at)) continue;
      keep.set(at, { id: g.id, kind: 'bomb', color: g.color });
      // Ein Frage-Juwel, das zur Bombe wird, stellt seine Frage trotzdem.
      if (g.kind === 'question') s.pending.push(g.moves ?? 2);
    }
    for (const i of keep.keys()) clear.delete(i);
    // Bomben im abgeräumten Bereich sprengen ihr 3×3-Feld, auch weitere Bomben darin.
    const queue = [...clear].filter((i) => board[i].kind === 'bomb');
    const blown = new Set<number>();
    while (queue.length) {
      const b = queue.pop()!;
      if (blown.has(b)) continue;
      blown.add(b);
      const [r, c] = rc(b, s.size);
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= s.size || cc >= s.size) continue;
          const i = rr * s.size + cc;
          if (keep.has(i) || clear.has(i)) continue;
          clear.add(i);
          if (board[i].kind === 'bomb') queue.push(i);
        }
    }
    const step: GemsStep = { cleared: [], bombs: [...keep.values()].map((g) => g.id), blasts: [...blown], board: [], combo, points: 0, questions: 0, poison: 0, stones: 0 };
    for (const i of clear) {
      const g = board[i];
      step.cleared.push(g.id);
      if (g.kind === 'stone') {
        step.stones++;
        step.points += STONE_BONUS;
        continue;
      }
      step.points += POINTS_PER_GEM * combo;
      if (g.kind === 'question') {
        step.questions++;
        s.pending.push(g.moves ?? 2);
      }
      if (g.kind === 'poison') step.poison++;
    }
    s.score += step.points;
    s.stonesBroken += step.stones;
    s.moves = Math.max(0, s.moves - step.poison * POISON_PENALTY);
    // Nachrutschen und von oben auffüllen.
    const next: (Gem | null)[] = board.map((g, i) => (clear.has(i) ? null : (keep.get(i) ?? g)));
    for (let c = 0; c < s.size; c++) {
      const column: Gem[] = [];
      for (let r = s.size - 1; r >= 0; r--) {
        const g = next[r * s.size + c];
        if (g) column.push(g);
      }
      for (let r = s.size - 1, k = 0; r >= 0; r--, k++) next[r * s.size + c] = column[k] ?? spawn(s, rng);
    }
    board = next as Board;
    step.board = board;
    steps.push(step);
  }
  if (!findMove(board, s.size)) {
    board = reshuffle(s, board, rng);
    steps.push({ cleared: [], bombs: [], blasts: [], board, combo, points: 0, questions: 0, poison: 0, stones: 0, shuffled: true });
  }
  s.bestCombo = Math.max(s.bestCombo, combo);
  return { board, steps };
}

// ---------- Spielablauf ----------

export function createGems(deck: Deck, keys: string[], opts: { questionType: 'mc' | 'write'; seed: number; size?: number; moves?: number }): GemsState {
  const s: GemsState = {
    kind: 'gems',
    size: opts.size ?? GEM_SIZE,
    seed: opts.seed,
    step: 0,
    nextId: 1,
    board: [],
    moves: opts.moves ?? START_MOVES,
    score: 0,
    swaps: 0,
    bestCombo: 0,
    questionType: opts.questionType,
    keys: [],
    qIndex: 0,
    pending: [],
    current: null,
    last: null,
    asked: 0,
    correct: 0,
    movesWon: 0,
    stonesBroken: 0,
    missed: [],
    done: false,
  };
  s.keys = shuffle(
    keys.filter((k) => deck.card(parseKey(k).c)),
    nextRng(s),
  );
  s.board = initialBoard(s, nextRng(s));
  return s;
}

export type SwapResult = { ok: false; reason: 'busy' | 'notAdjacent' | 'stone' | 'noMatch' } | { ok: true; swappedBoard: Board; steps: GemsStep[] };

/**
 * Tauscht zwei Juwelen. Ergibt das keine Reihe, bleibt alles, wie es war, und es kostet
 * keinen Zug. Sonst wird abgeräumt und die erste fällige Frage gestellt.
 */
export function gemsSwap(s: GemsState, deck: Deck, a: number, b: number): SwapResult {
  if (s.done || s.current || s.moves <= 0) return { ok: false, reason: 'busy' };
  if (!adjacent(a, b, s.size)) return { ok: false, reason: 'notAdjacent' };
  if (!matchable(s.board[a]) || !matchable(s.board[b])) return { ok: false, reason: 'stone' };
  const swappedBoard = swapped(s.board, a, b);
  if (!findRuns(swappedBoard, s.size).length) return { ok: false, reason: 'noMatch' };
  s.moves--;
  s.swaps++;
  const { board, steps } = resolve(s, swappedBoard, [a, b], nextRng(s));
  s.board = board;
  nextQuestion(s, deck);
  checkEnd(s);
  return { ok: true, swappedBoard, steps };
}

function nextQuestion(s: GemsState, deck: Deck): void {
  if (s.current || !s.pending.length || !s.keys.length) {
    if (!s.keys.length) s.pending = [];
    return;
  }
  const moves = s.pending.shift()!;
  for (let tries = 0; tries < s.keys.length; tries++) {
    const key = s.keys[s.qIndex % s.keys.length];
    s.qIndex++;
    if (!deck.card(parseKey(key).c)) continue;
    const options = s.questionType === 'mc' ? mcOptions(deck, parseKey(key), nextRng(s)) : null;
    s.current = options ? { type: 'mc', key, options, moves } : { type: 'write', key, moves };
    return;
  }
}

function checkEnd(s: GemsState): void {
  s.done = s.moves <= 0 && !s.current && !s.pending.length;
}

/** Antwort auf die aktuelle Frage. Falsch beantwortete Karten kommen bald noch einmal. */
export function gemsAnswer(s: GemsState, deck: Deck, correct: boolean): void {
  const q = s.current;
  if (!q) return;
  s.asked++;
  s.last = { key: q.key, moves: q.moves, correct };
  if (correct) {
    s.correct++;
    s.moves += q.moves;
    s.movesWon += q.moves;
  } else {
    if (!s.missed.includes(q.key)) s.missed.push(q.key);
    s.keys.splice(s.qIndex + 2, 0, q.key);
  }
  s.current = null;
  nextQuestion(s, deck);
  checkEnd(s);
}

/** «Ich hatte recht»: Die letzte, als falsch gewertete Antwort zählt doch. */
export function gemsOverride(s: GemsState, key: string): void {
  const l = s.last;
  if (!l || l.correct || l.key !== key) return;
  l.correct = true;
  s.correct++;
  s.moves += l.moves;
  s.movesWon += l.moves;
  s.missed = s.missed.filter((k) => k !== key);
  s.done = false;
  checkEnd(s);
}

/** Fortschritt für die Kopfzeile: verbrauchte Züge von allen bisher verfügbaren. */
export function gemsProgress(s: GemsState): { done: number; total: number } {
  return { done: s.swaps, total: s.swaps + s.moves };
}
