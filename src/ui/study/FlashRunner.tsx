import { ArrowLeft, ArrowRight, ArrowsDownUp, Shuffle } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { answerOf, parseKey, promptOf } from '../../core/session/deck';
import { flashNext, flashPrev, flashRate, flashRestart, flashUnknown, toggleReverse, toggleShuffle, type FlashState } from '../../core/session/flash';
import { previewIntervals } from '../../core/srs/scheduler';
import type { Grade, Session } from '../../core/types';
import { AudioButton, CardImage, SpeakButton } from '../cardview';
import { Kbd, Menu } from '../components';
import { useHotkeys } from '../hooks';
import { useI18n } from '../i18n';
import { motionReduced, useSettings } from '../state';
import { useStudy } from './common';
import { useFrame, useSessionState } from './SessionPage';
import { Summary } from './Summary';

type State = FlashState & { rating?: 'binary' | 'four' };

const GRADE_KEYS = { 1: 'flash.again', 2: 'flash.hard', 3: 'flash.good', 4: 'flash.easy' } as const;

export function FlashRunner({ session }: { session: Session }) {
  const { t, interval } = useI18n();
  const { settings } = useSettings();
  const { deck, record } = useStudy();
  const frame = useFrame();
  const { state, update, finish } = useSessionState<State>(session);
  const [flipped, setFlipped] = useState(false);
  const [drag, setDrag] = useState(0);
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const shownAt = useRef(Date.now());
  const rating = state.rating ?? settings.flashcardRating;
  const key = state.order[state.index];
  const ref = key ? parseKey(key) : null;
  const card = ref ? deck.card(ref.c) : undefined;
  const reduced = motionReduced(settings);

  const progress = { done: Math.min(state.index + (state.done ? 1 : 0), state.order.length), total: state.order.length };
  useEffect(() => frame.setProgress(progress.done, progress.total), [progress.done, progress.total, frame]);
  useEffect(() => {
    setFlipped(false);
    shownAt.current = Date.now();
  }, [key, state.round]);
  useEffect(() => {
    if (state.done) void finish();
  }, [state.done, finish]);
  useEffect(() => {
    frame.setFinisher(() => update((s) => void (s.done = true)));
    return () => frame.setFinisher(null);
  }, [frame, update]);

  useEffect(() => {
    frame.setOptions(
      <Menu
        trigger={(p) => (
          <button className="btn btn-ghost btn-sm" {...p}>
            {t('common.options')}
          </button>
        )}
      >
        {(close) => (
          <>
            <button
              onClick={() => {
                close();
                update((s) => toggleShuffle(s));
              }}
            >
              <Shuffle size={18} />
              {t('flash.shuffle')}
              {state.shuffled ? ' ✓' : ''}
            </button>
            <button
              onClick={() => {
                close();
                update((s) => toggleReverse(s));
              }}
            >
              <ArrowsDownUp size={18} />
              {t('flash.reverse')}
              {state.reversed ? ' ✓' : ''}
            </button>
            <hr />
            <button
              onClick={() => {
                close();
                update((s) => void (s.rating = rating === 'binary' ? 'four' : 'binary'));
              }}
            >
              {rating === 'binary' ? t('flash.rating.four') : t('flash.rating.binary')}
            </button>
          </>
        )}
      </Menu>,
    );
    return () => frame.setOptions(null);
  }, [frame, update, t, state.shuffled, state.reversed, rating]);

  const rate = async (grade: Grade) => {
    if (!ref) return;
    const elapsed = Date.now() - shownAt.current;
    update((s) => flashRate(s, grade), { done: Math.min(state.index + 1, state.order.length), total: state.order.length });
    await record(ref, 'flashcard', grade === 1 ? 'wrong' : 'correct', { selfGrade: grade, elapsedMs: elapsed });
  };
  const flip = () => setFlipped((f) => !f);
  const suppressClick = useRef(0);

  useHotkeys(
    {
      ' ': flip,
      ArrowUp: flip,
      ArrowDown: flip,
      ArrowLeft: () => update((s) => flashPrev(s)),
      ArrowRight: () => update((s) => flashNext(s)),
      s: () => update((s) => toggleShuffle(s)),
      '1': () => flipped && void rate(1),
      '2': () => flipped && void rate(rating === 'binary' ? 3 : 2),
      '3': () => flipped && rating === 'four' && void rate(3),
      '4': () => flipped && rating === 'four' && void rate(4),
    },
    !state.done,
  );

  if (state.done || !ref || !card) {
    const unknown = flashUnknown(state);
    const known = state.order.filter((k) => state.ratings[k] && state.ratings[k] !== 1);
    return (
      <Summary
        session={session}
        title={t('session.finished')}
        lead={`${t('flash.known.count', { n: known.length })}, ${t('flash.unknown.count', { n: unknown.length })}`}
        practice={unknown.map(parseKey)}
        onAgain={
          unknown.length
            ? () =>
                update((s) => {
                  flashRestart(s, unknown);
                })
            : undefined
        }
        againLabel={t('session.againWrong', { n: unknown.length })}
      />
    );
  }

  const front = promptOf(card, ref.d);
  const back = answerOf(card, ref.d);
  const intervals = rating === 'four' ? previewIntervals(deck.state(ref)?.fsrs ?? null, Date.now(), settings.srs) : null;

  // Touch: Tippen dreht um, Wischen blättert oder bewertet. Danach kommt oft noch ein
  // click-Ereignis; das wird kurz unterdrückt, damit die Karte nicht doppelt reagiert.
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    dragStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const dx = e.clientX - dragStart.current.x;
    if (Math.abs(dx) > Math.abs(e.clientY - dragStart.current.y)) setDrag(dx);
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' || !dragStart.current) return;
    const dx = drag;
    dragStart.current = null;
    setDrag(0);
    suppressClick.current = Date.now() + 600;
    if (Math.abs(dx) < 12) {
      flip();
      return;
    }
    if (Math.abs(dx) < 90) return;
    // Umgedreht: rechts = gewusst, links = nicht gewusst. Sonst nur blättern.
    if (flipped) void rate(dx > 0 ? 3 : 1);
    else update((st) => (dx < 0 ? flashNext(st) : flashPrev(st)));
  };
  const onPointerCancel = () => {
    dragStart.current = null;
    setDrag(0);
  };

  return (
    <div className="flash">
      <div
        className={`flashcard ${flipped ? 'flipped' : ''} ${reduced ? 'fade' : ''}`}
        style={drag ? { transform: `translateX(${drag}px) rotate(${drag / 40}deg)` } : undefined}
        role="button"
        tabIndex={0}
        aria-label={t('flash.flip')}
        aria-pressed={flipped}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onClick={() => {
          if (Date.now() < suppressClick.current) return;
          flip();
        }}
      >
        <div className="flashcard-inner">
          <div className="flashcard-face front">
            <CardImage imageId={card.imageId} className="flash-image" />
            <p className={`flash-text break ${front.length > 80 ? 'long' : front.length > 30 ? 'medium' : ''}`}>{front}</p>
            <span className="flash-hint">{t('flash.tapToFlip')}</span>
          </div>
          <div className="flashcard-face back">
            <p className={`flash-text break ${back.length > 80 ? 'long' : back.length > 30 ? 'medium' : ''}`}>{back}</p>
            {card.example && <p className="flash-example break">{card.example}</p>}
            {card.explanation && <p className="flash-example break pre">{card.explanation}</p>}
          </div>
        </div>
      </div>

      <div className="flash-tools">
        <button className="btn btn-ghost btn-icon" onClick={() => update((s) => flashPrev(s))} disabled={state.index === 0} aria-label={t('flash.prev')}>
          <ArrowLeft size={20} />
        </button>
        <span className="row" style={{ gap: 2 }}>
          <SpeakButton text={flipped ? back : front} lang={flipped ? deck.answerLang(ref) : deck.promptLang(ref)} size="md" />
          {ref.d === 'f2b' && !flipped && <AudioButton audioId={card.audioId} />}
        </span>
        <button className="btn btn-ghost btn-icon" onClick={() => update((s) => flashNext(s))} aria-label={t('flash.next')}>
          <ArrowRight size={20} />
        </button>
      </div>

      <div className={`rate-bar ${flipped ? 'show' : ''}`} aria-hidden={!flipped}>
        {rating === 'binary' ? (
          <>
            <button className="btn btn-lg rate-btn unknown" disabled={!flipped} onClick={() => void rate(1)}>
              {t('flash.unknown')}
              {settings.showShortcutHints && <Kbd>1</Kbd>}
            </button>
            <button className="btn btn-lg rate-btn known" disabled={!flipped} onClick={() => void rate(3)}>
              {t('flash.known')}
              {settings.showShortcutHints && <Kbd>2</Kbd>}
            </button>
          </>
        ) : (
          ([1, 2, 3, 4] as Grade[]).map((g) => (
            <button key={g} className={`btn rate-btn g${g}`} disabled={!flipped} onClick={() => void rate(g)}>
              <span>{t(GRADE_KEYS[g])}</span>
              <span className="small muted num">{intervals ? interval(intervals[g]) : ''}</span>
            </button>
          ))
        )}
      </div>
      {!flipped && (
        <button className="btn btn-primary btn-lg flip-btn" onClick={flip}>
          {t('flash.flip')}
          {settings.showShortcutHints && <Kbd>{t('kbd.space')}</Kbd>}
        </button>
      )}
    </div>
  );
}
