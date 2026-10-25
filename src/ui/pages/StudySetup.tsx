import { CheckSquare, MagnifyingGlass, Play, Square } from '@phosphor-icons/react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { looseKey } from '../../core/answer/normalize';
import { db } from '../../core/db/db';
import { isAutoDifficult, isDueNow, lastWasWrong } from '../../core/srs/status';
import { countSelections, nextDue, selectItems, type SelectionKind } from '../../core/session/selection';
import type { TestQType } from '../../core/session/test';
import type { Card, CardState, DirectionChoice, StudyMode } from '../../core/types';
import { randomSeed } from '../../core/util/rng';
import { Field, LoadingBlock, Segmented, Stepper, Switch } from '../components';
import { useIsDesktop } from '../hooks';
import { useI18n, type Key } from '../i18n';
import { PageHeader } from '../shell/Shell';
import { useSettings, useToast } from '../state';
import { startSession } from '../study/start';
import { NotFound } from './NotFound';

const MODES: StudyMode[] = ['flashcards', 'learn', 'write', 'mc', 'test', 'match', 'mixed'];
const KINDS: SelectionKind[] = ['all', 'due', 'new', 'difficult', 'wrong', 'flagged', 'random', 'manual'];
const TEST_TYPES: TestQType[] = ['write', 'mc', 'match', 'truefalse'];

