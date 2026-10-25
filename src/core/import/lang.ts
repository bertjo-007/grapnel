import type { Lang } from '../types';

/**
 * Grobe Spracherkennung für einzelne Zeilen einer Wortliste. Sie muss nicht jedes Wort
 * erkennen, nur verlässliche Hinweise liefern (Artikel, Umlaute, Akzente, Funktionswörter).
 * Mehrdeutige Zeilen bekommen den Wert 0, dann entscheidet die Reihenfolge.
 * Klammerinhalt zählt nicht: «soixante-dix (in B und CH: septante)» ist eine französische Zeile.
 */

type Known = Exclude<Lang, 'other'>;
export const KNOWN_LANGS: Known[] = ['fr', 'de', 'en', 'it', 'es'];

const STOP: Record<Known, string[]> = {
  fr: ['le', 'la', 'les', 'un', 'une', 'des', 'du', 'de', 'et', 'est', 'ne', 'pas', 'en', 'au', 'aux', 'avec', 'pour', 'qui', 'que', 'se', 'sa', 'son', 'ses', 'sur', 'dans', 'par', 'plus', 'très', 'tout', 'toute', 'tous', 'être', 'avoir', 'faire', 'il', 'elle', 'ils', 'je', 'tu', 'nous', 'vous', 'on', 'ce', 'cette', 'mon', 'ma', 'mes', 'qc', 'qn', 'où', 'mais', 'ou', 'quand', 'comme', 'bien', 'chez', 'à'],
  de: ['der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'und', 'ist', 'nicht', 'zu', 'mit', 'von', 'für', 'auf', 'im', 'in', 'an', 'am', 'um', 'sich', 'es', 'er', 'sie', 'wir', 'ihr', 'ich', 'du', 'auch', 'noch', 'schon', 'nur', 'sehr', 'wie', 'was', 'wer', 'wann', 'wenn', 'als', 'oder', 'aber', 'haben', 'sein', 'werden', 'jdm', 'jdn', 'etw', 'etwas', 'diese', 'dieser', 'dieses', 'kein', 'keine', 'hast', 'hat', 'bin', 'bist', 'sind', 'nach', 'vor', 'bei', 'aus', 'über', 'unter', 'bis', 'seit'],
  en: ['the', 'a', 'an', 'to', 'of', 'and', 'is', 'in', 'on', 'for', 'with', 'it', 'be', 'not', 'that', 'this', 'you', 'he', 'she', 'they', 'we', 'at', 'by', 'from', 'or', 'but', 'have', 'has', 'do', 'does', 'sth', 'sb', 'my', 'your'],
  it: ['il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una', 'di', 'e', 'è', 'che', 'non', 'per', 'con', 'del', 'della', 'in', 'da', 'al', 'alla', 'sono', 'essere', 'avere', 'mi', 'ti', 'si', 'ci', 'molto', 'anche', 'ma', 'o', 'come', 'quando'],
  es: ['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'de', 'y', 'es', 'que', 'no', 'en', 'por', 'para', 'con', 'del', 'al', 'se', 'su', 'muy', 'también', 'pero', 'o', 'como', 'cuando', 'ser', 'estar', 'tener', 'yo', 'tú'],
};

const STOP_SETS: Record<Known, Set<string>> = Object.fromEntries(
  KNOWN_LANGS.map((l) => [l, new Set(STOP[l])]),
) as Record<Known, Set<string>>;

function count(re: RegExp, s: string): number {
  return (s.match(re) ?? []).length;
}

export type Evidence = Record<Known, number>;

export function evidence(line: string): Evidence {
  const text = line.replace(/\([^)]*\)/g, ' ').replace(/\[[^\]]*\]/g, ' ').trim();
  const lower = text.toLowerCase();
  const ev: Evidence = { fr: 0, de: 0, en: 0, it: 0, es: 0 };
  if (!text) return ev;

  const tokens = lower.split(/[\s,;/]+/).map((t) => t.replace(/^[^\p{L}']+|[^\p{L}']+$/gu, '')).filter(Boolean);
  for (const t of tokens) {
    for (const l of KNOWN_LANGS) if (STOP_SETS[l].has(t)) ev[l] += 1;
    // Elision am Wortanfang: l'été, d'abord, s'appeler, qu'il
    if (/^(l|d|j|s|n|m|t|c|qu)'\p{L}/u.test(t)) ev.fr += 2;
  }

  ev.fr += Math.min(3, 1.5 * count(/[éèêëâîïôûùç]/g, lower)) + 2 * count(/œ/g, lower);
  ev.fr += count(/(eux|euse|ette|ière|ais|aient)\b/g, lower) * 0.75;
  ev.de += Math.min(4, 2 * count(/[äöü]/g, lower)) + 3 * count(/ß/g, lower);
  ev.de += 1.5 * count(/sch/g, lower) + count(/ck|tz/g, lower);
  ev.de += count(/(ung|keit|heit|lich|chen|schaft)\b/g, lower) * 1.25;
  // Grossgeschriebene Wörter mitten in der Zeile: deutsche Nomen.
  const caps = text.split(/\s+/).slice(1).filter((w) => /^\p{Lu}\p{Ll}/u.test(w)).length;
  ev.de += Math.min(2, caps);
  ev.en += count(/\bth/g, lower) + count(/\b\p{L}+ing\b/gu, lower) * 0.5;
  ev.it += count(/[ìò]/g, lower) * 1.5 + count(/(zz|cch|gli\b|zione)/g, lower);
  ev.es += 2 * count(/[ñ¿¡]/g, lower) + 1.5 * count(/[áíóú]/g, lower) + count(/ción\b/g, lower);

  for (const l of KNOWN_LANGS) ev[l] = Math.min(6, ev[l]);
  return ev;
}

/** Positiv: eher Sprache a, negativ: eher Sprache b, 0: unklar. */
export function langScore(line: string, a: Lang, b: Lang): number {
  if (a === b || a === 'other' || b === 'other') return 0;
  const ev = evidence(line);
  return ev[a] - ev[b];
}

/** Rät die Sprachen der Vorder- und Rückseiten aus einer Menge von Zeilenpaaren. */
export function guessLangs(fronts: string[], backs: string[]): { front: Lang; back: Lang } {
  const sum = (lines: string[]) => {
    const total: Evidence = { fr: 0, de: 0, en: 0, it: 0, es: 0 };
    for (const line of lines) {
      const ev = evidence(line);
      for (const l of KNOWN_LANGS) total[l] += ev[l];
    }
    return total;
  };
  // Zu schwacher Hinweis: lieber «andere» als falsch raten.
  const minEvidence = Math.max(3, Math.min(fronts.length, backs.length) * 0.15);
  const argmax = (ev: Evidence, exclude?: Lang): Lang => {
    let best: Lang = 'other';
    let bestV = 0;
    for (const l of KNOWN_LANGS) {
      if (l === exclude) continue;
      if (ev[l] > bestV) {
        bestV = ev[l];
        best = l;
      }
    }
    return bestV >= minEvidence ? best : 'other';
  };
  const fe = sum(fronts);
  const be = sum(backs);
  const front = argmax(fe);
  const back = argmax(be, front === 'other' ? undefined : front);
  return { front, back };
}
