import { answerVariants } from '../answer/variants';
import { looseKey } from '../answer/normalize';
import { splitArticle } from '../answer/articles';
import { stateKey } from '../srs/scheduler';
import type { Card, CardState, Direction, Lang, StudySet } from '../types';
import { shuffle, type Rng } from '../util/rng';

/**
 * Alles, was eine Sitzung über ihre Karten wissen muss, einmal vorberechnet:
 * Texte je Richtung, Antwortvarianten, Geschwister (gleiche Frage) und Synonyme
 * (überlappende Antworten). Damit erscheinen in Multiple Choice nie zwei richtige
 * oder doppelte Optionen, und Zuordnungsrunden enthalten keine mehrdeutigen Paare.
 */

export interface ItemRef {
  c: string;
  d: Direction;
}

export const itemKey = (r: ItemRef) => `${r.c}:${r.d}`;
export const parseKey = (k: string): ItemRef => {
  const i = k.lastIndexOf(':');
  return { c: k.slice(0, i), d: k.slice(i + 1) as Direction };
};

export const promptOf = (card: Card, d: Direction) => (d === 'f2b' ? card.front : card.back);
export const answerOf = (card: Card, d: Direction) => (d === 'f2b' ? card.back : card.front);
export const extraOf = (card: Card, d: Direction) => (d === 'f2b' ? card.extraAnswers : card.extraFrontAnswers);

export class Deck {
  readonly cards: Map<string, Card>;
  readonly states: Map<string, CardState>;
  readonly sets: Map<string, StudySet>;
  private variantCache = new Map<string, Set<string>>();
  /** Rang jeder Karte innerhalb ihres Sets (Reihenfolge der Liste). */
  readonly rank = new Map<string, number>();
  private promptIndex = new Map<string, Map<string, string[]>>();

  constructor(cards: Card[], states: CardState[], sets: StudySet[]) {
    this.cards = new Map(cards.map((c) => [c.id, c]));
    this.states = new Map(states.map((s) => [s.key, s]));
    this.sets = new Map(sets.map((s) => [s.id, s]));
    const bySet = new Map<string, Card[]>();
    for (const c of cards) bySet.set(c.setId, [...(bySet.get(c.setId) ?? []), c]);
    for (const list of bySet.values()) list.sort((a, b) => a.position - b.position).forEach((c, i) => this.rank.set(c.id, i));
  }

  card(id: string): Card | undefined {
    return this.cards.get(id);
  }

  state(ref: ItemRef): CardState | undefined {
    return this.states.get(stateKey(ref.c, ref.d));
  }

  setState(st: CardState): void {
    this.states.set(st.key, st);
  }

  /** Sprache der gefragten Seite. */
  answerLang(ref: ItemRef): Lang {
    const card = this.cards.get(ref.c);
    const set = card ? this.sets.get(card.setId) : undefined;
    if (!set) return 'other';
    return ref.d === 'f2b' ? set.backLang : set.frontLang;
  }

  promptLang(ref: ItemRef): Lang {
    const card = this.cards.get(ref.c);
    const set = card ? this.sets.get(card.setId) : undefined;
    if (!set) return 'other';
    return ref.d === 'f2b' ? set.frontLang : set.backLang;
  }

  /** Gelockerte Formen aller akzeptierten Antworten einer Karte in einer Richtung. */
  variants(cardId: string, d: Direction): Set<string> {
    const key = `${cardId}:${d}`;
    let v = this.variantCache.get(key);
    if (!v) {
      const card = this.cards.get(cardId);
      v = new Set<string>();
      if (card) {
        for (const text of [answerOf(card, d), ...extraOf(card, d)]) {
          for (const a of answerVariants(text)) {
            const k = looseKey(a);
            v.add(k);
            v.add(looseKey(splitArticle(k, this.answerLang({ c: cardId, d })).rest));
          }
        }
      }
      this.variantCache.set(key, v);
    }
    return v;
  }

  private prompts(d: Direction): Map<string, string[]> {
    let m = this.promptIndex.get(d);
    if (!m) {
      m = new Map();
      for (const c of this.cards.values()) {
        const k = looseKey(promptOf(c, d));
        if (!k) continue;
        m.set(k, [...(m.get(k) ?? []), c.id]);
      }
      this.promptIndex.set(d, m);
    }
    return m;
  }

  /** Karten mit derselben Frage in dieser Richtung (ohne die Karte selbst). */
  siblings(ref: ItemRef): Card[] {
    const card = this.cards.get(ref.c);
    if (!card) return [];
    const ids = this.prompts(ref.d).get(looseKey(promptOf(card, ref.d))) ?? [];
    return ids.filter((id) => id !== ref.c).map((id) => this.cards.get(id)!).filter(Boolean);
  }

