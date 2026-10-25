import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { parseKey } from '../../core/session/deck';
import { learnAnswer, learnOverride, learnProgress, learnTask, startRound, type LearnState } from '../../core/session/learn';
import type { Session } from '../../core/types';
import { useI18n } from '../i18n';
import { useStudy } from './common';
import { useFrame, useSessionState } from './SessionPage';
import { Summary } from './Summary';
import { TaskView, type AnyTask } from './TaskView';

/** «Lernen» und «Gemischt»: Runden mit wechselnden Aufgaben je nach Lernstand. */
export function LearnRunner({ session }: { session: Session }) {
  const { t } = useI18n();
  const { deck } = useStudy();
  const frame = useFrame();
  const navigate = useNavigate();
  const { state, update, finish } = useSessionState<LearnState>(session);
  const [showing, setShowing] = useState<{ task: AnyTask; n: number } | null>(() => (state.current ? { task: state.current, n: 0 } : null));
  const prog = learnProgress(state);

  useEffect(() => frame.setProgress(prog.done, prog.total), [prog.done, prog.total, frame]);
  useEffect(() => {
    frame.setFinisher(() => update((s) => void (s.done = true)));
    return () => frame.setFinisher(null);
  }, [frame, update]);

  // Nächste Aufgabe erzeugen, sobald keine aktive da ist.
  useEffect(() => {
    if (state.done || state.betweenRounds || state.current || showing) return;
    const next = update((s) => void learnTask(s, deck));
    if (next.current) setShowing((prev) => ({ task: next.current!, n: (prev?.n ?? 0) + 1 }));
  }, [state.done, state.betweenRounds, state.current, showing, update, deck]);

  useEffect(() => {
    if (state.done) void finish();
  }, [state.done, finish]);

  if (state.done && !showing) {
    const items = Object.values(state.items);
    const practice = items.filter((i) => i.wrong > 0).map((i) => parseKey(i.key));
    return (
      <Summary
        session={session}
        title={t('session.finished')}
        lead={t('learn.summary.lead', { n: items.filter((i) => i.stage === 'done').length })}
        note={t('learn.summary.note')}
        practice={practice}
        extraActions={
          session.setIds.length === 1 ? (
            <button className="btn btn-lg" onClick={() => navigate(`/study/${session.setIds[0]}/${session.mode}?sel=new`, { replace: true })}>
              {t('session.newCardsMore')}
            </button>
          ) : undefined
        }
      />
    );
  }

  if (state.betweenRounds && !showing) {
    const correct = state.roundLog.filter((e) => e.correct).length;
    const wrong = Array.from(new Set(state.roundLog.filter((e) => !e.correct).map((e) => e.key)));
    return (
      <div className="round-break">
        <h1>{t('session.roundDone', { n: state.round })}</h1>
        <p className="text-2 num">{t('session.roundSummary', { c: correct, t: state.roundLog.length })}</p>
        <div className="round-stats num">
          <span>
            <strong>{prog.done}</strong> {t('learn.done')}
          </span>
          <span>
            <strong>{prog.learning}</strong> {t('learn.learning')}
          </span>
          <span>
            <strong>{prog.fresh}</strong> {t('learn.fresh')}
          </span>
        </div>
        {wrong.length > 0 && (
          <div className="panel summary-list">
            <h2 className="small-heading">{t('session.roundWrong')}</h2>
            <ul>
              {wrong.slice(0, 12).map((k) => {
                const ref = parseKey(k);
                const c = deck.card(ref.c);
                return c ? (
                  <li key={k}>
                    <span className="break">{ref.d === 'f2b' ? c.front : c.back}</span>
                    <span className="break text-2">{ref.d === 'f2b' ? c.back : c.front}</span>
                  </li>
                ) : null;
              })}
            </ul>
          </div>
        )}
        <button className="btn btn-primary btn-lg" autoFocus onClick={() => update((s) => startRound(s))}>
          {t('session.nextRound')}
        </button>
      </div>
    );
  }

  if (!showing) return null;
  const item = state.items[showing.task.key];
  return (
    <TaskView
      key={showing.n}
      task={showing.task}
      stageLabel={item?.stage === 'write' || showing.task.type === 'write' ? 'learn.stage.write' : 'learn.stage.mc'}
      onResult={(correct) => update((s) => learnAnswer(s, correct), learnProgress)}
      onOverride={() => update((s) => learnOverride(s, showing.task.key), learnProgress)}
      onNext={() => setShowing(null)}
    />
  );
}
