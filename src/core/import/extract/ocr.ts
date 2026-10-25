import type { Lang } from '../../types';
import type { Block, Extracted } from '../types';

/**
 * Texterkennung für Fotos und gescannte PDFs mit tesseract.js. Die Erkennung läuft im
 * Browser auf dem Gerät; nur die Sprachdaten (einige MB) werden beim ersten Mal von
 * jsDelivr geladen. Die Datei selbst verlässt das Gerät nicht.
 * Jede Zeile bekommt ihre Erkennungssicherheit mit, unsichere Zeilen werden markiert.
 */

const TESS_LANG: Record<Lang, string | null> = { fr: 'fra', de: 'deu', en: 'eng', it: 'ita', es: 'spa', other: null };

export type OcrImage = HTMLCanvasElement | Blob | File;

export async function ocrImages(
  images: OcrImage[],
  langs: Lang[],
  fileName: string,
  onProgress?: (fraction: number) => void,
): Promise<Extracted> {
  const { createWorker } = await import('tesseract.js');
  const codes = Array.from(new Set(langs.map((l) => TESS_LANG[l]).filter((c): c is string => !!c)));
  let page = 0;
  const worker = await createWorker(codes.length ? codes : ['eng'], undefined, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text') onProgress?.((page + m.progress) / images.length);
    },
  });
  const blocks: Block[] = [];
  try {
    for (page = 0; page < images.length; page++) {
      const { data } = await worker.recognize(images[page], {}, { blocks: true, text: true });
      let lineNo = 0;
      for (const block of data.blocks ?? []) {
        for (const para of block.paragraphs) {
          for (const line of para.lines) {
            lineNo++;
            const words = line.words.filter((w) => w.text.trim());
            let text = '';
            const cells: string[] = [''];
            words.forEach((w, i) => {
              if (i > 0) {
                const prev = words[i - 1];
                const gap = w.bbox.x0 - prev.bbox.x1;
                const charW = (prev.bbox.x1 - prev.bbox.x0) / Math.max(1, prev.text.length);
                if (gap > charW * 3) {
                  text += '\t';
                  cells.push('');
                } else {
                  text += ' ';
                  cells[cells.length - 1] += ' ';
                }
              }
              text += w.text;
              cells[cells.length - 1] += w.text;
            });
            const trimmed = cells.map((c) => c.trim());
            blocks.push({
              text: text.trim(),
              cells: trimmed.filter(Boolean).length >= 2 ? trimmed : undefined,
              source: `${page + 1}:${lineNo}`,
              confidence: line.confidence / 100,
            });
          }
        }
      }
      onProgress?.((page + 1) / images.length);
    }
  } finally {
    await worker.terminate();
  }
  return { format: 'image', fileName, unit: 'page', blocks, warnings: ['ocr-review'] };
}
