import { ArrowLeft, ArrowRight, Check, Timer, X } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { answerOf, parseKey, promptOf } from '../../core/session/deck';
import { gradeFor } from '../../core/session/grading';
import { gradeQuestion, submitTest, testAnsweredCount, testEntries, testScore, type TestQuestion, type TestState } from '../../core/session/test';
import type { Session, TaskType } from '../../core/types';
import { ConfirmDialog } from '../components';
import { useHotkeys, useNow } from '../hooks';
import { useI18n, type Key } from '../i18n';
import { useToast } from '../state';
import { Feedback, PromptCard, ResultLine, useStudy } from './common';
import { useFrame, useSessionState } from './SessionPage';
import { Summary } from './Summary';

const TASK: Record<TestQuestion['type'], TaskType> = { write: 'write', mc: 'mc', truefalse: 'truefalse', match: 'match' };

function fmtTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const testProgress = (s: TestState) => {
  const c = testAnsweredCount(s);
  return { done: c.answered, total: c.total };
};

function isAnswered(q: TestQuestion): boolean {
  if (q.type === 'match') return q.keys.every((k) => q.given[k]);
  if (q.type === 'write') return !!q.given?.trim();
  return q.given !== null;
}

function isGraded(q: TestQuestion): boolean {
  return q.type === 'match' ? q.results !== null : q.result !== null;
}

