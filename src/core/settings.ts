import type { DirectionChoice, Lang } from './types';

export type ThemeChoice = 'system' | 'light' | 'dark';
export type UiLang = 'de' | 'en';
/** Wann der Artikel (le/la, der/die) mitgeschrieben werden muss. */
export type ArticlePolicy = 'foreign' | 'always' | 'never';

export interface AnswerSettings {
  ignoreCase: boolean;
  /** Fehlende oder falsche Akzente werden als «fast richtig» akzeptiert. */
  tolerateAccents: boolean;
  /** Kleine Tippfehler werden als «fast richtig» akzeptiert. */
  tolerateTypos: boolean;
  /** Exakt: Gross/Klein, Akzente und Satzzeichen müssen stimmen. Überschreibt alles andere. */
  strict: boolean;
  articles: ArticlePolicy;
}

export interface SrsSettings {
  /** Gewünschte Erinnerungsquote, 0.7 bis 0.97. */
  retention: number;
  maxIntervalDays: number;
  /** Neue Karten pro Tag über alle Sets. */
  newPerDay: number;
}

export interface Settings {
  name: string;
  uiLang: UiLang;
  /** Muttersprache: Antworten in dieser Sprache brauchen bei 'foreign' keinen Artikel. */
  nativeLang: Lang;
  theme: ThemeChoice;
  reduceMotion: boolean;
  showShortcutHints: boolean;
  defaultDirection: DirectionChoice;
  /** Standardanzahl neuer Karten pro Lernsitzung. */
  newPerSession: number;
  /** Karten pro Runde im Modus «Lernen». */
  roundSize: number;
  autoShuffle: boolean;
  /** Karteikarten: zwei Knöpfe (Gewusst/Nicht gewusst) oder vier Stufen. */
  flashcardRating: 'binary' | 'four';
  answer: AnswerSettings;
  srs: SrsSettings;
  /** Online-Stimmen schicken den Text an den Anbieter des Browsers. */
  allowOnlineVoices: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  name: '',
  uiLang: 'de',
  nativeLang: 'de',
  theme: 'system',
  reduceMotion: false,
  showShortcutHints: true,
  defaultDirection: 'f2b',
  newPerSession: 10,
  roundSize: 7,
  autoShuffle: false,
  flashcardRating: 'binary',
  answer: {
    ignoreCase: true,
    tolerateAccents: false,
    tolerateTypos: false,
    strict: false,
    articles: 'foreign',
  },
  srs: {
    retention: 0.9,
    maxIntervalDays: 365,
    newPerDay: 30,
  },
  allowOnlineVoices: false,
};

/** Ergänzt fehlende Felder (z. B. nach einem Update) mit den Standardwerten. */
export function withDefaults(partial: Partial<Settings> | null | undefined): Settings {
  const p = partial ?? {};
  return {
    ...DEFAULT_SETTINGS,
    ...p,
    answer: { ...DEFAULT_SETTINGS.answer, ...(p.answer ?? {}) },
    srs: { ...DEFAULT_SETTINGS.srs, ...(p.srs ?? {}) },
  };
}

/** Einstellungen, die pro Gerät gelten und beim Sync nicht überschrieben werden. */
export const DEVICE_LOCAL_KEYS: (keyof Settings)[] = ['theme', 'reduceMotion', 'showShortcutHints'];
