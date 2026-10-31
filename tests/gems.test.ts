import { describe, expect, it } from 'vitest';
import { Deck, itemKey } from '../src/core/session/deck';
import {
  createGems,
  findMove,
  findRuns,
  gemsAnswer,
  gemsOverride,
  gemsProgress,
  gemsSwap,
  POINTS_PER_GEM,
  START_MOVES,
  STONE_BONUS,
  type Board,
  type Gem,
  type GemsState,
} from '../src/core/session/gems';
import type { Card, StudySet } from '../src/core/types';

const SET: StudySet = { id: 's1', title: 'Test', description: '', frontLang: 'fr', backLang: 'de', createdAt: 0, updatedAt: 0, archivedAt: null, lastStudiedAt: null, ownerId: null };
const card = (id: string, front: string, back: string): Card => ({ id, setId: 's1', position: 0, front, back, example: '', explanation: '', imageId: null, audioId: null, tags: [], notes: '', flagDifficult: false, flagImportant: false, extraAnswers: [], extraFrontAnswers: [], createdAt: 0, updatedAt: 0 });
const CARDS = [
  card('a', 'la mère', 'die Mutter'),
  card('b', 'le père', 'der Vater'),
  card('c', 'la tante', 'die Tante'),
  card('d', "l'oncle", 'der Onkel'),
  card('e', 'le frère', 'der Bruder'),
  card('f', 'la sœur', 'die Schwester'),
];
const deck = new Deck(CARDS, [], [SET]);
const KEYS = CARDS.map((c) => itemKey({ c: c.id, d: 'f2b' }));

/**
 * Feld aus Text: Ziffer = Farbe, S = Stein, ? = Frage-Juwel (Farbe 0, +3), B = Bombe
 * (Farbe 0), P = Gift (Farbe 0). Zeilen von oben nach unten.
 */
function boardOf(s: GemsState, rows: string[]): Board {
  s.size = rows.length;
  let id = 1000;
  return rows.flatMap((row) =>
    [...row].map((ch): Gem => {
      id++;
      if (ch === 'S') return { id, kind: 'stone', color: -1 };
      if (ch === '?') return { id, kind: 'question', color: 0, moves: 3 };
      if (ch === 'B') return { id, kind: 'bomb', color: 0 };
      if (ch === 'P') return { id, kind: 'poison', color: 0 };
      return { id, kind: 'normal', color: Number(ch) };
    }),
  );
}

const game = (seed = 7) => createGems(deck, KEYS, { questionType: 'mc', seed });

describe('Juwelen: Startfeld', () => {
  it('hat keine fertigen Reihen, aber einen möglichen Zug, und ist reproduzierbar', () => {
    for (const seed of [1, 2, 3, 42, 99]) {
      const s = game(seed);
      expect(s.board).toHaveLength(64);
      expect(findRuns(s.board, s.size)).toEqual([]);
      expect(findMove(s.board, s.size)).not.toBeNull();
      expect(s.board.filter((g) => g.kind === 'stone')).toHaveLength(3);
      expect(s.board.filter((g) => g.kind === 'question').length).toBeGreaterThanOrEqual(4);
      expect(s.moves).toBe(START_MOVES);
    }
    expect(game(5).board).toEqual(game(5).board);
  });
});

describe('Juwelen: Tauschen', () => {
  it('ein Tausch ohne Reihe kostet keinen Zug und ändert nichts', () => {
    const s = game();
    s.board = boardOf(s, ['0123', '1230', '2301', '3012']);
    const before = JSON.stringify(s.board);
    expect(gemsSwap(s, deck, 0, 1)).toEqual({ ok: false, reason: 'noMatch' });
    expect(gemsSwap(s, deck, 0, 5)).toEqual({ ok: false, reason: 'notAdjacent' });
    expect(s.moves).toBe(START_MOVES);
    expect(JSON.stringify(s.board)).toBe(before);
  });

  it('drei in einer Reihe: ein Zug weniger, Punkte, Juwelen rutschen nach', () => {
    const s = game();
    s.board = boardOf(s, ['1122', '3311', '2233', '4455']);
    const res = gemsSwap(s, deck, 2, 6); // oben: 1 1 [2↔1] → 1 1 1
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(s.moves).toBe(START_MOVES - 1);
    expect(res.steps[0].cleared).toHaveLength(3);
    expect(res.steps[0].points).toBe(3 * POINTS_PER_GEM);
    expect(s.score).toBeGreaterThanOrEqual(30);
    expect(res.steps[0].board).toHaveLength(16);
    expect(gemsProgress(s)).toEqual({ done: 1, total: START_MOVES });
  });

  it('Steine lassen sich nicht tauschen', () => {
    const s = game();
    s.board = boardOf(s, ['S122', '3311', '2233', '4455']);
    expect(gemsSwap(s, deck, 0, 1)).toEqual({ ok: false, reason: 'stone' });
  });
});

