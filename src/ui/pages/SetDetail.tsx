import { Archive, ChartBar, Copy, DotsThree, Export, FileArrowUp, MagnifyingGlass, PencilSimple, Plus, Trash } from '@phosphor-icons/react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { looseKey } from '../../core/answer/normalize';
import { archiveSet, deleteSet, duplicateSet } from '../../core/db/repo';
import { setStats, statesFor } from '../../core/stats/stats';
import { isAutoDifficult, isDueNow, lastWasWrong, statusOf, strongestState } from '../../core/srs/status';
import type { Card, DirectionChoice } from '../../core/types';
import { CardDialog, FlagToggles, StatusBadge } from '../cardview';
import { ConfirmDialog, EmptyState, LoadingBlock, Menu, Segmented } from '../components';
import { ExportDialog } from '../exporting';
import { useCards, useHotkeys, useSet, useSetStates } from '../hooks';
import { useI18n, type Key } from '../i18n';
import { PageHeader } from '../shell/Shell';
import { useToast } from '../state';
import { ModeGrid, StatusBar, StatusLegend } from '../widgets';
import { NotFound } from './NotFound';

type Filter = 'all' | 'due' | 'new' | 'difficult' | 'flagged' | 'wrong' | 'mastered';
const FILTERS: Filter[] = ['all', 'due', 'new', 'difficult', 'flagged', 'wrong', 'mastered'];