export function TestRunner({ session }: { session: Session }) {
  const { t, percent } = useI18n();
  const toast = useToast();
  const { deck, check, record } = useStudy();
  const frame = useFrame();
  const { state, update, finish } = useSessionState<TestState>(session);
  const [confirm, setConfirm] = useState(false);
  const now = useNow(1000, !!state.endsAt && !state.submitted);
  const recording = useRef(false);
  const q = state.questions[state.index];
  const immediate = state.config.showAnswers === 'immediate';
  const counts = testAnsweredCount(state);

  useEffect(() => frame.setProgress(counts.answered, counts.total), [counts.answered, counts.total, frame]);
  const judge = (key: string, given: string) => {
    const r = check(parseKey(key), given);
    return { result: r.result, closest: r.closest, reason: r.reason };
  };

  const submit = async () => {
    if (state.submitted || recording.current) return;
    recording.current = true;
    const next = update((s) => submitTest(s, judge), testProgress);
    // Antworten verbuchen (einmal). Unbeantwortetes fliesst nicht in Planung und Statistik ein.
    if (!next.recorded) {
      for (const q of next.questions) {
        const entries = q.type === 'match' ? q.keys.map((k) => ({ key: k, result: q.results?.[k] ?? 'skipped', given: q.given[k] ?? null })) : [{ key: q.key, result: q.result ?? 'skipped', given: q.type === 'truefalse' ? (q.given === null ? null : String(q.given)) : q.given }];
        for (const e of entries) {
          if (e.result === 'skipped') continue;
          await record(parseKey(e.key), TASK[q.type], e.result, { given: e.given, rating: gradeFor(TASK[q.type], e.result) });
        }
      }
      update((s) => void (s.recorded = true));
    }
    await finish();
  };

  useEffect(() => {
    frame.setFinisher(() => setConfirm(true));
    return () => frame.setFinisher(null);
  }, [frame]);

  // Zeitlimit: bei Ablauf automatisch abgeben.
  useEffect(() => {
    if (state.endsAt && !state.submitted && now >= state.endsAt) {
      toast(t('test.timeUp'));
      void submit();
    }
  });

  useEffect(() => {
    frame.setOptions(
      state.endsAt && !state.submitted ? (
        <span className={`timer num ${state.endsAt - now < 60_000 ? 'low' : ''}`}>
          <Timer size={18} />
          {fmtTime(state.endsAt - now)}
        </span>
      ) : null,
    );
    return () => frame.setOptions(null);
  }, [frame, state.endsAt, state.submitted, now]);

  const go = (i: number) => update((s) => void (s.index = Math.max(0, Math.min(s.questions.length - 1, i))));
  useHotkeys({ ArrowLeft: () => go(state.index - 1), ArrowRight: () => go(state.index + 1) }, !state.submitted);

  if (state.submitted) {
    const score = testScore(state);
    const misses = testEntries(state).filter((e) => e.result === 'wrong' || e.result === 'skipped');
    return (
      <Summary session={session} title={t('test.result.title')} practice={misses.map((e) => parseKey(e.key))}>
        <div className="score">
          <span className="score-value num">{percent(score.percent / 100)}</span>
          <div className="score-grid num">
            <span>
              <strong>{score.total}</strong> {t('test.result.total')}
            </span>
            <span className="ok">
              <strong>{score.correct}</strong> {t('test.result.correct')}
            </span>
            <span className="bad">
              <strong>{score.wrong}</strong> {t('test.result.wrong')}
            </span>
            <span>
              <strong>{score.unanswered}</strong> {t('test.result.unanswered')}
            </span>
          </div>
        </div>
        {misses.length > 0 && (
          <section className="panel mistakes">
            <h2 className="small-heading">{t('test.result.mistakes')}</h2>
            <ul>
              {misses.map((e, i) => {
                const ref = parseKey(e.key);
                const c = deck.card(ref.c);
                if (!c) return null;
                const given = e.type === 'mc' || e.type === 'match' ? (e.given ? answerOf(deck.card(e.given) ?? c, ref.d) : null) : e.type === 'truefalse' ? (e.given === 'true' ? t('task.tf.true') : e.given === 'false' ? t('task.tf.false') : null) : e.given;
                return (
                  <li key={`${e.key}-${i}`}>
                    <span className="break mistake-prompt">{promptOf(c, ref.d)}</span>
                    <span className="break mistake-given">{given ? <s>{given}</s> : <em className="muted">{t('test.result.unanswered')}</em>}</span>
                    <span className="break mistake-answer">{answerOf(c, ref.d)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </Summary>
    );
  }

  if (!q) return null;
  const graded = isGraded(q);
  const locked = immediate && graded;

  return (
    <div className="test">
      <div className="test-nav" role="navigation" aria-label={t('test.overview')}>
        {state.questions.map((x, i) => {
          const g = isGraded(x);
          const ok = g && (x.type === 'match' ? Object.values(x.results ?? {}).every((r) => r === 'correct' || r === 'almost') : x.result === 'correct' || x.result === 'almost');
          return (
            <button key={x.id} className={`qdot ${i === state.index ? 'current' : ''} ${isAnswered(x) ? 'answered' : ''} ${immediate && g ? (ok ? 'ok' : 'bad') : ''}`} onClick={() => go(i)} aria-label={t('test.progress', { n: i + 1, total: state.questions.length })}>
              {i + 1}
            </button>
          );
        })}
      </div>

      <p className="small muted num">{t('test.progress', { n: state.index + 1, total: state.questions.length })}</p>

      <Question
        key={q.id}
        q={q}
        locked={locked}
        immediate={immediate}
        onChange={(mut) => update((s) => mut(s.questions[s.index]), testProgress)}
        onGrade={() => update((s) => gradeQuestion(s.questions[s.index], judge))}
        onNext={() => go(state.index + 1)}
      />

      <div className="test-footer">
        <button className="btn" onClick={() => go(state.index - 1)} disabled={state.index === 0}>
          <ArrowLeft size={18} />
          {t('test.prev')}
        </button>
        <span className="small muted num">{t('test.answered', { n: counts.answered, total: counts.total })}</span>
        {state.index < state.questions.length - 1 ? (
          <button className="btn" onClick={() => go(state.index + 1)}>
            {t('test.next')}
            <ArrowRight size={18} />
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => (counts.answered < counts.total ? setConfirm(true) : void submit())}>
            {t('test.submit')}
          </button>
        )}
      </div>
      {state.index < state.questions.length - 1 && (
        <button className="btn btn-ghost test-submit-early" onClick={() => setConfirm(true)}>
          {t('test.submit')}
        </button>
      )}

      <ConfirmDialog
        open={confirm}
        title={t('test.submit.title')}
        text={counts.answered < counts.total ? t('test.submit.text', { n: counts.total - counts.answered }) : t('test.submit.ready')}
        confirmLabel={t('test.submit')}
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setConfirm(false);
          await submit();
        }}
      />
    </div>
  );
}

function Question({ q, locked, immediate, onChange, onGrade, onNext }: { q: TestQuestion; locked: boolean; immediate: boolean; onChange: (mut: (q: TestQuestion) => void) => void; onGrade: () => void; onNext: () => void }) {
  const { t } = useI18n();
  const { deck } = useStudy();

  if (q.type === 'match') return <MatchQuestion q={q} locked={locked} immediate={immediate} onChange={onChange} onGrade={onGrade} />;

  const ref = parseKey(q.key);
  if (q.type === 'write') {
    return (
      <div className="task">
        <PromptCard itemRef={ref} label={t('task.ask', { lang: t(`lang.${deck.answerLang(ref)}` as Key) })} />
        <form
          className="write-box"
          onSubmit={(e) => {
            e.preventDefault();
            if (immediate && !locked && q.given?.trim()) onGrade();
            else onNext();
          }}
        >
          <input
            className="input answer-input"
            value={q.given ?? ''}
            onChange={(e) => onChange((x) => void ((x as typeof q).given = e.target.value))}
            placeholder={t('task.write.placeholder')}
            aria-label={t('task.write.placeholder')}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            disabled={locked}
            autoFocus
            enterKeyHint={immediate ? 'done' : 'next'}
          />
          {immediate && !locked && (
            <div className="write-actions">
              <div className="spacer" />
              <button type="submit" className="btn btn-primary" disabled={!q.given?.trim()}>
                {t('task.write.check')}
              </button>
            </div>
          )}
        </form>
        {locked && q.result && (
          <Feedback
            itemRef={ref}
            data={{ result: q.result, reason: q.reason ?? null, given: q.given, closest: q.closest ?? null, logId: null }}
            onNext={onNext}
            showOverride={false}
          />
        )}
      </div>
    );
  }

  if (q.type === 'mc') {
    return (
      <div className="task">
        <PromptCard itemRef={ref} label={t('task.mc.prompt')} />
        <TestOptions
          labels={q.options.map((id) => answerOf(deck.card(id)!, ref.d))}
          values={q.options}
          selected={q.given}
          correct={locked ? ref.c : null}
          disabled={locked}
          onSelect={(v) => {
            onChange((x) => void ((x as typeof q).given = v));
            if (immediate) onGrade();
          }}
        />
        {locked && q.result && <ResultLine result={q.result} />}
      </div>
    );
  }

  const shown = deck.card(q.shownCardId);
  return (
    <div className="task">
      <PromptCard itemRef={ref} label={t('task.tf.prompt')} />
      <p className="tf-statement break">
        <strong>{shown ? answerOf(shown, ref.d) : '?'}</strong>
      </p>
      <TestOptions
        labels={[t('task.tf.true'), t('task.tf.false')]}
        values={['true', 'false']}
        selected={q.given === null ? null : String(q.given)}
        correct={locked ? String(q.truth) : null}
        disabled={locked}
        onSelect={(v) => {
          onChange((x) => void ((x as typeof q).given = v === 'true'));
          if (immediate) onGrade();
        }}
      />
      {locked && q.result && <ResultLine result={q.result} />}
    </div>
  );
}

function TestOptions({ labels, values, selected, correct, disabled, onSelect }: { labels: string[]; values: string[]; selected: string | null; correct: string | null; disabled: boolean; onSelect: (v: string) => void }) {
  useHotkeys(Object.fromEntries(values.map((v, i) => [String(i + 1), () => !disabled && onSelect(v)])), !disabled);
  return (
    <div className={`options ${values.length > 2 ? 'grid' : ''}`}>
      {values.map((v, i) => {
        let cls = selected === v ? 'chosen' : '';
        if (correct !== null) cls = v === correct ? 'right' : selected === v ? 'wrong' : 'dim';
        return (
          <button key={v} className={`option ${cls}`} disabled={disabled} onClick={() => onSelect(v)} aria-pressed={selected === v}>
            <span className="option-key">{i + 1}</span>
            <span className="option-text break">{labels[i]}</span>
            {correct !== null && v === correct && <Check size={20} weight="bold" />}
            {correct !== null && selected === v && v !== correct && <X size={20} weight="bold" />}
          </button>
        );
      })}
    </div>
  );
}

function MatchQuestion({ q, locked, immediate, onChange, onGrade }: { q: Extract<TestQuestion, { type: 'match' }>; locked: boolean; immediate: boolean; onChange: (mut: (q: TestQuestion) => void) => void; onGrade: () => void }) {
  const { t } = useI18n();
  const { deck } = useStudy();
  const [active, setActive] = useState<string | null>(null);
  const letter = (cardId: string) => String.fromCharCode(65 + q.answerOrder.indexOf(cardId));
  const assignedTo = (cardId: string) => Object.entries(q.given).find(([, v]) => v === cardId)?.[0] ?? null;
  return (
    <div className="task test-match">
      <p className="small text-2">{t('test.match.hint')}</p>
      <div className="match-cols">
        <div className="match-col">
          {q.keys.map((k) => {
            const ref = parseKey(k);
            const c = deck.card(ref.c);
            const given = q.given[k];
            const res = q.results?.[k];
            return (
              <button key={k} className={`match-item ${active === k ? 'active' : ''} ${res ? (res === 'correct' ? 'right' : 'wrong') : ''}`} disabled={locked} onClick={() => setActive(active === k ? null : k)}>
                <span className="break">{c ? promptOf(c, ref.d) : '?'}</span>
                <span className={`match-letter ${given ? '' : 'empty'}`}>{given ? letter(given) : ''}</span>
              </button>
            );
          })}
        </div>
        <div className="match-col">
          {q.answerOrder.map((cardId) => {
            const c = deck.card(cardId);
            const ref = parseKey(q.keys[0]);
            const owner = assignedTo(cardId);
            return (
              <button
                key={cardId}
                className={`match-item answer ${owner ? 'used' : ''}`}
                disabled={locked || !active}
                onClick={() => {
                  if (!active) return;
                  onChange((x) => {
                    const m = x as typeof q;
                    for (const [k, v] of Object.entries(m.given)) if (v === cardId) m.given[k] = null;
                    m.given[active] = cardId;
                  });
                  setActive(null);
                }}
              >
                <span className="match-letter">{letter(cardId)}</span>
                <span className="break">{c ? answerOf(c, ref.d) : '?'}</span>
              </button>
            );
          })}
        </div>
      </div>
      {locked &&
        q.keys
          .filter((k) => q.results?.[k] !== 'correct')
          .map((k) => {
            const ref = parseKey(k);
            const c = deck.card(ref.c);
            return c ? (
              <p key={k} className="small">
                <strong>{promptOf(c, ref.d)}</strong>: {answerOf(c, ref.d)}
              </p>
            ) : null;
          })}
      {immediate && !locked && (
        <div className="row">
          <div className="spacer" />
          <button className="btn btn-primary" onClick={onGrade} disabled={!q.keys.every((k) => q.given[k])}>
            {t('task.write.check')}
          </button>
        </div>
      )}
    </div>
  );
}
