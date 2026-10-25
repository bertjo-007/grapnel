import { db } from '../db/db';
import { createSet, lastPosition, markDirty } from '../db/repo';
import type { Card, ImportBatch, Lang } from '../types';
import { newId } from '../util/id';
import type { ImportTarget } from './rows';
import type { PreviewRow } from './types';

export interface CommitInput {
  rows: PreviewRow[];
  target: ImportTarget;
  /** Ziel-Set bei «ergänzen» oder «aktualisieren». */
  setId?: string;
  /** Neues Set bei «neu». */
  newSet?: { title: string; description: string; frontLang: Lang; backLang: Lang };
  fileName: string;
  format: string;
  /** Bei «aktualisieren»: Zeilen ohne Treffer als neue Karten anhängen. */
  addUnmatched?: boolean;
}

export interface CommitResult {
  setId: string;
  expectedNew: number;
  expectedUpdated: number;
  imported: number;
  updated: number;
  ok: boolean;
  batchId: string;
}

const STEP = 1024;

/**
 * Übernimmt die ausgewählten Zeilen in einer Transaktion. Bestehende Karten werden beim
 * Aktualisieren über ihre ID verändert: Lernstand und Verlauf bleiben dadurch erhalten.
 * Danach wird nachgezählt, ob die Datenbank genau die erwarteten Karten enthält.
 */
export async function commitImport(input: CommitInput): Promise<CommitResult> {
  const selected = input.rows.filter((r) => r.selected && !r.unassigned);
  let setId = input.setId;
  if (input.target === 'new' || !setId) {
    const s = await createSet({
      title: input.newSet?.title ?? input.fileName.replace(/\.[^.]+$/, ''),
      description: input.newSet?.description ?? '',
      frontLang: input.newSet?.frontLang ?? 'other',
      backLang: input.newSet?.backLang ?? 'other',
    });
    setId = s.id;
  }
  const targetSet = setId;
  const toUpdate = input.target === 'update' ? selected.filter((r) => r.matchId) : [];
  const toAdd = input.target === 'update' ? (input.addUnmatched === false ? [] : selected.filter((r) => !r.matchId)) : selected;

  const now = Date.now();
  const startPos = await lastPosition(targetSet);
  const newCards: Card[] = toAdd.map((r, i) => ({
    id: newId(),
    setId: targetSet,
    position: startPos + STEP * (i + 1),
    front: r.front,
    back: r.back,
    example: r.example,
    explanation: r.explanation,
    imageId: null,
    audioId: null,
    tags: r.tags,
    notes: r.notes,
    flagDifficult: r.flagDifficult,
    flagImportant: r.flagImportant,
    extraAnswers: r.extraAnswers,
    extraFrontAnswers: r.extraFrontAnswers,
    createdAt: now,
    updatedAt: now,
  }));

  const before = await db.cards.where('setId').equals(targetSet).count();
  await db.transaction('rw', db.cards, db.sets, async () => {
    if (newCards.length) await db.cards.bulkAdd(newCards);
    for (const r of toUpdate) {
      // Nur Felder überschreiben, die die Quelle wirklich liefert. (undefined würde Dexie
      // als «Feld löschen» verstehen, darum werden leere Felder gar nicht erst gesetzt.)
      const changes: Partial<Card> = { front: r.front, back: r.back, updatedAt: now };
      if (r.example) changes.example = r.example;
      if (r.explanation) changes.explanation = r.explanation;
      if (r.tags.length) changes.tags = r.tags;
      if (r.notes) changes.notes = r.notes;
      if (r.extraAnswers.length) changes.extraAnswers = r.extraAnswers;
      if (r.extraFrontAnswers.length) changes.extraFrontAnswers = r.extraFrontAnswers;
      await db.cards.update(r.matchId!, changes);
    }
    await db.sets.update(targetSet, { updatedAt: now });
  });
  const after = await db.cards.where('setId').equals(targetSet).count();
  const addedIds = new Set(newCards.map((c) => c.id));
  const present = (await db.cards.bulkGet([...addedIds])).filter(Boolean).length;
  const imported = after - before;
  const ok = imported === newCards.length && present === newCards.length;

  const batch: ImportBatch = {
    id: newId(),
    at: now,
    fileName: input.fileName,
    format: input.format,
    setId: targetSet,
    target: input.target,
    recognized: input.rows.filter((r) => !r.unassigned).length,
    selected: selected.length,
    imported,
    updated: toUpdate.length,
    problematic: input.rows.filter((r) => r.statuses.some((s) => s !== 'ok' && s !== 'same-front' && s !== 'changed')).length,
  };
  await db.importBatches.add(batch);
  await markDirty('cards', [...newCards.map((x) => x.id), ...toUpdate.map((r) => r.matchId!)]);
  await markDirty('sets', [targetSet]);

  return { setId: targetSet, expectedNew: newCards.length, expectedUpdated: toUpdate.length, imported, updated: toUpdate.length, ok, batchId: batch.id };
}
