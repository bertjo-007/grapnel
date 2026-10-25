import type { Lang } from '../types';

/** Artikel je Sprache, längste zuerst (damit «de la» vor «de» greift). */
export const ARTICLES: Record<Lang, string[]> = {
  fr: ["de l'", 'de la', "l'", 'les', 'des', 'une', 'du', 'un', 'le', 'la'],
  de: ['einen', 'einem', 'einer', 'eine', 'ein', 'der', 'die', 'das', 'den', 'dem', 'des'],
  en: ['the', 'an', 'a'],
  it: ["un'", "l'", 'uno', 'una', 'gli', 'il', 'lo', 'la', 'le', 'un', 'i'],
  es: ['unos', 'unas', 'los', 'las', 'una', 'el', 'la', 'un'],
  other: [],
};

/** Artikel, die dasselbe Geschlecht und dieselbe Zahl anzeigen (le ≈ un, la ≈ une). */
const GENDER_GROUPS: Partial<Record<Lang, string[][]>> = {
  fr: [['le', 'un', 'du'], ['la', 'une', 'de la'], ['les', 'des'], ["l'", "de l'"]],
  de: [['der', 'ein'], ['die', 'eine'], ['das', 'ein'], ['den', 'einen'], ['dem', 'einem']],
  it: [['il', 'lo', 'un', 'uno'], ['la', 'una', "un'"], ['i', 'gli'], ['le']],
  es: [['el', 'un'], ['la', 'una'], ['los', 'unos'], ['las', 'unas']],
  en: [['the', 'a', 'an']],
};

export interface ArticleSplit {
  article: string | null;
  rest: string;
}

/** Trennt einen führenden Artikel ab (Text sollte schon gefaltet sein). */
export function splitArticle(text: string, lang: Lang): ArticleSplit {
  const lower = text.toLowerCase();
  for (const a of ARTICLES[lang] ?? []) {
    const elided = a.endsWith("'");
    if (elided ? lower.startsWith(a) : lower.startsWith(a + ' ')) {
      const rest = text.slice(a.length).trim();
      if (rest.length > 0) return { article: a, rest };
    }
  }
  return { article: null, rest: text };
}

export function isBareArticle(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return false;
  return Object.values(ARTICLES).some((list) => list.includes(t));
}

export function sameGender(a: string, b: string, lang: Lang): boolean {
  if (a === b) return true;
  return (GENDER_GROUPS[lang] ?? []).some((g) => g.includes(a) && g.includes(b));
}
