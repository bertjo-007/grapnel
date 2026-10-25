import type { ColumnMapping, Extracted, Structure } from './types';

/** Trennzeichen zur Auswahl. Reihenfolge = Vorrang bei der automatischen Erkennung. */
export const DELIMITERS: { value: string; label: string }[] = [
  { value: '\t', label: 'Tab' },
  { value: ';', label: ';' },
  { value: ' - ', label: '-' },
  { value: ' = ', label: '=' },
  { value: ':', label: ':' },
  { value: ',', label: ',' },
];

/** Trennzeichen, die auch im normalen Text vorkommen: dort nur am ersten Vorkommen trennen. */
export const SOFT_DELIMITERS = new Set([';', ',', ' - ', ':', ' = ']);

const HEADERS: Record<keyof ColumnMapping, string[]> = {
  front: ['front', 'vorderseite', 'begriff', 'term', 'wort', 'word', 'question', 'frage', 'français', 'francais', 'french', 'französisch', 'vokabel', 'fremdsprache', 'english', 'englisch', 'italiano', 'italienisch', 'español', 'spanisch'],
  back: ['back', 'rückseite', 'rueckseite', 'definition', 'bedeutung', 'meaning', 'answer', 'antwort', 'deutsch', 'german', 'übersetzung', 'uebersetzung', 'translation'],
  example: ['example', 'beispiel', 'beispielsatz', 'exemple', 'sentence', 'satz'],
  explanation: ['explanation', 'erklärung', 'erklaerung', 'info', 'zusatz', 'zusatzinfo', 'hinweis'],
  tags: ['tags', 'tag', 'schlagwörter', 'kategorie', 'category'],
  notes: ['notes', 'notizen', 'notiz', 'note'],
  answers: ['answers', 'varianten', 'akzeptierte antworten', 'alternatives', 'extra answers'],
  frontAnswers: ['front_answers', 'front answers', 'varianten vorderseite'],
  difficult: ['difficult', 'schwierig'],
  important: ['important', 'wichtig'],
};

export function emptyMapping(): ColumnMapping {
  return { front: 0, back: 1, example: 2, explanation: 3, tags: null, notes: null, answers: null, frontAnswers: null, difficult: null, important: null };
}

/** Erkennt eine Kopfzeile und leitet daraus die Spaltenzuordnung ab. */
export function detectHeader(cells: string[], columnCount: number): { mapping: ColumnMapping; isHeader: boolean } {
  const norm = cells.map((c) => c.trim().toLowerCase());
  const found: Partial<Record<keyof ColumnMapping, number>> = {};
  let hits = 0;
  norm.forEach((c, i) => {
    for (const key of Object.keys(HEADERS) as (keyof ColumnMapping)[]) {
      if (found[key] === undefined && HEADERS[key].includes(c)) {
        found[key] = i;
        hits++;
        break;
      }
    }
  });
  if (hits >= 2 && found.front !== undefined && found.back !== undefined) {
    return {
      isHeader: true,
      mapping: {
        front: found.front,
        back: found.back,
        example: found.example ?? null,
        explanation: found.explanation ?? null,
        tags: found.tags ?? null,
        notes: found.notes ?? null,
        answers: found.answers ?? null,
        frontAnswers: found.frontAnswers ?? null,
        difficult: found.difficult ?? null,
        important: found.important ?? null,
      },
    };
  }
  const m = emptyMapping();
  if (columnCount < 4) m.explanation = null;
  if (columnCount < 3) m.example = null;
  return { isHeader: false, mapping: m };
}

function occurrences(line: string, d: string): number {
  let n = 0;
  let i = line.indexOf(d);
  while (i >= 0) {
    n++;
    i = line.indexOf(d, i + d.length);
  }
  return n;
}

/** Ein Trennzeichen gilt, wenn es in fast allen Zeilen vorkommt (Komma: in praktisch allen genau einmal). */
export function detectDelimiter(lines: string[]): string | null {
  const content = lines.filter((l) => l.trim());
  if (content.length === 0) return null;
  for (const { value } of DELIMITERS) {
    const share =
      value === ','
        ? content.filter((l) => occurrences(l, value) === 1).length / content.length
        : content.filter((l) => occurrences(l, value) >= 1).length / content.length;
    if (share >= (value === ',' ? 0.9 : 0.7)) return value;
  }
  return null;
}

export function detectStructure(ex: Extracted): Structure {
  if (ex.cards) return { kind: 'cards' };
  const withCells = ex.blocks.filter((b) => b.cells && b.cells.length >= 2);
  if (withCells.length >= Math.max(2, ex.blocks.filter((b) => b.text.trim()).length * 0.5)) {
    const columnCount = Math.max(...withCells.map((b) => b.cells!.length));
    const { mapping, isHeader } = detectHeader(withCells[0].cells!, columnCount);
    return { kind: 'columns', mapping, hasHeader: isHeader };
  }
  const lines = ex.blocks.filter((b) => !b.heading && !b.bold).map((b) => b.text);
  const delimiter = detectDelimiter(lines);
  if (delimiter) return { kind: 'delimited', delimiter };
  const blank = ex.blocks.filter((b) => !b.text.trim()).length;
  if (blank >= ex.blocks.length * 0.2 && blank >= 2) {
    // Gruppen getrennt durch Leerzeilen, meist 2 bis 4 Zeilen lang.
    const sizes: number[] = [];
    let cur = 0;
    for (const b of ex.blocks) {
      if (b.text.trim()) cur++;
      else if (cur) {
        sizes.push(cur);
        cur = 0;
      }
    }
    if (cur) sizes.push(cur);
    const fitting = sizes.filter((s) => s >= 2 && s <= 4).length;
    if (sizes.length >= 2 && fitting >= sizes.length * 0.6) return { kind: 'blocks' };
  }
  return { kind: 'alternating' };
}
