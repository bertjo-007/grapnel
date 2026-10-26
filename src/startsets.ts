import { db } from './core/db/db';
import { commitImport } from './core/import/commit';
import { detectStructure } from './core/import/detect';
import { extractBytes } from './core/import/extract';
import { annotateRows, buildRows } from './core/import/rows';
import type { Extracted, ImportedCard } from './core/import/types';
import type { Lang } from './core/types';

/**
 * Startsets: Beim ersten Öffnen legt Grapnel die Französisch-Wortlisten aus public/startsets
 * als Sets an, jedes einmal pro Browser und mit allen Einträgen (auch doppelten). Wer ein Set
 * löscht, bekommt es nicht zurück. Browser-Tests (navigator.webdriver) starten leer.
 *
 * - franzoesischwoerter.docx: Quizlet-Kopie, ein Set «Französischwörter».
 * - langenscheidt.json: Grapnel-Format mit einem Set pro Kapitel (aus den Langenscheidt-.xls).
 */

interface StartSet {
  set: { title: string; description?: string; frontLang: Lang; backLang: Lang };
  cards: ImportedCard[];
}

const DIR = `${import.meta.env.BASE_URL}startsets/`;
const DOCX_TITLE = 'Französischwörter';

export async function loadStartSets(): Promise<void> {
  if (navigator.webdriver) return;
  await addOnce('franzoesischwoerter', { title: DOCX_TITLE, frontLang: 'fr', backLang: 'de' }, async () => {
    const res = await fetch(`${DIR}franzoesischwoerter.docx`);
    if (!res.ok) throw new Error(`startset-${res.status}`);
    return extractBytes(await res.arrayBuffer(), `${DOCX_TITLE}.docx`);
  });
  const res = await fetch(`${DIR}langenscheidt.json`);
  if (!res.ok) return;
  for (const s of ((await res.json()) as { sets: StartSet[] }).sets) {
    await addOnce(s.set.title, s.set, async () => ({ format: 'json', fileName: 'langenscheidt.json', unit: 'card', blocks: [], warnings: [], cards: s.cards }));
  }
}

async function addOnce(id: string, set: StartSet['set'], load: () => Promise<Extracted>): Promise<void> {
  // «devSeed:» stammt aus der Zeit, als nur der Dev-Server die Listen einfügte.
  if ((await db.meta.get(`startSet:${id}`)) || (await db.meta.get(`devSeed:${id}`))) return;
  // Hat jemand das Set schon selbst angelegt, bleibt es unberührt.
  if (await db.sets.filter((s) => s.title === set.title && !s.archivedAt).count()) return;

  const ex = await load();
  const langs = { front: set.frontLang, back: set.backLang };
  const rows = annotateRows(buildRows(ex, detectStructure(ex), langs), 'new').map((r) => ({ ...r, selected: !r.unassigned }));
  const res = await commitImport({
    rows,
    target: 'new',
    newSet: { title: set.title, description: set.description ?? '', frontLang: langs.front, backLang: langs.back },
    fileName: ex.fileName,
    format: ex.format,
  });
  await db.meta.put({ key: `startSet:${id}`, value: { setId: res.setId, imported: res.imported, at: Date.now() } });
}
