import { db } from '../../core/db/db';
import { createSession } from '../../core/db/repo';
import type { Settings } from '../../core/settings';
import { Deck, itemKey, type ItemRef } from '../../core/session/deck';
import { createFlash } from '../../core/session/flash';
import { createLearn, learnProgress } from '../../core/session/learn';
import { createMatch } from '../../core/session/match';
import { createRounds } from '../../core/session/rounds';
import { createTest, type TestConfig } from '../../core/session/test';
import type { Card, StudyMode, StudySet } from '../../core/types';
import { randomSeed } from '../../core/util/rng';

export interface StartOptions {
  mode: StudyMode;
  setIds: string[];
  title: string;
  refs: ItemRef[];
  settings: Settings;
  shuffle: boolean;
  newLimit?: number;
  test?: TestConfig;
  matchTimer?: boolean;
  matchPerRound?: number;
  flashRating?: 'binary' | 'four';
}

export async function loadDeck(setIds: string[]): Promise<Deck> {
  const [sets, cards, states] = await Promise.all([
    db.sets.bulkGet(setIds),
    db.cards.where('setId').anyOf(setIds).toArray(),
    db.cardStates.where('setId').anyOf(setIds).toArray(),
  ]);
  return new Deck(cards as Card[], states, sets.filter((s): s is StudySet => !!s));
}

/** Legt eine Sitzung an und liefert ihre ID. Der Zustand ist reines JSON und überlebt Neuladen. */
export async function startSession(o: StartOptions): Promise<string> {
  const deck = await loadDeck(o.setIds);
  const seed = randomSeed();
  const keys = o.refs.map(itemKey);
  let state: unknown;
  let total = o.refs.length;
  switch (o.mode) {
    case 'flashcards':
      state = { ...createFlash(keys, o.shuffle, seed), rating: o.flashRating ?? o.settings.flashcardRating };
      break;
    case 'learn':
    case 'mixed': {
      const s = createLearn(deck, o.refs, { variant: o.mode === 'mixed' ? 'mixed' : 'learn', roundSize: o.settings.roundSize, newLimit: o.newLimit ?? o.settings.newPerSession, seed });
      total = learnProgress(s).total;
      state = s;
      break;
    }
    case 'write':
    case 'mc':
      state = createRounds(keys, o.mode, o.shuffle, seed);
      break;
    case 'test': {
      const s = createTest(deck, o.refs, o.test!, seed);
      total = s.questions.reduce((n, q) => n + (q.type === 'match' ? q.keys.length : 1), 0);
      state = s;
      break;
    }
    case 'match':
      state = createMatch(deck, o.refs, o.matchPerRound ?? 6, o.matchTimer ?? true, seed);
      break;
  }
  // Eine neue Sitzung ersetzt eine liegengelassene derselben Art (gleicher Modus, gleiche Sets).
  const same = await db.sessions.where('status').equals('active').filter((x) => x.mode === o.mode && x.setIds.join() === o.setIds.join()).primaryKeys();
  await db.sessions.bulkDelete(same as string[]);
  const session = await createSession({ mode: o.mode, setIds: o.setIds, title: o.title, progressDone: 0, progressTotal: total, state });
  return session.id;
}
