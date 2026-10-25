import { useEffect, useState } from 'react';
import { parseKey } from '../../core/session/deck';
import { nextRound, roundsAnswer, roundsOverride, roundsProgress, roundsTask, type RoundsState } from '../../core/session/rounds';
import type { Session } from '../../core/types';
import { useI18n } from '../i18n';
import { useStudy } from './common';
import { useFrame, useSessionState } from './SessionPage';
import { Summary } from './Summary';
import { TaskView, type AnyTask } from './TaskView';

/** «Schreiben» und «Multiple Choice»: jede Karte einmal, Falsches in weiteren Runden. */
export function RoundsRunner({ session }: { session: Session }) {
  const { t } = useI18n();
  const { deck } = useStudy();
  const frame = useFrame();
  const { state, update, finish } = useSessionState<RoundsState>(session);
  const [showing, setShowing] = useState<{ task: AnyTask; n: number } | null>(() => (state.current ? { task: state.current, n: 0 } : null));
  const prog = roundsProgress(state);

  useEffect(() => frame.setProgress(prog.done, prog.total), [prog.done, prog.total, frame]);
  useEffect(() => {
    frame.setFinisher(() => update((s) => void (s.done = true)));
    return () => frame.setFinisher(null);
  }, [frame, update]);
  useEffect(() => {
    if (state.done || state.betweenRounds || state.current || showing) return;
    const next = update((s) => void roundsTask(s, deck));
    if (next.current) setShowing((prev) => ({ task: next.current!, n: (prev?.n ?? 0) + 1 }));
  }, [state.done, state.betweenRounds, state.current, showing, update, deck]);
  useEffect(() => {
    if (state.done) void finish();
  }, [state.done, finish]);

  if (state.done && !showing) {
    const practice = state.all.filter((k) => state.first[k] === false).map(parseKey);
    const firstTry = state.all.filter((k) => state.first[k] === true).length;
    return <Summary session={session} title={t('session.finished')} lead={`${t('session.firstTry')}: ${firstTry} / ${state.all.length}`} practice={practice} />;
  }

  if (state.betweenRounds && !showing) {
    const correct = state.roundLog.filter((e) => e.correct).length;
    return (
      <div className="round-break">
        <h1>{t('session.roundDone', { n: state.round })}</h1>
        <p className="text-2 num">{t('session.roundSummary', { c: correct, t: state.roundLog.length })}</p>
        <div className="panel summary-list">
          <h2 className="small-heading">{t('session.roundWrong')}</h2>
          <ul>
            {state.wrong.slice(0, 20).map((k) => {
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
        <button className="btn btn-primary btn-lg" autoFocus onClick={() => update((s) => nextRound(s))}>
          {t('session.nextRound')}
        </button>
      </div>
    );
  }

  if (!showing) return null;
  return (
    <TaskView
      key={showing.n}
      task={showing.task}
      onResult={(correct) => update((s) => roundsAnswer(s, correct), roundsProgress)}
      onOverride={() => update((s) => roundsOverride(s, showing.task.key), roundsProgress)}
      onNext={() => setShowing(null)}
    />
  );
}
