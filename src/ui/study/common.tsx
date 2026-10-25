import { Check, Info, X } from '@phosphor-icons/react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnswerIndex, checkAnswer, type CheckResult } from '../../core/answer/check';
import { charDiff } from '../../core/answer/diff';
import { overrideAnswer, recordAnswer } from '../../core/db/repo';
import type { Settings } from '../../core/settings';
import { answerOf, extraOf, promptOf, type Deck, type ItemRef } from '../../core/session/deck';
import { gradeFor } from '../../core/session/grading';
import type { AnswerResult, Direction, Grade, Session, TaskType } from '../../core/types';
import { AudioButton, CardImage, SpeakButton } from '../cardview';
import { Kbd } from '../components';
import { useHotkeys } from '../hooks';
import { useI18n, type Key } from '../i18n';
import { useSettings } from '../state';
import { useTap } from '../tap';

// ---------- Sitzungskontext ----------

interface StudyCtx {
  session: Session;
  deck: Deck;
  settings: Settings;
  /** Verbucht eine Antwort; liefert die Log-ID (für «Ich hatte recht»). */
  record: (ref: ItemRef, task: TaskType, result: AnswerResult, opts?: { given?: string | null; selfGrade?: Grade; elapsedMs?: number; rating?: Grade | null }) => Promise<string>;
  override: (logId: string, ref: ItemRef) => Promise<void>;
  check: (ref: ItemRef, given: string) => CheckResult;
}

const Ctx = createContext<StudyCtx | null>(null);

export function useStudy(): StudyCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error('StudyProvider fehlt');
  return v;
}

