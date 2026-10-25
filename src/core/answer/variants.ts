import { cleanText } from './normalize';
import { isBareArticle } from './articles';

/**
 * Leitet aus dem Text einer Karte die akzeptierten Antworten ab. Es wird nichts
 * erfunden: Jede Variante steht so (oder als übliche Kurzschreibweise) schon im Text.
 *
 *   «der Morgen; morgens»       → «der Morgen», «morgens»
 *   «hübsch, süss»              → «hübsch», «süss»
 *   «(aus)rechnen»              → «rechnen», «ausrechnen»
 *   «der (Voll-)Bart»           → «der Bart», «der Vollbart»
 *   «zweite(r, -s)»             → «zweite», «zweiter», «zweites»
 *   «courageux, -euse»          → «courageux», «courageuse» (das Fragment «-euse» allein nie)
 *   «mettre qc», «jdm. helfen»  → zusätzlich ohne Platzhalter
 *   «ab (zeitlich)»             → «ab» (Klammer am Ende = Hinweis, kein Antwortteil)
 */

const MAX_VARIANTS = 48;
const JOIN = '\u0001';

/** Teilt an Trennzeichen, die nicht in Klammern stehen. */
export function splitTopLevel(text: string, seps: string[]): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '(' || ch === '[') depth++;
    else if ((ch === ')' || ch === ']') && depth > 0) depth--;
    if (depth === 0) {
      const sep = seps.find((s) => text.startsWith(s, i));
      if (sep) {
        out.push(cur);
        cur = '';
        i += sep.length - 1;
        continue;
      }
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim()).filter(Boolean);
}

const ENDINGS = /^-?\p{L}{1,4}(\s*,\s*-?\p{L}{1,4})*$/u;
const PREFIX = /^\p{L}+-?$/u;

function isInfo(content: string): boolean {
  return content.length > 24 || /[:;]/.test(content) || content.split(/\s+/).length > 3;
}

/** Löst Klammern in einem einzelnen Antwortteil auf. */
export function expandParens(part: string): string[] {
  if (!part.includes('(')) return [part];
  const re = /\(([^()]*)\)/g;
  const pieces: Array<string | string[]> = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(part))) {
    const before = part.slice(last, m.index);
    const after = part.slice(m.index + m[0].length);
    const content = m[1].trim();
    const attachedBefore = /\p{L}$/u.test(before);
    const attachedAfter = /^\p{L}/u.test(after);
    const atEnd = after.trim() === '';
    pieces.push(before);
    let options: string[];
    if (attachedBefore && ENDINGS.test(content)) {
      options = ['', ...content.split(',').map((s) => s.trim().replace(/^-/, ''))];
    } else if (attachedAfter && PREFIX.test(content)) {
      options = ['', content.endsWith('-') ? content.slice(0, -1) + JOIN : content];
    } else if (atEnd || isInfo(content) || content === '') {
      options = [''];
    } else {
      options = ['', ...content.split('/').map((s) => s.trim()).filter(Boolean)];
    }
    pieces.push(options);
    last = m.index + m[0].length;
  }
  pieces.push(part.slice(last));

  let acc = [''];
  for (const p of pieces) {
    if (typeof p === 'string') {
      acc = acc.map((a) => a + p);
    } else {
      const next: string[] = [];
      for (const a of acc) for (const o of p) if (next.length < MAX_VARIANTS) next.push(a + o);
      acc = next;
    }
  }
  return acc
    .map((s) => s.replace(new RegExp(`${JOIN}(\\p{L})`, 'gu'), (_, ch: string) => ch.toLowerCase()).replace(JOIN, ''))
    .map((s) => s.replace(/[()]/g, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const PLACEHOLDERS = /(^|\s)(qc|qch|qqch|qqn|qn|jdm\.?|jdn\.?|jds\.?|jmd\.?|jmdm\.?|etw\.?|sth\.?|sb\.?)(?=\s|$)/giu;

/** Variante ohne Platzhalter wie qc, jdm., etw., «+ ADJ.» oder «...». */
export function withoutPlaceholders(s: string): string {
  return s
    .replace(PLACEHOLDERS, ' ')
    .replace(/\s*\+\s*[\p{L}.]+\.?\s*$/u, ' ')
    .replace(/\s*(\.\.\.|…)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Hängt eine Femininendung wie «-e», «-euse», «-elle», «-ve» an die Grundform. */
export function applySuffix(base: string, fragment: string): string | null {
  const f = fragment.replace(/^-\s*/, '');
  if (!f) return null;
  const m = base.match(/^(.*?)(\p{L}+)$/u);
  if (!m) return null;
  const head = m[1];
  const word = m[2];
  if (f.length === 1) return head + word + f;
  const tail = word.slice(-4);
  const idx = tail.lastIndexOf(f[0]);
  if (idx >= 0) return head + word.slice(0, word.length - tail.length + idx) + f;
  if (f[0] === 'v' && word.endsWith('f')) return head + word.slice(0, -1) + f;
  return head + word + f;
}

const FRAGMENT = /^-\s*\p{L}+$/u;

/** Alle akzeptierten Antworten für einen Kartentext. Die erste ist immer der volle Text. */
export function answerVariants(text: string): string[] {
  const full = cleanText(text);
  if (!full) return [];
  const out = new Set<string>([full]);
  const add = (s: string | null) => {
    if (!s || out.size >= MAX_VARIANTS) return;
    for (const e of expandParens(s)) {
      if (isBareArticle(e)) continue;
      out.add(e);
      const p = withoutPlaceholders(e);
      if (p && p !== e && !isBareArticle(p)) out.add(p);
    }
  };

  for (const group of splitTopLevel(full, [';'])) {
    add(group);
    const parts = splitTopLevel(group, [',', ' / ', ' - ']);
    let base: string | null = null;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (FRAGMENT.test(part)) {
        if (base) for (const b of expandParens(base)) add(applySuffix(b, part));
        continue;
      }
      if (isBareArticle(part)) {
        // «der, die Alleinerziehende» → auch «der Alleinerziehende»
        const next = parts[i + 1];
        const m = next?.match(/^(\S+)\s+(.+)$/);
        if (m && isBareArticle(m[1])) add(`${part} ${m[2]}`);
        continue;
      }
      base = part;
      add(part);
    }
  }
  return Array.from(out);
}
