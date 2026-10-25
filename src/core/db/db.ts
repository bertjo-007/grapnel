import Dexie, { type EntityTable } from 'dexie';
import type {
  Card,
  CardState,
  ImportBatch,
  MediaItem,
  MetaEntry,
  OutboxEntry,
  ReviewLog,
  Session,
  SettingsRecord,
  StudySet,
  Tombstone,
} from '../types';

/**
 * Lokale Datenbank (IndexedDB über Dexie). Das ist die einzige Quelle der Wahrheit auf
 * dem Gerät; der Sync liest und schreibt nur hier hinein.
 */
export class GrapnelDB extends Dexie {
  sets!: EntityTable<StudySet, 'id'>;
  cards!: EntityTable<Card, 'id'>;
  cardStates!: EntityTable<CardState, 'key'>;
  reviewLogs!: EntityTable<ReviewLog, 'id'>;
  sessions!: EntityTable<Session, 'id'>;
  media!: EntityTable<MediaItem, 'id'>;
  settings!: EntityTable<SettingsRecord, 'key'>;
  importBatches!: EntityTable<ImportBatch, 'id'>;
  tombstones!: EntityTable<Tombstone, 'id'>;
  outbox!: EntityTable<OutboxEntry, 'key'>;
  meta!: EntityTable<MetaEntry, 'key'>;

  constructor(name = 'grapnel') {
    super(name);
    this.version(1).stores({
      sets: 'id, updatedAt, archivedAt, lastStudiedAt',
      cards: 'id, setId, [setId+position], updatedAt',
      cardStates: 'key, cardId, setId, due',
      reviewLogs: 'id, cardId, setId, at, sessionId',
      sessions: 'id, status, updatedAt',
      media: 'id',
      settings: 'key',
      importBatches: 'id, at, setId',
      tombstones: 'id, at',
      outbox: 'key, at',
      meta: 'key',
    });
  }
}

export const db = new GrapnelDB();
