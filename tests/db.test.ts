import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/core/db/db';
import {
  addCards,
  createSet,
  deleteSet,
  duplicateCard,
  getSettings,
  insertCardAfter,
  moveCard,
  overrideAnswer,
  recordAnswer,
  wipeAllData,
} from '../src/core/db/repo';
import { cardsToDelimited, exportJson, restoreBackup } from '../src/core/export/export';
import { commitImport } from '../src/core/import/commit';
import { detectStructure } from '../src/core/import/detect';
import { extractCsv, extractJson } from '../src/core/import/extract/text';
import { annotateRows, buildRows } from '../src/core/import/rows';
import { progressOverTime, setStats } from '../src/core/stats/stats';
import type { Card } from '../src/core/types';

const ordered = (setId: string) => db.cards.where('[setId+position]').between([setId, -Infinity], [setId, Infinity]).toArray();

beforeEach(async () => {
  await wipeAllData();
});

describe('Karten und Reihenfolge', () => {
  it('fügt ein, dupliziert und verschiebt', async () => {
    const set = await createSet({ title: 'Familie', frontLang: 'fr', backLang: 'de' });
    const [a, b, c] = await addCards(set.id, [
      { front: 'la mère', back: 'die Mutter' },
      { front: 'le père', back: 'der Vater' },
      { front: 'la sœur', back: 'die Schwester' },
    ]);
    await insertCardAfter(set.id, a.id, { front: 'la tante', back: 'die Tante' });
    await duplicateCard(c.id);
    await moveCard(b.id, null, a.id);
    const fronts = (await ordered(set.id)).map((x) => x.front);
    expect(fronts).toEqual(['le père', 'la mère', 'la tante', 'la sœur', 'la sœur']);
  });
});

describe('Antworten und Lernstand', () => {
  it('speichert Antworten, korrigiert per «Ich hatte recht» und löscht kaskadierend', async () => {
    const settings = await getSettings();
    const set = await createSet({ title: 'X', frontLang: 'fr', backLang: 'de' });
    const [card] = await addCards(set.id, [{ front: 'la tante', back: 'die Tante' }]);
    const { log, state } = await recordAnswer({ card, direction: 'f2b', sessionId: null, mode: 'write', task: 'write', result: 'wrong', rating: 1 }, settings);
    expect(state.wrong).toBe(1);
    expect(state.fsrs.state).not.toBe(0);
    const fixed = await overrideAnswer(log.id, settings);
    expect(fixed?.wrong).toBe(0);
    expect(fixed?.correct).toBe(1);
    expect(await db.reviewLogs.count()).toBe(2);
    expect((await db.sets.get(set.id))?.lastStudiedAt).not.toBeNull();

    await deleteSet(set.id);
    expect(await db.cards.count()).toBe(0);
    expect(await db.reviewLogs.count()).toBe(0);
    expect(await db.cardStates.count()).toBe(0);
  });

  it('zeigt Schreiben von Deutsch nach Französisch im Lernstand beider Richtungen', async () => {
    const settings = await getSettings();
    const set = await createSet({ title: 'Richtung', frontLang: 'fr', backLang: 'de' });
    const cards = await addCards(set.id, [
      { front: 'la maison', back: 'das Haus' },
      { front: 'le chat', back: 'die Katze' },
      { front: 'le chien', back: 'der Hund' },
    ]);
    // Karte 1 nur DE→FR geschrieben, Karte 2 in beiden Richtungen, Karte 3 nie.
    const write = (card: Card, direction: 'f2b' | 'b2f', result: 'correct' | 'wrong', at: number) =>
      recordAnswer({ card, direction, sessionId: null, mode: 'write', task: 'write', result, rating: result === 'correct' ? 3 : 1, at }, settings);
    const t0 = Date.now();
    await write(cards[0], 'b2f', 'correct', t0);
    await write(cards[1], 'f2b', 'correct', t0);
    await write(cards[1], 'b2f', 'wrong', t0 + 60_000);

    const states = new Map((await db.cardStates.toArray()).map((s) => [s.key, s]));
    const both = setStats(cards, states, 'both', t0 + 120_000);
    expect(both.new).toBe(1);
    expect(both.learning).toBe(2);
    expect(both.lastActivity).toBe(t0 + 60_000);
    // Die einzelnen Richtungen bleiben getrennt sichtbar.
    expect(setStats(cards, states, 'f2b', t0 + 120_000).new).toBe(2);
    expect(setStats(cards, states, 'b2f', t0 + 120_000).new).toBe(1);

    const logs = await db.reviewLogs.toArray();
    const days = progressOverTime(cards, logs, 'both', settings, t0 + 120_000, 3);
    expect(days.at(-1)).toMatchObject({ new: 1, learning: 2 });
    expect(progressOverTime(cards, logs, 'f2b', settings, t0 + 120_000, 3).at(-1)).toMatchObject({ new: 2, learning: 1 });
  });
});

