import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { db } from '../../core/db/db';
import { parseKey } from '../../core/session/deck';
import { adjacent, createGems, gemsAnswer, gemsOverride, gemsProgress, gemsSwap, type Board, type Gem, type GemsQuestion, type GemsState, type GemsStep, type SwapResult } from '../../core/session/gems';
import type { Session } from '../../core/types';
import { randomSeed } from '../../core/util/rng';
import { useI18n, type Key } from '../i18n';
import { motionReduced, useSettings } from '../state';
import { useStudy } from './common';
import { useFrame, useSessionState } from './SessionPage';
import { BlastEffect, BombArt, GemArt, GemDefs, StoneArt } from './gemArt';
import { Summary } from './Summary';
import { TaskView } from './TaskView';

const SWIPE_PX = 18;

interface Anim {
  board: Board;
  popping: Set<number>;
  bad?: [number, number];
  /** Bomben, die sich gerade aufladen (Feldindizes). */
  charging?: Set<number>;
  /** Felder im Wirkungsbereich einer Bombe, mit Abstand zur nächsten Bombe (für die Welle). */
  area?: Map<number, number>;
  /** Laufende Explosionen: Feldindex und Farbe der Bombe. */
  bursts?: { index: number; color: number; key: number }[];
  /** Juwelen, die in diesem Schritt zur Bombe werden (IDs). */
  forming?: Set<number>;
  /** Punkte, wie sie nach diesem Schritt stehen. */
  score: number;
}

/** Neue Bomben schon beim Abräumen als Bombe zeigen, nicht erst nach dem Nachrutschen. */
function withNewBombs(board: Board, ids: number[]): Board {
  if (!ids.length) return board;
  return board.map((g) => (ids.includes(g.id) ? { ...g, kind: 'bomb' as const, moves: undefined } : g));
}

/** 3×3 um jede Bombe, mit dem kleinsten Abstand (0 = Bombe selbst, 1 = Nachbar). */
function blastArea(blasts: number[], size: number): Map<number, number> {
  const area = new Map<number, number>();
  for (const b of blasts) {
    const r = Math.floor(b / size);
    const c = b % size;
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++) {
        const rr = r + dr;
        const cc = c + dc;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const i = rr * size + cc;
        const d = Math.max(Math.abs(dr), Math.abs(dc));
        area.set(i, Math.min(area.get(i) ?? d, d));
      }
  }
  return area;
}

function GemFace({ gem }: { gem: Gem }) {
  if (gem.kind === 'stone')
    return (
      <span className="gem stone">
        <StoneArt />
      </span>
    );
  return (
    <span className={`gem c${gem.color} ${gem.kind}`}>
      {gem.kind === 'bomb' ? <BombArt color={gem.color} /> : <GemArt color={gem.color} />}
      {gem.kind === 'question' && <span className="gem-badge num">+{gem.moves}</span>}
      {gem.kind === 'poison' && <span className="gem-badge minus num">−1</span>}
    </span>
  );
}

