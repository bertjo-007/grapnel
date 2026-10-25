import { looseKey } from '../answer/normalize';
import type { Card, Lang } from '../types';
import { SOFT_DELIMITERS } from './detect';
import { pairAlternating } from './pair';
import type { Block, ColumnMapping, Extracted, PreviewRow, RowStatus, Structure } from './types';

/**
 * Baut aus extrahierten Blöcken die Zeilen der Import-Vorschau. Inhalte werden exakt
 * übernommen (nur Leerraum an den Rändern entfernt). Nichts wird verworfen: Zeilen, die
 * keinem Eintrag zugeordnet werden können, erscheinen als «nicht zugeordnet».
 */

let counter = 0;
const rowKey = () => `r${++counter}`;

function emptyRow(index: number, source: string): PreviewRow {
  return {
    key: rowKey(),
    index,
    source,
    front: '',
    back: '',
    example: '',
    explanation: '',
    tags: [],
    notes: '',
    flagDifficult: false,
    flagImportant: false,
    extraAnswers: [],
    extraFrontAnswers: [],
    unassigned: false,
    uncertain: false,
    statuses: [],
    duplicateOf: null,
    matchId: null,
    sourceId: null,
    selected: true,
    touched: false,
  };
}

const clean = (s: string | undefined) => (s ?? '').replace(/\r\n?/g, '\n').trim();
const splitList = (s: string, sep: RegExp) => clean(s).split(sep).map((x) => x.trim()).filter(Boolean);
const truthy = (s: string | undefined) => /^(x|1|true|ja|yes|wahr|✓)$/i.test(clean(s));

function unassignedRow(b: Block, index: number): PreviewRow {
  const r = emptyRow(index, b.source);
  r.front = clean(b.text);
  r.unassigned = true;
  r.selected = false;
  return r;
}

function fromColumns(blocks: Block[], m: ColumnMapping, hasHeader: boolean): PreviewRow[] {
  const rows: PreviewRow[] = [];
  let headerSkipped = !hasHeader;
  for (const b of blocks) {
    if (!b.text.trim() && !(b.cells ?? []).some((c) => c.trim())) continue;
    if (!b.cells || b.cells.length < 2) {
      rows.push(unassignedRow(b, rows.length));
      continue;
    }
    if (!headerSkipped) {
      headerSkipped = true;
      continue;
    }
    const c = b.cells;
    const at = (i: number | null) => (i === null ? '' : clean(c[i]));
    const r = emptyRow(rows.length, b.source);
    r.front = at(m.front);
    r.back = at(m.back);
    r.example = at(m.example);
    r.explanation = at(m.explanation);
    r.tags = m.tags === null ? [] : splitList(c[m.tags] ?? '', /[|,]/);
    r.notes = at(m.notes);
    r.extraAnswers = m.answers === null ? [] : splitList(c[m.answers] ?? '', /\|/);
    r.extraFrontAnswers = m.frontAnswers === null ? [] : splitList(c[m.frontAnswers] ?? '', /\|/);
    r.flagDifficult = m.difficult !== null && truthy(c[m.difficult]);
    r.flagImportant = m.important !== null && truthy(c[m.important]);
    if (b.confidence !== undefined && b.confidence < 0.75) r.uncertain = true;
    rows.push(r);
  }
  return rows;
}

function fromDelimited(blocks: Block[], d: string): PreviewRow[] {
  const rows: PreviewRow[] = [];
  for (const b of blocks) {
    const text = b.text;
    if (!text.trim()) continue;
    if (b.heading || b.bold) {
      if (!text.includes(d)) {
        rows.push(unassignedRow(b, rows.length));
        continue;
      }
    }
    const r = emptyRow(rows.length, b.source);
    const first = text.indexOf(d);
    if (first < 0) {
      r.front = clean(text);
      r.uncertain = true;
    } else if (SOFT_DELIMITERS.has(d)) {
      // Nur am ersten Vorkommen trennen; mehrere Vorkommen = mehrdeutig, zur Prüfung markieren.
      r.front = clean(text.slice(0, first));
      r.back = clean(text.slice(first + d.length));
      if (text.indexOf(d, first + d.length) >= 0) r.uncertain = true;
    } else {
      const parts = text.split(d);
      r.front = clean(parts[0]);
      r.back = clean(parts[1]);
      r.example = clean(parts[2]);
      r.explanation = clean(parts.slice(3).join(' '));
    }
    if (b.confidence !== undefined && b.confidence < 0.75) r.uncertain = true;
    rows.push(r);
  }
  return rows;
}

function fromAlternating(blocks: Block[], front: Lang, back: Lang): PreviewRow[] {
  const rows: PreviewRow[] = [];
  for (const item of pairAlternating(blocks, front, back)) {
    if (item.kind === 'skip') {
      rows.push(unassignedRow(blocks[item.index], rows.length));
      continue;
    }
    const f = blocks[item.front];
    const bk = item.back === null ? null : blocks[item.back];
    const r = emptyRow(rows.length, bk ? `${f.source}+${bk.source}` : f.source);
    r.front = clean(f.text);
    r.back = clean(bk?.text);
    r.uncertain = item.uncertain || (f.confidence ?? 1) < 0.75 || (bk?.confidence ?? 1) < 0.75;
    rows.push(r);
  }
  return rows;
}

function fromGroups(blocks: Block[]): PreviewRow[] {
  const rows: PreviewRow[] = [];
  let group: Block[] = [];
  const flush = () => {
    if (!group.length) return;
    const r = emptyRow(rows.length, group[0].source);
    r.front = clean(group[0].text);
    r.back = clean(group[1]?.text);
    r.example = clean(group[2]?.text);
    r.explanation = clean(group.slice(3).map((b) => b.text).join('\n'));
    r.uncertain = group.some((b) => (b.confidence ?? 1) < 0.75);
    rows.push(r);
    group = [];
  };
  for (const b of blocks) {
    if (!b.text.trim()) flush();
    else group.push(b);
  }
  flush();
  return rows;
}

