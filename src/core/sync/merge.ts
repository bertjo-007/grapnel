import { db } from '../db/db';
import { DEVICE_LOCAL_KEYS, withDefaults, type Settings } from '../settings';
import { replay, stateKey } from '../srs/scheduler';
import type { Card, MediaItem, ReviewLog, StudySet, SyncTable } from '../types';

/**
 * Wendet Änderungen anderer Geräte an.
 * - Sets, Karten, Medien, Einstellungen: die jüngere Änderung gewinnt (updatedAt).
 * - Löschungen: gelten, wenn sie jünger sind als der lokale Stand; sie hinterlassen auch
 *   hier einen Grabstein, damit ein drittes Gerät die Daten nicht zurückbringt.
 * - Verlauf: wird vereinigt (jeder Eintrag hat eine eigene ID, nichts kollidiert). Der
 *   Lernstand der betroffenen Karten wird danach aus dem Verlauf neu berechnet.
 * Hier wird direkt in die Datenbank geschrieben, nicht über repo: Übernommenes soll nicht
 * erneut in den Ausgang.
 */

export interface Change {
  t: SyncTable;
  id: string;
  op: 'put' | 'del';
  at: number;
  data?: unknown;
}

export interface MediaWire {
  id: string;
  mime: string;
  data: string;
  size: number;
  createdAt: number;
  updatedAt: number;
}

function fromBase64(s: string): ArrayBuffer {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function applyChanges(changes: Change[], settings: Settings): Promise<{ applied: number; affectedCards: number }> {
  const touchedCards = new Map<string, string>(); // cardId → setId
  let applied = 0;

  await db.transaction('rw', [db.sets, db.cards, db.reviewLogs, db.media, db.settings, db.tombstones, db.cardStates], async () => {
    for (const ch of changes) {
      const tomb = await db.tombstones.get(ch.id);
      if (ch.op === 'del') {
        if (!tomb || tomb.at < ch.at) await db.tombstones.put({ id: ch.id, table: ch.t, at: ch.at });
        if (ch.t === 'sets') {
          const local = await db.sets.get(ch.id);
          if (local && local.updatedAt <= ch.at) {
            await db.sets.delete(ch.id);
            applied++;
          }
        } else if (ch.t === 'cards') {
          const local = await db.cards.get(ch.id);
          if (local && local.updatedAt <= ch.at) {
            await db.cards.delete(ch.id);
            await db.cardStates.where('cardId').equals(ch.id).delete();
            applied++;
          }
        } else if (ch.t === 'reviewLogs') {
          const local = await db.reviewLogs.get(ch.id);
          if (local) {
            await db.reviewLogs.delete(ch.id);
            touchedCards.set(local.cardId, local.setId);
            applied++;
          }
        } else if (ch.t === 'media') {
          await db.media.delete(ch.id);
          applied++;
        }
        continue;
      }
      if (tomb && tomb.at >= ch.at) continue;
      switch (ch.t) {
        case 'sets': {
          const incoming = ch.data as StudySet;
          const local = await db.sets.get(ch.id);
          if (!local || local.updatedAt < incoming.updatedAt) {
            await db.sets.put(incoming);
            applied++;
          }
          break;
        }
        case 'cards': {
          const incoming = ch.data as Card;
          const local = await db.cards.get(ch.id);
          if (!local || local.updatedAt < incoming.updatedAt) {
            await db.cards.put(incoming);
            applied++;
          }
          break;
        }
        case 'reviewLogs': {
          const incoming = ch.data as ReviewLog;
          if (!(await db.reviewLogs.get(ch.id))) {
            await db.reviewLogs.put({ ...incoming, replaces: incoming.replaces ?? null });
            touchedCards.set(incoming.cardId, incoming.setId);
            applied++;
          }
          break;
        }
        case 'media': {
          const incoming = ch.data as MediaWire;
          const local = await db.media.get(ch.id);
          if (!local || local.updatedAt < incoming.updatedAt) {
            const item: MediaItem = { ...incoming, data: fromBase64(incoming.data) };
            await db.media.put(item);
            applied++;
          }
          break;
        }
        case 'settings': {
          const incoming = ch.data as Partial<Settings>;
          const local = await db.settings.get('app');
          if (!local || local.updatedAt < ch.at) {
            const keep = local ? Object.fromEntries(DEVICE_LOCAL_KEYS.map((k) => [k, local.value[k]])) : {};
            await db.settings.put({ key: 'app', value: withDefaults({ ...incoming, ...keep }), updatedAt: ch.at });
            applied++;
          }
          break;
        }
      }
    }
  });

  // Lernstand der betroffenen Karten aus dem vereinigten Verlauf neu berechnen.
  for (const [cardId, setId] of touchedCards) {
    if (!(await db.cards.get(cardId))) continue;
    const logs = await db.reviewLogs.where('cardId').equals(cardId).toArray();
    for (const d of ['f2b', 'b2f'] as const) {
      const st = replay(cardId, setId, d, logs, settings.srs);
      if (st) await db.cardStates.put(st);
      else await db.cardStates.delete(stateKey(cardId, d));
    }
  }
  return { applied, affectedCards: touchedCards.size };
}
