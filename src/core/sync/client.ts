import { db } from '../db/db';
import { getDeviceId, getSettings, setSyncActive } from '../db/repo';
import { DEVICE_LOCAL_KEYS, type Settings } from '../settings';
import type { OutboxEntry, SyncTable } from '../types';
import { decryptJson, deriveKeys, encryptJson, fromBase64Url, toBase64Url, type SyncKeys } from './crypto';
import { applyChanges, toBase64, type Change } from './merge';

/**
 * Sync-Ablauf: erst eigene Änderungen hochladen (verschlüsselt), dann fremde abholen und
 * zusammenführen. Ohne eingeschalteten Sync läuft hier nichts, und es wird nichts gesendet.
 */

export interface SyncConfig {
  key: string; // base64url, 32 Bytes
  roomId: string;
  enabledAt: number;
  cursor: number;
  lastSyncAt: number | null;
  lastError: string | null;
}

export interface Packet {
  v: 1;
  device: string;
  at: number;
  changes: Change[];
}

const MAX_PACKET_BYTES = 600_000;
const PACKETS_PER_REQUEST = 10;

let keysCache: { key: string; keys: SyncKeys } | null = null;

async function keysFor(cfg: SyncConfig): Promise<SyncKeys> {
  if (keysCache?.key !== cfg.key) keysCache = { key: cfg.key, keys: await deriveKeys(fromBase64Url(cfg.key)) };
  return keysCache.keys;
}

export async function getSyncConfig(): Promise<SyncConfig | null> {
  const row = await db.meta.get('sync');
  return (row?.value as SyncConfig | undefined) ?? null;
}

async function saveConfig(cfg: SyncConfig | null): Promise<void> {
  if (cfg) await db.meta.put({ key: 'sync', value: cfg });
  else await db.meta.delete('sync');
}

/** Beim App-Start: Ausgang nur führen, wenn der Sync eingeschaltet ist. */
export async function initSync(): Promise<SyncConfig | null> {
  const cfg = await getSyncConfig();
  setSyncActive(!!cfg);
  return cfg;
}

/** Schaltet den Sync ein und merkt alle vorhandenen Daten zum Hochladen vor. */
export async function enableSync(key: Uint8Array): Promise<SyncConfig> {
  const keys = await deriveKeys(key);
  const cfg: SyncConfig = { key: toBase64Url(key), roomId: keys.roomId, enabledAt: Date.now(), cursor: 0, lastSyncAt: null, lastError: null };
  await saveConfig(cfg);
  setSyncActive(true);
  const at = Date.now();
  const entries: OutboxEntry[] = [];
  const add = (table: SyncTable, ids: string[]) => ids.forEach((id) => entries.push({ key: `${table}:${id}`, table, id, at }));
  add('sets', (await db.sets.toCollection().primaryKeys()) as string[]);
  add('cards', (await db.cards.toCollection().primaryKeys()) as string[]);
  add('reviewLogs', (await db.reviewLogs.toCollection().primaryKeys()) as string[]);
  add('media', (await db.media.toCollection().primaryKeys()) as string[]);
  if (await db.settings.get('app')) add('settings', ['app']);
  for (const t of await db.tombstones.toArray()) entries.push({ key: `${t.table}:${t.id}`, table: t.table, id: t.id, at });
  await db.outbox.bulkPut(entries);
  return cfg;
}

export async function disableSync(): Promise<void> {
  await saveConfig(null);
  await db.outbox.clear();
  setSyncActive(false);
  keysCache = null;
}

async function buildChange(e: OutboxEntry): Promise<Change | null> {
  const tomb = await db.tombstones.get(e.id);
  switch (e.table) {
    case 'sets': {
      const r = await db.sets.get(e.id);
      if (r) return { t: 'sets', id: e.id, op: 'put', at: r.updatedAt, data: r };
      break;
    }
    case 'cards': {
      const r = await db.cards.get(e.id);
      if (r) return { t: 'cards', id: e.id, op: 'put', at: r.updatedAt, data: r };
      break;
    }
    case 'reviewLogs': {
      const r = await db.reviewLogs.get(e.id);
      if (r) return { t: 'reviewLogs', id: e.id, op: 'put', at: r.at, data: r };
      break;
    }
    case 'media': {
      const r = await db.media.get(e.id);
      if (r) return { t: 'media', id: e.id, op: 'put', at: r.updatedAt, data: { ...r, data: toBase64(r.data) } };
      break;
    }
    case 'settings': {
      const r = await db.settings.get('app');
      if (r) {
        const value: Partial<Settings> = { ...r.value };
        for (const k of DEVICE_LOCAL_KEYS) delete value[k];
        return { t: 'settings', id: 'app', op: 'put', at: r.updatedAt, data: value };
      }
      break;
    }
  }
  return tomb ? { t: e.table, id: e.id, op: 'del', at: tomb.at } : null;
}

