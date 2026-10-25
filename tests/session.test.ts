import { describe, expect, it } from 'vitest';
import { looseKey } from '../src/core/answer/normalize';
import { applyGrade, replay } from '../src/core/srs/scheduler';
import { DEFAULT_SETTINGS } from '../src/core/settings';
import { answerOf, Deck, itemKey, mcOptions, parseKey, pickDistractors, trueFalse, type ItemRef } from '../src/core/session/deck';
import { createLearn, learnAnswer, learnProgress, learnTask, startRound } from '../src/core/session/learn';
import { createMatch, matchAttempt, nextMatchRound } from '../src/core/session/match';
import { createRounds, nextRound, roundsAnswer, roundsTask } from '../src/core/session/rounds';
import { selectItems } from '../src/core/session/selection';
import { createTest, submitTest, testScore } from '../src/core/session/test';
import { createFlash, flashRate, flashRestart, flashUnknown, toggleReverse } from '../src/core/session/flash';
import { gradeFor } from '../src/core/session/grading';
import { createRng } from '../src/core/util/rng';
import type { Card, CardState, ReviewLog, StudySet } from '../src/core/types';

const SET: StudySet = { id: 's1', title: 'Test', description: '', frontLang: 'fr', backLang: 'de', createdAt: 0, updatedAt: 0, archivedAt: null, lastStudiedAt: null, ownerId: null };

function card(id: string, front: string, back: string, extra: Partial<Card> = {}): Card {
  return { id, setId: 's1', position: 0, front, back, example: '', explanation: '', imageId: null, audioId: null, tags: [], notes: '', flagDifficult: false, flagImportant: false, extraAnswers: [], extraFrontAnswers: [], createdAt: 0, updatedAt: 0, ...extra };
}

const CARDS = [
  card('a', 'le visage', 'das Gesicht'),
  card('b', 'la figure', 'das Gesicht'),
  card('c', 'laid, -e', 'hässlich'),
  card('d', 'moche', 'hässlich'),
  card('e', 'quand', 'wann'),
  card('f', 'quand', 'wenn, als'),
  card('g', 'la mère', 'die Mutter'),
  card('h', 'le père', 'der Vater'),
  card('i', 'la tante', 'die Tante'),
  card('j', "l'oncle", 'der Onkel'),
  card('k', 'le frère', 'der Bruder'),
  card('l', 'la sœur', 'die Schwester'),
];

const deck = () => new Deck(CARDS, [], [SET]);
const ref = (c: string): ItemRef => ({ c, d: 'f2b' });

describe('Distraktoren', () => {
  it('nie Synonyme, Geschwister oder doppelte Texte', () => {
    const d = deck();
    for (let seed = 1; seed < 60; seed++) {
      for (const c of CARDS) {
        const opts = mcOptions(d, ref(c.id), createRng(seed));
        expect(opts).not.toBeNull();
        const texts = opts!.map((id) => looseKey(answerOf(d.card(id)!, 'f2b')));
        expect(new Set(texts).size).toBe(texts.length);
        expect(opts!.filter((id) => id === c.id)).toHaveLength(1);
        for (const id of opts!) if (id !== c.id) expect(d.conflicts(c.id, id, 'f2b')).toBe(false);
      }
    }
    // «le visage» darf nie «das Gesicht» von «la figure» als falsche Option bekommen.
    const many = Array.from({ length: 40 }, (_, s) => pickDistractors(d, ref('a'), 3, createRng(s))).flat();
    expect(many).not.toContain('b');
  });
  it('variiert die Position der richtigen Antwort', () => {
    const d = deck();
    const positions = new Set(Array.from({ length: 30 }, (_, s) => mcOptions(d, ref('g'), createRng(s))!.indexOf('g')));
    expect(positions.size).toBeGreaterThan(2);
  });
  it('reduziert die Anzahl Optionen bei kleinen Sets und gibt null bei zu wenigen', () => {
    const small = new Deck([card('x', 'un', 'eins'), card('y', 'deux', 'zwei')], [], [SET]);
    expect(mcOptions(small, ref('x'), createRng(1))).toHaveLength(2);
    const single = new Deck([card('x', 'un', 'eins')], [], [SET]);
    expect(mcOptions(single, ref('x'), createRng(1))).toBeNull();
  });
  it('Wahr/Falsch zeigt nie eine Antwort, die eigentlich auch stimmt', () => {
    const d = deck();
    for (let s = 0; s < 50; s++) {
      const tf = trueFalse(d, ref('c'), createRng(s));
      if (!tf.truth) expect(tf.shownCardId).not.toBe('d');
    }
  });
});

