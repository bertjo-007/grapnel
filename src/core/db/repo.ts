import { DEFAULT_SETTINGS, withDefaults, type Settings } from '../settings';
import { applyGrade, replay, stateKey } from '../srs/scheduler';
import type {
  AnswerResult,
  Card,
  CardState,
  Direction,
  Grade,
  Lang,
  MediaItem,
  ReviewLog,
  Session,
  StudyMode,
  StudySet,
  SyncTable,
  TaskType,
} from '../types';
import { newId } from '../util/id';
import { db } from './db';

/**
 * Alle schreibenden Zugriffe auf die Datenbank laufen hier durch. Jede Änderung, die
 * synchronisiert werden soll, wird im Ausgang (outbox) vermerkt, aber nur, wenn der
 * Sync eingeschaltet ist. Gelöschtes hinterlässt einen Grabstein (tombstone), damit
 * andere Geräte die Löschung übernehmen statt die Daten zurückzubringen.
 */

let syncOn = false;

export function setSyncActive(on: boolean): void {
  syncOn = on;
}

async function dirty(table: SyncTable, ids: string | string[]): Promise<void> {
  if (!syncOn) return;
  const at = Date.now();
  const list = Array.isArray(ids) ? ids : [ids];
  await db.outbox.bulkPut(list.map((id) => ({ key: `${table}:${id}`, table, id, at })));
}

/** Für Module ausserhalb (Import): Änderungen für den Sync vormerken. */
export async function markDirty(table: SyncTable, ids: string[]): Promise<void> {
  await dirty(table, ids);
}

async function bury(table: SyncTable, ids: string[]): Promise<void> {
  if (!ids.length) return;
  const at = Date.now();
  await db.tombstones.bulkPut(ids.map((id) => ({ id, table, at })));
  await dirty(table, ids);
}

// ---------- Gerät ----------

let deviceIdCache: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (deviceIdCache) return deviceIdCache;
  const row = await db.meta.get('deviceId');
  if (row && typeof row.value === 'string') return (deviceIdCache = row.value);
  const id = newId();
  await db.meta.put({ key: 'deviceId', value: id });
  return (deviceIdCache = id);
}

// ---------- Einstellungen ----------

export async function getSettings(): Promise<Settings> {
  const row = await db.settings.get('app');
  return withDefaults(row?.value);
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = await getSettings();
  const next = withDefaults({
    ...current,
    ...patch,
    answer: { ...current.answer, ...(patch.answer ?? {}) },
    srs: { ...current.srs, ...(patch.srs ?? {}) },
  });
  await db.settings.put({ key: 'app', value: next, updatedAt: Date.now() });
  await dirty('settings', 'app');
  const srsChanged = patch.srs && (patch.srs.retention !== undefined || patch.srs.maxIntervalDays !== undefined);
  if (srsChanged && (current.srs.retention !== next.srs.retention || current.srs.maxIntervalDays !== next.srs.maxIntervalDays)) {
    await recomputeAllStates(next);
  }
  return next;
}

// ---------- Sets ----------

export interface NewSetInput {
  title: string;
  description?: string;
  frontLang?: Lang;
  backLang?: Lang;
}

export async function createSet(input: NewSetInput): Promise<StudySet> {
  const now = Date.now();
  const set: StudySet = {
    id: newId(),
    title: input.title.trim() || 'Neues Lernset',
    description: input.description?.trim() ?? '',
    frontLang: input.frontLang ?? 'other',
    backLang: input.backLang ?? 'other',
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    lastStudiedAt: null,
    ownerId: null,
  };
  await db.sets.add(set);
  await dirty('sets', set.id);
  return set;
}

export async function updateSet(id: string, patch: Partial<Omit<StudySet, 'id' | 'createdAt'>>): Promise<void> {
  await db.sets.update(id, { ...patch, updatedAt: Date.now() });
  await dirty('sets', id);
}

export async function archiveSet(id: string, archived: boolean): Promise<void> {
  await updateSet(id, { archivedAt: archived ? Date.now() : null });
}

