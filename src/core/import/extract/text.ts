import Papa from 'papaparse';
import type { Block, Extracted, ImportFormat, ImportedCard } from '../types';

/** Text aus Bytes: UTF-8 bevorzugt, UTF-16 per BOM, sonst Windows-1252 (alte Excel-CSV). */
export function decodeText(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder('utf-16be').decode(bytes.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function extractLines(text: string, fileName: string, format: ImportFormat = 'txt'): Extracted {
  const blocks: Block[] = text
    .replace(/^﻿/, '')
    .split(/\r\n|\r|\n/)
    .map((line, i) => {
      const cells = line.includes('\t') ? line.split('\t') : undefined;
      return { text: line, cells: cells && cells.filter((c) => c.trim()).length >= 2 ? cells : undefined, source: String(i + 1) };
    });
  // Leerzeilen am Ende sind kein Inhalt.
  while (blocks.length && !blocks[blocks.length - 1].text.trim()) blocks.pop();
  return { format, fileName, unit: 'line', blocks, warnings: [] };
}

export function extractCsv(text: string, fileName: string, delimiter?: string): Extracted {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ''), {
    delimiter: delimiter ?? '',
    skipEmptyLines: 'greedy',
  });
  const blocks: Block[] = parsed.data.map((cells, i) => ({ text: cells.join('\t'), cells, source: String(i + 1) }));
  const warnings = parsed.errors.length ? ['csv-errors'] : [];
  const format: ImportFormat = (delimiter ?? parsed.meta.delimiter) === '\t' ? 'tsv' : 'csv';
  return { format, fileName, unit: 'row', blocks, warnings };
}

interface GrapnelExport {
  app: 'grapnel';
  sets: { set: { title: string; description?: string; frontLang: string; backLang: string }; cards: ImportedCard[] }[];
}

/** Eigener JSON-Export (ein Set) oder eine einfache Liste von {front, back}. */
export function extractJson(text: string, fileName: string): Extracted {
  const data = JSON.parse(text.replace(/^﻿/, '')) as unknown;
  const base = { format: 'json' as const, fileName, unit: 'card' as const, blocks: [], warnings: [] as string[] };
  if (data && typeof data === 'object' && (data as GrapnelExport).app === 'grapnel') {
    const exp = data as GrapnelExport;
    const first = exp.sets[0];
    if (!first) return { ...base, cards: [] };
    if (exp.sets.length > 1) base.warnings.push('json-multiple-sets');
    return {
      ...base,
      cards: first.cards,
      title: first.set.title,
      description: first.set.description,
      langs: { front: first.set.frontLang as never, back: first.set.backLang as never },
    };
  }
  if (Array.isArray(data)) {
    const cards: ImportedCard[] = data
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object')
      .map((x) => ({
        front: String(x.front ?? x.term ?? x.question ?? ''),
        back: String(x.back ?? x.definition ?? x.answer ?? ''),
        example: x.example === undefined ? '' : String(x.example),
      }));
    return { ...base, cards };
  }
  throw new Error('json-unknown');
}
