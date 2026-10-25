import { createRng, shuffle } from '../util/rng';
import { itemKey, type Deck, type ItemRef } from './deck';

/**
 * Zuordnen: Begriffe und Übersetzungen paarweise antippen. Grosse Sets werden in Runden
 * aufgeteilt; in einer Runde stehen nie zwei Paare, die man verwechseln könnte
 * (gleiche Frage oder überlappende Antwort), denn dann gäbe es zwei richtige Lösungen.
 */

export interface MatchTile {
  id: string;
  key: string;
  side: 'prompt' | 'answer';
}

export interface MatchState {
  kind: 'match';
  seed: number;
  rounds: string[][];
  round: number;
  tiles: MatchTile[];
  matched: string[];
  mistakes: number;
  roundMistakes: number[];
  /** Einträge, die in dieser Sitzung schon einmal falsch zugeordnet wurden. */
  missed: string[];
  timer: boolean;
  roundStart: number;
  elapsed: number[];
  done: boolean;
}

export function buildMatchRounds(deck: Deck, refs: ItemRef[], perRound: number, seed: number): string[][] {
  const rng = createRng(seed);
  const rounds: ItemRef[][] = [];
  for (const r of shuffle(refs, rng)) {
    const target = rounds.find((round) => round.length < perRound && !round.some((x) => x.d !== r.d || deck.conflicts(x.c, r.c, r.d)));
    if (target) target.push(r);
    else rounds.push([r]);
  }
  // Eine Runde mit nur einem Paar wäre kein Spiel: an die vorherige anhängen, wenn es passt.
  const last = rounds[rounds.length - 1];
  if (rounds.length > 1 && last.length === 1) {
    const prev = rounds[rounds.length - 2];
    if (!prev.some((x) => x.d !== last[0].d || deck.conflicts(x.c, last[0].c, last[0].d))) {
      prev.push(last[0]);
      rounds.pop();
    }
  }
  return rounds.map((round) => round.map(itemKey));
}

function tilesFor(keys: string[], seed: number): MatchTile[] {
  const tiles: MatchTile[] = keys.flatMap((key) => [
    { id: `p:${key}`, key, side: 'prompt' as const },
    { id: `a:${key}`, key, side: 'answer' as const },
  ]);
  return shuffle(tiles, createRng(seed));
}

export function createMatch(deck: Deck, refs: ItemRef[], perRound: number, timer: boolean, seed: number, now = Date.now()): MatchState {
  const rounds = buildMatchRounds(deck, refs, perRound, seed);
  return {
    kind: 'match',
    seed,
    rounds,
    round: 0,
    tiles: rounds.length ? tilesFor(rounds[0], seed + 1) : [],
    matched: [],
    mistakes: 0,
    roundMistakes: rounds.map(() => 0),
    missed: [],
    timer,
    roundStart: now,
    elapsed: [],
    done: rounds.length === 0,
  };
}

export interface MatchAttempt {
  correct: boolean;
  /** Eintrag, der verbucht wird: bei Fehlern der zuerst gewählte. */
  key: string;
  firstMiss: boolean;
  roundComplete: boolean;
}

export function matchAttempt(s: MatchState, firstTileId: string, secondTileId: string, now = Date.now()): MatchAttempt | null {
  const a = s.tiles.find((t) => t.id === firstTileId);
  const b = s.tiles.find((t) => t.id === secondTileId);
  if (!a || !b || a.side === b.side || s.matched.includes(a.key) || s.matched.includes(b.key)) return null;
  if (a.key === b.key) {
    s.matched.push(a.key);
    const roundKeys = s.rounds[s.round];
    const roundComplete = roundKeys.every((k) => s.matched.includes(k));
    if (roundComplete) s.elapsed[s.round] = now - s.roundStart;
    return { correct: true, key: a.key, firstMiss: false, roundComplete };
  }
  s.mistakes++;
  s.roundMistakes[s.round]++;
  const firstMiss = !s.missed.includes(a.key);
  if (firstMiss) s.missed.push(a.key);
  return { correct: false, key: a.key, firstMiss, roundComplete: false };
}

export function nextMatchRound(s: MatchState, now = Date.now()): void {
  if (s.round + 1 >= s.rounds.length) {
    s.done = true;
    return;
  }
  s.round++;
  s.tiles = tilesFor(s.rounds[s.round], s.seed + s.round + 1);
  s.roundStart = now;
}

export function matchRemaining(s: MatchState): number {
  return s.rounds[s.round]?.filter((k) => !s.matched.includes(k)).length ?? 0;
}
