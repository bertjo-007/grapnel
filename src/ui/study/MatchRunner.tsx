import { Timer } from '@phosphor-icons/react';
import { useEffect, useRef, useState } from 'react';
import { answerOf, parseKey, promptOf } from '../../core/session/deck';
import { createMatch, matchAttempt, matchRemaining, nextMatchRound, type MatchState } from '../../core/session/match';
import type { Session } from '../../core/types';
import { randomSeed } from '../../core/util/rng';
import { useIsDesktop, useNow } from '../hooks';
import { useI18n } from '../i18n';
import { useTap } from '../tap';
import { useStudy } from './common';
import { useFrame, useSessionState } from './SessionPage';
import { Summary } from './Summary';

function fmt(ms: number, locale: string): string {
  const s = Math.max(0, ms / 1000);
  if (s < 60) return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(s)} s`;
  return `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
}

function Tile({ label, state, onTap, lang }: { label: string; state: string; onTap: () => void; lang?: string }) {
  const tap = useTap(onTap);
  return (
    <button className={`tile ${state}`} disabled={state === 'gone'} aria-pressed={state === 'selected'} lang={lang} {...tap}>
      <span className="break">{label}</span>
    </button>
  );
}

export function MatchRunner({ session }: { session: Session }) {
  const { t, locale } = useI18n();
  const { deck, record } = useStudy();
  const frame = useFrame();
  const isDesktop = useIsDesktop();
  const { state, update, finish } = useSessionState<MatchState>(session);
  const [first, setFirst] = useState<string | null>(null);
  const [bad, setBad] = useState<string[]>([]);
  const badTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const roundKeys = state.rounds[state.round] ?? [];
  const roundComplete = roundKeys.length > 0 && roundKeys.every((k) => state.matched.includes(k));
  const now = useNow(100, state.timer && !state.done && !roundComplete);
  const totalPairs = state.rounds.reduce((n, r) => n + r.length, 0);

  useEffect(() => frame.setProgress(state.matched.length, totalPairs), [state.matched.length, totalPairs, frame]);
  useEffect(() => {
    if (state.done) void finish();
  }, [state.done, finish]);
  useEffect(() => () => void (badTimer.current && clearTimeout(badTimer.current)), []);
  useEffect(() => {
    frame.setOptions(
      state.timer && !state.done ? (
        <span className="timer num">
          <Timer size={18} />
          {fmt((roundComplete ? state.elapsed[state.round] : now - state.roundStart) ?? 0, locale)}
        </span>
      ) : null,
    );
    return () => frame.setOptions(null);
  }, [frame, state.timer, state.done, roundComplete, now, state.roundStart, state.elapsed, state.round]);

  const tap = (tileId: string) => {
    const tile = state.tiles.find((x) => x.id === tileId);
    if (!tile || state.matched.includes(tile.key)) return;
    if (!first) return setFirst(tileId);
    if (first === tileId) return setFirst(null);
    const a = state.tiles.find((x) => x.id === first)!;
    if (a.side === tile.side) return setFirst(tileId);
    let attempt: ReturnType<typeof matchAttempt> = null;
    update((s) => void (attempt = matchAttempt(s, first, tileId)), (s) => ({ done: s.matched.length, total: totalPairs }));
    setFirst(null);
    const res = attempt as ReturnType<typeof matchAttempt>;
    if (!res) return;
    if (res.correct) {
      void record(parseKey(res.key), 'match', 'correct', { rating: null });
    } else {
      // Fehler zählt für den zuerst gewählten Eintrag, in die Planung nur beim ersten Mal.
      void record(parseKey(res.key), 'match', 'wrong', { rating: res.firstMiss ? 1 : null });
      setBad([first, tileId]);
      if (badTimer.current) clearTimeout(badTimer.current);
      badTimer.current = setTimeout(() => setBad([]), 450);
    }
  };

  if (state.done) {
    const total = state.elapsed.reduce((a, b) => a + (b ?? 0), 0);
    return (
      <Summary
        session={session}
        title={t('match.done.title')}
        lead={`${t('match.rounds', { n: state.rounds.length })}, ${t('count.mistakes', { n: state.mistakes })}${state.timer ? `, ${fmt(total, locale)}` : ''}`}
        practice={state.missed.map(parseKey)}
        onAgain={() => {
          const refs = state.rounds.flat().map(parseKey);
          update((s) => Object.assign(s, createMatch(deck, refs, isDesktop ? 6 : 5, s.timer, randomSeed())), { done: 0, total: totalPairs });
        }}
        againLabel={t('session.again')}
      />
    );
  }

  if (roundComplete) {
    return (
      <div className="round-break">
        <h1>{t('match.roundDone')}</h1>
        <p className="text-2 num">
          {t('match.roundOf', { n: state.round + 1, total: state.rounds.length })}, {t('count.mistakes', { n: state.roundMistakes[state.round] })}
          {state.timer ? `, ${fmt(state.elapsed[state.round] ?? 0, locale)}` : ''}
        </p>
        <button className="btn btn-primary btn-lg" autoFocus onClick={() => update((s) => nextMatchRound(s))}>
          {state.round + 1 < state.rounds.length ? t('match.next') : t('session.results')}
        </button>
      </div>
    );
  }

  return (
    <div className="match">
      <div className="match-head small text-2 num">
        <span>{t('match.roundOf', { n: state.round + 1, total: state.rounds.length })}</span>
        <span>{t('match.remaining', { n: matchRemaining(state) })}</span>
        <span>{t('count.mistakes', { n: state.mistakes })}</span>
      </div>
      <p className="small muted">{t('match.hint')}</p>
      <div className="tiles">
        {state.tiles.map((tile) => {
          const ref = parseKey(tile.key);
          const card = deck.card(ref.c);
          const label = card ? (tile.side === 'prompt' ? promptOf(card, ref.d) : answerOf(card, ref.d)) : '?';
          const st = state.matched.includes(tile.key) ? 'gone' : bad.includes(tile.id) ? 'bad' : first === tile.id ? 'selected' : tile.side;
          const lang = tile.side === 'prompt' ? deck.promptLang(ref) : deck.answerLang(ref);
          return <Tile key={tile.id} label={label} state={st} onTap={() => tap(tile.id)} lang={lang === 'other' ? undefined : lang} />;
        })}
      </div>
    </div>
  );
}