/** Kopiert Set und Karten. Lernstand und Verlauf werden bewusst nicht kopiert. */
export async function duplicateSet(id: string, titleSuffix: string): Promise<StudySet> {
  const src = await db.sets.get(id);
  if (!src) throw new Error('set-missing');
  const cards = await db.cards.where('setId').equals(id).toArray();
  const now = Date.now();
  const copy: StudySet = { ...src, id: newId(), title: `${src.title} ${titleSuffix}`.trim(), createdAt: now, updatedAt: now, lastStudiedAt: null, archivedAt: null };
  const newCards: Card[] = cards.map((c) => ({ ...c, id: newId(), setId: copy.id, createdAt: now, updatedAt: now }));
  await db.transaction('rw', db.sets, db.cards, db.outbox, async () => {
    await db.sets.add(copy);
    await db.cards.bulkAdd(newCards);
    await dirty('sets', copy.id);
    await dirty('cards', newCards.map((c) => c.id));
  });
  return copy;
}

/** Löscht ein Set mit allen Karten, Lernständen, Verlauf und Medien. */
export async function deleteSet(id: string): Promise<void> {
  const cards = await db.cards.where('setId').equals(id).toArray();
  await deleteCardsInternal(cards);
  const logs = await db.reviewLogs.where('setId').equals(id).primaryKeys();
  await db.transaction('rw', [db.sets, db.reviewLogs, db.cardStates, db.sessions, db.tombstones, db.outbox], async () => {
    await db.reviewLogs.bulkDelete(logs);
    await db.cardStates.where('setId').equals(id).delete();
    await db.sets.delete(id);
    const sessions = await db.sessions.toArray();
    await db.sessions.bulkDelete(sessions.filter((s) => s.setIds.length === 1 && s.setIds[0] === id).map((s) => s.id));
    await bury('sets', [id]);
    await bury('reviewLogs', logs as string[]);
  });
}

// ---------- Karten ----------

export type CardInput = Partial<Omit<Card, 'id' | 'setId' | 'createdAt' | 'updatedAt' | 'position'>>;

function makeCard(setId: string, input: CardInput, position: number, now: number): Card {
  return {
    id: newId(),
    setId,
    position,
    front: input.front ?? '',
    back: input.back ?? '',
    example: input.example ?? '',
    explanation: input.explanation ?? '',
    imageId: input.imageId ?? null,
    audioId: input.audioId ?? null,
    tags: input.tags ?? [],
    notes: input.notes ?? '',
    flagDifficult: input.flagDifficult ?? false,
    flagImportant: input.flagImportant ?? false,
    extraAnswers: input.extraAnswers ?? [],
    extraFrontAnswers: input.extraFrontAnswers ?? [],
    createdAt: now,
    updatedAt: now,
  };
}

const STEP = 1024;

export async function lastPosition(setId: string): Promise<number> {
  const last = await db.cards.where('[setId+position]').between([setId, -Infinity], [setId, Infinity]).last();
  return last?.position ?? 0;
}

export async function addCards(setId: string, inputs: CardInput[]): Promise<Card[]> {
  const start = await lastPosition(setId);
  const now = Date.now();
  const cards = inputs.map((inp, i) => makeCard(setId, inp, start + STEP * (i + 1), now));
  await db.cards.bulkAdd(cards);
  await dirty('cards', cards.map((c) => c.id));
  await db.sets.update(setId, { updatedAt: now });
  return cards;
}

/** Neue Karte direkt nach einer bestehenden (oder am Ende). */
export async function insertCardAfter(setId: string, afterId: string | null, input: CardInput = {}): Promise<Card> {
  if (!afterId) return (await addCards(setId, [input]))[0];
  const pos = await positionAfter(setId, afterId);
  const card = makeCard(setId, input, pos, Date.now());
  await db.cards.add(card);
  await dirty('cards', card.id);
  return card;
}

async function positionAfter(setId: string, afterId: string): Promise<number> {
  const after = await db.cards.get(afterId);
  if (!after) return (await lastPosition(setId)) + STEP;
  const next = await db.cards
    .where('[setId+position]')
    .between([setId, after.position], [setId, Infinity], false, true)
    .first();
  if (!next) return after.position + STEP;
  const mid = (after.position + next.position) / 2;
  if (mid - after.position < 1e-6) {
    await renumber(setId);
    return positionAfter(setId, afterId);
  }
  return mid;
}

/** Verteilt die Positionen eines Sets neu (nur nötig, wenn Zwischenräume zu klein werden). */
export async function renumber(setId: string): Promise<void> {
  const cards = await db.cards.where('[setId+position]').between([setId, -Infinity], [setId, Infinity]).toArray();
  const now = Date.now();
  const updated = cards.map((c, i) => ({ ...c, position: STEP * (i + 1), updatedAt: now }));
  await db.cards.bulkPut(updated);
  await dirty('cards', updated.map((c) => c.id));
}

