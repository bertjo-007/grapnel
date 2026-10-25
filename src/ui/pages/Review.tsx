import { ArrowsClockwise, CheckCircle, Question } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { db } from '../../core/db/db';
import { forecast } from '../../core/stats/stats';
import { isDueNow } from '../../core/srs/status';
import type { StudyMode } from '../../core/types';
import { Bars } from '../charts';
import { EmptyState, LoadingBlock, Segmented } from '../components';
import { useI18n, type Key } from '../i18n';
import { PageHeader } from '../shell/Shell';

const REVIEW_MODES: StudyMode[] = ['learn', 'flashcards', 'write', 'mixed'];

export function ReviewPage() {
  const { t, relTime } = useI18n();
  const [mode, setMode] = useState<StudyMode>('learn');
  const data = useLiveQuery(async () => {
    const sets = await db.sets.filter((s) => !s.archivedAt).toArray();
    const ids = new Set(sets.map((s) => s.id));
    const states = (await db.cardStates.toArray()).filter((s) => ids.has(s.setId));
    return { sets, states };
  }, []);

  const view = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const due = data.states.filter((s) => isDueNow(s, now));
    const bySet = data.sets
      .map((set) => ({ set, due: due.filter((s) => s.setId === set.id).length }))
      .filter((x) => x.due > 0)
      .sort((a, b) => b.due - a.due);
    const next = data.states.filter((s) => s.fsrs.state !== 0 && s.due > now).sort((a, b) => a.due - b.due)[0]?.due ?? null;
    return { due: due.length, bySet, next, forecast: forecast(data.states, now, 14), studied: data.states.some((s) => s.fsrs.state !== 0) };
  }, [data]);

  if (!view) return <LoadingBlock />;

  return (
    <div className="stack review">
      <PageHeader
        title={t('review.title')}
        sub={view.due > 0 ? t('review.due', { n: view.due }) : undefined}
        actions={
          <Link to="/help/srs" className="btn btn-ghost">
            <Question size={18} />
            {t('review.explain')}
          </Link>
        }
      />

      {view.due === 0 ? (
        <EmptyState icon={<CheckCircle size={22} />} title={view.studied ? t('review.none.title') : t('review.title')} text={view.studied ? `${t('review.none.text')} ${view.next ? t('review.next', { when: relTime(view.next) }) : ''}` : t('review.noSets')}>
          <Link to="/sets" className="btn">
            {t('home.learnNew')}
          </Link>
        </EmptyState>
      ) : (
        <>
          <section className="panel panel-pad stack review-start">
            <h2 className="small-heading">{t('review.how')}</h2>
            <Segmented label={t('review.how')} value={mode} onChange={setMode} options={REVIEW_MODES.map((m) => ({ value: m, label: t(`mode.${m}` as Key) }))} />
            <div className="row-wrap">
              <span className="text-2">{t('review.due', { n: view.due })}</span>
              <div className="spacer" />
              <Link to={`/study/all/${mode}?sel=due`} className="btn btn-primary btn-lg">
                <ArrowsClockwise size={18} />
                {t('review.startAll')}
              </Link>
            </div>
          </section>

          <section>
            <div className="section-title">
              <h2>{t('review.bySet')}</h2>
            </div>
            <div className="panel due-list">
              {view.bySet.map(({ set, due }) => (
                <Link key={set.id} to={`/study/${set.id}/${mode}?sel=due`} className="due-row">
                  <span className="break">{set.title}</span>
                  <span className="badge badge-accent num">{t('set.dueBadge', { n: due })}</span>
                </Link>
              ))}
            </div>
          </section>
        </>
      )}

      {view.studied && (
        <section className="panel panel-pad stack">
          <h2 className="small-heading">{t('review.forecast')}</h2>
          <Bars data={view.forecast.map((d) => ({ day: d.day, value: d.count }))} highlightFirst />
        </section>
      )}
    </div>
  );
}