export function buildRows(ex: Extracted, st: Structure, langs: { front: Lang; back: Lang }): PreviewRow[] {
  switch (st.kind) {
    case 'cards':
      return (ex.cards ?? []).map((c, i) => {
        const r = emptyRow(i, String(i + 1));
        r.front = clean(c.front);
        r.back = clean(c.back);
        r.example = clean(c.example);
        r.explanation = clean(c.explanation);
        r.tags = c.tags ?? [];
        r.notes = clean(c.notes);
        r.flagDifficult = !!c.flagDifficult;
        r.flagImportant = !!c.flagImportant;
        r.extraAnswers = c.extraAnswers ?? [];
        r.extraFrontAnswers = c.extraFrontAnswers ?? [];
        r.sourceId = c.id ?? null;
        return r;
      });
    case 'columns':
      return fromColumns(ex.blocks, st.mapping, st.hasHeader);
    case 'delimited':
      return fromDelimited(ex.blocks, st.delimiter);
    case 'blocks':
      return fromGroups(ex.blocks);
    case 'alternating':
      return fromAlternating(ex.blocks, langs.front, langs.back);
  }
}

export type ImportTarget = 'new' | 'append' | 'update';

export const contentKey = (front: string, back: string) => `${looseKey(front)}\u0000${looseKey(back)}`;

function sameContent(r: PreviewRow, c: Card): boolean {
  return (
    looseKey(r.front) === looseKey(c.front) &&
    looseKey(r.back) === looseKey(c.back) &&
    (r.example || '') === (c.example || '') &&
    (r.explanation || '') === (c.explanation || '')
  );
}

/**
 * Bestimmt den Status jeder Zeile neu und setzt die Vorauswahl. Vom Benutzer
 * angefasste Zeilen behalten ihre Auswahl.
 */
export function annotateRows(rows: PreviewRow[], target: ImportTarget, existing: Card[] = []): PreviewRow[] {
  const seen = new Map<string, number>();
  const fronts = new Map<string, string>();
  const existingKeys = new Set(existing.map((c) => contentKey(c.front, c.back)));
  const byId = new Map(existing.map((c) => [c.id, c]));
  const byFront = new Map<string, Card[]>();
  for (const c of existing) {
    const k = looseKey(c.front);
    byFront.set(k, [...(byFront.get(k) ?? []), c]);
  }
  const usedMatches = new Set<string>();

  return rows.map((row) => {
    const r: PreviewRow = { ...row, statuses: [], duplicateOf: null, matchId: null };
    if (r.unassigned) {
      r.statuses = ['unassigned'];
      if (!r.touched) r.selected = false;
      return r;
    }
    const st: RowStatus[] = [];
    if (!r.front.trim() || !r.back.trim()) st.push('incomplete');
    if (r.uncertain) st.push('uncertain');
    const key = contentKey(r.front, r.back);
    const firstIdx = seen.get(key);
    if (firstIdx !== undefined) {
      st.push('duplicate');
      r.duplicateOf = firstIdx;
    } else {
      seen.set(key, r.index);
      const fk = looseKey(r.front);
      if (fk && fronts.has(fk) && fronts.get(fk) !== key) st.push('same-front');
      if (fk && !fronts.has(fk)) fronts.set(fk, key);
    }

    let unchanged = false;
    if (target === 'append' && existingKeys.has(key)) st.push('exists');
    if (target === 'update') {
      let match: Card | undefined;
      if (r.sourceId && byId.has(r.sourceId) && !usedMatches.has(r.sourceId)) match = byId.get(r.sourceId);
      if (!match) match = (byFront.get(looseKey(r.front)) ?? []).find((c) => !usedMatches.has(c.id));
      if (match) {
        usedMatches.add(match.id);
        r.matchId = match.id;
        if (sameContent(r, match)) {
          st.push('exists');
          unchanged = true;
        } else st.push('changed');
      }
    }
    r.statuses = st.length ? st : ['ok'];
    if (!r.touched) {
      r.selected = !st.includes('incomplete') && !st.includes('duplicate') && !(target === 'append' && st.includes('exists')) && !unchanged;
    }
    return r;
  });
}

export interface RowSummary {
  recognized: number;
  selected: number;
  duplicates: number;
  incomplete: number;
  uncertain: number;
  unassigned: number;
  exists: number;
  changed: number;
  sameFront: number;
  problematic: number;
}

export function summarize(rows: PreviewRow[]): RowSummary {
  const has = (s: RowStatus) => rows.filter((r) => r.statuses.includes(s)).length;
  const problemStatuses: RowStatus[] = ['incomplete', 'duplicate', 'uncertain', 'unassigned', 'exists'];
  return {
    recognized: rows.filter((r) => !r.unassigned).length,
    selected: rows.filter((r) => r.selected).length,
    duplicates: has('duplicate'),
    incomplete: has('incomplete'),
    uncertain: has('uncertain'),
    unassigned: has('unassigned'),
    exists: has('exists'),
    changed: has('changed'),
    sameFront: has('same-front'),
    problematic: rows.filter((r) => r.statuses.some((s) => problemStatuses.includes(s))).length,
  };
}

/** Vorder- und Rückseite aller Zeilen tauschen. */
export function swapSides(rows: PreviewRow[]): PreviewRow[] {
  return rows.map((r) =>
    r.unassigned ? r : { ...r, front: r.back, back: r.front, extraAnswers: r.extraFrontAnswers, extraFrontAnswers: r.extraAnswers },
  );
}
