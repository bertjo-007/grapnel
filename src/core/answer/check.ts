import type { AnswerSettings } from '../settings';
import type { AnswerResult, Lang } from '../types';
import { sameGender, splitArticle } from './articles';
import { editDistance, typoAllowance } from './distance';
import { fold, type FoldOptions } from './normalize';
import { answerVariants } from './variants';

/**
 * Prüft eine getippte Antwort. Grundsatz: Ähnlich ist nicht richtig. Toleranz greift nur,
 * wenn sie eingeschaltet ist, und nie, wenn die Eingabe die Antwort einer anderen Karte ist.
 */

export type CheckReason =
  | 'accent'
  | 'typo'
  | 'case'
  | 'article-missing'
  | 'article-wrong'
  | 'article-gender'
  | 'sibling'
  | 'empty'
  | null;

export interface CheckInput {
  given: string;
  /** Text der gefragten Seite. */
  answer: string;
  extra?: string[];
  lang: Lang;
  /** Antworten von Karten mit derselben Frage (z. B. «quand» → wann / wenn, als). */
  siblings?: { answer: string; extra?: string[] }[];
  /** Ist die Eingabe (gefaltet, ohne Akzente) die Antwort einer anderen Karte? Siehe AnswerIndex. */
  isOtherAnswer?: (plain: string) => boolean;
  settings: AnswerSettings;
  nativeLang: Lang;
}

export interface CheckResult {
  result: AnswerResult;
  reason: CheckReason;
  /** Die Variante, die der Eingabe am nächsten kommt (für die Anzeige der Abweichung). */
  closest: string | null;
}

const RANK: Record<AnswerResult, number> = { correct: 3, almost: 2, wrong: 0, skipped: -1 };

export function articleRequired(lang: Lang, s: AnswerSettings, nativeLang: Lang): boolean {
  if (s.strict || s.articles === 'always') return true;
  if (s.articles === 'never') return false;
  return lang !== nativeLang;
}

interface Candidate {
  raw: string;
  exact: string;
  plain: string; // ohne Akzente
}

function foldOpts(s: AnswerSettings): FoldOptions {
  return { ignoreCase: s.strict ? false : s.ignoreCase, accents: true, strict: s.strict };
}

function candidatesOf(answer: string, extra: string[] | undefined, s: AnswerSettings): Candidate[] {
  const o = foldOpts(s);
  const raws = new Set<string>();
  for (const v of answerVariants(answer)) raws.add(v);
  for (const e of extra ?? []) for (const v of answerVariants(e)) raws.add(v);
  return Array.from(raws).map((raw) => ({
    raw,
    exact: fold(raw, o),
    plain: fold(raw, { ...o, accents: false }),
  }));
}

function judge(given: string, c: Candidate, input: CheckInput, needArticle: boolean): CheckResult {
  const s = input.settings;
  const o = foldOpts(s);
  const g = fold(given, o);
  const gPlain = fold(given, { ...o, accents: false });
  const res = (result: AnswerResult, reason: CheckReason): CheckResult => ({ result, reason, closest: c.raw });

  if (g === c.exact) return res('correct', null);

  // Artikel getrennt betrachten.
  const ga = splitArticle(gPlain, input.lang);
  const ca = splitArticle(c.plain, input.lang);
  const gaExact = splitArticle(g, input.lang);
  const caExact = splitArticle(c.exact, input.lang);
  const accentOk = (a: string, b: string) => a === b;

  if (ca.article && ga.rest === ca.rest) {
    const restExact = accentOk(gaExact.rest, caExact.rest);
    if (!ga.article) {
      // Artikel fehlt.
      if (needArticle) return res('wrong', 'article-missing');
      if (restExact) return res('correct', null);
    } else if (ga.article !== ca.article) {
      if (sameGender(ga.article, ca.article, input.lang)) {
        if (restExact) return res('almost', 'article-gender');
      } else {
        return res('wrong', 'article-wrong');
      }
    }
  }
  if (!ca.article && ga.article && ga.rest === c.plain && accentOk(gaExact.rest, c.exact)) {
    // Zusätzlicher Artikel, wo keiner erwartet wird (z. B. «die Mitternacht»): kein Fehler.
    return res('correct', null);
  }

  // Nur Akzente verschieden.
  const sameWithoutAccents =
    gPlain === c.plain ||
    (ca.article !== null && ga.article === ca.article && ga.rest === ca.rest) ||
    (!needArticle && ca.article !== null && !ga.article && ga.rest === ca.rest);
  if (sameWithoutAccents) {
    if (s.tolerateAccents && !s.strict) return res('almost', 'accent');
    return res('wrong', 'accent');
  }

  // Nur Gross/Klein verschieden (wenn Gross/Klein zählt).
  if (g.toLowerCase() === c.exact.toLowerCase()) return res('wrong', 'case');

  // Tippfehler: ganze Antwort vergleichen und, wo der Artikel passt oder nicht nötig ist,
  // auch den Teil ohne Artikel.
  const pairs: [string, string][] = [[gPlain, c.plain]];
  if (ca.article && (ga.article === ca.article || (!ga.article && !needArticle))) pairs.push([ga.rest, ca.rest]);
  for (const [a, b] of pairs) {
    const allowance = typoAllowance(b.length);
    if (allowance === 0) continue;
    if (editDistance(a, b, allowance) <= allowance) {
      const isOtherWord = (input.isOtherAnswer?.(gPlain) ?? false) || (input.isOtherAnswer?.(ga.rest) ?? false);
      if (s.tolerateTypos && !s.strict && !isOtherWord) return res('almost', 'typo');
      return res('wrong', isOtherWord ? null : 'typo');
    }
  }
  return res('wrong', null);
}

