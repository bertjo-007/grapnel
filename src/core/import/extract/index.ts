import type { Extracted } from '../types';
import { extractDocx } from './docx';
import { decodeText, extractCsv, extractJson, extractLines } from './text';
import { extractXlsx } from './xlsx';

/** Endungen, die der Import annimmt (für das Dateifeld). */
export const ACCEPTED_FILES = '.txt,.csv,.tsv,.tab,.xlsx,.docx,.pdf,.json,.png,.jpg,.jpeg,.webp,.heic';

export type FileKind = 'txt' | 'csv' | 'tsv' | 'xlsx' | 'docx' | 'pdf' | 'json' | 'image' | 'unknown';

export function kindOf(name: string, mime = ''): FileKind {
  const ext = name.toLowerCase().split('.').pop() ?? '';
  if (ext === 'txt' || mime === 'text/plain') return 'txt';
  if (ext === 'csv' || mime === 'text/csv') return 'csv';
  if (ext === 'tsv' || ext === 'tab') return 'tsv';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'docx') return 'docx';
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'json') return 'json';
  if (/^(png|jpe?g|webp|heic|gif|bmp)$/.test(ext) || mime.startsWith('image/')) return 'image';
  return 'unknown';
}

/**
 * Liest eine Datei in Blöcke. PDF und Bilder werden hier nicht behandelt, weil sie
 * grosse Bibliotheken nachladen (siehe pdf.ts und ocr.ts); das übernimmt die Oberfläche.
 */
export async function extractBytes(data: ArrayBuffer, name: string, mime = ''): Promise<Extracted> {
  switch (kindOf(name, mime)) {
    case 'txt':
      return extractLines(decodeText(data), name, 'txt');
    case 'csv':
      return extractCsv(decodeText(data), name);
    case 'tsv':
      return extractCsv(decodeText(data), name, '\t');
    case 'xlsx':
      return extractXlsx(data, name);
    case 'docx':
      return extractDocx(data, name);
    case 'json':
      return extractJson(decodeText(data), name);
    case 'pdf': {
      const { extractPdf } = await import('./pdf');
      return extractPdf(data, name);
    }
    default:
      throw new Error('unsupported-format');
  }
}