export async function updateCard(id: string, patch: CardInput): Promise<void> {
  await db.cards.update(id, { ...patch, updatedAt: Date.now() });
  await dirty('cards', id);
}

export async function duplicateCard(id: string): Promise<Card | null> {
  const src = await db.cards.get(id);
  if (!src) return null;
  const { id: _id, setId, createdAt: _c, updatedAt: _u, position: _p, ...rest } = src;
  return insertCardAfter(setId, id, rest);
}

/** Verschiebt eine Karte zwischen zwei Nachbarn (null = Anfang bzw. Ende). */
export async function moveCard(id: string, beforeId: string | null, afterId: string | null): Promise<void> {
  const card = await db.cards.get(id);
  if (!card) return;
  const before = beforeId ? await db.cards.get(beforeId) : null;
  const after = afterId ? await db.cards.get(afterId) : null;
  let pos: number;
  if (before && after) pos = (before.position + after.position) / 2;
  else if (before) pos = before.position + STEP;
  else if (after) pos = after.position - STEP;
  else return;
  if (before && after && Math.abs(after.position - before.position) < 1e-6) {
    await renumber(card.setId);
    return moveCard(id, beforeId, afterId);
  }
  await updateCard(id, { position: pos } as CardInput);
}

export async function setCardFlags(ids: string[], flags: { flagDifficult?: boolean; flagImportant?: boolean }): Promise<void> {
  const now = Date.now();
  await db.cards.bulkUpdate(ids.map((key) => ({ key, changes: { ...flags, updatedAt: now } })));
  await dirty('cards', ids);
}

async function deleteCardsInternal(cards: Card[]): Promise<void> {
  if (!cards.length) return;
  const ids = cards.map((c) => c.id);
  const mediaIds = cards.flatMap((c) => [c.imageId, c.audioId]).filter((x): x is string => !!x);
  const logIds = (await db.reviewLogs.where('cardId').anyOf(ids).primaryKeys()) as string[];
  await db.transaction('rw', [db.cards, db.cardStates, db.reviewLogs, db.media, db.tombstones, db.outbox], async () => {
    await db.cards.bulkDelete(ids);
    await db.cardStates.where('cardId').anyOf(ids).delete();
    await db.reviewLogs.bulkDelete(logIds);
    await db.media.bulkDelete(mediaIds);
    await bury('cards', ids);
    await bury('reviewLogs', logIds);
    await bury('media', mediaIds);
  });
}

export async function deleteCards(ids: string[]): Promise<void> {
  const cards = (await db.cards.bulkGet(ids)).filter((c): c is Card => !!c);
  await deleteCardsInternal(cards);
}

// ---------- Antworten und Lernstand ----------

export interface AnswerInput {
  card: Pick<Card, 'id' | 'setId'>;
  direction: Direction;
  sessionId: string | null;
  mode: StudyMode;
  task: TaskType;
  result: AnswerResult;
  rating: Grade | null;
  given?: string | null;
  elapsedMs?: number;
  at?: number;
}

/** Speichert eine Antwort und aktualisiert den Lernstand der Karte. */
export async function recordAnswer(input: AnswerInput, settings: Settings): Promise<{ log: ReviewLog; state: CardState }> {
  const at = input.at ?? Date.now();
  const log: ReviewLog = {
    id: newId(),
    cardId: input.card.id,
    setId: input.card.setId,
    direction: input.direction,
    sessionId: input.sessionId,
    mode: input.mode,
    task: input.task,
    result: input.result,
    rating: input.rating,
    given: input.given ?? null,
    elapsedMs: Math.max(0, Math.round(input.elapsedMs ?? 0)),
    at,
    override: false,
    replaces: null,
    deviceId: await getDeviceId(),
  };
  const key = stateKey(input.card.id, input.direction);
  let state!: CardState;
  await db.transaction('rw', [db.reviewLogs, db.cardStates, db.sets, db.outbox], async () => {
    await db.reviewLogs.add(log);
    const prev = await db.cardStates.get(key);
    const fsrs = input.rating !== null ? applyGrade(prev?.fsrs ?? null, input.rating, at, settings.srs) : prev?.fsrs ?? null;
    const counted = input.result !== 'skipped';
    const correct = (prev?.correct ?? 0) + (counted && (input.result === 'correct' || input.result === 'almost') ? 1 : 0);
    const wrong = (prev?.wrong ?? 0) + (counted && input.result === 'wrong' ? 1 : 0);
    state = {
      key,
      cardId: input.card.id,
      setId: input.card.setId,
      direction: input.direction,
      fsrs: fsrs ?? applyGradeless(at),
      due: (fsrs ?? applyGradeless(at)).due,
      correct,
      wrong,
      lastResult: counted ? input.result : prev?.lastResult ?? null,
      lastAt: counted ? at : prev?.lastAt ?? null,
    };
    await db.cardStates.put(state);
    await db.sets.update(input.card.setId, { lastStudiedAt: at });
    await dirty('reviewLogs', log.id);
  });
  return { log, state };
}

