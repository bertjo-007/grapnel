/**
 * Datentypen von Grapnel. Alles, was gespeichert oder synchronisiert wird, ist hier
 * beschrieben. IDs sind UUIDs, nie fortlaufende Nummern: so lassen sich Daten mehrerer
 * Geräte (und später mehrerer Benutzer) zusammenführen, ohne dass IDs kollidieren.
 */

export type Lang = 'fr' | 'de' | 'en' | 'it' | 'es' | 'other';

/** f2b: Vorderseite wird gezeigt, Rückseite gefragt. b2f: umgekehrt. */
export type Direction = 'f2b' | 'b2f';
export type DirectionChoice = Direction | 'both';

export interface StudySet {
  id: string;
  title: string;
  description: string;
  frontLang: Lang;
  backLang: Lang;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  lastStudiedAt: number | null;
  /** Für spätere Mehrbenutzer-Fähigkeit; heute immer null. */
  ownerId: string | null;
}

export interface Card {
  id: string;
  setId: string;
  /** Sortierschlüssel. Umordnen setzt einen Wert zwischen den Nachbarn. */
  position: number;
  front: string;
  back: string;
  example: string;
  explanation: string;
  imageId: string | null;
  audioId: string | null;
  tags: string[];
  notes: string;
  flagDifficult: boolean;
  flagImportant: boolean;
  /** Zusätzlich akzeptierte Antworten, wenn die Rückseite gefragt ist. */
  extraAnswers: string[];
  /** Zusätzlich akzeptierte Antworten, wenn die Vorderseite gefragt ist. */
  extraFrontAnswers: string[];
  createdAt: number;
  updatedAt: number;
}

export type StudyMode = 'flashcards' | 'learn' | 'write' | 'mc' | 'test' | 'match' | 'mixed';
export type TaskType = 'flashcard' | 'write' | 'mc' | 'truefalse' | 'match';

/** correct = richtig, almost = mit Toleranz akzeptiert, wrong = falsch, skipped = unbeantwortet. */
export type AnswerResult = 'correct' | 'almost' | 'wrong' | 'skipped';

/** FSRS-Bewertung: 1 Wiederholen, 2 Schwierig, 3 Gut, 4 Einfach. */
export type Grade = 1 | 2 | 3 | 4;

export interface ReviewLog {
  id: string;
  cardId: string;
  setId: string;
  direction: Direction;
  sessionId: string | null;
  mode: StudyMode;
  task: TaskType;
  result: AnswerResult;
  /** Bewertung, die in die Planung eingeflossen ist. null = nur Statistik. */
  rating: Grade | null;
  given: string | null;
  elapsedMs: number;
  at: number;
  /** «Ich hatte recht»: bewusste Korrektur durch den Benutzer. */
  override: boolean;
  /** Dieser Eintrag ersetzt einen früheren (die Korrektur). Der ersetzte zählt nicht mehr. */
  replaces: string | null;
  deviceId: string;
}

/** Gespeicherter FSRS-Zustand, Datumswerte als Millisekunden. */
export interface FsrsData {
  due: number;
  stability: number;
  difficulty: number;
  elapsed_days: number;
  scheduled_days: number;
  learning_steps: number;
  reps: number;
  lapses: number;
  /** 0 Neu, 1 Lernend, 2 Wiederholung, 3 Neu lernend */
  state: 0 | 1 | 2 | 3;
  last_review: number | null;
}

/**
 * Lernstand einer Karte in einer Richtung. Ist ein Zwischenspeicher: Er lässt sich
 * jederzeit vollständig aus den ReviewLogs neu berechnen (siehe srs/replay).
 */
export interface CardState {
  key: string; // `${cardId}:${direction}`
  cardId: string;
  setId: string;
  direction: Direction;
  fsrs: FsrsData;
  /** Kopie von fsrs.due für den Index. Nur sinnvoll, wenn fsrs.state !== 0. */
  due: number;
  correct: number;
  wrong: number;
  lastResult: AnswerResult | null;
  lastAt: number | null;
}

export type SessionStatus = 'active' | 'done';

export interface Session {
  id: string;
  mode: StudyMode;
  setIds: string[];
  title: string;
  status: SessionStatus;
  startedAt: number;
  updatedAt: number;
  endedAt: number | null;
  /** Fortschritt für die Startseite: erledigt / gesamt. */
  progressDone: number;
  progressTotal: number;
  /** Modus-spezifischer Zustand (JSON), siehe session/*. */
  state: unknown;
}

export interface MediaItem {
  id: string;
  mime: string;
  /** ArrayBuffer statt Blob: ältere iOS-Versionen speichern Blobs in IndexedDB unzuverlässig. */
  data: ArrayBuffer;
  size: number;
  createdAt: number;
  updatedAt: number;
}

export interface ImportBatch {
  id: string;
  at: number;
  fileName: string;
  format: string;
  setId: string;
  target: 'new' | 'append' | 'update';
  recognized: number;
  selected: number;
  imported: number;
  updated: number;
  problematic: number;
}

export interface Tombstone {
  id: string;
  table: SyncTable;
  at: number;
}

export type SyncTable = 'sets' | 'cards' | 'reviewLogs' | 'media' | 'settings';

export interface OutboxEntry {
  key: string; // `${table}:${id}`
  table: SyncTable;
  id: string;
  at: number;
}

export interface MetaEntry {
  key: string;
  value: unknown;
}

export interface SettingsRecord {
  key: 'app';
  value: import('./settings').Settings;
  updatedAt: number;
}
