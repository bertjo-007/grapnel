import type { Block, Extracted } from '../types';

/**
 * PDF mit Textebene: Textstücke werden nach Höhe zu Zeilen gruppiert. Grosse waagrechte
 * Lücken innerhalb einer Zeile werden zu Spalten (Tabellen in PDFs sind meist so gesetzt).
 * pdf.js wird erst geladen, wenn wirklich eine PDF importiert wird.
 */

export interface TextItemLite {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export function groupTextItems(items: TextItemLite[], page: number): Block[] {
  const usable = items.filter((i) => i.str.length > 0);
  if (!usable.length) return [];
  const sorted = usable.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: TextItemLite[][] = [];
  for (const it of sorted) {
    const line = lines[lines.length - 1];
    const ref = line?.[0];
    if (ref && Math.abs(ref.y - it.y) <= Math.max(2, Math.min(ref.h, it.h) * 0.5)) line.push(it);
    else lines.push([it]);
  }
  return lines.map((line, n) => {
    line.sort((a, b) => a.x - b.x);
    let text = '';
    const cells: string[] = [''];
    for (let i = 0; i < line.length; i++) {
      const it = line[i];
      if (i > 0) {
        const prev = line[i - 1];
        const gap = it.x - (prev.x + prev.w);
        const charW = prev.str.trim().length ? prev.w / Math.max(1, prev.str.length) : prev.h * 0.5;
        if (gap > Math.max(charW * 2.5, prev.h * 1.2)) {
          text += '\t';
          cells.push('');
        } else if (gap > prev.h * 0.15 && !text.endsWith(' ') && !it.str.startsWith(' ')) {
          text += ' ';
          cells[cells.length - 1] += ' ';
        }
      }
      text += it.str;
      cells[cells.length - 1] += it.str;
    }
    const trimmed = cells.map((c) => c.trim());
    return {
      text: text.replace(/ +/g, ' ').trim(),
      cells: trimmed.filter(Boolean).length >= 2 ? trimmed : undefined,
      source: `${page}:${n + 1}`,
    };
  });
}

async function loadPdfjs() {
  const pdfjs = await import('pdfjs-dist');
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  return pdfjs;
}

export async function extractPdf(data: ArrayBuffer, fileName: string): Promise<Extracted> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const blocks: Block[] = [];
  let chars = 0;
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items: TextItemLite[] = [];
    for (const raw of content.items) {
      if (!('str' in raw)) continue;
      const t = raw.transform as number[];
      items.push({ str: raw.str, x: t[4], y: t[5], w: raw.width, h: raw.height || Math.abs(t[3]) || 10 });
      chars += raw.str.trim().length;
    }
    blocks.push(...groupTextItems(items, p));
  }
  const needsOcr = chars < 20;
  return { format: 'pdf', fileName, unit: 'page', blocks, warnings: needsOcr ? ['pdf-no-text'] : [], needsOcr };
}

/** Rendert PDF-Seiten als Bilder für die Texterkennung. */
export async function renderPdfPages(data: ArrayBuffer, onPage?: (done: number, total: number) => void): Promise<HTMLCanvasElement[]> {
  const pdfjs = await loadPdfjs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)) }).promise;
  const out: HTMLCanvasElement[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    out.push(canvas);
    onPage?.(p, doc.numPages);
  }
  return out;
}