export function StudyProvider({ session, deck, children }: { session: Session; deck: Deck; children: ReactNode }) {
  const { settings } = useSettings();
  const indexes = useRef(new Map<Direction, AnswerIndex>());

  const indexFor = useCallback(
    (d: Direction) => {
      let idx = indexes.current.get(d);
      if (!idx) {
        // Sprache pro Set kann variieren; für die Artikel-Abtrennung reicht die Sprache des ersten Sets.
        const set = deck.sets.values().next().value;
        const lang = set ? (d === 'f2b' ? set.backLang : set.frontLang) : 'other';
        idx = new AnswerIndex(
          Array.from(deck.cards.values()).map((c) => ({ id: c.id, text: answerOf(c, d), extra: extraOf(c, d) })),
          settings.answer,
          lang,
        );
        indexes.current.set(d, idx);
      }
      return idx;
    },
    [deck, settings.answer],
  );

  useEffect(() => {
    indexes.current.clear();
  }, [settings.answer]);

  const value = useMemo<StudyCtx>(
    () => ({
      session,
      deck,
      settings,
      record: async (ref, task, result, opts = {}) => {
        const card = deck.card(ref.c);
        if (!card) return '';
        const rating = opts.rating !== undefined ? opts.rating : gradeFor(task, result, opts.selfGrade);
        const { log, state } = await recordAnswer(
          { card, direction: ref.d, sessionId: session.id, mode: session.mode, task, result, rating, given: opts.given ?? null, elapsedMs: opts.elapsedMs },
          settings,
        );
        deck.setState(state);
        return log.id;
      },
      override: async (logId, ref) => {
        const st = await overrideAnswer(logId, settings);
        if (st) deck.setState(st);
        void ref;
      },
      check: (ref, given) => {
        const card = deck.card(ref.c)!;
        const siblings = deck.siblings(ref);
        const exclude = new Set([ref.c, ...siblings.map((s) => s.id)]);
        const idx = indexFor(ref.d);
        return checkAnswer({
          given,
          answer: answerOf(card, ref.d),
          extra: extraOf(card, ref.d),
          lang: deck.answerLang(ref),
          siblings: siblings.map((s) => ({ answer: answerOf(s, ref.d), extra: extraOf(s, ref.d) })),
          isOtherAnswer: (plain) => idx.belongsToOther(plain, exclude),
          settings: settings.answer,
          nativeLang: settings.nativeLang,
        });
      },
    }),
    [session, deck, settings, indexFor],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------- Frage ----------

export function PromptCard({ itemRef, label, children }: { itemRef: ItemRef; label?: ReactNode; children?: ReactNode }) {
  const { deck } = useStudy();
  const { langName, t } = useI18n();
  const card = deck.card(itemRef.c);
  if (!card) return null;
  const text = promptOf(card, itemRef.d);
  const lang = deck.promptLang(itemRef);
  return (
    <div className="prompt-card">
      <div className="prompt-top">
        <span className="prompt-lang">{label ?? langName(lang)}</span>
        <span className="row" style={{ gap: 2 }}>
          <SpeakButton text={text} lang={lang} />
          {itemRef.d === 'f2b' && <AudioButton audioId={card.audioId} />}
        </span>
      </div>
      <CardImage imageId={card.imageId} className="prompt-image" />
      <p className={`prompt-text break ${text.length > 80 ? 'long' : text.length > 30 ? 'medium' : ''}`} lang={lang === 'other' ? undefined : lang}>
        {text || t('common.untitled')}
      </p>
      {children}
    </div>
  );
}

// ---------- Rückmeldung ----------

export function ResultLine({ result }: { result: AnswerResult }) {
  const { t } = useI18n();
  const ok = result === 'correct' || result === 'almost';
  return (
    <div className={`result-line ${ok ? (result === 'almost' ? 'almost' : 'correct') : 'wrong'}`}>
      {ok ? <Check size={20} weight="bold" /> : <X size={20} weight="bold" />}
      <span>{t(`feedback.${result}` as Key)}</span>
    </div>
  );
}

function Diff({ given, expected }: { given: string; expected: string }) {
  const parts = charDiff(given, expected);
  return (
    <span className="diff break">
      {parts.map((p, i) => (
        <span key={i} className={`diff-${p.type}`}>
          {p.text}
        </span>
      ))}
    </span>
  );
}

/** Nur bei knappen Fehlern lohnt die Buchstaben-Markierung; sonst wäre sie Rauschen. */
const NEAR_MISS = new Set(['typo', 'accent', 'case', 'article-wrong', 'article-gender', 'article-missing']);

export interface FeedbackData {
  result: AnswerResult;
  reason: string | null;
  given: string | null;
  closest: string | null;
  logId: string | null;
  overridden?: boolean;
}

/** Zeigt Ergebnis, Lösung, Abweichung und Zusatzinfos; Enter geht weiter. */
export function Feedback({ itemRef, data, onNext, onOverride, showOverride = true }: { itemRef: ItemRef; data: FeedbackData; onNext: () => void; onOverride?: () => void; showOverride?: boolean }) {
  const { deck } = useStudy();
  const { t } = useI18n();
  const { settings } = useSettings();
  const card = deck.card(itemRef.c);
  const nextRef = useRef<HTMLButtonElement>(null);
  const tap = useTap(onNext);
  useEffect(() => {
    nextRef.current?.focus();
  }, []);
  useHotkeys({ Enter: onNext, o: () => data.result === 'wrong' && !data.overridden && onOverride?.() }, true, ['Enter']);
  if (!card) return null;
  const answer = answerOf(card, itemRef.d);
  const siblings = deck.siblings(itemRef);
  const result = data.overridden ? 'correct' : data.result;
  return (
    <div className={`feedback ${result === 'wrong' || result === 'skipped' ? 'is-wrong' : 'is-right'}`} role="status">
      <ResultLine result={result} />
      {data.reason && data.reason !== 'sibling' && <p className="small">{t(`feedback.reason.${data.reason}` as Key)}</p>}
      {data.reason === 'sibling' && <p className="small">{t('feedback.reason.sibling', { answer })}</p>}
      {data.given && (result === 'wrong' || result === 'almost') && (
        <div className="feedback-row">
          <span className="feedback-label">{t('feedback.yourAnswer')}</span>
          {data.closest && (result === 'almost' || NEAR_MISS.has(data.reason ?? '')) ? <Diff given={data.given} expected={data.closest} /> : <s className="break given-wrong">{data.given}</s>}
        </div>
      )}
      <div className="feedback-row">
        <span className="feedback-label">{t('feedback.solution')}</span>
        <span className="feedback-answer break">
          {answer}
          <SpeakButton text={answer} lang={deck.answerLang(itemRef)} />
        </span>
      </div>
      {siblings.length > 0 && data.reason !== 'sibling' && (
        <p className="small text-2">
          <Info size={14} /> {t('feedback.alsoMeans', { list: siblings.map((s) => answerOf(s, itemRef.d)).join('; ') })}
        </p>
      )}
      {card.example && (
        <p className="feedback-example break">
          <span className="feedback-label">{t('flash.example')}</span> {card.example}
        </p>
      )}
      {card.explanation && <p className="small text-2 break pre">{card.explanation}</p>}
      <div className="feedback-actions">
        {showOverride && data.result === 'wrong' && data.given && onOverride && !data.overridden && (
          <button className="btn btn-ghost" onClick={onOverride}>
            {t('feedback.override')}
            {settings.showShortcutHints && <Kbd>O</Kbd>}
          </button>
        )}
        {data.overridden && <span className="small text-2">{t('feedback.overridden')}</span>}
        <div className="spacer" />
        <button ref={nextRef} className="btn btn-primary btn-lg" {...tap}>
          {t('feedback.next')}
          {settings.showShortcutHints && <Kbd>{t('feedback.enter')}</Kbd>}
        </button>
      </div>
    </div>
  );
}

// ---------- Aufgaben ----------

/** Freie Eingabe. onDone erhält das Prüfergebnis, die Anzeige übernimmt der Aufrufer. */
export function WriteBox({ itemRef, onDone, locked }: { itemRef: ItemRef; onDone: (given: string, r: CheckResult) => void; locked?: boolean }) {
  const { check, deck } = useStudy();
  const { t, langName } = useI18n();
  const [value, setValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const lang = deck.answerLang(itemRef);
  useEffect(() => {
    setValue('');
    // Kleiner Aufschub, damit iOS die Tastatur auch nach einem Wechsel öffnet.
    const h = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(h);
  }, [itemRef.c, itemRef.d]);
  const submit = (v: string) => {
    if (locked) return;
    onDone(v, check(itemRef, v));
  };
  return (
    <form
      className="write-box"
      onSubmit={(e) => {
        e.preventDefault();
        submit(value);
      }}
    >
      <label className="sr-only" htmlFor="answer-input">
        {t('task.write.placeholder')}
      </label>
      <input
        id="answer-input"
        ref={inputRef}
        className="input answer-input"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={`${t('task.write.placeholder')} (${langName(lang)})`}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        lang={lang === 'other' ? undefined : lang}
        enterKeyHint="done"
        disabled={locked}
      />
      <div className="write-actions">
        <button type="button" className="btn btn-ghost" onClick={() => submit('')} disabled={locked}>
          {t('task.write.dontKnow')}
        </button>
        <button type="submit" className="btn btn-primary" disabled={locked || !value.trim()}>
          {t('task.write.check')}
        </button>
      </div>
    </form>
  );
}

function OptionButton({ label, index, state, onPick, disabled, showKey }: { label: string; index: number; state: 'idle' | 'right' | 'wrong' | 'dim'; onPick: () => void; disabled: boolean; showKey: boolean }) {
  const tap = useTap(() => !disabled && onPick());
  return (
    <button className={`option ${state}`} disabled={disabled && state === 'idle'} aria-disabled={disabled} {...tap}>
      {showKey && <span className="option-key">{index + 1}</span>}
      <span className="option-text break">{label}</span>
      {state === 'right' && <Check size={20} weight="bold" />}
      {state === 'wrong' && <X size={20} weight="bold" />}
    </button>
  );
}

/** Multiple Choice. Optionen sind Karten-IDs; angezeigt wird deren Antwortseite. */
export function McOptions({ itemRef, options, picked, onPick, reveal }: { itemRef: ItemRef; options: string[]; picked: string | null; onPick: (id: string) => void; reveal: boolean }) {
  const { deck } = useStudy();
  const { settings } = useSettings();
  useHotkeys(Object.fromEntries(options.map((id, i) => [String(i + 1), () => !picked && onPick(id)])), !picked);
  return (
    <div className={`options ${options.length > 2 ? 'grid' : ''}`}>
      {options.map((id, i) => {
        const card = deck.card(id);
        const isRight = id === itemRef.c;
        let state: 'idle' | 'right' | 'wrong' | 'dim' = 'idle';
        if (picked) {
          if (isRight && (reveal || picked === id)) state = 'right';
          else if (picked === id) state = 'wrong';
          else state = 'dim';
        }
        return <OptionButton key={id} index={i} label={card ? answerOf(card, itemRef.d) : '?'} state={state} disabled={!!picked} onPick={() => onPick(id)} showKey={settings.showShortcutHints} />;
      })}
    </div>
  );
}

export function TrueFalse({ itemRef, shownCardId, picked, onPick }: { itemRef: ItemRef; shownCardId: string; picked: boolean | null; onPick: (v: boolean) => void }) {
  const { deck } = useStudy();
  const { t } = useI18n();
  const shown = deck.card(shownCardId);
  const truth = shownCardId === itemRef.c;
  useHotkeys({ w: () => picked === null && onPick(true), t: () => picked === null && onPick(true), f: () => picked === null && onPick(false), '1': () => picked === null && onPick(true), '2': () => picked === null && onPick(false) }, picked === null);
  const state = (v: boolean): 'idle' | 'right' | 'wrong' | 'dim' => (picked === null ? 'idle' : v === truth ? 'right' : picked === v ? 'wrong' : 'dim');
  return (
    <div className="tf">
      <p className="tf-statement break">
        <span className="muted small">{t('task.tf.prompt')}</span>
        <strong>{shown ? answerOf(shown, itemRef.d) : '?'}</strong>
      </p>
      <div className="options">
        <OptionButton label={t('task.tf.true')} index={0} state={state(true)} disabled={picked !== null} onPick={() => onPick(true)} showKey={false} />
        <OptionButton label={t('task.tf.false')} index={1} state={state(false)} disabled={picked !== null} onPick={() => onPick(false)} showKey={false} />
      </div>
    </div>
  );
}

/** Zeitmessung pro Aufgabe, für die Statistik. */
export function useTaskTimer(key: string): () => number {
  const start = useRef(Date.now());
  useEffect(() => {
    start.current = Date.now();
  }, [key]);
  return () => Date.now() - start.current;
}