export function GemsRunner({ session }: { session: Session }) {
  const { t } = useI18n();
  const { settings } = useSettings();
  const { deck } = useStudy();
  const frame = useFrame();
  const { state, update, finish } = useSessionState<GemsState>(session);
  const [anim, setAnim] = useState<Anim | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [cursor, setCursor] = useState(0);
  const [combo, setCombo] = useState(0);
  const [announce, setAnnounce] = useState('');
  const [showing, setShowing] = useState<{ task: GemsQuestion; n: number } | null>(null);
  const [best, setBest] = useState<number | null>(null);
  const [record, setRecord] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const focusInside = useRef(false);
  /** Zuletzt mit der Tastatur gespielt (für die Fokusführung zwischen Feld und Frage). */
  const keyboard = useRef(false);
  const pointer = useRef<{ i: number; x: number; y: number } | null>(null);
  const timers = useRef<number[]>([]);
  const reduced = motionReduced(settings);
  const size = state.size;
  const bestKey = `gems:best:${session.setIds.join(',')}`;
  const T = reduced ? { swap: 60, pop: 120, fall: 60, charge: 0, burst: 240 } : { swap: 170, pop: 230, fall: 280, charge: 220, burst: 480 };

  const progress = gemsProgress(state);
  useEffect(() => frame.setProgress(progress.done, progress.total), [progress.done, progress.total, frame]);
  useEffect(() => {
    frame.setFinisher(() => update((s) => void (s.done = true)));
    return () => frame.setFinisher(null);
  }, [frame, update]);
  useEffect(() => () => timers.current.forEach((id) => clearTimeout(id)), []);

  // Rekord pro Auswahl von Sets, nur auf diesem Gerät.
  useEffect(() => {
    void db.meta.get(bestKey).then((row) => setBest(typeof row?.value === 'number' ? row.value : 0));
  }, [bestKey]);
  useEffect(() => {
    if (!state.done || best === null) return;
    void finish();
    if (state.score > best) {
      setRecord(true);
      setBest(state.score);
      void db.meta.put({ key: bestKey, value: state.score });
    }
  }, [state.done, state.score, best, bestKey, finish]);

  // Die nächste Frage erst zeigen, wenn das Feld zur Ruhe gekommen ist.
  useEffect(() => {
    if (!anim && !showing && state.current) setShowing((prev) => ({ task: state.current!, n: (prev?.n ?? 0) + 1 }));
  }, [anim, showing, state.current]);

  // Auf dem Handy liegt die Frage über dem Feld, oft ausserhalb des sichtbaren Bereichs.
  // Wer mit der Tastatur spielt, landet direkt in der Frage (das Feld ist dann gesperrt).
  useEffect(() => {
    if (!showing) return;
    document.getElementById('gems-q-title')?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
    if (keyboard.current && !document.activeElement?.closest('.gems-question'))
      document.querySelector<HTMLElement>('.gems-question input:not([disabled]), .gems-question .option:not([disabled])')?.focus({ preventScroll: true });
  }, [showing, reduced]);

  // Nach einer Animation oder Frage den Fokus wieder aufs Feld, wenn dort gespielt wurde.
  useEffect(() => {
    if (anim || showing || !(focusInside.current || keyboard.current)) return;
    boardRef.current?.querySelector<HTMLButtonElement>(`[data-index="${cursor}"]`)?.focus();
  }, [anim, showing, cursor]);

  const wait = (ms: number) =>
    new Promise<void>((res) => {
      timers.current.push(window.setTimeout(res, ms));
    });

  const describeStep = (st: GemsStep): string => {
    const parts: string[] = [];
    if (st.combo > 1) parts.push(t('gems.combo', { n: st.combo }));
    const gems = st.cleared.length - st.stones;
    if (gems > 0) parts.push(t('gems.announce.cleared', { n: gems, p: st.points - st.stones * 100 }));
    if (st.stones) parts.push(t('gems.announce.stones', { n: st.stones, p: st.stones * 100 }));
    if (st.bombs.length) parts.push(t('gems.announce.bomb'));
    if (st.questions) parts.push(t('gems.announce.questions', { n: st.questions }));
    if (st.poison) parts.push(t('gems.announce.poison'));
    return parts.join('. ');
  };

  const play = async (swappedBoard: Board, steps: GemsStep[], startScore: number) => {
    let score = startScore;
    setAnim({ board: swappedBoard, popping: new Set(), score });
    await wait(T.swap);
    let prev = swappedBoard;
    const said: string[] = [];
    for (const st of steps) {
      if (st.shuffled) {
        said.push(t('gems.shuffled'));
        setAnim({ board: st.board, popping: new Set(), score });
        await wait(T.fall);
        prev = st.board;
        continue;
      }
      setCombo(st.combo);
      said.push(describeStep(st));
      if (st.blasts.length) {
        // Bombe: kurz aufladen, dann Kernimpuls und Welle über das 3×3-Feld.
        const area = blastArea(st.blasts, size);
        if (T.charge) {
          setAnim({ board: prev, popping: new Set(), charging: new Set(st.blasts), area, score });
          await wait(T.charge);
        }
        score += st.points;
        const bursts = st.blasts.map((index) => ({ index, color: prev[index]?.color ?? 0, key: prev[index]?.id ?? index }));
        setAnim({ board: withNewBombs(prev, st.bombs), popping: new Set(st.cleared), area, bursts, forming: new Set(st.bombs), score });
        await wait(T.burst);
      } else {
        score += st.points;
        setAnim({ board: withNewBombs(prev, st.bombs), popping: new Set(st.cleared), forming: new Set(st.bombs), score });
        await wait(T.pop);
      }
      setAnim({ board: st.board, popping: new Set(), score });
      await wait(T.fall);
      prev = st.board;
    }
    setAnnounce(said.join('. '));
    setCombo(0);
    setAnim(null);
  };

  const swap = (a: number, b: number) => {
    if (anim || showing || state.done) return;
    let res: SwapResult = { ok: false, reason: 'busy' };
    const startScore = state.score;
    update((s) => void (res = gemsSwap(s, deck, a, b)), gemsProgress);
    const r = res as SwapResult;
    if (r.ok) {
      void play(r.swappedBoard, r.steps, startScore);
      return;
    }
    if (r.reason === 'stone') setAnnounce(t('gems.stone'));
    if (r.reason === 'noMatch' || r.reason === 'stone') {
      // Kurz tauschen und zurück, damit man sieht, dass es nicht passt.
      const tried = state.board.slice();
      if (r.reason === 'noMatch') [tried[a], tried[b]] = [tried[b], tried[a]];
      if (r.reason === 'noMatch') setAnnounce(t('gems.noMatch'));
      setAnim({ board: tried, popping: new Set(), bad: [a, b], score: state.score });
      void wait(T.swap * 2).then(() => setAnim(null));
    }
  };

  const tap = (i: number) => {
    setCursor(i);
    if (state.board[i]?.kind === 'stone' && !anim) {
      // Steine lassen sich nicht wählen: kurz wackeln statt still nichts tun.
      setAnnounce(t('gems.stone'));
      setAnim({ board: state.board, popping: new Set(), bad: [i, i], score: state.score });
      void wait(T.swap * 2).then(() => setAnim(null));
      return;
    }
    if (selected === null || selected === i) return setSelected(selected === i ? null : i);
    if (adjacent(selected, i, size)) {
      setSelected(null);
      swap(selected, i);
    } else setSelected(i);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    keyboard.current = false;
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (!el || anim || showing) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pointer.current = { i: Number(el.dataset.index), x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const start = pointer.current;
    pointer.current = null;
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_PX) return tap(start.i);
    const [r, c] = [Math.floor(start.i / size), start.i % size];
    const [tr, tc] = Math.abs(dx) > Math.abs(dy) ? [r, c + Math.sign(dx)] : [r + Math.sign(dy), c];
    if (tr < 0 || tc < 0 || tr >= size || tc >= size) return;
    setSelected(null);
    setCursor(tr * size + tc);
    swap(start.i, tr * size + tc);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    keyboard.current = true;
    const dirs: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (e.key in dirs) {
      e.preventDefault();
      const [dr, dc] = dirs[e.key];
      const from = selected ?? cursor;
      const r = Math.floor(from / size) + dr;
      const c = (from % size) + dc;
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      const to = r * size + c;
      setCursor(to);
      if (selected !== null) {
        setSelected(null);
        swap(selected, to);
      }
      return;
    }
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      tap(cursor);
    } else if (e.key === 'Escape' && selected !== null) {
      // Sonst öffnet Esc die Pause; hier hebt es nur die Auswahl auf.
      e.stopPropagation();
      setSelected(null);
    }
  };

  const gemLabel = (g: Gem): string => {
    if (g.kind === 'stone') return t('gems.kind.stone');
    const name = t(`gems.color.${g.color}` as Key);
    if (g.kind === 'question') return t('gems.kind.question', { gem: name, n: g.moves ?? 0 });
    if (g.kind === 'bomb') return t('gems.kind.bomb', { gem: name });
    if (g.kind === 'poison') return t('gems.kind.poison', { gem: name });
    return name;
  };

  if (state.done && !showing && !anim) {
    return (
      <Summary
        session={session}
        title={t('gems.over.title')}
        lead={
          <>
            <strong className="num">{t('gems.over.lead', { n: state.score })}</strong>
            {record ? ` · ${t('gems.over.record')}` : best ? ` · ${t('gems.over.best', { n: best })}` : ''}
          </>
        }
        practice={state.missed.map(parseKey)}
        onAgain={() => {
          setRecord(false);
          update((s) => void Object.assign(s, createGems(deck, [...new Set(s.keys)], { questionType: s.questionType, seed: randomSeed() })), gemsProgress);
        }}
        againLabel={t('gems.again')}
      >
        <dl className="gems-result">
          <div>
            <dt>{t('gems.stats.questions')}</dt>
            <dd className="num">
              {state.correct} / {state.asked}
            </dd>
          </div>
          <div>
            <dt>{t('gems.stats.movesWon')}</dt>
            <dd className="num">{state.movesWon}</dd>
          </div>
          <div>
            <dt>{t('gems.stats.combo')}</dt>
            <dd className="num">{state.bestCombo > 1 ? `×${state.bestCombo}` : '–'}</dd>
          </div>
          <div>
            <dt>{t('gems.stats.stones')}</dt>
            <dd className="num">{state.stonesBroken}</dd>
          </div>
        </dl>
      </Summary>
    );
  }

  const board = anim?.board ?? state.board;
  const popping = anim?.popping ?? new Set<number>();
  const shownScore = anim?.score ?? state.score;
  const pending = state.pending.length;

  return (
    <div className="gems">
      <div className="gems-hud" aria-live="off">
        <div className="gems-stat">
          <span className="small muted">{t('gems.score')}</span>
          <strong className="num gems-score" key={shownScore}>
            {shownScore}
          </strong>
        </div>
        <div className={`gems-stat ${state.moves <= 3 ? 'low' : ''}`}>
          <span className="small muted">{t('gems.moves')}</span>
          <strong className="num">{state.moves}</strong>
        </div>
        <div className="gems-stat">
          <span className="small muted">{t('gems.best')}</span>
          <strong className="num">{best === null ? '–' : Math.max(best, shownScore)}</strong>
        </div>
      </div>

      {showing && (
        <section className="gems-question panel" aria-labelledby="gems-q-title">
          <h2 id="gems-q-title" className="gems-q-title">
            {t('gems.question.title', { n: showing.task.moves })}
            {pending > 0 && <span className="small muted"> · {t('gems.question.more', { n: pending })}</span>}
          </h2>
          <TaskView
            key={showing.n}
            task={showing.task}
            onResult={(correct) => update((s) => gemsAnswer(s, deck, correct), gemsProgress)}
            onOverride={() => update((s) => gemsOverride(s, showing.task.key), gemsProgress)}
            onNext={() => setShowing(null)}
          />
        </section>
      )}

      <div className={`gems-stage ${showing ? 'dimmed' : ''}`} inert={!!showing}>
        <GemDefs />
        <div
          ref={boardRef}
          className={`gems-board ${reduced ? 'reduced' : ''}`}
          style={{ ['--n' as string]: size }}
          role="group"
          aria-label={t('gems.board', { n: size })}
          onKeyDown={onKeyDown}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onPointerCancel={() => (pointer.current = null)}
          onFocus={() => (focusInside.current = true)}
          onBlur={(e) => (focusInside.current = boardRef.current?.contains(e.relatedTarget as Node) ?? false)}
        >
          {board.map((g, i) => {
            const r = Math.floor(i / size);
            const c = i % size;
            const inArea = anim?.area?.get(i);
            const cls = [
              'gem-slot',
              popping.has(g.id) && 'pop',
              selected === i && 'selected',
              anim?.bad?.includes(i) && 'bad',
              cursor === i && 'cursor',
              anim?.charging?.has(i) && 'charging',
              anim?.forming?.has(g.id) && 'forming',
              inArea !== undefined && (anim?.bursts ? 'blasted' : 'braced'),
            ]
              .filter(Boolean)
              .join(' ');
            return (
              <button
                key={g.id}
                type="button"
                data-index={i}
                className={cls}
                style={{ transform: `translate(${c * 100}%, ${r * 100}%)`, ['--wave' as string]: inArea ?? 0 }}
                tabIndex={cursor === i ? 0 : -1}
                aria-label={`${t('gems.cell', { gem: gemLabel(g), r: r + 1, c: c + 1 })}${selected === i ? `, ${t('gems.selected')}` : ''}`}
                aria-pressed={selected === i}
                onFocus={() => setCursor(i)}
              >
                <GemFace gem={g} />
              </button>
            );
          })}
          {anim?.bursts && !reduced && (
            <div className="gems-fx">
              {anim.bursts.map((b) => (
                <BlastEffect key={b.key} index={b.index} size={size} color={b.color} />
              ))}
            </div>
          )}
        </div>
        {combo > 1 && (
          <div className="gems-combo num" aria-hidden="true" key={combo}>
            {t('gems.combo', { n: combo })}
          </div>
        )}
      </div>

      <p className="sr-only" aria-live="polite">
        {announce}
      </p>
      <p className="small muted gems-hint">{t('gems.hint')}</p>
      <details className="gems-legend small text-2">
        <summary>{t('gems.legend')}</summary>
        <ul>
          <li>
            <span className="gem-mini">
              <GemFace gem={{ id: -1, kind: 'question', color: 3, moves: 3 }} />
            </span>
            {t('gems.legend.question')}
          </li>
          <li>
            <span className="gem-mini">
              <GemFace gem={{ id: -2, kind: 'bomb', color: 0 }} />
            </span>
            {t('gems.legend.bomb')}
          </li>
          <li>
            <span className="gem-mini">
              <GemFace gem={{ id: -3, kind: 'stone', color: -1 }} />
            </span>
            {t('gems.legend.stone')}
          </li>
          <li>
            <span className="gem-mini">
              <GemFace gem={{ id: -4, kind: 'poison', color: 2 }} />
            </span>
            {t('gems.legend.poison')}
          </li>
        </ul>
      </details>
    </div>
  );
}
