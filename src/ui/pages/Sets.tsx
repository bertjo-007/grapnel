import { Cards, FileArrowUp, MagnifyingGlass, Plus, Rows, SquaresFour } from '@phosphor-icons/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { looseKey } from '../../core/answer/normalize';
import { EmptyState, LoadingBlock, Segmented } from '../components';
import { useHotkeys, useSets } from '../hooks';
import { useI18n } from '../i18n';
import { PageHeader } from '../shell/Shell';
import { useSettings } from '../state';
import { EMPTY_STATS, SetTile, StatusBar, statsDirection, useSetSummaries } from '../widgets';

type Sort = 'recent' | 'name' | 'created' | 'updated';
type View = 'grid' | 'list';

const PREF_KEY = 'grapnel.setsView';

function readPrefs(): { sort: Sort; view: View } {
  try {
    const v = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}') as Partial<{ sort: Sort; view: View }>;
    return { sort: v.sort ?? 'recent', view: v.view ?? 'grid' };
  } catch {
    return { sort: 'recent', view: 'grid' };
  }
}

export function SetsPage() {
  const { t, relTime, locale } = useI18n();
  const { settings } = useSettings();
  const sets = useSets();
  const summaries = useSetSummaries(statsDirection(settings));
  const [q, setQ] = useState('');
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [{ sort, view }, setPrefs] = useState(readPrefs);
  const search = useRef<HTMLInputElement>(null);
  useHotkeys({ '/': () => search.current?.focus() });
  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ sort, view }));
    } catch {
      // nur Komfort
    }
  }, [sort, view]);

  const list = useMemo(() => {
    if (!sets) return [];
    const needle = looseKey(q);
    const filtered = sets.filter((s) => (tab === 'archived' ? s.archivedAt : !s.archivedAt) && (!needle || looseKey(`${s.title} ${s.description}`).includes(needle)));
    const coll = new Intl.Collator(locale, { sensitivity: 'base', numeric: true });
    return filtered.sort((a, b) => {
      switch (sort) {
        case 'name':
          return coll.compare(a.title, b.title);
        case 'created':
          return b.createdAt - a.createdAt;
        case 'updated':
          return b.updatedAt - a.updatedAt;
        default:
          return (b.lastStudiedAt ?? 0) - (a.lastStudiedAt ?? 0) || b.updatedAt - a.updatedAt;
      }
    });
  }, [sets, q, tab, sort, locale]);

  if (!sets || !summaries) return <LoadingBlock />;
  const archivedCount = sets.filter((s) => s.archivedAt).length;

  return (
    <div className="stack">
      <PageHeader
        title={t('sets.title')}
        sub={t('count.sets', { n: sets.length - archivedCount })}
        actions={
          <>
            <Link to="/import" className="btn">
              <FileArrowUp size={18} />
              {t('common.import')}
            </Link>
            <Link to="/sets/new" className="btn btn-primary">
              <Plus size={18} />
              {t('home.newSet')}
            </Link>
          </>
        }
      />

      {sets.length === 0 ? (
        <EmptyState icon={<Cards size={22} />} title={t('sets.empty.title')} text={t('sets.empty.text')}>
          <Link to="/sets/new" className="btn btn-primary">
            <Plus size={18} />
            {t('home.newSet')}
          </Link>
          <Link to="/import" className="btn">
            <FileArrowUp size={18} />
            {t('common.import')}
          </Link>
        </EmptyState>
      ) : (
        <>
          <div className="toolbar">
            <div className="search">
              <MagnifyingGlass size={18} aria-hidden />
              <input ref={search} className="input" type="search" placeholder={t('sets.search')} aria-label={t('sets.search')} value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
            <Segmented
              label={t('sets.title')}
              value={tab}
              onChange={setTab}
              options={[
                { value: 'active', label: t('sets.active') },
                { value: 'archived', label: `${t('sets.archived')}${archivedCount ? ` (${archivedCount})` : ''}` },
              ]}
            />
            <select className="select toolbar-select" aria-label={t('sets.sort')} value={sort} onChange={(e) => setPrefs((p) => ({ ...p, sort: e.target.value as Sort }))}>
              <option value="recent">{t('sets.sort.recent')}</option>
              <option value="name">{t('sets.sort.name')}</option>
              <option value="created">{t('sets.sort.created')}</option>
              <option value="updated">{t('sets.sort.updated')}</option>
            </select>
            <Segmented
              label={t('sets.view.grid')}
              value={view}
              onChange={(v) => setPrefs((p) => ({ ...p, view: v }))}
              options={[
                { value: 'grid', label: <SquaresFour size={18} aria-label={t('sets.view.grid')} />, title: t('sets.view.grid') },
                { value: 'list', label: <Rows size={18} aria-label={t('sets.view.list')} />, title: t('sets.view.list') },
              ]}
            />
          </div>

          {list.length === 0 ? (
            <p className="muted">{q ? t('sets.noresults', { q }) : tab === 'archived' ? t('sets.archive.empty') : t('sets.empty.title')}</p>
          ) : view === 'grid' ? (
            <div className="tile-grid">
              {list.map((s) => (
                <SetTile key={s.id} set={s} stats={summaries.get(s.id) ?? EMPTY_STATS} />
              ))}
            </div>
          ) : (
            <div className="panel set-list">
              {list.map((s) => {
                const st = summaries.get(s.id) ?? EMPTY_STATS;
                return (
                  <Link key={s.id} to={`/sets/${s.id}`} className="set-row">
                    <span className="set-row-title break">{s.title || t('common.untitled')}</span>
                    <span className="set-row-meta muted small">{t('count.cards', { n: st.total })}</span>
                    <span className="set-row-meta muted small">{s.lastStudiedAt ? relTime(s.lastStudiedAt) : t('set.never')}</span>
                    <span className="set-row-bar">
                      <StatusBar stats={st} />
                    </span>
                    {st.dueToday > 0 ? <span className="badge badge-accent num">{t('set.dueBadge', { n: st.dueToday })}</span> : <span />}
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </div>
  );
}