export function SetDetail() {
  const { setId } = useParams();
  const { t, langName } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const set = useSet(setId);
  const cards = useCards(setId);
  const states = useSetStates(setId);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [tag, setTag] = useState('');
  const [openCard, setOpenCard] = useState<Card | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [exporting, setExporting] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  useHotkeys({ '/': () => search.current?.focus() });

  const [dir, setDir] = useState<DirectionChoice>('both');
  const stats = useMemo(() => (cards && states ? setStats(cards, states, dir) : null), [cards, states, dir]);
  const tags = useMemo(() => Array.from(new Set((cards ?? []).flatMap((c) => c.tags))).sort(), [cards]);

  const visible = useMemo(() => {
    if (!cards || !states) return [];
    const needle = looseKey(q);
    const now = Date.now();
    return cards.filter((c) => {
      if (tag && !c.tags.includes(tag)) return false;
      if (needle && !looseKey(`${c.front} ${c.back} ${c.example} ${c.notes} ${c.tags.join(' ')}`).includes(needle)) return false;
      const list = statesFor(states, c.id, dir);
      switch (filter) {
        case 'due':
          return list.some((st) => isDueNow(st, now));
        case 'new':
          return statusOf(strongestState(list)) === 'new';
        case 'difficult':
          return list.some((st) => isAutoDifficult(st));
        case 'flagged':
          return c.flagDifficult || c.flagImportant;
        case 'wrong':
          return list.some((st) => lastWasWrong(st));
        case 'mastered':
          return statusOf(strongestState(list)) === 'mastered';
        default:
          return true;
      }
    });
  }, [cards, states, q, filter, tag, dir]);

  const virtualizer = useWindowVirtualizer({
    count: visible.length,
    estimateSize: () => 64,
    overscan: 12,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  if (set === undefined || !cards || !states || !stats) return <LoadingBlock />;
  if (set === null) return <NotFound text={t('set.notFound')} />;

  const counts: Record<Filter, number> = {
    all: cards.length,
    due: stats.dueToday,
    new: stats.new,
    difficult: stats.difficult,
    flagged: stats.flagged,
    wrong: cards.filter((c) => statesFor(states, c.id, dir).some((st) => lastWasWrong(st))).length,
    mastered: stats.mastered,
  };

  return (
    <div className="stack set-detail">
      <PageHeader
        back={{ to: '/sets', label: t('nav.sets') }}
        title={set.title || t('common.untitled')}
        sub={
          <span className="row-wrap">
            <span>{t('count.cards', { n: cards.length })}</span>
            <span className="dot-sep">·</span>
            <span>
              {langName(set.frontLang)} → {langName(set.backLang)}
            </span>
          </span>
        }
        actions={
          <>
            <Link to={`/sets/${set.id}/edit`} className="btn">
              <PencilSimple size={18} />
              {t('set.edit')}
            </Link>
            <Menu
              trigger={(p) => (
                <button className="btn btn-icon" aria-label={t('common.more')} {...p}>
                  <DotsThree size={22} weight="bold" />
                </button>
              )}
            >
              {(close) => (
                <>
                  <Link to={`/import?set=${set.id}`} onClick={close}>
                    <FileArrowUp size={18} />
                    {t('set.importInto')}
                  </Link>
                  <button
                    onClick={() => {
                      close();
                      setExporting(true);
                    }}
                  >
                    <Export size={18} />
                    {t('common.export')}
                  </button>
                  <Link to={`/stats?set=${set.id}`} onClick={close}>
                    <ChartBar size={18} />
                    {t('set.stats')}
                  </Link>
                  <button
                    onClick={async () => {
                      close();
                      const copy = await duplicateSet(set.id, t('set.copySuffix'));
                      toast(t('set.duplicated'));
                      navigate(`/sets/${copy.id}`);
                    }}
                  >
                    <Copy size={18} />
                    {t('common.duplicate')}
                  </button>
                  <button
                    onClick={async () => {
                      close();
                      await archiveSet(set.id, !set.archivedAt);
                      toast(set.archivedAt ? t('set.unarchivedToast') : t('set.archivedToast'), {
                        action: { label: t('common.undo'), run: () => void archiveSet(set.id, !!set.archivedAt) },
                      });
                    }}
                  >
                    <Archive size={18} />
                    {set.archivedAt ? t('common.unarchive') : t('common.archive')}
                  </button>
                  <hr />
                  <button
                    className="danger"
                    onClick={() => {
                      close();
                      setConfirmDelete(true);
                    }}
                  >
                    <Trash size={18} />
                    {t('common.delete')}
                  </button>
                </>
              )}
            </Menu>
          </>
        }
      />

      {set.description && <p className="text-2 break pre set-description">{set.description}</p>}
      {set.archivedAt && <div className="callout">{t('set.archivedNote')}</div>}

      {cards.length === 0 ? (
        <EmptyState icon={<Plus size={22} />} title={t('set.noCards.title')} text={t('set.noCards.text')}>
          <Link to={`/sets/${set.id}/edit`} className="btn btn-primary">
            <Plus size={18} />
            {t('set.addCards')}
          </Link>
          <Link to={`/import?set=${set.id}`} className="btn">
            <FileArrowUp size={18} />
            {t('common.import')}
          </Link>
        </EmptyState>
      ) : (
        <>
          <section className="panel panel-pad set-progress">
            <div className="row-wrap" style={{ justifyContent: 'space-between' }}>
              <h2 className="small-heading">{t('home.progress')}</h2>
              {stats.dueToday > 0 && (
                <Link to={`/study/${set.id}/learn?sel=due`} className="badge badge-accent num">
                  {t('set.dueBadge', { n: stats.dueToday })}
                </Link>
              )}
            </div>
            <StatusBar stats={stats} />
            <StatusLegend stats={stats} />
            <Segmented
              label={t('setup.direction')}
              value={dir}
              onChange={setDir}
              options={[
                { value: 'both', label: t('dir.both') },
                { value: 'f2b', label: `${langName(set.frontLang)} → ${langName(set.backLang)}` },
                { value: 'b2f', label: `${langName(set.backLang)} → ${langName(set.frontLang)}` },
              ]}
            />
          </section>

          <section>
            <div className="section-title">
              <h2>{t('set.modes')}</h2>
            </div>
            <ModeGrid scope={set.id} />
          </section>

          <section>
            <div className="section-title">
              <h2>{t('set.cards')}</h2>
              <Link to={`/sets/${set.id}/edit`} className="small">
                {t('set.addCards')}
              </Link>
            </div>
            <div className="toolbar">
              <div className="search">
                <MagnifyingGlass size={18} aria-hidden />
                <input ref={search} className="input" type="search" placeholder={t('set.search')} aria-label={t('set.search')} value={q} onChange={(e) => setQ(e.target.value)} />
              </div>
              {tags.length > 0 && (
                <select className="select toolbar-select" aria-label={t('set.filter.tag')} value={tag} onChange={(e) => setTag(e.target.value)}>
                  <option value="">{t('set.filter.tag')}</option>
                  {tags.map((tg) => (
                    <option key={tg} value={tg}>
                      {tg}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div className="chips" role="group" aria-label={t('set.filter.all')}>
              {FILTERS.map((f) => (
                <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {t(`set.filter.${f}` as Key)} <span className="count">{counts[f]}</span>
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <p className="muted" style={{ padding: '16px 0' }}>
                {t('set.noMatch')}
              </p>
            ) : (
              <div ref={listRef} className="card-list panel" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
                {virtualizer.getVirtualItems().map((v) => {
                  const c = visible[v.index];
                  return (
                    <div
                      key={c.id}
                      data-index={v.index}
                      ref={virtualizer.measureElement}
                      className="card-row"
                      style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${v.start - virtualizer.options.scrollMargin}px)` }}
                      onClick={() => setOpenCard(c)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setOpenCard(c)}
                    >
                      <span className="card-row-front break">{c.front || <span className="muted">-</span>}</span>
                      <span className="card-row-back break text-2">{c.back || <span className="muted">-</span>}</span>
                      <span className="card-row-meta">
                        <StatusBadge state={strongestState(statesFor(states, c.id, dir))} />
                        <FlagToggles card={c} />
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </>
      )}

      <CardDialog card={openCard ? (cards.find((c) => c.id === openCard.id) ?? null) : null} set={set} states={states} onClose={() => setOpenCard(null)} />
      <ExportDialog set={set} open={exporting} onClose={() => setExporting(false)} />
      <ConfirmDialog
        open={confirmDelete}
        danger
        title={t('set.delete.title', { title: set.title })}
        text={t('set.delete.text', { cards: t('count.cards', { n: cards.length }) })}
        confirmLabel={t('set.delete.confirm')}
        onClose={() => setConfirmDelete(false)}
        onConfirm={async () => {
          await deleteSet(set.id);
          setConfirmDelete(false);
          toast(t('set.deleted'));
          navigate('/sets', { replace: true });
        }}
      />
    </div>
  );
}