export interface SyncReport {
  pushed: number;
  pulled: number;
  applied: number;
}

export class SyncError extends Error {
  constructor(public code: 'offline' | 'auth' | 'server' | 'decrypt') {
    super(code);
  }
}

async function request(f: typeof fetch, url: string, init: RequestInit, token: string): Promise<Response> {
  let res: Response;
  try {
    res = await f(url, { ...init, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, ...(init.headers ?? {}) } });
  } catch {
    throw new SyncError('offline');
  }
  if (res.status === 401 || res.status === 403) throw new SyncError('auth');
  if (!res.ok) throw new SyncError('server');
  return res;
}

let running: Promise<SyncReport> | null = null;

/** Ein Sync-Durchgang. Läuft nie doppelt. */
export function syncNow(f: typeof fetch = fetch.bind(globalThis), base = ''): Promise<SyncReport> {
  if (!running) running = doSync(f, base).finally(() => (running = null));
  return running;
}

async function doSync(f: typeof fetch, base: string): Promise<SyncReport> {
  const cfg = await getSyncConfig();
  if (!cfg) return { pushed: 0, pulled: 0, applied: 0 };
  const keys = await keysFor(cfg);
  const device = await getDeviceId();
  const report: SyncReport = { pushed: 0, pulled: 0, applied: 0 };
  try {
    // 1. Hochladen
    const entries = await db.outbox.orderBy('at').toArray();
    const packets: { id: string; device: string; iv: string; data: string }[] = [];
    const doneKeys: { key: string; at: number }[] = [];
    let batch: Change[] = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const packet: Packet = { v: 1, device, at: Date.now(), changes: batch };
      const sealed = await encryptJson(keys.encKey, packet);
      packets.push({ id: crypto.randomUUID(), device, ...sealed });
      batch = [];
      size = 0;
    };
    for (const e of entries) {
      const ch = await buildChange(e);
      doneKeys.push({ key: e.key, at: e.at });
      if (!ch) continue;
      const bytes = JSON.stringify(ch).length;
      if (size + bytes > MAX_PACKET_BYTES) await flush();
      batch.push(ch);
      size += bytes;
      report.pushed++;
    }
    await flush();
    for (let i = 0; i < packets.length; i += PACKETS_PER_REQUEST) {
      await request(f, `${base}/api/sync/push`, { method: 'POST', body: JSON.stringify({ room: cfg.roomId, packets: packets.slice(i, i + PACKETS_PER_REQUEST) }) }, keys.authToken);
    }
    // Nur Einträge entfernen, die sich während des Hochladens nicht erneut geändert haben.
    const current = await db.outbox.bulkGet(doneKeys.map((d) => d.key));
    await db.outbox.bulkDelete(doneKeys.filter((d, i) => current[i] && current[i]!.at <= d.at).map((d) => d.key));

    // 2. Abholen
    const settings = await getSettings();
    let cursor = cfg.cursor;
    for (let guard = 0; guard < 1000; guard++) {
      const res = await request(f, `${base}/api/sync/pull?room=${cfg.roomId}&after=${cursor}`, { method: 'GET' }, keys.authToken);
      const body = (await res.json()) as { packets: { seq: number; device: string; iv: string; data: string }[]; more: boolean };
      for (const p of body.packets) {
        cursor = Math.max(cursor, p.seq);
        if (p.device === device) continue;
        let packet: Packet;
        try {
          packet = await decryptJson<Packet>(keys.encKey, p.iv, p.data);
        } catch {
          throw new SyncError('decrypt');
        }
        const r = await applyChanges(packet.changes, settings);
        report.pulled += packet.changes.length;
        report.applied += r.applied;
      }
      await saveConfig({ ...cfg, cursor });
      if (!body.more) break;
    }
    await saveConfig({ ...cfg, cursor, lastSyncAt: Date.now(), lastError: null });
    return report;
  } catch (e) {
    const code = e instanceof SyncError ? e.code : 'server';
    const latest = (await getSyncConfig()) ?? cfg;
    await saveConfig({ ...latest, lastError: code });
    throw e instanceof SyncError ? e : new SyncError('server');
  }
}

/** Löscht alle Pakete dieses Raums auf dem Server (z. B. vor dem Ausschalten). */
export async function deleteRemote(f: typeof fetch = fetch.bind(globalThis), base = ''): Promise<void> {
  const cfg = await getSyncConfig();
  if (!cfg) return;
  const keys = await keysFor(cfg);
  await request(f, `${base}/api/sync/room?room=${cfg.roomId}`, { method: 'DELETE' }, keys.authToken);
}

export async function pendingChanges(): Promise<number> {
  return db.outbox.count();
}
