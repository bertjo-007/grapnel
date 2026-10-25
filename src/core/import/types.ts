import type { Lang } from '../types';

export type ImportFormat = 'txt' | 'csv' | 'tsv' | 'xlsx' | 'docx' | 'pdf' | 'image' | 'json' | 'paste';

/** Ein Stück Quelltext: eine Zeile, ein Absatz oder eine Tabellenzeile. */
export interface Block {
  text: string;
  /** Zellen, wenn die Quelle eine Tabelle ist. */
  cells?: string[];
  /** Herkunft als Nummer (oder «Seite:Zeile» bei PDF); die Einheit steht in Extracted.unit. */
  source: string;
  bold?: boolean;
  heading?: boolean;
  /** OCR-Sicherheit 0 bis 1. */
  confidence?: number;
}

export type SourceUnit = 'paragraph' | 'line' | 'row' | 'card' | 'page';

export interface Extracted {
  format: ImportFormat;
  fileName: string;
  unit: SourceUnit;
  blocks: Block[];
  /** Weitere Tabellenblätter (XLSX). blocks ist das gewählte Blatt. */
  sheets?: { name: string; blocks: Block[] }[];
  warnings: string[];
  /** PDF ohne Textebene: Texterkennung nötig. */
  needsOcr?: boolean;
  /** Bereits strukturierte Karten (eigener JSON-Export). */
  cards?: ImportedCard[];
  langs?: { front: Lang; back: Lang };
  title?: string;
  description?: string;
}

/** Karte aus einem eigenen JSON-Export, mit ID für den Abgleich. */
export interface ImportedCard {
  id?: string;
  front: string;
  back: string;
  example?: string;
  explanation?: string;
  tags?: string[];
  notes?: string;
  flagDifficult?: boolean;
  flagImportant?: boolean;
  extraAnswers?: string[];
  extraFrontAnswers?: string[];
}

export interface ColumnMapping {
  front: number;
  back: number;
  example: number | null;
  explanation: number | null;
  tags: number | null;
  notes: number | null;
  answers: number | null;
  frontAnswers: number | null;
  difficult: number | null;
  important: number | null;
}

export type Structure =
  | { kind: 'columns'; mapping: ColumnMapping; hasHeader: boolean }
  | { kind: 'delimited'; delimiter: string }
  | { kind: 'alternating' }
  | { kind: 'blocks' }
  | { kind: 'cards' };

export type RowStatus = 'ok' | 'incomplete' | 'duplicate' | 'exists' | 'uncertain' | 'unassigned' | 'changed' | 'same-front';

export interface PreviewRow {
  key: string;
  /** Laufnummer in der Vorschau (Reihenfolge der Quelle). */
  index: number;
  source: string;
  front: string;
  back: string;
  example: string;
  explanation: string;
  tags: string[];
  notes: string;
  flagDifficult: boolean;
  flagImportant: boolean;
  extraAnswers: string[];
  extraFrontAnswers: string[];
  /** Zeile ist kein Eintrag (z. B. Überschrift oder Zeile ohne Partner). */
  unassigned: boolean;
  /** Paarung oder Texterkennung unsicher. */
  uncertain: boolean;
  statuses: RowStatus[];
  /** Index der ersten Zeile mit gleichem Inhalt. */
  duplicateOf: number | null;
  /** Bestehende Karte, die diese Zeile aktualisieren würde (Modus «aktualisieren»). */
  matchId: string | null;
  /** ID aus einem eigenen Export (für den Abgleich). */
  sourceId: string | null;
  selected: boolean;
  /** Vom Benutzer bewusst an- oder abgewählt: Automatik fasst die Auswahl nicht mehr an. */
  touched: boolean;
}
