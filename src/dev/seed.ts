import { db } from '../core/db/db';
import { commitImport } from '../core/import/commit';
import { detectStructure } from '../core/import/detect';
import { extractBytes } from '../core/import/extract';
import { annotateRows, buildRows } from '../core/import/rows';

/**
 * Nur im Dev-Server: legt Joshuas Wortliste einmal pro Browser als Set an, mit allen Paaren
 * (auch den doppelten). Die Datei liegt in tests/fixtures/private und ist nicht im Repo;
 * fehlt sie, passiert nichts. Browser-Tests (navigator.webdriver) starten weiter leer.
 */

const TITLE = 'Französischwörter';
const DONE_KEY = 'devSeed:franzoesischwoerter';
const files = import.meta.glob<string>('../../tests/fixtures/private/franzoesischwoerter.docx', { query: '?url', import: 'default' });

export async function seedDevData(): Promise<void> {
  const load = Object.values(files)[0];
  if (!load || navigator.webdriver) return;
  if (await db.meta.get(DONE_KEY)) return;
  // Hat jemand das Set schon selbst importiert, bleibt es unberührt.
  if (await db.sets.filter((s) => s.title === TITLE && !s.archivedAt).count()) return;

  const data = await (await fetch(await load())).arrayBuffer();
  const ex = await extractBytes(data, `${TITLE}.docx`);
  const langs = { front: 'fr', back: 'de' } as const;
  const rows = annotateRows(buildRows(ex, detectStructure(ex), langs), 'new').map((r) => ({ ...r, selected: !r.unassigned }));
  const res = await commitImport({
    rows,
    target: 'new',
    newSet: { title: TITLE, description: '', frontLang: langs.front, backLang: langs.back },
    fileName: ex.fileName,
    format: ex.format,
  });
  await db.meta.put({ key: DONE_KEY, value: { setId: res.setId, imported: res.imported, at: Date.now() } });
  console.info(`[Grapnel] ${TITLE}: ${res.imported} Karten eingefügt`);
}