function best(results: CheckResult[]): CheckResult | null {
  let top: CheckResult | null = null;
  for (const r of results) {
    if (!top) top = r;
    else if (RANK[r.result] > RANK[top.result]) top = r;
    else if (RANK[r.result] === RANK[top.result] && top.reason === null && r.reason !== null) top = r;
  }
  return top;
}

export function checkAnswer(input: CheckInput): CheckResult {
  if (!input.given.trim()) return { result: 'skipped', reason: 'empty', closest: null };
  const needArticle = articleRequired(input.lang, input.settings, input.nativeLang);
  const own = candidatesOf(input.answer, input.extra, input.settings);
  const mine = best(own.map((c) => judge(input.given, c, input, needArticle)));
  if (mine && (mine.result === 'correct' || mine.result === 'almost')) return mine;

  for (const sib of input.siblings ?? []) {
    const r = best(candidatesOf(sib.answer, sib.extra, input.settings).map((c) => judge(input.given, c, input, needArticle)));
    if (r && (r.result === 'correct' || r.result === 'almost')) {
      return { result: r.result, reason: 'sibling', closest: r.closest };
    }
  }

  if (mine && mine.reason === null) {
    // Nächstliegende Variante für die Anzeige suchen.
    const gPlain = fold(input.given, { ...foldOpts(input.settings), accents: false });
    let bestC = own[0];
    let bestD = Infinity;
    for (const c of own) {
      const d = editDistance(gPlain, c.plain, 50);
      if (d < bestD) {
        bestD = d;
        bestC = c;
      }
    }
    return { result: 'wrong', reason: null, closest: bestC?.raw ?? null };
  }
  return mine ?? { result: 'wrong', reason: null, closest: own[0]?.raw ?? null };
}

/**
 * Index aller Antworten (gefaltet, ohne Akzente) → Karten, die sie haben.
 * Einmal pro Sitzung gebaut; die Abfrage pro Antwort ist dann ein Nachschlagen.
 */
export class AnswerIndex {
  private map = new Map<string, Set<string>>();

  constructor(items: Iterable<{ id: string; text: string; extra?: string[] }>, s: AnswerSettings, lang: Lang) {
    const o = { ...foldOpts(s), accents: false };
    for (const t of items) {
      for (const text of [t.text, ...(t.extra ?? [])]) {
        for (const v of answerVariants(text)) {
          const f = fold(v, o);
          this.add(f, t.id);
          this.add(splitArticle(f, lang).rest, t.id);
        }
      }
    }
  }

  private add(key: string, id: string) {
    let set = this.map.get(key);
    if (!set) this.map.set(key, (set = new Set()));
    set.add(id);
  }

  /** Gehört die Antwort zu einer Karte ausserhalb von exclude? */
  belongsToOther(plain: string, exclude: Set<string>): boolean {
    const ids = this.map.get(plain);
    if (!ids) return false;
    for (const id of ids) if (!exclude.has(id)) return true;
    return false;
  }
}