function applyGradeless(at: number) {
  // Noch nie in die Planung eingeflossen: bleibt «Neu».
  return { due: at, stability: 0, difficulty: 0, elapsed_days: 0, scheduled_days: 0, learning_steps: 0, reps: 0, lapses: 0, state: 0 as const, last_review: null };
}

/**
 * «Ich hatte recht»: ersetzt eine als falsch gewertete Antwort durch eine richtige.
 * Der alte Eintrag bleibt erhalten, zählt aber nicht mehr; der Lernstand wird aus dem
 * Verlauf neu berechnet.
 */
export async function overrideAnswer(logId: string, settings: Settings): Promise<CardState | null> {
  const old = await db.reviewLogs.get(logId);
  if (!old) return null;
  const fix: ReviewLog = {
    ...old,
    id: newId(),
    result: 'correct',
    rating: old.rating === null ? null : 3,
    override: true,
    replaces: old.id,
    at: old.at + 1,
    deviceId: await getDeviceId(),
  };
  await db.reviewLogs.add(fix);
  await dirty('reviewLogs', fix.id);
  return recomputeState(old.cardId, old.setId, old.direction, settings);
}

export async function recomputeState(cardId: string, setId: string, direction: Direction, settings: Settings): Promise<CardState | null> {
  const logs = await db.reviewLogs.where('cardId').equals(cardId).toArray();
  const st = replay(cardId, setId, direction, logs, settings.srs);
  if (st) await db.cardStates.put(st);
  else await db.cardStates.delete(stateKey(cardId, direction));
  return st;
}

export async function recomputeAllStates(settings: Settings = DEFAULT_SETTINGS): Promise<void> {
  const logs = await db.reviewLogs.toArray();
  const groups = new Map<string, ReviewLog[]>();
  for (const l of logs) {
    const k = stateKey(l.cardId, l.direction);
    groups.set(k, [...(groups.get(k) ?? []), l]);
  }
  const states: CardState[] = [];
  for (const group of groups.values()) {
    const st = replay(group[0].cardId, group[0].setId, group[0].direction, group, settings.srs);
    if (st) states.push(st);
  }
  await db.transaction('rw', db.cardStates, async () => {
    await db.cardStates.clear();
    await db.cardStates.bulkPut(states);
  });
}

// ---------- Sitzungen ----------

export async function createSession(input: Omit<Session, 'id' | 'startedAt' | 'updatedAt' | 'endedAt' | 'status'>): Promise<Session> {
  const now = Date.now();
  const session: Session = { ...input, id: newId(), status: 'active', startedAt: now, updatedAt: now, endedAt: null };
  await db.sessions.add(session);
  return session;
}

export async function saveSession(id: string, patch: Partial<Pick<Session, 'state' | 'progressDone' | 'progressTotal' | 'title'>>): Promise<void> {
  await db.sessions.update(id, { ...patch, updatedAt: Date.now() });
}

export async function finishSession(id: string, state?: unknown): Promise<void> {
  const now = Date.now();
  await db.sessions.update(id, { status: 'done', endedAt: now, updatedAt: now, ...(state === undefined ? {} : { state }) });
}

export async function discardSession(id: string): Promise<void> {
  await db.sessions.delete(id);
}

/** Zuletzt benutzte, nicht abgeschlossene Sitzung (für «Weiterlernen»). */
export async function resumableSession(): Promise<Session | undefined> {
  const active = await db.sessions.where('status').equals('active').toArray();
  return active.sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

// ---------- Medien ----------

export async function putMedia(data: ArrayBuffer, mime: string): Promise<string> {
  const now = Date.now();
  const item: MediaItem = { id: newId(), mime, data, size: data.byteLength, createdAt: now, updatedAt: now };
  await db.media.add(item);
  await dirty('media', item.id);
  return item.id;
}

export async function deleteMedia(id: string): Promise<void> {
  await db.media.delete(id);
  await bury('media', [id]);
}

// ---------- Alles löschen ----------

export async function wipeAllData(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
  deviceIdCache = null;
}