  /** Wären die Antworten der beiden Karten verwechselbar (gleiche oder überlappende Antwort, gleiche Frage)? */
  conflicts(a: string, b: string, d: Direction): boolean {
    if (a === b) return true;
    const ca = this.cards.get(a);
    const cb = this.cards.get(b);
    if (!ca || !cb) return false;
    if (looseKey(promptOf(ca, d)) === looseKey(promptOf(cb, d))) return true;
    const va = this.variants(a, d);
    for (const x of this.variants(b, d)) if (va.has(x)) return true;
    return false;
  }
}

// ---------- Distraktoren ----------

type AnswerClass = 'noun' | 'verb' | 'adj' | 'phrase' | 'number' | 'word';

function classify(text: string, lang: Lang): { cls: AnswerClass; article: string | null } {
  const t = text.trim().toLowerCase();
  if (/\d/.test(t)) return { cls: 'number', article: null };
  const { article, rest } = splitArticle(t, lang);
  if (article) return { cls: 'noun', article };
  const words = rest.split(/\s+/);
  if (lang === 'fr' && (/^(se |s')/.test(rest) || (words.length <= 2 && /(er|ir|re|oir)$/.test(words[0])))) return { cls: 'verb', article: null };
  if (lang === 'de' && (/^sich /.test(rest) || (words.length <= 2 && /(en|ern|eln)$/.test(words[words.length - 1]) && rest === rest.toLowerCase())))
    return { cls: 'verb', article: null };
  if (/,\s*-\p{L}/u.test(rest) || (lang === 'fr' && /(eux|if|el|al|ant|ent|é|e)$/.test(words[0]) && words.length === 1)) return { cls: 'adj', article: null };
  if (words.length >= 3) return { cls: 'phrase', article: null };
  return { cls: 'word', article: null };
}

/**
 * Wählt falsche Antwortmöglichkeiten aus demselben Lernset: ähnliche Wortart und Länge,
 * mit etwas Zufall, damit nicht immer dieselben erscheinen. Nie doppelt, nie Geschwister,
 * nie Synonyme der richtigen Antwort.
 */
export function pickDistractors(deck: Deck, ref: ItemRef, count: number, rng: Rng, pool?: string[]): string[] {
  const target = deck.card(ref.c);
  if (!target || count <= 0) return [];
  const lang = deck.answerLang(ref);
  const tText = answerOf(target, ref.d);
  const tc = classify(tText, lang);
  const candidates = (pool ?? Array.from(deck.cards.keys())).filter((id) => {
    const c = deck.card(id);
    return c && c.setId === target.setId && id !== target.id && answerOf(c, ref.d).trim();
  });
  const scored = candidates.map((id) => {
    const c = deck.card(id)!;
    const text = answerOf(c, ref.d);
    const cc = classify(text, lang);
    let score = 0;
    if (cc.cls === tc.cls) score += 3;
    if (cc.article && tc.article && cc.article === tc.article) score += 1;
    const la = tText.length;
    const lb = text.length;
    score += 2 * (1 - Math.abs(la - lb) / Math.max(la, lb, 1));
    if (c.tags.some((t) => target.tags.includes(t))) score += 0.5;
    // Wortlisten sind meist nach Themen geordnet: Nachbarn in der Liste sind plausible
    // Ablenker (Zahlen bei Zahlen, Monate bei Monaten).
    const dist = Math.abs((deck.rank.get(id) ?? 0) - (deck.rank.get(target.id) ?? 0));
    score += 3 * Math.exp(-dist / 15);
    score += rng() * 1.5;
    return { id, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const chosen: string[] = [];
  const texts = new Set([looseKey(tText)]);
  for (const { id } of scored) {
    if (chosen.length >= count) break;
    const text = looseKey(answerOf(deck.card(id)!, ref.d));
    if (texts.has(text)) continue;
    if (deck.conflicts(ref.c, id, ref.d)) continue;
    if (chosen.some((o) => deck.conflicts(o, id, ref.d))) continue;
    texts.add(text);
    chosen.push(id);
  }
  return chosen;
}

/** Multiple-Choice-Optionen (Karten-IDs), richtige Antwort an zufälliger Stelle. null = zu wenige Karten. */
export function mcOptions(deck: Deck, ref: ItemRef, rng: Rng, size = 4): string[] | null {
  const wrong = pickDistractors(deck, ref, size - 1, rng);
  if (wrong.length < 1) return null;
  return shuffle([ref.c, ...wrong], rng);
}

/** Wahr/Falsch: zeigt die eigene Antwort (wahr) oder eine sicher falsche (falsch). */
export function trueFalse(deck: Deck, ref: ItemRef, rng: Rng): { shownCardId: string; truth: boolean } {
  if (rng() < 0.5) {
    const wrong = pickDistractors(deck, ref, 1, rng);
    if (wrong.length) return { shownCardId: wrong[0], truth: false };
  }
  return { shownCardId: ref.c, truth: true };
}