export function StudySetup() {
  const { scope = 'all', mode: modeParam } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { t, langName, relTime } = useI18n();
  const { settings } = useSettings();
  const isDesktop = useIsDesktop();
  const mode = (MODES.includes(modeParam as StudyMode) ? modeParam : 'learn') as StudyMode;

  const data = useLiveQuery(async () => {
    const sets = scope === 'all' ? await db.sets.filter((s) => !s.archivedAt).toArray() : (await db.sets.bulkGet([scope])).filter((s) => !!s);
    const ids = sets.map((s) => s!.id);
    const cards = (await db.cards.where('setId').anyOf(ids).toArray()).sort((a, b) => (a.setId === b.setId ? a.position - b.position : ids.indexOf(a.setId) - ids.indexOf(b.setId)));
    const states = await db.cardStates.where('setId').anyOf(ids).toArray();
    return { sets: sets as NonNullable<(typeof sets)[number]>[], cards, states: new Map<string, CardState>(states.map((s) => [s.key, s])) };
  }, [scope]);

  const presetManual = params.get('cards')?.split(',').filter(Boolean) ?? null;
  const [kind, setKind] = useState<SelectionKind>((presetManual ? 'manual' : (params.get('sel') as SelectionKind)) || (mode === 'learn' || mode === 'mixed' ? 'all' : 'all'));
  const [direction, setDirection] = useState<DirectionChoice>((params.get('dir') as DirectionChoice) || settings.defaultDirection);
  const [tags, setTags] = useState<string[]>([]);
  const [randomCount, setRandomCount] = useState(20);
  const [manual, setManual] = useState<Set<string>>(() => new Set(presetManual ?? []));
  const [search, setSearch] = useState('');
  const [shuffleOn, setShuffle] = useState(mode === 'test' ? true : settings.autoShuffle);
  const [newLimit, setNewLimit] = useState(settings.newPerSession);
  const [flashRating, setFlashRating] = useState(settings.flashcardRating);
  // null = noch keine eigene Wahl: dann 20 oder weniger, falls das Set kleiner ist.
  const [testChoice, setTestCount] = useState<number | null>(null);
  const [testTypes, setTestTypes] = useState<TestQType[]>(['write', 'mc']);
  const [timeLimit, setTimeLimit] = useState<number | null>(null);
  const [showAnswers, setShowAnswers] = useState<'immediate' | 'end'>('end');
  const [matchTimer, setMatchTimer] = useState(true);
  const [seed] = useState(randomSeed);
  const [busy, setBusy] = useState(false);

  const cards = data?.cards ?? [];
  const states = data?.states ?? new Map();
  const allTags = useMemo(() => Array.from(new Set(cards.flatMap((c) => c.tags))).sort(), [cards]);
  const counts = useMemo(() => countSelections(cards, states, direction), [cards, states, direction]);
  const refs = useMemo(
    () => selectItems(cards, states, { kind, direction, tags, flag: 'any', randomCount, manualIds: [...manual], seed }),
    [cards, states, kind, direction, tags, randomCount, manual, seed],
  );

  // Aufschlüsselung für «Lernen»: was in die Sitzung kommt.
  const breakdown = useMemo(() => {
    const now = Date.now();
    let due = 0;
    let shaky = 0;
    let fresh = 0;
    let known = 0;
    for (const r of refs) {
      const st = states.get(`${r.c}:${r.d}`);
      if (!st || st.fsrs.state === 0) fresh++;
      else if (isDueNow(st, now)) due++;
      else if (st.fsrs.state !== 2 || lastWasWrong(st) || isAutoDifficult(st)) shaky++;
      else known++;
    }
    const freshUsed = Math.min(fresh, newLimit);
    return { due, shaky, fresh: freshUsed, freshAvailable: fresh, known, total: due + shaky + freshUsed + known };
  }, [refs, states, newLimit]);

  const testCount = Math.max(1, Math.min(testChoice ?? 20, Math.max(1, refs.length)));

  const manualList = useMemo(() => {
    const n = looseKey(search);
    return n ? cards.filter((c) => looseKey(`${c.front} ${c.back}`).includes(n)) : cards;
  }, [cards, search]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const manualVirtual = useVirtualizer({ count: manualList.length, getScrollElement: () => scrollRef.current, estimateSize: () => 48, overscan: 10 });

  if (!data) return <LoadingBlock />;
  if (scope !== 'all' && data.sets.length === 0) return <NotFound text={t('set.notFound')} />;

  const set = scope === 'all' ? null : data.sets[0];
  const frontLang = set?.frontLang ?? data.sets[0]?.frontLang ?? 'other';
  const backLang = set?.backLang ?? data.sets[0]?.backLang ?? 'other';
  const sessionCount = mode === 'learn' || mode === 'mixed' ? breakdown.total : mode === 'test' ? Math.min(testCount, refs.length) : refs.length;
  const empty = sessionCount === 0;

  const emptyText = (): string => {
    if (kind === 'due') {
      const nd = nextDue(cards, states, direction);
      return nd ? `${t('sel.empty.due')} ${t('sel.empty.dueNext', { when: relTime(nd) })}` : t('sel.empty.due');
    }
    if (kind === 'new' || ((mode === 'learn' || mode === 'mixed') && breakdown.freshAvailable === 0 && refs.length === 0)) return t('sel.empty.new');
    if (kind === 'difficult') return t('sel.empty.difficult');
    if (kind === 'wrong') return t('sel.empty.wrong');
    if (kind === 'flagged') return t('sel.empty.flagged');
    if (kind === 'manual') return t('sel.empty.manual');
    return t('sel.empty.generic');
  };
  const alternatives = KINDS.filter((k) => k !== kind && k !== 'manual' && k !== 'random' && (counts[k as keyof typeof counts] ?? 0) > 0).slice(0, 3);

  const start = async () => {
    setBusy(true);
    try {
      const id = await startSession({
        mode,
        setIds: data.sets.map((s) => s.id),
        title: set?.title ?? t('setup.allSets'),
        refs,
        settings,
        shuffle: shuffleOn,
        newLimit,
        flashRating,
        test: { count: testCount, types: testTypes, shuffle: shuffleOn, timeLimitMin: timeLimit, showAnswers },
        matchTimer,
        matchPerRound: isDesktop ? 6 : 5,
      });
      navigate(`/session/${id}`, { replace: true });
    } catch {
      toast(t('common.error'), { kind: 'error' });
      setBusy(false);
    }
  };

  const dirLabel = (d: DirectionChoice) => (d === 'both' ? t('dir.both') : d === 'f2b' ? `${langName(frontLang)} → ${langName(backLang)}` : `${langName(backLang)} → ${langName(frontLang)}`);

  return (
    <div className="stack narrow setup">
      <PageHeader
        back={set ? { to: `/sets/${set.id}`, label: set.title } : { to: '/review', label: t('nav.review') }}
        title={t(`mode.${mode}` as Key)}
        sub={set ? set.title : t('setup.allSets')}
      />

      <section className="panel panel-pad stack">
        <h2 className="small-heading">{t('setup.which')}</h2>
        <div className="chips">
          {KINDS.map((k) => (
            <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {t(`sel.${k}` as Key)}
              {k in counts && <span className="count">{counts[k as keyof typeof counts]}</span>}
            </button>
          ))}
        </div>
        {kind === 'random' && (
          <Field label={t('setup.randomCount')}>
            <Stepper label={t('setup.randomCount')} value={randomCount} onChange={setRandomCount} min={1} max={Math.max(1, counts.all)} step={5} />
          </Field>
        )}
        {kind === 'manual' && (
          <div className="manual-pick">
            <div className="row">
              <div className="search">
                <MagnifyingGlass size={18} aria-hidden />
                <input className="input" type="search" placeholder={t('setup.manual.search')} aria-label={t('setup.manual.search')} value={search} onChange={(e) => setSearch(e.target.value)} />
              </div>
              <button className="btn btn-sm" onClick={() => setManual(new Set(manualList.map((c) => c.id)))}>
                {t('import.selectAll')}
              </button>
              <button className="btn btn-sm" onClick={() => setManual(new Set())}>
                {t('import.selectNone')}
              </button>
            </div>
            <div ref={scrollRef} className="manual-scroll">
              <div style={{ height: manualVirtual.getTotalSize(), position: 'relative' }}>
                {manualVirtual.getVirtualItems().map((v) => {
                  const c: Card = manualList[v.index];
                  const on = manual.has(c.id);
                  return (
                    <button
                      key={c.id}
                      className="manual-row"
                      style={{ position: 'absolute', top: 0, left: 0, right: 0, height: v.size, transform: `translateY(${v.start}px)` }}
                      aria-pressed={on}
                      onClick={() =>
                        setManual((s) => {
                          const n = new Set(s);
                          if (n.has(c.id)) n.delete(c.id);
                          else n.add(c.id);
                          return n;
                        })
                      }
                    >
                      {on ? <CheckSquare size={20} weight="fill" className="accent" /> : <Square size={20} />}
                      <span className="break">{c.front}</span>
                      <span className="muted break">{c.back}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
        {allTags.length > 0 && (
          <Field label={t('setup.tags')}>
            <div className="chips">
              {allTags.map((tag) => (
                <button key={tag} className="chip" aria-pressed={tags.includes(tag)} onClick={() => setTags((x) => (x.includes(tag) ? x.filter((y) => y !== tag) : [...x, tag]))}>
                  {tag}
                </button>
              ))}
            </div>
          </Field>
        )}
        <Field label={t('setup.direction')}>
          <Segmented
            label={t('setup.direction')}
            value={direction}
            onChange={setDirection}
            options={(['f2b', 'b2f', 'both'] as DirectionChoice[]).map((d) => ({ value: d, label: dirLabel(d) }))}
          />
        </Field>
      </section>

      {(mode === 'learn' || mode === 'mixed') && (
        <section className="panel panel-pad stack">
          <Field label={t('setup.newLimit')}>
            <Stepper label={t('setup.newLimit')} value={newLimit} onChange={setNewLimit} min={0} max={200} step={5} />
          </Field>
          <p className="small text-2 num">{t('setup.breakdown', { due: breakdown.due, shaky: breakdown.shaky, fresh: breakdown.fresh, known: breakdown.known })}</p>
        </section>
      )}

      {(mode === 'flashcards' || mode === 'write' || mode === 'mc') && (
        <section className="panel panel-pad">
          <Switch checked={shuffleOn} onChange={setShuffle} label={t('setup.shuffle')} />
          {mode === 'flashcards' && (
            <Field label={t('flash.rating')}>
              <Segmented
                label={t('flash.rating')}
                value={flashRating}
                onChange={setFlashRating}
                options={[
                  { value: 'binary', label: t('flash.rating.binary') },
                  { value: 'four', label: t('flash.rating.four') },
                ]}
              />
            </Field>
          )}
        </section>
      )}

      {mode === 'test' && (
        <section className="panel panel-pad stack">
          <Field label={t('test.count')}>
            <Stepper label={t('test.count')} value={testCount} onChange={setTestCount} min={1} max={Math.max(1, refs.length)} step={5} />
          </Field>
          <Field label={t('test.types')}>
            <div className="chips">
              {TEST_TYPES.map((tt) => (
                <button
                  key={tt}
                  className="chip"
                  aria-pressed={testTypes.includes(tt)}
                  onClick={() => setTestTypes((x) => (x.includes(tt) ? (x.length > 1 ? x.filter((y) => y !== tt) : x) : [...x, tt]))}
                >
                  {t(`test.type.${tt}` as Key)}
                </button>
              ))}
            </div>
          </Field>
          <Switch checked={shuffleOn} onChange={setShuffle} label={t('setup.shuffle')} />
          <Field label={t('test.timeLimit')}>
            <Segmented
              label={t('test.timeLimit')}
              value={String(timeLimit ?? 0)}
              onChange={(v) => setTimeLimit(v === '0' ? null : Number(v))}
              options={[0, 5, 10, 15, 30].map((m) => ({ value: String(m), label: m === 0 ? t('test.noLimit') : t('test.minutes', { n: m }) }))}
            />
          </Field>
          <Field label={t('test.answers')}>
            <Segmented
              label={t('test.answers')}
              value={showAnswers}
              onChange={setShowAnswers}
              options={[
                { value: 'immediate', label: t('test.answers.immediate') },
                { value: 'end', label: t('test.answers.end') },
              ]}
            />
          </Field>
        </section>
      )}

      {mode === 'match' && (
        <section className="panel panel-pad">
          <Switch checked={matchTimer} onChange={setMatchTimer} label={t('match.timer')} />
        </section>
      )}

      {empty ? (
        <div className="callout warning stack" role="status">
          <span>{emptyText()}</span>
          {alternatives.length > 0 && (
            <div className="row-wrap">
              <span className="small">{t('sel.alt')}:</span>
              {alternatives.map((k) => (
                <button key={k} className="btn btn-sm" onClick={() => setKind(k)}>
                  {t(`sel.${k}` as Key)} ({counts[k as keyof typeof counts]})
                </button>
              ))}
              {(mode === 'learn' || mode === 'mixed') && newLimit === 0 && breakdown.freshAvailable > 0 && (
                <button className="btn btn-sm" onClick={() => setNewLimit(settings.newPerSession || 10)}>
                  {t('home.learnNew')}
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        <div className="start-bar">
          <span className="num">{t('setup.count', { n: sessionCount })}</span>
          <button className="btn btn-primary btn-lg" disabled={busy} onClick={() => void start()}>
            <Play size={18} weight="fill" />
            {t('setup.start')}
          </button>
        </div>
      )}
    </div>
  );
}
