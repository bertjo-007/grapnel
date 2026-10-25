import JSZip from 'jszip';
import type { Block, Extracted } from '../types';
import { decodeXml, topLevelElements } from '../xml';

/**
 * Liest Absätze und Tabellen aus word/document.xml in Dokumentreihenfolge.
 * Tabulatoren innerhalb eines Absatzes werden zu Zellen, Tabellenzeilen ebenso.
 * Fett und Überschriften-Stile werden vermerkt: das hilft, Zwischentitel zu erkennen.
 */

const RUN = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
const TOKEN = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br(?:\s[^>]*)?\/>|<w:cr\/>|<w:noBreakHyphen\/>/g;

interface Para {
  text: string;
  bold: boolean;
  heading: boolean;
}

function parseParagraph(px: string): Para {
  const style = px.match(/<w:pStyle\s+w:val="([^"]*)"/)?.[1] ?? '';
  const heading = /^(heading|title|titel|berschrift|überschrift)/i.test(style) || /<w:outlineLvl\s/.test(px);
  let text = '';
  let anyText = false;
  let allBold = true;
  for (const run of px.matchAll(RUN)) {
    const body = run[1];
    const rPr = body.match(/<w:rPr>([\s\S]*?)<\/w:rPr>/)?.[1] ?? '';
    const bTag = rPr.match(/<w:b(?:\s+w:val="([^"]*)")?\s*\/>/);
    const bold = !!bTag && !/^(0|false|off)$/i.test(bTag[1] ?? '');
    let runText = '';
    for (const t of body.matchAll(TOKEN)) {
      const tok = t[0];
      if (tok.startsWith('<w:t')) runText += decodeXml(t[1] ?? '');
      else if (tok.startsWith('<w:tab')) runText += '\t';
      else if (tok.startsWith('<w:br') || tok.startsWith('<w:cr')) runText += '\n';
      else runText += '-';
    }
    if (runText.trim()) {
      anyText = true;
      if (!bold) allBold = false;
    }
    text += runText;
  }
  return { text, bold: anyText && allBold, heading };
}

const PARA = /<w:p(?:\s[^>]*)?\/>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;

function paragraphsText(xml: string): string {
  return Array.from(xml.matchAll(PARA))
    .map((m) => parseParagraph(m[0]).text)
    .join('\n')
    .trim();
}

export function parseDocumentXml(xml: string): Block[] {
  const bodyStart = xml.indexOf('<w:body');
  const body = bodyStart >= 0 ? xml.slice(bodyStart) : xml;
  const tables = topLevelElements(body, 'w:tbl');
  const blocks: Block[] = [];
  let paraNo = 0;
  let tableNo = 0;

  const addParas = (chunk: string) => {
    for (const m of chunk.matchAll(PARA)) {
      paraNo++;
      const p = parseParagraph(m[0]);
      const cells = p.text.includes('\t') ? p.text.split('\t').map((c) => c.trim()) : undefined;
      blocks.push({ text: p.text, cells: cells && cells.filter(Boolean).length >= 2 ? cells : undefined, source: String(paraNo), bold: p.bold, heading: p.heading });
    }
  };

  let pos = 0;
  for (const t of tables) {
    addParas(body.slice(pos, t.start));
    tableNo++;
    const tbl = body.slice(t.start, t.end);
    let rowNo = 0;
    for (const tr of topLevelElements(tbl, 'w:tr')) {
      const rowXml = tbl.slice(tr.start, tr.end);
      rowNo++;
      const cells = topLevelElements(rowXml, 'w:tc').map((tc) => paragraphsText(rowXml.slice(tc.start, tc.end)));
      blocks.push({ text: cells.join('\t'), cells, source: `T${tableNo}:${rowNo}` });
    }
    pos = t.end;
  }
  addParas(body.slice(pos));
  return blocks;
}

export async function extractDocx(data: ArrayBuffer | Uint8Array, fileName: string): Promise<Extracted> {
  const zip = await JSZip.loadAsync(data);
  const doc = zip.file('word/document.xml');
  if (!doc) throw new Error('docx-invalid');
  const xml = await doc.async('string');
  const blocks = parseDocumentXml(xml);
  const warnings: string[] = [];
  if (/<w:txbxContent/.test(xml)) warnings.push('docx-textboxes');
  // Titel aus den Dokumenteigenschaften, falls gesetzt.
  const core = await zip.file('docProps/core.xml')?.async('string');
  const title = core ? decodeXml(core.match(/<dc:title>([^<]*)<\/dc:title>/)?.[1] ?? '').trim() : '';
  return { format: 'docx', fileName, unit: 'paragraph', blocks, warnings, title: title || undefined };
}
