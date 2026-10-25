import { db } from '../db/db';
import { recomputeAllStates } from '../db/repo';
import { DEVICE_LOCAL_KEYS, withDefaults, type Settings } from '../settings';
import { statusOf } from '../srs/status';
import type { Card, CardState, MediaItem, ReviewLog, StudySet } from '../types';

/**
 * Export als CSV/TSV (zum Weiterverwenden, z. B. in Excel) und als JSON (volle Treue,
 * wieder importierbar). Mehrzeilige Texte, Anführungszeichen, Trennzeichen, Umlaute und
 * Akzente bleiben erhalten: Felder werden nach RFC 4180 in Anführungszeichen gesetzt.
 */

export const CSV_COLUMNS = ['front', 'back', 'example', 'explanation', 'tags', 'notes', 'difficult', 'important', 'answers', 'front_answers'] as const;
const PROGRESS_COLUMNS = ['status', 'correct', 'wrong', 'due'] as const;

function quote(field: string, delimiter: string): string {
  if (field === '') return '';
  const needs = field.includes('"') || field.includes('\n') || field.includes('\r') || field.includes(delimiter) || /^\s|\s$/.test(field);
  return needs ? `"${field.replace(/"/g, '""')}"` : field;
}

export interface DelimitedOptions {
  delimiter: ',' | '\t';
  extras: boolean;
  progress: boolean;
}

export function cardsToDelimited(cards: Card[], states: Map<string, CardState>, o: DelimitedOptions): string {
  const cols: string[] = o.extras ? [...CSV_COLUMNS] : ['front', 'back'];
  if (o.progress) cols.push(...PROGRESS_COLUMNS);
  const lines = [cols.join(o.delimiter)];
  for (const c of cards) {
    const st = states.get(`${c.id}:f2b`);
    const values: Record<string, string> = {
      front: c.front,
      back: c.back,
      example: c.example,
      explanation: c.explanation,
      tags: c.tags.join('|'),
      notes: c.notes,
      difficult: c.flagDifficult ? 'x' : '',
      important: c.flagImportant ? 'x' : '',
      answers: c.extraAnswers.join('|'),
      front_answers: c.extraFrontAnswers.join('|'),
      status: statusOf(st),
      correct: String(st?.correct ?? 0),
      wrong: String(st?.wrong ?? 0),
      due: st && st.fsrs.state !== 0 ? new Date(st.due).toISOString().slice(0, 10) : '',
    };
    lines.push(cols.map((k) => quote(values[k] ?? '', o.delimiter)).join(o.delimiter));
  }
  // BOM, damit Excel UTF-8 erkennt. Zeilenende CRLF nach RFC 4180.
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function fromBase64(s: string): ArrayBuffer {
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

export interface JsonOptions {
  progress: boolean;
  media: boolean;
}

interface ExportedSet {
  set: StudySet;
  cards: Card[];
  logs?: ReviewLog[];
  media?: { id: string; mime: string; data: string; updatedAt: number }[];
}

export interface GrapnelFile {
  app: 'grapnel';
  kind: 'set' | 'backup';
  version: 1;
  exportedAt: number;
  sets: ExportedSet[];
  settings?: Partial<Settings>;
}

export async function exportJson(setIds: string[] | 'all', o: JsonOptions): Promise<GrapnelFile> {
  const sets = setIds === 'all' ? await db.sets.toArray() : (await db.sets.bulkGet(setIds)).filter((s): s is StudySet => !!s);
  const out: ExportedSet[] = [];
  for (const set of sets) {
    const cards = await db.cards.where('[setId+position]').between([set.id, -Infinity], [set.id, Infinity]).toArray();
    const entry: ExportedSet = { set, cards };
    if (o.progress) entry.logs = await db.reviewLogs.where('setId').equals(set.id).toArray();
    if (o.media) {
      const ids = cards.flatMap((c) => [c.imageId, c.audioId]).filter((x): x is string => !!x);
      const media = (await db.media.bulkGet(ids)).filter((m): m is MediaItem => !!m);
      entry.media = media.map((m) => ({ id: m.id, mime: m.mime, data: toBase64(m.data), updatedAt: m.updatedAt }));
    }
    out.push(entry);
  }
  const file: GrapnelFile = { app: 'grapnel', kind: setIds === 'all' ? 'backup' : 'set', version: 1, exportedAt: Date.now(), sets: out };
  if (setIds === 'all') {
    const s = (await db.settings.get('app'))?.value;
    if (s) {
      const copy: Partial<Settings> = { ...s };
      for (const k of DEVICE_LOCAL_KEYS) delete copy[k];
      file.settings = copy;
    }
  }
  return file;
}

export interface RestoreResult {
  sets: number;
  cards: number;
  logs: number;
  media: number;
}

/**
 * Stellt eine Sicherung wieder her. Vorhandenes wird nicht gelöscht: Datensätze mit
 * gleicher ID werden nur überschrieben, wenn die Sicherung neuer ist. Der Verlauf wird
 * vereinigt und der Lernstand danach aus dem Verlauf neu berechnet.
 */
export async function restoreBackup(file: GrapnelFile, settings: Settings): Promise<RestoreResult> {
  if (file.app !== 'grapnel') throw new Error('not-grapnel');
  const res: RestoreResult = { sets: 0, cards: 0, logs: 0, media: 0 };
  await db.transaction('rw', [db.sets, db.cards, db.reviewLogs, db.media, db.settings], async () => {
    for (const entry of file.sets) {
      const local = await db.sets.get(entry.set.id);
      if (!local || local.updatedAt < entry.set.updatedAt) {
        await db.sets.put(entry.set);
        res.sets++;
      }
      const localCards = new Map((await db.cards.bulkGet(entry.cards.map((c) => c.id))).filter((c): c is Card => !!c).map((c) => [c.id, c]));
      const cards = entry.cards.filter((c) => !localCards.has(c.id) || localCards.get(c.id)!.updatedAt < c.updatedAt);
      await db.cards.bulkPut(cards);
      res.cards += cards.length;
      if (entry.logs?.length) {
        const existing = new Set((await db.reviewLogs.bulkGet(entry.logs.map((l) => l.id))).filter(Boolean).map((l) => l!.id));
        const logs = entry.logs.filter((l) => !existing.has(l.id)).map((l) => ({ ...l, replaces: l.replaces ?? null }));
        await db.reviewLogs.bulkAdd(logs);
        res.logs += logs.length;
      }
      for (const m of entry.media ?? []) {
        const localM = await db.media.get(m.id);
        if (localM && localM.updatedAt >= m.updatedAt) continue;
        const data = fromBase64(m.data);
        await db.media.put({ id: m.id, mime: m.mime, data, size: data.byteLength, createdAt: m.updatedAt, updatedAt: m.updatedAt });
        res.media++;
      }
    }
    if (file.settings) {
      const current = (await db.settings.get('app'))?.value;
      const merged = withDefaults({ ...file.settings, ...(current ? Object.fromEntries(DEVICE_LOCAL_KEYS.map((k) => [k, current[k]])) : {}) });
      await db.settings.put({ key: 'app', value: merged, updatedAt: Date.now() });
    }
  });
  await recomputeAllStates(settings);
  return res;
}

export function fileName(base: string, ext: string): string {
  const safe = base.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'grapnel';
  return `${safe}.${ext}`;
}