describe('Import übernehmen', () => {
  it('importiert genau die ausgewählten Zeilen und behält beim Aktualisieren den Lernstand', async () => {
    const settings = await getSettings();
    const ex = extractCsv('front,back\nla mère,die Mutter\nle père,der Vater\nla mère,die Mutter\n', 'f.csv');
    const rows = annotateRows(buildRows(ex, detectStructure(ex), { front: 'fr', back: 'de' }), 'new');
    const res = await commitImport({ rows, target: 'new', fileName: 'f.csv', format: 'csv', newSet: { title: 'Familie', description: '', frontLang: 'fr', backLang: 'de' } });
    expect(res).toMatchObject({ ok: true, imported: 2, expectedNew: 2 });
    const batch = await db.importBatches.get(res.batchId);
    expect(batch).toMatchObject({ recognized: 3, selected: 2, imported: 2 });

    const [mere] = (await ordered(res.setId)).filter((c) => c.front === 'la mère');
    await recordAnswer({ card: mere, direction: 'f2b', sessionId: null, mode: 'write', task: 'write', result: 'correct', rating: 3 }, settings);

    const ex2 = extractCsv('front,back\nla mère,die Mutter (Mama)\nla tante,die Tante\n', 'g.csv');
    const existing = await ordered(res.setId);
    const rows2 = annotateRows(buildRows(ex2, detectStructure(ex2), { front: 'fr', back: 'de' }), 'update', existing);
    expect(rows2[0].statuses).toContain('changed');
    const res2 = await commitImport({ rows: rows2, target: 'update', setId: res.setId, fileName: 'g.csv', format: 'csv' });
    expect(res2).toMatchObject({ ok: true, imported: 1, updated: 1 });
    const after = await db.cards.get(mere.id);
    expect(after?.back).toBe('die Mutter (Mama)');
    expect(await db.cardStates.get(`${mere.id}:f2b`)).toBeTruthy();
  });
});

describe('Export und Wiederimport', () => {
  const tricky: Partial<Card>[] = [
    { front: 'l\'été', back: 'der Sommer; Sommer-', example: 'C\'est l\'été, "enfin".', tags: ['Zeit', 'Jahr'], notes: 'zwei\nZeilen', flagDifficult: true, extraAnswers: ['Sommerzeit'] },
    { front: 'la sœur', back: 'die Schwester, Schwesterchen', explanation: 'Tab\there', flagImportant: true },
    { front: ' Leerzeichen ', back: 'ß & ü', example: '' },
  ];

  it('CSV und TSV kommen unverändert zurück', async () => {
    const set = await createSet({ title: 'Rund', frontLang: 'fr', backLang: 'de' });
    const cards = await addCards(set.id, tricky as never);
    for (const delimiter of [',', '\t'] as const) {
      const text = cardsToDelimited(cards, new Map(), { delimiter, extras: true, progress: false });
      const ex = extractCsv(text, delimiter === ',' ? 'x.csv' : 'x.tsv', delimiter === '\t' ? '\t' : undefined);
      const st = detectStructure(ex);
      expect(st.kind).toBe('columns');
      const rows = buildRows(ex, st, { front: 'fr', back: 'de' });
      expect(rows).toHaveLength(3);
      rows.forEach((r, i) => {
        const c = cards[i];
        expect(r.front).toBe(c.front.trim());
        expect(r.back).toBe(c.back);
        expect(r.example).toBe(c.example);
        expect(r.explanation).toBe(c.explanation);
        expect(r.tags).toEqual(c.tags);
        expect(r.notes).toBe(c.notes);
        expect(r.flagDifficult).toBe(c.flagDifficult);
        expect(r.flagImportant).toBe(c.flagImportant);
        expect(r.extraAnswers).toEqual(c.extraAnswers);
      });
    }
  });

  it('JSON-Sicherung stellt Karten und Lernstand wieder her', async () => {
    const settings = await getSettings();
    const set = await createSet({ title: 'Backup', frontLang: 'fr', backLang: 'de' });
    const cards = await addCards(set.id, tricky as never);
    await recordAnswer({ card: cards[0], direction: 'f2b', sessionId: null, mode: 'write', task: 'write', result: 'correct', rating: 3 }, settings);
    const before = await db.cardStates.get(`${cards[0].id}:f2b`);
    const file = await exportJson('all', { progress: true, media: true });
    const json = JSON.stringify(file);

    // Als Set wieder importierbar:
    const ex = extractJson(json, 'b.json');
    expect(ex.cards?.map((c) => c.front)).toEqual(cards.map((c) => c.front));

    await wipeAllData();
    const res = await restoreBackup(JSON.parse(json), settings);
    expect(res).toMatchObject({ sets: 1, cards: 3, logs: 1 });
    const after = await db.cardStates.get(`${cards[0].id}:f2b`);
    expect(after?.fsrs).toEqual(before?.fsrs);
    expect((await db.cards.get(cards[0].id))?.notes).toBe('zwei\nZeilen');
  });
});
