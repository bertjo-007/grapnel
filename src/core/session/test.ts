import type { AnswerResult } from '../types';
import { newId } from '../util/id';
import { createRng, shuffle } from '../util/rng';
import { itemKey, mcOptions, parseKey, trueFalse, type Deck, type ItemRef } from './deck';

/**
 * Testmodus: ein fester Fragebogen, zusammengestellt vor dem Start. Das Ergebnis beruht
 * nur auf den tatsächlich gegebenen Antworten; nicht beantwortete Fragen zählen als
 * unbeantwortet, nicht als falsch geraten.
 */

export type TestQType = 'write' | 'mc' | 'match' | 'truefalse';

export interface TestConfig {
  count: number;
  types: TestQType[];
  shuffle: boolean;
  timeLimitMin: number | null;
  showAnswers: 'immediate' | 'end';
}

interface Base {
  id: string;
}

export type TestQuestion =
  | (Base & { type: 'write'; key: string; given: string | null; result: AnswerResult | null; closest?: string | null; reason?: string | null })
  | (Base & { type: 'mc'; key: string; options: string[]; given: string | null; result: AnswerResult | null })
  | (Base & { type: 'truefalse'; key: string; shownCardId: string; truth: boolean; given: boolean | null; result: AnswerResult | null })
  | (Base & {
      type: 'match';
      keys: string[];
      /** Karten-IDs in der Reihenfolge der rechten Spalte. */
      answerOrder: string[];
      /** Zuordnung: Eintrag → gewählte Karten-ID. */
      given: Record<string, string | null>;
      results: Record<string, AnswerResult> | null;
    });

export interface TestState {
  kind: 'test';
  config: TestConfig;
  seed: number;
  questions: TestQuestion[];
  index: number;
  startedAt: number;
  endsAt: number | null;
  submitted: boolean;
  submittedAt: number | null;
  recorded: boolean;
}

const MATCH_BLOCK = 5;

export function createTest(deck: Deck, refs: ItemRef[], config: TestConfig, seed: number, now = Date.now()): TestState {
  const rng = createRng(seed);
  const pool = config.shuffle ? shuffle(refs, rng) : refs.slice();
  const items = pool.slice(0, Math.max(1, Math.min(config.count, pool.length)));
  const types = config.types.length ? config.types : (['write'] as TestQType[]);
  const seq = items.map((_, i) => types[i % types.length]);
  const assigned = config.shuffle ? shuffle(seq, rng) : seq;

  const questions: TestQuestion[] = [];
  const matchBuffer: ItemRef[] = [];
  const flushMatch = () => {
    if (!matchBuffer.length) return;
    if (matchBuffer.length === 1) {
      const r = matchBuffer[0];
      questions.push({ id: newId(), type: 'write', key: itemKey(r), given: null, result: null });
    } else {
      // Keine verwechselbaren Paare im selben Block.
      const keys = matchBuffer.map(itemKey);
      questions.push({ id: newId(), type: 'match', keys, answerOrder: shuffle(matchBuffer.map((r) => r.c), rng), given: {}, results: null });
    }
    matchBuffer.length = 0;
  };

  items.forEach((r, i) => {
    const t = assigned[i];
    if (t === 'match') {
      const clash = matchBuffer.some((m) => deck.conflicts(m.c, r.c, r.d) || m.d !== r.d);
      if (clash || matchBuffer.length >= MATCH_BLOCK) flushMatch();
      matchBuffer.push(r);
      return;
    }
    flushMatch();
    const key = itemKey(r);
    if (t === 'mc') {
      const options = mcOptions(deck, r, rng);
      if (options) {
        questions.push({ id: newId(), type: 'mc', key, options, given: null, result: null });
        return;
      }
    }
    if (t === 'truefalse') {
      const tf = trueFalse(deck, r, rng);
      questions.push({ id: newId(), type: 'truefalse', key, ...tf, given: null, result: null });
      return;
    }
    questions.push({ id: newId(), type: 'write', key, given: null, result: null });
  });
  flushMatch();

  return {
    kind: 'test',
    config,
    seed,
    questions,
    index: 0,
    startedAt: now,
    endsAt: config.timeLimitMin ? now + config.timeLimitMin * 60_000 : null,
    submitted: false,
    submittedAt: null,
    recorded: false,
  };
}

export type WriteJudge = (key: string, given: string) => { result: AnswerResult; closest: string | null; reason: string | null };

/** Wertet eine einzelne Frage aus (für «Lösungen sofort anzeigen» und beim Abgeben). */
export function gradeQuestion(q: TestQuestion, judge: WriteJudge): void {
  switch (q.type) {
    case 'write': {
      if (q.given === null || !q.given.trim()) {
        q.result = 'skipped';
        return;
      }
      const r = judge(q.key, q.given);
      q.result = r.result;
      q.closest = r.closest;
      q.reason = r.reason;
      return;
    }
    case 'mc':
      q.result = q.given === null ? 'skipped' : q.given === parseKey(q.key).c ? 'correct' : 'wrong';
      return;
    case 'truefalse':
      q.result = q.given === null ? 'skipped' : q.given === q.truth ? 'correct' : 'wrong';
      return;
    case 'match': {
      const res: Record<string, AnswerResult> = {};
      for (const k of q.keys) {
        const g = q.given[k];
        res[k] = !g ? 'skipped' : g === parseKey(k).c ? 'correct' : 'wrong';
      }
      q.results = res;
    }
  }
}

export function submitTest(s: TestState, judge: WriteJudge, now = Date.now()): void {
  for (const q of s.questions) {
    const pending = q.type === 'match' ? q.results === null : q.result === null;
    if (pending) gradeQuestion(q, judge);
  }
  s.submitted = true;
  s.submittedAt = now;
}

export interface TestEntry {
  key: string;
  type: TestQType;
  result: AnswerResult;
  given: string | null;
}

/** Eine Zeile pro gefragtem Eintrag (Zuordnungsblöcke zählen pro Paar). */
export function testEntries(s: TestState): TestEntry[] {
  const out: TestEntry[] = [];
  for (const q of s.questions) {
    if (q.type === 'match') {
      for (const k of q.keys) out.push({ key: k, type: 'match', result: q.results?.[k] ?? 'skipped', given: q.given[k] ?? null });
    } else {
      const given = q.type === 'truefalse' ? (q.given === null ? null : String(q.given)) : q.given;
      out.push({ key: q.key, type: q.type, result: q.result ?? 'skipped', given });
    }
  }
  return out;
}

export function testScore(s: TestState): { total: number; correct: number; wrong: number; unanswered: number; percent: number } {
  const entries = testEntries(s);
  const total = entries.length;
  const correct = entries.filter((e) => e.result === 'correct' || e.result === 'almost').length;
  const unanswered = entries.filter((e) => e.result === 'skipped').length;
  const wrong = total - correct - unanswered;
  return { total, correct, wrong, unanswered, percent: total ? Math.round((correct / total) * 1000) / 10 : 0 };
}

export function testAnsweredCount(s: TestState): { answered: number; total: number } {
  let answered = 0;
  let total = 0;
  for (const q of s.questions) {
    if (q.type === 'match') {
      total += q.keys.length;
      answered += q.keys.filter((k) => q.given[k]).length;
    } else {
      total++;
      if (q.given !== null && (typeof q.given !== 'string' || q.given.trim())) answered++;
    }
  }
  return { answered, total };
}
