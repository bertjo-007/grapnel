import { useEffect, useRef, useState } from 'react';
import { answerOf, parseKey } from '../../core/session/deck';
import type { LearnTask } from '../../core/session/learn';
import type { RoundsTask } from '../../core/session/rounds';
import { Kbd } from '../components';
import { useHotkeys } from '../hooks';
import { useI18n, type Key } from '../i18n';
import { motionReduced, useSettings } from '../state';
import { Feedback, McOptions, PromptCard, ResultLine, TrueFalse, useStudy, useTaskTimer, WriteBox, type FeedbackData } from './common';

export type AnyTask = LearnTask | RoundsTask;

const AUTO_NEXT_MS = 900;

/**
 * Eine Aufgabe von der Frage bis zur Rückmeldung. Das Ergebnis wird sofort verbucht
 * (onResult), weiter geht es erst auf Wunsch (onNext). Richtige Antworten in Multiple
 * Choice und Wahr/Falsch gehen nach kurzer Bestätigung von selbst weiter.
 */
export function TaskView({ task, onResult, onNext, onOverride, stageLabel }: { task: AnyTask; onResult: (correct: boolean) => void; onNext: () => void; onOverride?: () => void; stageLabel?: Key }) {
  const { t } = useI18n();
  const { deck, record, override } = useStudy();
  const { settings } = useSettings();
  const ref = parseKey(task.key);
  const elapsed = useTaskTimer(task.key);
  const [feedback, setFeedback] = useState<FeedbackData | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [tfPicked, setTfPicked] = useState<boolean | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [autoNext, setAutoNext] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const card = deck.card(ref.c);
  const isNew = !deck.state(ref) || deck.state(ref)!.fsrs.state === 0;

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const scheduleNext = () => {
    setAutoNext(true);
    timer.current = setTimeout(onNext, motionReduced(settings) ? 600 : AUTO_NEXT_MS);
  };
  useHotkeys({ Enter: () => autoNext && onNext(), ' ': () => autoNext && onNext() }, autoNext);

  if (!card) return null;

  const label = (
    <span className="row" style={{ gap: 6 }}>
      {isNew && <span className="badge badge-accent">{t('task.new')}</span>}
      {stageLabel && <span className="badge">{t(stageLabel)}</span>}
      <span>{t('task.ask', { lang: t(`lang.${deck.answerLang(ref)}` as Key) })}</span>
    </span>
  );

  const done = (correct: boolean, data: FeedbackData, auto: boolean) => {
    setFeedback(data);
    onResult(correct);
    if (auto) scheduleNext();
  };

  if (task.type === 'write') {
    return (
      <div className="task">
        <PromptCard itemRef={ref} label={label} />
        {!feedback ? (
          <WriteBox
            itemRef={ref}
            onDone={async (given, r) => {
              const correct = r.result === 'correct' || r.result === 'almost';
              const logId = await record(ref, 'write', r.result, { given, elapsedMs: elapsed() });
              done(correct, { result: r.result, reason: r.reason, given: given || null, closest: r.closest, logId }, false);
            }}
          />
        ) : (
          <Feedback
            itemRef={ref}
            data={feedback}
            onNext={onNext}
            onOverride={
              onOverride && feedback.logId
                ? async () => {
                    await override(feedback.logId!, ref);
                    setFeedback({ ...feedback, overridden: true });
                    onOverride();
                  }
                : undefined
            }
          />
        )}
      </div>
    );
  }

  if (task.type === 'mc') {
    return (
      <div className="task">
        <PromptCard itemRef={ref} label={label} />
        <p className="task-instruction small muted">{t('task.mc.prompt')}</p>
        <McOptions
          itemRef={ref}
          options={task.options}
          picked={picked}
          reveal
          onPick={async (id) => {
            setPicked(id);
            const correct = id === ref.c;
            const chosen = deck.card(id);
            await record(ref, 'mc', correct ? 'correct' : 'wrong', { given: chosen ? answerOf(chosen, ref.d) : null, elapsedMs: elapsed() });
            done(correct, { result: correct ? 'correct' : 'wrong', reason: null, given: null, closest: null, logId: null }, correct);
          }}
        />
        {feedback && feedback.result === 'wrong' && <Feedback itemRef={ref} data={feedback} onNext={onNext} showOverride={false} />}
        {autoNext && <AutoNext />}
      </div>
    );
  }

  if (task.type === 'truefalse') {
    return (
      <div className="task">
        <PromptCard itemRef={ref} label={label} />
        <TrueFalse
          itemRef={ref}
          shownCardId={task.shownCardId}
          picked={tfPicked}
          onPick={async (v) => {
            setTfPicked(v);
            const correct = v === task.truth;
            await record(ref, 'truefalse', correct ? 'correct' : 'wrong', { given: String(v), elapsedMs: elapsed() });
            done(correct, { result: correct ? 'correct' : 'wrong', reason: null, given: null, closest: null, logId: null }, correct);
          }}
        />
        {feedback && feedback.result === 'wrong' && <Feedback itemRef={ref} data={feedback} onNext={onNext} showOverride={false} />}
        {autoNext && <AutoNext />}
      </div>
    );
  }

  // Karteikarte im gemischten Modus: selbst umdrehen und bewerten.
  return (
    <div className="task">
      <PromptCard itemRef={ref} label={label}>
        {revealed && <p className="reveal-answer break">{answerOf(card, ref.d)}</p>}
      </PromptCard>
      {!revealed ? (
        <>
          <p className="task-instruction small muted">{t('task.flash.prompt')}</p>
          <button className="btn btn-primary btn-lg btn-block" onClick={() => setRevealed(true)} autoFocus>
            {t('flash.flip')}
          </button>
        </>
      ) : (
        <FlashChoice
          onPick={async (known) => {
            await record(ref, 'flashcard', known ? 'correct' : 'wrong', { selfGrade: known ? 3 : 1, elapsedMs: elapsed() });
            onResult(known);
            onNext();
          }}
          showKeys={settings.showShortcutHints}
        />
      )}
    </div>
  );
}

function FlashChoice({ onPick, showKeys }: { onPick: (known: boolean) => void; showKeys: boolean }) {
  const { t } = useI18n();
  useHotkeys({ '1': () => onPick(false), '2': () => onPick(true) });
  return (
    <div className="rate-bar show">
      <button className="btn btn-lg rate-btn unknown" onClick={() => onPick(false)}>
        {t('flash.unknown')}
        {showKeys && <Kbd>1</Kbd>}
      </button>
      <button className="btn btn-lg rate-btn known" onClick={() => onPick(true)}>
        {t('flash.known')}
        {showKeys && <Kbd>2</Kbd>}
      </button>
    </div>
  );
}

function AutoNext() {
  return (
    <div className="auto-next" aria-live="polite">
      <ResultLine result="correct" />
    </div>
  );
}
