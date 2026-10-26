import { db } from '../core/db/db';
import { commitImport } from '../core/import/commit';
import { detectStructure } from '../core/import/detect';
import { extractBytes } from '../core/import/extract';
import { annotateRows, buildRows } from '../core/import/rows';
import type { Extracted, ImportedCard } from '../core/import/types';
import type { Lang } from '../core/types';

/**
 * Nur im Dev-Server: legt Joshuas Wortlisten einmal pro Browser als Sets an, mit allen
 * Einträgen (auch doppelten). Die Dateien liegen in tests/fixtures/private und sind nicht
 * im Repo; fehlen sie, passiert nichts. Browser-Tests (navigator.webdriver) starten leer.
 *
 * - franzoesischwoerter.docx: die Quizlet-Kopie, ein Set «Französischwörter».
 * - *.json: Grapnel-Format mit mehreren Sets (z. B. aus den Langenscheidt-.xls-Dateien).
 */

interface SeedSet {
  set: { title: string; description?: string; frontLang: Lang; backLang: Lang };
  cards: ImportedCard[];
}

const DOCX_TITLE = 'Französischwörter';
const docx = import.meta.glob<string>('../../tests/fixtures/private/franzoesischwoerter.docx', { query: '?url', import: 'default' });
const lists = import.meta.glob<{ sets: SeedSet[] }>('../../tests/fixtures/private/*.json', { import: 'default' });

export async function seedDevData(): Promise<void> {
  if (navigator.webdriver) return;
  const loadDocx = Object.values(docx)[0];
  if (loadDocx) {
    await seedSet('devSeed:franzoesischwoerter', { title: DOCX_TITLE, frontLang: 'fr', backLang: 'de' }, async () => {
      const data = await (await fetch(await loadDocx())).arrayBuffer();
      return extractBytes(data, `${DOCX_TITLE}.docx`);
    });
  }
  for (const [path, load] of Object.entries(lists)) {
    const fileName = path.split('/').pop() ?? path;
    for (const s of (await load()).sets) {
      await seedSet(`devSeed:${s.set.title}`, s.set, async () => ({ format: 'json', fileName, unit: 'card', blocks: [], warnings: [], cards: s.cards }));
    }
  }
}

async function seedSet(key: string, set: SeedSet['set'], load: () => Promise<Extracted>): Promise<void> {
  if (await db.meta.get(key)) return;
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
  await db.meta.put({ key, value: { setId: res.setId, imported: res.imported, at: Date.now() } });
  console.info(`[Grapnel] ${set.title}: ${res.imported} Karten eingefügt`);
}
