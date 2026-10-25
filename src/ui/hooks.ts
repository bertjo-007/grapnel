import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useRef, useState } from 'react';
import { db } from '../core/db/db';
import type { Card, CardState, ReviewLog, StudySet } from '../core/types';

/** Daten aus IndexedDB, die sich bei jeder Änderung von selbst aktualisieren. */

export function useSets(): StudySet[] | undefined {
  return useLiveQuery(() => db.sets.toArray(), []);
}

export function useSet(id: string | undefined): StudySet | null | undefined {
  return useLiveQuery(async () => (id ? ((await db.sets.get(id)) ?? null) : null), [id]);
}

export function useCards(setId: string | undefined): Card[] | undefined {
  return useLiveQuery(
    () => (setId ? db.cards.where('[setId+position]').between([setId, -Infinity], [setId, Infinity]).toArray() : Promise.resolve([] as Card[])),
    [setId],
  );
}

export function useAllCards(): Card[] | undefined {
  return useLiveQuery(() => db.cards.toArray(), []);
}

export function useSetStates(setId: string | undefined): Map<string, CardState> | undefined {
  const list = useLiveQuery(() => (setId ? db.cardStates.where('setId').equals(setId).toArray() : Promise.resolve([] as CardState[])), [setId]);
  return useMemo(() => (list ? new Map(list.map((s) => [s.key, s])) : undefined), [list]);
}

export function useAllStates(): CardState[] | undefined {
  return useLiveQuery(() => db.cardStates.toArray(), []);
}

export function useLogs(setId?: string): ReviewLog[] | undefined {
  return useLiveQuery(() => (setId ? db.reviewLogs.where('setId').equals(setId).toArray() : db.reviewLogs.toArray()), [setId]);
}

export function useCardLogs(cardId: string | undefined): ReviewLog[] | undefined {
  return useLiveQuery(() => (cardId ? db.reviewLogs.where('cardId').equals(cardId).sortBy('at') : Promise.resolve([] as ReviewLog[])), [cardId]);
}

/** Objekt-URL für ein gespeichertes Bild oder Audio; wird beim Verlassen freigegeben. */
export function useMediaUrl(id: string | null | undefined): string | null {
  const item = useLiveQuery(async () => (id ? ((await db.media.get(id)) ?? null) : null), [id]);
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!item) {
      setUrl(null);
      return;
    }
    const u = URL.createObjectURL(new Blob([item.data], { type: item.mime }));
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [item]);
  return url;
}

export function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => typeof matchMedia === 'function' && matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export const useIsDesktop = () => useMediaQuery('(min-width: 900px)');

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
}

export type KeyMap = Record<string, (e: KeyboardEvent) => void>;

/**
 * Tastenkürzel. Schlüssel wie ' ', 'ArrowLeft', '1', 'Escape', 'Enter', '?'.
 * Während man in ein Feld tippt, greifen nur Escape und Enter (falls angegeben),
 * und nur, wenn `inInputs` sie ausdrücklich freigibt.
 */
export function useHotkeys(map: KeyMap, enabled = true, inInputs: string[] = []): void {
  const ref = useRef(map);
  ref.current = map;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e) && !inInputs.includes(e.key)) return;
      const fn = ref.current[e.key] ?? ref.current[e.key.toLowerCase()];
      if (fn) {
        if (document.querySelector('dialog[open]') && e.key !== 'Escape') return;
        e.preventDefault();
        fn(e);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled, inInputs]);
}

/** Sekundentakt für Zeitanzeigen (Test-Zeitlimit, Zuordnen). */
export function useNow(intervalMs = 1000, enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const h = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(h);
  }, [intervalMs, enabled]);
  return now;
}