describe('Juwelen: besondere Juwelen', () => {
  it('vier in einer Reihe ergeben eine Bombe am Tauschort', () => {
    const s = game();
    s.board = boardOf(s, ['1112', '3321', '2433', '4255']);
    const res = gemsSwap(s, deck, 3, 7); // oben: 1 1 1 [2↔1]
    if (!res.ok) throw new Error('kein Zug');
    expect(res.steps[0].cleared).toHaveLength(3);
    expect(res.steps[0].bombs).toHaveLength(1);
  });

  it('eine Bombe sprengt 3×3 und Steine darin geben Bonuspunkte', () => {
    const s = game();
    s.board = boardOf(s, ['5432', 'S4S1', '0B23', '4501']);
    const res = gemsSwap(s, deck, 10, 14); // Zeile 2: 0 B [2↔0] → Reihe mit der Bombe in der Mitte
    if (!res.ok) throw new Error('kein Zug');
    const first = res.steps[0];
    expect(first.stones).toBe(2);
    expect(first.points).toBeGreaterThanOrEqual(2 * STONE_BONUS);
    expect(first.cleared.length).toBeGreaterThanOrEqual(9);
  });

  it('Gift kostet einen Zug', () => {
    const s = game();
    s.board = boardOf(s, ['P012', '3301', '2433', '4255']);
    const res = gemsSwap(s, deck, 2, 6);
    if (!res.ok) throw new Error('kein Zug');
    expect(res.steps[0].poison).toBe(1);
    expect(s.moves).toBeLessThanOrEqual(START_MOVES - 2);
  });
});

describe('Juwelen: Fragen', () => {
  function withQuestion(): GemsState {
    const s = game();
    s.board = boardOf(s, ['?012', '3301', '2433', '4255']);
    const res = gemsSwap(s, deck, 2, 6);
    if (!res.ok) throw new Error('kein Zug');
    return s;
  }

  it('ein abgeräumtes Frage-Juwel stellt eine Frage, und Tauschen ist gesperrt', () => {
    const s = withQuestion();
    expect(s.current?.moves).toBe(3);
    expect(s.current?.type).toBe('mc');
    expect(gemsSwap(s, deck, 0, 1)).toEqual({ ok: false, reason: 'busy' });
  });

  it('richtig bringt die Züge, falsch nicht, und die Karte kommt wieder', () => {
    const s = withQuestion();
    const moves = s.moves;
    gemsAnswer(s, deck, true);
    expect(s.moves).toBe(moves + 3);
    expect(s.correct).toBe(1);

    const t = withQuestion();
    const key = t.current!.key;
    gemsAnswer(t, deck, false);
    expect(t.moves).toBe(moves);
    expect(t.missed).toEqual([key]);
    expect(t.keys.slice(t.qIndex).includes(key)).toBe(true);
  });

  it('«Ich hatte recht» gibt die Züge nachträglich', () => {
    const s = withQuestion();
    const key = s.current!.key;
    const moves = s.moves;
    gemsAnswer(s, deck, false);
    gemsOverride(s, key);
    expect(s.moves).toBe(moves + 3);
    expect(s.missed).toEqual([]);
  });

  it('ohne Züge ist das Spiel aus, ausser eine Frage steht noch aus', () => {
    const s = game();
    s.moves = 1;
    s.board = boardOf(s, ['?012', '3301', '2433', '4255']);
    const res = gemsSwap(s, deck, 2, 6);
    if (!res.ok) throw new Error('kein Zug');
    expect(s.moves).toBe(0);
    expect(s.done).toBe(false);
    gemsAnswer(s, deck, false);
    expect(s.done).toBe(true);
  });
});
