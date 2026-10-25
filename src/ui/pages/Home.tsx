import { ArrowRight, Brain, FileArrowUp, Fire, Plus, Sparkle } from '@phosphor-icons/react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { db } from '../../core/db/db';
import { streakOf } from '../../core/stats/stats';
import { dayKey, startOfDay } from '../../core/util/time';
import type { StudyMode } from '../../core/types';
import { EmptyState, LoadingBlock, Progress } from '../components';
import { useSets } from '../hooks';
import { useI18n, type Key } from '../i18n';
import { useSettings } from '../state';
import { EMPTY_STATS, SetTile, statsDirection, useSetSummaries } from '../widgets';

function greetingKey(hour: number): 'morning' | 'day' | 'evening' {
  if (hour < 11) return 'morning';
  if (hour < 17) return 'day';
  return 'evening';
}

export function Home() {
  const { t, relTime } = useI18n();
  const { settings } = useSettings();
  const navigate = useNavigate();
  const sets = useSets();
  const summaries = useSetSummaries(statsDirection(settings));
  const session = useLiveQuery(async () => (await db.sessions.where('status').equals('active').toArray()).sort((a, b) => b.updatedAt - a.updatedAt)[0] ?? null, []);
  const recentLogs = useLiveQuery(() => db.reviewLogs.where('at').above(startOfDay(Date.now()) - 400 * 86400000).toArray(), []);
  const nextDue = useLiveQuery(async () => {
    const now = Date.now();
    const next = await db.cardStates.where('due').above(now).filter((s) => s.fsrs.state !== 0).first();
    return next?.due ?? null;
  }, []);

  const active = useMemo(() => (sets ?? []).filter((s) => !s.archivedAt), [sets]);
  const today = useMemo(() => {
    const logs = recentLogs ?? [];
    const key = dayKey(Date.now());
    return { answers: logs.filter((l) => l.result !== 'skipped' && dayKey(l.at) === key).length, streak: streakOf(logs) };
  }, [recentLogs]);

  if (!sets || !summaries || session === undefined) return <LoadingBlock />;

  const hour = new Date().getHours();
  const g = greetingKey(hour);
  const greeting = settings.name.trim() ? t(`home.greeting.${g}` as Key, { name: settings.name.trim() }) : t(`home.greeting.${g}.anon` as Key);

  if (active.length === 0 && sets.length === 0) {
    return (
      <div className="stack home">
        <header className="page-header">
          <h1>{greeting}</h1>
        </header>
        <EmptyState icon={<Sparkle size={22} />} title={t('home.empty.title')} text={t('home.empty.text')}>
          <Link to="/import" className="btn btn-primary">
            <FileArrowUp size={18} />
            {t('home.import')}
          </Link>
          <Link to="/sets/new" className="btn">
            <Plus size={18} />
            {t('home.newSet')}
          </Link>
        </EmptyState>
      </div>
    );
  }

  const dueSets = active.map((s) => ({ set: s, due: summaries.get(s.id)?.dueToday ?? 0 })).filter((x) => x.due > 0).sort((a, b) => b.due - a.due);
  const dueTotal = dueSets.reduce((n, x) => n + x.due, 0);
  const recent = active.filter((s) => s.lastStudiedAt).sort((a, b) => (b.lastStudiedAt ?? 0) - (a.lastStudiedAt ?? 0)).slice(0, 3);
  const newTarget = (recent[0] && (summaries.get(recent[0].id)?.new ?? 0) > 0 ? recent[0] : active.find((s) => (summaries.get(s.id)?.new ?? 0) > 0)) ?? null;
  const sessionSet = session ? sets.find((s) => s.id === session.setIds[0]) : null;
  // Bei wenigen Sets stünde dasselbe Set sonst zweimal da.
  const showRecent = recent.length > 0 && active.length > 6;

  // Die eine nächste sinnvolle Aktion.
  let hero: { title: string; sub: string; to: string; cta: string; progress?: number };
  if (session) {
    hero = {
      title: t('home.continue'),
      sub: t('home.continue.session', { mode: t(`mode.${session.mode as StudyMode}` as Key), set: session.setIds.length > 1 ? t('setup.allSets') : sessionSet?.title ?? session.title }),
      to: `/session/${session.id}`,
      cta: t('home.continue'),
      progress: session.progressTotal ? session.progressDone / session.progressTotal : undefined,
    };
  } else if (dueTotal > 0) {
    hero = { title: t('home.due.count', { n: dueTotal }), sub: dueSets.map((x) => x.set.title).slice(0, 3).join(', '), to: '/study/all/learn?sel=due', cta: t('home.due.start') };
  } else if (newTarget) {
    hero = { title: t('home.learnNew'), sub: t('home.learnNew.in', { set: newTarget.title }), to: `/study/${newTarget.id}/learn?sel=new`, cta: t('home.startFirst') };
  } else {
    hero = { title: t('home.due.none'), sub: nextDue ? t('home.due.next', { when: relTime(nextDue) }) : '', to: '/sets', cta: t('nav.sets') };
  }

  return (
    <div className="stack home">
      <header className="page-header">
        <div className="page-header-row">
          <div className="page-title">
            <h1>{greeting}</h1>
            <div className="page-sub">{today.answers > 0 ? t('home.today.answers', { n: today.answers }) : t('home.today.none')}</div>
          </div>
          <div className="page-actions">
            <Link to="/import" className="btn">
              <FileArrowUp size={18} />
              {t('home.import')}
            </Link>
            <Link to="/sets/new" className="btn">
              <Plus size={18} />
              {t('home.newSet')}
            </Link>
          </div>
        </div>
      </header>

      <div className="home-top">
        <button className="hero-card" onClick={() => navigate(hero.to)}>
          <span className="hero-icon">
            <Brain size={24} />
          </span>
          <span className="hero-text">
            <span className="hero-title">{hero.title}</span>
            {hero.sub && <span className="hero-sub break">{hero.sub}</span>}
            {hero.progress !== undefined && (
              <span className="hero-progress">
                <Progress value={hero.progress} />
                <span className="small num">{t('home.continue.progress', { done: session!.progressDone, total: session!.progressTotal })}</span>
              </span>
            )}
          </span>
          <span className="hero-cta">
            {hero.cta}
            <ArrowRight size={18} />
          </span>
        </button>

        <div className="today-card panel panel-pad">
          <span className="eyebrow-label">{t('home.today')}</span>
          {today.streak.current > 0 ? (
            <div className="today-streak">
              <Fire size={22} weight="fill" />
              <span className="num">{t('home.streak', { n: today.streak.current })}</span>
            </div>
          ) : (
            <div className="today-streak muted">{t('home.today.none')}</div>
          )}
          <div className="today-due">
            {dueTotal > 0 ? (
              <Link to="/review">{t('home.due.count', { n: dueTotal })}</Link>
            ) : (
              <span className="muted">{nextDue ? t('home.due.next', { when: relTime(nextDue) }) : t('home.due.none')}</span>
            )}
          </div>
        </div>
      </div>

      {dueSets.length > 1 && (
        <section>
          <div className="section-title">
            <h2>{t('review.bySet')}</h2>
            <Link to="/review">{t('home.showAll')}</Link>
          </div>
          <div className="due-list panel">
            {dueSets.slice(0, 4).map(({ set, due }) => (
              <Link key={set.id} to={`/study/${set.id}/learn?sel=due`} className="due-row">
                <span className="break">{set.title}</span>
                <span className="badge badge-accent num">{t('set.dueBadge', { n: due })}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {showRecent && (
        <section>
          <div className="section-title">
            <h2>{t('home.recent')}</h2>
          </div>
          <div className="tile-grid">
            {recent.map((s) => (
              <SetTile key={s.id} set={s} stats={summaries.get(s.id) ?? EMPTY_STATS} />
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="section-title">
          <h2>{t('home.allSets')}</h2>
          <Link to="/sets">{t('home.showAll')}</Link>
        </div>
        <div className="tile-grid">
          {active
            .slice()
            .sort((a, b) => (b.lastStudiedAt ?? 0) - (a.lastStudiedAt ?? 0) || b.updatedAt - a.updatedAt)
            .slice(0, 6)
            .map((s) => (
              <SetTile key={s.id} set={s} stats={summaries.get(s.id) ?? EMPTY_STATS} />
            ))}
        </div>
      </section>
    </div>
  );
}
