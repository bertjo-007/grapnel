import type { Lang } from '../types';
import { evidence, KNOWN_LANGS, langScore } from './lang';
import type { Block } from './types';

/**
 * Paart Zeilen, die abwechselnd Vorder- und Rückseite sind («maison» / «das Haus» / …).
 *
 * Naiv «immer zwei Zeilen» geht schief, sobald eine fremde Zeile dazwischen steht (eine
 * Überschrift, kopierte Oberfläche): ab da wäre jede Karte falsch. Darum wird die Paarung
 * als Pfad durch drei Zustände gesucht (Viterbi):
 *   F = Vorderseite, B = Rückseite (muss auf F folgen), X = gehört zu keinem Paar.
 * Jede Zeile bringt Punkte für den Zustand, zu dem ihre Sprache passt. Eine Zeile in der
 * falschen Sprache kostet deutlich mehr, als eine passende einbringt, und Überspringen hat
 * einen festen Preis. So tragen eindeutige Zeilen die Reihenfolge durch, unklare Zeilen
 * (0 Punkte) folgen einfach dem Takt, und echte Fremdkörper fallen als «nicht zugeordnet»
 * heraus, statt alles danach zu verschieben.
 */

export type PairItem =
  | { kind: 'pair'; front: number; back: number | null; uncertain: boolean }
  | { kind: 'skip'; index: number };

const SKIP_COST = -1;
const HEADING_BONUS = 1.6;
const OPEN_END_COST = -0.5;

function fit(s: number): number {
  return s >= 0 ? 0.4 * Math.min(s, 4) : 1.2 * s;
}

type St = 0 | 1 | 2; // F, B, X

function viterbi(blocks: Block[], frontLang: Lang, backLang: Lang): { idx: number[]; s: number[]; states: St[]; best: number } {
  // Leere Zeilen sind keine Inhalte und werden gar nicht erst betrachtet.
  const idx = blocks.map((b, i) => (b.text.trim() ? i : -1)).filter((i) => i >= 0);
  const n = idx.length;
  if (n === 0) return { idx, s: [], states: [], best: 0 };
  const s = idx.map((i) => langScore(blocks[i].text, frontLang, backLang));
  const emit = (k: number, st: St): number => {
    if (st === 0) return fit(s[k]);
    if (st === 1) return fit(-s[k]);
    const b = blocks[idx[k]];
    return SKIP_COST + (b.heading || b.bold ? HEADING_BONUS : 0);
  };

  const NEG = -Infinity;
  const score: number[][] = Array.from({ length: n }, () => [NEG, NEG, NEG]);
  const from: St[][] = Array.from({ length: n }, () => [0, 0, 0]);
  score[0][0] = emit(0, 0);
  score[0][2] = emit(0, 2);
  for (let k = 1; k < n; k++) {
    // F nach B oder X
    const fPrev: St = score[k - 1][1] >= score[k - 1][2] ? 1 : 2;
    score[k][0] = score[k - 1][fPrev] + emit(k, 0);
    from[k][0] = fPrev;
    // B nur nach F
    score[k][1] = score[k - 1][0] + emit(k, 1);
    from[k][1] = 0;
    // X nach B oder X
    const xPrev: St = score[k - 1][1] >= score[k - 1][2] ? 1 : 2;
    score[k][2] = score[k - 1][xPrev] + emit(k, 2);
    from[k][2] = xPrev;
  }
  const endF = score[n - 1][0] + OPEN_END_COST;
  let st: St = 1;
  let best = score[n - 1][1];
  if (score[n - 1][2] > best) {
    best = score[n - 1][2];
    st = 2;
  }
  if (endF > best) {
    st = 0;
    best = endF;
  }

  const states = new Array<St>(n);
  for (let k = n - 1; k >= 0; k--) {
    states[k] = st;
    st = from[k][st];
  }
  return { idx, s, states, best };
}

export function pairAlternating(blocks: Block[], frontLang: Lang, backLang: Lang): PairItem[] {
  const { idx, s, states } = viterbi(blocks, frontLang, backLang);
  const n = idx.length;
  const items: PairItem[] = [];
  for (let k = 0; k < n; k++) {
    if (states[k] === 2) items.push({ kind: 'skip', index: idx[k] });
    else if (states[k] === 0) {
      const hasBack = k + 1 < n && states[k + 1] === 1;
      const uncertain = fit(s[k]) < -0.5 || (hasBack && fit(-s[k + 1]) < -0.5);
      items.push({ kind: 'pair', front: idx[k], back: hasBack ? idx[k + 1] : null, uncertain });
    }
  }
  return items;
}

/**
 * Sprachen einer abwechselnden Liste. Nach Zeilenparität zu zählen wäre falsch, sobald
 * eine fremde Zeile die Parität verschiebt. Darum: die zwei häufigsten Sprachen bestimmen
 * und die Paarung in beiden Richtungen bewerten. Die Richtung mit dem besseren Pfad gilt.
 */
export function guessAlternatingLangs(blocks: Block[]): { front: Lang; back: Lang } {
  const total: Record<string, number> = {};
  const lines = blocks.filter((b) => b.text.trim());
  for (const b of lines) {
    const ev = evidence(b.text);
    for (const l of KNOWN_LANGS) total[l] = (total[l] ?? 0) + ev[l];
  }
  const ranked = KNOWN_LANGS.slice().sort((a, b) => total[b] - total[a]);
  const minEvidence = Math.max(3, lines.length * 0.08);
  const a: Lang = total[ranked[0]] >= minEvidence ? ranked[0] : 'other';
  const b: Lang = total[ranked[1]] >= minEvidence ? ranked[1] : 'other';
  if (a === 'other' || b === 'other') return { front: a, back: b };
  return viterbi(blocks, a, b).best >= viterbi(blocks, b, a).best ? { front: a, back: b } : { front: b, back: a };
}