describe('Lernen', () => {
  it('führt neue Karten portionsweise ein und wiederholt Falsches nicht direkt danach', () => {
    const d = deck();
    const s = createLearn(d, CARDS.map((c) => ref(c.id)), { variant: 'learn', roundSize: 6, newLimit: 100, seed: 7 });
    expect(s.active.length).toBeLessThanOrEqual(3); // höchstens die Hälfte neu
    let prev: string | null = null;
    let steps = 0;
    let wrongOnce = false;
    while (!s.done && steps < 500) {
      steps++;
      const t = learnTask(s, d);
      if (!t) {
        if (s.betweenRounds) startRound(s);
        continue;
      }
      if (prev === t.key && s.queue.length + s.active.length > 2) throw new Error('direkt wiederholt');
      prev = t.key;
      const correct = !(t.key === itemKey(ref('g')) && !wrongOnce);
      if (!correct) wrongOnce = true;
      learnAnswer(s, correct);
    }
    expect(s.done).toBe(true);
    const p = learnProgress(s);
    expect(p.done).toBe(CARDS.length);
    expect(s.items[itemKey(ref('g'))].wrong).toBe(1);
  });
  it('fertig erst nach richtigem Abruf, nicht nach Multiple Choice', () => {
    const d = deck();
    const s = createLearn(d, [ref('g')], { variant: 'learn', roundSize: 7, newLimit: 10, seed: 1 });
    const t1 = learnTask(s, d)!;
    expect(t1.type).toBe('mc');
    learnAnswer(s, true);
    expect(s.items[itemKey(ref('g'))].stage).toBe('write');
    const t2 = learnTask(s, d) ?? (startRound(s), learnTask(s, d))!;
    expect(t2.type).toBe('write');
    learnAnswer(s, true);
    expect(s.items[itemKey(ref('g'))].stage).toBe('done');
  });
  it('respektiert die Grenze für neue Karten', () => {
    const s = createLearn(deck(), CARDS.map((c) => ref(c.id)), { variant: 'learn', roundSize: 7, newLimit: 4, seed: 1 });
    expect(Object.keys(s.items)).toHaveLength(4);
  });
});

describe('Schreiben in Runden', () => {
  it('wiederholt falsche Karten in der nächsten Runde', () => {
    const d = deck();
    const keys = ['g', 'h', 'i'].map((c) => itemKey(ref(c)));
    const s = createRounds(keys, 'write', false, 1);
    roundsTask(s, d);
    roundsAnswer(s, false);
    roundsTask(s, d);
    roundsAnswer(s, true);
    roundsTask(s, d);
    roundsAnswer(s, true);
    expect(roundsTask(s, d)).toBeNull();
    expect(s.betweenRounds).toBe(true);
    nextRound(s);
    expect(roundsTask(s, d)?.key).toBe(keys[0]);
    roundsAnswer(s, true);
    expect(roundsTask(s, d)).toBeNull();
    expect(s.done).toBe(true);
    expect(s.first[keys[0]]).toBe(false);
  });
});

describe('Test', () => {
  it('zählt richtig, falsch und unbeantwortet aus echten Antworten', () => {
    const d = deck();
    const refs = CARDS.map((c) => ref(c.id));
    const s = createTest(d, refs, { count: 6, types: ['write', 'mc', 'truefalse'], shuffle: false, timeLimitMin: null, showAnswers: 'end' }, 3);
    expect(s.questions).toHaveLength(6);
    const [q0, q1, q2] = s.questions;
    if (q0.type === 'write') q0.given = answerOf(d.card(parseKey(q0.key).c)!, 'f2b');
    if (q1.type === 'mc') q1.given = q1.options.find((o) => o !== parseKey(q1.key).c)!;
    if (q2.type === 'truefalse') q2.given = q2.truth;
    submitTest(s, (_k, given) => ({ result: given ? 'correct' : 'skipped', closest: null, reason: null }));
    const score = testScore(s);
    expect(score).toMatchObject({ total: 6, correct: 2, wrong: 1, unanswered: 3 });
    expect(score.percent).toBeCloseTo(33.3, 1);
  });
  it('Zuordnungsblöcke enthalten keine verwechselbaren Paare', () => {
    const d = deck();
    const s = createTest(d, CARDS.map((c) => ref(c.id)), { count: 12, types: ['match'], shuffle: false, timeLimitMin: 5, showAnswers: 'end' }, 3, 1000);
    expect(s.endsAt).toBe(1000 + 5 * 60_000);
    for (const q of s.questions) {
      if (q.type !== 'match') continue;
      for (const a of q.keys) for (const b of q.keys) if (a !== b) expect(d.conflicts(parseKey(a).c, parseKey(b).c, 'f2b')).toBe(false);
    }
  });
});

