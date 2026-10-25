import { ChartBar, Fire } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { db } from '../../core/db/db';
import { activityByDay, effectiveLogs, forecast, mostMissed, overall, progressOverTime, setStats, streakOf } from '../../core/stats/stats';
import type { CardState, Direction } from '../../core/types';
import { lastDays } from '../../core/util/time';
import { AccuracyLine, Bars, Heatmap, StackedStatus } from '../charts';
import { EmptyState, LoadingBlock, Segmented } from '../components';
import { useI18n } from '../i18n';
import { PageHeader } from '../shell/Shell';
import { useSettings } from '../state';
import { StatusBar, StatusLegend, statsDirection } from '../widgets';

export function StatsPage() {
  const { t, relTime, percent, langName } = useI18n();
  const { settings } = useSettings();
  const [params, setParams] = useSearchParams();
  const scope = params.get('set') ?? 'all';
  const [direction, setDirection] = useState<Direction>(statsDirection(settings));

  const data = useLiveQuery(async () => {
    const sets = await db.sets.toArray();
    const inScope = scope === 'all' ? sets.filter((s) => !s.archivedAt) : sets.filter((s) => s.id === scope);
    const ids = inScope.map((s) => s.id);
    const [cards, states, logs, sessions] = await Promise.all([
      db.cards.where('setId').anyOf(ids).toArray(),
      db.cardStates.where('setId').anyOf(ids).toArray(),
      scope === 'all' ? db.reviewLogs.toArray() : db.reviewLogs.where('setId').equals(scope).toArray(),
      db.sessions.toArray(),
    ]);
    return { sets, inScope, cards, states, logs, sessions: scope === 'all' ? sessions : sessions.filter((s) => s.setIds.includes(scope)) };
  }, [scope]);

  const computed = useMemo(() => {
    if (!data) return null;
    const now = Date.now();
    const stateMap = new Map<string, CardState>(data.states.map((s) => [s.key, s]));
    const logs = effectiveLogs(data.logs);
    return {
      status: setStats(data.cards, stateMap, direction, now),
      overall: overall(logs, data.sessions),
      streak: streakOf(logs, now),
      heat: activityByDay(logs, lastDays(now, 18 * 7)),
      month: activityByDay(logs, lastDays(now, 30)),
      progress: progressOverTime(data.cards, logs, direction, settings, now, 30),
      forecast: forecast(data.states.filter((s) => s.direction === direction), now, 14),
      missed: mostMissed(logs, 10),
      perSet: data.inScope.map((s) => {
        const cards = data.cards.filter((c) => c.setId === s.id);
        return { set: s, stats: setStats(cards, stateMap, direction, now) };
      }),
    };
  }, [data, direction, settings]);

  if (!data || !computed) return <LoadingBlock />;
  const set = scope === 'all' ? null : data.sets.find((s) => s.id === scope);
  const cardsById = new Map(data.cards.map((c) => [c.id, c]));
  const frontLang = set?.frontLang ?? data.inScope[0]?.frontLang ?? 'other';
  const backLang = set?.backLang ?? data.inScope[0]?.backLang ?? 'other';
  const hasActivity = computed.overall.answers > 0;

  return (
    <div className="stack stats">
      <PageHeader
        title={t('stats.title')}
        sub={set ? set.title : t('stats.allSets')}
        actions={
          <select className="select toolbar-select" aria-label={t('stats.perSet')} value={scope} onChange={(e) => setParams(e.target.value === 'all' ? {} : { set: e.target.value })}>
            <option value="all">{t('stats.allSets')}</option>
            {data.sets
              .filter((s) => !s.archivedAt || s.id === scope)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
          </select>
        }
      />

      <Segmented
        label={t('setup.direction')}
        value={direction}
        onChange={setDirection}
        options={[
          { value: 'f2b', label: `${langName(frontLang)} → ${langName(backLang)}` },
          { value: 'b2f', label: `${langName(backLang)} → ${langName(frontLang)}` },
        ]}
      />

      {!hasActivity ? (
        <>
          <EmptyState icon={<ChartBar size={22} />} title={t('stats.empty.title')} text={t('stats.empty.text')}>
            {set ? (
              <Link to={`/study/${set.id}/learn`} className="btn btn-primary">
                {t('home.startFirst')}
              </Link>
            ) : (
              <Link to="/sets" className="btn btn-primary">
                {t('nav.sets')}
              </Link>
            )}
          </EmptyState>
          {computed.status.total > 0 && (
            <section className="panel panel-pad stack">
              <h2 className="small-heading">{t('stats.cards')}</h2>
              <StatusBar stats={computed.status} />
              <StatusLegend stats={computed.status} />
            </section>
          )}
        </>
      ) : (
        <>
          <div className="kpis">
            <div className="kpi panel">
              <span className="kpi-label">{t('stats.answers')}</span>
              <span className="kpi-value num">{computed.overall.answers}</span>
            </div>
            <div className="kpi panel">
              <span className="kpi-label">{t('stats.accuracy')}</span>
              <span className="kpi-value num">{computed.overall.accuracy === null ? t('stats.noValue') : percent(computed.overall.accuracy)}</span>
            </div>
            <div className="kpi panel">
              <span className="kpi-label">{t('stats.sessions')}</span>
              <span className="kpi-value num">{computed.overall.sessionsDone}</span>
            </div>
            <div className="kpi panel">
              <span className="kpi-label">{t('stats.streak')}</span>
              <span className="kpi-value num">
                {computed.streak.current > 0 && <Fire size={22} weight="fill" className="streak-icon" />}
                {t('count.days', { n: computed.streak.current })}
              </span>
              <span className="small muted">
                {computed.streak.studiedToday ? t('stats.streak.today') : t('stats.streak.notToday')}
                {computed.streak.longest > computed.streak.current ? `. ${t('stats.streak.longest', { n: computed.streak.longest })}` : ''}
              </span>
            </div>
          </div>

          <section className="panel panel-pad stack">
            <div>
              <h2 className="small-heading">{t('stats.activity')}</h2>
              <p className="small muted">{t('stats.activity.help')}</p>
            </div>
            <Heatmap days={computed.heat} />
          </section>

          <div className="grid-2 stats-grid">
            <section className="panel panel-pad stack">
              <div>
                <h2 className="small-heading">{t('stats.results')}</h2>
                <p className="small muted">{t('stats.results.help')}</p>
              </div>
              <AccuracyLine days={computed.month} />
            </section>
            <section className="panel panel-pad stack">
              <div>
                <h2 className="small-heading">{t('stats.daily')}</h2>
                <p className="small muted">{t('count.answers', { n: computed.month.reduce((n, d) => n + d.answers, 0) })}</p>
              </div>
              <Bars data={computed.month.map((d) => ({ day: d.day, value: d.answers }))} />
            </section>
          </div>

          <section className="panel panel-pad stack">
            <h2 className="small-heading">{t('stats.cards')}</h2>
            <StatusBar stats={computed.status} />
            <StatusLegend stats={computed.status} />
            <div>
              <h3 className="small-heading">{t('stats.progress')}</h3>
              <p className="small muted">{t('stats.progress.help')}</p>
            </div>
            <StackedStatus rows={computed.progress} />
          </section>

          <div className="grid-2 stats-grid">
            <section className="panel panel-pad stack">
              <h2 className="small-heading">{t('stats.forecast')}</h2>
              <Bars data={computed.forecast.map((d) => ({ day: d.day, value: d.count }))} highlightFirst />
            </section>
            <section className="panel panel-pad stack">
              <h2 className="small-heading">{t('stats.missed')}</h2>
              {computed.missed.length === 0 ? (
                <p className="muted small">{t('stats.missed.none')}</p>
              ) : (
                <ol className="missed">
                  {computed.missed.map((m) => {
                    const c = cardsById.get(m.cardId);
                    if (!c) return null;
                    return (
                      <li key={m.cardId}>
                        <span className="break">{c.front}</span>
                        <span className="break text-2">{c.back}</span>
                        <span className="badge badge-danger num">{t('stats.wrongOf', { w: m.wrong, t: m.total })}</span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          </div>
        </>
      )}

      {scope === 'all' && computed.perSet.length > 0 && (
        <section>
          <div className="section-title">
            <h2>{t('stats.perSet')}</h2>
          </div>
          <div className="panel set-list">
            {computed.perSet.map(({ set: s, stats }) => (
              <Link key={s.id} to={`/stats?set=${s.id}`} className="set-row">
                <span className="set-row-title break">{s.title}</span>
                <span className="set-row-meta small muted">{t('count.cards', { n: stats.total })}</span>
                <span className="set-row-meta small muted">{stats.lastActivity ? relTime(stats.lastActivity) : t('set.never')}</span>
                <span className="set-row-bar">
                  <StatusBar stats={stats} />
                </span>
                {stats.dueToday > 0 ? <span className="badge badge-accent num">{t('set.dueBadge', { n: stats.dueToday })}</span> : <span />}
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
