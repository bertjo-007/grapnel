import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { UiLang } from '../../core/settings';
import type { Lang } from '../../core/types';
import { de } from './de';
import { en } from './en';

/**
 * Übersetzung. Schlüssel sind typisiert: ein Tippfehler im Schlüssel oder ein fehlender
 * englischer Text fällt beim Kompilieren auf. Mehrzahl über { one, other } mit {n}.
 */

export type Plural = { readonly one: string; readonly other: string };
export type Key = keyof typeof de;
export type Dict = { [K in Key]: (typeof de)[K] extends string ? string : Plural };
export type Vars = Record<string, string | number>;
export type T = (key: Key, vars?: Vars) => string;

const DICTS: Record<UiLang, Dict> = { de: de as Dict, en };

function format(s: string, vars?: Vars): string {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
}

export function translate(lang: UiLang, key: Key, vars?: Vars): string {
  const entry = DICTS[lang][key] ?? DICTS.de[key];
  if (typeof entry === 'string') return format(entry, vars);
  const n = Number(vars?.n ?? 0);
  return format(n === 1 ? entry.one : entry.other, vars);
}

interface I18n {
  lang: UiLang;
  locale: string;
  t: T;
  langName: (l: Lang) => string;
  /** Name einer Kartenseite: die Sprache, wenn bekannt, sonst «Vorderseite»/«Rückseite». */
  sideName: (l: Lang, side: 'front' | 'back') => string;
  relTime: (ts: number, now?: number) => string;
  interval: (ms: number) => string;
  date: (ts: number, opts?: Intl.DateTimeFormatOptions) => string;
  number: (n: number, opts?: Intl.NumberFormatOptions) => string;
  percent: (fraction: number) => string;
}

const Ctx = createContext<I18n | null>(null);

function startOfDay(ts: number) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function makeI18n(lang: UiLang): I18n {
  const locale = lang === 'de' ? 'de-CH' : 'en-GB';
  const t: T = (key, vars) => translate(lang, key, vars);
  const dateFmt = (ts: number, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' }) => new Intl.DateTimeFormat(locale, opts).format(ts);
  const relTime = (ts: number, now = Date.now()) => {
    const diff = ts - now;
    const abs = Math.abs(diff);
    const min = Math.round(abs / 60000);
    const dayDiff = Math.round((startOfDay(ts) - startOfDay(now)) / 86400000);
    if (abs < 60000) return t('time.now');
    if (diff > 0) {
      if (min < 60) return t('time.inMinutes', { n: min });
      if (dayDiff === 0) return t('time.inHours', { n: Math.round(abs / 3600000) });
      if (dayDiff === 1) return t('time.tomorrow');
      if (dayDiff < 14) return t('time.inDays', { n: dayDiff });
      return dateFmt(ts, { day: 'numeric', month: 'short', year: dayDiff > 300 ? 'numeric' : undefined });
    }
    if (min < 60) return t('time.minutesAgo', { n: min });
    if (dayDiff === 0) return t('time.hoursAgo', { n: Math.round(abs / 3600000) });
    if (dayDiff === -1) return t('time.yesterday');
    if (dayDiff > -14) return t('time.daysAgo', { n: -dayDiff });
    return dateFmt(ts, { day: 'numeric', month: 'short', year: dayDiff < -300 ? 'numeric' : undefined });
  };
  const interval = (ms: number) => {
    const m = ms / 60000;
    if (m < 60) return t('interval.min', { n: Math.max(1, Math.round(m)) });
    const h = m / 60;
    if (h < 24) return t('interval.hour', { n: Math.round(h) });
    const d = h / 24;
    if (d < 31) return t('interval.day', { n: Math.round(d) });
    if (d < 365) return t('interval.month', { n: Math.round(d / 30) });
    return t('interval.year', { n: Math.round((d / 365) * 10) / 10 });
  };
  return {
    lang,
    locale,
    t,
    langName: (l) => t(`lang.${l}` as Key),
    sideName: (l, side) => (l === 'other' ? t(side === 'front' ? 'editor.front' : 'editor.back') : t(`lang.${l}` as Key)),
    relTime,
    interval,
    date: dateFmt,
    number: (n, opts) => new Intl.NumberFormat(locale, opts).format(n),
    percent: (f) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 }).format(f),
  };
}

export function I18nProvider({ lang, children }: { lang: UiLang; children: ReactNode }) {
  const value = useMemo(() => makeI18n(lang), [lang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider fehlt');
  return v;
}

export function useT(): T {
  return useI18n().t;
}
