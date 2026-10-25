import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/core/db/db';
import { addCards, createSet, deleteCards, getSettings, recordAnswer, updateCard, wipeAllData } from '../src/core/db/repo';
import { decodeCode, encodeCode, generateKey } from '../src/core/sync/crypto';
import { disableSync, enableSync, getSyncConfig, syncNow } from '../src/core/sync/client';
import { applyChanges } from '../src/core/sync/merge';
import { handleSync, MemoryStore } from '../worker/sync';

let store: MemoryStore;
const server: typeof fetch = (input, init) => handleSync(new Request(`http://grapnel.test${String(input)}`, init), store);

/** Simuliert ein anderes Gerät: lokale Daten weg, neue Geräte-ID, gleicher Schlüssel. */
async function switchDevice(key: Uint8Array) {
  await disableSync();
  await wipeAllData();
  await enableSync(key);
}

beforeEach(async () => {
  store = new MemoryStore();
  await disableSync();
  await wipeAllData();
});

describe('Sync-Schlüssel', () => {
  it('Code hin und zurück, Tippfehler bei O/0 und I/1 verziehen', () => {
    const key = generateKey();
    const code = encodeCode(key);
    expect(code).toMatch(/^[0-9A-Z]{4}(-[0-9A-Z]{1,4})+$/);
    expect(decodeCode(code)).toEqual(key);
    expect(decodeCode(code.toLowerCase().replace(/-/g, ' '))).toEqual(key);
    expect(decodeCode('zu kurz')).toBeNull();
  });
});

describe('Sync zwischen Geräten', () => {
  it('überträgt Sets, Karten und Verlauf; Lernstand stimmt auf beiden Geräten', async () => {
    const key = generateKey();
    const settings = await getSettings();
    await enableSync(key);
    const set = await createSet({ title: 'Familie', frontLang: 'fr', backLang: 'de' });
    const [mere, pere] = await addCards(set.id, [
      { front: 'la mère', back: 'die Mutter' },
      { front: 'le père', back: 'der Vater' },
    ]);
    await recordAnswer({ card: mere, direction: 'f2b', sessionId: null, mode: 'write', task: 'write', result: 'correct', rating: 3 }, settings);
    const stateA = await db.cardStates.get(`${mere.id}:f2b`);
    const report = await syncNow(server);
    expect(report.pushed).toBeGreaterThanOrEqual(4);
    expect(await db.outbox.count()).toBe(0);

    // Der Server sieht keinen Klartext.
    const raw = JSON.stringify(store.packets);
    expect(raw).not.toContain('la mère');
    expect(raw).not.toContain('Familie');

    await switchDevice(key);
    await syncNow(server);
    expect((await db.sets.get(set.id))?.title).toBe('Familie');
    expect(await db.cards.count()).toBe(2);
    expect((await db.cardStates.get(`${mere.id}:f2b`))?.fsrs).toEqual(stateA?.fsrs);

    // Gerät B ändert und löscht, Gerät C sieht beides.
    await updateCard(pere.id, { back: 'der Vater, der Papa' });
    await deleteCards([mere.id]);
    await syncNow(server);
    await switchDevice(key);
    await syncNow(server);
    expect((await db.cards.get(pere.id))?.back).toBe('der Vater, der Papa');
    expect(await db.cards.get(mere.id)).toBeUndefined();
    expect(await db.reviewLogs.count()).toBe(0);
    expect((await getSyncConfig())?.lastError).toBeNull();
  });

  it('falscher Schlüssel bekommt keinen Zugang zum Raum', async () => {
    const key = generateKey();
    await enableSync(key);
    await createSet({ title: 'Geheim' });
    await syncNow(server);
    const cfg = await getSyncConfig();
    const res = await server(`/api/sync/pull?room=${cfg!.roomId}&after=0`, { headers: { authorization: 'Bearer AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' } });
    expect(res.status).toBe(403);
  });

  it('die jüngere Änderung gewinnt, eine ältere Löschung nicht', async () => {
    const settings = await getSettings();
    const set = await createSet({ title: 'X' });
    const [c] = await addCards(set.id, [{ front: 'a', back: 'neu' }]);
    const local = (await db.cards.get(c.id))!;
    await applyChanges([{ t: 'cards', id: c.id, op: 'put', at: local.updatedAt - 1000, data: { ...local, back: 'alt', updatedAt: local.updatedAt - 1000 } }], settings);
    expect((await db.cards.get(c.id))?.back).toBe('neu');
    await applyChanges([{ t: 'cards', id: c.id, op: 'del', at: local.updatedAt - 500 }], settings);
    expect(await db.cards.get(c.id)).toBeTruthy();
    await applyChanges([{ t: 'cards', id: c.id, op: 'del', at: local.updatedAt + 500 }], settings);
    expect(await db.cards.get(c.id)).toBeUndefined();
    // Nach der Löschung bringt ein alter Stand die Karte nicht zurück.
    await applyChanges([{ t: 'cards', id: c.id, op: 'put', at: local.updatedAt + 100, data: { ...local, updatedAt: local.updatedAt + 100 } }], settings);
    expect(await db.cards.get(c.id)).toBeUndefined();
  });
});
