import { Circle, Cube, Diamond, Heart, Hexagon, Skull, Sparkle, Star, Triangle } from '@phosphor-icons/react';
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
import { Summary } from './Summary';
import { TaskView } from './TaskView';

/** Form je Farbe: Juwelen sind auch ohne Farbsehen unterscheidbar. */
const SHAPES = [Heart, Star, Hexagon, Diamond, Triangle, Circle];
const SWIPE_PX = 18;

interface Anim {
  board: Board;
  popping: Set<number>;
  bad?: [number, number];
}

function GemFace({ gem }: { gem: Gem }) {
  if (gem.kind === 'stone')
    return (
      <span className="gem stone">
        <Cube weight="fill" className="gem-shape" />
      </span>
    );
  const Shape = SHAPES[gem.color] ?? Circle;
  return (
    <span className={`gem c${gem.color} ${gem.kind}`}>
      <Shape weight="fill" className="gem-shape" />
      {gem.kind === 'question' && <span className="gem-badge num">+{gem.moves}</span>}
      {gem.kind === 'bomb' && <Sparkle weight="fill" className="gem-mark" />}
      {gem.kind === 'poison' && <Skull weight="fill" className="gem-mark" />}
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
  const pointer = useRef<{ i: number; x: number; y: number } | null>(null);
  const timers = useRef<number[]>([]);
  const reduced = motionReduced(settings);
  const size = state.size;
  const bestKey = `gems:best:${session.setIds.join(',')}`;
  const T = reduced ? { swap: 60, pop: 80, fall: 60 } : { swap: 170, pop: 230, fall: 280 };

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
  useEffect(() => {
    if (showing) document.getElementById('gems-q-title')?.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [showing, reduced]);

  // Nach einer Animation den Fokus auf dem Feld halten, wenn er dort war.
  useEffect(() => {
    if (anim || showing || !focusInside.current) return;
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

  const play = async (swappedBoard: Board, steps: GemsStep[]) => {
    setAnim({ board: swappedBoard, popping: new Set() });
    await wait(T.swap);
    let prev = swappedBoard;
    const said: string[] = [];
    for (const st of steps) {
      if (st.shuffled) {
        said.push(t('gems.shuffled'));
        setAnim({ board: st.board, popping: new Set() });
        await wait(T.fall);
        prev = st.board;
        continue;
      }
      setCombo(st.combo);
      setAnim({ board: prev, popping: new Set(st.cleared) });
      said.push(describeStep(st));
      await wait(T.pop);
      setAnim({ board: st.board, popping: new Set() });
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
    update((s) => void (res = gemsSwap(s, deck, a, b)), gemsProgress);
    const r = res as SwapResult;
    if (r.ok) {
      void play(r.swappedBoard, r.steps);
      return;
    }
    if (r.reason === 'stone') setAnnounce(t('gems.stone'));
    if (r.reason === 'noMatch' || r.reason === 'stone') {
      // Kurz tauschen und zurück, damit man sieht, dass es nicht passt.
      const tried = state.board.slice();
      if (r.reason === 'noMatch') [tried[a], tried[b]] = [tried[b], tried[a]];
      if (r.reason === 'noMatch') setAnnounce(t('gems.noMatch'));
      setAnim({ board: tried, popping: new Set(), bad: [a, b] });
      void wait(T.swap * 2).then(() => setAnim(null));
    }
  };

  const tap = (i: number) => {
    setCursor(i);
    if (selected === null || selected === i) return setSelected(selected === i ? null : i);
    if (adjacent(selected, i, size)) {
      setSelected(null);
      swap(selected, i);
    } else setSelected(i);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
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
  const pending = state.pending.length;

  return (
    <div className="gems">
      <div className="gems-hud" aria-live="off">
        <div className="gems-stat">
          <span className="small muted">{t('gems.score')}</span>
          <strong className="num">{state.score}</strong>
        </div>
        <div className={`gems-stat ${state.moves <= 3 ? 'low' : ''}`}>
          <span className="small muted">{t('gems.moves')}</span>
          <strong className="num">{state.moves}</strong>
        </div>
        <div className="gems-stat">
          <span className="small muted">{t('gems.best')}</span>
          <strong className="num">{best === null ? '–' : Math.max(best, state.score)}</strong>
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
            const cls = ['gem-slot', popping.has(g.id) && 'pop', selected === i && 'selected', anim?.bad?.includes(i) && 'bad', cursor === i && 'cursor'].filter(Boolean).join(' ');
            return (
              <button
                key={g.id}
                type="button"
                data-index={i}
                className={cls}
                style={{ transform: `translate(${c * 100}%, ${r * 100}%)` }}
                tabIndex={cursor === i ? 0 : -1}
                aria-label={`${t('gems.cell', { gem: gemLabel(g), r: r + 1, c: c + 1 })}${selected === i ? `, ${t('gems.selected')}` : ''}`}
                aria-pressed={selected === i}
                onFocus={() => setCursor(i)}
              >
                <GemFace gem={g} />
              </button>
            );
          })}
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
