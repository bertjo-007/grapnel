import { Archive, Brain, Cards, Exam, PencilSimpleLine, PuzzlePiece, Shuffle, Stack } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { Link } from 'react-router';
import { db } from '../core/db/db';
import type { Settings } from '../core/settings';
import { setStats, type SetStats } from '../core/stats/stats';
import type { CardState, Direction, StudyMode, StudySet } from '../core/types';
import { useI18n, type Key } from './i18n';

export function statsDirection(settings: Settings): Direction {
  return settings.defaultDirection === 'b2f' ? 'b2f' : 'f2b';
}

/** Kennzahlen aller Sets auf einmal (eine Abfrage für Startseite und Übersicht). */
export function useSetSummaries(direction: Direction): Map<string, SetStats> | undefined {
  const data = useLiveQuery(async () => {
    const [cards, states] = await Promise.all([db.cards.toArray(), db.cardStates.toArray()]);
    return { cards, states };
  }, []);
  return useMemo(() => {
    if (!data) return undefined;
    const states = new Map<string, CardState>(data.states.map((s) => [s.key, s]));
    const bySet = new Map<string, typeof data.cards>();
    for (const c of data.cards) bySet.set(c.setId, [...(bySet.get(c.setId) ?? []), c]);
    const out = new Map<string, SetStats>();
    for (const [setId, cards] of bySet) out.set(setId, setStats(cards, states, direction));
    return out;
  }, [data, direction]);
}

export const EMPTY_STATS: SetStats = { total: 0, new: 0, learning: 0, review: 0, mastered: 0, difficult: 0, flagged: 0, dueToday: 0, lastActivity: null };

/** Verteilung der Karten auf Neu, Lernend, Wiederholung und Sicher. */
export function StatusBar({ stats }: { stats: SetStats }) {
  const { t } = useI18n();
  if (stats.total === 0) return <div className="statusbar" aria-hidden />;
  const parts: { key: 'mastered' | 'review' | 'learning' | 'new'; color: string }[] = [
    { key: 'mastered', color: 'var(--success)' },
    { key: 'review', color: 'var(--accent)' },
    { key: 'learning', color: 'var(--warning)' },
    { key: 'new', color: 'var(--surface-3)' },
  ];
  const label = parts.map((p) => `${t(`status.${p.key}` as Key)}: ${stats[p.key]}`).join(', ');
  return (
    <div className="statusbar" role="img" aria-label={label}>
      {parts.map((p) => (stats[p.key] > 0 ? <span key={p.key} style={{ flex: stats[p.key], background: p.color }} /> : null))}
    </div>
  );
}

export function StatusLegend({ stats }: { stats: SetStats }) {
  const { t } = useI18n();
  const items: { key: 'mastered' | 'review' | 'learning' | 'new'; color: string }[] = [
    { key: 'mastered', color: 'var(--success)' },
    { key: 'review', color: 'var(--accent)' },
    { key: 'learning', color: 'var(--warning)' },
    { key: 'new', color: 'var(--border-strong)' },
  ];
  return (
    <div className="legend">
      {items.map((i) => (
        <span key={i.key} className="legend-item">
          <span className="legend-swatch" style={{ background: i.color }} />
          {t(`status.${i.key}` as Key)} <strong className="num">{stats[i.key]}</strong>
        </span>
      ))}
    </div>
  );
}

export function SetTile({ set, stats }: { set: StudySet; stats: SetStats }) {
  const { t, relTime } = useI18n();
  return (
    <Link to={`/sets/${set.id}`} className="set-tile">
      <div className="set-tile-head">
        <h3 className="break">{set.title || t('common.untitled')}</h3>
        {set.archivedAt && <Archive size={18} className="muted" aria-label={t('sets.archived')} />}
      </div>
      <p className="set-tile-meta">
        {t('count.cards', { n: stats.total })}
        <span className="dot-sep" aria-hidden>
          ·
        </span>
        {set.lastStudiedAt ? t('set.lastStudied', { when: relTime(set.lastStudiedAt) }) : t('set.never')}
      </p>
      <div className="set-tile-foot">
        <StatusBar stats={stats} />
        {!set.archivedAt && stats.dueToday > 0 && <span className="badge badge-accent num">{t('set.dueBadge', { n: stats.dueToday })}</span>}
      </div>
    </Link>
  );
}

export const MODES: { mode: StudyMode; icon: typeof Cards }[] = [
  { mode: 'learn', icon: Brain },
  { mode: 'flashcards', icon: Stack },
  { mode: 'write', icon: PencilSimpleLine },
  { mode: 'mc', icon: Cards },
  { mode: 'test', icon: Exam },
  { mode: 'match', icon: PuzzlePiece },
  { mode: 'mixed', icon: Shuffle },
];

export function ModeGrid({ scope, disabled }: { scope: string; disabled?: boolean }) {
  const { t } = useI18n();
  return (
    <div className="mode-grid">
      {MODES.map(({ mode, icon: Icon }) => (
        <Link key={mode} to={`/study/${scope}/${mode}`} className={`mode-tile ${mode === 'learn' ? 'primary' : ''}`} aria-disabled={disabled} onClick={(e) => disabled && e.preventDefault()}>
          <span className="mode-icon">
            <Icon size={22} />
          </span>
          <span className="mode-text">
            <span className="mode-name">{t(`mode.${mode}` as Key)}</span>
            <span className="mode-desc">{t(`mode.${mode}.desc` as Key)}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}

