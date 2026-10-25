import JSZip from 'jszip';
import type { Block, Extracted } from '../types';
import { attrs, decodeXml } from '../xml';

/** Liest alle Tabellenblätter einer XLSX-Datei als Zeilen mit Zellen (nur Werte, keine Formeln). */

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function textOf(xml: string): string {
  return Array.from(xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '').matchAll(/<t(?:\s[^>]*)?>([^<]*)<\/t>/g))
    .map((m) => decodeXml(m[1]))
    .join('');
}

export function parseSheet(xml: string, shared: string[]): Block[] {
  const blocks: Block[] = [];
  for (const row of xml.matchAll(/<row(\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const rowNo = attrs(row[1] ?? '').r ?? String(blocks.length + 1);
    const cells: string[] = [];
    for (const c of row[2].matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = attrs(c[1] ?? '');
      const inner = c[2] ?? '';
      const idx = a.r ? colIndex(a.r) : cells.length;
      let value = '';
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      if (a.t === 's' && v !== undefined) value = shared[parseInt(v, 10)] ?? '';
      else if (a.t === 'inlineStr') value = textOf(inner);
      else if (a.t === 'b') value = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) value = decodeXml(v);
      while (cells.length < idx) cells.push('');
      cells[idx] = value;
    }
    if (cells.some((c) => c.trim())) blocks.push({ text: cells.join('\t'), cells, source: rowNo });
  }
  return blocks;
}

export async function extractXlsx(data: ArrayBuffer | Uint8Array, fileName: string): Promise<Extracted> {
  const zip = await JSZip.loadAsync(data);
  const wb = await zip.file('xl/workbook.xml')?.async('string');
  if (!wb) throw new Error('xlsx-invalid');
  const rels = (await zip.file('xl/_rels/workbook.xml.rels')?.async('string')) ?? '';
  const targets = new Map<string, string>();
  for (const m of rels.matchAll(/<Relationship\s[^>]*\/?>/g)) {
    const a = attrs(m[0]);
    if (a.Id && a.Target) targets.set(a.Id, a.Target.replace(/^\/?xl\//, '').replace(/^\//, ''));
  }
  const sharedXml = (await zip.file('xl/sharedStrings.xml')?.async('string')) ?? '';
  const shared = Array.from(sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)).map((m) => textOf(m[1]));

  const sheets: { name: string; blocks: Block[] }[] = [];
  for (const m of wb.matchAll(/<sheet\s[^>]*\/?>/g)) {
    const a = attrs(m[0]);
    const target = targets.get(a['r:id'] ?? '');
    if (!target) continue;
    const xml = await zip.file(`xl/${target}`)?.async('string');
    if (!xml) continue;
    sheets.push({ name: a.name ?? `Sheet ${sheets.length + 1}`, blocks: parseSheet(xml, shared) });
  }
  const first = sheets.find((s) => s.blocks.length > 0) ?? sheets[0];
  return { format: 'xlsx', fileName, unit: 'row', blocks: first?.blocks ?? [], sheets, warnings: [] };
}