describe('Zuordnen', () => {
  it('teilt in Runden ohne Konflikte und zählt Fehler', () => {
    const d = deck();
    const s = createMatch(d, CARDS.map((c) => ref(c.id)), 5, true, 9, 0);
    for (const round of s.rounds) {
      expect(round.length).toBeLessThanOrEqual(5);
      for (const a of round) for (const b of round) if (a !== b) expect(d.conflicts(parseKey(a).c, parseKey(b).c, 'f2b')).toBe(false);
    }
    const [k1, k2] = s.rounds[0];
    expect(matchAttempt(s, `p:${k1}`, `a:${k2}`)?.correct).toBe(false);
    expect(s.mistakes).toBe(1);
    for (const k of s.rounds[0]) matchAttempt(s, `p:${k}`, `a:${k}`, 500);
    expect(s.elapsed[0]).toBe(500);
    nextMatchRound(s, 600);
    expect(s.round).toBe(1);
  });
});

describe('Karteikarten', () => {
  it('bewertet, kehrt um und übt Nicht-Gewusstes nochmals', () => {
    const s = createFlash(['1', '2', '3'], false, 1);
    toggleReverse(s);
    expect(s.order).toEqual(['3', '2', '1']);
    flashRate(s, 3);
    flashRate(s, 1);
    flashRate(s, 3);
    expect(s.done).toBe(true);
    expect(flashUnknown(s)).toEqual(['2']);
    flashRestart(s, flashUnknown(s));
    expect(s.order).toEqual(['2']);
    expect(s.round).toBe(2);
  });
});

describe('Auswahl und Bewertung', () => {
  it('filtert nach Kriterium und Richtung', () => {
    const states = new Map<string, CardState>();
    const flagged = [...CARDS, card('z', 'x', 'y', { flagImportant: true })];
    expect(selectItems(flagged, states, { kind: 'flagged', direction: 'f2b', flag: 'any' })).toEqual([ref('z')]);
    expect(selectItems(CARDS, states, { kind: 'new', direction: 'both' })).toHaveLength(CARDS.length * 2);
    expect(selectItems(CARDS, states, { kind: 'due', direction: 'f2b' })).toHaveLength(0);
    expect(selectItems(CARDS, states, { kind: 'random', direction: 'f2b', randomCount: 5, seed: 2 })).toHaveLength(5);
  });
  it('Wiedererkennung verlängert nie das Intervall', () => {
    expect(gradeFor('mc', 'correct')).toBeNull();
    expect(gradeFor('mc', 'wrong')).toBe(1);
    expect(gradeFor('write', 'almost')).toBe(2);
    expect(gradeFor('write', 'correct')).toBe(3);
    expect(gradeFor('flashcard', 'correct', 4)).toBe(4);
  });
});

describe('FSRS', () => {
  it('Nachspielen des Verlaufs ist deterministisch und reihenfolgeunabhängig', () => {
    const s = DEFAULT_SETTINGS.srs;
    const t0 = Date.UTC(2026, 9, 1, 8);
    const log = (id: string, at: number, rating: 1 | 3 | null, result: 'correct' | 'wrong'): ReviewLog => ({
      id, cardId: 'a', setId: 's1', direction: 'f2b', sessionId: null, mode: 'learn', task: 'write', result, rating, given: null, elapsedMs: 0, at, override: false, replaces: null, deviceId: 'x',
    });
    const logs = [log('1', t0, 3, 'correct'), log('2', t0 + 86400000 * 2, 1, 'wrong'), log('3', t0 + 86400000 * 3, 3, 'correct'), log('4', t0 + 1000, null, 'correct')];
    const a = replay('a', 's1', 'f2b', logs, s)!;
    const b = replay('a', 's1', 'f2b', logs.slice().reverse(), s)!;
    expect(a).toEqual(b);
    expect(a.correct).toBe(3);
    expect(a.wrong).toBe(1);
    // «Wiederholen» in einem Lernschritt ist bei FSRS kein Vergessen (kein lapse).
    expect(a.fsrs.lapses).toBe(0);
    let f = applyGrade(null, 3, t0, s);
    f = applyGrade(f, 1, t0 + 86400000 * 2, s);
    f = applyGrade(f, 3, t0 + 86400000 * 3, s);
    expect(a.fsrs).toEqual(f);
  });
  it('eine Korrektur ersetzt den falschen Eintrag', () => {
    const s = DEFAULT_SETTINGS.srs;
    const base = { cardId: 'a', setId: 's1', direction: 'f2b' as const, sessionId: null, mode: 'write' as const, task: 'write' as const, given: null, elapsedMs: 0, deviceId: 'x' };
    const wrong: ReviewLog = { ...base, id: 'w', at: 1000, result: 'wrong', rating: 1, override: false, replaces: null };
    const fix: ReviewLog = { ...base, id: 'f', at: 1001, result: 'correct', rating: 3, override: true, replaces: 'w' };
    const st = replay('a', 's1', 'f2b', [wrong, fix], s)!;
    expect(st.wrong).toBe(0);
    expect(st.correct).toBe(1);
    expect(st.fsrs.lapses).toBe(0);
  });
});
